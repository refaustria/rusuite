//! Equivalence net for the preset geometry (P9-X1): for every preset × 3
//! box sizes × default and extreme adjust values, a digest of everything
//! the evaluator computes (paths, flattened paths, connection sites, text
//! rectangle, adjust handles, adjust defaults), plus the connector
//! geometries. The snapshot was recorded with the evaluator before it
//! moved from `model-show` to `core_model::geometry` (the same digests as
//! `crates/model-show/tests/snapshots/geometry_equivalence__preset_geometry.snap`).

use core_model::geometry::{flatten, Adjust, ConnectorKind, Preset};

const SIZES: [(f64, f64); 3] = [
    (914_400.0, 914_400.0),
    (2_743_200.0, 914_400.0),
    (457_200.0, 1_828_800.0),
];
const VALUES: [Option<i64>; 5] = [
    None,
    Some(0),
    Some(100_000),
    Some(1_000_000),
    Some(-1_000_000),
];

fn fnv(acc: &mut u64, s: &str) {
    for b in s.bytes() {
        *acc ^= u64::from(b);
        *acc = acc.wrapping_mul(0x0100_0000_01b3);
    }
}

fn adjust_for(p: &Preset, v: Option<i64>) -> Adjust {
    match v {
        None => Adjust::new(),
        Some(v) => p
            .adjust_defaults()
            .iter()
            .map(|(k, _)| ((*k).to_owned(), v))
            .collect(),
    }
}

fn json<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap()
}

#[test]
fn preset_geometry_is_unchanged() {
    let mut out = String::new();
    let custom: Preset = serde_json::from_str(
        r#"{"custom":{"paths":[{"w":100,"h":50,"commands":[{"kind":"moveTo","x":0,"y":0},{"kind":"arcTo","wr":50,"hr":25,"startDeg":180,"sweepDeg":180},{"kind":"quadTo","x1":50,"y1":60,"x":0,"y":0},{"kind":"close"}]}]}}"#,
    )
    .unwrap();
    for p in Preset::ALL.into_iter().chain([custom]) {
        let mut acc = 0xcbf2_9ce4_8422_2325u64;
        fnv(&mut acc, &json(&p.adjust_defaults()));
        for (w, h) in SIZES {
            for v in VALUES {
                let adj = adjust_for(&p, v);
                let paths = p.paths(w, h, &adj);
                fnv(&mut acc, &json(&paths));
                for sp in &paths {
                    fnv(&mut acc, &json(&flatten(&sp.commands)));
                }
                fnv(&mut acc, &json(&p.connection_sites(w, h, &adj)));
                fnv(&mut acc, &json(&p.text_rect(w, h, &adj)));
                fnv(&mut acc, &json(&p.handles(w, h, &adj)));
            }
        }
        out.push_str(&format!("{} {:016x}\n", p.prst(), acc));
    }
    for kind in [
        ConnectorKind::Straight,
        ConnectorKind::Elbow,
        ConnectorKind::Curved,
    ] {
        for turns in 1..=4u8 {
            let mut acc = 0xcbf2_9ce4_8422_2325u64;
            for (w, h) in SIZES {
                for v in VALUES {
                    let adj: Adjust = match v {
                        None => Adjust::new(),
                        Some(v) => kind
                            .adjust_defaults(turns)
                            .iter()
                            .map(|(k, _)| ((*k).to_owned(), v))
                            .collect(),
                    };
                    fnv(&mut acc, &json(&kind.path(turns, w, h, &adj)));
                }
            }
            out.push_str(&format!("{} {:016x}\n", kind.prst(turns), acc));
        }
    }
    insta::assert_snapshot!("preset_geometry", out);
}
