//! Pure mapping rules from OneNote's stored values to the intermediate tree:
//! text runs, styles, lists, tags, colours, units, media types and ink.
//! Kept free of `onenote_parser`'s structs (which cannot be constructed
//! outside that crate) so every rule is unit-tested here; `convert.rs`
//! only adapts the parser's accessors to these inputs.

use onenote_parser::property::common::ColorRef;
use onenote_parser::property::note_tag::NoteTagShape;

use crate::model::{InkStroke, ListInfo, NumberFormat, Rgb, Run, TagKind};

/// Character formatting of one stored text run (or of the paragraph style).
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct RunStyle {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub sup: bool,
    pub sub: bool,
    pub font: Option<String>,
    /// Half points, as stored.
    pub size_half_pt: Option<u16>,
    pub color: Option<Rgb>,
    pub highlight: Option<Rgb>,
    /// Hidden text (the `HYPERLINK "…"` marker of a link).
    pub hidden: bool,
}

/// A hyperlink over the UTF-16 range `start..end` of the paragraph text.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct LinkRange {
    pub start: u32,
    pub end: u32,
    pub target: String,
}

/// Byte offset of UTF-16 offset `u` in `text`, clamped to the text and
/// rounded down to a character boundary.
pub(crate) fn utf16_to_byte(text: &str, u: u32) -> usize {
    let mut units = 0u32;
    for (byte, ch) in text.char_indices() {
        let next = units + ch.len_utf16() as u32;
        if next > u {
            return byte;
        }
        units = next;
    }
    text.len()
}

/// Splits `text` into runs: run `i` ends at UTF-16 offset `indices[i]` and
/// has formatting `styles[i]`; the last run reaches the end of the text.
/// Unset font, size and colours inherit from the paragraph style `base`.
/// Hidden runs (link markers) are dropped, links are attached, empty runs
/// dropped and equal neighbours merged.
pub(crate) fn build_runs(
    text: &str,
    indices: &[u32],
    styles: &[RunStyle],
    base: &RunStyle,
    links: &[LinkRange],
) -> Vec<Run> {
    let total = text.encode_utf16().count() as u32;
    let mut spans: Vec<(u32, u32, &RunStyle)> = Vec::new();
    if styles.is_empty() {
        spans.push((0, total, base));
    } else {
        let mut start = 0u32;
        for (i, style) in styles.iter().enumerate() {
            let end = if i + 1 == styles.len() {
                total
            } else {
                indices.get(i).copied().unwrap_or(total).clamp(start, total)
            };
            spans.push((start, end, style));
            start = end;
        }
    }
    let mut runs: Vec<Run> = Vec::new();
    for (start, end, style) in spans {
        if style.hidden || start >= end {
            continue;
        }
        let (a, b) = (utf16_to_byte(text, start), utf16_to_byte(text, end));
        if a >= b {
            continue;
        }
        let link = links
            .iter()
            .find(|l| l.start <= start && start < l.end)
            .map(|l| l.target.clone());
        let run = Run {
            text: text[a..b].to_owned(),
            bold: style.bold,
            italic: style.italic,
            underline: style.underline,
            strike: style.strike,
            sup: style.sup,
            sub: style.sub,
            font: style.font.clone().or_else(|| base.font.clone()),
            size_pt: style
                .size_half_pt
                .or(base.size_half_pt)
                .map(|h| f32::from(h) / 2.0),
            color: style.color.or(base.color),
            highlight: style.highlight.or(base.highlight),
            link,
        };
        match runs.last_mut() {
            Some(prev) if same_format(prev, &run) => prev.text.push_str(&run.text),
            _ => runs.push(run),
        }
    }
    runs
}

fn same_format(a: &Run, b: &Run) -> bool {
    Run {
        text: String::new(),
        ..a.clone()
    } == Run {
        text: String::new(),
        ..b.clone()
    }
}

/// OneNote's built-in paragraph style ids (`h1`, `PageTitle`, `cite`, …)
/// as our style names; `None` for normal text and unknown ids.
pub(crate) fn style_name(style_id: Option<&str>) -> Option<String> {
    let name = match style_id?.trim().to_ascii_lowercase().as_str() {
        "h1" => "heading1",
        "h2" => "heading2",
        "h3" => "heading3",
        "h4" => "heading4",
        "h5" => "heading5",
        "h6" => "heading6",
        "pagetitle" => "title",
        "cite" => "citation",
        "blockquote" => "quote",
        "code" => "code",
        _ => return None,
    };
    Some(name.to_owned())
}

/// List formatting from OneNote's list format string: numbered lists start
/// with U+FFFD followed by the number style code, bulleted lists hold the
/// bullet character.
pub(crate) fn list_info(format: &[char], restart: Option<i32>) -> ListInfo {
    if format.first() == Some(&'\u{fffd}') {
        let number_format = match format.get(1).map(|c| *c as u32) {
            Some(0) => NumberFormat::Decimal,
            Some(1) => NumberFormat::UpperRoman,
            Some(2) => NumberFormat::LowerRoman,
            Some(3) => NumberFormat::UpperLetter,
            Some(4) => NumberFormat::LowerLetter,
            _ => NumberFormat::Other,
        };
        ListInfo {
            ordered: true,
            bullet: None,
            number_format: Some(number_format),
            restart,
        }
    } else {
        let bullet: String = format.iter().filter(|c| !c.is_control()).collect();
        ListInfo {
            ordered: false,
            bullet: Some(if bullet.is_empty() {
                "\u{2022}".to_owned()
            } else {
                bullet
            }),
            number_format: None,
            restart,
        }
    }
}

/// Whether a tag shape is a check box (to-do style).
pub(crate) fn is_check_box(shape: NoteTagShape) -> bool {
    format!("{shape:?}").contains("CheckBox")
}

/// The kind of a note tag: by OneNote's English default label first, then
/// by its icon (labels are localised), else `Custom(label)`.
pub(crate) fn tag_kind(label: &str, shape: NoteTagShape) -> TagKind {
    let by_label = match label.trim().to_lowercase().as_str() {
        "to do" | "to-do" | "todo" => Some(TagKind::ToDo),
        "important" => Some(TagKind::Important),
        "question" => Some(TagKind::Question),
        "idea" => Some(TagKind::Idea),
        "critical" => Some(TagKind::Critical),
        "contact" => Some(TagKind::Contact),
        "address" => Some(TagKind::Address),
        "phone number" | "phone" => Some(TagKind::Phone),
        "remember for later" => Some(TagKind::Remember),
        "definition" => Some(TagKind::Definition),
        "highlight" => Some(TagKind::Highlight),
        _ => None,
    };
    if let Some(kind) = by_label {
        return kind;
    }
    use NoteTagShape as S;
    match shape {
        S::YellowStar => TagKind::Important,
        S::QuestionMark => TagKind::Question,
        S::LightBulb => TagKind::Idea,
        S::HighPriority => TagKind::Critical,
        S::ContactInformation | S::Contact => TagKind::Contact,
        S::Home => TagKind::Address,
        S::TelephoneWithClock | S::MobilePhone => TagKind::Phone,
        // Only the plain check boxes are "To Do"; the coloured variants with
        // stars/arrows/people are other built-in task tags.
        S::GreenCheckBox | S::YellowCheckBox | S::BlueCheckBox => TagKind::ToDo,
        _ => TagKind::Custom(label.trim().to_owned()),
    }
}

/// A stored colour reference; `Auto` is no explicit colour.
pub(crate) fn color_ref(c: Option<ColorRef>) -> Option<Rgb> {
    match c? {
        ColorRef::Auto => None,
        ColorRef::Manual { r, g, b } => Some(Rgb { r, g, b }),
    }
}

/// An ink COLORREF (`0x00BBGGRR`); black when unset.
pub(crate) fn ink_color(c: Option<u32>) -> Rgb {
    let [r, g, b, _] = c.unwrap_or(0).to_le_bytes();
    Rgb { r, g, b }
}

/// Layout values are stored in half-inch increments.
pub(crate) fn half_inch_to_pt(v: f32) -> f32 {
    v * 36.0
}

/// Ink units are 0.01 mm (HIMETRIC).
pub(crate) fn ink_to_pt(v: f32) -> f32 {
    v * 72.0 / 2540.0
}

/// Sub-page depth from OneNote's page level (1 = page, 2 = sub-page, …).
pub(crate) fn page_level(level: i32) -> u8 {
    (level.saturating_sub(1)).clamp(0, 2) as u8
}

/// A timestamp, `None` for the parser's 1970 fallback (invalid times).
pub(crate) fn unix_time(seconds: i64) -> Option<i64> {
    (seconds > 0).then_some(seconds)
}

/// The media type of an image from its stored extension, else its magic
/// bytes; `application/octet-stream` when neither is known.
pub(crate) fn image_mime(ext: Option<&str>, data: &[u8]) -> String {
    let by_ext = ext.map(|e| e.trim_start_matches('.').to_ascii_lowercase());
    let mime = match by_ext.as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg" | "jpe") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("tif" | "tiff") => "image/tiff",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("emf") => "image/emf",
        Some("wmf") => "image/wmf",
        _ => sniff_image(data),
    };
    mime.to_owned()
}

fn sniff_image(d: &[u8]) -> &'static str {
    if d.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if d.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if d.starts_with(b"GIF87a") || d.starts_with(b"GIF89a") {
        "image/gif"
    } else if d.starts_with(b"BM") {
        "image/bmp"
    } else if d.starts_with(b"II*\0") || d.starts_with(b"MM\0*") {
        "image/tiff"
    } else if d.len() >= 12 && &d[0..4] == b"RIFF" && &d[8..12] == b"WEBP" {
        "image/webp"
    } else if d.len() >= 44 && d[0..4] == [1, 0, 0, 0] && &d[40..44] == b" EMF" {
        "image/emf"
    } else if d.starts_with(&[0xD7, 0xCD, 0xC6, 0x9A]) {
        "image/wmf"
    } else {
        "application/octet-stream"
    }
}

/// One stored stroke: absolute points in ink units plus pen properties.
#[derive(Debug, Clone, Default)]
pub(crate) struct RawStroke {
    pub points: Vec<(f32, f32)>,
    /// Pen width in ink units.
    pub width: f32,
    pub color: Option<u32>,
    pub pen_tip: Option<u8>,
    pub transparency: Option<u8>,
}

/// The top-left and bottom-right corner of all finite stroke points, `None`
/// when there are none.
pub(crate) fn ink_extent(raw: &[RawStroke]) -> Option<((f32, f32), (f32, f32))> {
    let mut it = raw
        .iter()
        .flat_map(|s| s.points.iter().copied())
        .filter(|(x, y)| x.is_finite() && y.is_finite());
    let first = it.next()?;
    Some(it.fold((first, first), |(lo, hi), (x, y)| {
        ((lo.0.min(x), lo.1.min(y)), (hi.0.max(x), hi.1.max(y)))
    }))
}

/// Strokes in points relative to `origin` (ink units, usually the drawing's
/// bounding-box corner). A highlighter is a translucent pen or one with the
/// rectangular tip (pen tip 1).
pub(crate) fn ink_strokes(raw: &[RawStroke], origin: (f32, f32)) -> Vec<InkStroke> {
    raw.iter()
        .filter(|s| !s.points.is_empty())
        .map(|s| InkStroke {
            points: s
                .points
                .iter()
                .map(|&(x, y)| (ink_to_pt(x - origin.0), ink_to_pt(y - origin.1), None))
                .collect(),
            color: ink_color(s.color),
            width_pt: ink_to_pt(s.width).max(0.25),
            highlighter: s.transparency.is_some_and(|t| t > 0) || s.pen_tip == Some(1),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plain() -> RunStyle {
        RunStyle::default()
    }

    #[test]
    fn utf16_offsets_map_to_char_boundaries() {
        let t = "a😀b"; // 😀 is two UTF-16 units, four bytes
        assert_eq!(utf16_to_byte(t, 0), 0);
        assert_eq!(utf16_to_byte(t, 1), 1);
        assert_eq!(
            utf16_to_byte(t, 2),
            1,
            "inside the surrogate pair rounds down"
        );
        assert_eq!(utf16_to_byte(t, 3), 5);
        assert_eq!(utf16_to_byte(t, 99), 6);
    }

    #[test]
    fn no_run_styles_gives_one_run_with_the_paragraph_style() {
        let base = RunStyle {
            font: Some("Calibri".into()),
            size_half_pt: Some(22),
            ..plain()
        };
        let runs = build_runs("Hello", &[], &[], &base, &[]);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].text, "Hello");
        assert_eq!(runs[0].font.as_deref(), Some("Calibri"));
        assert_eq!(runs[0].size_pt, Some(11.0));
    }

    #[test]
    fn runs_split_at_utf16_indices_and_inherit_unset_values() {
        let base = RunStyle {
            font: Some("Calibri".into()),
            size_half_pt: Some(22),
            ..plain()
        };
        let bold = RunStyle {
            bold: true,
            size_half_pt: Some(28),
            ..plain()
        };
        let runs = build_runs("ab😀cd", &[2, 4], &[plain(), bold, plain()], &base, &[]);
        let texts: Vec<_> = runs.iter().map(|r| r.text.as_str()).collect();
        assert_eq!(texts, ["ab", "😀", "cd"]);
        assert!(runs[1].bold);
        assert_eq!(runs[1].size_pt, Some(14.0));
        assert_eq!(runs[1].font.as_deref(), Some("Calibri"));
        assert_eq!(runs[2].size_pt, Some(11.0));
    }

    #[test]
    fn last_run_reaches_the_end_and_bad_indices_are_clamped() {
        // Fewer indices than styles, an index past the end, decreasing indices.
        let runs = build_runs(
            "abcdef",
            &[10, 2],
            &[plain(), plain(), plain()],
            &plain(),
            &[],
        );
        assert_eq!(
            runs.iter().map(|r| r.text.as_str()).collect::<String>(),
            "abcdef"
        );
        let runs = build_runs("abcdef", &[2], &[plain(), plain()], &plain(), &[]);
        assert_eq!(runs.len(), 1, "equal neighbours merge");
        assert_eq!(runs[0].text, "abcdef");
    }

    #[test]
    fn hidden_link_markers_are_dropped_and_links_attached() {
        let text = "See \u{fddf}HYPERLINK \"https://example.org\"here now";
        let marker_end = "See \u{fddf}HYPERLINK \"https://example.org\""
            .encode_utf16()
            .count() as u32;
        let hidden = RunStyle {
            hidden: true,
            ..plain()
        };
        let linked = RunStyle {
            underline: true,
            ..plain()
        };
        let links = [LinkRange {
            start: marker_end,
            end: marker_end + 4,
            target: "https://example.org".into(),
        }];
        let runs = build_runs(
            text,
            &[4, marker_end, marker_end + 4],
            &[plain(), hidden, linked, plain()],
            &plain(),
            &links,
        );
        let texts: Vec<_> = runs.iter().map(|r| r.text.as_str()).collect();
        assert_eq!(texts, ["See ", "here", " now"]);
        assert_eq!(runs[1].link.as_deref(), Some("https://example.org"));
        assert!(runs[1].underline);
        assert_eq!(runs[0].link, None);
        assert_eq!(runs[2].link, None);
    }

    #[test]
    fn empty_text_gives_no_runs() {
        assert!(build_runs("", &[], &[], &plain(), &[]).is_empty());
    }

    #[test]
    fn built_in_styles_map_to_names() {
        assert_eq!(style_name(Some("h1")).as_deref(), Some("heading1"));
        assert_eq!(style_name(Some("h6")).as_deref(), Some("heading6"));
        assert_eq!(style_name(Some("PageTitle")).as_deref(), Some("title"));
        assert_eq!(style_name(Some("cite")).as_deref(), Some("citation"));
        assert_eq!(style_name(Some("blockquote")).as_deref(), Some("quote"));
        assert_eq!(style_name(Some("code")).as_deref(), Some("code"));
        assert_eq!(style_name(Some("p")), None);
        assert_eq!(style_name(Some("whatever")), None);
        assert_eq!(style_name(None), None);
    }

    #[test]
    fn list_formats() {
        let num = list_info(&['\u{fffd}', '\u{0}', '.'], Some(3));
        assert!(num.ordered);
        assert_eq!(num.number_format, Some(NumberFormat::Decimal));
        assert_eq!(num.restart, Some(3));
        assert_eq!(
            list_info(&['\u{fffd}', '\u{4}', ')'], None).number_format,
            Some(NumberFormat::LowerLetter)
        );
        assert_eq!(
            list_info(&['\u{fffd}', '\u{17}'], None).number_format,
            Some(NumberFormat::Other)
        );
        let bullet = list_info(&['\u{2022}'], None);
        assert!(!bullet.ordered);
        assert_eq!(bullet.bullet.as_deref(), Some("\u{2022}"));
        assert_eq!(list_info(&[], None).bullet.as_deref(), Some("\u{2022}"));
    }

    #[test]
    fn tags_by_label_then_icon() {
        assert_eq!(
            tag_kind("To Do", NoteTagShape::GreenCheckBox),
            TagKind::ToDo
        );
        assert_eq!(
            tag_kind("Important", NoteTagShape::NoIcon),
            TagKind::Important
        );
        assert_eq!(
            tag_kind("Remember for later", NoteTagShape::NoIcon),
            TagKind::Remember
        );
        assert_eq!(
            tag_kind("Phone number", NoteTagShape::NoIcon),
            TagKind::Phone
        );
        // German labels fall back to the icon.
        assert_eq!(
            tag_kind("Aufgabe", NoteTagShape::BlueCheckBox),
            TagKind::ToDo
        );
        assert_eq!(
            tag_kind("Wichtig", NoteTagShape::YellowStar),
            TagKind::Important
        );
        assert_eq!(
            tag_kind("Frage", NoteTagShape::QuestionMark),
            TagKind::Question
        );
        assert_eq!(tag_kind("Idee", NoteTagShape::LightBulb), TagKind::Idea);
        assert_eq!(
            tag_kind(" Projekt A ", NoteTagShape::BlueStar),
            TagKind::Custom("Projekt A".into())
        );
        assert!(is_check_box(NoteTagShape::GreenStarCheckBox));
        assert!(!is_check_box(NoteTagShape::YellowStar));
    }

    #[test]
    fn colours_and_units() {
        assert_eq!(color_ref(Some(ColorRef::Auto)), None);
        assert_eq!(color_ref(None), None);
        assert_eq!(
            color_ref(Some(ColorRef::Manual { r: 1, g: 2, b: 3 })),
            Some(Rgb { r: 1, g: 2, b: 3 })
        );
        assert_eq!(
            ink_color(Some(0x00FF8040)),
            Rgb {
                r: 0x40,
                g: 0x80,
                b: 0xFF
            }
        );
        assert_eq!(ink_color(None), Rgb { r: 0, g: 0, b: 0 });
        assert_eq!(half_inch_to_pt(1.0), 36.0);
        assert!((ink_to_pt(2540.0) - 72.0).abs() < 1e-4);
        assert_eq!(page_level(1), 0);
        assert_eq!(page_level(2), 1);
        assert_eq!(page_level(3), 2);
        assert_eq!(page_level(0), 0);
        assert_eq!(page_level(-5), 0);
        assert_eq!(page_level(99), 2);
        assert_eq!(unix_time(0), None);
        assert_eq!(unix_time(1_700_000_000), Some(1_700_000_000));
    }

    #[test]
    fn image_media_types() {
        assert_eq!(image_mime(Some(".PNG"), b""), "image/png");
        assert_eq!(image_mime(Some("jpg"), b""), "image/jpeg");
        assert_eq!(image_mime(None, b"\x89PNG\r\n\x1a\nrest"), "image/png");
        assert_eq!(
            image_mime(Some(".xyz"), &[0xFF, 0xD8, 0xFF, 0xE0]),
            "image/jpeg"
        );
        assert_eq!(image_mime(None, b"GIF89a.."), "image/gif");
        assert_eq!(image_mime(None, b"nothing"), "application/octet-stream");
    }

    #[test]
    fn ink_extent_spans_all_finite_points() {
        let raw = [
            RawStroke {
                points: vec![(10.0, 50.0), (30.0, 20.0)],
                ..Default::default()
            },
            RawStroke {
                points: vec![(f32::NAN, 0.0), (-5.0, 60.0)],
                ..Default::default()
            },
        ];
        assert_eq!(ink_extent(&raw), Some(((-5.0, 20.0), (30.0, 60.0))));
        assert_eq!(ink_extent(&[]), None);
        assert_eq!(ink_extent(&[RawStroke::default()]), None);
    }

    #[test]
    fn ink_points_become_points_relative_to_the_origin() {
        let raw = [
            RawStroke {
                points: vec![(1000.0, 2000.0), (3540.0, 2000.0)],
                width: 52.9,
                color: Some(0x000000FF),
                pen_tip: Some(0),
                transparency: None,
            },
            RawStroke {
                points: vec![],
                ..Default::default()
            },
            RawStroke {
                points: vec![(1000.0, 1000.0)],
                width: 0.0,
                color: None,
                pen_tip: Some(1),
                transparency: Some(128),
            },
        ];
        let s = ink_strokes(&raw, (1000.0, 1000.0));
        assert_eq!(s.len(), 2, "empty strokes are dropped");
        assert_eq!(s[0].points[0].0, 0.0);
        assert!((s[0].points[0].1 - 1000.0 * 72.0 / 2540.0).abs() < 1e-3);
        assert!((s[0].points[1].0 - 72.0).abs() < 1e-3);
        assert_eq!(s[0].color, Rgb { r: 255, g: 0, b: 0 });
        assert!((s[0].width_pt - 1.5).abs() < 0.01);
        assert!(!s[0].highlighter);
        assert!(s[1].highlighter);
        assert_eq!(s[1].width_pt, 0.25, "minimum width");
        assert_eq!(s[1].points[0].2, None);
    }
}
