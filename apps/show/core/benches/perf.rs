//! Show performance test with generous bounds (3× the MVP targets):
//!
//! ```text
//! cargo test --release -p show-core --test perf -- --ignored
//! ```

#[path = "show_perf.rs"]
mod show_perf;

#[test]
#[ignore = "perf: run in release with --ignored"]
fn show_hundred_slides() {
    let (r, _) = show_perf::run();
    for m in &r.0 {
        if let Some(t) = m.target {
            assert!(
                m.value <= t * 3.0,
                "{} took {} {} (target {t})",
                m.name,
                m.value,
                m.unit
            );
        }
    }
}
