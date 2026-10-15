//! Write performance test with generous bounds (3× the MVP targets):
//!
//! ```text
//! cargo test --release -p write-core --test perf -- --ignored
//! ```

#[path = "write_perf.rs"]
mod write_perf;

#[test]
#[ignore = "perf: run in release with --ignored"]
fn write_two_hundred_pages() {
    let (r, _) = write_perf::run();
    assert!(r.get("fixture: words") > 90_000.0);
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
