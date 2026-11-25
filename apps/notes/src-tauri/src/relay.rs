//! The sharing relay of the desktop app (P11-N7, ADR 0010): File › Options › Sharing picks the relay – the
//! default `https://rusuit.es` or a self-hosted one. Only an origin (`https://host[:port]`) is configured; the
//! socket (ws) is `wss://host/api/notes/ws` and invite links point at `https://host/notes/`.
//!
//! Plain `http://` is accepted only when the user allows it *and* the host is on the local network (the WebDAV
//! connections' rule, narrowed to LAN hosts). The webview's Content-Security-Policy ([`csp`]) lets the page
//! connect to exactly this origin (besides the app itself and the AI providers of Settings › AI); a changed relay
//! takes effect after a restart, when the window is created with the new policy.

use std::net::{Ipv4Addr, Ipv6Addr};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The relay of a fresh install.
pub const DEFAULT_RELAY: &str = "https://rusuit.es";

/// The relay's socket (ws) path on its origin.
pub const WS_PATH: &str = "/api/notes/ws";

/// The web app's path on the relay origin (invite and page links).
pub const WEB_PATH: &str = "/notes/";

/// The settings file in the app data directory.
pub const FILE: &str = "relay.json";

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RelayError {
    #[error("not an https:// URL: {0:?}")]
    Scheme(String),
    #[error(
        "plain http:// is allowed only for a server on your local network, with “Allow http” on"
    )]
    Insecure,
    #[error("enter only the server address (https://host[:port]), without a path, user, query or fragment: {0:?}")]
    Invalid(String),
}

/// The stored setting.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayConfig {
    pub url: String,
    #[serde(default)]
    pub allow_http: bool,
}

impl Default for RelayConfig {
    fn default() -> Self {
        RelayConfig {
            url: DEFAULT_RELAY.to_owned(),
            allow_http: false,
        }
    }
}

/// What the UI gets: the setting plus the derived addresses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayInfo {
    /// The checked origin (`https://host[:port]`).
    pub url: String,
    pub allow_http: bool,
    pub ws_url: String,
    pub web_base: String,
    pub default_url: &'static str,
}

impl RelayConfig {
    /// The setting of `dir` (the default when absent or invalid – a hand-edited file never opens a hole).
    #[must_use]
    pub fn load(dir: &Path) -> Self {
        std::fs::read(path(dir))
            .ok()
            .and_then(|b| serde_json::from_slice::<RelayConfig>(&b).ok())
            .and_then(|c| {
                check_relay_url(&c.url, c.allow_http)
                    .ok()
                    .map(|url| RelayConfig { url, ..c })
            })
            .unwrap_or_default()
    }

    /// Checks and stores a new setting → the checked one.
    pub fn save(dir: &Path, url: &str, allow_http: bool) -> Result<Self, SaveError> {
        let url = check_relay_url(url, allow_http)?;
        let config = RelayConfig { url, allow_http };
        std::fs::create_dir_all(dir)?;
        let json = serde_json::to_vec_pretty(&config).map_err(std::io::Error::other)?;
        std::fs::write(path(dir), json)?;
        Ok(config)
    }

    #[must_use]
    pub fn info(&self) -> RelayInfo {
        RelayInfo {
            url: self.url.clone(),
            allow_http: self.allow_http,
            ws_url: ws_url(&self.url),
            web_base: format!("{}{WEB_PATH}", self.url),
            default_url: DEFAULT_RELAY,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SaveError {
    #[error("{0}")]
    Relay(#[from] RelayError),
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
}

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

/// Checks a relay address → its origin (scheme and host lower-cased, no trailing `/`).
pub fn check_relay_url(url: &str, allow_http: bool) -> Result<String, RelayError> {
    let url = url.trim();
    let lower = url.to_ascii_lowercase();
    let (scheme, rest) = if lower.starts_with("https://") {
        ("https", &url[8..])
    } else if lower.starts_with("http://") {
        ("http", &url[7..])
    } else {
        return Err(RelayError::Scheme(url.to_owned()));
    };
    let host_port = rest.strip_suffix('/').unwrap_or(rest);
    let invalid = || RelayError::Invalid(url.to_owned());
    if host_port.is_empty()
        || host_port.contains(['/', '?', '#', '@', '\\', ' '])
        || host_port.chars().any(char::is_control)
    {
        return Err(invalid());
    }
    let (host, port) = split_host_port(host_port).ok_or_else(invalid)?;
    if let Some(p) = port {
        if p.is_empty()
            || p.len() > 5
            || !p.bytes().all(|b| b.is_ascii_digit())
            || p.parse::<u16>().map_or(true, |n| n == 0)
        {
            return Err(invalid());
        }
    }
    let host = host.to_ascii_lowercase();
    if !valid_host(&host) {
        return Err(invalid());
    }
    if scheme == "http" && !(allow_http && is_lan_host(&host)) {
        return Err(RelayError::Insecure);
    }
    Ok(match port {
        Some(p) => format!("{scheme}://{host}:{p}"),
        None => format!("{scheme}://{host}"),
    })
}

/// `host[:port]` (an IPv6 host in brackets) → host (brackets kept) and port.
fn split_host_port(s: &str) -> Option<(&str, Option<&str>)> {
    if s.starts_with('[') {
        let end = s.find(']')?;
        let (host, rest) = s.split_at(end + 1);
        return match rest {
            "" => Some((host, None)),
            r => r.strip_prefix(':').map(|p| (host, Some(p))),
        };
    }
    match s.rsplit_once(':') {
        Some((h, p)) => (!h.contains(':')).then_some((h, Some(p))),
        None => Some((s, None)),
    }
}

fn valid_host(host: &str) -> bool {
    if let Some(inner) = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')) {
        return inner.parse::<Ipv6Addr>().is_ok();
    }
    !host.is_empty()
        && host.len() <= 253
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        })
}

/// A host on the local network: `localhost`, `*.local` / `*.lan` / `*.home.arpa` / `*.internal`, a single-label
/// name, or a loopback / private / link-local address.
#[must_use]
pub fn is_lan_host(host: &str) -> bool {
    if let Some(inner) = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')) {
        return inner.parse::<Ipv6Addr>().is_ok_and(|ip| {
            let s = ip.segments()[0];
            ip.is_loopback() || (s & 0xfe00) == 0xfc00 || (s & 0xffc0) == 0xfe80
        });
    }
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        return ip.is_loopback() || ip.is_private() || ip.is_link_local();
    }
    if host.bytes().all(|b| b.is_ascii_digit() || b == b'.') {
        return false;
    }
    host == "localhost"
        || !host.contains('.')
        || [".localhost", ".local", ".lan", ".home.arpa", ".internal"]
            .iter()
            .any(|s| host.ends_with(s))
}

/// The relay's socket (ws) URL for a checked origin.
#[must_use]
pub fn ws_url(origin: &str) -> String {
    format!("{}{WS_PATH}", ws_origin(origin))
}

fn ws_origin(origin: &str) -> String {
    match origin.strip_prefix("https://") {
        Some(rest) => format!("wss://{rest}"),
        None => format!("ws://{}", origin.strip_prefix("http://").unwrap_or(origin)),
    }
}

/// The AI providers of Settings › AI the page may call (ADR 0009 amendment: only when the user runs an action):
/// the two cloud APIs and a local OpenAI-compatible server on this computer. Other self-hosted endpoints are
/// blocked by the policy (the assistant reports a CSP error).
pub const AI_ORIGINS: &[&str] = &[
    "https://api.anthropic.com",
    "https://api.openai.com",
    "http://localhost:*",
    "http://127.0.0.1:*",
];

/// The problem-report endpoint (Help › Report a problem, ADR 0009 amendment): the same build-time
/// `REPORT_RELAY_URL` as the page's (the ui-shared report client), allowed as this exact URL.
pub const REPORT_URL: &str = match option_env!("REPORT_RELAY_URL") {
    Some(u) => u,
    None => "https://rusuit.es/api/report",
};

/// The window's Content-Security-Policy: the app's own files and IPC, `blob:`/`data:` pictures, WebAssembly (the
/// Loro and sharing-crypto modules) and – for `connect-src` – exactly the relay origin (and its ws: twin) plus
/// [`AI_ORIGINS`] and the [`REPORT_URL`].
#[must_use]
pub fn csp(relay_origin: &str) -> String {
    let own = "'self' ipc: http://ipc.localhost tauri: http://tauri.localhost asset: http://asset.localhost";
    let connect = [
        own.to_owned(),
        ws_origin(relay_origin),
        relay_origin.to_owned(),
    ]
    .into_iter()
    .chain(std::iter::once(REPORT_URL.trim().to_owned()))
    .chain(AI_ORIGINS.iter().map(|s| (*s).to_owned()))
    .collect::<Vec<_>>()
    .join(" ");
    [
        format!("default-src {own}"),
        format!("connect-src {connect}"),
        format!("script-src {own} 'wasm-unsafe-eval'"),
        format!("style-src {own} 'unsafe-inline'"),
        format!("img-src {own} blob: data:"),
        format!("media-src {own} blob: data:"),
        format!("font-src {own} data:"),
        format!("worker-src {own} blob:"),
        "frame-src 'none'".to_owned(),
        "object-src 'none'".to_owned(),
        "base-uri 'self'".to_owned(),
        "form-action 'none'".to_owned(),
    ]
    .join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_origins_are_normalised() {
        assert_eq!(
            check_relay_url(" https://Rusuit.ES/ ", false).unwrap(),
            "https://rusuit.es"
        );
        assert_eq!(
            check_relay_url("HTTPS://notes.example.org:8443", false).unwrap(),
            "https://notes.example.org:8443"
        );
        assert_eq!(
            check_relay_url("https://[2001:db8::1]:9000", false).unwrap(),
            "https://[2001:db8::1]:9000"
        );
    }

    #[test]
    fn bad_addresses_are_rejected() {
        for bad in [
            "rusuit.es",
            "wss://rusuit.es",
            "ftp://x",
            "https://",
            "https://rusuit.es/notes",
            "https://user@rusuit.es",
            "https://rusuit.es?x=1",
            "https://rusuit.es#frag",
            "https://rusuit.es:0",
            "https://rusuit.es:99999",
            "https://rusuit.es:",
            "https://-bad-.example",
            "https://exa mple.org",
            "https://[nope]",
            "https://a:b:c",
        ] {
            assert!(check_relay_url(bad, true).is_err(), "{bad}");
        }
    }

    #[test]
    fn http_only_for_lan_hosts_when_allowed() {
        for lan in [
            "http://localhost:8080",
            "http://192.168.1.20",
            "http://10.0.0.5:9000",
            "http://172.16.3.4",
            "http://127.0.0.1:5117",
            "http://nas.local",
            "http://relay.lan",
            "http://box.home.arpa",
            "http://nas",
            "http://[::1]:8080",
            "http://[fd00::5]",
        ] {
            assert!(check_relay_url(lan, true).is_ok(), "{lan}");
            assert_eq!(
                check_relay_url(lan, false),
                Err(RelayError::Insecure),
                "{lan}"
            );
        }
        for public in [
            "http://rusuit.es",
            "http://8.8.8.8",
            "http://172.32.0.1",
            "http://[2001:db8::1]",
        ] {
            assert_eq!(
                check_relay_url(public, true),
                Err(RelayError::Insecure),
                "{public}"
            );
        }
    }

    #[test]
    fn derived_addresses() {
        assert_eq!(ws_url("https://rusuit.es"), "wss://rusuit.es/api/notes/ws");
        assert_eq!(
            ws_url("http://nas.local:8080"),
            "ws://nas.local:8080/api/notes/ws"
        );
        let info = RelayConfig::default().info();
        assert_eq!(info.url, "https://rusuit.es");
        assert_eq!(info.web_base, "https://rusuit.es/notes/");
        assert_eq!(info.ws_url, "wss://rusuit.es/api/notes/ws");
    }

    #[test]
    fn csp_allows_exactly_the_relay_origin() {
        let p = csp("https://relay.example.org:8443");
        let connect = p
            .split("; ")
            .find(|d| d.starts_with("connect-src "))
            .unwrap();
        let sources: Vec<&str> = connect.split(' ').skip(1).collect();
        assert!(sources.contains(&"wss://relay.example.org:8443"));
        assert!(sources.contains(&"https://relay.example.org:8443"));
        assert!(!sources
            .iter()
            .any(|s| s.contains("rusuit.es") && *s != REPORT_URL));
        // Nothing but the app, the relay and the AI providers: no wildcards for other hosts.
        assert!(!sources
            .iter()
            .any(|s| *s == "*" || s.starts_with("https:") && !s.contains("//") || *s == "wss:"));
        let others: Vec<&&str> = sources
            .iter()
            .filter(|s| {
                !s.contains("relay.example.org") && !AI_ORIGINS.contains(s) && **s != REPORT_URL
            })
            .collect();
        assert_eq!(
            others,
            [
                "'self'",
                "ipc:",
                "http://ipc.localhost",
                "tauri:",
                "http://tauri.localhost",
                "asset:",
                "http://asset.localhost"
            ]
            .iter()
            .collect::<Vec<_>>()
        );
        assert!(p.contains("script-src 'self'") && p.contains("'wasm-unsafe-eval'"));
        assert!(!p.contains("'unsafe-eval'"));
        let local = csp("http://nas.local:8080");
        assert!(local.contains(" ws://nas.local:8080 http://nas.local:8080 "));
    }

    #[test]
    fn config_round_trip_and_defaults() {
        let dir = std::env::temp_dir().join(format!("rusuite-notes-relay-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(RelayConfig::load(&dir), RelayConfig::default());
        let saved = RelayConfig::save(&dir, "https://Notes.Example.org/", false).unwrap();
        assert_eq!(saved.url, "https://notes.example.org");
        assert_eq!(RelayConfig::load(&dir), saved);
        assert!(RelayConfig::save(&dir, "http://example.org", true).is_err());
        assert_eq!(
            RelayConfig::load(&dir),
            saved,
            "a rejected setting is not stored"
        );
        // A hand-edited insecure file falls back to the default.
        std::fs::write(
            dir.join(FILE),
            r#"{"url":"http://example.org","allowHttp":true}"#,
        )
        .unwrap();
        assert_eq!(RelayConfig::load(&dir), RelayConfig::default());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
