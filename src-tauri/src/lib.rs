pub mod agents;
pub mod background_agents;
pub mod browser_profile;
pub mod cli;
pub(crate) mod commands;
pub mod data_dir;
pub mod debug_ingest;
pub mod error;
pub mod forge;
pub mod git;
pub mod global_hotkey;
pub mod goal_assignees;
pub mod goal_orchestration;
pub mod goal_orchestrator;
pub mod image_store;
mod import;
pub mod knowledge;
pub mod logging;
pub mod mcp;
pub mod models;
pub mod pipeline;
pub mod rate_limits;
pub mod schema;
pub mod service;
mod shell_env;
pub mod sidecar;
pub mod skill_export;
pub mod terminal_profiles;
pub mod tmux;
pub mod ui_sync;
pub mod web;
pub mod web_daemon;
pub mod workspace;

#[cfg(test)]
pub(crate) mod testkit;

pub use forge as forge_ops;
pub use forge::github::cli as github_cli;
pub use forge::github::graphql as github_graphql;
pub use git::ops as git_ops;
pub use git::watcher as git_watcher;
pub use models::db;
pub use models::repos;
pub use models::sessions;
pub use models::settings;
pub use workspace::files as editor_files;
pub use workspace::helpers;
pub use workspace::kind as workspace_kind;
pub use workspace::landing as workspace_landing;
pub use workspace::pr_sync as workspace_pr_sync;
pub use workspace::state as workspace_state;
pub use workspace::status as workspace_status;
pub use workspace::workspaces;

use std::backtrace::Backtrace;

use tauri::{Emitter, Manager};

/// Initialise the database schema (call once at startup).
pub fn schema_init(conn: &rusqlite::Connection) {
    db::init_connection(conn, true).expect("Failed to apply PRAGMA init");
    schema::ensure_schema(conn).expect("Failed to initialize database schema");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_runtime_telemetry();
    install_rustls_crypto_provider();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(
        tauri_plugin_mcp_bridge::Builder::new()
            .base_port(resolve_mcp_base_port())
            .build(),
    );

    let app = builder
        .manage(sidecar::ManagedSidecar::new())
        .manage(sidecar::BackgroundSidecar::new())
        .manage(agents::ActiveStreams::new())
        .manage(agents::SlashCommandCache::new())
        .manage(workspace::archive::ArchiveJobManager::new())
        .manage(git_watcher::GitWatcherManager::new())
        .manage(workspace::scripts::ScriptProcessManager::new())
        .manage(commands::app_install_commands::AppInstallManager::new())
        .manage(debug_ingest::DebugIngestManager::new())
        .manage(knowledge::KnowledgeSidecarManager::new())
        .manage(ui_sync::UiSyncManager::new())
        .manage(web_daemon::WebDaemonManager::new())
        .manage(global_hotkey::GlobalHotkeyState::default())
        .manage(commands::forge_commands::ForgeAuthEdgeStore::default())
        .setup(|app| {
            // Ensure data directory structure exists
            data_dir::ensure_directory_structure()?;

            // Initialize structured logging (must come before any tracing macro call).
            // Logs live in `<data_dir>/logs/{rust,sidecar}.jsonl` with a `.1` backup;
            // the size-ring appender bounds disk use without a cleanup pass.
            let logs_dir = data_dir::logs_dir()?;
            logging::init(&logs_dir)?;
            log_runtime_telemetry();

            // Initialize database schema through the libSQL local DB facade,
            // then build the rusqlite compatibility pools for unmigrated
            // synchronous call sites.
            let db_path = data_dir::db_path()?;
            db::ensure_ready()?;

            tracing::info!(
                mode = data_dir::data_mode_label(),
                data = %db_path.display(),
                "Helmor started"
            );

            // Reconcile workspaces whose directory was deleted outside the
            // app: degrade them to `archived` so chat history is preserved
            // (users can find the messages in the archive list and choose
            // to Permanently Delete there). Never auto-destroys data.
            match workspace::workspaces::purge_orphaned_workspaces() {
                Ok(0) => {}
                Ok(n) => tracing::info!(
                    count = n,
                    "Degraded orphaned workspaces to archived (chat history preserved)"
                ),
                Err(e) => tracing::warn!("Failed to reconcile orphaned workspaces: {e:#}"),
            }

            // Clear rows stuck in `initializing` state past the cutoff —
            // happens when the app is force-quit mid-create (Phase 2 never
            // gets to flip the state to ready/setup_pending). Five minutes
            // is well past the worst-case git worktree creation time.
            const INITIALIZING_ORPHAN_CUTOFF_SECONDS: i64 = 300;
            match workspace::workspaces::cleanup_orphaned_initializing_workspaces(
                INITIALIZING_ORPHAN_CUTOFF_SECONDS,
            ) {
                Ok(0) => {}
                Ok(n) => tracing::info!(count = n, "Cleaned up orphan initializing workspaces"),
                Err(e) => tracing::warn!("Failed to clean up initializing orphans: {e:#}"),
            }

            match sessions::cleanup_stale_streaming_sessions_on_startup() {
                Ok(0) => {}
                Ok(n) => tracing::warn!(
                    count = n,
                    "Finalized stale streaming sessions from previous app run"
                ),
                Err(e) => tracing::warn!("Failed to finalize stale streaming sessions: {e:#}"),
            }

            // On macOS, GUI-launched apps only see the minimal system PATH.
            // Capture the user's login-shell PATH (Homebrew, nvm, bun, cargo,
            // etc.) so every child process — sidecar, git, workspace scripts —
            // can find developer tools without manual PATH hacks.
            shell_env::inherit_login_shell_env();

            forge::init_bundled_cli_paths();

            agents::prewarm_slash_command_cache(app.handle());
            let hotkey_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = global_hotkey::sync_from_settings(hotkey_handle).await {
                    tracing::warn!(
                        error = %format!("{error:#}"),
                        "Failed to register startup global hotkey",
                    );
                }
            });

            // Start git filesystem watchers for all ready workspaces.
            let watcher_handle = app.handle().clone();
            if let Err(error) = std::thread::Builder::new()
                .name("git-watcher-init".into())
                .spawn(move || {
                    let manager = watcher_handle.state::<git_watcher::GitWatcherManager>();
                    if let Err(e) = manager.sync_from_db(watcher_handle.clone()) {
                        tracing::error!("Failed to initialize git watchers: {e:#}");
                    }
                })
            {
                tracing::error!(error = %error, "Failed to spawn git watcher init thread");
            }

            if let Err(error) = ui_sync::start_listener(app.handle().clone()) {
                tracing::error!(error = %error, "Failed to start UI sync listener");
            }
            mcp::set_app_handle(app.handle().clone());

            // On macOS, the default app-menu Quit item goes straight to
            // NSApplication.terminate:, which bypasses our event loop.
            // Install a custom menu so Cmd+Q flows through the same
            // confirmation dialog as the close button.
            #[cfg(target_os = "macos")]
            install_macos_menu(app.handle())?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            agents::list_agent_model_sections,
            agents::check_pi_models,
            agents::send_agent_message_stream,
            agents::stop_agent_stream,
            agents::steer_agent_stream,
            agents::respond_to_permission_request,
            agents::respond_to_deferred_tool,
            agents::respond_to_elicitation_request,
            agents::send_kanban_tool_result,
            agents::respond_to_pi_ui,
            agents::generate_session_title,
            agents::list_slash_commands,
            agents::prewarm_slash_commands_for_workspace,
            commands::workspace_commands::prepare_archive_workspace,
            commands::workspace_commands::start_archive_workspace,
            commands::workspace_commands::validate_archive_workspace,
            commands::workspace_commands::validate_restore_workspace,
            commands::workspace_commands::complete_workspace_setup,
            commands::workspace_commands::create_workspace_from_repo,
            commands::workspace_commands::prepare_workspace_from_repo,
            commands::workspace_commands::prepare_workspace_from_source,
            commands::workspace_commands::finalize_workspace_from_repo,
            commands::repository_commands::get_add_repository_defaults,
            commands::settings_commands::get_app_settings,
            commands::settings_commands::get_claude_rate_limits,
            commands::settings_commands::get_codex_rate_limits,
            commands::settings_commands::run_libsql_experiment,
            commands::settings_commands::set_data_dir_preference,
            commands::system_commands::export_verbose_logs,
            commands::system_commands::get_cli_status,
            commands::system_commands::get_data_info,
            commands::knowledge_commands::get_knowledge_status,
            commands::knowledge_commands::reindex_project_knowledge,
            commands::knowledge_commands::reindex_goal_knowledge,
            commands::knowledge_commands::query_knowledge,
            commands::knowledge_commands::record_goal_knowledge_note,
            web_daemon::get_web_daemon_status,
            web_daemon::start_web_daemon,
            web_daemon::stop_web_daemon,
            web_daemon::delete_web_daemon,
            web_daemon::cleanup_web_daemon,
            commands::system_commands::get_agent_login_status,
            commands::system_commands::get_helmor_skills_status,
            commands::system_commands::install_cli,
            commands::system_commands::install_helmor_skills,
            commands::system_commands::enter_onboarding_window_mode,
            commands::system_commands::exit_onboarding_window_mode,
            commands::system_commands::open_agent_login_terminal,
            commands::system_commands::spawn_agent_login_terminal,
            commands::system_commands::stop_agent_login_terminal,
            commands::system_commands::write_agent_login_terminal_stdin,
            commands::system_commands::resize_agent_login_terminal,
            commands::github_commands::get_github_cli_status,
            commands::github_commands::get_github_cli_user,
            commands::forge_commands::get_workspace_forge,
            commands::forge_commands::get_forge_cli_status,
            commands::forge_commands::open_forge_cli_auth_terminal,
            commands::forge_commands::spawn_forge_cli_auth_terminal,
            commands::forge_commands::stop_forge_cli_auth_terminal,
            commands::forge_commands::write_forge_cli_auth_terminal_stdin,
            commands::forge_commands::resize_forge_cli_auth_terminal,
            commands::forge_commands::refresh_workspace_change_request,
            commands::forge_commands::get_workspace_forge_action_status,
            commands::forge_commands::get_workspace_forge_check_insert_text,
            commands::forge_commands::get_workspace_forge_deployment_insert_text,
            commands::forge_commands::get_workspace_pr_comments,
            commands::goal_commands::prepare_goal_workspace,
            commands::goal_commands::finalize_goal_workspace,
            commands::goal_commands::convert_workspace_to_goal,
            commands::goal_commands::list_goal_cards,
            commands::goal_commands::get_goal_orchestrator_state,
            commands::goal_commands::run_goal_orchestrator_tick,
            commands::goal_commands::upsert_goal_card,
            commands::goal_commands::link_goal_card_workspace,
            commands::goal_commands::create_goal_child_workspace,
            commands::goal_commands::create_goal_child_workspace_and_start,
            commands::goal_commands::send_assignee_message,
            commands::goal_commands::send_thread_message,
            commands::goal_commands::set_card_assignee_thread,
            commands::goal_commands::read_assignee_thread,
            commands::goal_commands::get_thread_runtime_status,
            commands::goal_commands::summarize_assignee_status,
            commands::goal_commands::list_assignees,
            commands::goal_commands::set_goal_child_workspace_status,
            commands::goal_commands::assign_workspace_to_goal,
            commands::forge_commands::get_workspace_pr_comment_insert_text,
            commands::forge_commands::merge_workspace_change_request,
            commands::forge_commands::close_workspace_change_request,
            commands::workspace_commands::get_workspace,
            commands::workspace_commands::list_goal_child_workspaces,
            commands::workspace_commands::update_goal_workspace_meta,
            commands::workspace_commands::reconcile_workspace_landing_state,
            commands::workspace_commands::mark_workspace_landed,
            commands::repository_commands::add_repository_from_local_path,
            commands::repository_commands::clone_repository_from_url,
            commands::repository_commands::create_github_project_repository,
            commands::github_commands::list_github_accessible_repositories,
            commands::github_commands::list_github_pull_requests_for_repo,
            commands::github_commands::resolve_github_pull_request_for_repo,
            commands::workspace_commands::list_archived_workspaces,
            commands::repository_commands::list_repositories,
            commands::repository_commands::update_repository_default_branch,
            commands::repository_commands::update_repository_branch_prefix,
            commands::repository_commands::update_repository_remote,
            commands::repository_commands::list_repo_remotes,
            commands::repository_commands::load_repo_scripts,
            commands::repository_commands::load_repo_preferences,
            commands::repository_commands::update_repo_scripts,
            commands::repository_commands::update_repo_auto_run_setup,
            commands::repository_commands::update_repo_preferences,
            commands::repository_commands::delete_repository,
            commands::script_commands::execute_repo_script,
            commands::script_commands::stop_repo_script,
            commands::script_commands::write_repo_script_stdin,
            commands::script_commands::resize_repo_script,
            commands::terminal_commands::spawn_terminal,
            commands::terminal_commands::spawn_session_terminal,
            commands::terminal_commands::list_terminal_profiles,
            commands::terminal_commands::get_session_terminal_status,
            commands::terminal_commands::capture_session_terminal,
            commands::terminal_commands::stop_terminal,
            commands::terminal_commands::stop_session_terminal,
            commands::terminal_commands::write_terminal_stdin,
            commands::terminal_commands::write_session_terminal_stdin,
            commands::terminal_commands::resize_terminal,
            commands::terminal_commands::resize_session_terminal,
            commands::browser_commands::list_workspace_browser_tabs,
            commands::browser_commands::create_browser_tab,
            commands::browser_commands::select_browser_tab,
            commands::browser_commands::navigate_browser_tab,
            commands::browser_commands::update_browser_tab_title,
            commands::browser_commands::close_browser_tab,
            commands::browser_commands::get_workspace_browser_profile,
            commands::browser_commands::get_browser_tab_profile,
            commands::browser_commands::create_browser_webview,
            commands::browser_commands::browser_go_back,
            commands::browser_commands::browser_go_forward,
            commands::browser_commands::open_browser_devtools,
            commands::debug_ingest_commands::ensure_debug_ingest_server,
            commands::debug_ingest_commands::get_debug_ingest_overview,
            commands::debug_ingest_commands::stop_debug_ingest_server,
            commands::debug_ingest_commands::read_debug_ingest_entries,
            commands::debug_ingest_commands::clear_debug_ingest_entries,
            commands::debug_ingest_commands::subscribe_debug_ingest,
            commands::browser_commands::browser_snapshot,
            commands::browser_commands::browser_screenshot,
            commands::browser_commands::browser_click,
            commands::browser_commands::browser_type,
            commands::browser_commands::browser_key,
            commands::browser_commands::browser_scroll,
            commands::session_commands::list_session_thread_messages,
            commands::workspace_commands::list_workspace_groups,
            commands::session_commands::list_workspace_sessions,
            commands::session_commands::search_sessions,
            commands::session_commands::create_session,
            commands::session_commands::rename_session,
            commands::session_commands::hide_session,
            commands::session_commands::unhide_session,
            commands::session_commands::delete_session,
            commands::session_commands::list_hidden_sessions,
            commands::session_commands::get_session_context_usage,
            commands::session_commands::get_live_context_usage,
            commands::agent_commands::delegate_agent,
            commands::agent_commands::list_session_delegations,
            commands::session_commands::mark_session_read,
            commands::session_commands::mark_session_unread,
            commands::session_commands::update_session_control,
            commands::workspace_commands::list_remote_branches,
            commands::workspace_commands::rename_workspace_branch,
            commands::workspace_commands::update_intended_target_branch,
            commands::workspace_commands::prefetch_remote_refs,
            commands::workspace_commands::push_workspace_to_remote,
            commands::workspace_commands::continue_workspace_from_target_branch,
            commands::workspace_commands::sync_workspace_with_target_branch,
            commands::workspace_commands::mark_workspace_unread,
            commands::workspace_commands::pin_workspace,
            commands::workspace_commands::unpin_workspace,
            commands::editor_commands::list_editor_files,
            commands::editor_commands::list_editor_files_with_content,
            commands::editor_commands::list_workspace_files,
            commands::editor_commands::list_workspace_changes,
            commands::editor_commands::list_workspace_changes_with_content,
            commands::editor_commands::discard_workspace_file,
            commands::editor_commands::stage_workspace_file,
            commands::editor_commands::unstage_workspace_file,
            commands::editor_commands::get_workspace_git_action_status,
            commands::system_commands::drain_pending_cli_sends,
            commands::system_commands::ack_pending_cli_send_started,
            commands::editor_commands::read_editor_file,
            commands::editor_commands::read_file_at_ref,
            commands::editor_commands::get_file_unified_diff,
            commands::workspace_commands::set_workspace_status,
            commands::workspace_commands::list_workspace_linked_directories,
            commands::workspace_commands::set_workspace_linked_directories,
            commands::workspace_commands::export_workspace_directories_to_codex,
            commands::workspace_commands::list_workspace_candidate_directories,
            commands::workspace_commands::trigger_workspace_fetch,
            commands::editors::detect_installed_editors,
            commands::editors::open_workspace_in_editor,
            commands::editors::open_workspace_in_finder,
            commands::workspace_commands::permanently_delete_workspace,
            commands::workspace_commands::restore_workspace,
            commands::editor_commands::stat_editor_file,
            commands::conductor_commands::conductor_source_available,
            commands::conductor_commands::list_conductor_repos,
            commands::conductor_commands::list_conductor_workspaces,
            commands::conductor_commands::import_conductor_workspaces,
            commands::system_commands::save_pasted_image,
            commands::system_commands::show_image_in_finder,
            commands::system_commands::copy_image_to_clipboard,
            commands::system_commands::request_quit,
            commands::system_commands::restart_app,
            commands::app_install_commands::get_helmor_app_update_status,
            commands::app_install_commands::run_helmor_app_install,
            commands::app_install_commands::cancel_helmor_app_install,
            commands::system_commands::dev_reset_all_data,
            commands::settings_commands::update_app_settings,
            commands::session_commands::update_session_settings,
            commands::settings_commands::load_auto_close_action_kinds,
            commands::settings_commands::save_auto_close_action_kinds,
            commands::settings_commands::load_auto_close_opt_in_asked,
            commands::settings_commands::save_auto_close_opt_in_asked,
            global_hotkey::sync_global_hotkey,
            ui_sync::subscribe_ui_mutations,
            commands::editor_commands::write_editor_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Every user-initiated app-exit path is intercepted here and routed
    // through a single `helmor://quit-requested` event. The frontend's
    // QuitConfirmDialog listens for that event, checks for in-flight
    // tasks, and calls back into the `request_quit` IPC command — which
    // cleans up (stops git watchers, SIGTERM's the sidecar) and then
    // invokes `app.exit(0)`.
    //
    //   Source                                  | Rust branch
    //   ----------------------------------------|-------------------------
    //   Red close button / Cmd+W (main window)  | WindowEvent::CloseRequested
    //   Cmd+Q, app-menu Quit (macOS)            | on_menu_event helmor-quit
    //   Dock Quit / system shutdown / SIGINT    | RunEvent::ExitRequested { code: None }
    //   Our own request_quit -> app.exit(0)     | ExitRequested { code: Some(_) }  (passthrough)
    //
    // Note: the `ExitRequested { code: None }` branch is a pure safety
    // net for non-frontend-driven exits. The custom macOS menu above
    // means Cmd+Q never actually takes this path; it exists so a
    // Dock-menu Quit or unexpected OS-level exit can't slip through
    // without confirmation on macOS.
    app.run(|app_handle, event| match event {
        tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" => {
            api.prevent_close();
            emit_quit_requested(app_handle);
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } => {
            api.prevent_exit();
            emit_quit_requested(app_handle);
        }
        _ => {}
    });
}

fn install_runtime_telemetry() {
    default_env("RUST_BACKTRACE", "full");
    default_env("RUST_LIB_BACKTRACE", "1");
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
            .unwrap_or("non-string panic payload");
        let location = info
            .location()
            .map(|location| {
                format!(
                    "{}:{}:{}",
                    location.file(),
                    location.line(),
                    location.column()
                )
            })
            .unwrap_or_else(|| "unknown".to_string());
        let backtrace = Backtrace::force_capture();
        tracing::error!(
            panic.message = payload,
            panic.location = location,
            panic.backtrace = %backtrace,
            "Rust panic captured"
        );
        default_hook(info);
    }));
}

fn install_rustls_crypto_provider() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}

fn default_env(key: &str, value: &str) {
    if std::env::var_os(key).is_none() {
        std::env::set_var(key, value);
    }
}

fn log_runtime_telemetry() {
    tracing::info!(
        rust_backtrace = %std::env::var("RUST_BACKTRACE").unwrap_or_else(|_| "<unset>".to_string()),
        rust_lib_backtrace = %std::env::var("RUST_LIB_BACKTRACE").unwrap_or_else(|_| "<unset>".to_string()),
        build_mode = data_dir::build_mode_label(),
        data_mode = data_dir::data_mode_label(),
        "Runtime crash telemetry configured"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rustls_crypto_provider_install_is_idempotent() {
        install_rustls_crypto_provider();
        install_rustls_crypto_provider();
    }
}

#[cfg(debug_assertions)]
fn resolve_mcp_base_port() -> u16 {
    std::env::var("HELMOR_MCP_BASE_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(9223)
}

// Route a user-initiated exit through the frontend quit-confirm flow.
// If the emit fails the webview is almost certainly gone, so falling
// back to a direct exit is safer than leaving the process hanging with
// no UI and no way to quit.
fn emit_quit_requested(app_handle: &tauri::AppHandle) {
    if let Err(e) = app_handle.emit("helmor://quit-requested", ()) {
        tracing::warn!(
            error = %e,
            "Failed to emit quit-requested event; exiting directly",
        );
        app_handle.exit(0);
    }
}

#[cfg(target_os = "macos")]
const HELMOR_QUIT_MENU_ID: &str = "helmor-quit";
#[cfg(target_os = "macos")]
const HELMOR_CLOSE_CURRENT_SESSION_MENU_ID: &str = "helmor-close-current-session";

#[cfg(target_os = "macos")]
fn install_macos_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let close_current_session_item = MenuItemBuilder::with_id(
        HELMOR_CLOSE_CURRENT_SESSION_MENU_ID,
        "Close Current Session",
    )
    .accelerator("Cmd+W")
    .build(app)?;

    let quit_item = MenuItemBuilder::with_id(HELMOR_QUIT_MENU_ID, "Quit Helmor")
        .accelerator("Cmd+Q")
        .build(app)?;

    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("Helmor"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .build();

    let app_submenu = SubmenuBuilder::new(app, "Helmor")
        .about(Some(about_metadata))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit_item)
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&close_current_session_item)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_submenu, &edit_submenu, &window_submenu])
        .build()?;

    app.set_menu(menu)?;

    let handle = app.clone();
    app.on_menu_event(move |_, event| match event.id().0.as_str() {
        HELMOR_QUIT_MENU_ID => emit_quit_requested(&handle),
        HELMOR_CLOSE_CURRENT_SESSION_MENU_ID => emit_close_current_session_requested(&handle),
        _ => {}
    });

    Ok(())
}

#[cfg(target_os = "macos")]
fn emit_close_current_session_requested(app_handle: &tauri::AppHandle) {
    if let Err(e) = app_handle.emit("helmor://close-current-session", ()) {
        tracing::warn!(error = %e, "Failed to emit close-current-session event");
    }
}
