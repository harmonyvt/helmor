use anyhow::Result;

use crate::{forge::gitlab, github_graphql};

use super::types::{ChangeRequestInfo, ForgeActionStatus, ForgeProvider, PrCommentData};

pub(crate) trait WorkspaceForgeBackend {
    fn lookup_change_request(&self, workspace_id: &str) -> Result<Option<ChangeRequestInfo>>;
    fn action_status(&self, workspace_id: &str) -> Result<ForgeActionStatus>;
    fn check_insert_text(&self, workspace_id: &str, item_id: &str) -> Result<String>;
    fn deployment_insert_text(&self, workspace_id: &str, item_id: &str) -> Result<String>;
    fn merge_change_request(&self, workspace_id: &str) -> Result<Option<ChangeRequestInfo>>;
    fn close_change_request(&self, workspace_id: &str) -> Result<Option<ChangeRequestInfo>>;
    fn pr_comments(&self, workspace_id: &str) -> Result<PrCommentData>;
    fn pr_comment_insert_text(&self, workspace_id: &str, comment_id: &str) -> Result<String>;
}

struct GithubBackend;
struct GitlabBackend;

impl WorkspaceForgeBackend for GithubBackend {
    fn lookup_change_request(&self, workspace_id: &str) -> Result<Option<ChangeRequestInfo>> {
        github_graphql::lookup_workspace_pr(workspace_id)
    }

    fn action_status(&self, workspace_id: &str) -> Result<ForgeActionStatus> {
        github_graphql::lookup_workspace_pr_action_status(workspace_id)
    }

    fn check_insert_text(&self, workspace_id: &str, item_id: &str) -> Result<String> {
        github_graphql::lookup_workspace_pr_check_insert_text(workspace_id, item_id)
    }

    fn deployment_insert_text(&self, workspace_id: &str, item_id: &str) -> Result<String> {
        github_graphql::lookup_workspace_forge_deployment_insert_text(workspace_id, item_id)
    }

    fn merge_change_request(&self, workspace_id: &str) -> Result<Option<ChangeRequestInfo>> {
        github_graphql::merge_workspace_pr(workspace_id)
    }

    fn close_change_request(&self, workspace_id: &str) -> Result<Option<ChangeRequestInfo>> {
        github_graphql::close_workspace_pr(workspace_id)
    }

    fn pr_comments(&self, workspace_id: &str) -> Result<PrCommentData> {
        github_graphql::lookup_workspace_pr_comments(workspace_id)
    }

    fn pr_comment_insert_text(&self, workspace_id: &str, comment_id: &str) -> Result<String> {
        github_graphql::lookup_workspace_pr_comment_insert_text(workspace_id, comment_id)
    }
}

impl WorkspaceForgeBackend for GitlabBackend {
    fn lookup_change_request(&self, workspace_id: &str) -> Result<Option<ChangeRequestInfo>> {
        gitlab::lookup_workspace_mr(workspace_id)
    }

    fn action_status(&self, workspace_id: &str) -> Result<ForgeActionStatus> {
        gitlab::lookup_workspace_mr_action_status(workspace_id)
    }

    fn check_insert_text(&self, workspace_id: &str, item_id: &str) -> Result<String> {
        gitlab::lookup_workspace_mr_check_insert_text(workspace_id, item_id)
    }

    fn deployment_insert_text(&self, _workspace_id: &str, _item_id: &str) -> Result<String> {
        // GitLab deployment insert text is not yet supported.
        Ok(String::new())
    }

    fn merge_change_request(&self, workspace_id: &str) -> Result<Option<ChangeRequestInfo>> {
        gitlab::merge_workspace_mr(workspace_id)
    }

    fn close_change_request(&self, workspace_id: &str) -> Result<Option<ChangeRequestInfo>> {
        gitlab::close_workspace_mr(workspace_id)
    }

    fn pr_comments(&self, _workspace_id: &str) -> Result<PrCommentData> {
        // GitLab MR discussions have a different shape and are out of scope.
        Ok(PrCommentData::default())
    }

    fn pr_comment_insert_text(&self, _workspace_id: &str, _comment_id: &str) -> Result<String> {
        Ok(String::new())
    }
}

static GITHUB_BACKEND: GithubBackend = GithubBackend;
static GITLAB_BACKEND: GitlabBackend = GitlabBackend;

pub(crate) fn backend_for(provider: ForgeProvider) -> Option<&'static dyn WorkspaceForgeBackend> {
    match provider {
        ForgeProvider::Github => Some(&GITHUB_BACKEND),
        ForgeProvider::Gitlab => Some(&GITLAB_BACKEND),
        ForgeProvider::Unknown => None,
    }
}
