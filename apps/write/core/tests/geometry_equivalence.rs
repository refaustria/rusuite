//! Equivalence net for Write's `shapePaths` (P9-X1): a digest of the
//! outline of every preset × 3 box sizes × default and extreme adjust
//! values. Recorded before the preset geometry moved from `model-show` to
//! `core_model::geometry`.

use write_core::{shape_outline, ShapePathQuery};

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

fn fnv(s: &str) -> u64 {
    let mut acc = 0xcbf2_9ce4_8422_2325u64;
    for b in s.bytes() {
        acc ^= u64::from(b);
        acc = acc.wrapping_mul(0x0100_0000_01b3);
    }
    acc
}

#[test]
fn shape_outlines_are_unchanged() {
    let mut out = String::new();
    // every supported preset, plus the connector alias and an unknown name
    let names = core_model::geometry::Preset::ALL
        .map(|p| p.prst())
        .into_iter()
        .chain(["straightConnector1", "noSuchPreset"]);
    for prst in names {
        let defaults = shape_outline(&ShapePathQuery {
            preset: prst.into(),
            w: 100.0,
            h: 100.0,
            adjust: Default::default(),
        })
        .defaults;
        let mut answers = Vec::new();
        for (w, h) in SIZES {
            for v in VALUES {
                let adjust = match v {
                    None => Default::default(),
                    Some(v) => defaults.keys().map(|k| (k.clone(), v)).collect(),
                };
                answers.push(shape_outline(&ShapePathQuery {
                    preset: prst.into(),
                    w,
                    h,
                    adjust,
                }));
            }
        }
        let json = serde_json::to_string(&answers).unwrap();
        out.push_str(&format!("{prst} {:016x}\n", fnv(&json)));
    }
    insta::assert_snapshot!("shape_outlines", out);
}
