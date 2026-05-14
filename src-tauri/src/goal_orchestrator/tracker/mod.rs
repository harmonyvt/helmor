use anyhow::Result;

use crate::{models, workspace_status::WorkspaceStatus};

use super::types::{IssueState, OrchestratorIssue, TrackerKind};

pub mod external;

pub trait IssueTracker {
    fn fetch_issues(&self) -> Result<Vec<OrchestratorIssue>>;
}

#[derive(Debug, Clone)]
pub struct LocalGoalTracker {
    goal_workspace_id: String,
}

impl LocalGoalTracker {
    pub fn new(goal_workspace_id: String) -> Self {
        Self { goal_workspace_id }
    }
}

impl IssueTracker for LocalGoalTracker {
    fn fetch_issues(&self) -> Result<Vec<OrchestratorIssue>> {
        let cards = models::goals::list_goal_cards(&self.goal_workspace_id)?;
        let children =
            models::workspaces::load_goal_child_workspace_records(&self.goal_workspace_id)?;
        let mut issues = Vec::new();

        for card in cards {
            let mut labels = Vec::new();
            if let Some(provider) = card.assigned_provider.as_deref() {
                labels.push(format!("provider:{provider}"));
            }
            if let Some(model) = card.assigned_model_id.as_deref() {
                labels.push(format!("model:{model}"));
            }
            issues.push(OrchestratorIssue {
                id: format!("goal-card:{}", card.id),
                tracker: TrackerKind::Local,
                goal_workspace_id: card.goal_workspace_id,
                identifier: Some(format!("card-{}", card.sort_order + 1)),
                title: card.title,
                description: card.description,
                state: IssueState::from(card.lane),
                labels,
                blockers: Vec::new(),
                priority: 0 - card.sort_order,
                child_workspace_id: card.child_workspace_id,
                assigned_provider: card.assigned_provider,
                assigned_model_id: card.assigned_model_id,
                assigned_effort_level: card.assigned_effort_level,
                updated_at: Some(card.updated_at),
            });
        }

        let card_child_ids: std::collections::HashSet<String> = issues
            .iter()
            .filter_map(|issue| issue.child_workspace_id.clone())
            .collect();

        for child in children {
            if card_child_ids.contains(&child.id) {
                continue;
            }
            issues.push(OrchestratorIssue {
                id: format!("workspace:{}", child.id),
                tracker: TrackerKind::Local,
                goal_workspace_id: self.goal_workspace_id.clone(),
                identifier: Some(child.directory_name.clone()),
                title: child
                    .pr_title
                    .clone()
                    .or(child.primary_session_title.clone())
                    .unwrap_or_else(|| child.directory_name.clone()),
                description: None,
                state: IssueState::from(child.status),
                labels: workspace_labels(child.status),
                blockers: Vec::new(),
                priority: 0,
                child_workspace_id: Some(child.id),
                assigned_provider: child.primary_session_agent_type,
                assigned_model_id: None,
                assigned_effort_level: None,
                updated_at: Some(child.updated_at),
            });
        }

        issues.sort_by(|a, b| {
            b.priority
                .cmp(&a.priority)
                .then_with(|| a.identifier.cmp(&b.identifier))
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(issues)
    }
}

fn workspace_labels(status: WorkspaceStatus) -> Vec<String> {
    vec![format!("lane:{}", status.as_str())]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testkit::TestEnv;

    #[test]
    fn workspace_labels_include_lane() {
        assert_eq!(
            workspace_labels(WorkspaceStatus::Review),
            vec!["lane:review"]
        );
    }

    #[test]
    fn local_tracker_normalizes_cards_and_unlinked_child_workspaces() {
        let env = TestEnv::new("goal-orchestrator-local-tracker");
        let connection = env.db_connection();
        crate::testkit::insert_repo(&connection, "repo-1", "Repo", None);
        connection
            .execute(
                r#"
                INSERT INTO workspaces (
                  id, repository_id, directory_name, state, status, workspace_kind,
                  goal_workspace_id, active_session_id, pr_sync_state, unread
                ) VALUES
                  ('goal-1', 'repo-1', 'goal-one', 'ready', 'in-progress', 'goal',
                    NULL, NULL, 'open', 0),
                  ('child-1', 'repo-1', 'child-one', 'ready', 'review', 'code',
                    'goal-1', NULL, 'none', 0)
                "#,
                [],
            )
            .unwrap();
        connection
            .execute(
                r#"
                INSERT INTO goal_cards (
                  id, goal_workspace_id, title, description, lane, sort_order,
                  assigned_provider, assigned_model_id, assigned_effort_level,
                  child_workspace_id, created_at, updated_at
                ) VALUES (
                  'card-1', 'goal-1', 'Build API', 'Details', 'backlog', 0,
                  'codex', 'gpt-5.4', 'high', NULL, datetime('now'), datetime('now')
                )
                "#,
                [],
            )
            .unwrap();

        let issues = LocalGoalTracker::new("goal-1".to_string())
            .fetch_issues()
            .unwrap();

        assert_eq!(issues.len(), 2);
        assert!(issues.iter().any(|issue| {
            issue.id == "goal-card:card-1"
                && issue.title == "Build API"
                && issue.state == IssueState::Backlog
                && issue.labels.contains(&"provider:codex".to_string())
        }));
        assert!(issues.iter().any(|issue| {
            issue.id == "workspace:child-1"
                && issue.child_workspace_id.as_deref() == Some("child-1")
                && issue.state == IssueState::Review
        }));
    }
}
