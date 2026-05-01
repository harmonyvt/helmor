//! Typed error surface for Tauri commands.
//!
//! Internal code keeps using `anyhow::Result<T>`. At the IPC boundary,
//! `CommandError` serialises as `{ code, message }` — the frontend reads
//! `code` to drive recovery UX (e.g. offer "Permanently Delete" when a
//! workspace is broken) and `message` for display.
//!
//! Attach a code to an error via [`coded`] / [`bail_coded!`] / [`AnyhowCodedExt::with_code`].
//! Codes survive `.context(...)` wrapping because they ride inside the
//! anyhow chain as a [`CodedError`] layer that serialisation downcasts out.

use std::error::Error as StdError;
use std::fmt;

use serde::Serialize;

/// Discriminator the frontend uses to pick recovery UX. Extend on demand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ErrorCode {
    Unknown,
    /// Workspace is unusable at the filesystem/git layer — purge from DB to recover.
    WorkspaceBroken,
    /// Workspace row not in DB.
    WorkspaceNotFound,
    /// Expected forge CLI onboarding state: CLI missing or auth required.
    ForgeOnboarding,
}

/// Exposes an [`ErrorCode`] as a distinct layer in an anyhow error chain,
/// so `Error::chain()` + `downcast_ref` can locate it. Using our own
/// `StdError` wrapper (rather than `.context(marker)`) is necessary because
/// anyhow's `ContextError` hides the context value from `source()`, which
/// `.chain()` walks.
#[derive(Debug)]
pub struct CodedError {
    code: ErrorCode,
    source: Option<Box<dyn StdError + Send + Sync + 'static>>,
}

impl CodedError {
    pub fn code(&self) -> ErrorCode {
        self.code
    }
}

impl fmt::Display for CodedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Stripped from user-facing message at serialize time.
        write!(f, "{:?}", self.code)
    }
}

impl StdError for CodedError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        self.source
            .as_deref()
            .map(|e| e as &(dyn StdError + 'static))
    }
}

/// Build a fresh coded anyhow error. Chain `.context(...)` for the human message.
pub fn coded(code: ErrorCode) -> anyhow::Error {
    anyhow::Error::new(CodedError { code, source: None })
}

pub trait AnyhowCodedExt {
    /// Attach a code to an existing anyhow error without losing prior context.
    fn with_code(self, code: ErrorCode) -> anyhow::Error;
}

impl AnyhowCodedExt for anyhow::Error {
    fn with_code(self, code: ErrorCode) -> anyhow::Error {
        anyhow::Error::new(CodedError {
            code,
            source: Some(self.into()),
        })
    }
}

/// Like `anyhow::bail!` but also tags the resulting error with an `ErrorCode`.
#[macro_export]
macro_rules! bail_coded {
    ($code:expr, $($arg:tt)*) => {
        return Err($crate::error::coded($code).context(format!($($arg)*)))
    };
}

/// Wrapper around `anyhow::Error` that implements `Serialize` for Tauri IPC.
pub struct CommandError(anyhow::Error);

impl fmt::Debug for CommandError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:#}", self.0)
    }
}

impl Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Payload<'a> {
            code: ErrorCode,
            message: &'a str,
        }
        let code = extract_code(&self.0);
        let message = full_message(&self.0);
        Payload {
            code,
            message: &message,
        }
        .serialize(serializer)
    }
}

impl From<anyhow::Error> for CommandError {
    fn from(error: anyhow::Error) -> Self {
        // Full chain goes to logs; user-facing message is just the outer context.
        let code = extract_code(&error);
        if code == ErrorCode::ForgeOnboarding {
            tracing::warn!(
                code = ?code,
                error = %format!("{error:#}"),
                error_debug = ?error,
                "Tauri command failed"
            );
        } else {
            tracing::error!(
                code = ?code,
                error = %format!("{error:#}"),
                error_debug = ?error,
                "Tauri command failed"
            );
        }
        CommandError(error)
    }
}

/// First [`CodedError`] found anywhere in the chain.
pub fn extract_code(err: &anyhow::Error) -> ErrorCode {
    err.chain()
        .find_map(|e| e.downcast_ref::<CodedError>())
        .map(CodedError::code)
        .unwrap_or(ErrorCode::Unknown)
}

/// Outermost non-marker layer's `Display`. What the user sees in the toast.
pub fn outermost_message(err: &anyhow::Error) -> String {
    err.chain()
        .find(|e| e.downcast_ref::<CodedError>().is_none())
        .map(|e| e.to_string())
        .unwrap_or_else(|| "Unknown error".into())
}

/// Full non-marker chain joined with `: `. What the user sees in the toast —
/// includes the root cause (e.g. git stderr) not just the outermost context.
pub fn full_message(err: &anyhow::Error) -> String {
    let parts: Vec<String> = err
        .chain()
        .filter(|e| e.downcast_ref::<CodedError>().is_none())
        .map(|e| e.to_string())
        .collect();
    if parts.is_empty() {
        return "Unknown error".into();
    }
    parts.join(": ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coded_then_context_is_found_in_chain() {
        let err: anyhow::Error = coded(ErrorCode::WorkspaceBroken)
            .context("outer message")
            .context("outermost");
        assert_eq!(extract_code(&err), ErrorCode::WorkspaceBroken);
        assert_eq!(outermost_message(&err), "outermost");
    }

    #[test]
    fn with_code_wraps_existing_chain() {
        let base: anyhow::Error = anyhow::anyhow!("io failed").context("while reading file");
        let tagged = base.with_code(ErrorCode::WorkspaceBroken);
        assert_eq!(extract_code(&tagged), ErrorCode::WorkspaceBroken);
        assert_eq!(outermost_message(&tagged), "while reading file");
    }

    #[test]
    fn bail_coded_macro_tags_error() {
        fn op() -> anyhow::Result<()> {
            bail_coded!(ErrorCode::WorkspaceNotFound, "workspace {} missing", "abc");
        }
        let err = op().unwrap_err();
        assert_eq!(extract_code(&err), ErrorCode::WorkspaceNotFound);
        assert_eq!(outermost_message(&err), "workspace abc missing");
    }

    #[test]
    fn unknown_when_no_marker() {
        let err: anyhow::Error = anyhow::anyhow!("plain error");
        assert_eq!(extract_code(&err), ErrorCode::Unknown);
        assert_eq!(outermost_message(&err), "plain error");
    }

    #[test]
    fn serializes_as_code_and_message() {
        let err: CommandError = coded(ErrorCode::WorkspaceNotFound)
            .context("Workspace not found: abc")
            .into();
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(
            json,
            r#"{"code":"WorkspaceNotFound","message":"Workspace not found: abc"}"#
        );
    }

    #[test]
    fn serializes_full_chain_including_root_cause() {
        // Simulates a worktree-creation failure: outer context + inner git stderr.
        let inner = anyhow::anyhow!("fatal: branch already checked out");
        let err: CommandError = inner
            .context("Failed to create worktree at /tmp/foo for branch my-branch")
            .with_code(ErrorCode::Unknown)
            .into();
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(
            json,
            r#"{"code":"Unknown","message":"Failed to create worktree at /tmp/foo for branch my-branch: fatal: branch already checked out"}"#
        );
    }

    #[test]
    fn full_message_joins_non_marker_layers() {
        let err = anyhow::anyhow!("root cause")
            .context("mid layer")
            .context("outer context");
        assert_eq!(full_message(&err), "outer context: mid layer: root cause");
    }

    #[test]
    fn full_message_skips_coded_error_markers() {
        let err = coded(ErrorCode::WorkspaceBroken).context("dir missing at /foo");
        assert_eq!(full_message(&err), "dir missing at /foo");
    }

    #[test]
    fn full_chain_logged_message_stripped_of_marker() {
        let err: anyhow::Error = coded(ErrorCode::WorkspaceBroken).context("dir missing at /foo");
        let full = format!("{err:#}");
        // Full chain format is used for logs; it will include the marker's Display.
        // Frontend sees outermost_message which skips it.
        assert!(full.contains("dir missing at /foo"));
        assert_eq!(outermost_message(&err), "dir missing at /foo");
    }
}
