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

// --- a minimal PNG encoder (stored deflate blocks; same as
// fmt-pptx's build_deck example), so the fixtures need no files ---

fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in data {
        crc ^= u32::from(b);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &d in data {
        a = (a + u32::from(d)) % 65_521;
        b = (b + a) % 65_521;
    }
    (b << 16) | a
}

/// An RGB PNG of `w`×`h` pixels (uncompressed, ~3 bytes per pixel).
pub fn png(w: u32, h: u32, pixel: impl Fn(u32, u32) -> [u8; 3]) -> Vec<u8> {
    let mut raw = Vec::new();
    for y in 0..h {
        raw.push(0);
        for x in 0..w {
            raw.extend_from_slice(&pixel(x, y));
        }
    }
    let mut z = vec![0x78, 0x01];
    let chunks: Vec<&[u8]> = raw.chunks(65_535).collect();
    for (i, c) in chunks.iter().enumerate() {
        z.push(u8::from(i + 1 == chunks.len()));
        let len = c.len() as u16;
        z.extend_from_slice(&len.to_le_bytes());
        z.extend_from_slice(&(!len).to_le_bytes());
        z.extend_from_slice(c);
    }
    z.extend_from_slice(&adler32(&raw).to_be_bytes());
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut chunk = |kind: &[u8], data: &[u8]| {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let mut body = kind.to_vec();
        body.extend_from_slice(data);
        out.extend_from_slice(&body);
        out.extend_from_slice(&crc32(&body).to_be_bytes());
    };
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&w.to_be_bytes());
    ihdr.extend_from_slice(&h.to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
    chunk(b"IHDR", &ihdr);
    chunk(b"IDAT", &z);
    chunk(b"IEND", &[]);
    out
}
