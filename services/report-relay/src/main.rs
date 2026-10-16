//! `rusuite-report-relay`: listens on `REPORT_LISTEN` (default 127.0.0.1:8787) behind nginx's `location /api/report`.
//! Settings from the environment (`/etc/rusuite/report-relay.env`), see `docs/setup.md`.

#![forbid(unsafe_code)]

use std::net::SocketAddr;
use std::sync::Arc;

use report_relay::{router, AppState, Config, SystemClock};

#[tokio::main]
async fn main() {
    let config = match Config::from_lookup(|k| std::env::var(k).ok()) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("rusuite-report-relay: {e}");
            std::process::exit(2);
        }
    };
    let state = match AppState::new(&config, Arc::new(SystemClock)) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("rusuite-report-relay: {e}");
            std::process::exit(1);
        }
    };
    let listener = match tokio::net::TcpListener::bind(config.listen).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!(
                "rusuite-report-relay: cannot listen on {}: {e}",
                config.listen
            );
            std::process::exit(1);
        }
    };
    eprintln!(
        "rusuite-report-relay {} listening on {} (repo {})",
        report_relay::VERSION,
        config.listen,
        config.github_repo
    );
    let app = router(state).into_make_service_with_connect_info::<SocketAddr>();
    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let shutdown = async move {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM handler");
        tokio::select! {
            _ = shutdown => {},
            _ = term.recv() => {},
        }
    };
    if let Err(e) = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
    {
        eprintln!("rusuite-report-relay: {e}");
        std::process::exit(1);
    }
}
