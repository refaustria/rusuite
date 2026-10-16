//! The GitHub REST calls of the relay. The token goes only into the `Authorization` header – never into a URL, a log
//! line or an error message; errors carry the endpoint kind and the HTTP status only.

use std::collections::HashSet;
use std::time::Duration;

use base64::Engine as _;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::config::Config;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GitHubError {
    /// GitHub answered with an unexpected status.
    #[error("GitHub {what}: HTTP {status}")]
    Status { what: &'static str, status: u16 },
    /// No answer (network, TLS, timeout) – the cause, never the request.
    #[error("GitHub {what}: {message}")]
    Transport { what: &'static str, message: String },
}

impl GitHubError {
    pub fn status(&self) -> Option<u16> {
        match self {
            GitHubError::Status { status, .. } => Some(*status),
            GitHubError::Transport { .. } => None,
        }
    }
}

/// A created issue.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Issue {
    pub number: u64,
    pub url: String,
}

const LABEL_COLORS: [(&str, &str); 1] = [("from-app", "5319e7")];

fn label_color(name: &str) -> &'static str {
    if let Some((_, c)) = LABEL_COLORS.iter().find(|(n, _)| *n == name) {
        return c;
    }
    match name.split(':').next() {
        Some("app") => "0e8a16",
        Some("kind") => "fbca04",
        _ => "ededed",
    }
}

pub struct GitHub {
    http: reqwest::Client,
    token: String,
    api: String,
    repo: String,
    branch: String,
    /// Labels known to exist (created or found once per process).
    labels: Mutex<HashSet<String>>,
    /// The attachments branch is known to exist.
    branch_ready: Mutex<bool>,
}

#[derive(Deserialize)]
struct Sha {
    sha: String,
}

#[derive(Deserialize)]
struct CreatedIssue {
    number: u64,
    html_url: String,
}

fn transport(what: &'static str, e: reqwest::Error) -> GitHubError {
    // The URL is not secret (no token in it), but keep the message short and request-free.
    let message = if e.is_timeout() {
        "timed out".to_owned()
    } else if e.is_connect() {
        "could not connect".to_owned()
    } else {
        "request failed".to_owned()
    };
    GitHubError::Transport { what, message }
}

impl GitHub {
    pub fn new(config: &Config) -> Result<Self, GitHubError> {
        // rustls' process-wide crypto provider (`ring`); already installed is fine.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder()
            .user_agent(concat!("rusuite-report-relay/", env!("CARGO_PKG_VERSION")))
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| transport("client", e))?;
        Ok(GitHub {
            http,
            token: config.github_token.clone(),
            api: config.github_api.trim_end_matches('/').to_owned(),
            repo: config.github_repo.clone(),
            branch: config.attachment_branch.clone(),
            labels: Mutex::new(HashSet::new()),
            branch_ready: Mutex::new(false),
        })
    }

    pub fn repo(&self) -> &str {
        &self.repo
    }

    fn url(&self, path: &str) -> String {
        format!("{}/repos/{}{path}", self.api, self.repo)
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.http
            .request(method, self.url(path))
            .bearer_auth(&self.token)
            .header("accept", "application/vnd.github+json")
            .header("x-github-api-version", "2022-11-28")
    }

    async fn send(
        &self,
        what: &'static str,
        method: reqwest::Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<(u16, Vec<u8>), GitHubError> {
        let mut rb = self.request(method, path);
        if let Some(b) = body {
            rb = rb
                .header("content-type", "application/json")
                .body(b.to_string());
        }
        let res = rb.send().await.map_err(|e| transport(what, e))?;
        let status = res.status().as_u16();
        let bytes = res.bytes().await.map_err(|e| transport(what, e))?;
        Ok((status, bytes.to_vec()))
    }

    /// Creates the labels not yet known to exist. Failures are tolerated (the issue is created anyway).
    pub async fn ensure_labels(&self, names: &[String]) {
        let mut known = self.labels.lock().await;
        for name in names {
            if known.contains(name) {
                continue;
            }
            let body = json!({ "name": name, "color": label_color(name) });
            match self
                .send("labels", reqwest::Method::POST, "/labels", Some(&body))
                .await
            {
                // 422: it exists already.
                Ok((201 | 422, _)) => {
                    known.insert(name.clone());
                }
                Ok((status, _)) => eprintln!("github labels: HTTP {status} (ignored)"),
                Err(e) => eprintln!("{e} (ignored)"),
            }
        }
    }

    /// Makes sure the attachments branch exists: a root commit with a README when it is missing.
    async fn ensure_branch(&self) -> Result<(), GitHubError> {
        let mut ready = self.branch_ready.lock().await;
        if *ready {
            return Ok(());
        }
        let what = "attachments branch";
        let (status, _) = self
            .send(
                what,
                reqwest::Method::GET,
                &format!("/git/ref/heads/{}", self.branch),
                None,
            )
            .await?;
        match status {
            200 => {}
            404 => {
                let tree = json!({ "tree": [{
                    "path": "README.md", "mode": "100644", "type": "blob",
                    "content": "Screenshots attached to issues by the Rusuite report relay (P8-43).\n"
                }] });
                let tree: Sha = self.created(what, "/git/trees", &tree).await?;
                let commit = json!({ "message": "Issue attachments (report relay)", "tree": tree.sha, "parents": [] });
                let commit: Sha = self.created(what, "/git/commits", &commit).await?;
                let r = json!({ "ref": format!("refs/heads/{}", self.branch), "sha": commit.sha });
                let (status, _) = self
                    .send(what, reqwest::Method::POST, "/git/refs", Some(&r))
                    .await?;
                // 422: created concurrently.
                if status != 201 && status != 422 {
                    return Err(GitHubError::Status { what, status });
                }
            }
            status => return Err(GitHubError::Status { what, status }),
        }
        *ready = true;
        Ok(())
    }

    async fn created<T: for<'de> Deserialize<'de>>(
        &self,
        what: &'static str,
        path: &str,
        body: &Value,
    ) -> Result<T, GitHubError> {
        let (status, bytes) = self
            .send(what, reqwest::Method::POST, path, Some(body))
            .await?;
        if status != 201 {
            return Err(GitHubError::Status { what, status });
        }
        serde_json::from_slice(&bytes).map_err(|_| GitHubError::Transport {
            what,
            message: "unexpected reply".into(),
        })
    }

    /// Commits one image to the attachments branch at `path`; returns its raw URL.
    pub async fn upload(&self, path: &str, bytes: &[u8]) -> Result<String, GitHubError> {
        self.ensure_branch().await?;
        let what = "contents";
        let body = json!({
            "message": format!("Attachment {path}"),
            "content": base64::engine::general_purpose::STANDARD.encode(bytes),
            "branch": self.branch,
        });
        let (status, _) = self
            .send(
                what,
                reqwest::Method::PUT,
                &format!("/contents/{path}"),
                Some(&body),
            )
            .await?;
        if status != 201 && status != 200 {
            return Err(GitHubError::Status { what, status });
        }
        Ok(format!(
            "https://raw.githubusercontent.com/{}/{}/{path}",
            self.repo, self.branch
        ))
    }

    /// Creates the issue; without labels when GitHub refuses them (422).
    pub async fn create_issue(
        &self,
        title: &str,
        body: &str,
        labels: &[String],
    ) -> Result<Issue, GitHubError> {
        let what = "issue";
        let mut payload = json!({ "title": title, "body": body, "labels": labels });
        let (mut status, mut bytes) = self
            .send(what, reqwest::Method::POST, "/issues", Some(&payload))
            .await?;
        if status == 422 {
            payload.as_object_mut().map(|o| o.remove("labels"));
            (status, bytes) = self
                .send(what, reqwest::Method::POST, "/issues", Some(&payload))
                .await?;
        }
        if status != 201 {
            return Err(GitHubError::Status { what, status });
        }
        let c: CreatedIssue =
            serde_json::from_slice(&bytes).map_err(|_| GitHubError::Transport {
                what,
                message: "unexpected reply".into(),
            })?;
        Ok(Issue {
            number: c.number,
            url: c.html_url,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn label_colours() {
        assert_eq!(label_color("from-app"), "5319e7");
        assert_eq!(label_color("app:write"), "0e8a16");
        assert_eq!(label_color("kind:bug"), "fbca04");
    }

    #[test]
    fn errors_carry_no_secrets() {
        let e = GitHubError::Status {
            what: "issue",
            status: 401,
        };
        assert_eq!(e.to_string(), "GitHub issue: HTTP 401");
        assert_eq!(e.status(), Some(401));
    }
}
