//! Notes, threaded comments and hyperlinks (P8-26): the annotation
//! commands, the `cellAnnotations` / `allComments` requests, and how
//! every command reports and undoes annotation changes.
//!
//! Undo works by state: [`CalcDocument::mark_annotations`] compares the
//! annotations (and the person list) before and after any command and
//! appends a `RestoreAnnotations` / `RestorePersons` of the old state to
//! the inverse. The annotation commands themselves therefore only change
//! the model; structural edits, sorting, paste and sheet deletion get
//! exact undo of the notes they moved or dropped for free.

use std::collections::{BTreeMap, BTreeSet};

use app_common::{Applied, Patch};
use core_model::{Color, RunProperties, ThemeColorSlot, Underline};
use engine_formula::ast::{MAX_COL, MAX_ROW};
use model_sheet::{
    CellCoord, CellRange, CellStyle, Hyperlink, LinkTarget, Note, Person, Reply, SheetId, Thread,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::CalcCommand;
use crate::doc::{CalcApplied, CalcDocument, Result};
use crate::patch::{CalcPatch, CommentState};

/// The annotations of one sheet: notes, threads, hyperlinks.
type SheetState = (Vec<Note>, Vec<Thread>, Vec<Hyperlink>);

/// The annotations of every sheet that has any, plus the person list.
pub(crate) struct AnnotationsState {
    sheets: BTreeMap<u32, SheetState>,
    persons: Vec<Person>,
}

/// The complete annotations of `sheet` (in a patch: of a sheet whose
/// annotations changed).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetAnnotations {
    pub sheet: u32,
    #[ts(as = "Vec<crate::wire_annot::Note>")]
    pub notes: Vec<Note>,
    #[ts(as = "Vec<crate::wire_annot::Thread>")]
    pub threads: Vec<Thread>,
    #[ts(as = "Vec<crate::wire_annot::Hyperlink>")]
    pub hyperlinks: Vec<Hyperlink>,
}

/// A cell whose `HYPERLINK()` formula makes it a link.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct FormulaLink {
    pub row: u32,
    pub col: u32,
    #[ts(as = "crate::wire_annot::LinkTarget")]
    pub target: LinkTarget,
}

/// The reply to `cellAnnotations`: what intersects the rectangle.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct CellAnnotations {
    pub sheet: u32,
    #[ts(as = "Vec<crate::wire_annot::Note>")]
    pub notes: Vec<Note>,
    #[ts(as = "Vec<crate::wire_annot::Thread>")]
    pub threads: Vec<Thread>,
    #[ts(as = "Vec<crate::wire_annot::Hyperlink>")]
    pub hyperlinks: Vec<Hyperlink>,
    /// `HYPERLINK()` formula cells of the rectangle (within the used
    /// range) with their evaluated targets.
    pub formula_links: Vec<FormulaLink>,
}

/// The threads of one sheet (`allComments`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "apps/calc/src/generated/")]
pub struct SheetThreads {
    pub sheet: u32,
    #[ts(as = "Vec<crate::wire_annot::Thread>")]
    pub threads: Vec<Thread>,
}

fn no_op() -> Option<CalcCommand> {
    Some(CalcCommand::Compound {
        commands: Vec::new(),
    })
}

fn bad(reason: &str) -> crate::doc::CalcError {
    model_sheet::Error::InvalidAnnotation(reason.into()).into()
}

/// The note text without Excel's leading `Author:` line.
fn note_body(n: &Note) -> String {
    let text = n.plain_text();
    let prefix = format!("{}:", n.author);
    match text.strip_prefix(&prefix) {
        Some(rest) if !n.author.is_empty() => rest.trim_start_matches(['\n', '\r']).to_owned(),
        _ => text,
    }
}

/// `style` without the Hyperlink style's font parts (the theme hyperlink /
/// followed-hyperlink colour, a single underline); `None` when it has none.
pub(crate) fn without_link_format(style: &CellStyle) -> Option<CellStyle> {
    let link_color = matches!(
        style.font.color,
        Some(Color::Theme {
            slot: ThemeColorSlot::Hyperlink | ThemeColorSlot::FollowedHyperlink,
            ..
        })
    );
    let underline = style.font.underline == Some(Underline::Single);
    if !link_color && !underline {
        return None;
    }
    let mut out = style.clone();
    if link_color {
        out.font.color = None;
    }
    if underline {
        out.font.underline = None;
    }
    Some(out)
}

/// The Hyperlink cell style's font: theme hyperlink colour, underlined.
fn hyperlink_style() -> CellStyle {
    CellStyle {
        font: RunProperties {
            color: Some(Color::theme(ThemeColorSlot::Hyperlink)),
            underline: Some(Underline::Single),
            ..Default::default()
        },
        ..Default::default()
    }
}

impl CalcDocument {
    /// The @mentions of a comment text: the document's persons (and every
    /// comment author) by `@Name` (see [`model_sheet::find_mentions`]).
    fn mentions_in(
        &self,
        text: &str,
        previous: &[model_sheet::Mention],
    ) -> Vec<model_sheet::Mention> {
        if !text.contains('@') {
            return Vec::new();
        }
        let wb = self.workbook();
        let mut people: Vec<Person> = wb.persons().to_vec();
        for (s, _) in wb.sheets() {
            for t in wb.threads(s) {
                for p in std::iter::once(&t.author).chain(t.replies.iter().map(|r| &r.author)) {
                    if !people.iter().any(|q| q.name == p.name) {
                        people.push(p.clone());
                    }
                }
            }
        }
        model_sheet::find_mentions(text, &people, previous)
    }

    fn sheet_state(&self, s: SheetId) -> SheetState {
        let wb = self.workbook();
        (
            wb.notes(s).to_vec(),
            wb.threads(s).to_vec(),
            wb.hyperlinks(s).to_vec(),
        )
    }

    /// The annotations of every sheet that has any.
    pub(crate) fn annotations_state(&self) -> AnnotationsState {
        let wb = self.workbook();
        AnnotationsState {
            sheets: wb
                .sheets()
                .into_iter()
                .map(|(s, _)| (s.0, self.sheet_state(s)))
                .filter(|(_, (n, t, h))| !(n.is_empty() && t.is_empty() && h.is_empty()))
                .collect(),
            persons: wb.persons().to_vec(),
        }
    }

    /// After any command: reports changed annotations (the sheets'
    /// complete lists in `annotations`, the cells whose indicator flags
    /// changed in `cells`, `persons`) and appends the restore of the old
    /// state to the inverse.
    pub(crate) fn mark_annotations(&self, before: AnnotationsState, applied: &mut CalcApplied) {
        let after = self.annotations_state();
        let mut restore = Vec::new();
        let ids: BTreeSet<u32> = before
            .sheets
            .keys()
            .chain(after.sheets.keys())
            .copied()
            .collect();
        let empty: SheetState = (Vec::new(), Vec::new(), Vec::new());
        let mut flagged: Vec<CellCoord> = Vec::new();
        for id in ids {
            let old = before.sheets.get(&id).unwrap_or(&empty);
            let new = after.sheets.get(&id).unwrap_or(&empty);
            if old == new {
                continue;
            }
            restore.push(CalcCommand::RestoreAnnotations {
                sheet: id,
                notes: old.0.clone(),
                threads: old.1.clone(),
                hyperlinks: old.2.clone(),
            });
            if self.sheet(id).is_err() {
                continue; // deleted: the sheet list says so
            }
            applied.patch.annotations.push(SheetAnnotations {
                sheet: id,
                notes: new.0.clone(),
                threads: new.1.clone(),
                hyperlinks: new.2.clone(),
            });
            if applied.patch.structural.iter().any(|s| s.sheet == id) {
                continue; // the UI refetches the sheet
            }
            let s = SheetId(id);
            let cells = |st: &SheetState| -> BTreeSet<(u32, u32, u8)> {
                let notes = st.0.iter().map(|n| (n.row, n.col, 0));
                let threads =
                    st.1.iter()
                        .map(|t| (t.row, t.col, 1 + u8::from(t.resolved)));
                let links = st.2.iter().flat_map(|h| {
                    // Hyperlink flags of huge ranges are not listed cell by cell.
                    let small = u64::from(h.r1 - h.r0 + 1) * u64::from(h.c1 - h.c0 + 1) <= 4096;
                    small
                        .then(|| {
                            (h.r0..=h.r1).flat_map(move |r| (h.c0..=h.c1).map(move |c| (r, c, 3)))
                        })
                        .into_iter()
                        .flatten()
                });
                notes.chain(threads).chain(links).collect()
            };
            let (a, b) = (cells(old), cells(new));
            flagged.extend(
                a.symmetric_difference(&b)
                    .map(|&(r, c, _)| CellCoord::new(s, r, c)),
            );
        }
        if before.persons != after.persons {
            restore.push(CalcCommand::RestorePersons {
                persons: before.persons,
            });
            applied.patch.persons = Some(after.persons);
        }
        if restore.is_empty() {
            return;
        }
        if !flagged.is_empty() {
            let cells = self.cells_view_patch(flagged);
            applied.patch.merge(CalcPatch {
                cells,
                ..Default::default()
            });
        }
        let mut commands = match applied.inverse.take() {
            Some(CalcCommand::Compound { commands }) if commands.is_empty() => Vec::new(),
            Some(inv) => vec![inv],
            None => Vec::new(),
        };
        commands.extend(restore);
        applied.inverse = Some(if commands.len() == 1 {
            commands.pop().expect("one")
        } else {
            CalcCommand::Compound { commands }
        });
    }

    /// The indicator state of a cell's thread.
    pub(crate) fn comment_state(&self, c: CellCoord) -> Option<CommentState> {
        self.workbook().thread_at(c).map(|t| {
            if t.resolved {
                CommentState::Resolved
            } else {
                CommentState::Open
            }
        })
    }

    /// The cells of `range` with a note or a thread (snapshots list them
    /// even when empty, for the indicators).
    pub(crate) fn annotated_cells(&self, range: CellRange) -> BTreeSet<(u32, u32)> {
        let wb = self.workbook();
        let inside = |r: u32, c: u32| range.contains(CellCoord::new(range.sheet, r, c));
        wb.notes(range.sheet)
            .iter()
            .map(|n| (n.row, n.col))
            .chain(wb.threads(range.sheet).iter().map(|t| (t.row, t.col)))
            .filter(|&(r, c)| inside(r, c))
            .collect()
    }

    /// Applies one of the annotation commands.
    pub(crate) fn annotations_cmd(&mut self, cmd: &CalcCommand) -> Result<CalcApplied> {
        use CalcCommand as C;
        let done = |patch: CalcPatch| {
            Ok(Applied {
                patch,
                inverse: no_op(),
            })
        };
        match cmd {
            C::SetNote {
                sheet,
                row,
                col,
                text,
                author,
                visible,
                bounds,
            } => {
                let s = self.sheet(*sheet)?;
                let at = CellCoord::new(s, *row, *col);
                let old = self.workbook().note_at(at).cloned();
                let note = Note {
                    row: *row,
                    col: *col,
                    author: author
                        .clone()
                        .or_else(|| old.as_ref().map(|n| n.author.clone()))
                        .unwrap_or_default(),
                    text: text.clone(),
                    visible: visible.or(old.as_ref().map(|n| n.visible)).unwrap_or(false),
                    bounds: bounds.or(old.and_then(|n| n.bounds)),
                };
                self.workbook_mut().set_note(s, note)?;
                done(CalcPatch::default())
            }
            &C::DeleteNote {
                sheet,
                r0,
                c0,
                r1,
                c1,
            } => {
                let range = self.range(sheet, r0, c0, r1, c1)?;
                let notes: Vec<Note> = self
                    .workbook()
                    .notes(range.sheet)
                    .iter()
                    .filter(|n| !range.contains(CellCoord::new(range.sheet, n.row, n.col)))
                    .cloned()
                    .collect();
                self.workbook_mut().set_notes(range.sheet, notes)?;
                done(CalcPatch::default())
            }
            &C::ShowHideNote {
                sheet,
                row,
                col,
                visible,
            } => {
                let s = self.sheet(sheet)?;
                let mut note = self
                    .workbook()
                    .note_at(CellCoord::new(s, row, col))
                    .cloned()
                    .ok_or_else(|| bad("the cell has no note"))?;
                note.visible = visible.unwrap_or(!note.visible);
                self.workbook_mut().set_note(s, note)?;
                done(CalcPatch::default())
            }
            C::ConvertNotesToComments {
                sheet,
                author,
                date,
            } => {
                let s = self.sheet(*sheet)?;
                let notes = self.workbook().notes(s).to_vec();
                let mut kept = Vec::new();
                for n in notes {
                    let at = CellCoord::new(s, n.row, n.col);
                    if self.workbook().thread_at(at).is_some() {
                        kept.push(n);
                        continue;
                    }
                    let who = if n.author.is_empty() {
                        author.clone()
                    } else {
                        Person::new(&n.author, "")
                    };
                    let id = self
                        .workbook()
                        .fresh_comment_id(&format!("{sheet}:{}:{}:{date}", n.row, n.col));
                    let thread = Thread {
                        id,
                        row: n.row,
                        col: n.col,
                        author: who,
                        date: date.clone(),
                        text: note_body(&n),
                        resolved: false,
                        replies: Vec::new(),
                        mentions: Vec::new(),
                    };
                    self.workbook_mut().set_thread(s, thread)?;
                }
                self.workbook_mut().set_notes(s, kept)?;
                done(CalcPatch::default())
            }
            C::AddComment {
                sheet,
                row,
                col,
                text,
                author,
                date,
            } => {
                let s = self.sheet(*sheet)?;
                let at = CellCoord::new(s, *row, *col);
                if *row > MAX_ROW || *col > MAX_COL {
                    return Err(bad("cell outside the sheet"));
                }
                if self.workbook().thread_at(at).is_some() {
                    return Err(bad("the cell already has a comment"));
                }
                let id = self
                    .workbook()
                    .fresh_comment_id(&format!("{sheet}:{row}:{col}:{date}:{text}"));
                let mentions = self.mentions_in(text, &[]);
                self.workbook_mut().set_thread(
                    s,
                    Thread {
                        id,
                        row: *row,
                        col: *col,
                        author: author.clone(),
                        date: date.clone(),
                        text: text.clone(),
                        resolved: false,
                        replies: Vec::new(),
                        mentions,
                    },
                )?;
                done(CalcPatch::default())
            }
            C::ReplyComment {
                sheet,
                row,
                col,
                text,
                author,
                date,
            } => {
                let s = self.sheet(*sheet)?;
                let mut t = self.thread(s, *row, *col)?;
                let id = self.workbook().fresh_comment_id(&format!(
                    "{}:{}:{date}:{text}",
                    t.id,
                    t.replies.len()
                ));
                let mentions = self.mentions_in(text, &[]);
                t.replies.push(Reply {
                    id,
                    author: author.clone(),
                    date: date.clone(),
                    text: text.clone(),
                    mentions,
                });
                self.workbook_mut().set_thread(s, t)?;
                done(CalcPatch::default())
            }
            C::EditComment {
                sheet,
                row,
                col,
                id,
                text,
            } => {
                let s = self.sheet(*sheet)?;
                let mut t = self.thread(s, *row, *col)?;
                if t.id == *id {
                    t.mentions = self.mentions_in(text, &t.mentions);
                    t.text.clone_from(text);
                } else {
                    let r = t
                        .replies
                        .iter_mut()
                        .find(|r| r.id == *id)
                        .ok_or_else(|| bad("unknown comment id"))?;
                    r.mentions = self.mentions_in(text, &r.mentions);
                    r.text.clone_from(text);
                }
                self.workbook_mut().set_thread(s, t)?;
                done(CalcPatch::default())
            }
            C::DeleteReply {
                sheet,
                row,
                col,
                id,
            } => {
                let s = self.sheet(*sheet)?;
                let mut t = self.thread(s, *row, *col)?;
                let before = t.replies.len();
                t.replies.retain(|r| r.id != *id);
                if t.replies.len() == before {
                    return Err(bad("unknown reply id"));
                }
                self.workbook_mut().set_thread(s, t)?;
                done(CalcPatch::default())
            }
            &C::DeleteThread {
                sheet,
                r0,
                c0,
                r1,
                c1,
            } => {
                let range = self.range(sheet, r0, c0, r1, c1)?;
                let threads: Vec<Thread> = self
                    .workbook()
                    .threads(range.sheet)
                    .iter()
                    .filter(|t| !range.contains(CellCoord::new(range.sheet, t.row, t.col)))
                    .cloned()
                    .collect();
                self.workbook_mut().set_threads(range.sheet, threads)?;
                done(CalcPatch::default())
            }
            &C::ResolveThread {
                sheet,
                row,
                col,
                resolved,
            } => {
                let s = self.sheet(sheet)?;
                let mut t = self.thread(s, row, col)?;
                t.resolved = resolved;
                self.workbook_mut().set_thread(s, t)?;
                done(CalcPatch::default())
            }
            C::SetUser { name, initials } => {
                if !name.trim().is_empty() {
                    self.workbook_mut()
                        .upsert_person(Person::new(name.trim(), initials.trim()));
                }
                done(CalcPatch::default())
            }
            C::SetHyperlink {
                sheet,
                r0,
                c0,
                r1,
                c1,
                target,
                tooltip,
                text,
            } => {
                let range = self.range(*sheet, *r0, *c0, *r1, *c1)?;
                let s = range.sheet;
                let mut patch = CalcPatch::default();
                let mut inverses = Vec::new();
                let top_left = CellCoord::new(s, *r0, *c0);
                let display = text.clone().filter(|t| !t.is_empty());
                if let Some(t) = &display {
                    let current = model_sheet::content_to_input(self.workbook().content(top_left));
                    if current != *t {
                        let applied = self.apply_cmd(&C::SetInput {
                            sheet: *sheet,
                            row: *r0,
                            col: *c0,
                            // Text to display is text, never a formula.
                            input: if t.starts_with('=') {
                                format!("'{t}")
                            } else {
                                t.clone()
                            },
                        })?;
                        patch.merge(applied.patch);
                        inverses.extend(applied.inverse);
                    }
                }
                self.workbook_mut().set_hyperlink(
                    s,
                    Hyperlink {
                        r0: *r0,
                        c0: *c0,
                        r1: *r1,
                        c1: *c1,
                        target: target.clone(),
                        display,
                        tooltip: tooltip.clone().filter(|t| !t.is_empty()),
                    },
                )?;
                let styled = self.apply_cmd(&C::ApplyStyle {
                    sheet: *sheet,
                    r0: *r0,
                    c0: *c0,
                    r1: *r1,
                    c1: *c1,
                    patch: hyperlink_style(),
                })?;
                patch.merge(styled.patch);
                inverses.extend(styled.inverse);
                inverses.reverse();
                Ok(Applied {
                    patch,
                    inverse: Some(C::Compound { commands: inverses }),
                })
            }
            &C::RemoveHyperlink {
                sheet,
                r0,
                c0,
                r1,
                c1,
            } => {
                let range = self.range(sheet, r0, c0, r1, c1)?;
                let s = range.sheet;
                // Excel's Remove Hyperlinks also clears the link formatting: the Hyperlink style's
                // theme colour and single underline go (other formats stay), on the linked cells
                // of the range.
                let linked: Vec<(u32, u32)> = self
                    .workbook()
                    .hyperlinks(s)
                    .iter()
                    .filter(|l| l.r0 <= r1 && r0 <= l.r1 && l.c0 <= c1 && c0 <= l.c1)
                    .flat_map(|l| {
                        let (a, b) = (l.r0.max(r0), l.r1.min(r1));
                        let (c, d) = (l.c0.max(c0), l.c1.min(c1));
                        (a..=b).flat_map(move |row| (c..=d).map(move |col| (row, col)))
                    })
                    .take(100_000)
                    .collect();
                self.workbook_mut().remove_hyperlinks(range)?;
                let mut cells: Vec<(u32, u32, u32)> = Vec::new();
                for (row, col) in linked {
                    let c = CellCoord::new(s, row, col);
                    let old = self.workbook().style_id(c);
                    let style = self.workbook().styles().get(old).clone();
                    let Some(plain) = without_link_format(&style) else {
                        continue;
                    };
                    let id = self.workbook_mut().intern_style(&plain);
                    if id != old {
                        cells.push((row, col, id.0));
                    }
                }
                if cells.is_empty() {
                    return done(CalcPatch::default());
                }
                cells.sort_unstable();
                cells.dedup();
                self.apply_cmd(&C::RestoreStyles { sheet, cells })
            }
            C::RestoreAnnotations {
                sheet,
                notes,
                threads,
                hyperlinks,
            } => {
                let Ok(s) = self.sheet(*sheet) else {
                    if notes.is_empty() && threads.is_empty() && hyperlinks.is_empty() {
                        return done(CalcPatch::default());
                    }
                    return Err(crate::doc::CalcError::UnknownSheet(*sheet));
                };
                let wb = self.workbook_mut();
                wb.set_notes(s, notes.clone())?;
                wb.set_threads(s, threads.clone())?;
                wb.set_hyperlinks(s, hyperlinks.clone())?;
                done(CalcPatch::default())
            }
            C::RestorePersons { persons } => {
                self.workbook_mut().set_persons(persons.clone());
                done(CalcPatch::default())
            }
            _ => unreachable!("not an annotation command: {cmd:?}"),
        }
    }

    fn thread(&self, s: SheetId, row: u32, col: u32) -> Result<Thread> {
        self.workbook()
            .thread_at(CellCoord::new(s, row, col))
            .cloned()
            .ok_or_else(|| bad("the cell has no comment"))
    }

    /// The `cellAnnotations` request.
    pub fn cell_annotations(
        &self,
        sheet: u32,
        r0: u32,
        c0: u32,
        r1: u32,
        c1: u32,
    ) -> Result<CellAnnotations> {
        let s = self.sheet(sheet)?;
        if r0 > r1 || c0 > c1 || r1 > MAX_ROW || c1 > MAX_COL {
            return Err(crate::doc::CalcError::InvalidRange);
        }
        let range = CellRange::new(s, r0, c0, r1, c1);
        let wb = self.workbook();
        let inside = |r: u32, c: u32| range.contains(CellCoord::new(s, r, c));
        let mut formula_links = Vec::new();
        if let Some((ur, uc)) = wb.used_range(s) {
            let (r1, c1) = (r1.min(ur), c1.min(uc));
            if r0 <= r1 && c0 <= c1 {
                for (c, content) in wb.engine().cells(s) {
                    if !inside(c.row, c.col) || c.row > r1 || c.col > c1 {
                        continue;
                    }
                    let model_sheet::CellContent::Formula { text, .. } = content else {
                        continue;
                    };
                    if !text.to_ascii_uppercase().contains("HYPERLINK(") {
                        continue;
                    }
                    if wb.hyperlink_at(c).is_some() {
                        continue;
                    }
                    if let Some(target) = wb.cell_link(c) {
                        formula_links.push(FormulaLink {
                            row: c.row,
                            col: c.col,
                            target,
                        });
                    }
                }
            }
        }
        formula_links.sort_by_key(|l| (l.row, l.col));
        Ok(CellAnnotations {
            sheet,
            notes: wb
                .notes(s)
                .iter()
                .filter(|n| inside(n.row, n.col))
                .cloned()
                .collect(),
            threads: wb
                .threads(s)
                .iter()
                .filter(|t| inside(t.row, t.col))
                .cloned()
                .collect(),
            hyperlinks: wb
                .hyperlinks(s)
                .iter()
                .filter(|h| h.r0 <= r1 && r0 <= h.r1 && h.c0 <= c1 && c0 <= h.c1)
                .cloned()
                .collect(),
            formula_links,
        })
    }

    /// The `allComments` request: the threads of `sheet` or (`None`)
    /// every sheet with any, in sheet order.
    pub fn all_comments(&self, sheet: Option<u32>) -> Result<Vec<SheetThreads>> {
        let wb = self.workbook();
        let sheets: Vec<SheetId> = match sheet {
            Some(id) => vec![self.sheet(id)?],
            None => wb.sheets().into_iter().map(|(s, _)| s).collect(),
        };
        Ok(sheets
            .into_iter()
            .map(|s| SheetThreads {
                sheet: s.0,
                threads: wb.threads(s).to_vec(),
            })
            .filter(|t| sheet.is_some() || !t.threads.is_empty())
            .collect())
    }
}
