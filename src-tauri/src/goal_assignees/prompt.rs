use anyhow::{bail, Result};

pub struct AssigneeBootstrapPromptInput<'a> {
    pub goal_title: Option<&'a str>,
    pub goal_description: Option<&'a str>,
    pub card_title: &'a str,
    pub card_description: Option<&'a str>,
    pub assigned_name: Option<&'a str>,
    pub workspace_id: &'a str,
    pub branch: &'a str,
    pub initial_task: &'a str,
}

pub(super) fn format_supervisor_update(message: &str, priority: Option<&str>) -> Result<String> {
    let trimmed = message.trim();
    if trimmed.is_empty() {
        bail!("Assignee message is required");
    }
    let priority = priority
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("normal");
    Ok(format!(
        "Supervisor update from Goals Pi (priority: {priority}):\n\n{trimmed}\n\nReport blockers and completion in this thread. End milestone reports with one explicit line: Status: progress, Status: blocked, Status: completed, or Status: handoff. Use Verification Notes for tests or checks that could not run but do not block the implementation. Reserve Blocked for work that cannot be completed without supervisor or user intervention. Do not assume Pi saw your work until you write a milestone report."
    ))
}

pub fn assignee_bootstrap_prompt(input: AssigneeBootstrapPromptInput<'_>) -> String {
    let mut sections = vec![
        "# Assignee Brief".to_string(),
        format!(
            "Assigned name: {}",
            input.assigned_name.unwrap_or("assignee")
        ),
        format!("Goal: {}", input.goal_title.unwrap_or("Untitled goal")),
    ];
    if let Some(description) = input.goal_description.and_then(non_empty) {
        sections.push(format!("Goal description: {description}"));
    }
    sections.push(format!("Card: {}", input.card_title));
    if let Some(description) = input.card_description.and_then(non_empty) {
        sections.push(format!("Card description: {description}"));
    }
    sections.push(format!("Workspace id: {}", input.workspace_id));
    sections.push(format!("Target branch/workspace: {}", input.branch));
    sections.push("".to_string());
    sections.push("## Initial task from Goals Pi".to_string());
    sections.push(input.initial_task.trim().to_string());
    sections.push("".to_string());
    sections.push("## Reporting expectations".to_string());
    sections.push("Report meaningful milestones in this thread. End milestone reports with one explicit line: Status: progress, Status: blocked, Status: completed, or Status: handoff.".to_string());
    sections.push("Use Verification Notes for tests or checks that could not run but do not block the implementation. Reserve Blocked for work that cannot be completed without supervisor or user intervention.".to_string());
    sections.push(
        "Do not assume Goals Pi saw your work until you write a milestone report.".to_string(),
    );
    sections.join("\n")
}

fn non_empty(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_supervisor_update_with_contract() {
        let message = format_supervisor_update("Use the new endpoint", Some("high")).unwrap();
        assert!(message.starts_with("Supervisor update from Goals Pi"));
        assert!(message.contains("priority: high"));
        assert!(message.contains("Status: progress"));
        assert!(message.contains("Verification Notes"));
    }
}
