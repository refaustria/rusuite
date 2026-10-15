//! Calc performance test with generous bounds (several times the MVP
//! targets, so it only catches regressions by an order of magnitude):
//!
//! ```text
//! cargo test --release -p calc-core --test perf -- --ignored
//! ```

#[path = "calc_perf.rs"]
mod calc_perf;

#[test]
#[ignore = "perf: run in release with --ignored"]
fn calc_one_million_cells() {
    let (r, _) = calc_perf::run();
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
