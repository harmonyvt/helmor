use crate::{github_cli, github_graphql};

use super::common::{run_blocking, CmdResult};

#[tauri::command]
pub async fn get_github_cli_status() -> CmdResult<github_cli::GithubCliStatus> {
    run_blocking(github_cli::get_github_cli_status).await
}

#[tauri::command]
pub async fn get_github_cli_user() -> CmdResult<Option<github_cli::GithubCliUser>> {
    run_blocking(github_cli::get_github_cli_user).await
}

#[tauri::command]
pub async fn list_github_accessible_repositories(
) -> CmdResult<Vec<github_cli::GithubRepositorySummary>> {
    run_blocking(github_cli::list_github_accessible_repositories).await
}

#[tauri::command]
pub async fn list_github_pull_requests_for_repo(
    repo_id: String,
) -> CmdResult<Vec<github_graphql::GithubPullRequestSummary>> {
    run_blocking(move || github_graphql::list_repository_pull_requests(&repo_id)).await
}

#[tauri::command]
pub async fn resolve_github_pull_request_for_repo(
    repo_id: String,
    input: String,
) -> CmdResult<github_graphql::GithubPullRequestSummary> {
    run_blocking(move || github_graphql::resolve_repository_pull_request(&repo_id, &input)).await
}
