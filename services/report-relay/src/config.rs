//! Configuration from the environment (systemd `EnvironmentFile=/etc/rusuite/report-relay.env`).

use std::net::SocketAddr;

/// The site whose pages call the relay (the web apps; same origin as `/api/report`).
pub const DEFAULT_SITE_ORIGIN: &str = "https://resuite.inceptum.at";
/// The desktop apps' webview origins (Tauri 2: Linux/macOS, Windows).
pub const DESKTOP_ORIGINS: [&str; 2] = ["tauri://localhost", "https://tauri.localhost"];
pub const DEFAULT_LISTEN: &str = "127.0.0.1:8787";
pub const DEFAULT_GITHUB_API: &str = "https://api.github.com";
pub const DEFAULT_ATTACHMENT_BRANCH: &str = "issue-attachments";

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("{0} is not set")]
    Missing(&'static str),
    #[error("{0} is invalid: {1}")]
    Invalid(&'static str, String),
}

/// The relay's settings. `Debug` never prints the token.
#[derive(Clone)]
pub struct Config {
    /// `GITHUB_TOKEN`: fine-grained token with Issues read/write (and Contents read/write for screenshots).
    pub github_token: String,
    /// `GITHUB_REPO`: `owner/name`.
    pub github_repo: String,
    /// `GITHUB_API` (default `https://api.github.com`; tests point it at a mock).
    pub github_api: String,
    /// `REPORT_LISTEN` (default `127.0.0.1:8787`).
    pub listen: SocketAddr,
    /// `REPORT_SITE_ORIGIN` (default `https://resuite.inceptum.at`).
    pub site_origin: String,
    /// `REPORT_EXTRA_ORIGINS`: comma-separated additional allowed origins (e.g. a local dev server), default none.
    pub extra_origins: Vec<String>,
    /// `REPORT_ATTACHMENT_BRANCH` (default `issue-attachments`).
    pub attachment_branch: String,
}

impl std::fmt::Debug for Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Config")
            .field("github_token", &"<redacted>")
            .field("github_repo", &self.github_repo)
            .field("github_api", &self.github_api)
            .field("listen", &self.listen)
            .field("site_origin", &self.site_origin)
            .field("extra_origins", &self.extra_origins)
            .field("attachment_branch", &self.attachment_branch)
            .finish()
    }
}

/// `owner/name` with GitHub's allowed characters.
pub fn valid_repo(repo: &str) -> bool {
    let mut parts = repo.split('/');
    let ok = |s: Option<&str>| {
        s.is_some_and(|s| {
            !s.is_empty()
                && s.len() <= 100
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        })
    };
    ok(parts.next()) && ok(parts.next()) && parts.next().is_none()
}

impl Config {
    /// A config for `repo` with defaults (tests).
    pub fn new(token: impl Into<String>, repo: impl Into<String>) -> Self {
        Config {
            github_token: token.into(),
            github_repo: repo.into(),
            github_api: DEFAULT_GITHUB_API.into(),
            listen: DEFAULT_LISTEN.parse().expect("valid default"),
            site_origin: DEFAULT_SITE_ORIGIN.into(),
            extra_origins: Vec::new(),
            attachment_branch: DEFAULT_ATTACHMENT_BRANCH.into(),
        }
    }

    /// Reads the settings through `get` (the process environment in `main`).
    pub fn from_lookup(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let non_empty = |k: &str| {
            get(k)
                .map(|v| v.trim().to_owned())
                .filter(|v| !v.is_empty())
        };
        let token = non_empty("GITHUB_TOKEN").ok_or(ConfigError::Missing("GITHUB_TOKEN"))?;
        let repo = non_empty("GITHUB_REPO").ok_or(ConfigError::Missing("GITHUB_REPO"))?;
        if !valid_repo(&repo) {
            return Err(ConfigError::Invalid(
                "GITHUB_REPO",
                "expected owner/name".into(),
            ));
        }
        let mut c = Config::new(token, repo);
        if let Some(api) = non_empty("GITHUB_API") {
            if !(api.starts_with("https://") || api.starts_with("http://127.0.0.1:")) {
                return Err(ConfigError::Invalid(
                    "GITHUB_API",
                    "https:// (or a local mock)".into(),
                ));
            }
            c.github_api = api.trim_end_matches('/').to_owned();
        }
        if let Some(listen) = non_empty("REPORT_LISTEN") {
            c.listen = listen
                .parse()
                .map_err(|_| ConfigError::Invalid("REPORT_LISTEN", listen.clone()))?;
        }
        if let Some(o) = non_empty("REPORT_SITE_ORIGIN") {
            c.site_origin = o.trim_end_matches('/').to_owned();
        }
        if let Some(list) = non_empty("REPORT_EXTRA_ORIGINS") {
            c.extra_origins = list
                .split(',')
                .map(|s| s.trim().trim_end_matches('/').to_owned())
                .filter(|s| !s.is_empty())
                .collect();
        }
        if let Some(b) = non_empty("REPORT_ATTACHMENT_BRANCH") {
            c.attachment_branch = b;
        }
        Ok(c)
    }

    /// The `Origin`s that may call the relay: the site, the two desktop webview origins, the extras.
    pub fn allowed_origins(&self) -> Vec<String> {
        let mut v = vec![self.site_origin.clone()];
        v.extend(DESKTOP_ORIGINS.iter().map(|s| s.to_string()));
        v.extend(self.extra_origins.iter().cloned());
        v
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
    fn requires_token_and_repo() {
        assert_eq!(
            Config::from_lookup(env(&[])).unwrap_err(),
            ConfigError::Missing("GITHUB_TOKEN")
        );
        assert_eq!(
            Config::from_lookup(env(&[("GITHUB_TOKEN", "x")])).unwrap_err(),
            ConfigError::Missing("GITHUB_REPO")
        );
        assert!(matches!(
            Config::from_lookup(env(&[("GITHUB_TOKEN", "x"), ("GITHUB_REPO", "nope")])),
            Err(ConfigError::Invalid("GITHUB_REPO", _))
        ));
    }

    #[test]
    fn defaults_and_overrides() {
        let c = Config::from_lookup(env(&[
            ("GITHUB_TOKEN", "placeholder"),
            ("GITHUB_REPO", "refaustria/rusuite"),
            (
                "REPORT_EXTRA_ORIGINS",
                "http://localhost:1420, http://127.0.0.1:4843/",
            ),
        ]))
        .unwrap();
        assert_eq!(c.listen.to_string(), "127.0.0.1:8787");
        assert_eq!(c.github_api, "https://api.github.com");
        assert_eq!(
            c.allowed_origins(),
            [
                "https://resuite.inceptum.at",
                "tauri://localhost",
                "https://tauri.localhost",
                "http://localhost:1420",
                "http://127.0.0.1:4843"
            ]
        );
    }

    #[test]
    fn debug_redacts_the_token() {
        let c = Config::new("secret-token-value", "a/b");
        let s = format!("{c:?}");
        assert!(!s.contains("secret-token-value"));
        assert!(s.contains("<redacted>"));
    }
}
