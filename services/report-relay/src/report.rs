//! The report the apps send (`POST /api/report`) and its validation. Unknown fields are refused, so nothing but
//! what the dialog showed (text, chosen screenshots, the diagnostics preview) can travel – never document content.

use base64::Engine as _;
use serde::{Deserialize, Serialize};

pub const TITLE_MAX: usize = 120;
pub const DESCRIPTION_MIN: usize = 20;
pub const DESCRIPTION_MAX: usize = 4000;
pub const STEPS_MAX: usize = 4000;
pub const SCREENSHOTS_MAX: usize = 3;
pub const SCREENSHOT_BYTES_MAX: usize = 2 * 1024 * 1024;
pub const SCREENSHOTS_TOTAL_MAX: usize = 5 * 1024 * 1024;
/// The request body limit (base64 inflates the 5 MB of images by a third).
pub const BODY_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum App {
    Calc,
    Write,
    Show,
}

impl App {
    pub fn as_str(self) -> &'static str {
        match self {
            App::Calc => "calc",
            App::Write => "write",
            App::Show => "show",
        }
    }
    pub fn display(self) -> &'static str {
        match self {
            App::Calc => "Rusuite Calc",
            App::Write => "Rusuite Write",
            App::Show => "Rusuite Show",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Web,
    Desktop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Bug,
    Feature,
    Question,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Bug => "bug",
            Kind::Feature => "feature",
            Kind::Question => "question",
        }
    }
    pub fn display(self) -> &'static str {
        match self {
            Kind::Bug => "Bug",
            Kind::Feature => "Feature request",
            Kind::Question => "Question",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Viewport {
    pub width: u32,
    pub height: u32,
}

/// Counts only (Write: blocks, Calc: cells, Show: slides).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DocStats {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocks: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cells: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slides: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Diagnostics {
    #[serde(default)]
    pub user_agent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewport: Option<Viewport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub doc_stats: Option<DocStats>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Screenshot {
    pub name: String,
    pub mime: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Report {
    pub app: App,
    pub app_version: String,
    pub platform: Platform,
    pub os: String,
    pub locale: String,
    pub instance_id: String,
    pub kind: Kind,
    pub title: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steps: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<Diagnostics>,
    #[serde(default)]
    pub screenshots: Vec<Screenshot>,
}

/// A decoded, checked screenshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image {
    pub name: String,
    pub ext: &'static str,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ReportError {
    #[error("invalid JSON: {0}")]
    Json(String),
    #[error("{field}: {message}")]
    Field {
        field: &'static str,
        message: String,
    },
    /// Images over the size limits (→ 413).
    #[error("{0}")]
    TooLarge(String),
}

fn field(field: &'static str, message: impl Into<String>) -> ReportError {
    ReportError::Field {
        field,
        message: message.into(),
    }
}

fn chars(s: &str) -> usize {
    s.chars().count()
}

/// A single-line text of at most `max` characters without control characters.
fn line(name: &'static str, s: &str, max: usize, required: bool) -> Result<(), ReportError> {
    if required && s.trim().is_empty() {
        return Err(field(name, "required"));
    }
    if chars(s) > max {
        return Err(field(name, format!("at most {max} characters")));
    }
    if s.chars().any(char::is_control) {
        return Err(field(name, "control characters are not allowed"));
    }
    Ok(())
}

/// Multi-line text: newlines and tabs allowed, other control characters not.
fn text(name: &'static str, s: &str, min: usize, max: usize) -> Result<(), ReportError> {
    let n = chars(s.trim());
    if n < min {
        return Err(field(name, format!("at least {min} characters")));
    }
    if chars(s) > max {
        return Err(field(name, format!("at most {max} characters")));
    }
    if s.chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(field(name, "control characters are not allowed"));
    }
    Ok(())
}

/// A version 4 UUID in its hyphenated form (generated once per installation, never derived from hardware).
pub fn valid_instance_id(id: &str) -> bool {
    id.len() == 36 && uuid::Uuid::try_parse(id).is_ok_and(|u| u.get_version_num() == 4)
}

fn sniff(mime: &str, bytes: &[u8]) -> Option<&'static str> {
    match mime {
        "image/png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => Some("png"),
        "image/jpeg" if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) => Some("jpg"),
        _ => None,
    }
}

impl Report {
    /// Parses and validates a request body.
    pub fn parse(body: &[u8]) -> Result<(Report, Vec<Image>), ReportError> {
        let report: Report =
            serde_json::from_slice(body).map_err(|e| ReportError::Json(e.to_string()))?;
        let images = report.validate()?;
        Ok((report, images))
    }

    /// Checks every field; returns the decoded screenshots.
    pub fn validate(&self) -> Result<Vec<Image>, ReportError> {
        line("appVersion", &self.app_version, 40, true)?;
        line("os", &self.os, 80, true)?;
        if self.locale.is_empty()
            || self.locale.len() > 20
            || !self
                .locale
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(field("locale", "expected a language tag"));
        }
        if !valid_instance_id(&self.instance_id) {
            return Err(field("instanceId", "expected a version 4 UUID"));
        }
        line("title", &self.title, TITLE_MAX, true)?;
        text(
            "description",
            &self.description,
            DESCRIPTION_MIN,
            DESCRIPTION_MAX,
        )?;
        if let Some(steps) = &self.steps {
            text("steps", steps, 0, STEPS_MAX)?;
        }
        if let Some(d) = &self.diagnostics {
            line("diagnostics.userAgent", &d.user_agent, 500, false)?;
            if let Some(e) = &d.last_error {
                text("diagnostics.lastError", e, 0, 2000)?;
            }
            if let Some(v) = &d.viewport {
                if v.width > 100_000 || v.height > 100_000 {
                    return Err(field("diagnostics.viewport", "out of range"));
                }
            }
        }
        if self.screenshots.len() > SCREENSHOTS_MAX {
            return Err(field(
                "screenshots",
                format!("at most {SCREENSHOTS_MAX} screenshots"),
            ));
        }
        let mut images = Vec::with_capacity(self.screenshots.len());
        let mut total = 0usize;
        for s in &self.screenshots {
            line("screenshots.name", &s.name, 100, false)?;
            if s.mime != "image/png" && s.mime != "image/jpeg" {
                return Err(field("screenshots.mime", "PNG or JPEG only"));
            }
            // Cheap size check before decoding.
            if s.data_base64.len() / 4 * 3 > SCREENSHOT_BYTES_MAX + 3 {
                return Err(ReportError::TooLarge(format!(
                    "a screenshot is larger than {} MB",
                    SCREENSHOT_BYTES_MAX / 1024 / 1024
                )));
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(s.data_base64.as_bytes())
                .map_err(|_| field("screenshots.dataBase64", "invalid base64"))?;
            if bytes.len() > SCREENSHOT_BYTES_MAX {
                return Err(ReportError::TooLarge(format!(
                    "a screenshot is larger than {} MB",
                    SCREENSHOT_BYTES_MAX / 1024 / 1024
                )));
            }
            total += bytes.len();
            if total > SCREENSHOTS_TOTAL_MAX {
                return Err(ReportError::TooLarge(format!(
                    "the screenshots are larger than {} MB together",
                    SCREENSHOTS_TOTAL_MAX / 1024 / 1024
                )));
            }
            let ext = sniff(&s.mime, &bytes)
                .ok_or_else(|| field("screenshots.dataBase64", "not a PNG or JPEG image"))?;
            images.push(Image {
                name: s.name.clone(),
                ext,
                bytes,
            });
        }
        Ok(images)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::{json, Value};

    pub const INSTANCE: &str = "3f2b8c1e-9d4a-4e7b-8a6f-0c1d2e3f4a5b";
    pub const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    pub fn sample() -> Value {
        json!({
            "app": "calc", "appVersion": "0.1.0", "platform": "web", "os": "Linux", "locale": "en",
            "instanceId": INSTANCE, "kind": "bug", "title": "Sum is wrong",
            "description": "The SUM of A1:A3 shows 5 instead of 6 after editing.",
            "steps": "1. Type 1, 2, 3\n2. =SUM(A1:A3)",
            "diagnostics": { "userAgent": "Mozilla/5.0", "viewport": { "width": 1400, "height": 900 },
                             "docStats": { "cells": 4 } },
            "screenshots": []
        })
    }

    fn parse(v: &Value) -> Result<(Report, Vec<Image>), ReportError> {
        Report::parse(v.to_string().as_bytes())
    }

    fn b64(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    #[test]
    fn accepts_a_valid_report() {
        let (r, images) = parse(&sample()).unwrap();
        assert_eq!(r.app, App::Calc);
        assert_eq!(r.kind, Kind::Bug);
        assert_eq!(r.diagnostics.unwrap().doc_stats.unwrap().cells, Some(4));
        assert!(images.is_empty());
    }

    #[test]
    fn refuses_unknown_fields_anywhere() {
        let mut v = sample();
        v["document"] = json!("<w:document>secret</w:document>");
        assert!(matches!(parse(&v), Err(ReportError::Json(_))));
        let mut v = sample();
        v["diagnostics"]["docStats"]["text"] = json!("secret");
        assert!(matches!(parse(&v), Err(ReportError::Json(_))));
    }

    #[test]
    fn refuses_unknown_enum_values() {
        for (k, val) in [("app", "excel"), ("kind", "rant"), ("platform", "mobile")] {
            let mut v = sample();
            v[k] = json!(val);
            assert!(matches!(parse(&v), Err(ReportError::Json(_))), "{k}");
        }
    }

    #[test]
    fn title_limits() {
        let mut v = sample();
        v["title"] = json!("x".repeat(121));
        assert!(matches!(
            parse(&v),
            Err(ReportError::Field { field: "title", .. })
        ));
        v["title"] = json!("ä".repeat(120)); // characters, not bytes
        assert!(parse(&v).is_ok());
        v["title"] = json!("   ");
        assert!(matches!(
            parse(&v),
            Err(ReportError::Field { field: "title", .. })
        ));
        v["title"] = json!("two\nlines");
        assert!(matches!(
            parse(&v),
            Err(ReportError::Field { field: "title", .. })
        ));
    }

    #[test]
    fn description_limits() {
        let mut v = sample();
        v["description"] = json!("too short          ");
        assert!(matches!(
            parse(&v),
            Err(ReportError::Field {
                field: "description",
                ..
            })
        ));
        v["description"] = json!("y".repeat(4001));
        assert!(matches!(
            parse(&v),
            Err(ReportError::Field {
                field: "description",
                ..
            })
        ));
        v["description"] = json!(format!("{}\n\tend", "z".repeat(30)));
        assert!(parse(&v).is_ok());
    }

    #[test]
    fn instance_id_must_be_a_v4_uuid() {
        assert!(valid_instance_id(INSTANCE));
        assert!(!valid_instance_id("3f2b8c1e-9d4a-1e7b-8a6f-0c1d2e3f4a5b")); // v1
        assert!(!valid_instance_id("3f2b8c1e9d4a4e7b8a6f0c1d2e3f4a5b")); // simple form
        assert!(!valid_instance_id("not-a-uuid"));
        let mut v = sample();
        v["instanceId"] = json!("00000000-0000-0000-0000-000000000000");
        assert!(matches!(
            parse(&v),
            Err(ReportError::Field {
                field: "instanceId",
                ..
            })
        ));
    }

    #[test]
    fn screenshots_are_checked() {
        let mut v = sample();
        v["screenshots"] =
            json!([{ "name": "a.png", "mime": "image/png", "dataBase64": b64(PNG) }]);
        let (_, images) = parse(&v).unwrap();
        assert_eq!(images[0].ext, "png");
        assert_eq!(images[0].bytes, PNG);
        // mime must match the content
        v["screenshots"] =
            json!([{ "name": "a.jpg", "mime": "image/jpeg", "dataBase64": b64(PNG) }]);
        assert!(matches!(parse(&v), Err(ReportError::Field { .. })));
        v["screenshots"] =
            json!([{ "name": "a.gif", "mime": "image/gif", "dataBase64": b64(b"GIF89a") }]);
        assert!(matches!(parse(&v), Err(ReportError::Field { .. })));
        v["screenshots"] = json!([{ "name": "a.png", "mime": "image/png", "dataBase64": "!!!" }]);
        assert!(matches!(parse(&v), Err(ReportError::Field { .. })));
        let one = json!({ "name": "a.png", "mime": "image/png", "dataBase64": b64(PNG) });
        v["screenshots"] = json!([one, one, one, one]);
        assert!(matches!(
            parse(&v),
            Err(ReportError::Field {
                field: "screenshots",
                ..
            })
        ));
    }

    #[test]
    fn screenshot_size_limits() {
        let mut big = PNG.to_vec();
        big.resize(SCREENSHOT_BYTES_MAX + 1, 0);
        let mut v = sample();
        v["screenshots"] =
            json!([{ "name": "a.png", "mime": "image/png", "dataBase64": b64(&big) }]);
        assert!(matches!(parse(&v), Err(ReportError::TooLarge(_))));
        // three images of 1.9 MB each: each fine, together over 5 MB
        let mut img = PNG.to_vec();
        img.resize(SCREENSHOT_BYTES_MAX - 100_000, 0);
        let one = json!({ "name": "a.png", "mime": "image/png", "dataBase64": b64(&img) });
        v["screenshots"] = json!([one, one]);
        assert!(parse(&v).is_ok());
        v["screenshots"] = json!([one, one, one]);
        assert!(matches!(parse(&v), Err(ReportError::TooLarge(_))));
    }

    #[test]
    fn locale_and_os_checks() {
        let mut v = sample();
        v["locale"] = json!("de-AT");
        assert!(parse(&v).is_ok());
        v["locale"] = json!("de AT; drop");
        assert!(matches!(
            parse(&v),
            Err(ReportError::Field {
                field: "locale",
                ..
            })
        ));
        let mut v = sample();
        v["os"] = json!("");
        assert!(matches!(
            parse(&v),
            Err(ReportError::Field { field: "os", .. })
        ));
    }
}
