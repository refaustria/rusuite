//! The relay against a mock GitHub (hand-rolled axum server on a random local port).

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Router;
use base64::Engine as _;
use report_relay::{router, AppState, Config, ManualClock};
use serde_json::{json, Value};

const TOKEN: &str = "test-token-not-real-0123456789";
const INSTANCE: &str = "3f2b8c1e-9d4a-4e7b-8a6f-0c1d2e3f4a5b";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

#[derive(Clone, Debug)]
struct Call {
    method: String,
    path: String,
    auth: Option<String>,
    body: Value,
}

#[derive(Clone)]
struct Mock {
    calls: Arc<Mutex<Vec<Call>>>,
    branch_exists: bool,
    contents_status: u16,
    issue_status: u16,
    labels_status: u16,
}

impl Default for Mock {
    fn default() -> Self {
        Mock {
            calls: Arc::default(),
            branch_exists: true,
            contents_status: 201,
            issue_status: 201,
            labels_status: 201,
        }
    }
}

impl Mock {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
    fn paths(&self) -> Vec<String> {
        self.calls()
            .iter()
            .map(|c| format!("{} {}", c.method, c.path))
            .collect()
    }
}

async fn mock_handler(State(m): State<Mock>, req: Request) -> Response {
    let method = req.method().to_string();
    let path = req.uri().path().to_owned();
    let auth = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let bytes = axum::body::to_bytes(req.into_body(), 64 << 20)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    m.calls.lock().unwrap().push(Call {
        method: method.clone(),
        path: path.clone(),
        auth,
        body,
    });
    let reply = |status: u16, v: Value| {
        (StatusCode::from_u16(status).unwrap(), axum::Json(v)).into_response()
    };
    let p = path.trim_start_matches("/repos/o/r");
    match (method.as_str(), p) {
        ("POST", "/labels") => reply(m.labels_status, json!({})),
        ("GET", r) if r.starts_with("/git/ref/heads/") => {
            if m.branch_exists {
                reply(200, json!({ "object": { "sha": "abc" } }))
            } else {
                reply(404, json!({}))
            }
        }
        ("POST", "/git/trees") => reply(201, json!({ "sha": "tree1" })),
        ("POST", "/git/commits") => reply(201, json!({ "sha": "commit1" })),
        ("POST", "/git/refs") => reply(201, json!({ "ref": "refs/heads/issue-attachments" })),
        ("PUT", c) if c.starts_with("/contents/") => {
            reply(m.contents_status, json!({ "content": {} }))
        }
        ("POST", "/issues") => {
            if m.issue_status == 201 {
                reply(
                    201,
                    json!({ "number": 42, "html_url": "https://github.com/o/r/issues/42" }),
                )
            } else {
                reply(m.issue_status, json!({ "message": "Bad credentials" }))
            }
        }
        _ => reply(404, json!({})),
    }
}

struct Harness {
    base: String,
    mock: Mock,
    clock: ManualClock,
    http: reqwest::Client,
}

async fn serve(app: Router) -> SocketAddr {
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(l, app.into_make_service_with_connect_info::<SocketAddr>())
            .await
            .unwrap();
    });
    addr
}

async fn start(mock: Mock) -> Harness {
    let gh = serve(
        Router::new()
            .fallback(mock_handler)
            .with_state(mock.clone()),
    )
    .await;
    let mut config = Config::new(TOKEN, "o/r");
    config.github_api = format!("http://{gh}");
    let clock = ManualClock::new(1_792_108_800);
    let state = AppState::new(&config, Arc::new(clock.clone())).unwrap();
    let relay = serve(router(state)).await;
    Harness {
        base: format!("http://{relay}"),
        mock,
        clock,
        http: reqwest::Client::new(),
    }
}

fn report() -> Value {
    json!({
        "app": "write", "appVersion": "0.1.0", "platform": "desktop", "os": "Windows", "locale": "de",
        "instanceId": INSTANCE, "kind": "bug", "title": "Table borders vanish",
        "description": "After saving, the table borders are gone when reopening the file.",
        "steps": "1. Insert table\n2. Save", "diagnostics": { "userAgent": "UA", "docStats": { "blocks": 12 } },
        "screenshots": []
    })
}

fn with_shot(mut v: Value) -> Value {
    v["screenshots"] = json!([{ "name": "shot.png", "mime": "image/png",
        "dataBase64": base64::engine::general_purpose::STANDARD.encode(PNG) }]);
    v
}

impl Harness {
    async fn post(
        &self,
        v: &Value,
        origin: Option<&str>,
        xff: Option<&str>,
    ) -> (u16, Value, reqwest::header::HeaderMap) {
        let mut rb = self
            .http
            .post(format!("{}/api/report", self.base))
            .header("content-type", "application/json");
        if let Some(o) = origin {
            rb = rb.header("origin", o);
        }
        if let Some(x) = xff {
            rb = rb.header("x-forwarded-for", x);
        }
        let res = rb.body(v.to_string()).send().await.unwrap();
        let status = res.status().as_u16();
        let headers = res.headers().clone();
        let text = res.text().await.unwrap();
        (
            status,
            serde_json::from_str(&text).unwrap_or(Value::Null),
            headers,
        )
    }
}

#[tokio::test]
async fn health() {
    let h = start(Mock::default()).await;
    let text = h
        .http
        .get(format!("{}/api/report/health", h.base))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        v,
        json!({ "ok": true, "version": env!("CARGO_PKG_VERSION") })
    );
}

#[tokio::test]
async fn creates_an_issue_with_labels_and_a_screenshot() {
    let h = start(Mock::default()).await;
    let (status, v, headers) = h
        .post(&with_shot(report()), Some("https://rusuit.es"), None)
        .await;
    assert_eq!(status, 201, "{v}");
    assert_eq!(
        v,
        json!({ "number": 42, "url": "https://github.com/o/r/issues/42" })
    );
    assert_eq!(headers["access-control-allow-origin"], "https://rusuit.es");
    let calls = h.mock.calls();
    assert!(calls
        .iter()
        .all(|c| c.auth.as_deref() == Some(&format!("Bearer {TOKEN}")[..])));
    assert!(
        calls.iter().all(|c| !c.path.contains(TOKEN)),
        "token never in a URL"
    );
    let labels: Vec<_> = calls
        .iter()
        .filter(|c| c.path == "/repos/o/r/labels")
        .map(|c| c.body["name"].clone())
        .collect();
    assert_eq!(
        labels,
        [json!("from-app"), json!("app:write"), json!("kind:bug")]
    );
    let put = calls.iter().find(|c| c.method == "PUT").unwrap();
    assert!(
        put.path.starts_with("/repos/o/r/contents/reports/2026/10/") && put.path.ends_with(".png"),
        "{}",
        put.path
    );
    assert_eq!(put.body["branch"], "issue-attachments");
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(put.body["content"].as_str().unwrap())
            .unwrap(),
        PNG
    );
    let issue = calls
        .iter()
        .find(|c| c.path == "/repos/o/r/issues")
        .unwrap();
    assert_eq!(issue.body["title"], "[write] Table borders vanish");
    assert_eq!(
        issue.body["labels"],
        json!(["from-app", "app:write", "kind:bug"])
    );
    let body = issue.body["body"].as_str().unwrap();
    let path = put.path.trim_start_matches("/repos/o/r/contents/");
    assert!(body.contains(&format!(
        "![shot.png](https://raw.githubusercontent.com/o/r/issue-attachments/{path})"
    )));
    assert!(body.contains("**Platform:** desktop · Windows · de"));
    assert!(body.contains("| Document | 12 blocks |"));
}

#[tokio::test]
async fn labels_are_created_once() {
    let h = start(Mock::default()).await;
    assert_eq!(h.post(&report(), None, None).await.0, 201);
    let mut second = report();
    second["instanceId"] = json!("9a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d");
    assert_eq!(h.post(&second, None, None).await.0, 201);
    assert_eq!(
        h.mock
            .paths()
            .iter()
            .filter(|p| p.ends_with("/labels"))
            .count(),
        3
    );
}

#[tokio::test]
async fn label_failures_are_tolerated() {
    let h = start(Mock {
        labels_status: 403,
        ..Mock::default()
    })
    .await;
    assert_eq!(h.post(&report(), None, None).await.0, 201);
}

#[tokio::test]
async fn creates_the_attachments_branch_when_missing() {
    let h = start(Mock {
        branch_exists: false,
        ..Mock::default()
    })
    .await;
    assert_eq!(h.post(&with_shot(report()), None, None).await.0, 201);
    let paths = h.mock.paths();
    let pos = |p: &str| {
        paths
            .iter()
            .position(|x| x == p)
            .unwrap_or_else(|| panic!("{p} in {paths:?}"))
    };
    assert!(pos("POST /repos/o/r/git/trees") < pos("POST /repos/o/r/git/commits"));
    assert!(pos("POST /repos/o/r/git/commits") < pos("POST /repos/o/r/git/refs"));
    let calls = h.mock.calls();
    let commit = calls
        .iter()
        .find(|c| c.path.ends_with("/git/commits"))
        .unwrap();
    assert_eq!(commit.body["parents"], json!([]), "an orphan commit");
    let r = calls
        .iter()
        .find(|c| c.path.ends_with("/git/refs"))
        .unwrap();
    assert_eq!(r.body["ref"], "refs/heads/issue-attachments");
}

#[tokio::test]
async fn contents_forbidden_creates_the_issue_without_images() {
    let h = start(Mock {
        contents_status: 403,
        ..Mock::default()
    })
    .await;
    let (status, v, _) = h.post(&with_shot(report()), None, None).await;
    assert_eq!(status, 201);
    assert_eq!(v["warnings"], json!(["screenshots not attached"]));
    let calls = h.mock.calls();
    let issue = calls
        .iter()
        .find(|c| c.path == "/repos/o/r/issues")
        .unwrap();
    let body = issue.body["body"].as_str().unwrap();
    assert!(!body.contains("raw.githubusercontent.com"));
    assert!(body.contains("could not be attached"));
}

#[tokio::test]
async fn github_failure_is_502_without_echo_and_frees_the_slot() {
    let h = start(Mock {
        issue_status: 401,
        ..Mock::default()
    })
    .await;
    let (status, v, _) = h.post(&report(), None, None).await;
    assert_eq!(status, 502);
    assert_eq!(v, json!({ "error": "GitHub did not accept the report" }));
    let text = v.to_string();
    assert!(
        !text.contains(TOKEN) && !text.contains("Bad credentials") && !text.contains("borders")
    );
    // The failed report did not use up the instance's hourly slot.
    assert_eq!(h.post(&report(), None, None).await.0, 502);
}

#[tokio::test]
async fn one_report_per_instance_per_hour() {
    let h = start(Mock::default()).await;
    assert_eq!(h.post(&report(), None, None).await.0, 201);
    h.clock.advance(600);
    let (status, v, headers) = h.post(&report(), None, None).await;
    assert_eq!(status, 429);
    assert_eq!(v["retryAfterSeconds"], 3000);
    assert_eq!(headers["retry-after"], "3000");
    h.clock.advance(3000);
    assert_eq!(h.post(&report(), None, None).await.0, 201);
}

#[tokio::test]
async fn five_per_forwarded_ip() {
    let h = start(Mock::default()).await;
    let ids = [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444",
        "55555555-5555-4555-8555-555555555555",
        "66666666-6666-4666-8666-666666666666",
    ];
    for (i, id) in ids.iter().enumerate() {
        let mut v = report();
        v["instanceId"] = json!(id);
        let (status, _, _) = h.post(&v, None, Some("203.0.113.9")).await;
        assert_eq!(status, if i < 5 { 201 } else { 429 }, "report {i}");
    }
    // Another client is not affected.
    let mut v = report();
    v["instanceId"] = json!(ids[5]);
    assert_eq!(h.post(&v, None, Some("203.0.113.10")).await.0, 201);
}

#[tokio::test]
async fn validation_errors_are_400_and_reach_no_github() {
    let h = start(Mock::default()).await;
    let mut v = report();
    v["description"] = json!("short");
    let (status, body, _) = h.post(&v, None, None).await;
    assert_eq!(status, 400);
    assert!(body["error"].as_str().unwrap().starts_with("description:"));
    let mut v = report();
    v["documentText"] = json!("confidential");
    assert_eq!(h.post(&v, None, None).await.0, 400);
    assert!(h.mock.calls().is_empty());
    // A refused report does not count against the limit.
    assert_eq!(h.post(&report(), None, None).await.0, 201);
}

#[tokio::test]
async fn oversized_bodies_are_413() {
    let h = start(Mock::default()).await;
    let mut v = report();
    v["screenshots"] =
        json!([{ "name": "x.png", "mime": "image/png", "dataBase64": "A".repeat(9 << 20) }]);
    assert_eq!(h.post(&v, None, None).await.0, 413);
    let mut big = PNG.to_vec();
    big.resize(2 * 1024 * 1024 + 10, 0);
    let mut v = report();
    v["screenshots"] = json!([{ "name": "x.png", "mime": "image/png",
        "dataBase64": base64::engine::general_purpose::STANDARD.encode(&big) }]);
    assert_eq!(h.post(&v, None, None).await.0, 413);
    assert!(h.mock.calls().is_empty());
}

#[tokio::test]
async fn origins_desktop_allowed_others_refused() {
    let h = start(Mock::default()).await;
    let (status, _, headers) = h.post(&report(), Some("tauri://localhost"), None).await;
    assert_eq!(status, 201);
    assert_eq!(headers["access-control-allow-origin"], "tauri://localhost");
    let (status, _, headers) = h.post(&report(), Some("https://evil.example"), None).await;
    assert_eq!(status, 403);
    assert!(headers.get("access-control-allow-origin").is_none());
}

#[tokio::test]
async fn preflight() {
    let h = start(Mock::default()).await;
    let res = h
        .http
        .request(reqwest::Method::OPTIONS, format!("{}/api/report", h.base))
        .header("origin", "https://tauri.localhost")
        .header("access-control-request-method", "POST")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 204);
    assert_eq!(
        res.headers()["access-control-allow-origin"],
        "https://tauri.localhost"
    );
    assert_eq!(res.headers()["access-control-allow-methods"], "POST");
    let res = h
        .http
        .request(reqwest::Method::OPTIONS, format!("{}/api/report", h.base))
        .header("origin", "http://localhost:9999")
        .send()
        .await
        .unwrap();
    assert_eq!(res.status().as_u16(), 403);
}
