//! Cell annotations (P8-26): notes (Excel's legacy comments with the
//! yellow box), threaded comments and hyperlinks, plus the document's
//! list of comment authors ([`Person`]s).
//!
//! A cell has at most one [`Note`] and at most one [`Thread`]. Both are
//! attached to their cell: they move with row/column inserts and deletes
//! (and disappear with a deleted cell), with sorting and with a cut and
//! paste; a copy and paste copies notes (not threads, as in Excel).
//! Clearing the contents of a cell keeps its annotations. A
//! [`Hyperlink`] covers a range, which moves and clips like a merged
//! range.
//!
//! ```
//! use model_sheet::{Note, NoteRun, Workbook, CellCoord};
//!
//! let mut wb = Workbook::new();
//! let s = wb.sheet_id("Sheet1").unwrap();
//! wb.set_note(s, Note::plain(2, 1, "Ann", "check this")).unwrap();
//! wb.insert_rows(s, 0, 1).unwrap();
//! assert_eq!(wb.note_at(CellCoord::new(s, 3, 1)).unwrap().plain_text(), "check this");
//! ```

use core_model::RunProperties;
use engine_formula::ast::{MAX_COL, MAX_ROW};
use engine_formula::{evaluate, CellContent, CellCoord, Expr, SheetId, StructuralOp, Value};
use serde::{Deserialize, Serialize};

use crate::workbook::Workbook;
use crate::{CellRange, Error};

fn is_false(b: &bool) -> bool {
    !*b
}

/// One run of a note's rich text.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteRun {
    pub text: String,
    /// Bold, italic, size, colour, …; empty = the note's default font
    /// (Tahoma 9 in Excel).
    #[serde(default, skip_serializing_if = "RunProperties::is_empty")]
    pub font: RunProperties,
}

impl NoteRun {
    pub fn plain(text: impl Into<String>) -> Self {
        NoteRun {
            text: text.into(),
            font: RunProperties::default(),
        }
    }
}

/// Position and size of a note's box in points. `x`/`y` are relative to
/// the top-right corner of the note's cell (so the box moves with its
/// cell); Excel's default box sits 15 px right of and 10 px above it.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteBounds {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl NoteBounds {
    /// Excel's default box for a new note: 128 × 74 px (96 × 55.5 pt),
    /// 15 px to the right and 10 px above the cell's top-right corner.
    pub const DEFAULT: NoteBounds = NoteBounds {
        x: 11.25,
        y: -7.5,
        w: 96.0,
        h: 55.5,
    };

    fn check(&self) -> bool {
        [self.x, self.y, self.w, self.h]
            .iter()
            .all(|v| v.is_finite())
            && self.w > 0.0
            && self.h > 0.0
    }
}

/// A note (Excel's legacy comment): rich text in a yellow box, hidden
/// (shown on hover) unless `visible`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub row: u32,
    pub col: u32,
    /// The author's name (`""` = unknown).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub author: String,
    pub text: Vec<NoteRun>,
    /// Always shown (Show/Hide Note), not only on hover.
    #[serde(default, skip_serializing_if = "is_false")]
    pub visible: bool,
    /// The box; `None` = Excel's default ([`NoteBounds::DEFAULT`]).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<NoteBounds>,
}

impl Note {
    /// A hidden note with one plain run.
    pub fn plain(row: u32, col: u32, author: &str, text: &str) -> Self {
        Note {
            row,
            col,
            author: author.to_owned(),
            text: vec![NoteRun::plain(text)],
            visible: false,
            bounds: None,
        }
    }

    /// The text without formatting.
    pub fn plain_text(&self) -> String {
        self.text.iter().map(|r| r.text.as_str()).collect()
    }
}

/// An author of threaded comments. `id` is the GUID of the file's
/// `personList` (kept for stable rewrites; empty = derived from the name).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
    pub name: String,
    /// Shown in the avatar; empty = derived from the name.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub initials: String,
}

impl Person {
    pub fn new(name: &str, initials: &str) -> Self {
        Person {
            id: String::new(),
            name: name.to_owned(),
            initials: initials.to_owned(),
        }
    }

    /// The initials, or the first letters of the first and last word of
    /// the name.
    pub fn display_initials(&self) -> String {
        if !self.initials.is_empty() {
            return self.initials.clone();
        }
        initials_of(&self.name)
    }

    /// The GUID: `id`, else one derived from the name.
    pub fn guid(&self) -> String {
        if self.id.is_empty() {
            guid(&format!("person:{}", self.name))
        } else {
            self.id.clone()
        }
    }
}

/// `"Ann Lee"` → `"AL"`, `"bob"` → `"B"`.
pub fn initials_of(name: &str) -> String {
    let words: Vec<&str> = name.split_whitespace().collect();
    let first = |w: &str| {
        w.chars()
            .next()
            .map(|c| c.to_uppercase().collect::<String>())
    };
    match words.as_slice() {
        [] => String::new(),
        [one] => first(one).unwrap_or_default(),
        [a, .., b] => format!(
            "{}{}",
            first(a).unwrap_or_default(),
            first(b).unwrap_or_default()
        ),
    }
}

/// A reply in a [`Thread`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub id: String,
    pub author: Person,
    /// ISO 8601 (`2026-10-16T09:30:00.00`), as written by the UI.
    pub date: String,
    pub text: String,
}

/// A threaded comment: the first comment plus its replies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    /// GUID (`{…}`), unique in the workbook.
    pub id: String,
    pub row: u32,
    pub col: u32,
    pub author: Person,
    pub date: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub resolved: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub replies: Vec<Reply>,
}

/// Where a [`Hyperlink`] leads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LinkTarget {
    /// A web page or file (`https://…`, `file:///…`, a relative path).
    Url { url: String },
    /// A place in this workbook: `Sheet2!B4`, `'My sheet'!A1:C3` or a
    /// defined name.
    Location { location: String },
    /// `mailto:` with an optional subject.
    Email {
        address: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        subject: Option<String>,
    },
}

impl LinkTarget {
    /// The external URL of a `Url` or `Email` target (`None` for a
    /// location in the workbook).
    pub fn external_url(&self) -> Option<String> {
        match self {
            LinkTarget::Url { url } => Some(url.clone()),
            LinkTarget::Email { address, subject } => Some(match subject {
                Some(s) if !s.is_empty() => format!("mailto:{address}?subject={}", escape_uri(s)),
                _ => format!("mailto:{address}"),
            }),
            LinkTarget::Location { .. } => None,
        }
    }

    /// The target of an external URL (`mailto:` becomes [`LinkTarget::Email`]).
    pub fn from_url(url: &str) -> LinkTarget {
        match url.strip_prefix("mailto:") {
            Some(rest) => {
                let (address, query) = rest.split_once('?').unwrap_or((rest, ""));
                let subject = query.split('&').find_map(|kv| {
                    let (k, v) = kv.split_once('=')?;
                    k.eq_ignore_ascii_case("subject").then(|| unescape_uri(v))
                });
                LinkTarget::Email {
                    address: address.to_owned(),
                    subject,
                }
            }
            None => LinkTarget::Url {
                url: url.to_owned(),
            },
        }
    }
}

fn escape_uri(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn unescape_uri(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                (Some(h), Some(l)) => {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                    continue;
                }
                _ => out.push(b'%'),
            },
            b'+' => out.push(b' '),
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A hyperlink on a cell range (0-based, inclusive).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hyperlink {
    pub r0: u32,
    pub c0: u32,
    pub r1: u32,
    pub c1: u32,
    pub target: LinkTarget,
    /// The `display` text of the file (the cell's text is the cell
    /// content; this is informational).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<String>,
    /// The ScreenTip shown on hover.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tooltip: Option<String>,
}

impl Hyperlink {
    pub fn contains(&self, row: u32, col: u32) -> bool {
        (self.r0..=self.r1).contains(&row) && (self.c0..=self.c1).contains(&col)
    }

    fn intersects(&self, r: &CellRange) -> bool {
        self.r0 <= r.r1 && r.r0 <= self.r1 && self.c0 <= r.c1 && r.c0 <= self.c1
    }

    fn check(&self) -> bool {
        self.r0 <= self.r1 && self.c0 <= self.c1 && self.r1 <= MAX_ROW && self.c1 <= MAX_COL
    }
}

/// A deterministic GUID (`{XXXXXXXX-XXXX-4XXX-8XXX-XXXXXXXXXXXX}`) derived
/// from `seed` (FNV-1a; core crates have no random source).
pub fn guid(seed: &str) -> String {
    let fnv = |offset: u64| {
        seed.bytes().fold(offset, |h, b| {
            (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3)
        })
    };
    let a = fnv(0xcbf2_9ce4_8422_2325);
    let b = fnv(0x6c62_272e_07bb_0142);
    format!(
        "{{{:08X}-{:04X}-4{:03X}-8{:03X}-{:012X}}}",
        a >> 32,
        (a >> 16) & 0xffff,
        a & 0xfff,
        (b >> 48) & 0xfff,
        b & 0xffff_ffff_ffff
    )
}

fn check_cell(row: u32, col: u32) -> Result<(), Error> {
    if row > MAX_ROW || col > MAX_COL {
        return Err(Error::InvalidAnnotation("cell outside the sheet".into()));
    }
    Ok(())
}

fn check_note(n: &Note) -> Result<(), Error> {
    check_cell(n.row, n.col)?;
    if n.bounds.is_some_and(|b| !b.check()) {
        return Err(Error::InvalidAnnotation("invalid note box".into()));
    }
    Ok(())
}

fn check_thread(t: &Thread) -> Result<(), Error> {
    check_cell(t.row, t.col)?;
    if t.id.is_empty() || t.replies.iter().any(|r| r.id.is_empty()) {
        return Err(Error::InvalidAnnotation("comment without id".into()));
    }
    Ok(())
}

/// The value of the first argument of a `HYPERLINK(…)` formula as text.
fn hyperlink_formula_target(wb: &Workbook, c: CellCoord) -> Option<String> {
    let CellContent::Formula { ast, .. } = wb.content(c) else {
        return None;
    };
    let Expr::Call { name, args } = ast else {
        return None;
    };
    if !name.eq_ignore_ascii_case("HYPERLINK") {
        return None;
    }
    let engine = wb.engine();
    let ctx = engine.eval_context(engine, c);
    match evaluate(args.first()?, &ctx).into_scalar() {
        Value::Text(t) if !t.is_empty() => Some(t),
        Value::Number(n) => Some(format!("{n}")),
        _ => None,
    }
}

impl Workbook {
    // --- notes --------------------------------------------------------------

    /// The notes of `sheet`, sorted by cell (row-major).
    pub fn notes(&self, sheet: SheetId) -> &[Note] {
        &self.sheet_data(sheet).notes
    }

    pub fn note_at(&self, c: CellCoord) -> Option<&Note> {
        self.notes(c.sheet)
            .iter()
            .find(|n| (n.row, n.col) == (c.row, c.col))
    }

    /// Adds or replaces the note of its cell; returns the previous note.
    pub fn set_note(&mut self, sheet: SheetId, note: Note) -> Result<Option<Note>, Error> {
        check_note(&note)?;
        let notes = &mut self.sheet_data_mut(sheet)?.notes;
        let key = (note.row, note.col);
        match notes.binary_search_by_key(&key, |n| (n.row, n.col)) {
            Ok(i) => Ok(Some(std::mem::replace(&mut notes[i], note))),
            Err(i) => {
                notes.insert(i, note);
                Ok(None)
            }
        }
    }

    /// Removes the note of `c`.
    pub fn remove_note(&mut self, c: CellCoord) -> Result<Option<Note>, Error> {
        let notes = &mut self.sheet_data_mut(c.sheet)?.notes;
        Ok(notes
            .iter()
            .position(|n| (n.row, n.col) == (c.row, c.col))
            .map(|i| notes.remove(i)))
    }

    /// Replaces every note of `sheet` (loading, undo). Two notes on one
    /// cell or a note outside the sheet fail and change nothing.
    pub fn set_notes(&mut self, sheet: SheetId, notes: Vec<Note>) -> Result<(), Error> {
        let mut notes = notes;
        notes.iter().try_for_each(check_note)?;
        notes.sort_by_key(|n| (n.row, n.col));
        if notes
            .windows(2)
            .any(|w| (w[0].row, w[0].col) == (w[1].row, w[1].col))
        {
            return Err(Error::InvalidAnnotation("two notes on one cell".into()));
        }
        self.sheet_data_mut(sheet)?.notes = notes;
        Ok(())
    }

    // --- threaded comments --------------------------------------------------

    /// The threads of `sheet`, sorted by cell.
    pub fn threads(&self, sheet: SheetId) -> &[Thread] {
        &self.sheet_data(sheet).threads
    }

    pub fn thread_at(&self, c: CellCoord) -> Option<&Thread> {
        self.threads(c.sheet)
            .iter()
            .find(|t| (t.row, t.col) == (c.row, c.col))
    }

    /// Adds or replaces the thread of its cell; returns the previous one.
    pub fn set_thread(&mut self, sheet: SheetId, thread: Thread) -> Result<Option<Thread>, Error> {
        check_thread(&thread)?;
        let threads = &mut self.sheet_data_mut(sheet)?.threads;
        let key = (thread.row, thread.col);
        match threads.binary_search_by_key(&key, |t| (t.row, t.col)) {
            Ok(i) => Ok(Some(std::mem::replace(&mut threads[i], thread))),
            Err(i) => {
                threads.insert(i, thread);
                Ok(None)
            }
        }
    }

    pub fn remove_thread(&mut self, c: CellCoord) -> Result<Option<Thread>, Error> {
        let threads = &mut self.sheet_data_mut(c.sheet)?.threads;
        Ok(threads
            .iter()
            .position(|t| (t.row, t.col) == (c.row, c.col))
            .map(|i| threads.remove(i)))
    }

    /// Replaces every thread of `sheet` (two threads on one cell fail).
    pub fn set_threads(&mut self, sheet: SheetId, threads: Vec<Thread>) -> Result<(), Error> {
        let mut threads = threads;
        threads.iter().try_for_each(check_thread)?;
        threads.sort_by_key(|t| (t.row, t.col));
        if threads
            .windows(2)
            .any(|w| (w[0].row, w[0].col) == (w[1].row, w[1].col))
        {
            return Err(Error::InvalidAnnotation("two threads on one cell".into()));
        }
        self.sheet_data_mut(sheet)?.threads = threads;
        Ok(())
    }

    /// Every comment id (threads and replies) of the workbook.
    pub fn comment_ids(&self) -> std::collections::HashSet<String> {
        self.sheets()
            .into_iter()
            .flat_map(|(s, _)| self.threads(s).iter())
            .flat_map(|t| {
                std::iter::once(t.id.clone()).chain(t.replies.iter().map(|r| r.id.clone()))
            })
            .collect()
    }

    /// A GUID derived from `seed` that no comment of the workbook uses.
    pub fn fresh_comment_id(&self, seed: &str) -> String {
        let used = self.comment_ids();
        (0u32..)
            .map(|n| guid(&format!("comment:{seed}:{n}")))
            .find(|id| !used.contains(id))
            .expect("unbounded")
    }

    // --- persons ------------------------------------------------------------

    /// The document's comment authors (`personList`).
    pub fn persons(&self) -> &[Person] {
        &self.persons
    }

    pub fn set_persons(&mut self, persons: Vec<Person>) {
        self.persons = persons;
    }

    /// Adds `person` (or updates the initials of the person with that
    /// name); returns whether the list changed.
    pub fn upsert_person(&mut self, person: Person) -> bool {
        match self.persons.iter_mut().find(|p| p.name == person.name) {
            Some(p) if p.initials == person.initials => false,
            Some(p) => {
                p.initials = person.initials;
                true
            }
            None => {
                self.persons.push(person);
                true
            }
        }
    }

    // --- hyperlinks ---------------------------------------------------------

    /// The hyperlinks of `sheet`, in file order.
    pub fn hyperlinks(&self, sheet: SheetId) -> &[Hyperlink] {
        &self.sheet_data(sheet).hyperlinks
    }

    pub fn hyperlink_at(&self, c: CellCoord) -> Option<&Hyperlink> {
        self.hyperlinks(c.sheet)
            .iter()
            .find(|h| h.contains(c.row, c.col))
    }

    /// Sets a hyperlink, replacing the links that intersect its range.
    pub fn set_hyperlink(&mut self, sheet: SheetId, link: Hyperlink) -> Result<(), Error> {
        if !link.check() {
            return Err(Error::InvalidAnnotation("invalid hyperlink range".into()));
        }
        let range = CellRange::new(sheet, link.r0, link.c0, link.r1, link.c1);
        let links = &mut self.sheet_data_mut(sheet)?.hyperlinks;
        links.retain(|h| !h.intersects(&range));
        links.push(link);
        Ok(())
    }

    /// Removes every hyperlink intersecting `range`; returns them.
    pub fn remove_hyperlinks(&mut self, range: CellRange) -> Result<Vec<Hyperlink>, Error> {
        let links = &mut self.sheet_data_mut(range.sheet)?.hyperlinks;
        let (removed, kept) = std::mem::take(links)
            .into_iter()
            .partition(|h| h.intersects(&range));
        *links = kept;
        Ok(removed)
    }

    pub fn set_hyperlinks(&mut self, sheet: SheetId, links: Vec<Hyperlink>) -> Result<(), Error> {
        if links.iter().any(|h| !h.check()) {
            return Err(Error::InvalidAnnotation("invalid hyperlink range".into()));
        }
        self.sheet_data_mut(sheet)?.hyperlinks = links;
        Ok(())
    }

    /// Where a click on `c` leads: its hyperlink, else the target of a
    /// `HYPERLINK()` formula (`#Sheet!A1` as a location, `mailto:` as an
    /// e-mail, anything else as a URL).
    pub fn cell_link(&self, c: CellCoord) -> Option<LinkTarget> {
        if let Some(h) = self.hyperlink_at(c) {
            return Some(h.target.clone());
        }
        let t = hyperlink_formula_target(self, c)?;
        Some(match t.strip_prefix('#') {
            Some(loc) => LinkTarget::Location {
                location: loc.to_owned(),
            },
            None => LinkTarget::from_url(&t),
        })
    }

    // --- following cells ------------------------------------------------------

    /// After a row/column insert or delete on `sheet`: notes and threads
    /// follow their cell (deleted cells lose them), hyperlink ranges move
    /// and clip like merges.
    pub(crate) fn shift_annotations(&mut self, sheet: SheetId, op: StructuralOp) {
        let Ok(data) = self.sheet_data_mut(sheet) else {
            return;
        };
        data.notes = std::mem::take(&mut data.notes)
            .into_iter()
            .filter_map(|mut n| {
                (n.row, n.col) = op.map_cell(n.row, n.col)?;
                Some(n)
            })
            .collect();
        data.notes.sort_by_key(|n| (n.row, n.col));
        data.threads = std::mem::take(&mut data.threads)
            .into_iter()
            .filter_map(|mut t| {
                (t.row, t.col) = op.map_cell(t.row, t.col)?;
                Some(t)
            })
            .collect();
        data.threads.sort_by_key(|t| (t.row, t.col));
        data.hyperlinks = std::mem::take(&mut data.hyperlinks)
            .into_iter()
            .filter_map(|mut h| {
                if op.is_rows() {
                    (h.r0, h.r1) = op.map_interval(h.r0, h.r1)?;
                } else {
                    (h.c0, h.c1) = op.map_interval(h.c0, h.c1)?;
                }
                Some(h)
            })
            .collect();
    }

    /// After sorting rows of `cols` on `sheet`: the annotations of the
    /// moved cells follow them (`moves`: `(from_row, to_row)`); hyperlinks
    /// of single cells move, larger ones stay.
    pub(crate) fn permute_annotation_rows(
        &mut self,
        sheet: SheetId,
        cols: (u32, u32),
        moves: &[(u32, u32)],
    ) {
        let Ok(data) = self.sheet_data_mut(sheet) else {
            return;
        };
        let target = |row: u32, col: u32| {
            if !(cols.0..=cols.1).contains(&col) {
                return row;
            }
            moves
                .iter()
                .find(|(from, _)| *from == row)
                .map_or(row, |(_, to)| *to)
        };
        for n in &mut data.notes {
            n.row = target(n.row, n.col);
        }
        data.notes.sort_by_key(|n| (n.row, n.col));
        for t in &mut data.threads {
            t.row = target(t.row, t.col);
        }
        data.threads.sort_by_key(|t| (t.row, t.col));
        for h in &mut data.hyperlinks {
            if h.r0 == h.r1 && h.c0 == h.c1 {
                let r = target(h.r0, h.c0);
                (h.r0, h.r1) = (r, r);
            }
        }
    }

    /// A cut and paste of `src` to `(sheet, r0, c0)`: the annotations of
    /// the destination area are replaced by those of `src` (notes,
    /// threads and hyperlinks, which leave the source).
    pub fn move_annotations(
        &mut self,
        src: CellRange,
        sheet: SheetId,
        r0: u32,
        c0: u32,
    ) -> Result<(), Error> {
        let (h, w) = (src.r1 - src.r0, src.c1 - src.c0);
        let (r1, c1) = (r0.saturating_add(h), c0.saturating_add(w));
        if r1 > MAX_ROW || c1 > MAX_COL {
            return Err(Error::InvalidRange);
        }
        self.sheet_data_mut(sheet)?;
        let inside = |r: &CellRange, row: u32, col: u32| {
            (r.r0..=r.r1).contains(&row) && (r.c0..=r.c1).contains(&col)
        };
        let dst = CellRange::new(sheet, r0, c0, r1, c1);
        let moved_row = |row: u32| row - src.r0 + r0;
        let moved_col = |col: u32| col - src.c0 + c0;
        let s = self.sheet_data_mut(src.sheet)?;
        let (notes, keep): (Vec<Note>, Vec<Note>) = std::mem::take(&mut s.notes)
            .into_iter()
            .partition(|n| inside(&src, n.row, n.col));
        s.notes = keep;
        let (threads, keep): (Vec<Thread>, Vec<Thread>) = std::mem::take(&mut s.threads)
            .into_iter()
            .partition(|t| inside(&src, t.row, t.col));
        s.threads = keep;
        let (links, keep): (Vec<Hyperlink>, Vec<Hyperlink>) = std::mem::take(&mut s.hyperlinks)
            .into_iter()
            .partition(|l| l.intersects(&src));
        s.hyperlinks = keep;
        let d = self.sheet_data_mut(sheet)?;
        d.notes.retain(|n| !inside(&dst, n.row, n.col));
        d.threads.retain(|t| !inside(&dst, t.row, t.col));
        d.hyperlinks.retain(|l| !l.intersects(&dst));
        d.notes.extend(notes.into_iter().map(|n| Note {
            row: moved_row(n.row),
            col: moved_col(n.col),
            ..n
        }));
        d.notes.sort_by_key(|n| (n.row, n.col));
        d.threads.extend(threads.into_iter().map(|t| Thread {
            row: moved_row(t.row),
            col: moved_col(t.col),
            ..t
        }));
        d.threads.sort_by_key(|t| (t.row, t.col));
        d.hyperlinks.extend(links.into_iter().map(|l| {
            let (lr0, lc0) = (l.r0.max(src.r0), l.c0.max(src.c0));
            let (lr1, lc1) = (l.r1.min(src.r1), l.c1.min(src.c1));
            Hyperlink {
                r0: moved_row(lr0),
                c0: moved_col(lc0),
                r1: moved_row(lr1),
                c1: moved_col(lc1),
                ..l
            }
        }));
        Ok(())
    }

    /// A copy and paste of `src` to `(sheet, r0, c0)`, repeated `reps`
    /// (rows × columns) times: the notes and hyperlinks of the
    /// destination area are replaced by copies of those of `src`
    /// (threads stay where they are, as in Excel).
    pub fn copy_annotations(
        &mut self,
        src: CellRange,
        sheet: SheetId,
        (r0, c0): (u32, u32),
        reps: (u32, u32),
    ) -> Result<(), Error> {
        let (h, w) = (src.rows(), src.cols());
        let r1 = u64::from(r0) + u64::from(h) * u64::from(reps.0) - 1;
        let c1 = u64::from(c0) + u64::from(w) * u64::from(reps.1) - 1;
        if reps.0 == 0 || reps.1 == 0 || r1 > u64::from(MAX_ROW) || c1 > u64::from(MAX_COL) {
            return Err(Error::InvalidRange);
        }
        let dst = CellRange::new(sheet, r0, c0, r1 as u32, c1 as u32);
        let inside = |r: &CellRange, row: u32, col: u32| {
            (r.r0..=r.r1).contains(&row) && (r.c0..=r.c1).contains(&col)
        };
        let notes: Vec<Note> = self
            .notes(src.sheet)
            .iter()
            .filter(|n| inside(&src, n.row, n.col))
            .cloned()
            .collect();
        let links: Vec<Hyperlink> = self
            .hyperlinks(src.sheet)
            .iter()
            .filter(|l| l.intersects(&src))
            .cloned()
            .collect();
        let d = self.sheet_data_mut(sheet)?;
        d.notes.retain(|n| !inside(&dst, n.row, n.col));
        d.hyperlinks.retain(|l| !l.intersects(&dst));
        for i in 0..reps.0 {
            for j in 0..reps.1 {
                let (tr, tc) = (r0 + i * h, c0 + j * w);
                for n in &notes {
                    d.notes.push(Note {
                        row: n.row - src.r0 + tr,
                        col: n.col - src.c0 + tc,
                        ..n.clone()
                    });
                }
                for l in &links {
                    d.hyperlinks.push(Hyperlink {
                        r0: l.r0.max(src.r0) - src.r0 + tr,
                        c0: l.c0.max(src.c0) - src.c0 + tc,
                        r1: l.r1.min(src.r1) - src.r0 + tr,
                        c1: l.c1.min(src.c1) - src.c0 + tc,
                        ..l.clone()
                    });
                }
            }
        }
        d.notes.sort_by_key(|n| (n.row, n.col));
        Ok(())
    }

    /// After duplicating `from` into `to`: the copied threads (and
    /// replies) get fresh ids, which must be unique in the workbook.
    pub(crate) fn renew_thread_ids(&mut self, to: SheetId) {
        let mut threads = self.threads(to).to_vec();
        let mut used = self.comment_ids();
        let mut fresh = |old: &str| {
            let id = (0u32..)
                .map(|n| guid(&format!("copy:{old}:{}:{n}", to.0)))
                .find(|id| !used.contains(id))
                .expect("unbounded");
            used.insert(id.clone());
            id
        };
        for t in &mut threads {
            t.id = fresh(&t.id);
            for r in &mut t.replies {
                r.id = fresh(&r.id);
            }
        }
        if let Ok(d) = self.sheet_data_mut(to) {
            d.threads = threads;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn thread(id: &str, row: u32, col: u32) -> Thread {
        Thread {
            id: id.into(),
            row,
            col,
            author: Person::new("Ann Lee", ""),
            date: "2026-10-16T09:00:00.00".into(),
            text: "why?".into(),
            resolved: false,
            replies: vec![Reply {
                id: format!("{id}-r"),
                author: Person::new("Bob", "B"),
                date: "2026-10-16T10:00:00.00".into(),
                text: "because".into(),
            }],
        }
    }

    fn link(r0: u32, c0: u32, r1: u32, c1: u32) -> Hyperlink {
        Hyperlink {
            r0,
            c0,
            r1,
            c1,
            target: LinkTarget::Url {
                url: "https://example.com".into(),
            },
            display: None,
            tooltip: None,
        }
    }

    #[test]
    fn one_note_and_one_thread_per_cell() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        assert_eq!(wb.set_note(s, Note::plain(1, 1, "A", "x")).unwrap(), None);
        let old = wb.set_note(s, Note::plain(1, 1, "A", "y")).unwrap();
        assert_eq!(old.unwrap().plain_text(), "x");
        wb.set_note(s, Note::plain(0, 3, "A", "z")).unwrap();
        assert_eq!(
            wb.notes(s)
                .iter()
                .map(|n| (n.row, n.col))
                .collect::<Vec<_>>(),
            [(0, 3), (1, 1)]
        );
        assert!(wb
            .set_notes(
                s,
                vec![Note::plain(2, 2, "", "a"), Note::plain(2, 2, "", "b")]
            )
            .is_err());
        assert_eq!(wb.notes(s).len(), 2);
        let bad = Note {
            bounds: Some(NoteBounds {
                w: 0.0,
                ..NoteBounds::DEFAULT
            }),
            ..Note::plain(0, 0, "", "")
        };
        assert!(wb.set_note(s, bad).is_err());
        wb.set_thread(s, thread("{1}", 1, 1)).unwrap();
        assert!(wb.note_at(CellCoord::new(s, 1, 1)).is_some());
        assert!(wb.thread_at(CellCoord::new(s, 1, 1)).is_some());
        assert!(wb
            .set_threads(s, vec![thread("{1}", 0, 0), thread("{2}", 0, 0)])
            .is_err());
        assert!(wb.remove_thread(CellCoord::new(s, 1, 1)).unwrap().is_some());
        assert!(wb.remove_note(CellCoord::new(s, 1, 1)).unwrap().is_some());
        assert!(wb.remove_note(CellCoord::new(s, 1, 1)).unwrap().is_none());
    }

    #[test]
    fn annotations_follow_structural_edits() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let c = |r, col| CellCoord::new(s, r, col);
        wb.set_note(s, Note::plain(2, 1, "A", "n")).unwrap();
        wb.set_thread(s, thread("{t}", 4, 2)).unwrap();
        wb.set_hyperlink(s, link(3, 0, 5, 0)).unwrap();
        wb.insert_rows(s, 0, 2).unwrap();
        assert!(wb.note_at(c(4, 1)).is_some());
        assert!(wb.thread_at(c(6, 2)).is_some());
        assert_eq!(wb.hyperlinks(s)[0].r0, 5);
        wb.insert_cols(s, 0, 1).unwrap();
        assert!(wb.note_at(c(4, 2)).is_some());
        assert_eq!(wb.hyperlinks(s)[0].c0, 1);
        // Deleting the note's row removes it; the link is clipped.
        wb.delete_rows(s, 4, 2).unwrap();
        assert!(wb.notes(s).is_empty());
        assert_eq!((wb.hyperlinks(s)[0].r0, wb.hyperlinks(s)[0].r1), (4, 5));
        assert!(wb.thread_at(c(4, 3)).is_some());
        wb.delete_cols(s, 1, 1).unwrap();
        assert!(wb.hyperlinks(s).is_empty());
        // Clear contents keeps the thread.
        wb.set_input(c(4, 2), "x").unwrap();
        wb.clear(c(4, 2)).unwrap();
        assert!(wb.thread_at(c(4, 2)).is_some());
    }

    #[test]
    fn sort_moves_annotations_with_rows() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let c = |r, col| CellCoord::new(s, r, col);
        for (r, v) in [(0, "3"), (1, "1"), (2, "2")] {
            wb.set_input(c(r, 0), v).unwrap();
        }
        wb.set_note(s, Note::plain(0, 0, "", "three")).unwrap();
        wb.set_thread(s, thread("{t}", 1, 0)).unwrap();
        wb.set_hyperlink(s, link(2, 0, 2, 0)).unwrap();
        // A note outside the sorted columns stays.
        wb.set_note(s, Note::plain(0, 5, "", "outside")).unwrap();
        let spec = crate::SortSpec {
            keys: vec![crate::SortKey {
                col: 0,
                ascending: true,
                kind: crate::SortKind::Auto,
            }],
            has_header: false,
            case_sensitive: false,
        };
        wb.sort_range(CellRange::new(s, 0, 0, 2, 0), &spec).unwrap();
        assert_eq!(wb.note_at(c(2, 0)).unwrap().plain_text(), "three");
        assert!(wb.thread_at(c(0, 0)).is_some());
        assert_eq!(wb.hyperlink_at(c(1, 0)).unwrap().r0, 1);
        assert!(wb.note_at(c(0, 5)).is_some());
    }

    #[test]
    fn cut_moves_and_copy_copies_notes() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let c = |r, col| CellCoord::new(s, r, col);
        wb.set_note(s, Note::plain(0, 0, "", "n")).unwrap();
        wb.set_thread(s, thread("{t}", 0, 1)).unwrap();
        wb.set_hyperlink(s, link(0, 0, 0, 0)).unwrap();
        wb.set_note(s, Note::plain(5, 5, "", "overwritten"))
            .unwrap();
        wb.copy_annotations(CellRange::new(s, 0, 0, 0, 1), s, (5, 5), (2, 1))
            .unwrap();
        assert_eq!(wb.note_at(c(5, 5)).unwrap().plain_text(), "n");
        assert!(wb.note_at(c(6, 5)).is_some());
        assert!(wb.thread_at(c(5, 6)).is_none());
        assert!(wb.hyperlink_at(c(6, 5)).is_some());
        assert!(wb.note_at(c(0, 0)).is_some());
        let other = wb.add_sheet("Other").unwrap();
        wb.move_annotations(CellRange::new(s, 0, 0, 0, 1), other, 3, 3)
            .unwrap();
        assert!(wb.note_at(c(0, 0)).is_none());
        assert!(wb.thread_at(c(0, 1)).is_none());
        assert!(wb.note_at(CellCoord::new(other, 3, 3)).is_some());
        assert!(wb.thread_at(CellCoord::new(other, 3, 4)).is_some());
        assert!(wb.hyperlink_at(CellCoord::new(other, 3, 3)).is_some());
        assert!(wb.hyperlink_at(c(0, 0)).is_none());
    }

    #[test]
    fn duplicate_copies_with_fresh_ids_and_snapshot_roundtrips() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        wb.set_note(
            s,
            Note {
                text: vec![
                    NoteRun {
                        text: "Ann:\n".into(),
                        font: RunProperties {
                            bold: Some(true),
                            ..Default::default()
                        },
                    },
                    NoteRun::plain("body"),
                ],
                visible: true,
                bounds: Some(NoteBounds::DEFAULT),
                ..Note::plain(1, 1, "Ann", "")
            },
        )
        .unwrap();
        wb.set_thread(s, thread("{t}", 1, 1)).unwrap();
        wb.set_hyperlink(
            s,
            Hyperlink {
                target: LinkTarget::Location {
                    location: "Sheet1!A1".into(),
                },
                tooltip: Some("tip".into()),
                ..link(0, 0, 0, 0)
            },
        )
        .unwrap();
        wb.upsert_person(Person::new("Ann Lee", "AL"));
        assert!(!wb.upsert_person(Person::new("Ann Lee", "AL")));
        let (copy, _) = wb.duplicate_sheet(s, "Copy").unwrap();
        assert_eq!(wb.notes(copy), wb.notes(s));
        assert_eq!(wb.hyperlinks(copy), wb.hyperlinks(s));
        let (a, b) = (&wb.threads(s)[0], &wb.threads(copy)[0]);
        assert_ne!(a.id, b.id);
        assert_ne!(a.replies[0].id, b.replies[0].id);
        assert_eq!(a.text, b.text);
        let snap = wb.to_snapshot();
        let back = Workbook::from_snapshot(&snap).unwrap();
        assert_eq!(back.to_snapshot(), snap);
        assert_eq!(back.persons().len(), 1);
    }

    #[test]
    fn links_targets_and_helpers() {
        let mut wb = Workbook::new();
        let s = SheetId(0);
        let c = |r, col| CellCoord::new(s, r, col);
        wb.set_input(c(0, 0), "=HYPERLINK(\"https://a.b\",\"go\")")
            .unwrap();
        wb.set_input(c(1, 0), "=HYPERLINK(\"#Sheet1!C3\")").unwrap();
        wb.set_input(c(2, 0), "mailto:x@y.z").unwrap();
        wb.set_input(c(3, 0), "=HYPERLINK(A3)").unwrap();
        assert_eq!(
            wb.cell_link(c(0, 0)),
            Some(LinkTarget::Url {
                url: "https://a.b".into()
            })
        );
        assert_eq!(
            wb.cell_link(c(1, 0)),
            Some(LinkTarget::Location {
                location: "Sheet1!C3".into()
            })
        );
        assert!(matches!(
            wb.cell_link(c(3, 0)),
            Some(LinkTarget::Email { .. })
        ));
        assert_eq!(wb.cell_link(c(2, 0)), None);
        wb.set_hyperlink(s, link(0, 0, 1, 1)).unwrap();
        wb.set_hyperlink(s, link(1, 1, 2, 2)).unwrap();
        assert_eq!(wb.hyperlinks(s).len(), 1);
        let removed = wb.remove_hyperlinks(CellRange::new(s, 2, 2, 2, 2)).unwrap();
        assert_eq!(removed.len(), 1);
        let mail = LinkTarget::Email {
            address: "a@b.c".into(),
            subject: Some("Hi there & more".into()),
        };
        let url = mail.external_url().unwrap();
        assert_eq!(url, "mailto:a@b.c?subject=Hi%20there%20%26%20more");
        assert_eq!(LinkTarget::from_url(&url), mail);
        assert_eq!(initials_of("ann marie lee"), "AL");
        assert_eq!(initials_of(" bob "), "B");
        let g = guid("x");
        assert_eq!(g.len(), 38);
        assert_eq!(g, guid("x"));
        assert_ne!(g, guid("y"));
        assert_ne!(wb.fresh_comment_id("a"), "");
    }
}
