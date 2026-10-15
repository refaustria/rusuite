//! Prints the Show performance table (P5-4). Run in release:
//!
//! ```text
//! cargo run --release -p show-core --example bench_show -- [out.pptx]
//! ```
//!
//! With an argument, the saved deck is also written there (input for the
//! browser measurements).

#[path = "show_perf.rs"]
mod show_perf;

fn main() {
    let (report, bytes) = show_perf::run();
    if let Some(path) = std::env::args().nth(1) {
        std::fs::write(&path, &bytes).expect("write pptx");
        eprintln!("wrote {path}");
    }
    print!("{}", report.table());
}
