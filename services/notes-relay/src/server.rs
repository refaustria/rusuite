//! HTTP/WebSocket side: routes, the per-connection loop (rate limit, frame size, ordering), graceful shutdown.

use std::sync::Arc;
use std::time::Instant;

use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get};
use axum::Router;
use notes_sync::protocol::{ClientMsg, ErrorCode, RelayMsg, StopSharing, PROTOCOL_VERSION};
use notes_sync::NotebookId;
use serde_json::json;

use crate::relay::Relay;

/// `GET /api/notes/ws`, `GET /api/notes/health`, `DELETE /api/notes/notebooks/{id}`.
pub fn router(relay: Arc<Relay>) -> Router {
    Router::new()
        .route("/api/notes/ws", get(upgrade))
        .route("/api/notes/health", get(health))
        .route("/api/notes/notebooks/{id}", delete(stop_sharing))
        .with_state(relay)
}

async fn health(State(relay): State<Arc<Relay>>) -> Response {
    (
        StatusCode::OK,
        [("cache-control", "no-store")],
        axum::Json(
            json!({ "ok": true, "version": crate::VERSION, "connections": relay.connections() }),
        ),
    )
        .into_response()
}

/// The body is the postcard-encoded [`StopSharing`] (the same bytes the WebSocket message carries).
async fn stop_sharing(
    State(relay): State<Arc<Relay>>,
    Path(id): Path<String>,
    body: Bytes,
) -> Response {
    let Ok(nb) = NotebookId::from_hex(&id) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Ok(req) = StopSharing::decode(&body) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if req.notebook_id != nb {
        return StatusCode::BAD_REQUEST.into_response();
    }
    match relay.stop_sharing(&req, 0) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(ErrorCode::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(ErrorCode::Forbidden | ErrorCode::NotMember | ErrorCode::BadSignature) => {
            StatusCode::FORBIDDEN.into_response()
        }
        Err(ErrorCode::Internal) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        Err(_) => StatusCode::BAD_REQUEST.into_response(),
    }
}

async fn upgrade(State(relay): State<Arc<Relay>>, ws: WebSocketUpgrade) -> Response {
    let max = relay.limits.max_message_bytes();
    ws.max_message_size(max)
        .max_frame_size(max)
        .on_upgrade(move |socket| connection(relay, socket))
}

/// Token bucket: `rate` messages per second, bursts up to `rate`.
struct Bucket {
    rate: f64,
    tokens: f64,
    at: Instant,
}

impl Bucket {
    fn new(rate: u32) -> Self {
        Bucket {
            rate: rate as f64,
            tokens: rate as f64,
            at: Instant::now(),
        }
    }

    fn take(&mut self) -> bool {
        let now = Instant::now();
        self.tokens =
            (self.tokens + now.duration_since(self.at).as_secs_f64() * self.rate).min(self.rate);
        self.at = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

async fn send(socket: &mut WebSocket, bytes: Vec<u8>) -> bool {
    socket.send(Message::Binary(bytes.into())).await.is_ok()
}

async fn connection(relay: Arc<Relay>, mut socket: WebSocket) {
    let (handle, mut rx) = relay.register();
    let mut shutdown = relay.shutdown_signal();
    let mut bucket = Bucket::new(relay.limits.messages_per_sec);
    let hello = RelayMsg::Challenge {
        nonce: handle.challenge,
        protocol: PROTOCOL_VERSION,
    };
    let mut open = !*shutdown.borrow() && send(&mut socket, hello.encode()).await;
    while open {
        tokio::select! {
            incoming = socket.recv() => {
                let bytes = match incoming {
                    Some(Ok(Message::Binary(b))) => b,
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                    Some(Ok(Message::Text(_))) => {
                        let m = RelayMsg::Error { code: ErrorCode::Malformed, notebook_id: None };
                        open = send(&mut socket, m.encode()).await;
                        continue;
                    }
                    _ => break,
                };
                let replies = match ClientMsg::decode(&bytes) {
                    Err(_) => vec![RelayMsg::Error { code: ErrorCode::Malformed, notebook_id: None }],
                    Ok(msg) if !bucket.take() => vec![match msg {
                        ClientMsg::Publish { tag, .. } => RelayMsg::Rejected { tag, code: ErrorCode::RateLimited },
                        _ => RelayMsg::Error { code: ErrorCode::RateLimited, notebook_id: None },
                    }],
                    Ok(msg) => {
                        let relay = relay.clone();
                        let h = (handle.id, handle.challenge);
                        // Storage I/O happens under the relay's lock: keep it off the async workers.
                        match tokio::task::spawn_blocking(move || {
                            relay.handle(&crate::relay::ConnHandle { id: h.0, challenge: h.1 }, msg)
                        })
                        .await
                        {
                            Ok(r) => r,
                            Err(_) => vec![RelayMsg::Error { code: ErrorCode::Internal, notebook_id: None }],
                        }
                    }
                };
                for r in replies {
                    if !send(&mut socket, r.encode()).await {
                        open = false;
                        break;
                    }
                }
            }
            out = rx.recv() => match out {
                Some(f) => open = send(&mut socket, f.to_vec()).await,
                // Dropped by the relay (queue overflow).
                None => break,
            },
            _ = shutdown.changed() => break,
        }
    }
    let _ = socket.send(Message::Close(None)).await;
    relay.unregister(handle.id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bucket_allows_bursts_up_to_the_rate_then_refills() {
        let mut b = Bucket::new(5);
        assert_eq!((0..10).filter(|_| b.take()).count(), 5);
        b.at -= std::time::Duration::from_millis(400);
        assert_eq!((0..10).filter(|_| b.take()).count(), 2);
    }
}
