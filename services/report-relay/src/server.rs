//! The HTTP side: routes, CORS (same site plus the desktop webviews), client IP, rate limits, one log line per request.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Instant;

use axum::body::Body;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde_json::{json, Value};

use crate::config::Config;
use crate::github::GitHub;
use crate::issue;
use crate::limits::{Clock, RateLimiter};
use crate::report::{Report, ReportError, BODY_LIMIT};

pub struct AppState {
    pub github: GitHub,
    pub limits: RateLimiter,
    pub allowed_origins: Vec<String>,
}

impl AppState {
    pub fn new(
        config: &Config,
        clock: Arc<dyn Clock>,
    ) -> Result<Arc<Self>, crate::github::GitHubError> {
        Ok(Arc::new(AppState {
            github: GitHub::new(config)?,
            limits: RateLimiter::new(clock),
            allowed_origins: config.allowed_origins(),
        }))
    }
}

/// `POST /api/report`, `OPTIONS /api/report` (preflight), `GET /api/report/health`.
pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/api/report", post(submit).options(preflight))
        .route("/api/report/health", get(health))
        // The body is read with its own limit in `submit` (to answer 413 with CORS headers and a log line).
        .layer(DefaultBodyLimit::disable())
        .with_state(state)
}

/// The client: nginx (on loopback) sets `X-Forwarded-For: $remote_addr`, so its first hop is the client. The header
/// is ignored from anyone else.
pub fn client_ip(peer: Option<SocketAddr>, headers: &HeaderMap) -> IpAddr {
    let peer = peer
        .map(|p| p.ip())
        .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
    if !peer.is_loopback() {
        return peer;
    }
    headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .and_then(|v| v.trim().parse().ok())
        .unwrap_or(peer)
}

enum OriginCheck {
    /// No `Origin` header (curl, a same-origin GET).
    None,
    Allowed(HeaderValue),
    Refused,
}

fn check_origin(state: &AppState, headers: &HeaderMap) -> OriginCheck {
    match headers.get(header::ORIGIN) {
        None => OriginCheck::None,
        Some(v) => match v.to_str() {
            Ok(s) if state.allowed_origins.iter().any(|o| o == s) => {
                OriginCheck::Allowed(v.clone())
            }
            _ => OriginCheck::Refused,
        },
    }
}

fn with_cors(mut res: Response, origin: &OriginCheck) -> Response {
    let h = res.headers_mut();
    h.insert(header::VARY, HeaderValue::from_static("Origin"));
    if let OriginCheck::Allowed(o) = origin {
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, o.clone());
    }
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    res
}

fn json_response(status: StatusCode, body: Value) -> Response {
    (status, axum::Json(body)).into_response()
}

fn error(status: StatusCode, message: impl Into<String>) -> Response {
    json_response(status, json!({ "error": message.into() }))
}

fn log(status: StatusCode, app: &str, kind: &str, instance: &str, started: Instant, note: &str) {
    eprintln!(
        "report status={} app={app} kind={kind} instance={instance} ms={}{}{note}",
        status.as_u16(),
        started.elapsed().as_millis(),
        if note.is_empty() { "" } else { " " },
    );
}

async fn health() -> Response {
    json_response(
        StatusCode::OK,
        json!({ "ok": true, "version": crate::VERSION }),
    )
}

async fn preflight(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Response {
    let origin = check_origin(&state, &headers);
    if matches!(origin, OriginCheck::Refused) {
        return with_cors(StatusCode::FORBIDDEN.into_response(), &origin);
    }
    let mut res = StatusCode::NO_CONTENT.into_response();
    let h = res.headers_mut();
    h.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("POST"),
    );
    h.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("content-type"),
    );
    h.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("600"),
    );
    with_cors(res, &origin)
}

async fn submit(State(state): State<Arc<AppState>>, req: Request<Body>) -> Response {
    let started = Instant::now();
    let headers = req.headers().clone();
    let origin = check_origin(&state, &headers);
    let peer = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0);
    let res = handle(&state, &origin, peer, &headers, req.into_body(), started).await;
    with_cors(res, &origin)
}

async fn handle(
    state: &AppState,
    origin: &OriginCheck,
    peer: Option<SocketAddr>,
    headers: &HeaderMap,
    body: Body,
    started: Instant,
) -> Response {
    if matches!(origin, OriginCheck::Refused) {
        log(StatusCode::FORBIDDEN, "-", "-", "-", started, "origin");
        return error(StatusCode::FORBIDDEN, "origin not allowed");
    }
    let Ok(bytes) = axum::body::to_bytes(body, BODY_LIMIT).await else {
        log(StatusCode::PAYLOAD_TOO_LARGE, "-", "-", "-", started, "");
        return error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "the report is larger than 8 MB",
        );
    };
    let (report, images) = match Report::parse(&bytes) {
        Ok(v) => v,
        Err(e) => {
            let status = match e {
                ReportError::TooLarge(_) => StatusCode::PAYLOAD_TOO_LARGE,
                _ => StatusCode::BAD_REQUEST,
            };
            log(status, "-", "-", "-", started, "");
            return error(status, e.to_string());
        }
    };
    let app = report.app.as_str();
    let kind = report.kind.as_str();
    let hash = issue::instance_hash(&report.instance_id);
    let ip = client_ip(peer, headers);
    let ticket = match state.limits.acquire(&report.instance_id, ip) {
        Ok(t) => t,
        Err(limited) => {
            log(
                StatusCode::TOO_MANY_REQUESTS,
                app,
                kind,
                &hash,
                started,
                limited.scope,
            );
            let mut res = json_response(
                StatusCode::TOO_MANY_REQUESTS,
                json!({ "error": "too many reports", "retryAfterSeconds": limited.retry_after_seconds }),
            );
            if let Ok(v) = HeaderValue::from_str(&limited.retry_after_seconds.to_string()) {
                res.headers_mut().insert(header::RETRY_AFTER, v);
            }
            return res;
        }
    };

    let gh = &state.github;
    let labels = issue::labels(&report);
    gh.ensure_labels(&labels).await;
    let mut attached = Vec::new();
    let mut dropped = false;
    let now = state.limits.now();
    for img in &images {
        let path = issue::attachment_path(now, img.ext);
        match gh.upload(&path, &img.bytes).await {
            Ok(url) => attached.push((img.name.clone(), url)),
            Err(e) => {
                eprintln!("report instance={hash} screenshot not attached: {e}");
                dropped = true;
                break;
            }
        }
    }
    let body = issue::body(&report, &attached, dropped);
    match gh
        .create_issue(&issue::title(&report), &body, &labels)
        .await
    {
        Ok(created) => {
            let mut out = json!({ "number": created.number, "url": created.url });
            if dropped {
                out["warnings"] = json!(["screenshots not attached"]);
            }
            log(
                StatusCode::CREATED,
                app,
                kind,
                &hash,
                started,
                if dropped { "screenshots-dropped" } else { "" },
            );
            json_response(StatusCode::CREATED, out)
        }
        Err(e) => {
            state.limits.release(ticket);
            log(
                StatusCode::BAD_GATEWAY,
                app,
                kind,
                &hash,
                started,
                &e.to_string().replace(' ', "_"),
            );
            error(StatusCode::BAD_GATEWAY, "GitHub did not accept the report")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forwarded_for_only_from_loopback() {
        let mut h = HeaderMap::new();
        h.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.7, 10.0.0.1"),
        );
        let local: SocketAddr = "127.0.0.1:5000".parse().unwrap();
        let remote: SocketAddr = "198.51.100.2:5000".parse().unwrap();
        assert_eq!(client_ip(Some(local), &h).to_string(), "203.0.113.7");
        assert_eq!(client_ip(Some(remote), &h).to_string(), "198.51.100.2");
        assert_eq!(
            client_ip(Some(local), &HeaderMap::new()).to_string(),
            "127.0.0.1"
        );
        h.insert("x-forwarded-for", HeaderValue::from_static("garbage"));
        assert_eq!(client_ip(Some(local), &h).to_string(), "127.0.0.1");
    }
}
