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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_profile: Option<String>,
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
    model_sections_for_custom(
        super::custom_providers::configured_models(),
        super::codex_profiles::configured_models(),
    )
}

fn model_sections_for_custom(
    custom: Vec<super::custom_providers::ClaudeProviderModel>,
    codex_profiles: Vec<super::codex_profiles::CodexProfileModel>,
) -> Vec<AgentModelSection> {
    let mut claude_section = official_claude_section();
    claude_section
        .options
        .extend(custom_provider_options(custom));
    let mut sections = vec![claude_section];
    sections.push(codex_section(codex_profiles));
    sections.push(cursor_section());
    sections.push(pi_section());

    sections
}

fn official_claude_section() -> AgentModelSection {
    AgentModelSection {
        id: "claude".to_string(),
        label: "Claude Code".to_string(),
        status: AgentModelSectionStatus::Ready,
        options: vec![
            // Keep this list scoped to Anthropic Claude Code models. Pi has its
            // own provider section, so do not use Pi entries to stand in for
            // Claude Code variants like non-1M Opus.
            claude_model(
                "default",
                "Opus 4.8 1M",
                &["low", "medium", "high", "xhigh", "max"],
                false,
            ),
            claude_model(
                "claude-opus-4-8",
                "Opus 4.8",
                &["low", "medium", "high", "max"],
                false,
            ),
            claude_model(
                "claude-opus-4-8[1m]",
                "Opus 4.8 1M",
                &["low", "medium", "high", "max"],
                true,
            ),
            claude_model(
                "claude-sonnet-4-6",
                "Sonnet 4.6",
                &["low", "medium", "high", "max"],
                false,
            ),
            claude_model("claude-haiku-4-5", "Haiku 4.5", &[], false),
        ],
    }
}

fn codex_section(profiles: Vec<super::codex_profiles::CodexProfileModel>) -> AgentModelSection {
    let mut options = vec![
        codex_model("gpt-5.5", "GPT-5.5"),
        codex_model("gpt-5.4", "GPT-5.4"),
        codex_model("gpt-5.4-mini", "GPT-5.4-Mini"),
        codex_model("gpt-5.3-codex", "GPT-5.3-Codex"),
        codex_model("gpt-5.3-codex-spark", "GPT-5.3-Codex-Spark"),
        codex_model("gpt-5.2", "GPT-5.2"),
    ];
    options.extend(codex_profile_options(profiles));
    AgentModelSection {
        id: "codex".to_string(),
        label: "Codex".to_string(),
        status: AgentModelSectionStatus::Ready,
        options,
    }
}

fn cursor_section() -> AgentModelSection {
    AgentModelSection {
        id: "cursor".to_string(),
        label: "Cursor".to_string(),
        status: AgentModelSectionStatus::Ready,
        options: vec![
            cursor_model("cursor:composer-2.5", "Composer 2.5", "composer-2.5"),
            cursor_model(
                "cursor:composer-latest",
                "Composer Latest",
                "composer-latest",
            ),
        ],
    }
}

fn pi_section() -> AgentModelSection {
    AgentModelSection {
        id: "pi".to_string(),
        label: "Pi".to_string(),
        status: AgentModelSectionStatus::Ready,
        options: vec![
            pi_model(
                "pi:anthropic/claude-opus-4-8",
                "Pi · Claude Opus 4.8",
                "anthropic/claude-opus-4-8",
                &pi_effort_levels(true),
            ),
            pi_model(
                "pi:anthropic/claude-sonnet-4-6",
                "Pi · Claude Sonnet 4.6",
                "anthropic/claude-sonnet-4-6",
                &pi_effort_levels(false),
            ),
            pi_model(
                "pi:azure-openai-responses/gpt-5.5",
                "Pi · GPT-5.5",
                "azure-openai-responses/gpt-5.5",
                &pi_effort_levels(true),
            ),
            pi_model(
                "pi:azure-openai-responses/gpt-5.4",
                "Pi · GPT-5.4",
                "azure-openai-responses/gpt-5.4",
                &pi_effort_levels(true),
            ),
            pi_model(
                "pi:azure-openai-responses/gpt-5.4-mini",
                "Pi · GPT-5.4-Mini",
                "azure-openai-responses/gpt-5.4-mini",
                &pi_effort_levels(true),
            ),
            pi_model(
                "pi:azure-openai-responses/gpt-5.3-codex",
                "Pi · GPT-5.3-Codex",
                "azure-openai-responses/gpt-5.3-codex",
                &pi_effort_levels(true),
            ),
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
            codex_profile: None,
        })
        .collect()
}

fn codex_profile_options(
    profiles: Vec<super::codex_profiles::CodexProfileModel>,
) -> Vec<AgentModelOption> {
    profiles
        .into_iter()
        .map(|profile| {
            let label_prefix = super::codex_profiles::provider_label(&profile.model_provider);
            AgentModelOption {
                id: super::codex_profiles::model_id(&profile.profile, &profile.model),
                provider: "codex".to_string(),
                label: format!("{label_prefix} · {}", profile.model),
                cli_model: profile.model,
                provider_key: Some(profile.profile.clone()),
                effort_levels: ["low", "medium", "high", "xhigh"]
                    .into_iter()
                    .map(str::to_string)
                    .collect(),
                supports_fast_mode: true,
                supports_context_usage: true,
                codex_profile: Some(profile.profile),
            }
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
        codex_profile: None,
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
        codex_profile: None,
    }
}

fn cursor_model(id: &str, label: &str, cli_model: &str) -> AgentModelOption {
    AgentModelOption {
        id: id.to_string(),
        provider: "cursor".to_string(),
        label: label.to_string(),
        cli_model: cli_model.to_string(),
        provider_key: None,
        effort_levels: ["low", "medium", "high"]
            .into_iter()
            .map(str::to_string)
            .collect(),
        supports_fast_mode: false,
        supports_context_usage: false,
        codex_profile: None,
    }
}

fn pi_model(id: &str, label: &str, cli_model: &str, effort_levels: &[&str]) -> AgentModelOption {
    AgentModelOption {
        id: id.to_string(),
        provider: "pi".to_string(),
        label: label.to_string(),
        cli_model: cli_model.to_string(),
        provider_key: None,
        effort_levels: effort_levels
            .iter()
            .map(|level| (*level).to_string())
            .collect(),
        supports_fast_mode: false,
        supports_context_usage: false,
        codex_profile: None,
    }
}

fn pi_effort_levels(supports_xhigh: bool) -> Vec<&'static str> {
    if supports_xhigh {
        vec!["minimal", "low", "medium", "high", "xhigh"]
    } else {
        vec!["minimal", "low", "medium", "high"]
    }
}

fn claude_effort_levels() -> Vec<String> {
    ["low", "medium", "high", "xhigh", "max"]
        .into_iter()
        .map(str::to_string)
        .collect()
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
    pub codex_profile: Option<String>,
    pub codex_model_provider: Option<String>,
}

/// Resolve a model ID to provider + cli_model. Built-in and custom catalog
/// IDs are exact matches; unknown IDs keep the legacy `gpt-*` → Codex,
/// everything else → Claude fallback.
pub fn resolve_model(model_id: &str) -> ResolvedModel {
    if let Some(model) = legacy_pi_azure_model(model_id) {
        return model;
    }

    if let Some(option) = builtin_model_option(model_id) {
        return resolved_from_option(option);
    }

    if model_id.starts_with("claude-custom|") {
        if let Some(model) = super::custom_providers::resolve(model_id) {
            return ResolvedModel {
                id: model.id,
                provider: "claude".to_string(),
                cli_model: model.cli_model,
                supports_effort: true,
                claude_base_url: Some(model.base_url),
                claude_auth_token: Some(model.api_key),
                codex_profile: None,
                codex_model_provider: None,
            };
        }
    }

    if let Some(model) = dynamic_pi_model(model_id) {
        return model;
    }

    if let Some(model) = dynamic_cursor_model(model_id) {
        return model;
    }

    if let Some(model) = codex_profile_model(model_id) {
        return model;
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
        codex_profile: None,
        codex_model_provider: None,
    }
}

fn builtin_model_option(model_id: &str) -> Option<AgentModelOption> {
    official_claude_section()
        .options
        .into_iter()
        .chain(codex_section(Vec::new()).options)
        .chain(cursor_section().options)
        .chain(pi_section().options)
        .find(|option| option.id == model_id)
}

fn resolved_from_option(option: AgentModelOption) -> ResolvedModel {
    ResolvedModel {
        id: option.id,
        provider: option.provider,
        cli_model: option.cli_model,
        supports_effort: !option.effort_levels.is_empty(),
        claude_base_url: None,
        claude_auth_token: None,
        codex_profile: option.codex_profile,
        codex_model_provider: None,
    }
}

fn dynamic_pi_model(model_id: &str) -> Option<ResolvedModel> {
    let cli_model = model_id.strip_prefix("pi:")?;
    cli_model.contains('/').then(|| ResolvedModel {
        id: model_id.to_string(),
        provider: "pi".to_string(),
        cli_model: cli_model.to_string(),
        supports_effort: true,
        claude_base_url: None,
        claude_auth_token: None,
        codex_profile: None,
        codex_model_provider: None,
    })
}

fn dynamic_cursor_model(model_id: &str) -> Option<ResolvedModel> {
    let cli_model = model_id.strip_prefix("cursor:")?;
    (!cli_model.trim().is_empty()).then(|| ResolvedModel {
        id: model_id.to_string(),
        provider: "cursor".to_string(),
        cli_model: cli_model.to_string(),
        supports_effort: true,
        claude_base_url: None,
        claude_auth_token: None,
        codex_profile: None,
        codex_model_provider: None,
    })
}

fn legacy_pi_azure_model(model_id: &str) -> Option<ResolvedModel> {
    let model = model_id.strip_prefix("pi:openai-codex/")?;
    Some(ResolvedModel {
        id: format!("pi:azure-openai-responses/{model}"),
        provider: "pi".to_string(),
        cli_model: format!("azure-openai-responses/{model}"),
        supports_effort: true,
        claude_base_url: None,
        claude_auth_token: None,
        codex_profile: None,
        codex_model_provider: None,
    })
}

fn codex_profile_model(model_id: &str) -> Option<ResolvedModel> {
    let rest = model_id.strip_prefix("codex:")?;
    let (profile, model) = rest.split_once(':')?;
    if profile.trim().is_empty() || model.trim().is_empty() {
        return None;
    }
    let model_provider = super::codex_profiles::configured_models()
        .into_iter()
        .find(|entry| entry.profile == profile && entry.model == model)
        .map(|entry| entry.model_provider);

    Some(ResolvedModel {
        id: model_id.to_string(),
        provider: "codex".to_string(),
        cli_model: model.to_string(),
        supports_effort: true,
        claude_base_url: None,
        claude_auth_token: None,
        codex_profile: Some(profile.to_string()),
        codex_model_provider: model_provider,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_model_sections_returns_hardcoded_catalog() {
        let sections = model_sections_for_custom(Vec::new(), Vec::new());

        assert_eq!(sections.len(), 4);
        assert_eq!(sections[0].id, "claude");
        assert_eq!(sections[0].status, AgentModelSectionStatus::Ready);
        assert_eq!(
            sections[0]
                .options
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "default",
                "claude-opus-4-8",
                "claude-opus-4-8[1m]",
                "claude-sonnet-4-6",
                "claude-haiku-4-5"
            ]
        );
        assert!(sections[0]
            .options
            .iter()
            .any(|model| model.id == "claude-opus-4-8[1m]" && model.supports_fast_mode));

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

        assert_eq!(sections[2].id, "cursor");
        assert_eq!(sections[2].status, AgentModelSectionStatus::Ready);
        assert_eq!(
            sections[2]
                .options
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec!["cursor:composer-2.5", "cursor:composer-latest"]
        );

        assert_eq!(sections[3].id, "pi");
        assert_eq!(sections[3].status, AgentModelSectionStatus::Ready);
        assert!(sections[3]
            .options
            .iter()
            .all(|model| !model.supports_fast_mode));
        assert_eq!(
            sections[3]
                .options
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "pi:anthropic/claude-opus-4-8",
                "pi:anthropic/claude-sonnet-4-6",
                "pi:azure-openai-responses/gpt-5.5",
                "pi:azure-openai-responses/gpt-5.4",
                "pi:azure-openai-responses/gpt-5.4-mini",
                "pi:azure-openai-responses/gpt-5.3-codex",
            ]
        );
        assert_eq!(
            sections[3].options[1].effort_levels,
            vec!["minimal", "low", "medium", "high"]
        );
        assert_eq!(
            sections[3].options[2].effort_levels,
            vec!["minimal", "low", "medium", "high", "xhigh"]
        );
    }

    #[test]
    fn custom_provider_models_append_to_official_claude_section() {
        let sections = model_sections_for_custom(
            vec![super::super::custom_providers::ClaudeProviderModel {
                id: "claude-custom|minimax|MiniMax-M2.7".to_string(),
                provider_key: "minimax".to_string(),
                label: "MiniMax M2.7".to_string(),
                cli_model: "MiniMax-M2.7".to_string(),
                base_url: "https://api.minimax.io/anthropic".to_string(),
                api_key: "sk-test".to_string(),
            }],
            Vec::new(),
        );

        assert_eq!(sections.len(), 4);
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
                "claude-opus-4-8",
                "claude-opus-4-8[1m]",
                "claude-sonnet-4-6",
                "claude-haiku-4-5",
                "claude-custom|minimax|MiniMax-M2.7",
            ]
        );
        assert_eq!(
            sections[0].options[5].provider_key.as_deref(),
            Some("minimax")
        );
        assert_eq!(
            sections[0].options[5].effort_levels,
            vec!["low", "medium", "high", "xhigh", "max"]
        );
        assert!(!sections[0].options[5].supports_context_usage);
        assert_eq!(sections[1].id, "codex");
        assert_eq!(sections[2].id, "cursor");
        assert_eq!(sections[3].id, "pi");
    }

    #[test]
    fn codex_profile_models_append_to_codex_section() {
        let sections = model_sections_for_custom(
            Vec::new(),
            vec![super::super::codex_profiles::CodexProfileModel {
                profile: "azure".to_string(),
                model_provider: "azure".to_string(),
                model: "gpt-5-codex".to_string(),
            }],
        );

        let model = sections[1]
            .options
            .iter()
            .find(|model| model.id == "codex:azure:gpt-5-codex")
            .expect("azure codex profile model should be present");
        assert_eq!(model.provider, "codex");
        assert_eq!(model.label, "Azure · gpt-5-codex");
        assert_eq!(model.cli_model, "gpt-5-codex");
        assert_eq!(model.provider_key.as_deref(), Some("azure"));
        assert_eq!(model.codex_profile.as_deref(), Some("azure"));
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
    fn resolve_codex_profile_model_routes_to_codex_profile() {
        let m = resolve_model("codex:azure:gpt-5.5");
        assert_eq!(m.provider, "codex");
        assert_eq!(m.cli_model, "gpt-5.5");
        assert_eq!(m.id, "codex:azure:gpt-5.5");
        assert_eq!(m.codex_profile.as_deref(), Some("azure"));
    }

    #[test]
    fn resolve_pi_model_routes_to_pi() {
        let m = resolve_model("pi:azure-openai-responses/gpt-5.4");
        assert_eq!(m.provider, "pi");
        assert_eq!(m.cli_model, "azure-openai-responses/gpt-5.4");
        assert_eq!(m.id, "pi:azure-openai-responses/gpt-5.4");
    }

    #[test]
    fn resolve_cursor_model_routes_to_cursor() {
        let m = resolve_model("cursor:composer-2.5");
        assert_eq!(m.provider, "cursor");
        assert_eq!(m.cli_model, "composer-2.5");
        assert_eq!(m.id, "cursor:composer-2.5");
    }

    #[test]
    fn resolve_dynamic_pi_model_routes_to_pi() {
        let m = resolve_model("pi:custom-provider/custom-model");
        assert_eq!(m.provider, "pi");
        assert_eq!(m.cli_model, "custom-provider/custom-model");
        assert_eq!(m.id, "pi:custom-provider/custom-model");
    }

    #[test]
    fn resolve_legacy_pi_codex_model_routes_to_azure_pi() {
        let m = resolve_model("pi:openai-codex/gpt-5.5");
        assert_eq!(m.provider, "pi");
        assert_eq!(m.cli_model, "azure-openai-responses/gpt-5.5");
        assert_eq!(m.id, "pi:azure-openai-responses/gpt-5.5");
    }

    #[test]
    fn resolve_unknown_model_defaults_to_claude() {
        let m = resolve_model("some-future-model");
        assert_eq!(m.provider, "claude");
        assert_eq!(m.cli_model, "some-future-model");
    }
}
