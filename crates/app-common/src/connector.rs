//! Cloud connectors (P8-36, ADR 0009 amendment): the wire types shared by
//! the desktop transport ([`crate::webdav`], the shells' `connector_*`
//! commands) and the TypeScript `FileProvider`
//! (`packages/ui-shared/src/connectors`), plus the path rules both sides
//! follow.
//!
//! Connections are opt-in and user-configured: the only hosts ever
//! contacted are the servers the user entered. Paths are relative to the
//! connection's root folder, `/`-separated, always starting with `/`
//! (`/` itself is the root); `.` and `..` segments are refused.
//!
//! Secrets never appear in `Debug` output (`ConnectorAuth` redacts them),
//! so a stray log line cannot leak a password.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How a request authenticates.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub enum ConnectorAuth {
    /// HTTP Basic (WebDAV user name and – ideally – an app password).
    Basic { username: String, password: String },
    /// `Authorization: Bearer <token>`.
    Bearer { token: String },
    /// No credentials (public or LAN servers).
    None,
}

impl std::fmt::Debug for ConnectorAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectorAuth::Basic { username, .. } => f
                .debug_struct("Basic")
                .field("username", username)
                .field("password", &"<redacted>")
                .finish(),
            ConnectorAuth::Bearer { .. } => f
                .debug_struct("Bearer")
                .field("token", &"<redacted>")
                .finish(),
            ConnectorAuth::None => f.write_str("None"),
        }
    }
}

/// The server a transport talks to (a `Connection` with its secret).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub struct ConnectorTarget {
    /// `https://cloud.example.com/remote.php/dav/files/alice` (no trailing slash needed).
    pub base_url: String,
    /// Folder under `base_url` that is the connection's `/` (default: `base_url` itself).
    #[serde(default)]
    pub root_path: String,
    pub auth: ConnectorAuth,
    /// Allow plain `http://` (LAN servers); off = HTTPS only.
    #[serde(default)]
    pub allow_http: bool,
}

/// A file or a folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub enum EntryKind {
    File,
    Folder,
}

/// One entry of a folder listing (or a `stat`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub struct ConnectorEntry {
    /// Display name (the last path segment, decoded).
    pub name: String,
    /// Path relative to the connection root (`/Docs/a.xlsx`).
    pub path: String,
    pub kind: EntryKind,
    /// Bytes (files); `null` when the server does not say.
    pub size: Option<f64>,
    /// Last modified, milliseconds since the Unix epoch; `null` when unknown.
    pub modified: Option<f64>,
    /// The server's entity tag (quotes included, as sent).
    pub etag: Option<String>,
}

/// File contents read by a transport.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub struct ConnectorFile {
    /// Standard base64.
    pub bytes_base64: String,
    pub etag: Option<String>,
}

/// What went wrong, for the UI's message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub enum ConnectorErrorKind {
    /// The file changed on the server (409/412 on a conditional write).
    Conflict,
    NotFound,
    /// 401: wrong user name or password.
    Auth,
    /// 403.
    Forbidden,
    /// `http://` without "allow http", or a redirect to another host / to plain HTTP.
    Insecure,
    /// No connection (DNS, TLS, timeout, offline).
    Network,
    /// Any other HTTP status.
    Http,
    /// Bad input (path, URL, base64) or an unreadable server reply.
    Invalid,
    /// The local connection store or the OS keyring failed.
    Storage,
}

/// A connector failure (serialized for the UI as `{ kind, status, message }`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
#[error("{message}")]
pub struct ConnectorError {
    pub kind: ConnectorErrorKind,
    /// The HTTP status, when there was a reply.
    pub status: Option<u16>,
    pub message: String,
}

impl ConnectorError {
    pub fn new(kind: ConnectorErrorKind, message: impl Into<String>) -> Self {
        ConnectorError {
            kind,
            status: None,
            message: message.into(),
        }
    }

    /// The error for an unexpected HTTP status of `method`.
    pub fn from_status(status: u16, method: &str) -> Self {
        let kind = match status {
            401 => ConnectorErrorKind::Auth,
            403 => ConnectorErrorKind::Forbidden,
            404 | 410 => ConnectorErrorKind::NotFound,
            409 | 412 => ConnectorErrorKind::Conflict,
            _ => ConnectorErrorKind::Http,
        };
        ConnectorError {
            kind,
            status: Some(status),
            message: format!("{method} failed: HTTP {status}"),
        }
    }
}

/// Normalizes a connection-relative path: `/`-separated, leading `/`, no
/// trailing `/`, empty and `.` segments dropped; `..` and NUL refused.
pub fn normalize_path(path: &str) -> Result<String, ConnectorError> {
    let mut out = String::new();
    for seg in path.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." || seg.contains('\0') || seg.contains('\\') {
            return Err(ConnectorError::new(
                ConnectorErrorKind::Invalid,
                format!("invalid path {path:?}"),
            ));
        }
        out.push('/');
        out.push_str(seg);
    }
    if out.is_empty() {
        out.push('/');
    }
    Ok(out)
}

/// Joins a folder path and a name (`/Docs` + `a.xlsx` → `/Docs/a.xlsx`).
pub fn join_path(folder: &str, name: &str) -> Result<String, ConnectorError> {
    if name.is_empty() || name.contains('/') {
        return Err(ConnectorError::new(
            ConnectorErrorKind::Invalid,
            format!("invalid file name {name:?}"),
        ));
    }
    normalize_path(&format!("{folder}/{name}"))
}

/// Percent-encodes one path segment (RFC 3986: unreserved characters stay,
/// everything else becomes `%XX` of its UTF-8 bytes).
pub fn encode_segment(seg: &str) -> String {
    let mut out = String::with_capacity(seg.len());
    for b in seg.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Percent-encodes a `/`-separated path segment by segment.
pub fn encode_path(path: &str) -> String {
    path.split('/')
        .map(encode_segment)
        .collect::<Vec<_>>()
        .join("/")
}

/// Decodes `%XX` escapes (invalid escapes stay as they are; invalid UTF-8
/// is replaced).
pub fn decode_percent(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Checks a server URL: `https://` (or `http://` when allowed) with a host.
/// Returns it without a trailing `/`.
pub fn check_base_url(url: &str, allow_http: bool) -> Result<String, ConnectorError> {
    let url = url.trim();
    let rest = if let Some(r) = url.strip_prefix("https://") {
        r
    } else if let Some(r) = url.strip_prefix("http://") {
        if !allow_http {
            return Err(ConnectorError::new(
                ConnectorErrorKind::Insecure,
                "plain http:// is not allowed for this connection",
            ));
        }
        r
    } else {
        return Err(ConnectorError::new(
            ConnectorErrorKind::Invalid,
            format!("not an http(s) URL: {url:?}"),
        ));
    };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() || host.contains('@') || rest.contains(['?', '#']) {
        return Err(ConnectorError::new(
            ConnectorErrorKind::Invalid,
            format!("invalid server URL {url:?}"),
        ));
    }
    Ok(url.trim_end_matches('/').to_owned())
}

/// `scheme://host[:port]` of a checked URL.
pub fn origin_of(url: &str) -> &str {
    let start = url.find("://").map_or(0, |i| i + 3);
    let end = url[start..].find('/').map_or(url.len(), |i| start + i);
    &url[..end]
}

/// The path part of a checked URL (`""` for none).
pub fn url_path(url: &str) -> &str {
    &url[origin_of(url).len()..]
}

/// Parses an HTTP date (RFC 1123, `Sun, 06 Nov 1994 08:49:37 GMT`) to
/// milliseconds since the Unix epoch.
pub fn parse_http_date(s: &str) -> Option<f64> {
    let parts: Vec<&str> = s.split_whitespace().collect();
    // [Sun,] 06 Nov 1994 08:49:37 GMT
    let p = if parts.len() == 6 {
        &parts[1..]
    } else {
        &parts[..]
    };
    if p.len() != 5 || !matches!(p[4], "GMT" | "UTC" | "+0000") {
        return None;
    }
    let day: i64 = p[0].parse().ok()?;
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    let month = MONTHS.iter().position(|m| m.eq_ignore_ascii_case(p[1]))? as i64 + 1;
    let year: i64 = p[2].parse().ok()?;
    let hms: Vec<i64> = p[3]
        .split(':')
        .map(|x| x.parse().ok())
        .collect::<Option<_>>()?;
    if hms.len() != 3 || !(1..=31).contains(&day) {
        return None;
    }
    // Days from civil (Howard Hinnant's algorithm).
    let (y, m) = if month <= 2 {
        (year - 1, month + 9)
    } else {
        (year, month - 3)
    };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * m + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + hms[0] * 3600 + hms[1] * 60 + hms[2];
    Some(secs as f64 * 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_normalize_and_refuse_dot_dot() {
        assert_eq!(normalize_path("").unwrap(), "/");
        assert_eq!(normalize_path("/").unwrap(), "/");
        assert_eq!(normalize_path("Docs//a.xlsx/").unwrap(), "/Docs/a.xlsx");
        assert_eq!(normalize_path("/./Docs").unwrap(), "/Docs");
        assert_eq!(
            normalize_path("/Docs/../x").unwrap_err().kind,
            ConnectorErrorKind::Invalid
        );
        assert_eq!(join_path("/", "a b.docx").unwrap(), "/a b.docx");
        assert_eq!(join_path("/Docs", "ä.xlsx").unwrap(), "/Docs/ä.xlsx");
        assert!(join_path("/Docs", "a/b").is_err());
        assert!(join_path("/Docs", "").is_err());
    }

    #[test]
    fn percent_encoding_roundtrips_utf8() {
        assert_eq!(
            encode_segment("Bericht 2026 ü#?.docx"),
            "Bericht%202026%20%C3%BC%23%3F.docx"
        );
        assert_eq!(encode_path("/Docs/a b"), "/Docs/a%20b");
        assert_eq!(decode_percent("/Docs/a%20b%C3%BC"), "/Docs/a bü");
        assert_eq!(decode_percent("100%"), "100%");
        assert_eq!(decode_percent("%zz%4"), "%zz%4");
        for s in ["Grüße & Co.xlsx", "日本語.pptx", "a+b=c;d.docx"] {
            assert_eq!(decode_percent(&encode_segment(s)), s);
        }
    }

    #[test]
    fn base_urls_are_https_unless_allowed() {
        assert_eq!(
            check_base_url(" https://cloud.example.com/dav/ ", false).unwrap(),
            "https://cloud.example.com/dav"
        );
        assert_eq!(
            check_base_url("http://nas.local:5005", false)
                .unwrap_err()
                .kind,
            ConnectorErrorKind::Insecure
        );
        assert!(check_base_url("http://nas.local:5005", true).is_ok());
        assert!(check_base_url("ftp://x", true).is_err());
        assert!(check_base_url("https://", false).is_err());
        assert!(check_base_url("https://user:pw@host/", false).is_err());
        assert_eq!(origin_of("https://h:8443/a/b"), "https://h:8443");
        assert_eq!(url_path("https://h:8443/a/b"), "/a/b");
        assert_eq!(url_path("https://h"), "");
    }

    #[test]
    fn http_dates() {
        assert_eq!(
            parse_http_date("Sun, 06 Nov 1994 08:49:37 GMT"),
            Some(784_111_777_000.0)
        );
        assert_eq!(parse_http_date("Thu, 01 Jan 1970 00:00:00 GMT"), Some(0.0));
        assert_eq!(parse_http_date("yesterday"), None);
    }

    #[test]
    fn secrets_are_redacted_and_errors_map_statuses() {
        let auth = ConnectorAuth::Basic {
            username: "alice".into(),
            password: "s3cret".into(),
        };
        let dbg = format!("{auth:?}");
        assert!(dbg.contains("alice") && !dbg.contains("s3cret"), "{dbg}");
        let bearer = format!(
            "{:?}",
            ConnectorAuth::Bearer {
                token: "tok".into()
            }
        );
        assert!(!bearer.contains("tok\""), "{bearer}");
        assert_eq!(
            ConnectorError::from_status(412, "PUT").kind,
            ConnectorErrorKind::Conflict
        );
        assert_eq!(
            ConnectorError::from_status(401, "GET").kind,
            ConnectorErrorKind::Auth
        );
        assert_eq!(
            ConnectorError::from_status(500, "GET").kind,
            ConnectorErrorKind::Http
        );
        let json = serde_json::to_value(ConnectorError::from_status(404, "GET")).unwrap();
        assert_eq!(json["kind"], "notFound");
        assert_eq!(json["status"], 404);
        let target: ConnectorTarget = serde_json::from_value(serde_json::json!({
            "baseUrl": "https://h", "auth": { "kind": "basic", "username": "u", "password": "p" }
        }))
        .unwrap();
        assert!(!target.allow_http);
        assert_eq!(target.root_path, "");
    }
}
