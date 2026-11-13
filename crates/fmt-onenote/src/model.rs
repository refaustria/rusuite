//! The intermediate tree: a plain, serde-serialisable picture of a OneNote
//! notebook, independent of `onenote_parser`'s types (P11-N6 maps it onto
//! `model-notes`).
//!
//! Units: positions, sizes and widths are in points (1/72 inch), relative to
//! the page origin; times are Unix seconds (UTC).

use serde::{Deserialize, Serialize};

use crate::ImportWarning;

/// A read result together with the reader's warnings about dropped or
/// approximated content.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Imported<T> {
    /// The imported value.
    pub value: T,
    /// What was dropped or approximated, repeats merged.
    pub warnings: Vec<ImportWarning>,
}

/// A notebook (from a `.onepkg` package).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OneNotebook {
    /// The notebook's name (the package's file name without extension).
    pub name: String,
    /// The notebook colour, when stored.
    pub color: Option<Rgb>,
    /// Sections and section groups in OneNote's order.
    pub items: Vec<NotebookItem>,
}

/// An entry of a notebook or section group.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NotebookItem {
    /// A section.
    Section(OneSection),
    /// A section group with its own sections and groups.
    Group {
        /// The group's name.
        name: String,
        /// Its sections and groups in order.
        items: Vec<NotebookItem>,
    },
}

/// A section (one `.one` file).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OneSection {
    /// The section's display name.
    pub name: String,
    /// The section tab colour, when stored.
    pub color: Option<Rgb>,
    /// The pages in order; sub-pages follow their parent with a higher
    /// [`OnePage::level`].
    pub pages: Vec<OnePage>,
}

/// A page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OnePage {
    /// The page title (plain text; empty for an untitled page).
    pub title: String,
    /// Sub-page depth: 0 for a page, 1 for a sub-page, 2 for a sub-sub-page.
    pub level: u8,
    /// Creation time (Unix seconds, UTC).
    pub created: Option<i64>,
    /// Last modification time (Unix seconds, UTC).
    pub modified: Option<i64>,
    /// The page's content in OneNote's order (not sorted by position).
    pub contents: Vec<PageItem>,
}

/// A rectangle on the page in points; `x`/`y` is the top-left corner
/// relative to the page origin. The size is only known for some objects.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    /// Distance from the left page edge.
    pub x: f32,
    /// Distance from the top page edge.
    pub y: f32,
    /// Width, when OneNote stores one.
    pub width: Option<f32>,
    /// Height, when OneNote stores one.
    pub height: Option<f32>,
}

/// An object placed on the page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PageItem {
    /// A text container ("outline") with its blocks.
    Outline {
        /// Position and size.
        pos: Option<Rect>,
        /// Paragraphs, tables, images and attachments in order.
        blocks: Vec<Block>,
    },
    /// A picture placed directly on the page.
    Image {
        /// Position and size.
        pos: Option<Rect>,
        /// The image file's bytes.
        data: Vec<u8>,
        /// Its media type, e.g. `image/png`.
        mime: String,
        /// Alternative text.
        alt: Option<String>,
    },
    /// A file attached to the page.
    Attachment {
        /// Position of the file icon.
        pos: Option<Rect>,
        /// The original file name.
        file_name: String,
        /// The file's bytes.
        data: Vec<u8>,
    },
    /// Drawing (ink) strokes. Stroke points are relative to `pos`'s corner;
    /// `pos` is `None` for ink that sat inside an outline (it is lifted out).
    Ink {
        /// Position and size of the drawing.
        pos: Option<Rect>,
        /// The strokes in drawing order.
        strokes: Vec<InkStroke>,
    },
}

/// A block inside an outline or a table cell.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Block {
    /// A paragraph of formatted text.
    Paragraph {
        /// The text runs (hidden hyperlink markers removed).
        runs: Vec<Run>,
        /// Bullet or numbering, when the paragraph is a list item.
        list: Option<ListInfo>,
        /// Note tags (to-do, important, …).
        tags: Vec<Tag>,
        /// Indentation level in the outline (0 = top).
        level: u8,
        /// The built-in paragraph style: `heading1`–`heading6`, `title`,
        /// `citation`, `quote` or `code`; `None` for normal text.
        style: Option<String>,
    },
    /// A table; `rows[r][c]` are the blocks of a cell.
    Table {
        /// Rows of cells of blocks.
        rows: Vec<Vec<Vec<Block>>>,
    },
    /// A picture inside the text flow.
    Image {
        /// The image file's bytes.
        data: Vec<u8>,
        /// Its media type.
        mime: String,
        /// Alternative text.
        alt: Option<String>,
        /// Display width in points, when stored.
        width: Option<f32>,
        /// Display height in points, when stored.
        height: Option<f32>,
    },
    /// A file attached inside the text flow.
    Attachment {
        /// The original file name.
        file_name: String,
        /// The file's bytes.
        data: Vec<u8>,
    },
}

/// A run of uniformly formatted text.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Run {
    /// The text.
    pub text: String,
    /// Bold.
    pub bold: bool,
    /// Italic.
    pub italic: bool,
    /// Underlined.
    pub underline: bool,
    /// Struck through.
    pub strike: bool,
    /// Superscript.
    pub sup: bool,
    /// Subscript.
    pub sub: bool,
    /// Font family.
    pub font: Option<String>,
    /// Font size in points.
    pub size_pt: Option<f32>,
    /// Text colour (`None` = automatic).
    pub color: Option<Rgb>,
    /// Highlight (background) colour.
    pub highlight: Option<Rgb>,
    /// Hyperlink target exactly as stored (web URL or `onenote:` link).
    pub link: Option<String>,
}

/// List formatting of a paragraph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ListInfo {
    /// Numbered (`true`) or bulleted.
    pub ordered: bool,
    /// The bullet character of a bulleted list.
    pub bullet: Option<String>,
    /// The number style of a numbered list.
    pub number_format: Option<NumberFormat>,
    /// The number the list restarts at, when set.
    pub restart: Option<i32>,
}

/// Number styles of numbered lists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NumberFormat {
    /// 1, 2, 3
    Decimal,
    /// I, II, III
    UpperRoman,
    /// i, ii, iii
    LowerRoman,
    /// A, B, C
    UpperLetter,
    /// a, b, c
    LowerLetter,
    /// Any other style OneNote offers (shown as decimal).
    Other,
}

/// A note tag on a paragraph.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tag {
    /// The kind (built-in OneNote tags; others are `Custom`).
    pub kind: TagKind,
    /// The tag's label as shown in OneNote (may be localised).
    pub label: String,
    /// For check-box tags: whether it is ticked.
    pub checked: Option<bool>,
}

/// Kinds of note tags.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TagKind {
    /// To Do (check box).
    ToDo,
    /// Important (star).
    Important,
    /// Question.
    Question,
    /// Idea (light bulb).
    Idea,
    /// Critical.
    Critical,
    /// Contact.
    Contact,
    /// Address.
    Address,
    /// Phone number.
    Phone,
    /// Remember for later.
    Remember,
    /// Definition.
    Definition,
    /// Highlight.
    Highlight,
    /// Any other tag, with its label.
    Custom(String),
}

/// One ink stroke.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InkStroke {
    /// Points `(x, y, pressure)` in points, relative to the drawing's corner.
    /// Pressure is not exposed by the parser and always `None` for now.
    pub points: Vec<(f32, f32, Option<f32>)>,
    /// The pen colour.
    pub color: Rgb,
    /// The pen width in points.
    pub width_pt: f32,
    /// Drawn with a highlighter (translucent, rectangular tip).
    pub highlighter: bool,
}

/// An sRGB colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rgb {
    /// Red.
    pub r: u8,
    /// Green.
    pub g: u8,
    /// Blue.
    pub b: u8,
}
