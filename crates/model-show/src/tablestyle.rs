//! Table styles (`a:tblStyle` of `ppt/tableStyles.xml`): the parts of a
//! style (whole table, banded rows/columns, header/total rows, first/last
//! columns) with their fills, borders and text, how they combine on a
//! cell ([`TableStyleDef::cell`]), and PowerPoint's 74 built-in styles
//! generated from their family rules ([`builtin_table_styles`]).
//!
//! Parts apply in PowerPoint's order – whole table, banded columns,
//! banded rows, last column, first column, total row, header row – each
//! overriding what the earlier ones set. A part's `top`/`bottom`/`left`/
//! `right` borders are the outer edges of its region (the whole table,
//! one band row, the header row …), `insideH`/`insideV` the edges between
//! the cells of the region. An edge two cells share takes the border of
//! the later part.

use std::sync::OnceLock;

use core_model::units::Emu;
use core_model::{Color, ThemeColorSlot};
use serde::{Deserialize, Serialize};

use crate::shape::{Fill, Line};
use crate::table::{CellBorders, StyleCell, TableLook};

/// Formatting one part of a table style gives its cells. `None` = the part
/// does not set it; a border with `Fill::None` removes the line.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct TableStylePart {
    /// Cell fill.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub fill: Option<Fill>,
    /// Left edge of the region.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub left: Option<Line>,
    /// Right edge of the region.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub right: Option<Line>,
    /// Top edge of the region.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub top: Option<Line>,
    /// Bottom edge of the region.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub bottom: Option<Line>,
    /// Horizontal edges between the region's rows.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub inside_h: Option<Line>,
    /// Vertical edges between the region's columns.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub inside_v: Option<Line>,
    /// Bold text (`a:tcTxStyle/@b`).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub bold: Option<bool>,
    /// Italic text.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub italic: Option<bool>,
    /// Text colour.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<app_common::wire::Color>"))]
    pub text_color: Option<Color>,
}

impl TableStylePart {
    /// Whether the part sets nothing.
    pub fn is_empty(&self) -> bool {
        *self == TableStylePart::default()
    }
}

/// A table style: its GUID (`styleId`), name and parts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct TableStyleDef {
    /// `styleId`, e.g. `{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}`.
    pub id: String,
    /// `styleName`, e.g. `Medium Style 2 - Accent 1`.
    pub name: String,
    /// `a:wholeTbl` (also `a:tblBg`'s fill when the whole table sets none).
    #[serde(default)]
    pub whole: TableStylePart,
    /// `a:band1H` (odd banded rows).
    #[serde(default, skip_serializing_if = "TableStylePart::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TableStylePart>"))]
    pub band1_h: TableStylePart,
    /// `a:band2H`.
    #[serde(default, skip_serializing_if = "TableStylePart::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TableStylePart>"))]
    pub band2_h: TableStylePart,
    /// `a:band1V`.
    #[serde(default, skip_serializing_if = "TableStylePart::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TableStylePart>"))]
    pub band1_v: TableStylePart,
    /// `a:band2V`.
    #[serde(default, skip_serializing_if = "TableStylePart::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TableStylePart>"))]
    pub band2_v: TableStylePart,
    /// `a:lastCol`.
    #[serde(default, skip_serializing_if = "TableStylePart::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TableStylePart>"))]
    pub last_col: TableStylePart,
    /// `a:firstCol`.
    #[serde(default, skip_serializing_if = "TableStylePart::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TableStylePart>"))]
    pub first_col: TableStylePart,
    /// `a:lastRow` (total row).
    #[serde(default, skip_serializing_if = "TableStylePart::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TableStylePart>"))]
    pub last_row: TableStylePart,
    /// `a:firstRow` (header row).
    #[serde(default, skip_serializing_if = "TableStylePart::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TableStylePart>"))]
    pub first_row: TableStylePart,
    /// `a:seCell`: the bottom-right cell when the total row and the last
    /// column are both on.
    #[serde(default, skip_serializing_if = "TableStylePart::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TableStylePart>"))]
    pub se_cell: TableStylePart,
    /// `a:swCell`: bottom-left (total row and first column).
    #[serde(default, skip_serializing_if = "TableStylePart::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TableStylePart>"))]
    pub sw_cell: TableStylePart,
    /// `a:neCell`: top-right (header row and last column).
    #[serde(default, skip_serializing_if = "TableStylePart::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TableStylePart>"))]
    pub ne_cell: TableStylePart,
    /// `a:nwCell`: top-left (header row and first column).
    #[serde(default, skip_serializing_if = "TableStylePart::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<TableStylePart>"))]
    pub nw_cell: TableStylePart,
    /// `a:tblBg`: the table background, showing through cells the parts
    /// leave without fill.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub background: Option<Fill>,
}

/// The cells a part covers: `(top row, left col, bottom row, right col)`.
type Region = (usize, usize, usize, usize);

/// The parts of a style by their DrawingML element names, in writing
/// order (`tblBg` is [`TableStyleDef::background`]).
pub const PART_NAMES: [&str; 13] = [
    "wholeTbl", "band1H", "band2H", "band1V", "band2V", "lastCol", "firstCol", "lastRow", "seCell",
    "swCell", "firstRow", "neCell", "nwCell",
];

impl TableStyleDef {
    /// An empty style.
    pub fn new(id: &str, name: &str) -> Self {
        TableStyleDef {
            id: id.to_owned(),
            name: name.to_owned(),
            whole: TableStylePart::default(),
            band1_h: TableStylePart::default(),
            band2_h: TableStylePart::default(),
            band1_v: TableStylePart::default(),
            band2_v: TableStylePart::default(),
            last_col: TableStylePart::default(),
            first_col: TableStylePart::default(),
            last_row: TableStylePart::default(),
            first_row: TableStylePart::default(),
            se_cell: TableStylePart::default(),
            sw_cell: TableStylePart::default(),
            ne_cell: TableStylePart::default(),
            nw_cell: TableStylePart::default(),
            background: None,
        }
    }

    /// The part named `name` (see [`PART_NAMES`]).
    pub fn part(&self, name: &str) -> Option<&TableStylePart> {
        Some(match name {
            "wholeTbl" => &self.whole,
            "band1H" => &self.band1_h,
            "band2H" => &self.band2_h,
            "band1V" => &self.band1_v,
            "band2V" => &self.band2_v,
            "lastCol" => &self.last_col,
            "firstCol" => &self.first_col,
            "lastRow" => &self.last_row,
            "firstRow" => &self.first_row,
            "seCell" => &self.se_cell,
            "swCell" => &self.sw_cell,
            "neCell" => &self.ne_cell,
            "nwCell" => &self.nw_cell,
            _ => return None,
        })
    }

    /// Mutable part named `name`.
    pub fn part_mut(&mut self, name: &str) -> Option<&mut TableStylePart> {
        Some(match name {
            "wholeTbl" => &mut self.whole,
            "band1H" => &mut self.band1_h,
            "band2H" => &mut self.band2_h,
            "band1V" => &mut self.band1_v,
            "band2V" => &mut self.band2_v,
            "lastCol" => &mut self.last_col,
            "firstCol" => &mut self.first_col,
            "lastRow" => &mut self.last_row,
            "firstRow" => &mut self.first_row,
            "seCell" => &mut self.se_cell,
            "swCell" => &mut self.sw_cell,
            "neCell" => &mut self.ne_cell,
            "nwCell" => &mut self.nw_cell,
            _ => return None,
        })
    }

    /// The parts that apply to cell `row`, `col` of a `rows` × `cols`
    /// table with `look`, in application order, each with its region
    /// `(top row, left col, bottom row, right col)` (inclusive) and its
    /// rank (later parts rank higher).
    fn regions(
        &self,
        look: TableLook,
        rows: usize,
        cols: usize,
        row: usize,
        col: usize,
    ) -> Vec<(&TableStylePart, Region, usize)> {
        let (lr, lc) = (rows.saturating_sub(1), cols.saturating_sub(1));
        let mut out = vec![(&self.whole, (0, 0, lr, lc), 1)];
        let in_first_col = look.first_col && col == 0;
        let in_last_col = look.last_col && col == lc && cols > 1;
        let in_first_row = look.first_row && row == 0;
        let in_last_row = look.last_row && row == lr && rows > 1;
        // bands skip the header/total rows and first/last columns
        let (r0, r1) = (
            usize::from(look.first_row),
            if look.last_row && rows > 1 {
                lr.saturating_sub(1)
            } else {
                lr
            },
        );
        let (c0, c1) = (
            usize::from(look.first_col),
            if look.last_col && cols > 1 {
                lc.saturating_sub(1)
            } else {
                lc
            },
        );
        if look.band_cols && col >= c0 && col <= c1 {
            let part = if (col - c0) % 2 == 0 {
                &self.band1_v
            } else {
                &self.band2_v
            };
            out.push((part, (r0, col, r1, col), 2));
        }
        if look.band_rows && row >= r0 && row <= r1 {
            let part = if (row - r0) % 2 == 0 {
                &self.band1_h
            } else {
                &self.band2_h
            };
            out.push((part, (row, c0, row, c1), 3));
        }
        if in_last_col {
            out.push((&self.last_col, (0, lc, lr, lc), 4));
        }
        if in_first_col {
            out.push((&self.first_col, (0, 0, lr, 0), 5));
        }
        if in_last_row {
            out.push((&self.last_row, (lr, 0, lr, lc), 6));
        }
        if in_first_row {
            out.push((&self.first_row, (0, 0, 0, lc), 7));
        }
        // the corner cells where two emphasized edges meet
        let corners = [
            (in_last_row && in_last_col, &self.se_cell),
            (in_last_row && in_first_col, &self.sw_cell),
            (in_first_row && in_last_col, &self.ne_cell),
            (in_first_row && in_first_col, &self.nw_cell),
        ];
        for (rank, (on, part)) in corners.into_iter().enumerate() {
            if on {
                out.push((part, (row, col, row, col), 8 + rank));
            }
        }
        out
    }

    /// Fill, text and the borders (with the index of the part that set
    /// each: left, right, top, bottom) of one cell before shared edges are
    /// settled.
    fn raw_cell(
        &self,
        look: TableLook,
        rows: usize,
        cols: usize,
        row: usize,
        col: usize,
    ) -> (StyleCell, [(usize, Option<Line>); 4]) {
        let mut cell = StyleCell {
            fill: Fill::None,
            borders: CellBorders::default(),
            bold: false,
            text_color: None,
        };
        let mut edges: [(usize, Option<Line>); 4] = [(0, None); 4];
        for (part, (t, l, b, r), rank) in self.regions(look, rows, cols, row, col) {
            if let Some(f) = part.fill {
                cell.fill = f;
            }
            if let Some(v) = part.bold {
                cell.bold = v;
            }
            if let Some(c) = part.text_color {
                cell.text_color = Some(c);
            }
            let pick = |outer: bool, edge: Option<Line>, inside: Option<Line>| {
                if outer {
                    edge
                } else {
                    inside
                }
            };
            let set = [
                pick(col == l, part.left, part.inside_v),
                pick(col == r, part.right, part.inside_v),
                pick(row == t, part.top, part.inside_h),
                pick(row == b, part.bottom, part.inside_h),
            ];
            for (e, v) in edges.iter_mut().zip(set) {
                if v.is_some() {
                    *e = (rank, v);
                }
            }
        }
        (cell, edges)
    }

    /// What the style gives cell `row`, `col` of a `rows` × `cols` table
    /// with `look` (a shared edge takes the border of the part applied
    /// later on either side).
    pub fn cell(
        &self,
        look: TableLook,
        rows: usize,
        cols: usize,
        row: usize,
        col: usize,
    ) -> StyleCell {
        let (mut cell, mut e) = self.raw_cell(look, rows, cols, row, col);
        let settle = |mine: &mut (usize, Option<Line>), theirs: (usize, Option<Line>)| {
            if theirs.0 > mine.0 {
                *mine = theirs;
            }
        };
        if col > 0 {
            settle(
                &mut e[0],
                self.raw_cell(look, rows, cols, row, col - 1).1[1],
            );
        }
        if col + 1 < cols {
            settle(
                &mut e[1],
                self.raw_cell(look, rows, cols, row, col + 1).1[0],
            );
        }
        if row > 0 {
            settle(
                &mut e[2],
                self.raw_cell(look, rows, cols, row - 1, col).1[3],
            );
        }
        if row + 1 < rows {
            settle(
                &mut e[3],
                self.raw_cell(look, rows, cols, row + 1, col).1[2],
            );
        }
        if cell.fill == Fill::None {
            if let Some(bg) = self.background {
                cell.fill = bg;
            }
        }
        let real = |l: Option<Line>| l.filter(|l| l.fill != Fill::None);
        cell.borders = CellBorders {
            left: real(e[0].1),
            right: real(e[1].1),
            top: real(e[2].1),
            bottom: real(e[3].1),
        };
        cell
    }
}

// --- built-in styles ------------------------------------------------------------

/// The families of PowerPoint's built-in styles, in gallery order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Family {
    Themed1,
    Themed2,
    Light1,
    Light2,
    Light3,
    Medium1,
    Medium2,
    Medium3,
    Medium4,
    Dark1,
    Dark2,
}

/// `(GUID, family, accent 0 = none)` of PowerPoint's 74 built-in styles
/// (Microsoft's published list; Dark Style 2 has the accent pairs 1/2, 3/4,
/// 5/6 only).
const BUILTIN: [(&str, Family, u8); 74] = [
    ("{2D5ABB26-0587-4C30-8999-92F81FD0307C}", Family::Themed1, 0),
    ("{3C2FFA5D-87B4-456A-9821-1D502468CF0F}", Family::Themed1, 1),
    ("{284E427A-3D55-4303-BF80-6455036E1DE7}", Family::Themed1, 2),
    ("{69C7853C-536D-4A76-A0AE-DD22124D55A5}", Family::Themed1, 3),
    ("{775DCB02-9BB8-47FD-8907-85C794F793BA}", Family::Themed1, 4),
    ("{35758FB7-9AC5-4552-8A53-C91805E547FA}", Family::Themed1, 5),
    ("{08FB837D-C827-4EFA-A057-4D05807E0F7C}", Family::Themed1, 6),
    ("{5940675A-B579-460E-94D1-54222C63F5DA}", Family::Themed2, 0),
    ("{D113A9D2-9D6B-4929-AA2D-F23B5EE8CBE7}", Family::Themed2, 1),
    ("{18603FDC-E32A-4AB5-989C-0864C3EAD2B8}", Family::Themed2, 2),
    ("{306799F8-075E-4A3A-A7F6-7FBC6576F1A4}", Family::Themed2, 3),
    ("{E269D01E-BC32-4049-B463-5C60D7B0CCD2}", Family::Themed2, 4),
    ("{327F97BB-C833-4FB7-BDE5-3F7075034690}", Family::Themed2, 5),
    ("{638B1855-1B75-4FBE-930C-398BA8C253C6}", Family::Themed2, 6),
    ("{9D7B26C5-4107-4FEC-AEDC-1716B250A1EF}", Family::Light1, 0),
    ("{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}", Family::Light1, 1),
    ("{0E3FDE45-AF77-4B5C-9715-49D594BDF05E}", Family::Light1, 2),
    ("{C083E6E3-FA7D-4D7B-A595-EF9225AFEA82}", Family::Light1, 3),
    ("{D27102A9-8310-4765-A935-A1911B00CA55}", Family::Light1, 4),
    ("{5FD0F851-EC5A-4D38-B0AD-8093EC10F338}", Family::Light1, 5),
    ("{68D230F3-CF80-4859-8CE7-A43EE81993B5}", Family::Light1, 6),
    ("{7E9639D4-E3E2-4D34-9284-5A2195B3D0D7}", Family::Light2, 0),
    ("{69012ECD-51FC-41F1-AA8D-1B2483CD663E}", Family::Light2, 1),
    ("{72833802-FEF1-4C79-8D5D-14CF1EAF98D9}", Family::Light2, 2),
    ("{F2DE63D5-997A-4646-A377-4702673A728D}", Family::Light2, 3),
    ("{17292A2E-F333-43FB-9621-5CBBE7FDCDCB}", Family::Light2, 4),
    ("{5A111915-BE36-4E01-A7E5-04B1672EAD32}", Family::Light2, 5),
    ("{912C8C85-51F0-491E-9774-3900AFEF0FD7}", Family::Light2, 6),
    ("{616DA210-FB5B-4158-B5E0-FEB733F419BA}", Family::Light3, 0),
    ("{BC89EF96-8CEA-46FF-86C4-4CE0E7609802}", Family::Light3, 1),
    ("{5DA37D80-6434-44D0-A028-1B22A696006F}", Family::Light3, 2),
    ("{8799B23B-EC83-4686-B30A-512413B5E67A}", Family::Light3, 3),
    ("{ED083AE6-46FA-4A59-8FB0-9F97EB10719F}", Family::Light3, 4),
    ("{BDBED569-4797-4DF1-A0F4-6AAB3CD982D8}", Family::Light3, 5),
    ("{E8B1032C-EA38-4F05-BA0D-38AFFFC7BED3}", Family::Light3, 6),
    ("{793D81CF-94F2-401A-BA57-92F5A7B2D0C5}", Family::Medium1, 0),
    ("{B301B821-A1FF-4177-AEE7-76D212191A09}", Family::Medium1, 1),
    ("{9DCAF9ED-07DC-4A11-8D7F-57B35C25682E}", Family::Medium1, 2),
    ("{1FECB4D8-DB02-4DC6-A0A2-4F2EBAE1DC90}", Family::Medium1, 3),
    ("{1E171933-4619-4E11-9A3F-F7608DF75F80}", Family::Medium1, 4),
    ("{FABFCF23-3B69-468F-B69F-88F6DE6A72F2}", Family::Medium1, 5),
    ("{10A1B5D5-9B99-4C35-A422-299274C87663}", Family::Medium1, 6),
    ("{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}", Family::Medium2, 0),
    ("{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}", Family::Medium2, 1),
    ("{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}", Family::Medium2, 2),
    ("{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}", Family::Medium2, 3),
    ("{00A15C55-8517-42AA-B614-E9B94910E393}", Family::Medium2, 4),
    ("{7DF18680-E054-41AD-8BC1-D1AEF772440D}", Family::Medium2, 5),
    ("{93296810-A885-4BE3-A3E7-6D5BEEA58F35}", Family::Medium2, 6),
    ("{8EC20E35-A176-4012-BC5E-935CFFF8708E}", Family::Medium3, 0),
    ("{6E25E649-3F16-4E02-A733-19D2CDBF48F0}", Family::Medium3, 1),
    ("{85BE263C-DBD7-4A20-BB59-AAB30ACAA65A}", Family::Medium3, 2),
    ("{EB344D84-9AFB-497E-A393-DC336BA19D2E}", Family::Medium3, 3),
    ("{EB9631B5-78F2-41C9-869B-9F39066F8104}", Family::Medium3, 4),
    ("{74C1A8A3-306A-4EB7-A6B1-4F7E0EB9C5D6}", Family::Medium3, 5),
    ("{2A488322-F2BA-4B5B-9748-0D474271808F}", Family::Medium3, 6),
    ("{D7AC3CCA-C797-4891-BE02-D94E43425B78}", Family::Medium4, 0),
    ("{69CF1AB2-1976-4502-BF36-3FF5EA218861}", Family::Medium4, 1),
    ("{8A107856-5554-42FB-B03E-39F5DBC370BA}", Family::Medium4, 2),
    ("{0505E3EF-67EA-436B-97B2-0124C06EBD24}", Family::Medium4, 3),
    ("{C4B1156A-380E-4F78-BDF5-A606A8083BF9}", Family::Medium4, 4),
    ("{22838BEF-8BB2-4498-84A7-C5851F593DF1}", Family::Medium4, 5),
    ("{16D9F66E-5EB9-4882-86FB-DCBF35E3C3E4}", Family::Medium4, 6),
    ("{E8034E78-7F5D-4C2E-B375-FC64B27BC917}", Family::Dark1, 0),
    ("{125E5076-3810-47DD-B79F-674D7AD40C01}", Family::Dark1, 1),
    ("{37CE84F3-28C3-443E-9E96-99CF82512B78}", Family::Dark1, 2),
    ("{D03447BB-5D67-496B-8E87-E561075AD55C}", Family::Dark1, 3),
    ("{E929F9F4-4A8F-4326-A1B4-22849713DDAB}", Family::Dark1, 4),
    ("{8FD4443E-F989-4FC4-A0C8-D5A2AF1F390B}", Family::Dark1, 5),
    ("{AF606853-7671-496A-8E4F-DF71F8EC918B}", Family::Dark1, 6),
    ("{5202B0CA-FC54-4496-8BCA-5EF66A818D29}", Family::Dark2, 0),
    ("{0660B408-B3CF-4A94-85FC-2B1E0A45F4A2}", Family::Dark2, 1),
    ("{91EBBBCC-DAD2-459C-BE2E-F6DE35CF9A28}", Family::Dark2, 3),
    ("{46F890A9-2807-4EBB-B81D-B2AA78EC7F39}", Family::Dark2, 5),
];

fn accent_slot(n: u8) -> ThemeColorSlot {
    match n {
        1 => ThemeColorSlot::Accent1,
        2 => ThemeColorSlot::Accent2,
        3 => ThemeColorSlot::Accent3,
        4 => ThemeColorSlot::Accent4,
        5 => ThemeColorSlot::Accent5,
        6 => ThemeColorSlot::Accent6,
        _ => ThemeColorSlot::Dark1,
    }
}

/// The style's name as PowerPoint writes it (`Medium Style 2 - Accent 1`,
/// `Dark Style 2 - Accent 1/Accent 2`, `No Style, No Grid`).
fn builtin_name(family: Family, accent: u8) -> String {
    let base = match family {
        Family::Themed1 if accent == 0 => return "No Style, No Grid".into(),
        Family::Themed2 if accent == 0 => return "No Style, Table Grid".into(),
        Family::Themed1 => "Themed Style 1",
        Family::Themed2 => "Themed Style 2",
        Family::Light1 => "Light Style 1",
        Family::Light2 => "Light Style 2",
        Family::Light3 => "Light Style 3",
        Family::Medium1 => "Medium Style 1",
        Family::Medium2 => "Medium Style 2",
        Family::Medium3 => "Medium Style 3",
        Family::Medium4 => "Medium Style 4",
        Family::Dark1 => "Dark Style 1",
        Family::Dark2 => "Dark Style 2",
    };
    match (family, accent) {
        (_, 0) => base.to_owned(),
        (Family::Dark2, a) => format!("{base} - Accent {a}/Accent {}", a + 1),
        (_, a) => format!("{base} - Accent {a}"),
    }
}

/// The width of `a:lnRef idx` (1–3) in the Office theme's line styles.
pub const LINE_REF_WIDTHS: [i64; 3] = [6_350, 12_700, 19_050];

/// One built-in style from its family's rules (`accent` 0 = the plain
/// variant, drawn in Dark 1 / Text 1).
///
/// The rules follow the `a:tblStyle` definitions PowerPoint writes into
/// `tableStyles.xml` (see `docs/ooxml-subset.md`, "Table styles"). Colour
/// transforms map onto [`Color::Theme`]'s tint: DrawingML `tint N %`
/// (N % colour, the rest white) is a tint of `1 − N/100`, `shade N %` a
/// tint of `−(1 − N/100)`; `alpha N %` is drawn as the colour mixed into
/// what lies below (white, or the table background). `a:lnRef idx` lines
/// take the Office theme's widths ([`LINE_REF_WIDTHS`]); `a:tblBg`'s
/// `a:fillRef` gradients are approximated by a solid colour (idx 2: the
/// accent 27 % lighter, the middle stop of the Office theme's subtle
/// gradient; idx 3: the accent).
fn builtin(id: &str, family: Family, accent: u8) -> TableStyleDef {
    use crate::shape::LineCompound;
    let a = accent_slot(accent);
    let col = |tint: f64| Color::Theme { slot: a, tint };
    let acc = col(0.0);
    let dk1 = Color::theme(ThemeColorSlot::Dark1);
    let lt1 = Color::theme(ThemeColorSlot::Light1);
    let dk1t = |tint: f64| Color::Theme {
        slot: ThemeColorSlot::Dark1,
        tint,
    };
    let ln = |c: Color, w: i64| Some(Line::solid(c, Emu(w)));
    let lnref = |c: Color, idx: usize| Some(Line::solid(c, Emu(LINE_REF_WIDTHS[idx - 1])));
    let dbl = |c: Color| Some(Line::solid(c, Emu(50_800)).with_compound(LineCompound::Double));
    let no = Some(Line::default());
    let fill = |c: Color| Some(Fill::Solid(c));
    let nofill = Some(Fill::None);
    let mut s = TableStyleDef::new(id, &builtin_name(family, accent));
    let outer = |p: &mut TableStylePart, l: Option<Line>| {
        p.left = l;
        p.right = l;
        p.top = l;
        p.bottom = l;
    };
    let grid = |p: &mut TableStylePart, l: Option<Line>| {
        outer(p, l);
        p.inside_h = l;
        p.inside_v = l;
    };
    let bold = |p: &mut TableStylePart| p.bold = Some(true);
    let bold_edges = |s: &mut TableStyleDef| {
        for p in [
            &mut s.first_row,
            &mut s.last_row,
            &mut s.first_col,
            &mut s.last_col,
        ] {
            bold(p);
        }
    };
    let bands = |s: &mut TableStyleDef, c: Color| {
        s.band1_h.fill = fill(c);
        s.band1_v.fill = fill(c);
    };
    match family {
        Family::Themed1 if accent == 0 => {
            // No Style, No Grid
            s.whole.text_color = Some(dk1);
            grid(&mut s.whole, no);
            s.whole.fill = nofill;
        }
        Family::Themed1 => {
            s.background = fill(col(0.27));
            s.whole.text_color = Some(dk1);
            grid(&mut s.whole, lnref(acc, 1));
            s.whole.fill = nofill;
            // alpha 40 % accent over the background
            bands(&mut s, col(0.16));
            s.band1_v.top = lnref(acc, 1);
            s.band1_v.bottom = lnref(acc, 1);
            bold_edges(&mut s);
            for (p, inner_left) in [(&mut s.last_col, true), (&mut s.first_col, false)] {
                outer(p, lnref(acc, 1));
                if inner_left {
                    p.left = lnref(acc, 2);
                } else {
                    p.right = lnref(acc, 2);
                }
                p.inside_h = lnref(acc, 1);
                p.inside_v = no;
            }
            outer(&mut s.last_row, lnref(acc, 1));
            s.last_row.top = lnref(acc, 2);
            s.last_row.bottom = lnref(acc, 2);
            s.last_row.inside_h = no;
            s.last_row.inside_v = no;
            s.last_row.fill = nofill;
            outer(&mut s.first_row, lnref(acc, 1));
            s.first_row.bottom = lnref(lt1, 2);
            s.first_row.inside_h = no;
            s.first_row.inside_v = no;
            s.first_row.fill = fill(acc);
            s.first_row.text_color = Some(lt1);
        }
        Family::Themed2 if accent == 0 => {
            // No Style, Table Grid
            s.whole.text_color = Some(dk1);
            grid(&mut s.whole, ln(dk1, 12_700));
            s.whole.fill = nofill;
        }
        Family::Themed2 => {
            s.background = fill(acc);
            s.whole.text_color = Some(lt1);
            outer(&mut s.whole, lnref(col(0.5), 1));
            s.whole.inside_h = no;
            s.whole.inside_v = no;
            s.whole.fill = nofill;
            // alpha 20 % white over the accent background
            bands(&mut s, col(0.2));
            bold_edges(&mut s);
            s.last_col.left = lnref(lt1, 2);
            s.first_col.right = lnref(lt1, 2);
            s.last_row.top = lnref(lt1, 2);
            s.last_row.fill = nofill;
            s.first_row.bottom = lnref(lt1, 3);
            s.first_row.fill = nofill;
            s.se_cell.left = no;
            s.se_cell.top = no;
            s.sw_cell.right = no;
            s.sw_cell.top = no;
            s.ne_cell.bottom = no;
        }
        Family::Light1 => {
            s.whole.text_color = Some(dk1);
            grid(&mut s.whole, no);
            s.whole.top = ln(acc, 12_700);
            s.whole.bottom = ln(acc, 12_700);
            s.whole.fill = nofill;
            bands(&mut s, col(0.8));
            bold_edges(&mut s);
            s.last_row.top = ln(acc, 12_700);
            s.last_row.fill = nofill;
            s.first_row.bottom = ln(acc, 12_700);
            s.first_row.fill = nofill;
        }
        Family::Light2 => {
            s.whole.text_color = Some(dk1);
            outer(&mut s.whole, lnref(acc, 1));
            s.whole.inside_h = no;
            s.whole.inside_v = no;
            s.whole.fill = nofill;
            s.band1_h.top = lnref(acc, 1);
            s.band1_h.bottom = lnref(acc, 1);
            for p in [&mut s.band1_v, &mut s.band2_v] {
                p.left = lnref(acc, 1);
                p.right = lnref(acc, 1);
            }
            bold_edges(&mut s);
            s.last_row.top = dbl(acc);
            s.first_row.fill = fill(acc);
            s.first_row.text_color = Some(lt1);
        }
        Family::Light3 => {
            s.whole.text_color = Some(dk1);
            grid(&mut s.whole, ln(acc, 12_700));
            s.whole.fill = nofill;
            bands(&mut s, col(0.8));
            bold_edges(&mut s);
            s.last_row.top = dbl(acc);
            s.last_row.fill = nofill;
            s.first_row.bottom = ln(acc, 25_400);
            s.first_row.fill = nofill;
        }
        Family::Medium1 => {
            s.whole.text_color = Some(dk1);
            outer(&mut s.whole, ln(acc, 12_700));
            s.whole.inside_h = ln(acc, 12_700);
            s.whole.inside_v = no;
            s.whole.fill = fill(lt1);
            bands(&mut s, col(0.8));
            bold_edges(&mut s);
            s.last_row.top = dbl(acc);
            s.last_row.fill = fill(lt1);
            s.first_row.fill = fill(acc);
            s.first_row.text_color = Some(lt1);
        }
        Family::Medium2 => {
            s.whole.text_color = Some(dk1);
            grid(&mut s.whole, ln(lt1, 12_700));
            s.whole.fill = fill(col(0.8));
            bands(&mut s, col(0.6));
            for p in [
                &mut s.first_row,
                &mut s.last_row,
                &mut s.first_col,
                &mut s.last_col,
            ] {
                p.fill = fill(acc);
                p.text_color = Some(lt1);
                p.bold = Some(true);
            }
            s.first_row.bottom = ln(lt1, 38_100);
            s.last_row.top = ln(lt1, 38_100);
        }
        Family::Medium3 => {
            s.whole.text_color = Some(dk1);
            grid(&mut s.whole, no);
            s.whole.top = ln(dk1, 25_400);
            s.whole.bottom = ln(dk1, 25_400);
            s.whole.fill = fill(lt1);
            bands(&mut s, dk1t(0.8));
            bold_edges(&mut s);
            for p in [&mut s.first_col, &mut s.last_col] {
                p.fill = fill(acc);
                p.text_color = Some(lt1);
            }
            s.last_row.top = dbl(dk1);
            s.last_row.fill = fill(lt1);
            for p in [&mut s.se_cell, &mut s.sw_cell] {
                p.bold = Some(true);
                p.text_color = Some(dk1);
            }
            s.first_row.text_color = Some(lt1);
            s.first_row.bottom = ln(dk1, 25_400);
            s.first_row.fill = fill(acc);
        }
        Family::Medium4 => {
            s.whole.text_color = Some(dk1);
            grid(&mut s.whole, ln(acc, 12_700));
            s.whole.fill = fill(col(0.8));
            bands(&mut s, col(0.6));
            bold_edges(&mut s);
            s.last_row.top = ln(acc, 25_400);
            s.last_row.fill = fill(col(0.8));
            s.first_row.fill = fill(col(0.8));
        }
        Family::Dark1 => {
            // accents: the accent and its shades; plain: Dark 1 and its tints
            let k = |amount: f64| {
                if accent == 0 {
                    dk1t(amount)
                } else {
                    col(-amount)
                }
            };
            let (whole, band, cols, total) = if accent == 0 {
                (k(0.8), k(0.6), k(0.4), k(0.4))
            } else {
                (acc, k(0.4), k(0.4), k(0.6))
            };
            s.whole.text_color = Some(lt1);
            grid(&mut s.whole, no);
            s.whole.fill = fill(whole);
            bands(&mut s, band);
            bold_edges(&mut s);
            s.last_col.left = ln(lt1, 25_400);
            s.last_col.fill = fill(cols);
            s.first_col.right = ln(lt1, 25_400);
            s.first_col.fill = fill(cols);
            s.last_row.top = ln(lt1, 25_400);
            s.last_row.fill = fill(total);
            s.first_row.bottom = ln(lt1, 25_400);
            s.first_row.fill = fill(dk1);
            s.se_cell.left = no;
            s.sw_cell.right = no;
            s.ne_cell.left = no;
            s.nw_cell.right = no;
        }
        Family::Dark2 => {
            let head = if accent == 0 {
                dk1
            } else {
                Color::theme(accent_slot(accent + 1))
            };
            s.whole.text_color = Some(dk1);
            grid(&mut s.whole, no);
            s.whole.fill = fill(col(0.8));
            bands(&mut s, col(0.6));
            bold_edges(&mut s);
            s.last_row.top = dbl(dk1);
            s.last_row.fill = fill(col(0.8));
            s.first_row.fill = fill(head);
            s.first_row.text_color = Some(lt1);
        }
    }
    s
}

/// PowerPoint's 74 built-in table styles in gallery order: Themed Style 1
/// and 2 (the plain variants are "No Style, No Grid" and "No Style, Table
/// Grid"), Light Style 1–3, Medium Style 1–4 and Dark Style 1 (plain + six
/// accents), Dark Style 2 (plain + three accent pairs).
pub fn builtin_table_styles() -> &'static [TableStyleDef] {
    static STYLES: OnceLock<Vec<TableStyleDef>> = OnceLock::new();
    STYLES.get_or_init(|| {
        BUILTIN
            .iter()
            .map(|&(id, family, accent)| builtin(id, family, accent))
            .collect()
    })
}

/// The built-in style with GUID `id` (case-insensitive).
pub fn builtin_table_style(id: &str) -> Option<&'static TableStyleDef> {
    builtin_table_styles()
        .iter()
        .find(|s| s.id.eq_ignore_ascii_case(id))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn look() -> TableLook {
        TableLook {
            first_row: true,
            band_rows: true,
            ..TableLook::default()
        }
    }

    #[test]
    fn builtins_are_complete_and_unique() {
        let all = builtin_table_styles();
        assert_eq!(all.len(), 74);
        let mut ids: Vec<&str> = all.iter().map(|s| s.id.as_str()).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 74);
        let ms2 = builtin_table_style("{f5ab1c69-6edb-4ff4-983f-18bd219ef322}").unwrap();
        assert_eq!(ms2.name, "Medium Style 2 - Accent 3");
        assert_eq!(
            builtin_table_style("{0660B408-B3CF-4A94-85FC-2B1E0A45F4A2}")
                .unwrap()
                .name,
            "Dark Style 2 - Accent 1/Accent 2"
        );
        assert_eq!(
            builtin_table_style("{2D5ABB26-0587-4C30-8999-92F81FD0307C}")
                .unwrap()
                .name,
            "No Style, No Grid"
        );
        // every family but the plain Themed 1 sets something
        for s in all.iter().filter(|s| s.name != "No Style, No Grid") {
            let c = s.cell(look(), 3, 3, 0, 0);
            assert!(
                c.fill != Fill::None
                    || c.borders != CellBorders::default()
                    || c.text_color.is_some(),
                "{}",
                s.name
            );
        }
    }

    #[test]
    fn parts_apply_in_order_and_edges_settle() {
        let acc = |t: f64| Color::Theme {
            slot: ThemeColorSlot::Accent3,
            tint: t,
        };
        let ms2 = builtin_table_style("{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}").unwrap();
        // header row: accent 3, bold light text, 3 pt light line below
        let h = ms2.cell(look(), 4, 3, 0, 1);
        assert_eq!(h.fill, Fill::Solid(acc(0.0)));
        assert!(h.bold);
        assert_eq!(h.borders.bottom.unwrap().width, Emu(38_100));
        // the row below shares that edge
        let b = ms2.cell(look(), 4, 3, 1, 1);
        assert_eq!(b.borders.top.unwrap().width, Emu(38_100));
        assert_eq!(b.fill, Fill::Solid(acc(0.6)));
        // second band
        assert_eq!(ms2.cell(look(), 4, 3, 2, 1).fill, Fill::Solid(acc(0.8)));
        // Light Style 1: no grid, outer top/bottom lines, header line
        let l1 = builtin_table_style("{3B4B98B0-60AC-42C2-AFA5-B58CD77FA1E5}").unwrap();
        let c = l1.cell(look(), 3, 3, 1, 1);
        assert!(c.borders.left.is_none() && c.borders.right.is_none());
        assert!(c.borders.top.is_some(), "the header's bottom line");
        // banded columns skip the first column when it is emphasized
        let cols = TableLook {
            first_col: true,
            band_cols: true,
            ..TableLook::default()
        };
        let lt = builtin_table_style("{BC89EF96-8CEA-46FF-86C4-4CE0E7609802}").unwrap();
        assert_eq!(
            lt.cell(cols, 3, 4, 1, 1).fill,
            Fill::Solid(Color::Theme {
                slot: ThemeColorSlot::Accent1,
                tint: 0.8
            })
        );
        assert_eq!(lt.cell(cols, 3, 4, 1, 2).fill, Fill::None);
        // Dark Style 2 pairs: the header takes the next accent
        let d2 = builtin_table_style("{91EBBBCC-DAD2-459C-BE2E-F6DE35CF9A28}").unwrap();
        assert_eq!(
            d2.cell(look(), 3, 3, 0, 0).fill,
            Fill::Solid(Color::theme(ThemeColorSlot::Accent4))
        );
        // JSON
        let json = serde_json::to_string(ms2).unwrap();
        let back: TableStyleDef = serde_json::from_str(&json).unwrap();
        assert_eq!(&back, ms2);
    }

    fn style(name: &str) -> &'static TableStyleDef {
        builtin_table_styles()
            .iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("{name}"))
    }

    fn th(slot: ThemeColorSlot, tint: f64) -> Color {
        Color::Theme { slot, tint }
    }

    fn all_flags() -> TableLook {
        TableLook {
            first_row: true,
            first_col: true,
            last_row: true,
            last_col: true,
            band_rows: true,
            band_cols: false,
        }
    }

    #[test]
    fn dark_style_1_accent_1_as_powerpoint_defines_it() {
        let s = style("Dark Style 1 - Accent 1");
        let a1 = |t| th(ThemeColorSlot::Accent1, t);
        let lt1 = Color::theme(ThemeColorSlot::Light1);
        // body: the accent, bands its 60 % shade, white bold-less text
        let body = s.cell(look(), 4, 3, 2, 1);
        assert_eq!(body.fill, Fill::Solid(a1(0.0)));
        assert_eq!(body.text_color, Some(lt1));
        assert!(!body.bold);
        assert_eq!(s.cell(look(), 4, 3, 1, 1).fill, Fill::Solid(a1(-0.4)));
        assert!(body.borders.left.is_none() && body.borders.right.is_none());
        // header: Dark 1, a 2 pt white line below, bold
        let head = s.cell(look(), 4, 3, 0, 1);
        assert_eq!(head.fill, Fill::Solid(Color::theme(ThemeColorSlot::Dark1)));
        assert_eq!(head.borders.bottom, Some(Line::solid(lt1, Emu(25_400))));
        assert!(head.bold);
        // first column: shade, a white line on its right – except in the
        // header and total rows (the nw / sw corner cells remove it)
        let fc = all_flags();
        assert_eq!(
            s.cell(fc, 4, 3, 1, 0).borders.right,
            Some(Line::solid(lt1, Emu(25_400)))
        );
        assert_eq!(s.cell(fc, 4, 3, 0, 0).borders.right, None);
        assert_eq!(s.cell(fc, 4, 3, 3, 0).borders.right, None);
        assert_eq!(s.cell(fc, 4, 3, 0, 1).borders.left, None, "shared edge");
        // total row: the 40 % shade
        assert_eq!(s.cell(fc, 4, 3, 3, 1).fill, Fill::Solid(a1(-0.6)));
        // the plain variant uses Dark 1 and its tints
        let plain = style("Dark Style 1");
        assert_eq!(
            plain.cell(look(), 4, 3, 2, 1).fill,
            Fill::Solid(th(ThemeColorSlot::Dark1, 0.8))
        );
    }

    #[test]
    fn total_rows_take_double_lines() {
        for (name, color) in [
            ("Light Style 2 - Accent 2", th(ThemeColorSlot::Accent2, 0.0)),
            ("Light Style 3 - Accent 4", th(ThemeColorSlot::Accent4, 0.0)),
            (
                "Medium Style 1 - Accent 6",
                th(ThemeColorSlot::Accent6, 0.0),
            ),
            (
                "Medium Style 3 - Accent 1",
                Color::theme(ThemeColorSlot::Dark1),
            ),
            (
                "Dark Style 2 - Accent 5/Accent 6",
                Color::theme(ThemeColorSlot::Dark1),
            ),
        ] {
            let s = style(name);
            let look = TableLook {
                last_row: true,
                ..TableLook::default()
            };
            let total = s.cell(look, 4, 2, 3, 0);
            let top = total.borders.top.unwrap_or_else(|| panic!("{name}"));
            assert_eq!(top.width, Emu(50_800), "{name}");
            assert_eq!(top.compound, crate::shape::LineCompound::Double, "{name}");
            assert_eq!(top.fill, Fill::Solid(color), "{name}");
            assert!(total.bold, "{name}");
        }
        // Medium Style 2 and 4 use single lines
        let look = TableLook {
            last_row: true,
            ..TableLook::default()
        };
        let m4 = style("Medium Style 4 - Accent 1").cell(look, 4, 2, 3, 0);
        assert_eq!(m4.borders.top.unwrap().width, Emu(25_400));
        assert!(m4.borders.top.unwrap().compound.is_single());
    }

    #[test]
    fn light_and_medium_headers() {
        // Light Style 3: no header fill or text colour, a 2 pt accent line
        let l3 = style("Light Style 3 - Accent 2").cell(look(), 3, 3, 0, 1);
        assert_eq!(l3.fill, Fill::None);
        assert_eq!(l3.text_color, Some(Color::theme(ThemeColorSlot::Dark1)));
        assert_eq!(l3.borders.bottom.unwrap().width, Emu(25_400));
        // Medium Style 4: the header shares the body's light accent, dark text
        let m4 = style("Medium Style 4 - Accent 3");
        let h = m4.cell(look(), 3, 3, 0, 1);
        assert_eq!(h.fill, Fill::Solid(th(ThemeColorSlot::Accent3, 0.8)));
        assert_eq!(h.text_color, Some(Color::theme(ThemeColorSlot::Dark1)));
        assert!(h.bold);
        // Medium Style 1: horizontal lines only, inside verticals removed
        let m1 = style("Medium Style 1 - Accent 1").cell(look(), 3, 3, 1, 1);
        assert!(m1.borders.left.is_none() && m1.borders.right.is_none());
        assert_eq!(m1.borders.bottom.unwrap().width, Emu(12_700));
        // Medium Style 3: the corner cells of the total row keep dark text
        let m3 = style("Medium Style 3 - Accent 1");
        let fc = all_flags();
        let lt1 = Color::theme(ThemeColorSlot::Light1);
        assert_eq!(m3.cell(fc, 4, 3, 1, 2).text_color, Some(lt1));
        assert_eq!(
            m3.cell(fc, 4, 3, 3, 2).text_color,
            Some(Color::theme(ThemeColorSlot::Dark1))
        );
        assert_eq!(m3.cell(fc, 4, 3, 3, 2).fill, Fill::Solid(lt1));
    }

    #[test]
    fn themed_styles_show_their_background() {
        let t2 = style("Themed Style 2 - Accent 1");
        let a1 = |t| th(ThemeColorSlot::Accent1, t);
        // no part fills the cells: the table background (the accent) shows
        let mut l = look();
        l.band_rows = false;
        assert_eq!(t2.cell(l, 3, 3, 1, 1).fill, Fill::Solid(a1(0.0)));
        // bands: 20 % white over it
        assert_eq!(t2.cell(look(), 3, 3, 1, 1).fill, Fill::Solid(a1(0.2)));
        // the header's line is the theme's third line width (lnRef 3)
        assert_eq!(
            t2.cell(look(), 3, 3, 0, 1).borders.bottom.unwrap().width,
            Emu(LINE_REF_WIDTHS[2])
        );
        let t1 = style("Themed Style 1 - Accent 1");
        assert_eq!(t1.background, Some(Fill::Solid(a1(0.27))));
        assert_eq!(
            t1.cell(look(), 3, 3, 1, 1).borders.left.unwrap().width,
            Emu(6_350)
        );
        // No Style, Table Grid: a 1 pt Text 1 grid, no fill
        let grid = style("No Style, Table Grid").cell(look(), 3, 3, 1, 1);
        assert_eq!(grid.fill, Fill::None);
        assert_eq!(
            grid.borders.left,
            Some(Line::solid(
                Color::theme(ThemeColorSlot::Dark1),
                Emu(12_700)
            ))
        );
    }
}
