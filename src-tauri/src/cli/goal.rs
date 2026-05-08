//! `helmor goal` — Goal workspace orchestration helpers.

use std::io::Read;

use anyhow::{Context, Result};

use crate::goal_orchestration::{
    create_goal_child_workspace_and_start, GoalChildWorkspaceCreateParams,
};
use crate::ui_sync::UiMutationEvent;
use crate::workspace_status::WorkspaceStatus;

use super::args::{Cli, GoalAction, GoalChildAction, WorkspaceStatusValue};
use super::{notify_ui_events, output};

pub fn dispatch(action: &GoalAction, cli: &Cli) -> Result<()> {
    match action {
        GoalAction::Child { action } => child(action, cli),
    }
}

fn child(action: &GoalChildAction, cli: &Cli) -> Result<()> {
    match action {
        GoalChildAction::Create {
            goal,
            title,
            description,
            lane,
            target_branch,
            provider,
            model,
            effort,
            permission_mode,
            plan,
            prompt,
            no_finalize,
        } => {
            let prompt = prompt
                .as_deref()
                .map(read_prompt)
                .transpose()
                .context("Failed to read prompt")?;
            let permission_mode = if *plan {
                Some("plan".to_string())
            } else {
                permission_mode.clone()
            };
            let params = GoalChildWorkspaceCreateParams {
                goal_workspace: goal.clone(),
                title: title.clone(),
                description: description.clone(),
                lane: lane.map(status_value_to_workspace_status),
                target_branch: target_branch.clone(),
                assigned_provider: provider.clone(),
                assigned_model_id: model.clone(),
                assigned_effort_level: effort.clone(),
                prompt,
                permission_mode,
                finalize: Some(!*no_finalize),
            };

            fn ignore_event(_: &crate::agents::AgentStreamEvent) {}
            let mut on_event = ignore_event;
            let result = create_goal_child_workspace_and_start(params, &mut on_event)?;
            notify_ui_events([
                UiMutationEvent::WorkspaceListChanged,
                UiMutationEvent::WorkspaceChanged {
                    workspace_id: result.workspace_id.clone(),
                },
            ]);
            if cli.quiet && !cli.json {
                println!("{}", result.workspace_id);
                return Ok(());
            }
            output::print(cli, &result, |r| {
                let start = if r.agent_started {
                    "started"
                } else if r.prompt_queued {
                    "queued"
                } else {
                    "not requested"
                };
                format!(
                    "Created goal child workspace: {}\nDirectory:                    {}\nBranch:                       {}\nSession:                      {}\nState:                        {:?}\nAgent:                        {}",
                    r.workspace_id,
                    r.directory.as_deref().unwrap_or(&r.directory_name),
                    r.branch,
                    r.session_id,
                    r.state,
                    start,
                )
            })
        }
    }
}

fn read_prompt(raw: &str) -> Result<String> {
    if raw == "-" {
        let mut buffer = String::new();
        std::io::stdin().read_to_string(&mut buffer)?;
        Ok(buffer)
    } else {
        Ok(raw.to_string())
    }
}

fn status_value_to_workspace_status(value: WorkspaceStatusValue) -> WorkspaceStatus {
    match value {
        WorkspaceStatusValue::Done => WorkspaceStatus::Done,
        WorkspaceStatusValue::Review => WorkspaceStatus::Review,
        WorkspaceStatusValue::Progress => WorkspaceStatus::InProgress,
        WorkspaceStatusValue::Backlog => WorkspaceStatus::Backlog,
        WorkspaceStatusValue::Canceled => WorkspaceStatus::Canceled,
    }
}
