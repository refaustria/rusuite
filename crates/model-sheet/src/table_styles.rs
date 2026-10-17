//! Custom table styles (Home › Format as Table › New Table Style…): a
//! named list of table elements (whole table, header row, totals row,
//! first/last column, row and column stripes), each with a differential
//! format ([`DxfStyle`]: fill, font, borders) and, for the stripes, a
//! stripe size of 1–9 rows/columns. In the file they are
//! `<tableStyles><tableStyle><tableStyleElement type dxfId size>` in
//! `styles.xml`; tables use them by name through `tableStyleInfo`.
//!
//! The workbook keeps the custom styles and the default style new tables
//! get (`tableStyles/@defaultTableStyle`). Built-in styles
//! (`TableStyleLight1` … `TableStyleDark11`) are not stored: the view
//! derives them.

use serde::{Deserialize, Serialize};

use crate::condfmt::DxfStyle;
use crate::tables::DEFAULT_TABLE_STYLE;
use crate::workbook::Workbook;
use crate::Error;

/// The part of a table an element formats (`tableStyleElement/@type`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TableStyleElementType {
    WholeTable,
    HeaderRow,
    TotalRow,
    FirstColumn,
    LastColumn,
    FirstRowStripe,
    SecondRowStripe,
    FirstColumnStripe,
    SecondColumnStripe,
}

impl TableStyleElementType {
    /// The elements in the New Table Style dialog's order.
    pub const ALL: [TableStyleElementType; 9] = [
        TableStyleElementType::WholeTable,
        TableStyleElementType::FirstColumnStripe,
        TableStyleElementType::SecondColumnStripe,
        TableStyleElementType::FirstRowStripe,
        TableStyleElementType::SecondRowStripe,
        TableStyleElementType::LastColumn,
        TableStyleElementType::FirstColumn,
        TableStyleElementType::HeaderRow,
        TableStyleElementType::TotalRow,
    ];

    /// The `type` attribute in the file.
    pub fn file_name(self) -> &'static str {
        match self {
            TableStyleElementType::WholeTable => "wholeTable",
            TableStyleElementType::HeaderRow => "headerRow",
            TableStyleElementType::TotalRow => "totalRow",
            TableStyleElementType::FirstColumn => "firstColumn",
            TableStyleElementType::LastColumn => "lastColumn",
            TableStyleElementType::FirstRowStripe => "firstRowStripe",
            TableStyleElementType::SecondRowStripe => "secondRowStripe",
            TableStyleElementType::FirstColumnStripe => "firstColumnStripe",
            TableStyleElementType::SecondColumnStripe => "secondColumnStripe",
        }
    }

    pub fn from_file_name(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|t| t.file_name() == s)
    }

    /// Whether the element has a stripe size.
    pub fn is_stripe(self) -> bool {
        matches!(
            self,
            TableStyleElementType::FirstRowStripe
                | TableStyleElementType::SecondRowStripe
                | TableStyleElementType::FirstColumnStripe
                | TableStyleElementType::SecondColumnStripe
        )
    }
}

fn one() -> u32 {
    1
}

fn is_one(v: &u32) -> bool {
    *v == 1
}

/// One formatted element of a custom table style.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStyleElement {
    #[serde(rename = "type")]
    pub kind: TableStyleElementType,
    /// Stripe size in rows/columns (1–9; stripes only).
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub size: u32,
    /// The format of the element.
    #[serde(default)]
    pub dxf: DxfStyle,
}

/// A user-defined table style.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTableStyle {
    /// Unique among the custom styles (any case), not a built-in name.
    pub name: String,
    /// At most one element per type, in any order.
    #[serde(default)]
    pub elements: Vec<TableStyleElement>,
}

impl CustomTableStyle {
    /// The element of type `kind`.
    pub fn element(&self, kind: TableStyleElementType) -> Option<&TableStyleElement> {
        self.elements.iter().find(|e| e.kind == kind)
    }
}

/// The custom table styles and the default style of a workbook.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStyles {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub custom: Vec<CustomTableStyle>,
    /// The style new tables get (Set As Default); `None` =
    /// `TableStyleMedium2`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_style: Option<String>,
}

impl TableStyles {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// The custom style named `name` (any case).
    pub fn get(&self, name: &str) -> Option<&CustomTableStyle> {
        self.custom
            .iter()
            .find(|s| s.name.eq_ignore_ascii_case(name))
    }

    /// The style new tables get.
    pub fn default_name(&self) -> &str {
        self.default_style.as_deref().unwrap_or(DEFAULT_TABLE_STYLE)
    }

    /// Whether `name` is a style a table can use: a built-in or custom
    /// style.
    pub fn exists(&self, name: &str) -> bool {
        is_builtin_table_style(name) || self.get(name).is_some()
    }

    fn check(&self) -> Result<(), Error> {
        let bad = |m: String| Err(Error::InvalidTable(m));
        for (i, s) in self.custom.iter().enumerate() {
            let name = s.name.trim();
            if name.is_empty() || name.len() > 255 {
                return bad("a table style needs a name".into());
            }
            if is_builtin_table_style(name) || is_builtin_pivot_style(name) {
                return bad(format!("{name:?} is a built-in style"));
            }
            if self.custom[..i]
                .iter()
                .any(|o| o.name.eq_ignore_ascii_case(name))
            {
                return bad(format!("duplicate table style {name:?}"));
            }
            for (j, e) in s.elements.iter().enumerate() {
                if s.elements[..j].iter().any(|o| o.kind == e.kind) {
                    return bad(format!("{name}: duplicate element {:?}", e.kind));
                }
                if !(1..=9).contains(&e.size) || (!e.kind.is_stripe() && e.size != 1) {
                    return bad(format!("{name}: invalid stripe size {}", e.size));
                }
            }
        }
        if let Some(d) = &self.default_style {
            if !self.exists(d) {
                return bad(format!("unknown default table style {d:?}"));
            }
        }
        Ok(())
    }
}

/// `TableStyleLight1`–`21`, `TableStyleMedium1`–`28`, `TableStyleDark1`–`11`.
pub fn is_builtin_table_style(name: &str) -> bool {
    builtin_number(
        name,
        "TableStyle",
        &[("Light", 21), ("Medium", 28), ("Dark", 11)],
    )
}

/// `PivotStyleLight1`–`28`, `PivotStyleMedium1`–`28`, `PivotStyleDark1`–`28`.
pub fn is_builtin_pivot_style(name: &str) -> bool {
    builtin_number(
        name,
        "PivotStyle",
        &[("Light", 28), ("Medium", 28), ("Dark", 28)],
    )
}

fn builtin_number(name: &str, prefix: &str, families: &[(&str, u32)]) -> bool {
    let Some(rest) = name.strip_prefix(prefix) else {
        return false;
    };
    families.iter().any(|(f, max)| {
        rest.strip_prefix(f)
            .and_then(|n| {
                (!n.starts_with('0'))
                    .then(|| n.parse::<u32>().ok())
                    .flatten()
            })
            .is_some_and(|n| (1..=*max).contains(&n))
    })
}

impl Workbook {
    /// The custom table styles and the default style.
    pub fn table_styles(&self) -> &TableStyles {
        &self.table_styles
    }

    /// Replaces the custom table styles (validated: unique, non-built-in
    /// names, one element per type, stripe sizes 1–9, a known default).
    /// Tables keep their style names; see
    /// [`retarget_table_styles`](Self::retarget_table_styles).
    pub fn set_table_styles(&mut self, styles: TableStyles) -> Result<(), Error> {
        styles.check()?;
        self.table_styles = styles;
        Ok(())
    }

    /// After a style was renamed (`renamed`: old → new) or deleted: tables
    /// using the old name follow the new one; tables using a style that
    /// no longer exists get the default style. Returns the sheets whose
    /// tables changed.
    pub fn retarget_table_styles(
        &mut self,
        renamed: &[(String, String)],
    ) -> Result<Vec<engine_formula::SheetId>, Error> {
        let mut changed = Vec::new();
        let styles = self.table_styles.clone();
        for (id, _) in self.sheets() {
            let mut tables = self.tables(id).to_vec();
            let mut touched = false;
            for t in &mut tables {
                if t.style.is_empty() {
                    continue;
                }
                if let Some((_, new)) = renamed
                    .iter()
                    .find(|(old, _)| old.eq_ignore_ascii_case(&t.style))
                {
                    t.style.clone_from(new);
                    touched = true;
                }
                if !styles.exists(&t.style) {
                    t.style = styles.default_name().to_string();
                    touched = true;
                }
            }
            if touched {
                self.set_tables(id, tables)?;
                changed.push(id);
            }
        }
        Ok(changed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tables::Table;
    use core_model::{Color, Rgb};
    use engine_formula::SheetId;

    fn style(name: &str) -> CustomTableStyle {
        CustomTableStyle {
            name: name.into(),
            elements: vec![
                TableStyleElement {
                    kind: TableStyleElementType::HeaderRow,
                    size: 1,
                    dxf: DxfStyle {
                        bold: Some(true),
                        fill: Some(Color::Rgb(Rgb::new(0, 0, 128))),
                        ..Default::default()
                    },
                },
                TableStyleElement {
                    kind: TableStyleElementType::FirstRowStripe,
                    size: 2,
                    dxf: DxfStyle::default(),
                },
            ],
        }
    }

    #[test]
    fn builtin_names() {
        assert!(is_builtin_table_style("TableStyleMedium2"));
        assert!(is_builtin_table_style("TableStyleDark11"));
        assert!(!is_builtin_table_style("TableStyleDark12"));
        assert!(!is_builtin_table_style("TableStyleLight01"));
        assert!(!is_builtin_table_style("Mine"));
        assert!(is_builtin_pivot_style("PivotStyleLight16"));
    }

    #[test]
    fn validation() {
        let mut wb = Workbook::new();
        let ok = TableStyles {
            custom: vec![style("Mine")],
            default_style: Some("mine".into()),
        };
        wb.set_table_styles(ok.clone()).unwrap();
        assert_eq!(wb.table_styles().get("MINE").unwrap().name, "Mine");
        let bad = |s: TableStyles| Workbook::new().set_table_styles(s).is_err();
        assert!(bad(TableStyles {
            custom: vec![style("TableStyleLight3")],
            default_style: None
        }));
        assert!(bad(TableStyles {
            custom: vec![style("A"), style("a")],
            default_style: None
        }));
        assert!(bad(TableStyles {
            custom: vec![],
            default_style: Some("Mine".into())
        }));
        let mut s = style("X");
        s.elements[1].size = 10;
        assert!(bad(TableStyles {
            custom: vec![s],
            default_style: None
        }));
        let mut s = style("X");
        s.elements[0].size = 2;
        assert!(bad(TableStyles {
            custom: vec![s],
            default_style: None
        }));
    }

    #[test]
    fn retargeting_follows_renames_and_deletes() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        wb.set_table_styles(TableStyles {
            custom: vec![style("Mine"), style("Other")],
            default_style: None,
        })
        .unwrap();
        let mut a = Table::new(1, "A", 0, 0, 2, 0, &["x".into()]);
        a.style = "Mine".into();
        let mut b = Table::new(2, "B", 0, 2, 2, 2, &["y".into()]);
        b.style = "Other".into();
        wb.set_tables(s, vec![a, b]).unwrap();
        wb.set_table_styles(TableStyles {
            custom: vec![style("Renamed")],
            default_style: None,
        })
        .unwrap();
        let changed = wb
            .retarget_table_styles(&[("Mine".into(), "Renamed".into())])
            .unwrap();
        assert_eq!(changed, vec![s]);
        assert_eq!(wb.tables(s)[0].style, "Renamed");
        assert_eq!(wb.tables(s)[1].style, DEFAULT_TABLE_STYLE);
        assert!(wb.retarget_table_styles(&[]).unwrap().is_empty());
    }
}
