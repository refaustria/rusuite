//! P8-11: conditional formatting and data validation commands/requests.

use app_common::Host;
use calc_core::{dispatch, CalcCommand as C, CalcDocument, CalcHost, Rect};
use engine_formula::CellRect;
use model_sheet::{
    CfKind, CfRule, CompareOp, DataValidation, DxfStyle, ListSource, SheetSnapshot, ValidationKind,
};
use serde_json::{json, Value as Json};

fn set(row: u32, col: u32, input: &str) -> C {
    C::SetInput {
        sheet: 0,
        row,
        col,
        input: input.into(),
    }
}

fn rect(r0: u32, c0: u32, r1: u32, c1: u32) -> CellRect {
    CellRect { r0, c0, r1, c1 }
}

fn state(h: &CalcHost) -> Vec<SheetSnapshot> {
    h.doc().workbook().to_snapshot().sheets
}

fn request(h: &mut CalcHost, req: Json) -> Json {
    let reply: Json = serde_json::from_str(&dispatch(h, &req.to_string())).unwrap();
    reply
}

fn ok(h: &mut CalcHost, req: Json) -> Json {
    let reply = request(h, req);
    assert!(reply.get("ok").is_some(), "{reply}");
    reply["ok"].clone()
}

fn gt(n: &str) -> CfKind {
    CfKind::CellIs {
        op: CompareOp::GreaterThan,
        formulas: vec![n.into()],
    }
}

fn bold_rule(ranges: Vec<CellRect>, kind: CfKind) -> CfRule {
    CfRule {
        ranges,
        dxf: Some(DxfStyle {
            bold: Some(true),
            ..Default::default()
        }),
        ..CfRule::new(kind)
    }
}

/// A1:A6 = 1..6.
fn numbers() -> CalcHost {
    let mut h = Host::new(CalcDocument::new());
    for r in 0..6 {
        h.apply(set(r, 0, &(r + 1).to_string())).unwrap();
    }
    h
}

fn cf_rows(h: &mut CalcHost) -> Vec<u64> {
    let snap = ok(
        h,
        json!({"type":"snapshot","sheet":0,"r0":0,"c0":0,"r1":20,"c1":3}),
    );
    snap["snapshot"]["cf"]
        .as_array()
        .map(|a| a.iter().map(|c| c["row"].as_u64().unwrap()).collect())
        .unwrap_or_default()
}

#[test]
fn rule_commands_with_undo_identity() {
    let mut h = numbers();
    let empty = state(&h);
    // Through the JSON entry point, as the UI sends it.
    let reply = ok(
        &mut h,
        json!({"type":"apply","command":{"type":"addCfRule","sheet":0,"rule":{
            "id":0,"ranges":[{"r0":0,"c0":0,"r1":5,"c1":0}],"priority":0,"stopIfTrue":false,
            "kind":{"type":"cellIs","op":"greaterThan","formulas":["=3"]},
            "dxf":{"bold":true,"fill":{"kind":"rgb","value":"FFC7CE"}}}}}),
    );
    assert_eq!(reply["envelope"]["patch"]["cfSheets"], json!([0]));
    assert_eq!(cf_rows(&mut h), [3, 4, 5]);
    let snap = ok(
        &mut h,
        json!({"type":"snapshot","sheet":0,"r0":3,"c0":0,"r1":3,"c1":0}),
    );
    assert_eq!(
        snap["snapshot"]["cf"],
        json!([{"row":3,"col":0,"cf":{"dxf":{"bold":true,"fill":{"kind":"rgb","value":"FFC7CE"}}}}])
    );
    let one = state(&h);

    // Add a second rule on top, update, reorder, remove: each undoes exactly.
    let mut steps = vec![one.clone()];
    h.apply(C::AddCfRule {
        sheet: 0,
        rule: bold_rule(
            vec![rect(0, 0, 5, 0)],
            CfKind::Expression {
                formula: "MOD(A1,2)=0".into(),
            },
        ),
    })
    .unwrap();
    steps.push(state(&h));
    let rules = h
        .doc()
        .workbook()
        .cf_rules(model_sheet::SheetId(0))
        .to_vec();
    assert_eq!(rules.len(), 2);
    assert_eq!((rules[0].id, rules[1].id), (2, 1));
    let mut updated = rules[1].clone();
    updated.kind = gt("4");
    updated.stop_if_true = true;
    h.apply(C::UpdateCfRule {
        sheet: 0,
        rule: updated,
    })
    .unwrap();
    steps.push(state(&h));
    h.apply(C::ReorderCfRule {
        sheet: 0,
        id: 1,
        priority: 1,
    })
    .unwrap();
    steps.push(state(&h));
    assert_eq!(
        h.doc().workbook().cf_rules(model_sheet::SheetId(0))[0].id,
        1
    );
    h.apply(C::RemoveCfRule { sheet: 0, id: 2 }).unwrap();
    steps.push(state(&h));
    h.apply(C::ClearCf {
        sheet: 0,
        range: Some(Rect {
            r0: 0,
            c0: 0,
            r1: 3,
            c1: 0,
        }),
    })
    .unwrap();
    let cleared = state(&h);
    assert_eq!(cf_rows(&mut h), [4, 5]);
    h.apply(C::ClearCf {
        sheet: 0,
        range: None,
    })
    .unwrap();
    assert!(cf_rows(&mut h).is_empty());
    h.undo().unwrap();
    assert_eq!(state(&h), cleared);
    for expected in steps.iter().rev() {
        h.undo().unwrap();
        assert_eq!(&state(&h), expected);
    }
    h.undo().unwrap();
    assert_eq!(state(&h), empty);
    for _ in 0..7 {
        h.redo().unwrap();
    }
    assert!(cf_rows(&mut h).is_empty());

    // Errors.
    let bad = request(
        &mut h,
        json!({"type":"apply","command":{"type":"addCfRule","sheet":0,"rule":{
            "id":0,"ranges":[{"r0":0,"c0":0,"r1":5,"c1":0}],"priority":0,"stopIfTrue":false,
            "kind":{"type":"expression","formula":"SUM("}}}}),
    );
    assert_eq!(bad["err"]["code"], "invalid_rule");
    let bad = request(
        &mut h,
        json!({"type":"apply","command":{"type":"removeCfRule","sheet":0,"id":42}}),
    );
    assert_eq!(bad["err"]["code"], "unknown_rule");
}

#[test]
fn edits_mark_cf_sheets_and_structure_moves_rules() {
    let mut h = numbers();
    let plain = h.apply(set(9, 9, "x")).unwrap();
    assert!(plain.patch.cf_sheets.is_empty());
    h.apply(C::AddCfRule {
        sheet: 0,
        rule: bold_rule(vec![rect(0, 0, 5, 0)], gt("$C$1")),
    })
    .unwrap();
    assert_eq!(cf_rows(&mut h), [0, 1, 2, 3, 4, 5]);
    // An edit anywhere refreshes the rule results.
    let env = h.apply(set(0, 2, "4")).unwrap();
    assert_eq!(env.patch.cf_sheets, [0]);
    assert_eq!(cf_rows(&mut h), [4, 5]);

    let before = state(&h);
    let env = h
        .apply(C::InsertRows {
            sheet: 0,
            at: 0,
            count: 2,
        })
        .unwrap();
    assert_eq!(env.patch.cf_sheets, [0]);
    let rule = &h.doc().workbook().cf_rules(model_sheet::SheetId(0))[0];
    assert_eq!(rule.ranges, vec![rect(2, 0, 7, 0)]);
    assert_eq!(rule.kind, gt("$C$3"));
    assert_eq!(cf_rows(&mut h), [6, 7]);
    h.undo().unwrap();
    assert_eq!(state(&h), before);

    // Deleting rows clips the rule; undo restores it.
    h.apply(C::DeleteRows {
        sheet: 0,
        at: 1,
        count: 10,
    })
    .unwrap();
    assert_eq!(
        h.doc().workbook().cf_rules(model_sheet::SheetId(0))[0].ranges,
        vec![rect(0, 0, 0, 0)]
    );
    h.undo().unwrap();
    assert_eq!(state(&h), before);

    // Deleting the sheet and undoing brings the rules back.
    h.apply(C::AddSheet {
        name: "Other".into(),
        index: None,
    })
    .unwrap();
    let with_other = state(&h);
    h.apply(C::DeleteSheet { sheet: 0 }).unwrap();
    h.undo().unwrap();
    assert_eq!(state(&h), with_other);
}

#[test]
fn validations_through_dispatch() {
    let mut h = numbers();
    for (r, v) in ["Red", "Green", "Blue"].iter().enumerate() {
        h.apply(set(r as u32, 3, v)).unwrap();
    }
    let before = state(&h);
    let list = DataValidation::new(
        vec![rect(0, 1, 9, 1)],
        ValidationKind::List {
            source: ListSource::Formula {
                formula: "$D$1:$D$3".into(),
            },
        },
    );
    let env = h
        .apply(C::SetValidation {
            sheet: 0,
            validation: list,
        })
        .unwrap();
    assert_eq!(env.patch.cf_sheets, [0]);
    let values = ok(
        &mut h,
        json!({"type":"listValues","sheet":0,"row":4,"col":1}),
    );
    assert_eq!(
        values,
        json!({"type":"listValues","values":["Red","Green","Blue"]})
    );
    let pass = ok(
        &mut h,
        json!({"type":"validateInput","sheet":0,"row":4,"col":1,"input":"blue"}),
    );
    assert_eq!(
        pass,
        json!({"type":"validation","result":{"ok":true,"rule":0}})
    );
    let fail = ok(
        &mut h,
        json!({"type":"validateInput","sheet":0,"row":4,"col":1,"input":"Pink"}),
    );
    assert_eq!(fail["result"]["ok"], false);
    assert_eq!(fail["result"]["errorStyle"], "stop");
    assert!(fail["result"]["message"]
        .as_str()
        .unwrap()
        .contains("doesn't match"));
    // No validation on A1.
    let free = ok(
        &mut h,
        json!({"type":"validateInput","sheet":0,"row":0,"col":0,"input":"Pink"}),
    );
    assert_eq!(free["result"], json!({"ok":true}));

    // The snapshot carries the validations of the region.
    let snap = ok(
        &mut h,
        json!({"type":"snapshot","sheet":0,"r0":0,"c0":0,"r1":2,"c1":2}),
    );
    assert_eq!(snap["snapshot"]["validations"][0]["kind"]["type"], "list");
    let snap = ok(
        &mut h,
        json!({"type":"snapshot","sheet":0,"r0":0,"c0":5,"r1":2,"c1":6}),
    );
    assert!(snap["snapshot"].get("validations").is_none());
    let rules = ok(&mut h, json!({"type":"sheetRules","sheet":0}));
    assert_eq!(rules["rules"], json!([]));
    assert_eq!(rules["validations"][0]["ranges"][0]["r1"], 9);

    let one = state(&h);
    let whole = DataValidation::new(
        vec![rect(2, 1, 3, 1)],
        ValidationKind::Whole {
            op: CompareOp::LessThan,
            f1: "A3".into(),
            f2: None,
        },
    );
    h.apply(C::SetValidation {
        sheet: 0,
        validation: whole,
    })
    .unwrap();
    assert!(
        h.doc().validate_input(0, 3, 1, "3").unwrap().ok,
        "3 < A4 (4)"
    );
    assert!(!h.doc().validate_input(0, 3, 1, "4").unwrap().ok);
    let two = state(&h);
    h.apply(C::RemoveValidation {
        sheet: 0,
        range: Rect {
            r0: 0,
            c0: 0,
            r1: 2,
            c1: 5,
        },
    })
    .unwrap();
    assert_eq!(
        h.doc()
            .workbook()
            .validations(model_sheet::SheetId(0))
            .len(),
        2
    );
    h.undo().unwrap();
    assert_eq!(state(&h), two);
    h.undo().unwrap();
    assert_eq!(state(&h), one);
    h.undo().unwrap();
    assert_eq!(state(&h), before);
    let bad = request(
        &mut h,
        json!({"type":"listValues","sheet":7,"row":0,"col":0}),
    );
    assert_eq!(bad["err"]["code"], "unknown_sheet");
}

#[test]
fn rules_survive_xlsx() {
    let mut h = numbers();
    h.apply(C::AddCfRule {
        sheet: 0,
        rule: bold_rule(vec![rect(0, 0, 5, 0)], gt("3")),
    })
    .unwrap();
    h.apply(C::SetValidation {
        sheet: 0,
        validation: DataValidation::new(
            vec![rect(0, 1, 0, 1)],
            ValidationKind::List {
                source: ListSource::Literal {
                    values: vec!["a".into(), "b".into()],
                },
            },
        ),
    })
    .unwrap();
    let bytes = h.doc().save_xlsx().unwrap();
    let (doc, warnings) = CalcDocument::open_xlsx(&bytes, "x.xlsx").unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(doc.workbook().to_snapshot().sheets, state(&h));
}
