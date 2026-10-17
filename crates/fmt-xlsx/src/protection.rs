//! `<sheetProtection>` (worksheet) and `<workbookProtection>` (workbook)
//! ↔ [`SheetProtection`] / [`WorkbookProtection`]: the option flags with
//! the schema defaults, the legacy `password` hash and the
//! `algorithmName` / `hashValue` / `saltValue` / `spinCount` form.

use model_sheet::{HashedPassword, Password, SheetProtection, WorkbookProtection};
use quick_xml::events::BytesStart;

use crate::xml::{attr, attr_bool, attr_parse, XmlOut};

/// The flags of `<sheetProtection>` with their schema defaults
/// (CT_SheetProtection), in the order Excel writes them.
const SHEET_FLAGS: [(&str, bool); 16] = [
    ("sheet", false),
    ("objects", false),
    ("scenarios", false),
    ("formatCells", true),
    ("formatColumns", true),
    ("formatRows", true),
    ("insertColumns", true),
    ("insertRows", true),
    ("insertHyperlinks", true),
    ("deleteColumns", true),
    ("deleteRows", true),
    ("selectLockedCells", false),
    ("sort", true),
    ("autoFilter", true),
    ("pivotTables", true),
    ("selectUnlockedCells", false),
];

fn flags_mut(p: &mut SheetProtection) -> [&mut bool; 16] {
    [
        &mut p.sheet,
        &mut p.objects,
        &mut p.scenarios,
        &mut p.format_cells,
        &mut p.format_columns,
        &mut p.format_rows,
        &mut p.insert_columns,
        &mut p.insert_rows,
        &mut p.insert_hyperlinks,
        &mut p.delete_columns,
        &mut p.delete_rows,
        &mut p.select_locked_cells,
        &mut p.sort,
        &mut p.auto_filter,
        &mut p.pivot_tables,
        &mut p.select_unlocked_cells,
    ]
}

fn flags(p: &SheetProtection) -> [bool; 16] {
    let mut copy = p.clone();
    flags_mut(&mut copy).map(|b| *b)
}

/// The password attributes; `prefix` is `""` for a sheet and
/// `"workbook"` for the workbook (`workbookPassword`,
/// `workbookAlgorithmName`, …).
fn password_of(el: &BytesStart<'_>, prefix: &str) -> Password {
    let name = |n: &str| {
        if prefix.is_empty() {
            n.to_owned()
        } else {
            let mut c = n.chars();
            let first = c.next().map(|f| f.to_ascii_uppercase()).unwrap_or_default();
            format!("{prefix}{first}{}", c.as_str())
        }
    };
    let legacy = attr(el, &name("password"))
        .and_then(|h| u16::from_str_radix(h.trim(), 16).ok())
        .filter(|&h| h != 0);
    let hashed = match (
        attr(el, &name("algorithmName")),
        attr(el, &name("hashValue")),
        attr(el, &name("saltValue")),
    ) {
        (Some(a), Some(h), Some(s)) if !h.is_empty() => Some(HashedPassword {
            algorithm_name: a.into_owned(),
            hash_value: h.into_owned(),
            salt_value: s.into_owned(),
            spin_count: attr_parse(el, &name("spinCount")).unwrap_or(0),
        }),
        _ => None,
    };
    Password { legacy, hashed }
}

fn password_attrs(p: &Password, prefix: &str) -> Vec<(String, String)> {
    let name = |n: &str| {
        if prefix.is_empty() {
            n.to_owned()
        } else {
            format!("{prefix}{}{}", n[..1].to_ascii_uppercase(), &n[1..])
        }
    };
    let mut a = Vec::new();
    if let Some(l) = p.legacy {
        a.push((name("password"), format!("{l:04X}")));
    }
    if let Some(h) = &p.hashed {
        a.push((name("algorithmName"), h.algorithm_name.clone()));
        a.push((name("hashValue"), h.hash_value.clone()));
        a.push((name("saltValue"), h.salt_value.clone()));
        a.push((name("spinCount"), h.spin_count.to_string()));
    }
    a
}

/// Reads `<sheetProtection>`.
pub(crate) fn sheet_protection_of(el: &BytesStart<'_>) -> SheetProtection {
    let mut p = SheetProtection::default();
    for ((name, default), flag) in SHEET_FLAGS.iter().zip(flags_mut(&mut p)) {
        *flag = attr_bool(el, name).unwrap_or(*default);
    }
    p.password = password_of(el, "");
    p
}

/// Writes `<sheetProtection>` (only the attributes that differ from the
/// schema defaults).
pub(crate) fn sheet_protection_xml(x: &mut XmlOut, p: &SheetProtection) {
    let mut a = password_attrs(&p.password, "");
    for ((name, default), value) in SHEET_FLAGS.iter().zip(flags(p)) {
        if value != *default {
            a.push(((*name).to_owned(), if value { "1" } else { "0" }.to_owned()));
        }
    }
    let attrs: Vec<(&str, &str)> = a.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    x.empty("sheetProtection", &attrs);
}

/// Reads `<workbookProtection>`; `None` when it protects nothing.
pub(crate) fn workbook_protection_of(el: &BytesStart<'_>) -> Option<WorkbookProtection> {
    let p = WorkbookProtection {
        lock_structure: attr_bool(el, "lockStructure").unwrap_or(false),
        lock_windows: attr_bool(el, "lockWindows").unwrap_or(false),
        password: password_of(el, "workbook"),
    };
    (p.is_active() || !p.password.is_none()).then_some(p)
}

/// Writes `<workbookProtection>`.
pub(crate) fn workbook_protection_xml(x: &mut XmlOut, p: &WorkbookProtection) {
    let mut a = password_attrs(&p.password, "workbook");
    if p.lock_structure {
        a.push(("lockStructure".into(), "1".into()));
    }
    if p.lock_windows {
        a.push(("lockWindows".into(), "1".into()));
    }
    let attrs: Vec<(&str, &str)> = a.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    x.empty("workbookProtection", &attrs);
}

#[cfg(test)]
mod tests {
    use super::*;
    use quick_xml::events::Event;
    use quick_xml::Reader;

    fn el(xml: &str) -> BytesStart<'static> {
        let mut r = Reader::from_str(xml);
        loop {
            match r.read_event().unwrap() {
                Event::Empty(e) | Event::Start(e) => return e.into_owned(),
                Event::Eof => panic!("no element"),
                _ => {}
            }
        }
    }

    #[test]
    fn sheet_flags_use_schema_defaults() {
        let p = sheet_protection_of(&el(
            r#"<sheetProtection sheet="1" formatCells="0" selectLockedCells="1" password="CC1A"/>"#,
        ));
        assert!(p.sheet && !p.objects && !p.scenarios);
        assert!(!p.format_cells && p.format_rows && p.select_locked_cells && p.sort);
        assert_eq!(p.password.legacy, Some(0xCC1A));
        assert!(p.password.verify("abc"));
        let mut x = XmlOut::fragment();
        sheet_protection_xml(&mut x, &p);
        let out = String::from_utf8(x.finish()).unwrap();
        assert!(out.contains(r#"password="CC1A""#), "{out}");
        assert!(out.contains(r#"formatCells="0""#) && out.contains(r#"selectLockedCells="1""#));
        assert!(!out.contains("formatRows") && !out.contains("objects"));
        assert_eq!(sheet_protection_of(&el(&out)), p);
    }

    #[test]
    fn workbook_password_attributes_are_prefixed() {
        let h = HashedPassword::sha512("pw", &[9; 16], 3);
        let p = WorkbookProtection {
            lock_structure: true,
            lock_windows: false,
            password: Password {
                legacy: Some(0x1234),
                hashed: Some(h),
            },
        };
        let mut x = XmlOut::fragment();
        workbook_protection_xml(&mut x, &p);
        let out = String::from_utf8(x.finish()).unwrap();
        assert!(out.contains(r#"workbookPassword="1234""#), "{out}");
        assert!(out.contains(r#"workbookAlgorithmName="SHA-512""#));
        assert!(out.contains(r#"workbookSpinCount="3""#));
        let back = workbook_protection_of(&el(&out)).unwrap();
        assert_eq!(back, p);
        assert!(back.password.verify("pw"));
        assert!(
            workbook_protection_of(&el(r#"<workbookProtection lockStructure="0"/>"#)).is_none()
        );
    }
}
