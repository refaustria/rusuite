//! Named styles and document defaults.

use core_model::units::Twips;
use core_model::{Color, FontFace, FontSize, RunProperties, ThemeColorSlot, ThemeFontSlot};
use serde::{Deserialize, Serialize};

use crate::props::{
    BorderSide, BorderStyle, CellMargins, CellProperties, Indent, LineSpacing, ParagraphProperties,
    Spacing, TableBorders, TableProperties,
};

/// Kind of a style.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum StyleKind {
    /// Paragraph style (may also carry run formatting).
    Paragraph,
    /// Character style.
    Character,
    /// Table style.
    Table,
}

/// A named style (docx `w:style`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Style {
    /// Style id, referenced by [`ParagraphProperties::style`] (e.g. `"Heading1"`).
    pub id: String,
    /// Display name (e.g. `"heading 1"`, as Word stores it).
    pub name: String,
    /// Kind.
    pub kind: StyleKind,
    /// Parent style id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub based_on: Option<String>,
    /// Style of the paragraph created after this one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next: Option<String>,
    /// Paragraph formatting of the style.
    #[serde(default, skip_serializing_if = "ParagraphProperties::is_empty")]
    pub paragraph: ParagraphProperties,
    /// Run formatting of the style.
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::RunProperties"))]
    pub run: RunProperties,
    /// Whether this is the default style of its kind.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_default: bool,
    /// Table formatting of a table style.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub table: Option<TableStyle>,
}

/// The part of a table to which a [`ConditionalFormat`] applies (docx
/// `w:tblStylePr/@w:type`), in increasing priority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub enum ConditionalKind {
    /// The whole table.
    WholeTable,
    /// Odd column bands.
    Band1Vert,
    /// Even column bands.
    Band2Vert,
    /// Odd row bands.
    Band1Horz,
    /// Even row bands.
    Band2Horz,
    /// The header row.
    FirstRow,
    /// The total row.
    LastRow,
    /// The first column.
    FirstCol,
    /// The last column.
    LastCol,
    /// Top right cell.
    NeCell,
    /// Top left cell.
    NwCell,
    /// Bottom right cell.
    SeCell,
    /// Bottom left cell.
    SwCell,
}

impl ConditionalKind {
    /// The docx name (`firstRow`, `band1Horz`, …).
    pub fn docx_name(self) -> &'static str {
        use ConditionalKind::*;
        match self {
            WholeTable => "wholeTable",
            Band1Vert => "band1Vert",
            Band2Vert => "band2Vert",
            Band1Horz => "band1Horz",
            Band2Horz => "band2Horz",
            FirstCol => "firstCol",
            LastCol => "lastCol",
            FirstRow => "firstRow",
            LastRow => "lastRow",
            NeCell => "neCell",
            NwCell => "nwCell",
            SeCell => "seCell",
            SwCell => "swCell",
        }
    }

    /// Parses a docx name.
    pub fn from_docx(name: &str) -> Option<Self> {
        use ConditionalKind::*;
        [
            WholeTable, Band1Vert, Band2Vert, Band1Horz, Band2Horz, FirstRow, LastRow, FirstCol,
            LastCol, NeCell, NwCell, SeCell, SwCell,
        ]
        .into_iter()
        .find(|k| k.docx_name() == name)
    }
}

/// Formatting a table style applies to one part of the table (docx
/// `w:tblStylePr`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct ConditionalFormat {
    /// The part of the table.
    pub kind: ConditionalKind,
    /// Paragraph formatting of the text in that part.
    #[serde(default, skip_serializing_if = "ParagraphProperties::is_empty")]
    pub paragraph: ParagraphProperties,
    /// Character formatting of the text in that part.
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(
        feature = "ts",
        ts(as = "Option<app_common::wire::RunProperties>", optional)
    )]
    pub run: RunProperties,
    /// Cell formatting of that part. Its borders describe the part as a
    /// whole: `top`/`bottom`/`left`/`right` on the part's outer edges,
    /// `insideH`/`insideV` between its cells.
    #[serde(default, skip_serializing_if = "CellProperties::is_empty")]
    pub cell: CellProperties,
}

/// Table formatting of a table style (docx `w:tblPr`, `w:tcPr` and
/// `w:tblStylePr` of a `w:style w:type="table"`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct TableStyle {
    /// Table properties (borders, cell margins, alignment, indent; the
    /// `style`, `look`, widths and grid are not used).
    #[serde(default, skip_serializing_if = "TableProperties::is_empty")]
    pub table: TableProperties,
    /// Cell properties of every cell.
    #[serde(default, skip_serializing_if = "CellProperties::is_empty")]
    pub cell: CellProperties,
    /// Rows per band (docx `w:tblStyleRowBandSize`, `None` = 1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub row_band_size: Option<u8>,
    /// Columns per band (docx `w:tblStyleColBandSize`, `None` = 1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub col_band_size: Option<u8>,
    /// Conditional formats, in file order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conditional: Vec<ConditionalFormat>,
}

impl TableStyle {
    /// Returns `true` if nothing is set.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// The conditional format of `kind`.
    pub fn conditional(&self, kind: ConditionalKind) -> Option<&ConditionalFormat> {
        self.conditional.iter().find(|c| c.kind == kind)
    }
}

impl Style {
    /// A paragraph style based on `Normal` with `next = Normal`.
    fn paragraph(id: &str, name: &str) -> Self {
        Self {
            id: id.to_owned(),
            name: name.to_owned(),
            kind: StyleKind::Paragraph,
            based_on: Some("Normal".to_owned()),
            next: Some("Normal".to_owned()),
            paragraph: ParagraphProperties::default(),
            run: RunProperties::default(),
            is_default: false,
            table: None,
        }
    }

    /// A table style based on `TableNormal`.
    fn table(id: &str, name: &str) -> Self {
        Self {
            id: id.to_owned(),
            name: name.to_owned(),
            kind: StyleKind::Table,
            based_on: Some("TableNormal".to_owned()),
            next: None,
            paragraph: ParagraphProperties::default(),
            run: RunProperties::default(),
            is_default: false,
            table: Some(TableStyle::default()),
        }
    }
}

/// Document-wide default formatting (docx `w:docDefaults`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct Defaults {
    /// Default run formatting.
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    #[cfg_attr(feature = "ts", ts(as = "app_common::wire::RunProperties"))]
    pub run: RunProperties,
    /// Default paragraph formatting.
    #[serde(default, skip_serializing_if = "ParagraphProperties::is_empty")]
    pub paragraph: ParagraphProperties,
}

/// The document's styles (docx `styles.xml`).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/write/src/generated/")
)]
pub struct StyleSheet {
    /// Document defaults, applied below every style.
    #[serde(default)]
    pub defaults: Defaults,
    /// Styles in document order; ids are unique.
    #[serde(default)]
    pub styles: Vec<Style>,
}

impl StyleSheet {
    /// The style with id `id`.
    pub fn get(&self, id: &str) -> Option<&Style> {
        self.styles.iter().find(|s| s.id == id)
    }

    /// Mutable access to the style with id `id`.
    pub fn get_mut(&mut self, id: &str) -> Option<&mut Style> {
        self.styles.iter_mut().find(|s| s.id == id)
    }

    /// Inserts `style`, replacing (in place) a style with the same id.
    /// Returns the replaced style.
    pub fn insert(&mut self, style: Style) -> Option<Style> {
        match self.get_mut(&style.id) {
            Some(slot) => Some(std::mem::replace(slot, style)),
            None => {
                self.styles.push(style);
                None
            }
        }
    }

    /// The default style of `kind` (the first with `is_default`).
    pub fn default_style(&self, kind: StyleKind) -> Option<&Style> {
        self.styles.iter().find(|s| s.kind == kind && s.is_default)
    }

    /// The `based_on` chain of `style_id`, root first, ending with the
    /// style itself. Stops at missing parents and at cycles.
    fn chain(&self, style_id: &str) -> Vec<&Style> {
        let mut chain: Vec<&Style> = Vec::new();
        let mut next = self.get(style_id);
        while let Some(style) = next {
            if chain.iter().any(|s| s.id == style.id) {
                break;
            }
            chain.push(style);
            next = style.based_on.as_deref().and_then(|id| self.get(id));
        }
        chain.reverse();
        chain
    }

    /// Effective paragraph formatting of a style: document defaults overlaid
    /// with every style of the `based_on` chain, root first. An unknown id
    /// yields the defaults. Cycles in `based_on` are cut. The result's
    /// `style` field is `style_id` if the style exists.
    pub fn resolve_paragraph(&self, style_id: &str) -> ParagraphProperties {
        let mut out = self.defaults.paragraph.clone();
        let chain = self.chain(style_id);
        for style in &chain {
            out.apply(&style.paragraph);
        }
        out.style = (!chain.is_empty()).then(|| style_id.to_owned());
        out.strip_cleared_tabs();
        out
    }

    /// Effective run formatting of a style: document defaults overlaid with
    /// the run formatting of every style of the `based_on` chain.
    pub fn resolve_run(&self, style_id: &str) -> RunProperties {
        let mut out = self.defaults.run.clone();
        for style in self.chain(style_id) {
            out.apply(&style.run);
        }
        out
    }

    /// Word 2016+ default styles: Normal, Title, Heading 1–6 and
    /// List Paragraph, with Word's document defaults (Calibri 11 pt,
    /// 8 pt after, 1.08 line spacing).
    pub fn office_defaults() -> Self {
        let major = Some(FontFace::Theme(ThemeFontSlot::MajorLatin));
        // themeShade BF / 7F on accent1 = tint -0.25 / -0.5 (2F5496 / 1F3763).
        let accent1_dark = Some(Color::Theme {
            slot: ThemeColorSlot::Accent1,
            tint: -0.25,
        });
        let accent1_darker = Some(Color::Theme {
            slot: ThemeColorSlot::Accent1,
            tint: -0.5,
        });
        let heading = |level: u8, before: i32, size: Option<f64>, color: Option<Color>| {
            let mut s = Style::paragraph(&format!("Heading{level}"), &format!("heading {level}"));
            s.paragraph = ParagraphProperties {
                spacing: Some(Spacing {
                    before: Some(Twips(before)),
                    after: Some(Twips(0)),
                    line: None,
                }),
                keep_next: Some(true),
                ..Default::default()
            };
            s.run = RunProperties {
                font: major.clone(),
                size: size.map(FontSize::from_pt),
                color,
                ..Default::default()
            };
            s
        };

        let normal = Style {
            id: "Normal".to_owned(),
            name: "Normal".to_owned(),
            kind: StyleKind::Paragraph,
            based_on: None,
            next: None,
            paragraph: ParagraphProperties::default(),
            run: RunProperties::default(),
            is_default: true,
            table: None,
        };
        let mut title = Style::paragraph("Title", "Title");
        title.paragraph.spacing = Some(Spacing {
            before: None,
            after: Some(Twips(0)),
            line: Some(LineSpacing::Multiple(1.0)),
        });
        title.run = RunProperties {
            font: major.clone(),
            size: Some(FontSize::from_pt(28.0)),
            ..Default::default()
        };
        let mut h4 = heading(4, 40, None, accent1_dark);
        h4.run.italic = Some(true);
        let mut list = Style::paragraph("ListParagraph", "List Paragraph");
        list.next = None;
        list.paragraph.indent = Some(Indent {
            left: Some(Twips(720)),
            ..Default::default()
        });

        Self {
            defaults: Defaults {
                run: RunProperties {
                    font: Some(FontFace::Theme(ThemeFontSlot::MinorLatin)),
                    size: Some(FontSize::from_pt(11.0)),
                    ..Default::default()
                },
                paragraph: ParagraphProperties {
                    spacing: Some(Spacing {
                        before: None,
                        after: Some(Twips(160)),
                        line: Some(LineSpacing::from_240ths(259)),
                    }),
                    ..Default::default()
                },
            },
            styles: vec![
                normal,
                title,
                heading(1, 240, Some(16.0), accent1_dark),
                heading(2, 40, Some(13.0), accent1_dark),
                heading(3, 40, Some(12.0), accent1_darker),
                h4,
                heading(5, 40, None, accent1_dark),
                heading(6, 40, None, accent1_darker),
                list,
            ]
            .into_iter()
            .chain(table_styles())
            .collect(),
        }
    }

    /// The effective table formatting of table style `style_id`: the
    /// [`TableStyle`]s of its `based_on` chain overlaid root first
    /// (properties merge field by field, conditional formats of the same
    /// kind merge too). `None` if the style does not exist.
    pub fn resolve_table_style(&self, style_id: &str) -> Option<TableStyle> {
        let chain = self.chain(style_id);
        if chain.is_empty() {
            return None;
        }
        let mut out = TableStyle::default();
        for s in chain {
            let Some(t) = &s.table else { continue };
            out.table = merge_table_props(&out.table, &t.table);
            out.cell = merge_cell_props(&out.cell, &t.cell);
            out.row_band_size = t.row_band_size.or(out.row_band_size);
            out.col_band_size = t.col_band_size.or(out.col_band_size);
            for c in &t.conditional {
                match out.conditional.iter_mut().find(|o| o.kind == c.kind) {
                    Some(o) => {
                        o.paragraph.apply(&c.paragraph);
                        o.run.apply(&c.run);
                        o.cell = merge_cell_props(&o.cell, &c.cell);
                    }
                    None => out.conditional.push(c.clone()),
                }
            }
        }
        Some(out)
    }
}

/// `base` overlaid with `over` (the table-style relevant fields).
pub(crate) fn merge_table_props(base: &TableProperties, over: &TableProperties) -> TableProperties {
    TableProperties {
        width: over.width.or(base.width),
        col_widths: if over.col_widths.is_empty() {
            base.col_widths.clone()
        } else {
            over.col_widths.clone()
        },
        borders: merge_with(base.borders, over.borders, TableBorders::merged_with),
        cell_margins: merge_with(
            base.cell_margins,
            over.cell_margins,
            CellMargins::merged_with,
        ),
        style: over.style.clone().or_else(|| base.style.clone()),
        look: over.look.or(base.look),
        alignment: over.alignment.or(base.alignment),
        indent: over.indent.or(base.indent),
        layout: over.layout.or(base.layout),
    }
}

/// `base` overlaid with `over`, field by field (borders and margins side
/// by side).
pub(crate) fn merge_cell_props(base: &CellProperties, over: &CellProperties) -> CellProperties {
    CellProperties {
        width: over.width.or(base.width),
        shading: over.shading.or(base.shading),
        borders: merge_with(base.borders, over.borders, TableBorders::merged_with),
        vertical_align: over.vertical_align.or(base.vertical_align),
        margins: merge_with(base.margins, over.margins, CellMargins::merged_with),
    }
}

fn merge_with<T: Copy>(a: Option<T>, b: Option<T>, f: impl Fn(&T, &T) -> T) -> Option<T> {
    match (a, b) {
        (Some(a), Some(b)) => Some(f(&a, &b)),
        (a, b) => b.or(a),
    }
}

/// A theme border of Word's built-in table styles (`sz="4"`, ½ pt).
fn thin(color: Color) -> BorderSide {
    BorderSide::new(
        BorderStyle::Single,
        BorderSide::width_from_eighths(4),
        color,
    )
}

fn theme(slot: ThemeColorSlot, tint: f64) -> Color {
    Color::Theme { slot, tint }
}

/// Word 2016+'s "Normal Table" and the built-in table styles Rusuite
/// offers: Table Grid, Plain Table 1, List Table 3, Grid Table 4 Accent
/// 1–3 (definitions as Word writes them into `styles.xml`).
fn table_styles() -> Vec<Style> {
    use ConditionalKind::*;
    let cond = |kind: ConditionalKind| ConditionalFormat {
        kind,
        paragraph: ParagraphProperties::default(),
        run: RunProperties::default(),
        cell: CellProperties::default(),
    };
    let bold = RunProperties {
        bold: Some(true),
        ..Default::default()
    };
    let bold_cond = |kind| ConditionalFormat {
        run: bold.clone(),
        ..cond(kind)
    };
    let shade = |kind, color: Color| ConditionalFormat {
        cell: CellProperties {
            shading: Some(color),
            ..Default::default()
        },
        ..cond(kind)
    };
    let edges = |top: Option<BorderSide>, left, bottom, right| TableBorders {
        top,
        left,
        bottom,
        right,
        inside_h: None,
        inside_v: None,
    };
    let compact = ParagraphProperties {
        spacing: Some(Spacing {
            before: None,
            after: Some(Twips(0)),
            line: Some(LineSpacing::Multiple(1.0)),
        }),
        ..Default::default()
    };
    let with_borders = |kind, b: TableBorders| ConditionalFormat {
        cell: CellProperties {
            borders: Some(b),
            ..Default::default()
        },
        ..cond(kind)
    };
    let nil = Some(BorderSide::new(BorderStyle::None, Twips(0), Color::Auto));

    let normal = Style {
        id: "TableNormal".to_owned(),
        name: "Normal Table".to_owned(),
        kind: StyleKind::Table,
        based_on: None,
        next: None,
        paragraph: ParagraphProperties::default(),
        run: RunProperties::default(),
        is_default: true,
        table: Some(TableStyle {
            table: TableProperties {
                indent: Some(Twips(0)),
                cell_margins: Some(CellMargins {
                    top: Some(Twips(0)),
                    left: Some(Twips(108)),
                    bottom: Some(Twips(0)),
                    right: Some(Twips(108)),
                }),
                ..Default::default()
            },
            ..Default::default()
        }),
    };

    let mut grid = Style::table("TableGrid", "Table Grid");
    grid.paragraph = compact.clone();
    grid.table = Some(TableStyle {
        table: TableProperties {
            borders: Some(TableBorders::all(thin(Color::Auto))),
            ..Default::default()
        },
        ..Default::default()
    });

    // background1 shade BF / F2
    let grey_line = theme(ThemeColorSlot::Light1, -0.25);
    let grey_fill = theme(ThemeColorSlot::Light1, -0.05);
    let mut plain1 = Style::table("PlainTable1", "Plain Table 1");
    plain1.paragraph = compact.clone();
    plain1.table = Some(TableStyle {
        table: TableProperties {
            borders: Some(TableBorders::all(thin(grey_line))),
            ..Default::default()
        },
        row_band_size: Some(1),
        col_band_size: Some(1),
        conditional: vec![
            bold_cond(FirstRow),
            ConditionalFormat {
                paragraph: ParagraphProperties {
                    spacing: Some(Spacing {
                        before: Some(Twips(0)),
                        after: Some(Twips(0)),
                        line: Some(LineSpacing::Multiple(1.0)),
                    }),
                    ..Default::default()
                },
                run: bold.clone(),
                cell: CellProperties {
                    borders: Some(edges(
                        Some(BorderSide::new(
                            BorderStyle::Double,
                            BorderSide::width_from_eighths(4),
                            grey_line,
                        )),
                        None,
                        None,
                        None,
                    )),
                    ..Default::default()
                },
                kind: LastRow,
            },
            bold_cond(FirstCol),
            bold_cond(LastCol),
            shade(Band1Vert, grey_fill),
            shade(Band1Horz, grey_fill),
        ],
        ..Default::default()
    });

    let text1 = theme(ThemeColorSlot::Dark1, 0.0);
    let white = theme(ThemeColorSlot::Light1, 0.0);
    let mut list3 = Style::table("ListTable3", "List Table 3");
    list3.paragraph = compact.clone();
    let t1 = Some(thin(text1));
    list3.table = Some(TableStyle {
        table: TableProperties {
            borders: Some(edges(t1, t1, t1, t1)),
            ..Default::default()
        },
        row_band_size: Some(1),
        col_band_size: Some(1),
        conditional: vec![
            ConditionalFormat {
                run: RunProperties {
                    bold: Some(true),
                    color: Some(white),
                    ..Default::default()
                },
                cell: CellProperties {
                    shading: Some(text1),
                    ..Default::default()
                },
                ..cond(FirstRow)
            },
            ConditionalFormat {
                run: bold.clone(),
                ..with_borders(
                    LastRow,
                    edges(
                        Some(BorderSide::new(
                            BorderStyle::Double,
                            BorderSide::width_from_eighths(4),
                            text1,
                        )),
                        None,
                        None,
                        None,
                    ),
                )
            },
            bold_cond(FirstCol),
            ConditionalFormat {
                run: bold.clone(),
                ..with_borders(LastCol, edges(None, nil, None, None))
            },
            with_borders(Band1Vert, edges(None, t1, None, t1)),
            with_borders(Band1Horz, edges(t1, None, t1, None)),
            with_borders(NeCell, edges(None, nil, None, None)),
            with_borders(NwCell, edges(None, None, None, nil)),
        ],
        ..Default::default()
    });

    let grid4 = |n: u8, slot: ThemeColorSlot| {
        let mut s = Style::table(
            &format!("GridTable4-Accent{n}"),
            &format!("Grid Table 4 Accent {n}"),
        );
        s.paragraph = compact.clone();
        let accent = theme(slot, 0.0);
        let a = Some(thin(accent));
        s.table = Some(TableStyle {
            table: TableProperties {
                borders: Some(TableBorders::all(thin(theme(slot, 0.4)))),
                ..Default::default()
            },
            row_band_size: Some(1),
            col_band_size: Some(1),
            conditional: vec![
                ConditionalFormat {
                    run: RunProperties {
                        bold: Some(true),
                        color: Some(white),
                        ..Default::default()
                    },
                    cell: CellProperties {
                        borders: Some(TableBorders {
                            top: a,
                            left: a,
                            bottom: a,
                            right: a,
                            inside_h: nil,
                            inside_v: nil,
                        }),
                        shading: Some(accent),
                        ..Default::default()
                    },
                    ..cond(FirstRow)
                },
                ConditionalFormat {
                    run: bold.clone(),
                    ..with_borders(
                        LastRow,
                        edges(
                            Some(BorderSide::new(
                                BorderStyle::Double,
                                BorderSide::width_from_eighths(4),
                                accent,
                            )),
                            None,
                            None,
                            None,
                        ),
                    )
                },
                bold_cond(FirstCol),
                bold_cond(LastCol),
                shade(Band1Vert, theme(slot, 0.8)),
                shade(Band1Horz, theme(slot, 0.8)),
            ],
            ..Default::default()
        });
        s
    };
    vec![
        normal,
        grid,
        plain1,
        list3,
        grid4(1, ThemeColorSlot::Accent1),
        grid4(2, ThemeColorSlot::Accent2),
        grid4(3, ThemeColorSlot::Accent3),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::{ColorScheme, Rgb};

    #[test]
    fn based_on_chain() {
        let sheet = StyleSheet::office_defaults();
        let h1 = sheet.resolve_paragraph("Heading1");
        assert_eq!(h1.style.as_deref(), Some("Heading1"));
        let sp = h1.spacing.unwrap();
        assert_eq!(sp.before, Some(Twips(240)));
        assert_eq!(sp.after, Some(Twips(0)));
        // inherited from the defaults via Normal
        assert_eq!(sp.line, Some(LineSpacing::from_240ths(259)));
        assert_eq!(h1.keep_next, Some(true));

        let run = sheet.resolve_run("Heading1");
        assert_eq!(run.size, Some(FontSize::from_pt(16.0)));
        assert_eq!(run.font, Some(FontFace::Theme(ThemeFontSlot::MajorLatin)));
        let normal = sheet.resolve_run("Normal");
        assert_eq!(normal.size, Some(FontSize::from_pt(11.0)));
        assert_eq!(
            normal.font,
            Some(FontFace::Theme(ThemeFontSlot::MinorLatin))
        );

        // unknown style: defaults only
        let unknown = sheet.resolve_paragraph("Nope");
        assert_eq!(unknown.style, None);
        assert_eq!(unknown.spacing.unwrap().after, Some(Twips(160)));
    }

    #[test]
    fn heading_colors_match_word() {
        let scheme = ColorScheme::default();
        let sheet = StyleSheet::office_defaults();
        let close = |c: Rgb, hex: &str| {
            let e = Rgb::from_hex(hex).unwrap();
            [(c.r, e.r), (c.g, e.g), (c.b, e.b)]
                .iter()
                .all(|&(a, b)| a.abs_diff(b) <= 2)
        };
        let h1 = sheet.resolve_run("Heading1").color.unwrap();
        assert!(close(h1.resolve(&scheme, Rgb::BLACK), "2F5496"));
        let h3 = sheet.resolve_run("Heading3").color.unwrap();
        assert!(close(h3.resolve(&scheme, Rgb::BLACK), "1F3763"));
    }

    #[test]
    fn based_on_cycle_terminates() {
        let mut sheet = StyleSheet::default();
        for (id, parent, size) in [("A", "B", 10.0), ("B", "C", 12.0), ("C", "A", 14.0)] {
            sheet.insert(Style {
                id: id.into(),
                name: id.into(),
                kind: StyleKind::Paragraph,
                based_on: Some(parent.into()),
                next: None,
                paragraph: ParagraphProperties::default(),
                run: RunProperties {
                    size: Some(FontSize::from_pt(size)),
                    ..Default::default()
                },
                is_default: false,
                table: None,
            });
        }
        // A's own value wins over its (cyclic) ancestors.
        assert_eq!(sheet.resolve_run("A").size, Some(FontSize::from_pt(10.0)));
        assert_eq!(sheet.resolve_run("C").size, Some(FontSize::from_pt(14.0)));
        assert_eq!(sheet.resolve_paragraph("B").style.as_deref(), Some("B"));

        // self-reference
        sheet.get_mut("A").unwrap().based_on = Some("A".into());
        assert_eq!(sheet.resolve_run("A").size, Some(FontSize::from_pt(10.0)));
    }

    #[test]
    fn insert_replaces_and_get() {
        let mut sheet = StyleSheet::office_defaults();
        let n = sheet.styles.len();
        assert_eq!(
            sheet
                .default_style(StyleKind::Paragraph)
                .map(|s| s.id.as_str()),
            Some("Normal")
        );
        let mut title = sheet.get("Title").unwrap().clone();
        title.run.bold = Some(true);
        let old = sheet.insert(title).unwrap();
        assert_eq!(old.run.bold, None);
        assert_eq!(sheet.styles.len(), n);
        assert_eq!(sheet.get("Title").unwrap().run.bold, Some(true));
        assert!(sheet.insert(Style::paragraph("Quote", "Quote")).is_none());
        assert_eq!(sheet.styles.len(), n + 1);
        assert!(sheet.get("Heading7").is_none());
    }
}
