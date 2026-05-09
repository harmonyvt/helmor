//! Generic forge CLI status cache.
//!
//! Both `gh` and `glab` benefit from the same caching strategy:
//!
//!   * a short TTL to coalesce duplicate probes within the same render frame
//!   * a longer "ready → error" grace window that suppresses transient
//!     failures (network blip, CLI momentarily wedged) so the UI doesn't
//!     flap. `Unauthenticated` is filesystem-deterministic and bypasses
//!     the grace.

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::Result;

#[derive(Debug, Clone)]
pub struct CachedEntry<S: Clone> {
    pub cached_at: Instant,
    pub status: S,
    pub downgrade_observed_at: Option<Instant>,
}

pub trait CacheableStatus: Clone + std::fmt::Debug {
    fn is_ready(&self) -> bool;
    /// Whether a Ready → this transition should be suppressed during the
    /// grace window. Use it for genuinely transient failures, not
    /// deterministic ones.
    fn should_debounce_ready_downgrade(&self) -> bool;
}

pub fn load_cached<K, S>(
    cache: &Mutex<HashMap<K, CachedEntry<S>>>,
    key: K,
    ttl: Duration,
    grace: Duration,
    loader: impl FnOnce() -> Result<S>,
) -> Result<S>
where
    K: Eq + Hash + Clone,
    S: CacheableStatus,
{
    let mut guard = cache.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(entry) = guard.get(&key) {
        if entry.cached_at.elapsed() <= ttl {
            return Ok(entry.status.clone());
        }
    }
    let now = Instant::now();
    let loaded = loader()?;
    let downgrade_observed_at = compute_downgrade_observed_at(guard.get(&key), &loaded, now);
    let status = stabilize(guard.get(&key), loaded, now, grace);
    guard.insert(
        key,
        CachedEntry {
            cached_at: now,
            status: status.clone(),
            downgrade_observed_at,
        },
    );
    Ok(status)
}

pub fn refresh_cached<K, S>(
    cache: &Mutex<HashMap<K, CachedEntry<S>>>,
    key: K,
    loader: impl FnOnce() -> Result<S>,
) -> Result<S>
where
    K: Eq + Hash + Clone,
    S: Clone,
{
    let status = loader()?;
    let mut guard = cache.lock().unwrap_or_else(|p| p.into_inner());
    guard.insert(
        key,
        CachedEntry {
            cached_at: Instant::now(),
            status: status.clone(),
            downgrade_observed_at: None,
        },
    );
    Ok(status)
}

fn stabilize<S: CacheableStatus>(
    cached: Option<&CachedEntry<S>>,
    loaded: S,
    now: Instant,
    grace: Duration,
) -> S {
    let Some(cached) = cached else {
        return loaded;
    };
    if !cached.status.is_ready() || loaded.is_ready() || !loaded.should_debounce_ready_downgrade() {
        return loaded;
    }
    let observed_at = cached.downgrade_observed_at.unwrap_or(now);
    let elapsed = now.duration_since(observed_at);
    if elapsed <= grace {
        tracing::warn!(
            type_name = std::any::type_name::<S>(),
            transient_status = ?loaded,
            grace_elapsed_ms = elapsed.as_millis() as u64,
            grace_remaining_ms = (grace.saturating_sub(elapsed)).as_millis() as u64,
            "Ignoring transient forge CLI status downgrade (grace window active)"
        );
        return cached.status.clone();
    }
    tracing::warn!(
        type_name = std::any::type_name::<S>(),
        downgraded_status = ?loaded,
        grace_elapsed_ms = elapsed.as_millis() as u64,
        "Forge CLI status grace window expired; surfacing downgrade"
    );
    loaded
}

fn compute_downgrade_observed_at<S: CacheableStatus>(
    cached: Option<&CachedEntry<S>>,
    status: &S,
    now: Instant,
) -> Option<Instant> {
    let cached = cached?;
    if cached.status.is_ready() && status.should_debounce_ready_downgrade() {
        Some(cached.downgrade_observed_at.unwrap_or(now))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum DummyStatus {
        Ready,
        Error,
        Unauth,
    }

    impl CacheableStatus for DummyStatus {
        fn is_ready(&self) -> bool {
            matches!(self, DummyStatus::Ready)
        }
        fn should_debounce_ready_downgrade(&self) -> bool {
            matches!(self, DummyStatus::Error)
        }
    }

    fn make_cache() -> Mutex<HashMap<&'static str, CachedEntry<DummyStatus>>> {
        Mutex::new(HashMap::new())
    }

    #[test]
    fn load_cached_serves_fresh_value_within_ttl() {
        let cache = make_cache();
        let mut calls = 0;

        let _ = load_cached(
            &cache,
            "h",
            Duration::from_secs(60),
            Duration::from_secs(30),
            || {
                calls += 1;
                Ok(DummyStatus::Ready)
            },
        )
        .unwrap();
        let _ = load_cached(
            &cache,
            "h",
            Duration::from_secs(60),
            Duration::from_secs(30),
            || {
                calls += 1;
                Ok(DummyStatus::Ready)
            },
        )
        .unwrap();

        assert_eq!(calls, 1);
    }

    #[test]
    fn load_cached_debounces_ready_to_error_within_grace() {
        let cache = make_cache();
        load_cached(
            &cache,
            "h",
            Duration::from_secs(0),
            Duration::from_secs(30),
            || Ok(DummyStatus::Ready),
        )
        .unwrap();

        let result = load_cached(
            &cache,
            "h",
            Duration::from_secs(0),
            Duration::from_secs(30),
            || Ok(DummyStatus::Error),
        )
        .unwrap();
        assert_eq!(result, DummyStatus::Ready);
    }

    #[test]
    fn load_cached_surfaces_unauthenticated_immediately() {
        let cache = make_cache();
        load_cached(
            &cache,
            "h",
            Duration::from_secs(0),
            Duration::from_secs(30),
            || Ok(DummyStatus::Ready),
        )
        .unwrap();

        let result = load_cached(
            &cache,
            "h",
            Duration::from_secs(0),
            Duration::from_secs(30),
            || Ok(DummyStatus::Unauth),
        )
        .unwrap();
        assert_eq!(result, DummyStatus::Unauth);
    }

    #[test]
    fn refresh_cached_bypasses_ttl_and_clears_downgrade() {
        let cache = make_cache();
        load_cached(
            &cache,
            "h",
            Duration::from_secs(60),
            Duration::from_secs(30),
            || Ok(DummyStatus::Ready),
        )
        .unwrap();

        let refreshed = refresh_cached(&cache, "h", || Ok(DummyStatus::Unauth)).unwrap();
        assert_eq!(refreshed, DummyStatus::Unauth);

        let next = load_cached(
            &cache,
            "h",
            Duration::from_secs(60),
            Duration::from_secs(30),
            || panic!("fresh cache should be reused after refresh"),
        )
        .unwrap();
        assert_eq!(next, DummyStatus::Unauth);
    }

    #[test]
    fn cache_keys_are_independent() {
        let cache = make_cache();
        load_cached(
            &cache,
            "h1",
            Duration::from_secs(60),
            Duration::from_secs(30),
            || Ok(DummyStatus::Ready),
        )
        .unwrap();

        let mut calls = 0;
        let next = load_cached(
            &cache,
            "h2",
            Duration::from_secs(60),
            Duration::from_secs(30),
            || {
                calls += 1;
                Ok(DummyStatus::Unauth)
            },
        )
        .unwrap();
        assert_eq!(calls, 1);
        assert_eq!(next, DummyStatus::Unauth);
    }
}
