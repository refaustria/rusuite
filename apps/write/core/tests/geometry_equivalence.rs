//! Equivalence net for Write's `shapePaths` (P9-X1): a digest of the
//! outline of every preset × 3 box sizes × default and extreme adjust
//! values. Recorded before the preset geometry moved from `model-show` to
//! `core_model::geometry`.

use std::collections::BTreeMap;

use core_model::geometry::Preset;
use write_core::{shape_outline, AdjustHandle, ShapeOutline, ShapeOutlinePath, ShapePathQuery};

/// The fields `shapePaths` answered when the digests were recorded (the
/// adjust handles came later and are checked separately).
#[derive(serde::Serialize)]
struct Recorded<'a> {
    paths: &'a Vec<ShapeOutlinePath>,
    defaults: &'a BTreeMap<String, i64>,
}

fn recorded(o: &ShapeOutline) -> Recorded<'_> {
    Recorded {
        paths: &o.paths,
        defaults: &o.defaults,
    }
}

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
        let json =
            serde_json::to_string(&answers.iter().map(recorded).collect::<Vec<_>>()).unwrap();
        out.push_str(&format!("{prst} {:016x}\n", fnv(&json)));
    }
    insta::assert_snapshot!("shape_outlines", out);
}

#[test]
fn handle_mirror_matches_core_json() {
    for p in Preset::ALL {
        for h in p.handles(2_000_000.0, 1_000_000.0, &BTreeMap::new()) {
            let json = serde_json::to_value(&h).unwrap();
            let mirror: AdjustHandle = serde_json::from_value(json.clone()).unwrap();
            assert_eq!(serde_json::to_value(&mirror).unwrap(), json, "{p:?}");
        }
    }
    let o = shape_outline(&ShapePathQuery {
        preset: "roundRect".into(),
        w: 2_000_000.0,
        h: 1_000_000.0,
        adjust: BTreeMap::new(),
    });
    let json = serde_json::to_value(&o).unwrap();
    assert_eq!(json["handles"][0]["xAxis"]["adj"], "adj");
    let rect = serde_json::to_value(shape_outline(&ShapePathQuery {
        preset: "rect".into(),
        w: 1.0,
        h: 1.0,
        adjust: BTreeMap::new(),
    }))
    .unwrap();
    assert!(rect.get("handles").is_none());
}
