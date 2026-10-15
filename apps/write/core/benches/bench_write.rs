//! Prints the Write performance table (P5-4). Run in release:
//!
//! ```text
//! cargo run --release -p write-core --example bench_write -- [out.docx [out.json]]
//! ```
//!
//! With arguments, the saved document is also written there, and the
//! reopened document as `Document` JSON (inputs for the browser
//! measurements).

#[path = "write_perf.rs"]
mod write_perf;

fn main() {
    let (report, bytes) = write_perf::run();
    if let Some(path) = std::env::args().nth(1) {
        std::fs::write(&path, &bytes).expect("write docx");
        eprintln!("wrote {path}");
    }
    if let Some(path) = std::env::args().nth(2) {
        let (doc, _) = write_core::WriteDocument::open_docx(&bytes, "perf.docx").expect("open");
        std::fs::write(&path, serde_json::to_string(doc.document()).expect("json"))
            .expect("write json");
        eprintln!("wrote {path}");
    }
    print!("{}", report.table());
}
