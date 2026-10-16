//! TypeScript-only mirrors of the annotation types of
//! `model_sheet::annotations` (notes, threaded comments, persons,
//! hyperlinks; see [`crate::wire`] for the pattern). A test round-trips
//! populated values to catch drift.

use app_common::wire::RunProperties;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

macro_rules! mirror {
    ($($item:item)*) => {
        $(
            #[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
            #[ts(export, export_to = "apps/calc/src/generated/")]
            $item
        )*
    };
}

mirror! {
    /// Mirror of `model_sheet::NoteRun`: one run of a note's rich text.
    #[serde(rename_all = "camelCase")]
    pub struct NoteRun {
        pub text: String,
        /// Absent = the note font (Tahoma 9).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub font: Option<RunProperties>,
    }

    /// Mirror of `model_sheet::NoteBounds`: the note box in points; `x`,
    /// `y` from the top-right corner of the note's cell.
    #[serde(rename_all = "camelCase")]
    pub struct NoteBounds {
        pub x: f64,
        pub y: f64,
        pub w: f64,
        pub h: f64,
    }

    /// Mirror of `model_sheet::Note`.
    #[serde(rename_all = "camelCase")]
    pub struct Note {
        pub row: u32,
        pub col: u32,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        #[ts(optional, as = "Option<String>")]
        pub author: String,
        pub text: Vec<NoteRun>,
        /// Always shown (absent = shown on hover only).
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub visible: bool,
        /// Absent = Excel's default box.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub bounds: Option<NoteBounds>,
    }

    /// Mirror of `model_sheet::Person`: a comment author.
    #[serde(rename_all = "camelCase")]
    pub struct Person {
        #[serde(default, skip_serializing_if = "String::is_empty")]
        #[ts(optional, as = "Option<String>")]
        pub id: String,
        pub name: String,
        #[serde(default, skip_serializing_if = "String::is_empty")]
        #[ts(optional, as = "Option<String>")]
        pub initials: String,
    }

    /// Mirror of `model_sheet::Reply`.
    #[serde(rename_all = "camelCase")]
    pub struct Reply {
        pub id: String,
        pub author: Person,
        /// ISO 8601, written by the UI.
        pub date: String,
        pub text: String,
    }

    /// Mirror of `model_sheet::Thread`: a threaded comment.
    #[serde(rename_all = "camelCase")]
    pub struct Thread {
        pub id: String,
        pub row: u32,
        pub col: u32,
        pub author: Person,
        pub date: String,
        pub text: String,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        #[ts(optional, as = "Option<bool>")]
        pub resolved: bool,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        #[ts(optional, as = "Option<Vec<Reply>>")]
        pub replies: Vec<Reply>,
    }

    /// Mirror of `model_sheet::LinkTarget`.
    #[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
    pub enum LinkTarget {
        Url { url: String },
        /// `Sheet2!B4`, `'My sheet'!A1:C3` or a defined name.
        Location { location: String },
        Email {
            address: String,
            #[serde(default, skip_serializing_if = "Option::is_none")]
            #[ts(optional)]
            subject: Option<String>,
        },
    }

    /// Mirror of `model_sheet::Hyperlink`.
    #[serde(rename_all = "camelCase")]
    pub struct Hyperlink {
        pub r0: u32,
        pub c0: u32,
        pub r1: u32,
        pub c1: u32,
        pub target: LinkTarget,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub display: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub tooltip: Option<String>,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core_model::{Color, Rgb};
    use model_sheet as ms;
    use serde::de::DeserializeOwned;

    fn same_shape<R, M>(real: &R)
    where
        R: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug,
        M: Serialize + DeserializeOwned,
    {
        let json = serde_json::to_value(real).unwrap();
        let mirror: M = serde_json::from_value(json.clone()).unwrap();
        let back = serde_json::to_value(&mirror).unwrap();
        assert_eq!(json, back);
        assert_eq!(&serde_json::from_value::<R>(back).unwrap(), real);
    }

    #[test]
    fn mirrors_match_the_annotation_model() {
        let note = ms::Note {
            row: 1,
            col: 2,
            author: "Ann".into(),
            text: vec![
                ms::NoteRun {
                    text: "Ann:".into(),
                    font: core_model::RunProperties {
                        bold: Some(true),
                        color: Some(Color::Rgb(Rgb::new(1, 2, 3))),
                        ..Default::default()
                    },
                },
                ms::NoteRun::plain("x"),
            ],
            visible: true,
            bounds: Some(ms::NoteBounds::DEFAULT),
        };
        same_shape::<_, Note>(&note);
        same_shape::<_, Note>(&ms::Note::plain(0, 0, "", ""));
        let person = ms::Person {
            id: "{1}".into(),
            name: "Ann Lee".into(),
            initials: "AL".into(),
        };
        let thread = ms::Thread {
            id: "{t}".into(),
            row: 0,
            col: 0,
            author: person.clone(),
            date: "2026-10-16T09:00:00.00".into(),
            text: "why".into(),
            resolved: true,
            replies: vec![ms::Reply {
                id: "{r}".into(),
                author: ms::Person::new("Bob", ""),
                date: "d".into(),
                text: "because".into(),
            }],
        };
        same_shape::<_, Thread>(&thread);
        same_shape::<_, Person>(&ms::Person::new("x", ""));
        for target in [
            ms::LinkTarget::Url { url: "u".into() },
            ms::LinkTarget::Location {
                location: "A1".into(),
            },
            ms::LinkTarget::Email {
                address: "a@b".into(),
                subject: Some("s".into()),
            },
            ms::LinkTarget::Email {
                address: "a@b".into(),
                subject: None,
            },
        ] {
            same_shape::<_, Hyperlink>(&ms::Hyperlink {
                r0: 0,
                c0: 1,
                r1: 2,
                c1: 3,
                target,
                display: Some("d".into()),
                tooltip: Some("t".into()),
            });
        }
    }
}
