//! Configuration from the environment (systemd `Environment=` / `EnvironmentFile=/etc/rusuite/notes-relay.env`).
//! Nothing here is secret: the relay holds no keys.

use std::net::SocketAddr;
use std::path::PathBuf;

pub const DEFAULT_LISTEN: &str = "127.0.0.1:8732";
pub const DEFAULT_DATA_DIR: &str = "/var/lib/rusuite-notes";

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("{0} is invalid: {1}")]
    Invalid(&'static str, String),
}

/// The relay's limits. Defaults (documented in `docs/notes-sync-protocol.md`): 200 MB per notebook, 25 MB per blob,
/// 1 MB per other envelope, 50 messages/s per connection, notebooks inactive for 365 days deleted, 300 s grace for
/// the previous epoch after a key rotation, 100 open join requests per notebook (each ≤ 4 KB, kept 7 days).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Limits {
    pub notebook_quota_bytes: u64,
    pub blob_max_bytes: usize,
    pub envelope_max_bytes: usize,
    pub messages_per_sec: u32,
    pub inactive_secs: u64,
    pub epoch_grace_secs: u64,
    pub max_join_requests: usize,
    pub join_request_max_bytes: usize,
    pub join_request_ttl_secs: u64,
    /// Frames queued for one slow connection before the relay drops it (it reconnects and catches up).
    pub connection_queue: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            notebook_quota_bytes: 200 * 1024 * 1024,
            blob_max_bytes: 25 * 1024 * 1024,
            envelope_max_bytes: 1024 * 1024,
            messages_per_sec: 50,
            inactive_secs: 365 * 24 * 3600,
            epoch_grace_secs: 300,
            max_join_requests: 100,
            join_request_max_bytes: 4096,
            join_request_ttl_secs: notes_sync::INVITE_TTL_SECS,
            connection_queue: 4096,
        }
    }
}

impl Limits {
    /// The largest WebSocket message accepted (a maximal blob envelope plus framing).
    pub fn max_message_bytes(&self) -> usize {
        self.blob_max_bytes.max(self.envelope_max_bytes) + 64 * 1024
    }
}

#[derive(Debug, Clone)]
pub struct Config {
    /// `NOTES_LISTEN` (default `127.0.0.1:8732`).
    pub listen: SocketAddr,
    /// `NOTES_DATA_DIR` (default `/var/lib/rusuite-notes`).
    pub data_dir: PathBuf,
    pub limits: Limits,
}

impl Config {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        Config {
            listen: DEFAULT_LISTEN.parse().expect("valid default"),
            data_dir: data_dir.into(),
            limits: Limits::default(),
        }
    }

    /// `NOTES_LISTEN`, `NOTES_DATA_DIR`, `NOTES_QUOTA_MB`, `NOTES_BLOB_MAX_MB`, `NOTES_ENVELOPE_MAX_KB`,
    /// `NOTES_RATE_PER_SEC`, `NOTES_INACTIVE_DAYS`, `NOTES_EPOCH_GRACE_SECS`.
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let val = |k: &str| {
            get(k)
                .map(|v| v.trim().to_owned())
                .filter(|v| !v.is_empty())
        };
        let num = |k: &'static str| -> Result<Option<u64>, ConfigError> {
            match val(k) {
                None => Ok(None),
                Some(v) => match v.parse::<u64>() {
                    Ok(n) if n > 0 => Ok(Some(n)),
                    _ => Err(ConfigError::Invalid(k, v)),
                },
            }
        };
        let mut c = Config::new(val("NOTES_DATA_DIR").unwrap_or_else(|| DEFAULT_DATA_DIR.into()));
        if let Some(l) = val("NOTES_LISTEN") {
            c.listen = l
                .parse()
                .map_err(|_| ConfigError::Invalid("NOTES_LISTEN", l.clone()))?;
        }
        let l = &mut c.limits;
        if let Some(n) = num("NOTES_QUOTA_MB")? {
            l.notebook_quota_bytes = n * 1024 * 1024;
        }
        if let Some(n) = num("NOTES_BLOB_MAX_MB")? {
            l.blob_max_bytes = (n * 1024 * 1024) as usize;
        }
        if let Some(n) = num("NOTES_ENVELOPE_MAX_KB")? {
            l.envelope_max_bytes = (n * 1024) as usize;
        }
        if let Some(n) = num("NOTES_RATE_PER_SEC")? {
            l.messages_per_sec = n.min(u32::MAX as u64) as u32;
        }
        if let Some(n) = num("NOTES_INACTIVE_DAYS")? {
            l.inactive_secs = n * 24 * 3600;
        }
        if let Some(n) = num("NOTES_EPOCH_GRACE_SECS")? {
            l.epoch_grace_secs = n;
        }
        Ok(c)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let m: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k| m.get(k).cloned()
    }

    #[test]
    fn defaults() {
        let c = Config::from_lookup(env(&[])).unwrap();
        assert_eq!(c.listen.to_string(), "127.0.0.1:8732");
        assert_eq!(c.data_dir, PathBuf::from("/var/lib/rusuite-notes"));
        assert_eq!(c.limits.notebook_quota_bytes, 200 << 20);
        assert_eq!(c.limits.blob_max_bytes, 25 << 20);
        assert_eq!(c.limits.envelope_max_bytes, 1 << 20);
        assert_eq!(c.limits.messages_per_sec, 50);
        assert_eq!(c.limits.inactive_secs, 365 * 86400);
        assert_eq!(c.limits.join_request_ttl_secs, 7 * 86400);
    }

    #[test]
    fn overrides_and_errors() {
        let c = Config::from_lookup(env(&[
            ("NOTES_LISTEN", "127.0.0.1:5120"),
            ("NOTES_DATA_DIR", "/tmp/x"),
            ("NOTES_QUOTA_MB", "1"),
            ("NOTES_RATE_PER_SEC", "5"),
            ("NOTES_EPOCH_GRACE_SECS", "10"),
        ]))
        .unwrap();
        assert_eq!(c.listen.port(), 5120);
        assert_eq!(c.limits.notebook_quota_bytes, 1 << 20);
        assert_eq!(c.limits.messages_per_sec, 5);
        assert_eq!(c.limits.epoch_grace_secs, 10);
        assert!(matches!(
            Config::from_lookup(env(&[("NOTES_QUOTA_MB", "x")])),
            Err(ConfigError::Invalid("NOTES_QUOTA_MB", _))
        ));
        assert!(Config::from_lookup(env(&[("NOTES_RATE_PER_SEC", "0")])).is_err());
        assert!(Config::from_lookup(env(&[("NOTES_LISTEN", "nope")])).is_err());
    }
}
