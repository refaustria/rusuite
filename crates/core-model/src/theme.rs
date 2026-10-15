//! The document theme: color scheme plus font scheme.

use serde::{Deserialize, Serialize};

use crate::color::ColorScheme;
use crate::font::FontScheme;

/// A document theme (DrawingML `a:theme`, reduced to colors and fonts).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    /// Theme name, e.g. `"Office"`.
    pub name: String,
    /// The theme's color scheme.
    pub colors: ColorScheme,
    /// The theme's font scheme.
    pub fonts: FontScheme,
}

impl Default for Theme {
    /// The default Office theme (Office 2013–2022 colors, Calibri fonts).
    fn default() -> Self {
        Self {
            name: "Office".to_owned(),
            colors: ColorScheme::default(),
            fonts: FontScheme::default(),
        }
    }
}
