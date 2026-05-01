use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelOption {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub cli_model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_key: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effort_levels: Vec<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub supports_fast_mode: bool,
    pub supports_context_usage: bool,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentModelSectionStatus {
    Ready,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelSection {
    pub id: String,
    pub label: String,
    pub status: AgentModelSectionStatus,
    pub options: Vec<AgentModelOption>,
}

pub fn static_model_sections() -> Vec<AgentModelSection> {
    let mut sections = model_sections_for_custom(super::custom_providers::configured_models());
    sections.push(capy_section());
    sections
}

fn model_sections_for_custom(
    custom: Vec<super::custom_providers::ClaudeProviderModel>,
) -> Vec<AgentModelSection> {
    let mut claude_section = official_claude_section();
    claude_section
        .options
        .extend(custom_provider_options(custom));
    let mut sections = vec![claude_section];
    sections.push(codex_section());

    sections
}

fn official_claude_section() -> AgentModelSection {
    AgentModelSection {
        id: "claude".to_string(),
        label: "Claude Code".to_string(),
        status: AgentModelSectionStatus::Ready,
        options: vec![
            claude_model(
                "default",
                "Opus 4.7 1M",
                &["low", "medium", "high", "xhigh", "max"],
                false,
            ),
            claude_model(
                "claude-opus-4-6[1m]",
                "Opus 4.6 1M",
                &["low", "medium", "high", "max"],
                true,
            ),
            claude_model("sonnet", "Sonnet", &["low", "medium", "high", "max"], false),
            claude_model("haiku", "Haiku", &[], false),
        ],
    }
}

fn codex_section() -> AgentModelSection {
    AgentModelSection {
        id: "codex".to_string(),
        label: "Codex".to_string(),
        status: AgentModelSectionStatus::Ready,
        options: vec![
            codex_model("gpt-5.5", "GPT-5.5"),
            codex_model("gpt-5.4", "GPT-5.4"),
            codex_model("gpt-5.4-mini", "GPT-5.4-Mini"),
            codex_model("gpt-5.3-codex", "GPT-5.3-Codex"),
            codex_model("gpt-5.3-codex-spark", "GPT-5.3-Codex-Spark"),
            codex_model("gpt-5.2", "GPT-5.2"),
        ],
    }
}

fn custom_provider_options(
    custom: Vec<super::custom_providers::ClaudeProviderModel>,
) -> Vec<AgentModelOption> {
    custom
        .into_iter()
        .map(|model| AgentModelOption {
            id: model.id,
            provider: "claude".to_string(),
            label: model.label,
            cli_model: model.cli_model,
            provider_key: Some(model.provider_key),
            effort_levels: claude_effort_levels(),
            supports_fast_mode: false,
            supports_context_usage: false,
        })
        .collect()
}

fn claude_model(
    id: &str,
    label: &str,
    effort_levels: &[&str],
    supports_fast_mode: bool,
) -> AgentModelOption {
    AgentModelOption {
        id: id.to_string(),
        provider: "claude".to_string(),
        label: label.to_string(),
        cli_model: id.to_string(),
        provider_key: None,
        effort_levels: effort_levels
            .iter()
            .map(|level| level.to_string())
            .collect(),
        supports_fast_mode,
        supports_context_usage: true,
    }
}

fn codex_model(id: &str, label: &str) -> AgentModelOption {
    AgentModelOption {
        id: id.to_string(),
        provider: "codex".to_string(),
        label: label.to_string(),
        cli_model: id.to_string(),
        provider_key: None,
        effort_levels: ["low", "medium", "high", "xhigh"]
            .into_iter()
            .map(str::to_string)
            .collect(),
        supports_fast_mode: true,
        supports_context_usage: true,
    }
}

fn claude_effort_levels() -> Vec<String> {
    ["low", "medium", "high", "xhigh", "max"]
        .into_iter()
        .map(str::to_string)
        .collect()
}

fn capy_section() -> AgentModelSection {
    // Mark Unavailable when the API key is not yet configured so the
    // frontend can show a greyed-out section with a helpful prompt.
    let has_key = crate::settings::load_setting_value("capy.api_key")
        .ok()
        .flatten()
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);

    AgentModelSection {
        id: "capy".to_string(),
        label: "Capy".to_string(),
        status: if has_key {
            AgentModelSectionStatus::Ready
        } else {
            AgentModelSectionStatus::Unavailable
        },
        options: vec![
            capy_model("capy/auto", "Auto", "auto"),
            capy_model("capy/claude-opus-4-7", "Claude Opus 4.7", "claude-opus-4-7"),
            capy_model(
                "capy/claude-sonnet-4-6",
                "Claude Sonnet 4.6",
                "claude-sonnet-4-6",
            ),
            capy_model("capy/gpt-5.5", "GPT-5.5", "gpt-5.5"),
            capy_model(
                "capy/gemini-3.1-pro-preview",
                "Gemini 3.1 Pro",
                "gemini-3.1-pro-preview",
            ),
        ],
    }
}

fn capy_model(id: &str, label: &str, cli_model: &str) -> AgentModelOption {
    AgentModelOption {
        id: id.to_string(),
        provider: "capy".to_string(),
        label: label.to_string(),
        cli_model: cli_model.to_string(),
        provider_key: None,
        effort_levels: vec![],
        supports_fast_mode: false,
        supports_context_usage: false,
    }
}

/// Resolved model info needed by the streaming path.
#[derive(Debug, Clone)]
pub struct ResolvedModel {
    pub id: String,
    pub provider: String,
    pub cli_model: String,
    pub supports_effort: bool,
    pub claude_base_url: Option<String>,
    pub claude_auth_token: Option<String>,
}

/// Resolve a model ID to provider + cli_model. Provider is inferred from the
/// ID: `capy/*` → capy, `gpt-*` → codex, everything else → claude. The ID
/// is passed through as cli_model directly — the sidecar handles the actual
/// mapping to the Capy/OpenAI/Anthropic API.
pub fn resolve_model(model_id: &str) -> ResolvedModel {
    if let Some(model) = super::custom_providers::resolve(model_id) {
        return ResolvedModel {
            id: model.id,
            provider: "claude".to_string(),
            cli_model: model.cli_model,
            supports_effort: true,
            claude_base_url: Some(model.base_url),
            claude_auth_token: Some(model.api_key),
        };
    }

    if let Some(capy_model) = model_id.strip_prefix("capy/") {
        return ResolvedModel {
            id: model_id.to_string(),
            provider: "capy".to_string(),
            cli_model: capy_model.to_string(),
            supports_effort: false,
            claude_base_url: None,
            claude_auth_token: None,
        };
    }

    let provider = if model_id.starts_with("gpt-") {
        "codex"
    } else {
        "claude"
    };
    ResolvedModel {
        id: model_id.to_string(),
        provider: provider.to_string(),
        cli_model: model_id.to_string(),
        supports_effort: true,
        claude_base_url: None,
        claude_auth_token: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_model_sections_returns_hardcoded_catalog() {
        let sections = model_sections_for_custom(Vec::new());

        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].id, "claude");
        assert_eq!(sections[0].status, AgentModelSectionStatus::Ready);
        assert_eq!(
            sections[0]
                .options
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec!["default", "claude-opus-4-6[1m]", "sonnet", "haiku"]
        );
        assert!(sections[0]
            .options
            .iter()
            .any(|model| model.id == "claude-opus-4-6[1m]" && model.supports_fast_mode));

        assert_eq!(sections[1].id, "codex");
        assert_eq!(sections[1].status, AgentModelSectionStatus::Ready);
        assert_eq!(
            sections[1]
                .options
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "gpt-5.5",
                "gpt-5.4",
                "gpt-5.4-mini",
                "gpt-5.3-codex",
                "gpt-5.3-codex-spark",
                "gpt-5.2",
            ]
        );
        assert!(sections[1]
            .options
            .iter()
            .all(|model| model.supports_fast_mode));
    }

    #[test]
    fn custom_provider_models_append_to_official_claude_section() {
        let sections =
            model_sections_for_custom(vec![super::super::custom_providers::ClaudeProviderModel {
                id: "claude-custom|minimax|MiniMax-M2.7".to_string(),
                provider_key: "minimax".to_string(),
                label: "MiniMax M2.7".to_string(),
                cli_model: "MiniMax-M2.7".to_string(),
                base_url: "https://api.minimax.io/anthropic".to_string(),
                api_key: "sk-test".to_string(),
            }]);

        assert_eq!(sections.len(), 2);
        assert_eq!(sections[0].id, "claude");
        assert_eq!(sections[0].label, "Claude Code");
        assert_eq!(
            sections[0]
                .options
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "default",
                "claude-opus-4-6[1m]",
                "sonnet",
                "haiku",
                "claude-custom|minimax|MiniMax-M2.7",
            ]
        );
        assert_eq!(
            sections[0].options[4].provider_key.as_deref(),
            Some("minimax")
        );
        assert_eq!(
            sections[0].options[4].effort_levels,
            vec!["low", "medium", "high", "xhigh", "max"]
        );
        assert!(!sections[0].options[4].supports_context_usage);
        assert_eq!(sections[1].id, "codex");
    }

    #[test]
    fn resolve_claude_model() {
        let m = resolve_model("default");
        assert_eq!(m.provider, "claude");
        assert_eq!(m.cli_model, "default");
        assert_eq!(m.id, "default");
        assert!(m.supports_effort);
    }

    #[test]
    fn resolve_opus_model() {
        let m = resolve_model("opus");
        assert_eq!(m.provider, "claude");
        assert_eq!(m.cli_model, "opus");
    }

    #[test]
    fn resolve_sonnet_model() {
        let m = resolve_model("sonnet");
        assert_eq!(m.provider, "claude");
    }

    #[test]
    fn resolve_gpt_model_routes_to_codex() {
        let m = resolve_model("gpt-4o");
        assert_eq!(m.provider, "codex");
        assert_eq!(m.cli_model, "gpt-4o");
    }

    #[test]
    fn resolve_gpt_5_4_routes_to_codex() {
        let m = resolve_model("gpt-5.4");
        assert_eq!(m.provider, "codex");
    }

    #[test]
    fn resolve_unknown_model_defaults_to_claude() {
        let m = resolve_model("some-future-model");
        assert_eq!(m.provider, "claude");
        assert_eq!(m.cli_model, "some-future-model");
    }
}
