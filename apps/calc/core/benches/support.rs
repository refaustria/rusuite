//! Timing and memory helpers shared by the perf example and the perf test
//! (included with `#[path]`; copied per crate, no shared bench crate).

#![allow(dead_code)]

use std::time::Instant;

/// One measured quantity.
#[derive(Debug, Clone)]
pub struct Measurement {
    pub name: String,
    pub value: f64,
    pub unit: &'static str,
    /// MVP target (upper bound, same unit), if the brief sets one.
    pub target: Option<f64>,
}

impl Measurement {
    pub fn met(&self) -> Option<bool> {
        self.target.map(|t| self.value <= t)
    }

    /// A Markdown table row: `| name | value | target | status |`.
    pub fn row(&self) -> String {
        let fmt = |v: f64| match self.unit {
            "ms" if v >= 1000.0 => format!("{:.2} s", v / 1000.0),
            "ms" if v < 1.0 => format!("{:.3} ms", v),
            "ms" => format!("{:.1} ms", v),
            "" => format!("{v:.0}"),
            u => format!("{v:.1} {u}"),
        };
        let (target, status) = match (self.target, self.met()) {
            (Some(t), Some(ok)) => (format!("< {}", fmt(t)), if ok { "ok" } else { "MISSED" }),
            _ => ("–".to_owned(), ""),
        };
        format!(
            "| {} | {} | {} | {} |",
            self.name,
            fmt(self.value),
            target,
            status
        )
    }
}

/// Collects measurements in order.
#[derive(Debug, Default)]
pub struct Report(pub Vec<Measurement>);

impl Report {
    pub fn add(&mut self, name: &str, value: f64, unit: &'static str, target: Option<f64>) {
        let m = Measurement {
            name: name.to_owned(),
            value,
            unit,
            target,
        };
        eprintln!("  {}", m.row());
        self.0.push(m);
    }

    /// Times `f` once (ms) and records it.
    pub fn time<T>(&mut self, name: &str, target_ms: Option<f64>, f: impl FnOnce() -> T) -> T {
        let (out, ms) = time(f);
        self.add(name, ms, "ms", target_ms);
        out
    }

    /// Runs `f` `n` times and records the median (ms).
    pub fn median(&mut self, name: &str, n: usize, target_ms: Option<f64>, mut f: impl FnMut()) {
        let mut v: Vec<f64> = (0..n).map(|_| time(&mut f).1).collect();
        v.sort_by(f64::total_cmp);
        self.add(name, v[v.len() / 2], "ms", target_ms);
    }

    pub fn get(&self, name: &str) -> f64 {
        self.0
            .iter()
            .find(|m| m.name == name)
            .unwrap_or_else(|| panic!("no measurement {name}"))
            .value
    }

    /// The Markdown table.
    pub fn table(&self) -> String {
        let mut s = String::from("| Measurement | Value | Target | |\n|---|---:|---:|---|\n");
        for m in &self.0 {
            s.push_str(&m.row());
            s.push('\n');
        }
        s
    }
}

pub fn time<T>(f: impl FnOnce() -> T) -> (T, f64) {
    let t = Instant::now();
    let out = f();
    (out, t.elapsed().as_secs_f64() * 1000.0)
}

/// A `/proc/self/status` field in MB (`VmHWM` = peak RSS, `VmRSS` =
/// current); 0 where unavailable.
pub fn proc_status_mb(field: &str) -> f64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with(field))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|kb| kb.parse::<f64>().ok())
        })
        .map_or(0.0, |kb| kb / 1024.0)
}
