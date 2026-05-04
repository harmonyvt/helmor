//! Provider session-id adoption rules.
//!
//! Claude's authoritative `session_id` only arrives in `system.init`; earlier
//! `SessionStart:resume` hook events carry a transient id that does NOT map
//! to any real conversation jsonl. Adopting them poisons the next resume
//! with "No conversation found", so this module owns the policy of when an
//! observed id is safe to remember.

/// Decide whether to adopt an observed provider session id as the
/// authoritative one for this turn.
///
/// Returns `true` only when:
/// - The observed id is non-empty.
/// - It does not echo the helmor session id (defensive — sidecar should
///   never send it but we don't trust upstream blindly).
/// - We have not already adopted one, unless replacement is explicitly allowed.
pub(super) fn should_adopt_provider_session_id(
    current_provider_session_id: Option<&str>,
    observed_provider_session_id: &str,
    helmor_session_id: Option<&str>,
    allow_replacement: bool,
) -> bool {
    !observed_provider_session_id.is_empty()
        && helmor_session_id != Some(observed_provider_session_id)
        && (current_provider_session_id.is_none()
            || (allow_replacement
                && current_provider_session_id != Some(observed_provider_session_id)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_session_id_is_adopted_only_once() {
        assert!(should_adopt_provider_session_id(
            None,
            "provider-session-1",
            None,
            false,
        ));
        assert!(!should_adopt_provider_session_id(
            Some("provider-session-1"),
            "provider-session-1",
            None,
            true,
        ));
        assert!(!should_adopt_provider_session_id(
            Some("provider-session-1"),
            "provider-session-2",
            None,
            false,
        ));
        assert!(should_adopt_provider_session_id(
            Some("provider-session-1"),
            "provider-session-2",
            None,
            true,
        ));
    }

    #[test]
    fn provider_session_id_rejects_empty_and_helmor_echo_values() {
        assert!(!should_adopt_provider_session_id(None, "", None, true));
        assert!(!should_adopt_provider_session_id(
            None,
            "helmor-session-1",
            Some("helmor-session-1"),
            true,
        ));
    }
}
