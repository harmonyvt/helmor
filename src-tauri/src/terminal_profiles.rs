use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProfile {
    pub id: String,
    pub label: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: Vec<TerminalProfileEnv>,
    pub tmux_backed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProfileEnv {
    pub key: String,
    pub value: String,
}

impl TerminalProfile {
    pub fn command_line(&self) -> Option<String> {
        let command = self.command.as_ref()?;
        let mut parts = Vec::with_capacity(self.env.len() + self.args.len() + 1);
        parts.extend(
            self.env
                .iter()
                .map(|entry| format!("{}={}", entry.key, shell_quote(&entry.value))),
        );
        parts.push(shell_quote(command));
        parts.extend(self.args.iter().map(|arg| shell_quote(arg)));
        Some(parts.join(" "))
    }
}

pub fn list_terminal_profiles() -> Vec<TerminalProfile> {
    ["shell", "claude", "codex", "opencode", "pi"]
        .into_iter()
        .map(resolve_terminal_profile)
        .collect()
}

pub fn resolve_terminal_profile(runtime: &str) -> TerminalProfile {
    let runtime = runtime.trim();
    let normalized = normalize_runtime(runtime);
    match normalized.as_str() {
        "" | "shell" => profile("shell", "Shell", None, &[], &[]),
        "claude" => profile(
            "claude",
            "Claude",
            Some("claude"),
            &["--permission-mode", "bypassPermissions"],
            &[],
        ),
        "codex" | "openai" | "openaicodex" => profile(
            "codex",
            "Codex",
            Some("codex"),
            &[
                "--no-alt-screen",
                "--dangerously-bypass-approvals-and-sandbox",
            ],
            &[],
        ),
        "opencode" => profile(
            "opencode",
            "OpenCode",
            Some("opencode"),
            &[],
            &[
                ("OPENCODE_CONFIG_CONTENT", r#"{"permission":"allow"}"#),
                ("OPENCODE_YOLO", "true"),
                ("OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS", "true"),
            ],
        ),
        "pi" => profile("pi", "Pi", Some("pi"), &[], &[]),
        _ => profile(runtime, runtime, Some(runtime), &[], &[]),
    }
}

fn profile(
    id: &str,
    label: &str,
    command: Option<&str>,
    args: &[&str],
    env: &[(&str, &str)],
) -> TerminalProfile {
    TerminalProfile {
        id: id.to_string(),
        label: label.to_string(),
        command: command.map(str::to_string),
        args: args.iter().map(|arg| arg.to_string()).collect(),
        env: env
            .iter()
            .map(|(key, value)| TerminalProfileEnv {
                key: key.to_string(),
                value: value.to_string(),
            })
            .collect(),
        tmux_backed: true,
    }
}

fn normalize_runtime(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| !matches!(ch, ' ' | '_' | '-'))
        .collect()
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_builtin_profiles() {
        assert_eq!(resolve_terminal_profile("shell").command, None);
        assert_eq!(
            resolve_terminal_profile("openai-codex").command.as_deref(),
            Some("codex")
        );
        assert_eq!(
            resolve_terminal_profile("openai-codex").args,
            vec![
                "--no-alt-screen",
                "--dangerously-bypass-approvals-and-sandbox"
            ]
        );
        assert_eq!(
            resolve_terminal_profile("claude").args,
            vec!["--permission-mode", "bypassPermissions"]
        );
        assert_eq!(
            resolve_terminal_profile("open-code").command.as_deref(),
            Some("opencode")
        );
        assert_eq!(
            resolve_terminal_profile("open-code")
                .command_line()
                .as_deref(),
            Some("OPENCODE_CONFIG_CONTENT='{\"permission\":\"allow\"}' OPENCODE_YOLO='true' OPENCODE_DANGEROUSLY_SKIP_PERMISSIONS='true' 'opencode'")
        );
        assert_eq!(
            resolve_terminal_profile("pi").command_line().as_deref(),
            Some("'pi'")
        );
    }

    #[test]
    fn custom_runtime_is_supported() {
        let profile = resolve_terminal_profile("my-agent");
        assert_eq!(profile.id, "my-agent");
        assert_eq!(profile.command_line().as_deref(), Some("'my-agent'"));
    }
}
