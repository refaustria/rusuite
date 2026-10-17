//! P9-C7: cells, panes, comments and pictures round 2 through the
//! document host (fill tips, panes, Go To Special, comments, hyperlinks,
//! pictures).

use app_common::Host;
use calc_core::{dispatch, CalcCommand as C, CalcDocument, CalcHost};
use serde_json::{json, Value as Json};

fn host() -> CalcHost {
    Host::new(CalcDocument::new())
}

fn set(row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet: 0,
        row,
        col,
        input: input.into(),
    }
}

fn ok(h: &mut CalcHost, req: Json) -> Json {
    let reply: Json = serde_json::from_str(&dispatch(h, &req.to_string())).unwrap();
    assert!(reply.get("ok").is_some(), "{reply}");
    reply["ok"].clone()
}

fn tip(h: &mut CalcHost, src: [u32; 4], dst: [u32; 4]) -> Json {
    let r = |a: [u32; 4]| json!({"r0": a[0], "c0": a[1], "r1": a[2], "c1": a[3]});
    ok(
        h,
        json!({"type": "fillPreview", "sheet": 0, "src": r(src), "dst": r(dst), "mode": "auto"}),
    )["text"]
        .clone()
}

#[test]
fn fill_tip_shows_the_last_value_in_the_source_format() {
    let mut h = host();
    h.apply(set(1, 0, "$1.50")).unwrap();
    h.apply(set(2, 0, "$2.00")).unwrap();
    // A series in currency: the fifth row after the source gets $4.50.
    assert_eq!(tip(&mut h, [1, 0, 2, 0], [3, 0, 7, 0]), json!("$4.50"));
    // Filling upwards: the topmost cell is the farthest.
    assert_eq!(tip(&mut h, [1, 0, 2, 0], [0, 0, 0, 0]), json!("$1.00"));
    h.apply(set(10, 0, "3/4/2024")).unwrap();
    assert_eq!(
        tip(&mut h, [10, 0, 10, 0], [11, 0, 12, 0]),
        json!("3/6/2024")
    );
    h.apply(set(10, 2, "Mon")).unwrap();
    assert_eq!(tip(&mut h, [10, 2, 10, 2], [11, 2, 13, 2]), json!("Thu"));
    // A copied constant shows as displayed; a copied formula has no tip.
    h.apply(set(20, 0, "12%")).unwrap();
    h.apply(set(20, 1, "=A21*2")).unwrap();
    assert_eq!(tip(&mut h, [20, 0, 20, 0], [21, 0, 22, 0]), json!("12%"));
    assert_eq!(tip(&mut h, [20, 1, 20, 1], [21, 1, 22, 1]), Json::Null);
}
