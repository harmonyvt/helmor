use std::collections::BTreeMap;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use uuid::Uuid;

use super::catalog::{AgentModelOption, AgentModelSectionStatus};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiModelProviderSummary {
    pub key: String,
    pub label: String,
    pub model_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiModelCheckResponse {
    pub status: AgentModelSectionStatus,
    pub providers: Vec<PiModelProviderSummary>,
    pub models: Vec<AgentModelOption>,
    pub error: Option<String>,
}

const PI_MODELS_TIMEOUT: Duration = Duration::from_secs(15);

pub fn check(sidecar: &crate::sidecar::ManagedSidecar) -> PiModelCheckResponse {
    let request_id = Uuid::new_v4().to_string();
    let request = crate::sidecar::SidecarRequest {
        id: request_id.clone(),
        method: "listModels".to_string(),
        params: serde_json::json!({ "provider": "pi" }),
    };

    let rx = sidecar.subscribe(&request_id);
    if let Err(error) = sidecar.send(&request) {
        sidecar.unsubscribe(&request_id);
        return check_error(format!("Unable to ask Pi for models: {error:#}"));
    }

    let response = loop {
        match rx.recv_timeout(PI_MODELS_TIMEOUT) {
            Ok(event) => match event.event_type() {
                "modelsListed" => {
                    break parse_models_listed(&event.raw);
                }
                "error" => {
                    let message = event
                        .raw
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Unknown Pi model check error")
                        .to_string();
                    break check_error(message);
                }
                _ => {}
            },
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                break check_error(format!(
                    "Pi model check timed out after {}s.",
                    PI_MODELS_TIMEOUT.as_secs()
                ));
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                break check_error("Sidecar disconnected while checking Pi models.".to_string());
            }
        }
    };
    sidecar.unsubscribe(&request_id);
    response
}

fn parse_models_listed(raw: &Value) -> PiModelCheckResponse {
    let models: Vec<AgentModelOption> = raw
        .get("models")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(parse_model_option)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let providers = summarize_providers(&models);
    PiModelCheckResponse {
        status: AgentModelSectionStatus::Ready,
        providers,
        models,
        error: None,
    }
}

fn parse_model_option(raw: &Value) -> Option<AgentModelOption> {
    let id = raw.get("id")?.as_str()?.to_string();
    let cli_model = raw
        .get("cliModel")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| id.strip_prefix("pi:").map(str::to_string))?;
    let label = raw
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or(&id)
        .to_string();
    let provider_key = raw
        .get("providerKey")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| {
            cli_model
                .split_once('/')
                .map(|(provider, _)| provider.to_string())
        });
    let effort_levels = raw
        .get("effortLevels")
        .and_then(Value::as_array)
        .map(|levels| {
            levels
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let supports_fast_mode = raw
        .get("supportsFastMode")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    Some(AgentModelOption {
        id,
        provider: "pi".to_string(),
        label,
        cli_model,
        provider_key,
        effort_levels,
        supports_fast_mode,
        supports_context_usage: false,
    })
}

fn summarize_providers(models: &[AgentModelOption]) -> Vec<PiModelProviderSummary> {
    let mut counts = BTreeMap::<String, usize>::new();
    for model in models {
        let provider = model
            .provider_key
            .clone()
            .or_else(|| {
                model
                    .cli_model
                    .split_once('/')
                    .map(|(provider, _)| provider.to_string())
            })
            .unwrap_or_else(|| "unknown".to_string());
        *counts.entry(provider).or_default() += 1;
    }

    counts
        .into_iter()
        .map(|(key, model_count)| PiModelProviderSummary {
            label: provider_label(&key),
            key,
            model_count,
        })
        .collect()
}

fn provider_label(provider: &str) -> String {
    match provider {
        "anthropic" => "Anthropic".to_string(),
        "azure-openai-responses" => "Azure OpenAI Responses".to_string(),
        "openai-codex" => "OpenAI Codex".to_string(),
        "openai" => "OpenAI".to_string(),
        _ => provider.to_string(),
    }
}

fn check_error(message: String) -> PiModelCheckResponse {
    PiModelCheckResponse {
        status: AgentModelSectionStatus::Error,
        providers: Vec::new(),
        models: Vec::new(),
        error: Some(message),
    }
}
