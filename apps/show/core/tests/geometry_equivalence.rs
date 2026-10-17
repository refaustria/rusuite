//! Equivalence net for Show's `shapePaths` (P9-X1): a digest of the
//! answer for every preset × 3 box sizes × default and extreme adjust
//! values, and for the connectors. Recorded before the preset geometry
//! moved from `model-show` to `core_model::geometry`.

use show_core::PathQuery;

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

fn queries(kind: serde_json::Value, names: &[&str]) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    for (w, h) in SIZES {
        for v in VALUES {
            let mut q = serde_json::json!({ "kind": kind, "w": w, "h": h });
            if let Some(v) = v {
                let adj: serde_json::Map<String, serde_json::Value> =
                    names.iter().map(|n| ((*n).to_owned(), v.into())).collect();
                q["adjust"] = adj.into();
            }
            out.push(q);
        }
    }
    out
}

#[test]
fn shape_paths_are_unchanged() {
    let mut out = String::new();
    let mut run = |label: String, qs: Vec<serde_json::Value>| {
        let answers: Vec<_> = qs
            .into_iter()
            .map(|q| serde_json::from_value::<PathQuery>(q).unwrap().compute())
            .collect();
        let json = serde_json::to_string(&answers).unwrap();
        out.push_str(&format!("{label} {:016x}\n", fnv(&json)));
    };
    for p in model_show::Preset::ALL {
        let names: Vec<&str> = p.adjust_defaults().iter().map(|(k, _)| *k).collect();
        run(
            p.prst().to_owned(),
            queries(
                serde_json::json!({ "kind": "preset", "value": p.prst() }),
                &names,
            ),
        );
    }
    for kind in ["straight", "elbow", "curved"] {
        for bends in 1..=4u8 {
            run(
                format!("{kind}{bends}"),
                queries(
                    serde_json::json!({ "kind": "connector", "value": { "kind": kind, "bends": bends } }),
                    &["adj1", "adj2", "adj3"],
                ),
            );
        }
    }
    insta::assert_snapshot!("shape_paths", out);
}
