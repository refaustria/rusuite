//! `GETPIVOTDATA` against pivot data registered with the engine (the
//! layouts themselves are tested in `model-sheet`'s pivot module).

use engine_formula::{
    CellCoord, Engine, ErrorKind, PivotData, PivotEntry, PivotItemName, SheetId, Value,
};

fn item(v: Value, label: &str) -> PivotItemName {
    PivotItemName {
        value: v,
        label: label.into(),
    }
}

fn text(t: &str) -> PivotItemName {
    item(Value::Text(t.into()), t)
}

/// Region × Year with Sum of Sales at D2:G6 of sheet 0, filtered to
/// Channel = Web.
fn engine() -> Engine {
    let mut e = Engine::new();
    let entry = |key: Vec<(&str, PivotItemName)>, v: f64| PivotEntry {
        data: 0,
        key: key.into_iter().map(|(f, i)| (f.to_owned(), i)).collect(),
        value: Value::Number(v),
    };
    let y = |n: f64| item(Value::Number(n), &n.to_string());
    let data = PivotData {
        area: (1, 3, 5, 6),
        data_names: vec![vec!["Sum of Sales".into(), "Sales".into()]],
        entries: vec![
            entry(vec![("Region", text("East")), ("Year", y(2023.0))], 5.0),
            entry(vec![("Region", text("East")), ("Year", y(2024.0))], 7.0),
            entry(vec![("Region", text("East"))], 12.0),
            entry(vec![("Region", text("West")), ("Year", y(2024.0))], 9.0),
            entry(vec![("Region", text("West"))], 9.0),
            entry(vec![("Year", y(2023.0))], 5.0),
            entry(vec![("Year", y(2024.0))], 16.0),
            entry(vec![], 21.0),
            PivotEntry {
                data: 0,
                key: vec![("Region".into(), text("(blank)"))],
                value: Value::Error(ErrorKind::NA),
            },
        ],
        fixed: vec![("Channel".into(), text("Web"))],
    };
    e.set_pivot_data(SheetId(0), vec![data]);
    e
}

#[test]
fn getpivotdata_cases() {
    let mut e = engine();
    let n = Value::Number;
    let r = Value::Error(ErrorKind::Ref);
    let cases: [(&str, Value); 16] = [
        (r#"=GETPIVOTDATA("Sales",D2)"#, n(21.0)),
        (r#"=GETPIVOTDATA("Sum of Sales",G6)"#, n(21.0)),
        (r#"=GETPIVOTDATA(" sales ",E3)"#, n(21.0)),
        (r#"=GETPIVOTDATA("Sales",D2,"Region","East")"#, n(12.0)),
        (r#"=GETPIVOTDATA("Sales",D2,"REGION","east")"#, n(12.0)),
        (
            r#"=GETPIVOTDATA("Sales",D2,"Region","East","Year",2024)"#,
            n(7.0),
        ),
        (
            r#"=GETPIVOTDATA("Sales",D2,"Year","2023","Region","East")"#,
            n(5.0),
        ),
        (r#"=GETPIVOTDATA("Sales",D2:E3,"Year",2024)"#, n(16.0)),
        (r#"=GETPIVOTDATA("Sales",D2,"Channel","Web")"#, n(21.0)),
        (r#"=GETPIVOTDATA("Sales",D2,"Channel","Shop")"#, r.clone()),
        (
            r#"=GETPIVOTDATA("Sales",D2,"Region","West","Year",2023)"#,
            r.clone(),
        ),
        (r#"=GETPIVOTDATA("Units",D2)"#, r.clone()),
        (r#"=GETPIVOTDATA("Sales",A1)"#, r.clone()),
        (r#"=GETPIVOTDATA("Sales",D2,"Region")"#, r.clone()),
        (r#"=GETPIVOTDATA("Sales","D2")"#, r.clone()),
        (
            r#"=GETPIVOTDATA("Sales",D2,"Region","(blank)")"#,
            Value::Error(ErrorKind::NA),
        ),
    ];
    let at = CellCoord::new(SheetId(0), 10, 0);
    for (f, want) in cases {
        e.set_input(at, f).unwrap();
        assert_eq!(e.value(at), want, "{f}");
    }
    // Volatile: new pivot data is seen on the next recalculation.
    e.set_input(at, r#"=GETPIVOTDATA("Sales",D2)"#).unwrap();
    e.set_pivot_data(SheetId(0), Vec::new());
    e.begin_batch();
    e.end_batch();
    assert_eq!(e.value(at), r);
}
