//! The desktop WebDAV transport (P8-36, feature `webdav`): PROPFIND
//! (depth 0/1), GET, PUT with `If-Match` / `If-None-Match`, MKCOL, DELETE
//! and MOVE against a user-configured server, Basic or Bearer auth.
//!
//! HTTPS only unless the connection allows plain HTTP (LAN servers);
//! redirects are followed only to the same origin and never from HTTPS to
//! HTTP, so the only host ever contacted is the one the user entered
//! (ADR 0009 amendment). The web transport
//! (`packages/ui-shared/src/connectors/webdav-fetch.ts`) has the same
//! semantics on `fetch`.

use std::time::Duration;

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::connector::{
    check_base_url, decode_percent, encode_path, normalize_path, origin_of, parse_http_date,
    url_path, ConnectorAuth, ConnectorEntry, ConnectorError, ConnectorErrorKind, ConnectorTarget,
    EntryKind,
};

/// The PROPFIND body: the properties a listing needs.
pub const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getetag/></d:prop></d:propfind>"#;

/// One `<d:response>` of a multistatus reply.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DavResponse {
    /// The `href` as sent (percent-encoded; absolute path or full URL).
    pub href: String,
    pub collection: bool,
    pub display_name: Option<String>,
    pub size: Option<f64>,
    pub modified: Option<String>,
    pub etag: Option<String>,
}

fn local(qname: &[u8]) -> &[u8] {
    match qname.iter().rposition(|&b| b == b':') {
        Some(i) => &qname[i + 1..],
        None => qname,
    }
}

/// Parses a `207 Multi-Status` body. Properties count only from
/// `propstat`s whose status is 2xx (servers list missing ones under 404).
pub fn parse_multistatus(xml: &str) -> Result<Vec<DavResponse>, ConnectorError> {
    let bad = |e: String| {
        ConnectorError::new(
            ConnectorErrorKind::Invalid,
            format!("bad PROPFIND reply: {e}"),
        )
    };
    let mut reader = Reader::from_str(xml);
    let mut out = Vec::new();
    let mut path: Vec<Vec<u8>> = Vec::new();
    let mut cur: Option<DavResponse> = None;
    // Properties of the current propstat, applied when its status is 2xx.
    let mut props = DavResponse::default();
    let mut status_ok = true;
    let mut text = String::new();
    loop {
        let ev = reader.read_event().map_err(|e| bad(e.to_string()))?;
        match ev {
            Event::Start(s) => {
                let name = local(s.name().as_ref().as_bytes()).to_vec();
                match name.as_slice() {
                    b"response" => cur = Some(DavResponse::default()),
                    b"propstat" => {
                        props = DavResponse::default();
                        status_ok = true;
                    }
                    b"collection" if path.last().map(Vec::as_slice) == Some(b"resourcetype") => {
                        props.collection = true;
                    }
                    _ => {}
                }
                path.push(name);
                text.clear();
            }
            Event::Empty(s) => {
                let name = local(s.name().as_ref().as_bytes()).to_vec();
                if name == b"collection" && path.last().map(Vec::as_slice) == Some(b"resourcetype")
                {
                    props.collection = true;
                }
            }
            Event::Text(t) => text.push_str(&t.xml10_content()),
            Event::CData(t) => text.push_str(&t.xml10_content()),
            Event::GeneralRef(r) => {
                if let Ok(Some(c)) = r.resolve_char_ref() {
                    text.push(c);
                } else if let Some(s) = quick_xml::escape::resolve_predefined_entity(&r) {
                    text.push_str(s);
                }
            }
            Event::End(_) => {
                let Some(name) = path.pop() else { continue };
                let parent = path.last().map(Vec::as_slice);
                let value = text.trim().to_owned();
                match (name.as_slice(), parent) {
                    (b"href", Some(b"response")) => {
                        if let Some(c) = cur.as_mut() {
                            c.href = value;
                        }
                    }
                    (b"status", Some(b"propstat")) => {
                        status_ok = value
                            .split_whitespace()
                            .nth(1)
                            .is_some_and(|c| c.starts_with('2'));
                    }
                    (b"displayname", Some(b"prop")) if !value.is_empty() => {
                        props.display_name = Some(value)
                    }
                    (b"getcontentlength", Some(b"prop")) => props.size = value.parse().ok(),
                    (b"getlastmodified", Some(b"prop")) if !value.is_empty() => {
                        props.modified = Some(value)
                    }
                    (b"getetag", Some(b"prop")) if !value.is_empty() => props.etag = Some(value),
                    (b"propstat", _) => {
                        if let (Some(c), true) = (cur.as_mut(), status_ok) {
                            let p = std::mem::take(&mut props);
                            c.collection |= p.collection;
                            c.display_name = c.display_name.take().or(p.display_name);
                            c.size = c.size.or(p.size);
                            c.modified = c.modified.take().or(p.modified);
                            c.etag = c.etag.take().or(p.etag);
                        }
                    }
                    (b"response", _) => {
                        if let Some(c) = cur.take() {
                            if !c.href.is_empty() {
                                out.push(c);
                            }
                        }
                    }
                    _ => {}
                }
                text.clear();
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(out)
}

/// Maps a response `href` to a connection-relative path: the decoded URL
/// path with the decoded `prefix` (base URL path + root folder) removed.
/// `None` when the href lies outside the prefix.
pub fn href_to_path(href: &str, prefix: &str) -> Option<String> {
    let path = if href.contains("://") {
        url_path(href)
    } else {
        href
    };
    let path = decode_percent(path);
    let prefix = decode_percent(prefix);
    let prefix = prefix.trim_end_matches('/');
    let rest = path.strip_prefix(prefix)?;
    if !(rest.is_empty() || rest.starts_with('/')) {
        return None;
    }
    normalize_path(rest).ok()
}

/// Turns parsed responses into entries (the folder itself is skipped when `skip` is its path).
pub fn entries_of(
    responses: Vec<DavResponse>,
    prefix: &str,
    skip: Option<&str>,
) -> Vec<ConnectorEntry> {
    responses
        .into_iter()
        .filter_map(|r| {
            let path = href_to_path(&r.href, prefix)?;
            if skip == Some(path.as_str()) {
                return None;
            }
            let last = path.rsplit('/').next().unwrap_or("").to_owned();
            Some(ConnectorEntry {
                name: if last.is_empty() {
                    r.display_name.clone().unwrap_or_default()
                } else {
                    last
                },
                kind: if r.collection {
                    EntryKind::Folder
                } else {
                    EntryKind::File
                },
                size: if r.collection { None } else { r.size },
                modified: r.modified.as_deref().and_then(parse_http_date),
                etag: r.etag,
                path,
            })
        })
        .collect()
}

/// A WebDAV server. Cheap to create per request batch: the HTTP client
/// (connection pool, TLS config) is shared.
pub struct WebDavClient {
    http: reqwest::Client,
    /// `https://host/dav` + encoded root folder, no trailing `/`.
    base: String,
    auth: ConnectorAuth,
    origin: String,
}

/// The shared HTTP client: rustls, timeouts, and redirects only within
/// one origin and never down to plain HTTP.
pub fn http_client() -> Result<reqwest::Client, ConnectorError> {
    // rustls' process-wide crypto provider (`ring`); already installed is fine.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let policy = reqwest::redirect::Policy::custom(|attempt| {
        let first = attempt.previous().first().cloned();
        let ok = attempt.previous().len() < 5
            && first.is_some_and(|f| {
                f.scheme() == attempt.url().scheme()
                    && f.host_str() == attempt.url().host_str()
                    && f.port_or_known_default() == attempt.url().port_or_known_default()
            });
        if ok {
            attempt.follow()
        } else {
            attempt.stop()
        }
    });
    reqwest::Client::builder()
        .redirect(policy)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .user_agent(concat!("Rusuite/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| ConnectorError::new(ConnectorErrorKind::Network, e.to_string()))
}

fn net(e: reqwest::Error) -> ConnectorError {
    // reqwest's Display omits the cause chain ("error sending request").
    let mut msg = e.to_string();
    let mut src = std::error::Error::source(&e);
    while let Some(s) = src {
        msg.push_str(": ");
        msg.push_str(&s.to_string());
        src = s.source();
    }
    ConnectorError::new(ConnectorErrorKind::Network, msg)
}

fn method(name: &str) -> reqwest::Method {
    reqwest::Method::from_bytes(name.as_bytes()).unwrap_or(reqwest::Method::GET)
}

impl WebDavClient {
    /// Checks the target (HTTPS unless allowed) and builds the client.
    pub fn new(http: reqwest::Client, target: &ConnectorTarget) -> Result<Self, ConnectorError> {
        let base = check_base_url(&target.base_url, target.allow_http)?;
        let root = normalize_path(&target.root_path)?;
        let origin = origin_of(&base).to_owned();
        let base = if root == "/" {
            base
        } else {
            format!("{base}{}", encode_path(&root))
        };
        Ok(WebDavClient {
            http,
            base,
            auth: target.auth.clone(),
            origin,
        })
    }

    /// The URL of a connection-relative path (folders with a trailing `/`).
    pub fn url(&self, path: &str, folder: bool) -> Result<String, ConnectorError> {
        let p = normalize_path(path)?;
        let mut url = if p == "/" {
            format!("{}/", self.base)
        } else {
            format!("{}{}", self.base, encode_path(&p))
        };
        if folder && !url.ends_with('/') {
            url.push('/');
        }
        Ok(url)
    }

    /// The URL path that `href`s start with.
    fn prefix(&self) -> &str {
        url_path(&self.base)
    }

    fn request(&self, m: &str, url: &str) -> reqwest::RequestBuilder {
        let rb = self.http.request(method(m), url);
        match &self.auth {
            ConnectorAuth::Basic { username, password } => rb.basic_auth(username, Some(password)),
            ConnectorAuth::Bearer { token } => rb.bearer_auth(token),
            ConnectorAuth::None => rb,
        }
    }

    async fn send(
        &self,
        rb: reqwest::RequestBuilder,
        m: &str,
    ) -> Result<reqwest::Response, ConnectorError> {
        let res = rb.send().await.map_err(net)?;
        if !res.url().as_str().starts_with(&self.origin) {
            return Err(ConnectorError::new(
                ConnectorErrorKind::Insecure,
                "the server redirected to another host",
            ));
        }
        let status = res.status().as_u16();
        if (300..400).contains(&status) {
            return Err(ConnectorError::new(
                ConnectorErrorKind::Insecure,
                format!(
                    "{m}: the server redirected to another host or to plain HTTP (HTTP {status})"
                ),
            ));
        }
        if !res.status().is_success() {
            return Err(ConnectorError::from_status(status, m));
        }
        Ok(res)
    }

    async fn propfind(&self, path: &str, depth: &str) -> Result<Vec<DavResponse>, ConnectorError> {
        let url = self.url(path, true)?;
        let rb = self
            .request("PROPFIND", &url)
            .header("Depth", depth)
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(PROPFIND_BODY);
        let res = self.send(rb, "PROPFIND").await?;
        let body = res.text().await.map_err(net)?;
        parse_multistatus(&body)
    }

    /// The entries of a folder (PROPFIND depth 1, the folder itself skipped).
    pub async fn list(&self, path: &str) -> Result<Vec<ConnectorEntry>, ConnectorError> {
        let p = normalize_path(path)?;
        let all = self.propfind(&p, "1").await?;
        Ok(entries_of(all, self.prefix(), Some(&p)))
    }

    /// One entry (PROPFIND depth 0).
    pub async fn stat(&self, path: &str) -> Result<ConnectorEntry, ConnectorError> {
        let p = normalize_path(path)?;
        let url = self.url(&p, false)?;
        let rb = self
            .request("PROPFIND", &url)
            .header("Depth", "0")
            .header("Content-Type", "application/xml; charset=utf-8")
            .body(PROPFIND_BODY);
        let res = self.send(rb, "PROPFIND").await?;
        let body = res.text().await.map_err(net)?;
        let mut entries = entries_of(parse_multistatus(&body)?, self.prefix(), None);
        if entries.is_empty() {
            return Err(ConnectorError::new(
                ConnectorErrorKind::NotFound,
                format!("{p} not found"),
            ));
        }
        let mut e = entries.swap_remove(0);
        // The root's name is the connection's (empty here).
        e.path = p;
        Ok(e)
    }

    /// File contents and their entity tag.
    pub async fn read(&self, path: &str) -> Result<(Vec<u8>, Option<String>), ConnectorError> {
        let url = self.url(path, false)?;
        let res = self.send(self.request("GET", &url), "GET").await?;
        let etag = header(&res, "etag");
        let bytes = res.bytes().await.map_err(net)?;
        Ok((bytes.to_vec(), etag))
    }

    /// Writes a file. `if_match`: only when the server's version still has
    /// this entity tag; `if_none_match`: only when the file does not exist
    /// (both refused with a `Conflict` error). Returns the new entity tag
    /// (asked with a PROPFIND when the PUT reply has none).
    pub async fn write(
        &self,
        path: &str,
        bytes: Vec<u8>,
        if_match: Option<&str>,
        if_none_match: bool,
    ) -> Result<Option<String>, ConnectorError> {
        let url = self.url(path, false)?;
        let mut rb = self
            .request("PUT", &url)
            .header("Content-Type", "application/octet-stream")
            .body(bytes);
        if let Some(tag) = if_match {
            rb = rb.header("If-Match", tag);
        }
        if if_none_match {
            rb = rb.header("If-None-Match", "*");
        }
        let res = self.send(rb, "PUT").await?;
        if let Some(tag) = header(&res, "etag") {
            return Ok(Some(tag));
        }
        Ok(self.stat(path).await.ok().and_then(|e| e.etag))
    }

    /// Creates a folder (MKCOL).
    pub async fn mkdir(&self, path: &str) -> Result<(), ConnectorError> {
        let url = self.url(path, true)?;
        match self.send(self.request("MKCOL", &url), "MKCOL").await {
            Err(e) if e.status == Some(405) => Err(ConnectorError {
                kind: ConnectorErrorKind::Conflict,
                status: Some(405),
                message: "a file or folder with this name already exists".into(),
            }),
            r => r.map(|_| ()),
        }
    }

    /// Deletes a file or a folder (with its contents).
    pub async fn delete(&self, path: &str) -> Result<(), ConnectorError> {
        let p = normalize_path(path)?;
        if p == "/" {
            return Err(ConnectorError::new(
                ConnectorErrorKind::Invalid,
                "the root folder cannot be deleted",
            ));
        }
        let url = self.url(&p, false)?;
        self.send(self.request("DELETE", &url), "DELETE")
            .await
            .map(|_| ())
    }

    /// Renames or moves (MOVE with `Destination`; `overwrite` false refuses an existing target).
    pub async fn rename(
        &self,
        from: &str,
        to: &str,
        overwrite: bool,
    ) -> Result<(), ConnectorError> {
        let src = self.url(from, false)?;
        let dst = self.url(to, false)?;
        let rb = self
            .request("MOVE", &src)
            .header("Destination", dst)
            .header("Overwrite", if overwrite { "T" } else { "F" });
        self.send(rb, "MOVE").await.map(|_| ())
    }
}

fn header(res: &reqwest::Response, name: &str) -> Option<String> {
    res.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    const MULTISTATUS: &str = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">
  <d:response>
    <d:href>/remote.php/dav/files/alice/Docs/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:getetag>"f0"</d:getetag></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/alice/Docs/Gr%C3%BC%C3%9Fe%20%26%20Co.xlsx</d:href>
    <d:propstat><d:prop><d:resourcetype/><d:getcontentlength>1234</d:getcontentlength>
      <d:getlastmodified>Sun, 06 Nov 1994 08:49:37 GMT</d:getlastmodified><d:getetag>&quot;e1&quot;</d:getetag></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
    <d:propstat><d:prop><d:displayname/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>https://cloud.example.com/remote.php/dav/files/alice/Docs/Sub/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection></d:collection></d:resourcetype><d:getcontentlength>9</d:getcontentlength></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <D:response xmlns:D="DAV:"><D:href>/elsewhere/x.docx</D:href></D:response>
</d:multistatus>"#;

    #[test]
    fn multistatus_parses_props_namespaces_and_escapes() {
        let all = parse_multistatus(MULTISTATUS).unwrap();
        assert_eq!(all.len(), 4);
        assert!(all[0].collection);
        assert_eq!(all[1].size, Some(1234.0));
        assert_eq!(all[1].etag.as_deref(), Some("\"e1\""));
        assert!(all[1].display_name.is_none(), "404 propstat ignored");
        let entries = entries_of(all, "/remote.php/dav/files/alice", Some("/Docs"));
        assert_eq!(entries.len(), 2, "{entries:?}");
        assert_eq!(entries[0].name, "Grüße & Co.xlsx");
        assert_eq!(entries[0].path, "/Docs/Grüße & Co.xlsx");
        assert_eq!(entries[0].kind, EntryKind::File);
        assert_eq!(entries[0].modified, Some(784_111_777_000.0));
        assert_eq!(entries[1].kind, EntryKind::Folder);
        assert_eq!(entries[1].path, "/Docs/Sub");
        assert_eq!(entries[1].size, None);
        assert!(parse_multistatus("<d:multistatus><d:response>").is_ok());
        assert!(parse_multistatus("<a></b>").is_err());
    }

    #[test]
    fn hrefs_map_to_relative_paths() {
        assert_eq!(
            href_to_path("/dav/a%20b/c.docx", "/dav").as_deref(),
            Some("/a b/c.docx")
        );
        assert_eq!(href_to_path("/dav/", "/dav/").as_deref(), Some("/"));
        assert_eq!(href_to_path("/davx/c", "/dav"), None);
        assert_eq!(href_to_path("/other", "/dav"), None);
        assert_eq!(
            href_to_path("http://h:1/r%C3%B6ot/x", "/r%C3%B6ot").as_deref(),
            Some("/x")
        );
        assert_eq!(href_to_path("/x", "").as_deref(), Some("/x"));
    }

    /// A request seen by the mock server.
    #[derive(Debug, Clone)]
    struct Seen {
        method: String,
        path: String,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
    }

    impl Seen {
        fn header(&self, name: &str) -> Option<&str> {
            self.headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.as_str())
        }
    }

    type Reply = (u16, Vec<(&'static str, String)>, Vec<u8>);

    /// A hand-rolled HTTP/1.1 server on 127.0.0.1 answering each request with `reply`.
    fn mock(
        reply: impl Fn(&Seen) -> Reply + Send + Sync + 'static,
    ) -> (String, Arc<Mutex<Vec<Seen>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let log = seen.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    continue;
                }
                let mut parts = line.split_whitespace();
                let method = parts.next().unwrap_or("").to_owned();
                let path = parts.next().unwrap_or("").to_owned();
                let mut headers = Vec::new();
                loop {
                    let mut h = String::new();
                    reader.read_line(&mut h).unwrap();
                    let h = h.trim_end();
                    if h.is_empty() {
                        break;
                    }
                    if let Some((k, v)) = h.split_once(':') {
                        headers.push((k.trim().to_owned(), v.trim().to_owned()));
                    }
                }
                let len: usize = headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                    .and_then(|(_, v)| v.parse().ok())
                    .unwrap_or(0);
                let mut body = vec![0; len];
                reader.read_exact(&mut body).unwrap();
                let req = Seen {
                    method,
                    path,
                    headers,
                    body,
                };
                let (status, hdrs, body) = reply(&req);
                log.lock().unwrap().push(req);
                let mut out = format!(
                    "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nConnection: close\r\n",
                    body.len()
                );
                for (k, v) in hdrs {
                    out.push_str(&format!("{k}: {v}\r\n"));
                }
                out.push_str("\r\n");
                let _ = stream.write_all(out.as_bytes());
                let _ = stream.write_all(&body);
            }
        });
        (format!("http://{addr}"), seen)
    }

    fn target(base: &str, allow_http: bool) -> ConnectorTarget {
        ConnectorTarget {
            base_url: format!("{base}/dav"),
            root_path: "/Team Files".into(),
            auth: ConnectorAuth::Basic {
                username: "alice".into(),
                password: "pw".into(),
            },
            allow_http,
        }
    }

    fn client(base: &str) -> WebDavClient {
        WebDavClient::new(http_client().unwrap(), &target(base, true)).unwrap()
    }

    #[test]
    fn plain_http_needs_the_explicit_allowance() {
        let err = WebDavClient::new(http_client().unwrap(), &target("http://nas.local", false))
            .err()
            .unwrap();
        assert_eq!(err.kind, ConnectorErrorKind::Insecure);
        let c = client("http://nas.local");
        assert_eq!(
            c.url("/a b/c.docx", false).unwrap(),
            "http://nas.local/dav/Team%20Files/a%20b/c.docx"
        );
        assert_eq!(
            c.url("/", true).unwrap(),
            "http://nas.local/dav/Team%20Files/"
        );
        assert!(c.url("/../x", false).is_err());
    }

    #[tokio::test]
    async fn list_sends_propfind_depth_1_with_basic_auth() {
        let (base, seen) = mock(|_| {
            let xml = r#"<d:multistatus xmlns:d="DAV:">
<d:response><d:href>/dav/Team%20Files/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
<d:response><d:href>/dav/Team%20Files/%E6%97%A5%E6%9C%AC.pptx</d:href><d:propstat><d:prop><d:getcontentlength>7</d:getcontentlength><d:getetag>"x"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>
</d:multistatus>"#;
            (
                207,
                vec![("Content-Type", "application/xml".into())],
                xml.as_bytes().to_vec(),
            )
        });
        let entries = client(&base).list("/").await.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "日本.pptx");
        assert_eq!(entries[0].path, "/日本.pptx");
        let req = seen.lock().unwrap()[0].clone();
        assert_eq!(req.method, "PROPFIND");
        assert_eq!(req.path, "/dav/Team%20Files/");
        assert_eq!(req.header("depth"), Some("1"));
        assert_eq!(req.header("authorization"), Some("Basic YWxpY2U6cHc="));
        assert!(String::from_utf8_lossy(&req.body).contains("getetag"));
    }

    #[tokio::test]
    async fn read_and_conditional_write() {
        let (base, seen) = mock(|req| match (req.method.as_str(), req.header("if-match")) {
            ("GET", _) => (200, vec![("ETag", "\"v1\"".into())], b"PK\x03\x04".to_vec()),
            ("PUT", Some("\"v1\"")) => (201, vec![("ETag", "\"v2\"".into())], vec![]),
            ("PUT", Some(_)) => (412, vec![], vec![]),
            ("PUT", None) if req.header("if-none-match") == Some("*") => (412, vec![], vec![]),
            _ => (204, vec![], vec![]),
        });
        let c = client(&base);
        let (bytes, etag) = c.read("/a.xlsx").await.unwrap();
        assert_eq!(bytes, b"PK\x03\x04");
        assert_eq!(etag.as_deref(), Some("\"v1\""));
        let tag = c
            .write("/a.xlsx", b"new".to_vec(), Some("\"v1\""), false)
            .await
            .unwrap();
        assert_eq!(tag.as_deref(), Some("\"v2\""));
        let err = c
            .write("/a.xlsx", b"new".to_vec(), Some("\"old\""), false)
            .await
            .unwrap_err();
        assert_eq!(
            (err.kind, err.status),
            (ConnectorErrorKind::Conflict, Some(412))
        );
        let err = c
            .write("/a.xlsx", b"new".to_vec(), None, true)
            .await
            .unwrap_err();
        assert_eq!(err.kind, ConnectorErrorKind::Conflict);
        let log = seen.lock().unwrap();
        assert_eq!(log[1].body, b"new");
        assert_eq!(log[1].path, "/dav/Team%20Files/a.xlsx");
    }

    #[tokio::test]
    async fn write_without_etag_asks_with_propfind_depth_0() {
        let (base, seen) = mock(|req| {
            match req.method.as_str() {
            "PUT" => (204, vec![], vec![]),
            _ => (
                207,
                vec![],
                br#"<multistatus xmlns="DAV:"><response><href>/dav/Team%20Files/n.docx</href><propstat><prop><getetag>"n1"</getetag></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>"#.to_vec(),
            ),
        }
        });
        let tag = client(&base)
            .write("/n.docx", vec![1, 2], None, false)
            .await
            .unwrap();
        assert_eq!(tag.as_deref(), Some("\"n1\""));
        let log = seen.lock().unwrap();
        assert_eq!(log[1].method, "PROPFIND");
        assert_eq!(log[1].header("depth"), Some("0"));
    }

    #[tokio::test]
    async fn mkdir_delete_move_and_errors() {
        let (base, seen) = mock(|req| match (req.method.as_str(), req.path.as_str()) {
            ("MKCOL", "/dav/Team%20Files/exists/") => (405, vec![], vec![]),
            ("MKCOL", _) => (201, vec![], vec![]),
            ("DELETE", "/dav/Team%20Files/gone") => (404, vec![], vec![]),
            ("DELETE", _) => (204, vec![], vec![]),
            ("MOVE", _) => (201, vec![], vec![]),
            ("GET", "/dav/Team%20Files/secret") => (401, vec![], vec![]),
            ("GET", _) => (
                302,
                vec![("Location", "https://evil.example/x".into())],
                vec![],
            ),
            _ => (500, vec![], vec![]),
        });
        let c = client(&base);
        c.mkdir("/New folder").await.unwrap();
        assert_eq!(
            c.mkdir("/exists").await.unwrap_err().kind,
            ConnectorErrorKind::Conflict
        );
        c.delete("/old.xlsx").await.unwrap();
        assert_eq!(
            c.delete("/gone").await.unwrap_err().kind,
            ConnectorErrorKind::NotFound
        );
        assert_eq!(
            c.delete("/").await.unwrap_err().kind,
            ConnectorErrorKind::Invalid
        );
        c.rename("/a.xlsx", "/b ü.xlsx", false).await.unwrap();
        assert_eq!(
            c.read("/secret").await.unwrap_err().kind,
            ConnectorErrorKind::Auth
        );
        // A redirect to another host is never followed.
        assert_eq!(
            c.read("/moved").await.unwrap_err().kind,
            ConnectorErrorKind::Insecure
        );
        let log = seen.lock().unwrap();
        assert_eq!(log[0].path, "/dav/Team%20Files/New%20folder/");
        let mv = log.iter().find(|r| r.method == "MOVE").unwrap();
        assert_eq!(
            mv.header("destination").unwrap(),
            format!("{base}/dav/Team%20Files/b%20%C3%BC.xlsx")
        );
        assert_eq!(mv.header("overwrite"), Some("F"));
        assert_eq!(log.iter().filter(|r| r.path.contains("evil")).count(), 0);
    }

    #[tokio::test]
    async fn unreachable_server_is_a_network_error() {
        // Port 9 on localhost: nothing listens.
        let c = client("http://127.0.0.1:9");
        assert_eq!(
            c.list("/").await.unwrap_err().kind,
            ConnectorErrorKind::Network
        );
    }
}
