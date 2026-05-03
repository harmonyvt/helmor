use std::collections::HashMap;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::process;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use axum::body::Body;
use axum::extract::{Path, Query};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

#[derive(Debug, Clone)]
pub struct WebServerOptions {
    pub addr: SocketAddr,
    pub frontend_dir: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct WebState {
    frontend_dir: PathBuf,
}

pub async fn serve(options: WebServerOptions) -> Result<()> {
    initialise_runtime()?;

    let frontend_dir = options
        .frontend_dir
        .unwrap_or_else(default_frontend_dir)
        .canonicalize()
        .unwrap_or_else(|_| default_frontend_dir());

    let state = WebState { frontend_dir };
    let app = router(state.clone());
    let listener = tokio::net::TcpListener::bind(options.addr)
        .await
        .with_context(|| format!("Failed to bind Helmor web server to {}", options.addr))?;

    tracing::info!(addr = %options.addr, frontend = %state.frontend_dir.display(), "Helmor web companion listening");
    write_pid_file(options.addr, &state.frontend_dir)?;

    println!("Helmor web companion: http://{}", options.addr);
    println!("Data directory: {}", crate::data_dir::data_dir()?.display());
    println!("Frontend directory: {}", state.frontend_dir.display());

    axum::serve(listener, app)
        .await
        .context("Helmor web server failed")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WebDaemonPidFile {
    pid: u32,
    url: String,
    host: String,
    port: u16,
    data_dir: String,
    frontend_dir: String,
    identity: String,
    started_at_ms: u128,
}

fn write_pid_file(addr: SocketAddr, frontend_dir: &std::path::Path) -> Result<()> {
    let run_dir = crate::data_dir::run_dir()?;
    let data_dir = crate::data_dir::data_dir()?;
    let body = WebDaemonPidFile {
        pid: process::id(),
        url: format!("http://{addr}"),
        host: addr.ip().to_string(),
        port: addr.port(),
        data_dir: data_dir.display().to_string(),
        frontend_dir: frontend_dir.display().to_string(),
        identity: crate::data_dir::data_mode_label().to_string(),
        started_at_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
    };
    std::fs::write(
        run_dir.join(format!("web-daemon-{}.json", addr.port())),
        serde_json::to_vec_pretty(&body)?,
    )
    .context("Failed to write web daemon pid file")
}

fn router(state: WebState) -> Router {
    let static_service = ServeDir::new(&state.frontend_dir)
        .not_found_service(ServeFile::new(state.frontend_dir.join("index.html")));

    Router::new()
        .route("/api/health", get(health))
        .route("/api/asset", get(asset))
        .route("/api/invoke/:command", post(invoke))
        .route("/api/streams/agent", post(agent_stream))
        .route("/api/events/ui", get(ui_events))
        .nest_service("/", static_service)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

fn initialise_runtime() -> Result<()> {
    crate::data_dir::ensure_directory_structure()?;
    let logs_dir = crate::data_dir::logs_dir()?;
    let _ = crate::logging::init(&logs_dir);

    let db_path = crate::data_dir::db_path()?;
    let connection = rusqlite::Connection::open(&db_path)
        .with_context(|| format!("Failed to open database at {}", db_path.display()))?;
    crate::db::init_connection(&connection, true)?;
    crate::schema::ensure_schema(&connection)?;
    drop(connection);
    crate::db::init_pools()?;
    crate::shell_env::inherit_login_shell_env();
    crate::forge::init_bundled_cli_paths();
    Ok(())
}

pub fn default_frontend_dir() -> PathBuf {
    if let Ok(path) = std::env::var("HELMOR_WEB_FRONTEND_DIR") {
        let path = PathBuf::from(path);
        if path.join("index.html").is_file() {
            return path;
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(contents_dir) = exe.parent().and_then(|dir| dir.parent()) {
            let resources = contents_dir.join("Resources/web-dist");
            if resources.join("index.html").is_file() {
                return resources;
            }
        }
    }

    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for base in [cwd.as_path(), cwd.parent().unwrap_or(cwd.as_path())] {
        let candidate = base.join("dist-web");
        if candidate.join("index.html").is_file() {
            return candidate;
        }
    }

    cwd.join("dist-web")
}

async fn health() -> Json<Value> {
    Json(json!({
        "ok": true,
        "data": {
            "mode": "web",
            "dataDir": crate::data_dir::data_dir_display().unwrap_or_default(),
        }
    }))
}

async fn asset(Query(query): Query<HashMap<String, String>>) -> Response {
    let Some(path) = query.get("path") else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match std::fs::read(path) {
        Ok(bytes) => Response::builder()
            .header("cache-control", "no-store")
            .body(Body::from(bytes))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn invoke(Path(command): Path<String>, Json(args): Json<Value>) -> Response {
    match dispatch_invoke(&command, args).await {
        Ok(data) => Json(json!({ "ok": true, "data": data })).into_response(),
        Err(error) => (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "ok": false,
                "error": { "message": format!("{error:#}") }
            })),
        )
            .into_response(),
    }
}

async fn dispatch_invoke(command: &str, args: Value) -> Result<Value> {
    match command {
        "get_app_settings" => {
            json_cmd(crate::commands::settings_commands::get_app_settings().await)
        }
        "update_app_settings" => {
            let settings_map: HashMap<String, String> = arg(&args, "settingsMap")?;
            json_cmd(crate::commands::settings_commands::update_app_settings(settings_map).await)
        }
        "get_data_info" => json_any(crate::service::get_data_info()),
        "get_cli_status" => json_cmd(crate::commands::system_commands::get_cli_status()),
        "get_agent_login_status" => {
            json_cmd(crate::commands::system_commands::get_agent_login_status().await)
        }
        "get_helmor_skills_status" => {
            json_cmd(crate::commands::system_commands::get_helmor_skills_status().await)
        }
        "get_github_cli_status" => {
            json_cmd(crate::commands::github_commands::get_github_cli_status().await)
        }
        "get_github_cli_user" => {
            json_cmd(crate::commands::github_commands::get_github_cli_user().await)
        }
        "list_github_accessible_repositories" => {
            json_cmd(crate::commands::github_commands::list_github_accessible_repositories().await)
        }
        "list_github_pull_requests_for_repo" => {
            let repo_id: String = arg(&args, "repoId")?;
            json_cmd(
                crate::commands::github_commands::list_github_pull_requests_for_repo(repo_id).await,
            )
        }
        "resolve_github_pull_request_for_repo" => {
            let repo_id: String = arg(&args, "repoId")?;
            let input: String = arg(&args, "input")?;
            json_cmd(
                crate::commands::github_commands::resolve_github_pull_request_for_repo(
                    repo_id, input,
                )
                .await,
            )
        }
        "list_agent_model_sections" => json_cmd(crate::agents::list_agent_model_sections().await),
        "get_codex_rate_limits" => {
            json_cmd(crate::commands::settings_commands::get_codex_rate_limits().await)
        }
        "get_claude_rate_limits" => {
            json_cmd(crate::commands::settings_commands::get_claude_rate_limits().await)
        }
        "load_auto_close_action_kinds" => {
            json_any(crate::models::settings::load_auto_close_action_kinds())
        }
        "save_auto_close_action_kinds" => {
            let kinds: Vec<crate::agents::ActionKind> = arg(&args, "kinds")?;
            json_any(crate::models::settings::save_auto_close_action_kinds(
                &kinds,
            ))
        }
        "load_auto_close_opt_in_asked" => {
            json_any(crate::models::settings::load_auto_close_opt_in_asked())
        }
        "save_auto_close_opt_in_asked" => {
            let kinds: Vec<crate::agents::ActionKind> = arg(&args, "kinds")?;
            json_any(crate::models::settings::save_auto_close_opt_in_asked(
                &kinds,
            ))
        }
        "list_repositories" => json_any(crate::repos::list_repositories()),
        "get_add_repository_defaults" => {
            json_cmd(crate::commands::repository_commands::get_add_repository_defaults().await)
        }
        "list_repo_remotes" => {
            let repo_id: String = arg(&args, "repoId")?;
            json_any(crate::repos::list_repo_remotes(&repo_id))
        }
        "load_repo_scripts" => {
            let repo_id: String = arg(&args, "repoId")?;
            let workspace_id: Option<String> = opt_arg(&args, "workspaceId")?;
            json_any(crate::repos::load_repo_scripts(
                &repo_id,
                workspace_id.as_deref(),
            ))
        }
        "load_repo_preferences" => {
            let repo_id: String = arg(&args, "repoId")?;
            json_any(crate::repos::load_repo_preferences(&repo_id))
        }
        "update_repo_preferences" => {
            let repo_id: String = arg(&args, "repoId")?;
            let preferences = arg(&args, "preferences")?;
            json_any(crate::repos::update_repo_preferences(
                &repo_id,
                &preferences,
            ))
        }
        "list_workspace_groups" => json_any(crate::workspaces::list_workspace_groups()),
        "list_archived_workspaces" => json_any(crate::workspaces::list_archived_workspaces()),
        "get_workspace" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            json_any(crate::workspaces::get_workspace(&workspace_id))
        }
        "mark_workspace_unread" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            json_any(crate::workspaces::mark_workspace_unread(&workspace_id))
        }
        "mark_workspace_read" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            json_any(crate::workspaces::mark_workspace_read(&workspace_id))
        }
        "pin_workspace" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            json_any(crate::workspaces::pin_workspace(&workspace_id))
        }
        "unpin_workspace" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            json_any(crate::workspaces::unpin_workspace(&workspace_id))
        }
        "set_workspace_status" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            let status = arg(&args, "status")?;
            json_any(crate::workspaces::set_workspace_status(
                &workspace_id,
                status,
            ))
        }
        "list_workspace_linked_directories" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            json_any(crate::workspaces::get_workspace_linked_directories(
                &workspace_id,
            ))
        }
        "set_workspace_linked_directories" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            let directories: Vec<String> = arg(&args, "directories")?;
            json_any(crate::workspaces::set_workspace_linked_directories(
                &workspace_id,
                directories,
            ))
        }
        "list_workspace_candidate_directories" => {
            let exclude_workspace_id: Option<String> = opt_arg(&args, "excludeWorkspaceId")?;
            json_any(crate::workspaces::list_candidate_directories(
                exclude_workspace_id.as_deref(),
            ))
        }
        "list_remote_branches" => {
            let workspace_id: Option<String> = opt_arg(&args, "workspaceId")?;
            let repo_id: Option<String> = opt_arg(&args, "repoId")?;
            json_cmd(
                crate::commands::workspace_commands::list_remote_branches(workspace_id, repo_id)
                    .await,
            )
        }
        "prefetch_remote_refs" => {
            let workspace_id: Option<String> = opt_arg(&args, "workspaceId")?;
            let repo_id: Option<String> = opt_arg(&args, "repoId")?;
            json_cmd(
                crate::commands::workspace_commands::prefetch_remote_refs(workspace_id, repo_id)
                    .await,
            )
        }
        "list_workspace_sessions" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            json_any(crate::sessions::list_workspace_sessions(&workspace_id))
        }
        "list_session_thread_messages" => {
            let session_id: String = arg(&args, "sessionId")?;
            let historical = crate::sessions::list_session_historical_records(&session_id)?;
            json_value(crate::pipeline::MessagePipeline::convert_historical(
                &historical,
            ))
        }
        "create_session" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            let action_kind = opt_arg(&args, "actionKind")?;
            let permission_mode: Option<String> = opt_arg(&args, "permissionMode")?;
            json_any(crate::sessions::create_session(
                &workspace_id,
                action_kind,
                permission_mode.as_deref(),
            ))
        }
        "rename_session" => {
            let session_id: String = arg(&args, "sessionId")?;
            let title: String = arg(&args, "title")?;
            json_any(crate::sessions::rename_session(&session_id, &title))
        }
        "hide_session" => {
            let session_id: String = arg(&args, "sessionId")?;
            json_any(crate::sessions::hide_session(&session_id))
        }
        "unhide_session" => {
            let session_id: String = arg(&args, "sessionId")?;
            json_any(crate::sessions::unhide_session(&session_id))
        }
        "delete_session" => {
            let session_id: String = arg(&args, "sessionId")?;
            json_any(crate::sessions::delete_session(&session_id))
        }
        "list_hidden_sessions" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            json_any(crate::sessions::list_hidden_sessions(&workspace_id))
        }
        "get_session_context_usage" => {
            let session_id: String = arg(&args, "sessionId")?;
            json_any(crate::sessions::get_session_context_usage(&session_id))
        }
        "mark_session_read" => {
            let session_id: String = arg(&args, "sessionId")?;
            json_any(crate::sessions::mark_session_read(&session_id))
        }
        "mark_session_unread" => {
            let session_id: String = arg(&args, "sessionId")?;
            json_any(crate::sessions::mark_session_unread(&session_id))
        }
        "update_session_settings" => update_session_settings(args),
        "read_editor_file" => {
            let path: String = arg(&args, "path")?;
            json_any(crate::editor_files::read_editor_file(&path))
        }
        "read_file_at_ref" => {
            let workspace_root_path: String = arg(&args, "workspaceRootPath")?;
            let file_path: String = arg(&args, "filePath")?;
            let git_ref: String = arg(&args, "gitRef")?;
            json_any(crate::editor_files::read_file_at_ref(
                &workspace_root_path,
                &file_path,
                &git_ref,
            ))
        }
        "write_editor_file" => {
            let path: String = arg(&args, "path")?;
            let content: String = arg(&args, "content")?;
            json_any(crate::editor_files::write_editor_file(&path, &content))
        }
        "stat_editor_file" => {
            let path: String = arg(&args, "path")?;
            json_any(crate::editor_files::stat_editor_file(&path))
        }
        "list_editor_files" => {
            let workspace_root_path: String = arg(&args, "workspaceRootPath")?;
            json_any(crate::editor_files::list_editor_files(&workspace_root_path))
        }
        "list_workspace_files" => {
            let workspace_root_path: String = arg(&args, "workspaceRootPath")?;
            json_any(crate::editor_files::list_workspace_files(
                &workspace_root_path,
            ))
        }
        "list_editor_files_with_content" => {
            let workspace_root_path: String = arg(&args, "workspaceRootPath")?;
            json_any(crate::editor_files::list_editor_files_with_content(
                &workspace_root_path,
            ))
        }
        "list_workspace_changes" => {
            let workspace_root_path: String = arg(&args, "workspaceRootPath")?;
            json_any(crate::editor_files::list_workspace_changes(
                &workspace_root_path,
            ))
        }
        "list_workspace_changes_with_content" => {
            let workspace_root_path: String = arg(&args, "workspaceRootPath")?;
            json_any(crate::editor_files::list_workspace_changes_with_content(
                &workspace_root_path,
            ))
        }
        "discard_workspace_file" => {
            let workspace_root_path: String = arg(&args, "workspaceRootPath")?;
            let relative_path: String = arg(&args, "relativePath")?;
            json_any(crate::editor_files::discard_workspace_file(
                &workspace_root_path,
                &relative_path,
            ))
        }
        "stage_workspace_file" => {
            let workspace_root_path: String = arg(&args, "workspaceRootPath")?;
            let relative_path: String = arg(&args, "relativePath")?;
            json_any(crate::editor_files::stage_workspace_file(
                &workspace_root_path,
                &relative_path,
            ))
        }
        "unstage_workspace_file" => {
            let workspace_root_path: String = arg(&args, "workspaceRootPath")?;
            let relative_path: String = arg(&args, "relativePath")?;
            json_any(crate::editor_files::unstage_workspace_file(
                &workspace_root_path,
                &relative_path,
            ))
        }
        "get_workspace_git_action_status" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            json_cmd(
                crate::commands::editor_commands::get_workspace_git_action_status(workspace_id)
                    .await,
            )
        }
        "get_workspace_forge" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            json_any(crate::forge::get_workspace_forge(&workspace_id))
        }
        "get_forge_cli_status" => {
            let provider = arg(&args, "provider")?;
            let host: Option<String> = opt_arg(&args, "host")?;
            json_any(crate::forge::get_forge_cli_status(
                provider,
                host.as_deref(),
            ))
        }
        "get_workspace_forge_action_status" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            json_any(crate::forge::lookup_workspace_forge_action_status(
                &workspace_id,
            ))
        }
        "get_workspace_forge_check_insert_text" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            let item_id: String = arg(&args, "itemId")?;
            json_any(crate::forge::lookup_workspace_forge_check_insert_text(
                &workspace_id,
                &item_id,
            ))
        }
        "get_workspace_forge_deployment_insert_text" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            let item_id: String = arg(&args, "itemId")?;
            json_any(crate::forge::lookup_workspace_forge_deployment_insert_text(
                &workspace_id,
                &item_id,
            ))
        }
        "get_workspace_pr_comments" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            json_any(crate::forge::lookup_workspace_pr_comments(&workspace_id))
        }
        "get_workspace_pr_comment_insert_text" => {
            let workspace_id: String = arg(&args, "workspaceId")?;
            let comment_id: String = arg(&args, "commentId")?;
            json_any(crate::forge::lookup_workspace_pr_comment_insert_text(
                &workspace_id,
                &comment_id,
            ))
        }
        "drain_pending_cli_sends" => json_any(crate::service::drain_pending_cli_sends()),
        "stop_agent_stream"
        | "steer_agent_stream"
        | "respond_to_permission_request"
        | "respond_to_deferred_tool"
        | "respond_to_elicitation_request" => json_value(()),
        "subscribe_ui_mutations" => json_value(()),
        other => bail!("Web companion does not support Tauri command '{other}' yet."),
    }
}

fn update_session_settings(args: Value) -> Result<Value> {
    let session_id: String = arg(&args, "sessionId")?;
    let model: Option<String> = opt_arg(&args, "model")?;
    let effort_level: Option<String> = opt_arg(&args, "effortLevel")?;
    let permission_mode: Option<String> = opt_arg(&args, "permissionMode")?;
    let connection = crate::db::write_conn()?;
    connection.execute(
        r#"
        UPDATE sessions SET
          model = COALESCE(?2, model),
          effort_level = COALESCE(?3, effort_level),
          permission_mode = COALESCE(?4, permission_mode)
        WHERE id = ?1
        "#,
        rusqlite::params![session_id, model, effort_level, permission_mode],
    )?;
    json_value(())
}

async fn agent_stream(Json(args): Json<Value>) -> Response {
    let request = match args.get("request") {
        Some(value) => value.clone(),
        None => args,
    };

    let (sender, receiver) = mpsc::channel::<std::result::Result<Event, Infallible>>(64);
    std::thread::spawn(move || {
        if let Err(error) = run_agent_stream(request, &sender) {
            let _ = sender.blocking_send(Ok(sse_json(
                "error",
                &json!({
                    "kind": "error",
                    "message": format!("{error:#}"),
                    "persisted": false,
                    "internal": false,
                }),
            )));
        }
    });

    Sse::new(tokio_stream::wrappers::ReceiverStream::new(receiver))
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("heartbeat"),
        )
        .into_response()
}

fn run_agent_stream(
    request: Value,
    sender: &mpsc::Sender<std::result::Result<Event, Infallible>>,
) -> Result<()> {
    let prompt = request
        .get("prompt")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let model_id = request
        .get("modelId")
        .and_then(Value::as_str)
        .context("Agent request is missing modelId")?
        .to_string();
    let session_id = request
        .get("helmorSessionId")
        .or_else(|| request.get("sessionId"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let workspace_ref = session_id
        .as_deref()
        .and_then(workspace_id_for_session)
        .or_else(|| {
            workspace_id_for_working_directory(
                request.get("workingDirectory").and_then(Value::as_str),
            )
        })
        .context("Agent request needs helmorSessionId or a known workingDirectory in web mode")?;
    let permission_mode = request
        .get("permissionMode")
        .and_then(Value::as_str)
        .map(str::to_string);

    let params = crate::service::SendMessageParams {
        workspace_ref,
        session_id,
        prompt,
        model: Some(model_id),
        permission_mode,
        linked_directories: Vec::new(),
        delegate_to_running_app: false,
    };

    let mut on_event = |event: &crate::agents::AgentStreamEvent| {
        let _ = sender.blocking_send(Ok(sse_json("agent", event)));
    };
    crate::service::send_message(params, &mut on_event)?;
    Ok(())
}

async fn ui_events() -> Sse<impl futures_util::Stream<Item = std::result::Result<Event, Infallible>>>
{
    let stream = futures_util::stream::pending::<std::result::Result<Event, Infallible>>();
    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("heartbeat"),
    )
}

fn workspace_id_for_session(session_id: &str) -> Option<String> {
    let conn = crate::db::read_conn().ok()?;
    conn.query_row(
        "SELECT workspace_id FROM sessions WHERE id = ?1",
        [session_id],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

fn workspace_id_for_working_directory(working_directory: Option<&str>) -> Option<String> {
    let working_directory = working_directory?;
    let records = crate::models::workspaces::load_workspace_records().ok()?;
    records
        .into_iter()
        .find(|record| {
            crate::data_dir::workspace_dir(&record.repo_name, &record.directory_name)
                .ok()
                .map(|path| path.display().to_string() == working_directory)
                .unwrap_or(false)
        })
        .map(|record| record.id)
}

fn sse_json<T: Serialize>(event: &str, value: &T) -> Event {
    Event::default().event(event).json_data(value).unwrap_or_else(|_| {
        Event::default().event("error").data(r#"{"kind":"error","message":"failed to serialize event","persisted":false,"internal":true}"#)
    })
}

fn json_cmd<T: Serialize>(
    result: std::result::Result<T, crate::error::CommandError>,
) -> Result<Value> {
    result
        .map_err(|error| anyhow!(format!("{error:?}")))
        .and_then(json_value)
}

fn json_any<T: Serialize>(result: anyhow::Result<T>) -> Result<Value> {
    result.and_then(json_value)
}

fn json_value<T: Serialize>(value: T) -> Result<Value> {
    serde_json::to_value(value).context("Failed to serialize web response")
}

fn arg<T: DeserializeOwned>(args: &Value, name: &str) -> Result<T> {
    let value = args
        .get(name)
        .cloned()
        .ok_or_else(|| anyhow!("Missing required argument '{name}'"))?;
    serde_json::from_value(value).with_context(|| format!("Invalid argument '{name}'"))
}

fn opt_arg<T: DeserializeOwned>(args: &Value, name: &str) -> Result<Option<T>> {
    match args.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .with_context(|| format!("Invalid argument '{name}'")),
    }
}
