use std::{env, fs, path::PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodexProfileModel {
    pub profile: String,
    pub model_provider: String,
    pub model: String,
}

pub fn configured_models() -> Vec<CodexProfileModel> {
    let Some(path) = config_path() else {
        return Vec::new();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    parse_configured_models(&raw)
}

fn config_path() -> Option<PathBuf> {
    if let Ok(path) = env::var("HELMOR_CODEX_CONFIG_PATH") {
        if !path.trim().is_empty() {
            return Some(PathBuf::from(path));
        }
    }
    env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex").join("config.toml"))
}

fn parse_configured_models(raw: &str) -> Vec<CodexProfileModel> {
    let Ok(value) = raw.parse::<toml::Value>() else {
        return Vec::new();
    };
    let Some(profiles) = value.get("profiles").and_then(toml::Value::as_table) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for (profile, value) in profiles {
        let Some(table) = value.as_table() else {
            continue;
        };
        let Some(model_provider) = table
            .get("model_provider")
            .and_then(toml::Value::as_str)
            .map(str::trim)
            .filter(|value| matches!(*value, "openai" | "azure"))
        else {
            continue;
        };
        let Some(model) = table
            .get("model")
            .and_then(toml::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        out.push(CodexProfileModel {
            profile: profile.to_string(),
            model_provider: model_provider.to_string(),
            model: model.to_string(),
        });
    }
    out.sort_by(|a, b| a.profile.cmp(&b.profile));
    out
}

pub fn model_id(profile: &str, model: &str) -> String {
    format!("codex:{profile}:{model}")
}

pub fn provider_label(model_provider: &str) -> &'static str {
    match model_provider {
        "azure" => "Azure",
        "openai" => "OpenAI",
        _ => "Codex",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_openai_and_azure_profiles() {
        let models = parse_configured_models(
            r#"
model = "gpt-5.5"
model_provider = "openai"

[profiles.openai]
model = "gpt-5.5"
model_provider = "openai"

[profiles.azure]
model = "gpt-5-codex"
model_provider = "azure"
model_reasoning_effort = "medium"

[profiles.claude]
model = "sonnet"
model_provider = "anthropic"
"#,
        );

        assert_eq!(
            models,
            vec![
                CodexProfileModel {
                    profile: "azure".to_string(),
                    model_provider: "azure".to_string(),
                    model: "gpt-5-codex".to_string(),
                },
                CodexProfileModel {
                    profile: "openai".to_string(),
                    model_provider: "openai".to_string(),
                    model: "gpt-5.5".to_string(),
                },
            ]
        );
    }
}
