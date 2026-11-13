//! Canvas items (`"canvas"`, a movable list of maps) and ink strokes (`"ink"`, a list of maps). Schema and
//! accessors only; the UI comes with P11-N4.
use loro::{LoroMap, LoroValue};
use serde::{Deserialize, Serialize};

use crate::util::{as_map, get_f64, get_str, value};
use crate::{NotesError, PageDoc};

const CANVAS: &str = "canvas";
const INK: &str = "ink";

/// A freely positioned box on a canvas page (points, top-left origin).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct CanvasItem {
    pub id: String,
    /// `text` | `image` | `attachment`.
    pub kind: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    /// 0 = automatic height.
    pub h: f64,
    pub blob: Option<String>,
}

/// One ink stroke. `points` is flat `[x, y, pressure, …]`, quantised: x/y in 1/10 pt, pressure 0–255.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct InkStroke {
    pub id: String,
    /// `pen` | `highlighter`.
    pub tool: String,
    pub color: String,
    /// Width in 1/10 pt.
    pub width: u32,
    pub points: Vec<i32>,
}

impl PageDoc {
    #[must_use]
    pub fn canvas_items(&self) -> Vec<CanvasItem> {
        let list = self.doc().get_movable_list(CANVAS);
        (0..list.len())
            .filter_map(|i| as_map(list.get(i)))
            .map(|m| CanvasItem {
                id: get_str(&m, "id").unwrap_or_default(),
                kind: get_str(&m, "kind").unwrap_or_default(),
                x: get_f64(&m, "x").unwrap_or(0.0),
                y: get_f64(&m, "y").unwrap_or(0.0),
                w: get_f64(&m, "w").unwrap_or(0.0),
                h: get_f64(&m, "h").unwrap_or(0.0),
                blob: get_str(&m, "blob"),
            })
            .collect()
    }

    pub fn add_canvas_item(&self, item: &CanvasItem) -> Result<(), NotesError> {
        let list = self.doc().get_movable_list(CANVAS);
        let m = list.push_container(LoroMap::new())?;
        m.insert("id", item.id.as_str())?;
        m.insert("kind", item.kind.as_str())?;
        m.insert("x", item.x)?;
        m.insert("y", item.y)?;
        m.insert("w", item.w)?;
        m.insert("h", item.h)?;
        if let Some(b) = &item.blob {
            m.insert("blob", b.as_str())?;
        }
        self.doc().commit();
        Ok(())
    }

    fn canvas_map(&self, id: &str) -> Result<(usize, LoroMap), NotesError> {
        let list = self.doc().get_movable_list(CANVAS);
        (0..list.len())
            .find_map(|i| {
                as_map(list.get(i))
                    .filter(|m| get_str(m, "id").as_deref() == Some(id))
                    .map(|m| (i, m))
            })
            .ok_or_else(|| NotesError::UnknownItem(id.to_string()))
    }

    pub fn move_canvas_item(&self, id: &str, x: f64, y: f64) -> Result<(), NotesError> {
        let (_, m) = self.canvas_map(id)?;
        m.insert("x", x)?;
        m.insert("y", y)?;
        self.doc().commit();
        Ok(())
    }

    pub fn remove_canvas_item(&self, id: &str) -> Result<(), NotesError> {
        let (i, _) = self.canvas_map(id)?;
        self.doc().get_movable_list(CANVAS).delete(i, 1)?;
        self.doc().commit();
        Ok(())
    }

    #[must_use]
    pub fn ink_strokes(&self) -> Vec<InkStroke> {
        let list = self.doc().get_list(INK);
        (0..list.len())
            .filter_map(|i| as_map(list.get(i)))
            .map(|m| InkStroke {
                id: get_str(&m, "id").unwrap_or_default(),
                tool: get_str(&m, "tool").unwrap_or_default(),
                color: get_str(&m, "color").unwrap_or_default(),
                width: get_f64(&m, "width").map_or(0, |w| w as u32),
                points: match value(m.get("points")) {
                    Some(LoroValue::List(l)) => l
                        .iter()
                        .filter_map(|v| match v {
                            LoroValue::I64(i) => i32::try_from(*i).ok(),
                            _ => None,
                        })
                        .collect(),
                    _ => Vec::new(),
                },
            })
            .collect()
    }

    pub fn add_stroke(&self, s: &InkStroke) -> Result<(), NotesError> {
        let m = self.doc().get_list(INK).push_container(LoroMap::new())?;
        m.insert("id", s.id.as_str())?;
        m.insert("tool", s.tool.as_str())?;
        m.insert("color", s.color.as_str())?;
        m.insert("width", i64::from(s.width))?;
        m.insert(
            "points",
            s.points
                .iter()
                .map(|p| LoroValue::I64(i64::from(*p)))
                .collect::<Vec<_>>(),
        )?;
        self.doc().commit();
        Ok(())
    }

    pub fn remove_stroke(&self, id: &str) -> Result<(), NotesError> {
        let list = self.doc().get_list(INK);
        let i = (0..list.len())
            .find(|i| {
                as_map(list.get(*i)).is_some_and(|m| get_str(&m, "id").as_deref() == Some(id))
            })
            .ok_or_else(|| NotesError::UnknownItem(id.to_string()))?;
        list.delete(i, 1)?;
        self.doc().commit();
        Ok(())
    }
}
