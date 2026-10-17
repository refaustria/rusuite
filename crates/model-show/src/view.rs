//! Per-presentation view and slide-show settings: drawing guides, grid,
//! snapping, ruler and the last view (`ppt/viewProps.xml`) and the Set Up
//! Slide Show options (`ppt/presProps.xml` `p:showPr`).

use core_model::units::Emu;
use serde::{Deserialize, Serialize};

/// Orientation of a drawing guide.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum GuideOrient {
    /// A vertical line at x = `pos` (`p:guide` without `orient`).
    #[default]
    Vertical,
    /// A horizontal line at y = `pos` (`orient="horz"`).
    Horizontal,
}

/// A drawing guide (`p:guideLst/p:guide`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Guide {
    /// Vertical or horizontal.
    pub orient: GuideOrient,
    /// Position from the slide's left (vertical) or top (horizontal) edge.
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub pos: Emu,
    /// Colour as `RRGGBB` (`None` = PowerPoint's grey).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub color: Option<String>,
}

/// The view the presentation was last shown in (`p:viewPr/@lastView`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum ViewKind {
    /// Normal (`sldView`).
    #[default]
    Normal,
    /// Outline View (`outlineView`).
    Outline,
    /// Slide Sorter (`sldSorterView`).
    SlideSorter,
    /// Notes Page (`notesView`).
    NotesPage,
    /// Reading View (no own `lastView` value; written as `sldView`).
    Reading,
}

/// View settings stored with the presentation.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct ViewProps {
    /// Drawing guides.
    pub guides: Vec<Guide>,
    /// Grid spacing (`p:gridSpacing/@cx`; both axes use it).
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub grid_spacing: Emu,
    /// Snap objects to the grid (`p:cSldViewPr/@snapToGrid`).
    pub snap_to_grid: bool,
    /// Smart guides: snap to other shapes while dragging (`snapToObjects`).
    pub snap_to_shapes: bool,
    /// Display the grid on screen.
    pub show_grid: bool,
    /// Display the drawing guides (`p:cSldViewPr/@showGuides`).
    pub show_guides: bool,
    /// Display the rulers.
    pub show_ruler: bool,
    /// The last view.
    pub last_view: ViewKind,
}

impl ViewProps {
    /// PowerPoint's default grid spacing, 1/12".
    pub const DEFAULT_GRID: Emu = Emu(76_200);

    /// Checks the settings: grid spacing 0.05 cm … 5 cm, guides on the
    /// pasteboard range (± 4 slide sizes), colours `RRGGBB`.
    pub fn validate(&self) -> Result<(), String> {
        if !(18_000..=1_800_000).contains(&self.grid_spacing.0) {
            return Err(format!(
                "grid spacing {} EMU out of range",
                self.grid_spacing.0
            ));
        }
        for g in &self.guides {
            if g.pos.0.abs() > 60_000_000 {
                return Err(format!("guide position {} out of range", g.pos.0));
            }
            if let Some(c) = &g.color {
                if !is_rrggbb(c) {
                    return Err(format!("guide colour {c:?} is not RRGGBB"));
                }
            }
        }
        Ok(())
    }

    /// The two centre guides PowerPoint shows when guides are turned on
    /// without any.
    pub fn centre_guides(width: Emu, height: Emu) -> Vec<Guide> {
        vec![
            Guide {
                orient: GuideOrient::Vertical,
                pos: Emu(width.0 / 2),
                color: None,
            },
            Guide {
                orient: GuideOrient::Horizontal,
                pos: Emu(height.0 / 2),
                color: None,
            },
        ]
    }
}

impl Default for ViewProps {
    fn default() -> Self {
        Self {
            guides: Vec::new(),
            grid_spacing: Self::DEFAULT_GRID,
            snap_to_grid: false,
            snap_to_shapes: true,
            show_grid: false,
            show_guides: false,
            show_ruler: false,
            last_view: ViewKind::Normal,
        }
    }
}

/// Slides a show runs through (`p:sldRg`, 1-based, inclusive).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct SlideRange {
    /// First slide (1-based).
    pub start: u32,
    /// Last slide (1-based, ≥ `start`).
    pub end: u32,
}

/// Show type of Set Up Slide Show (`p:showPr` `p:present` / `p:browse` /
/// `p:kiosk`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum ShowType {
    /// Presented by a speaker, full screen (`p:present`).
    #[default]
    Speaker,
    /// Browsed by an individual, in a window (`p:browse`).
    Window,
    /// Browsed at a kiosk, full screen, looping (`p:kiosk`).
    Kiosk,
}

/// Set Up Slide Show (`p:presentationPr/p:showPr`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct ShowSettings {
    /// Loop continuously until Esc (`loop`).
    #[serde(rename = "loop")]
    #[cfg_attr(feature = "ts", ts(rename = "loop"))]
    pub loop_show: bool,
    /// Show without narration (`showNarration="0"`).
    pub without_narration: bool,
    /// Show without animation (`showAnimation="0"`).
    pub without_animation: bool,
    /// From slide … to … (`None` = all slides).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub range: Option<SlideRange>,
    /// Advance slides using timings, if present (`useTimings`); `false` =
    /// manually.
    pub use_timings: bool,
    /// Presented by a speaker, browsed in a window or at a kiosk.
    #[serde(skip_serializing_if = "is_speaker")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<ShowType>"))]
    pub show_type: ShowType,
    /// Browsed in a window: show the scroll bar (`p:browse/@showScrollbar`).
    pub show_scrollbar: bool,
    /// The custom show to run (`p:custShow/@id`; `None` = the slides or
    /// the range). Takes precedence over `range`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub custom_show: Option<u32>,
    /// Pen colour as `RRGGBB` (`p:penClr`; `None` = PowerPoint's red).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional))]
    pub pen_color: Option<String>,
}

fn is_speaker(t: &ShowType) -> bool {
    *t == ShowType::Speaker
}

impl Default for ShowSettings {
    fn default() -> Self {
        Self {
            loop_show: false,
            without_narration: false,
            without_animation: false,
            range: None,
            use_timings: true,
            show_type: ShowType::Speaker,
            show_scrollbar: true,
            custom_show: None,
            pen_color: None,
        }
    }
}

impl ShowSettings {
    /// PowerPoint's default pen colour.
    pub const DEFAULT_PEN: &'static str = "FF0000";

    /// Checks the range (1-based, `start <= end`) and the pen colour
    /// (`RRGGBB`).
    pub fn validate(&self) -> Result<(), String> {
        if let Some(r) = self.range {
            if r.start == 0 || r.end < r.start {
                return Err(format!("slide range {}–{} is invalid", r.start, r.end));
            }
        }
        if let Some(c) = &self.pen_color {
            if !is_rrggbb(c) {
                return Err(format!("pen colour {c:?} is not RRGGBB"));
            }
        }
        Ok(())
    }
}

/// Whether `s` is a colour as `RRGGBB`.
pub fn is_rrggbb(s: &str) -> bool {
    s.len() == 6 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// A custom show (`p:custShowLst/p:custShow`): a named list of slides,
/// in its own order (a slide may appear more than once).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct CustomShow {
    /// `@id`, unique in the presentation (links and Set Up Slide Show
    /// refer to it).
    pub id: u32,
    /// `@name`, unique and not empty.
    pub name: String,
    /// The slides in show order.
    #[serde(default)]
    pub slide_ids: Vec<crate::NodeId>,
}

/// Checks custom shows: unique ids, unique non-empty names, known slides.
pub fn validate_custom_shows(
    shows: &[CustomShow],
    slide_exists: impl Fn(crate::NodeId) -> bool,
) -> Result<(), String> {
    let mut ids = std::collections::HashSet::new();
    let mut names = std::collections::HashSet::new();
    for s in shows {
        if !ids.insert(s.id) {
            return Err(format!("custom show id {} is used twice", s.id));
        }
        let name = s.name.trim();
        if name.is_empty() {
            return Err("a custom show needs a name".into());
        }
        if !names.insert(name.to_lowercase()) {
            return Err(format!("custom show name {name:?} is used twice"));
        }
        if let Some(id) = s.slide_ids.iter().find(|id| !slide_exists(**id)) {
            return Err(format!("custom show {name:?}: unknown slide {}", id.0));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_validation() {
        let v = ViewProps::default();
        assert!(v.validate().is_ok());
        assert!(v.snap_to_shapes && !v.snap_to_grid);
        let bad = ViewProps {
            grid_spacing: Emu(5),
            ..ViewProps::default()
        };
        assert!(bad.validate().is_err());
        let colour = ViewProps {
            guides: vec![Guide {
                orient: GuideOrient::Horizontal,
                pos: Emu(10),
                color: Some("red".into()),
            }],
            ..ViewProps::default()
        };
        assert!(colour.validate().is_err());
        let c = ViewProps::centre_guides(Emu(100), Emu(50));
        assert_eq!(c[0].pos, Emu(50));
        assert_eq!(c[1].orient, GuideOrient::Horizontal);
        assert_eq!(c[1].pos, Emu(25));
    }

    #[test]
    fn show_settings_json_and_range() {
        let s = ShowSettings {
            loop_show: true,
            range: Some(SlideRange { start: 2, end: 3 }),
            ..ShowSettings::default()
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("\"loop\":true"), "{json}");
        let back: ShowSettings = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
        assert!(ShowSettings::default().use_timings);
        let bad = ShowSettings {
            range: Some(SlideRange { start: 3, end: 2 }),
            ..ShowSettings::default()
        };
        assert!(bad.validate().is_err());
        let pen = ShowSettings {
            pen_color: Some("blue".into()),
            ..ShowSettings::default()
        };
        assert!(pen.validate().is_err());
        // defaults are not written
        assert!(!serde_json::to_string(&ShowSettings::default())
            .unwrap()
            .contains("showType"));
    }

    #[test]
    fn custom_shows_validate() {
        use crate::NodeId;
        let show = |id, name: &str, slides: &[u64]| CustomShow {
            id,
            name: name.into(),
            slide_ids: slides.iter().map(|n| NodeId(*n)).collect(),
        };
        let known = |id: NodeId| id.0 < 10;
        assert!(
            validate_custom_shows(&[show(0, "A", &[1, 2, 1]), show(1, "B", &[])], known).is_ok()
        );
        assert!(validate_custom_shows(&[show(0, "A", &[]), show(0, "B", &[])], known).is_err());
        assert!(validate_custom_shows(&[show(0, "A", &[]), show(1, " a ", &[])], known).is_err());
        assert!(validate_custom_shows(&[show(0, " ", &[])], known).is_err());
        assert!(validate_custom_shows(&[show(0, "A", &[12])], known).is_err());
    }
}
