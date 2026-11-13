//! `rusuite-notes-relay`: listens on `NOTES_LISTEN` (default 127.0.0.1:8732) behind nginx's `location /api/notes/`,
//! stores ciphertext under `NOTES_DATA_DIR` (default /var/lib/rusuite-notes). Settings: `docs/notes-sync-protocol.md`.

#![forbid(unsafe_code)]

use std::sync::Arc;
use std::time::Duration;

use notes_relay::{router, Config, Relay, SystemClock};

#[tokio::main]
async fn main() {
    let config = match Config::from_lookup(|k| std::env::var(k).ok()) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("rusuite-notes-relay: {e}");
            std::process::exit(2);
        }
    };
    let relay = match Relay::new(
        &config.data_dir,
        config.limits.clone(),
        Arc::new(SystemClock),
    ) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("rusuite-notes-relay: cannot use the data directory: {e}");
            std::process::exit(1);
        }
    };
    let listener = match tokio::net::TcpListener::bind(config.listen).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!(
                "rusuite-notes-relay: cannot listen on {}: {e}",
                config.listen
            );
            std::process::exit(1);
        }
    };
    eprintln!(
        "rusuite-notes-relay {} listening on {}",
        notes_relay::VERSION,
        config.listen
    );

    // Hourly: delete notebooks inactive beyond the limit and expired join requests.
    let sweeper = relay.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(3600));
        loop {
            tick.tick().await;
            let r = sweeper.clone();
            let _ = tokio::task::spawn_blocking(move || r.sweep()).await;
        }
    });

    let stopping = relay.clone();
    let shutdown = async move {
        let ctrl_c = async {
            let _ = tokio::signal::ctrl_c().await;
        };
        #[cfg(unix)]
        {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("SIGTERM handler");
            tokio::select! {
                _ = ctrl_c => {},
                _ = term.recv() => {},
            }
        }
        #[cfg(not(unix))]
        ctrl_c.await;
        eprintln!("rusuite-notes-relay: shutting down");
        // WebSocket connections close themselves; then axum finishes the HTTP side.
        stopping.shutdown();
    };
    if let Err(e) = axum::serve(listener, router(relay))
        .with_graceful_shutdown(shutdown)
        .await
    {
        eprintln!("rusuite-notes-relay: {e}");
        std::process::exit(1);
    }
}
