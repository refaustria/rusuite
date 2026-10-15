//! Prints the Calc performance table (P5-4). Run in release:
//!
//! ```text
//! cargo run --release -p calc-core --example bench_calc -- [out.xlsx]
//! ```
//!
//! With an argument, the generated workbook is also written there (input
//! for the wasm measurement in `scripts/perf.sh`).

#[path = "calc_perf.rs"]
mod calc_perf;

fn main() {
    let (report, bytes) = calc_perf::run();
    if let Some(path) = std::env::args().nth(1) {
        std::fs::write(&path, &bytes).expect("write xlsx");
        eprintln!("wrote {path}");
    }
    print!("{}", report.table());
}
