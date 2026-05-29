use anyhow::Result;
use serde_json::{json, Value};

use crate::agents::{AgentModelOption, AgentModelSection};

const ALLOW_ALL_GOAL_ASSIGNEE_PI_MODELS_KEY: &str = "app.allow_all_goal_assignee_pi_models";
const LEGACY_OPENAI_CODEX_PREFIX: &str = "openai-codex/";
const AZURE_OPENAI_RESPONSES_PREFIX: &str = "azure-openai-responses/";

pub(super) fn handle_list_assignee_models() -> Result<Value> {
    let sections = crate::agents::fetch_agent_model_sections();
    let allow_all_models =
        crate::settings::load_setting_value(ALLOW_ALL_GOAL_ASSIGNEE_PI_MODELS_KEY)?
            .is_some_and(|value| value == "true");

    Ok(list_assignee_models_response(&sections, allow_all_models))
}

fn list_assignee_models_response(sections: &[AgentModelSection], allow_all_models: bool) -> Value {
    let pi_models = section_options(sections, "pi");
    let mut assignee_models = if allow_all_models {
        pi_models.to_vec()
    } else {
        pi_models
            .iter()
            .filter(|model| is_default_goal_assignee_pi_model_allowed(model, sections))
            .cloned()
            .collect()
    };
    assignee_models.sort_by_key(goal_assignee_model_rank);

    json!({
        "policy": if allow_all_models {
            "all-goal-assignee-pi-providers"
        } else {
            "available-claude-and-codex-backed-pi-models"
        },
        "assigneeModels": assignee_models,
        "claudeModels": section_options(sections, "claude"),
        "codexModels": section_options(sections, "codex"),
    })
}

fn section_options<'a>(
    sections: &'a [AgentModelSection],
    section_id: &str,
) -> &'a [AgentModelOption] {
    sections
        .iter()
        .find(|section| section.id == section_id)
        .map(|section| section.options.as_slice())
        .unwrap_or(&[])
}

fn is_default_goal_assignee_pi_model_allowed(
    model: &AgentModelOption,
    sections: &[AgentModelSection],
) -> bool {
    let provider_key = pi_model_provider_key(model);
    if !matches!(
        provider_key.as_str(),
        "anthropic" | "azure-openai-responses" | "openai-codex"
    ) {
        return false;
    }
    if sections.is_empty() {
        return true;
    }
    is_backed_by_available_claude_or_codex_model(model, sections)
}

fn is_backed_by_available_claude_or_codex_model(
    model: &AgentModelOption,
    sections: &[AgentModelSection],
) -> bool {
    let provider_key = pi_model_provider_key(model);
    let cli_model = strip_pi_prefix(&canonicalize_legacy_id(model_cli_or_id(model)));
    let bare_model_id = cli_model.rsplit('/').next().unwrap_or(cli_model.as_str());

    if provider_key == "azure-openai-responses"
        || provider_key == "openai-codex"
        || bare_model_id.starts_with("gpt-")
    {
        return section_has_model(sections, "codex", bare_model_id);
    }

    if provider_key == "anthropic" {
        return section_has_model(sections, "claude", bare_model_id);
    }

    false
}

fn section_has_model(sections: &[AgentModelSection], section_id: &str, target_model: &str) -> bool {
    let Some(section) = sections.iter().find(|entry| entry.id == section_id) else {
        return false;
    };
    section
        .options
        .iter()
        .any(|option| model_matches_provider_option(option, target_model))
}

fn model_matches_provider_option(option: &AgentModelOption, target_model: &str) -> bool {
    let normalized_target = normalize_provider_model_id(target_model);
    if normalized_target == "claude-opus-4-8" {
        return option.id == "default"
            || option.cli_model == "default"
            || normalize_provider_model_id(&option.label).contains("opus-4-8");
    }
    if normalized_target.starts_with("claude-sonnet-") {
        return option.id == "sonnet"
            || option.cli_model == "sonnet"
            || normalize_provider_model_id(&option.label).contains("sonnet");
    }
    if normalized_target.starts_with("claude-haiku-") {
        return option.id == "haiku"
            || option.cli_model == "haiku"
            || normalize_provider_model_id(&option.label).contains("haiku");
    }
    [&option.id, &option.cli_model, &option.label]
        .iter()
        .any(|value| normalize_provider_model_id(value) == normalized_target)
}

fn normalize_provider_model_id(value: &str) -> String {
    let mut normalized = String::new();
    let lower = value.trim().to_lowercase();
    let unprefixed = lower.strip_prefix("pi:").unwrap_or(&lower);
    let bare = unprefixed.rsplit('/').next().unwrap_or("");
    let mut in_brackets = false;
    let mut last_was_dash = false;

    for ch in bare.chars() {
        if ch == '[' {
            in_brackets = true;
            continue;
        }
        if ch == ']' {
            in_brackets = false;
            continue;
        }
        if in_brackets {
            continue;
        }
        if ch.is_ascii_alphanumeric() || ch == '.' {
            normalized.push(ch);
            last_was_dash = false;
        } else if !last_was_dash && !normalized.is_empty() {
            normalized.push('-');
            last_was_dash = true;
        }
    }

    normalized.trim_matches('-').to_string()
}

fn goal_assignee_model_rank(model: &AgentModelOption) -> usize {
    let cli_model = strip_pi_prefix(&canonicalize_legacy_id(model_cli_or_id(model)));
    let bare_model_id = cli_model.rsplit('/').next().unwrap_or(cli_model.as_str());

    if let Some(rank) = [
        "gpt-5.5",
        "gpt-5.4",
        "gpt-5.3-codex",
        "gpt-5.4-mini",
        "gpt-5.3-codex-spark",
        "gpt-5.2",
    ]
    .iter()
    .position(|id| *id == bare_model_id)
    {
        return rank;
    }

    if let Some(rank) = [
        "claude-opus-4-8",
        "claude-opus-4-7",
        "claude-opus-4-6",
        "claude-sonnet-4-6",
        "claude-haiku-4-5",
        "sonnet",
        "haiku",
    ]
    .iter()
    .position(|id| *id == bare_model_id)
    {
        return 100 + rank;
    }

    if pi_model_provider_key(model) == "anthropic" {
        return 150;
    }

    1_000
}

fn canonicalize_legacy_id(model_id: &str) -> String {
    let raw = model_id.trim();
    let unprefixed = strip_pi_prefix(raw);
    if let Some(model) = unprefixed.strip_prefix(LEGACY_OPENAI_CODEX_PREFIX) {
        return format!("pi:{AZURE_OPENAI_RESPONSES_PREFIX}{model}");
    }
    if raw.starts_with("pi:") {
        raw.to_string()
    } else {
        unprefixed.to_string()
    }
}

fn strip_pi_prefix(model_id: &str) -> String {
    model_id.strip_prefix("pi:").unwrap_or(model_id).to_string()
}

fn model_cli_or_id(model: &AgentModelOption) -> &str {
    if model.cli_model.is_empty() {
        &model.id
    } else {
        &model.cli_model
    }
}

fn pi_model_provider_key(model: &AgentModelOption) -> String {
    if let Some(provider_key) = model.provider_key.as_deref() {
        return provider_key.trim().to_string();
    }
    if let Some((provider, _)) = model.cli_model.split_once('/') {
        return provider.trim().to_string();
    }
    let unprefixed_id = strip_pi_prefix(&model.id);
    unprefixed_id
        .split_once('/')
        .map(|(provider, _)| provider)
        .unwrap_or("unknown")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::AgentModelSectionStatus;

    fn model(
        id: &str,
        provider: &str,
        label: &str,
        cli_model: &str,
        provider_key: Option<&str>,
    ) -> AgentModelOption {
        AgentModelOption {
            id: id.to_string(),
            provider: provider.to_string(),
            label: label.to_string(),
            cli_model: cli_model.to_string(),
            provider_key: provider_key.map(str::to_string),
            effort_levels: Vec::new(),
            supports_fast_mode: false,
            supports_context_usage: false,
            codex_profile: None,
        }
    }

    fn section(id: &str, options: Vec<AgentModelOption>) -> AgentModelSection {
        AgentModelSection {
            id: id.to_string(),
            label: id.to_string(),
            status: AgentModelSectionStatus::Ready,
            options,
        }
    }

    #[test]
    fn lists_default_assignee_models_using_latest_catalog_order() {
        let sections = vec![
            section(
                "claude",
                vec![
                    model(
                        "default",
                        "claude",
                        "Default · Opus 4.8 1M",
                        "default",
                        None,
                    ),
                    model(
                        "claude-sonnet-4-6",
                        "claude",
                        "Sonnet 4.6",
                        "claude-sonnet-4-6",
                        None,
                    ),
                    model(
                        "claude-haiku-4-5",
                        "claude",
                        "Haiku 4.5",
                        "claude-haiku-4-5",
                        None,
                    ),
                ],
            ),
            section(
                "codex",
                vec![model("gpt-5.5", "codex", "GPT-5.5", "gpt-5.5", None)],
            ),
            section(
                "pi",
                vec![
                    model(
                        "pi:anthropic/claude-sonnet-4-6",
                        "pi",
                        "Pi · Claude Sonnet 4.6",
                        "anthropic/claude-sonnet-4-6",
                        None,
                    ),
                    model(
                        "pi:anthropic/claude-haiku-4-5",
                        "pi",
                        "Pi · Claude Haiku 4.5",
                        "anthropic/claude-haiku-4-5",
                        None,
                    ),
                    model(
                        "pi:other/example-model",
                        "pi",
                        "Pi · Other",
                        "other/example-model",
                        None,
                    ),
                    model(
                        "pi:azure-openai-responses/gpt-5.5",
                        "pi",
                        "Pi · GPT-5.5",
                        "azure-openai-responses/gpt-5.5",
                        None,
                    ),
                ],
            ),
        ];

        let response = list_assignee_models_response(&sections, false);
        let ids = response["assigneeModels"]
            .as_array()
            .unwrap()
            .iter()
            .map(|model| model["id"].as_str().unwrap())
            .collect::<Vec<_>>();

        assert_eq!(
            ids,
            vec![
                "pi:azure-openai-responses/gpt-5.5",
                "pi:anthropic/claude-sonnet-4-6",
                "pi:anthropic/claude-haiku-4-5",
            ]
        );
        assert_eq!(
            response["policy"].as_str(),
            Some("available-claude-and-codex-backed-pi-models")
        );
    }

    #[test]
    fn allow_all_policy_returns_every_pi_model() {
        let sections = vec![section(
            "pi",
            vec![
                model("pi:other/a", "pi", "Other A", "other/a", None),
                model(
                    "pi:azure-openai-responses/gpt-5.5",
                    "pi",
                    "Pi · GPT-5.5",
                    "azure-openai-responses/gpt-5.5",
                    None,
                ),
            ],
        )];

        let response = list_assignee_models_response(&sections, true);

        assert_eq!(response["assigneeModels"].as_array().unwrap().len(), 2);
        assert_eq!(
            response["policy"].as_str(),
            Some("all-goal-assignee-pi-providers")
        );
    }
}
