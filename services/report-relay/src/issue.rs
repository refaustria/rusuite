//! The GitHub issue made from a report: title, labels and the Markdown body.

use crate::report::{Diagnostics, Report};
use sha2::{Digest, Sha256};

/// The first 8 hex digits of SHA-256(instance id): identifies repeat reporters without publishing the id.
pub fn instance_hash(instance_id: &str) -> String {
    let d = Sha256::digest(instance_id.as_bytes());
    d.iter().take(4).map(|b| format!("{b:02x}")).collect()
}

/// `@name` would notify GitHub users: a zero-width space after `@` keeps the text but not the mention.
pub fn defuse_mentions(s: &str) -> String {
    s.replace('@', "@\u{200B}")
}

/// `[calc] <title>`.
pub fn title(r: &Report) -> String {
    format!("[{}] {}", r.app.as_str(), defuse_mentions(r.title.trim()))
}

pub fn labels(r: &Report) -> Vec<String> {
    vec![
        "from-app".to_owned(),
        format!("app:{}", r.app.as_str()),
        format!("kind:{}", r.kind.as_str()),
    ]
}

/// A table cell: one line, `|` escaped.
fn cell(s: &str) -> String {
    defuse_mentions(&s.replace(['\r', '\n'], " ").replace('|', "\\|"))
}

/// A fenced code block whose fence is longer than any backtick run inside.
fn code_block(s: &str) -> String {
    let longest = s.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    let fence = "`".repeat(longest.max(2) + 1);
    format!("{fence}text\n{}\n{fence}", s.trim_end())
}

fn diagnostics_table(d: &Diagnostics) -> String {
    let mut rows = vec![("User agent", cell(&d.user_agent))];
    if let Some(v) = &d.viewport {
        rows.push(("Viewport", format!("{} × {}", v.width, v.height)));
    }
    if let Some(s) = &d.doc_stats {
        let mut parts = Vec::new();
        if let Some(n) = s.blocks {
            parts.push(format!("{n} blocks"));
        }
        if let Some(n) = s.cells {
            parts.push(format!("{n} cells"));
        }
        if let Some(n) = s.slides {
            parts.push(format!("{n} slides"));
        }
        if !parts.is_empty() {
            rows.push(("Document", parts.join(", ")));
        }
    }
    let mut out = String::from("| | |\n|---|---|\n");
    for (k, v) in rows {
        out.push_str(&format!("| {k} | {v} |\n"));
    }
    if let Some(e) = d.last_error.as_deref().filter(|e| !e.trim().is_empty()) {
        out.push_str("\nLast error:\n\n");
        out.push_str(&code_block(e));
        out.push('\n');
    }
    out
}

/// The issue body. `images` are (name, URL) of the attached screenshots.
pub fn body(r: &Report, images: &[(String, String)], screenshots_dropped: bool) -> String {
    let platform = match r.platform {
        crate::report::Platform::Web => "web",
        crate::report::Platform::Desktop => "desktop",
    };
    let mut b = String::new();
    b.push_str(&format!("**Kind:** {}  \n", r.kind.display()));
    b.push_str(&format!(
        "**App:** {} {}  \n",
        r.app.display(),
        cell(&r.app_version)
    ));
    b.push_str(&format!(
        "**Platform:** {platform} · {} · {}\n\n",
        cell(&r.os),
        cell(&r.locale)
    ));
    b.push_str("### Description\n\n");
    b.push_str(&defuse_mentions(r.description.trim()));
    b.push_str("\n\n");
    if let Some(steps) = r.steps.as_deref().filter(|s| !s.trim().is_empty()) {
        b.push_str("### Steps to reproduce\n\n");
        b.push_str(&defuse_mentions(steps.trim()));
        b.push_str("\n\n");
    }
    if let Some(d) = &r.diagnostics {
        b.push_str("### Diagnostics\n\n");
        b.push_str(&diagnostics_table(d));
        b.push('\n');
    }
    if !images.is_empty() || screenshots_dropped {
        b.push_str("### Screenshots\n\n");
        for (name, url) in images {
            let alt = cell(name).replace(['[', ']'], "");
            b.push_str(&format!("![{alt}]({url})\n\n"));
        }
        if screenshots_dropped {
            b.push_str("_The screenshots could not be attached._\n\n");
        }
    }
    b.push_str(&format!(
        "---\n<sub>Submitted from the app via the report relay; instance {}</sub>\n",
        instance_hash(&r.instance_id)
    ));
    b
}

/// `(year, month)` of a Unix time (UTC), for `reports/<yyyy>/<mm>/…`.
pub fn year_month(unix: u64) -> (i64, u32) {
    // Howard Hinnant's civil_from_days.
    let z = (unix / 86_400) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m)
}

/// `reports/<yyyy>/<mm>/<uuid>.<ext>`.
pub fn attachment_path(unix: u64, ext: &str) -> String {
    let (y, m) = year_month(unix);
    format!("reports/{y:04}/{m:02}/{}.{ext}", uuid::Uuid::new_v4())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::tests::{sample, INSTANCE};

    fn report() -> Report {
        serde_json::from_value(sample()).unwrap()
    }

    #[test]
    fn title_and_labels() {
        let mut r = report();
        r.title = "  Ping @octocat ".into();
        assert_eq!(title(&r), "[calc] Ping @\u{200B}octocat");
        assert_eq!(labels(&r), ["from-app", "app:calc", "kind:bug"]);
    }

    #[test]
    fn body_has_every_section() {
        let r = report();
        let b = body(
            &r,
            &[(
                "shot.png".into(),
                "https://raw.githubusercontent.com/o/r/issue-attachments/reports/2026/10/x.png"
                    .into(),
            )],
            false,
        );
        assert!(b.contains("**Kind:** Bug"));
        assert!(b.contains("**App:** Rusuite Calc 0.1.0"));
        assert!(b.contains("**Platform:** web · Linux · en"));
        assert!(b.contains("### Description\n\nThe SUM of A1:A3"));
        assert!(b.contains("### Steps to reproduce\n\n1. Type 1, 2, 3"));
        assert!(b.contains("| Viewport | 1400 × 900 |"));
        assert!(b.contains("| Document | 4 cells |"));
        assert!(b.contains("![shot.png](https://raw.githubusercontent.com/o/r/issue-attachments/"));
        assert!(b.ends_with(&format!(
            "Submitted from the app via the report relay; instance {}</sub>\n",
            instance_hash(INSTANCE)
        )));
        assert!(!b.contains(INSTANCE), "the raw instance id stays private");
    }

    #[test]
    fn body_without_optional_parts() {
        let mut r = report();
        r.steps = None;
        r.diagnostics = None;
        let b = body(&r, &[], true);
        assert!(!b.contains("Steps to reproduce"));
        assert!(!b.contains("Diagnostics"));
        assert!(b.contains("_The screenshots could not be attached._"));
    }

    #[test]
    fn table_cells_and_code_are_escaped() {
        let mut r = report();
        let d = r.diagnostics.as_mut().unwrap();
        d.user_agent = "a|b\nc".into();
        d.last_error = Some("boom ``` x".into());
        let b = body(&r, &[], false);
        assert!(b.contains("| User agent | a\\|b c |"));
        assert!(b.contains("````text\nboom ``` x\n````"));
    }

    #[test]
    fn hash_is_eight_hex_digits() {
        let h = instance_hash(INSTANCE);
        assert_eq!(h.len(), 8);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(h, instance_hash("other"));
    }

    #[test]
    fn dates_for_attachment_paths() {
        assert_eq!(year_month(0), (1970, 1));
        assert_eq!(year_month(1_792_108_800), (2026, 10)); // 2026-10-16
        assert_eq!(year_month(951_782_400), (2000, 2)); // 2000-02-29
        let p = attachment_path(1_792_108_800, "png");
        assert!(
            p.starts_with("reports/2026/10/") && p.ends_with(".png"),
            "{p}"
        );
        assert_eq!(p.len(), "reports/2026/10/".len() + 36 + 4);
    }
}
