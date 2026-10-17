//! Audio and video on slides (`p:pic` with `a:videoFile` / `a:audioFile`
//! and the PowerPoint 2010 `p14:media` embedding): the media file and its
//! poster frame live in the presentation's media store like pictures;
//! playback settings follow PowerPoint's Playback tab.

use core_model::media::MediaId;
use serde::{Deserialize, Serialize};

/// Audio or video.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum MediaKind {
    /// A video (`a:videoFile`).
    #[default]
    Video,
    /// A sound (`a:audioFile`).
    Audio,
}

impl MediaKind {
    /// The kind of a MIME type (`audio/*` → audio, else video).
    pub fn of_content_type(ct: &str) -> MediaKind {
        if ct.starts_with("audio/") {
            MediaKind::Audio
        } else {
            MediaKind::Video
        }
    }
}

/// When playback starts in the slide show (Playback › Start).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub enum MediaStart {
    /// "When Clicked On": a click on the media plays it (PowerPoint
    /// 2013+'s default).
    #[default]
    OnClick,
    /// "Automatically": plays when the slide appears (a `mediacall`
    /// effect after the previous one at the start of the main sequence).
    Automatically,
    /// "In Click Sequence": plays at the next click step.
    InClickSequence,
}

fn is_false(v: &bool) -> bool {
    !*v
}

fn full_volume() -> u32 {
    MediaClip::VOLUME_HIGH
}

fn is_full_volume(v: &u32) -> bool {
    *v == MediaClip::VOLUME_HIGH
}

/// An audio or video clip on a slide.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct MediaClip {
    /// Audio or video.
    pub kind: MediaKind,
    /// The media file in the presentation's media store.
    #[cfg_attr(feature = "ts", ts(as = "crate::ts::MediaId"))]
    pub media: MediaId,
    /// The poster frame (an image in the media store); `None` = the
    /// default placeholder (a dark frame with a play icon; a speaker for
    /// audio).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<crate::ts::MediaId>"))]
    pub poster: Option<MediaId>,
    /// When playback starts.
    #[serde(default)]
    pub start: MediaStart,
    /// Loop until stopped (`p:cTn repeatCount="indefinite"`).
    #[serde(default, rename = "loop", skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub loop_playback: bool,
    /// Hide while not playing (`p:cMediaNode showWhenStopped="0"`).
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub hide_when_not_playing: bool,
    /// Volume in 1/1000 percent (`p:cMediaNode vol`, `0..=100000`).
    #[serde(default = "full_volume", skip_serializing_if = "is_full_volume")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<u32>"))]
    pub volume: u32,
    /// Muted (`p:cMediaNode mute="1"`).
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub muted: bool,
    /// "Play Across Slides" (`p:cMediaNode numSld="999"`): keeps playing
    /// when the show moves on.
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub play_across_slides: bool,
    /// "Rewind after Playing" (`fill="remove"` on the media node): back
    /// to the poster frame at the end.
    #[serde(default, skip_serializing_if = "is_false")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<bool>"))]
    pub rewind: bool,
    /// Trim Video/Audio: milliseconds cut from the start (`p14:trim st`).
    #[serde(default, skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<u32>"))]
    pub trim_start_ms: u32,
    /// Trim Video/Audio: milliseconds cut from the end (`p14:trim end`).
    #[serde(default, skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<u32>"))]
    pub trim_end_ms: u32,
    /// Fade In duration (`p14:fade in`).
    #[serde(default, skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<u32>"))]
    pub fade_in_ms: u32,
    /// Fade Out duration (`p14:fade out`).
    #[serde(default, skip_serializing_if = "is_zero")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<u32>"))]
    pub fade_out_ms: u32,
    /// Bookmarks (`p14:bmkLst`), in time order.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[cfg_attr(feature = "ts", ts(optional, as = "Option<Vec<Bookmark>>"))]
    pub bookmarks: Vec<Bookmark>,
}

fn is_zero(v: &u32) -> bool {
    *v == 0
}

/// A named point in a clip (Playback › Add Bookmark; `p14:bmk`), which
/// can trigger animations ([`crate::anim::StartOn::Bookmark`]).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Bookmark {
    /// The name (PowerPoint: "Bookmark 1", …; unique in the clip).
    pub name: String,
    /// Position in milliseconds from the start of the untrimmed media.
    pub time_ms: u32,
}

impl MediaClip {
    /// Playback › Volume › Low.
    pub const VOLUME_LOW: u32 = 25_000;
    /// Playback › Volume › Medium.
    pub const VOLUME_MEDIUM: u32 = 50_000;
    /// Playback › Volume › High (the default).
    pub const VOLUME_HIGH: u32 = 100_000;

    /// A clip of `media` with PowerPoint's defaults (on click, full
    /// volume, no poster).
    pub fn new(kind: MediaKind, media: MediaId) -> Self {
        Self {
            kind,
            media,
            poster: None,
            start: MediaStart::OnClick,
            loop_playback: false,
            hide_when_not_playing: false,
            volume: Self::VOLUME_HIGH,
            muted: false,
            play_across_slides: false,
            rewind: false,
            trim_start_ms: 0,
            trim_end_ms: 0,
            fade_in_ms: 0,
            fade_out_ms: 0,
            bookmarks: Vec::new(),
        }
    }

    /// The name of the next bookmark ("Bookmark N" with the first unused N).
    pub fn next_bookmark_name(&self) -> String {
        (1..)
            .map(|n| format!("Bookmark {n}"))
            .find(|n| !self.bookmarks.iter().any(|b| &b.name == n))
            .unwrap_or_default()
    }

    /// Checks the bookmarks (unique, non-empty names).
    pub fn validate(&self) -> Result<(), String> {
        for (i, b) in self.bookmarks.iter().enumerate() {
            if b.name.is_empty() {
                return Err("bookmark without a name".into());
            }
            if self.bookmarks[..i].iter().any(|o| o.name == b.name) {
                return Err(format!("bookmark {:?} is used twice", b.name));
            }
        }
        Ok(())
    }

    /// Whether the clip plays by itself when the slide appears.
    pub fn autoplay(&self) -> bool {
        self.start == MediaStart::Automatically
    }

    /// The media items the clip uses (the file, then the poster).
    pub fn media_ids(&self) -> impl Iterator<Item = MediaId> {
        std::iter::once(self.media).chain(self.poster)
    }
}

/// The file extension of an audio/video MIME type (for part names).
pub fn media_extension(content_type: &str) -> &'static str {
    match content_type {
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/ogg" => "ogv",
        "video/quicktime" => "mov",
        "video/x-msvideo" | "video/avi" => "avi",
        "video/x-ms-wmv" => "wmv",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/ogg" => "ogg",
        "audio/mp4" | "audio/x-m4a" => "m4a",
        "audio/webm" => "weba",
        _ => "bin",
    }
}

/// The MIME type of an audio/video file extension (`None` = unknown).
pub fn media_content_type(ext: &str) -> Option<&'static str> {
    Some(match ext.to_ascii_lowercase().as_str() {
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "ogv" => "video/ogg",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "wmv" => "video/x-ms-wmv",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" => "audio/ogg",
        "m4a" => "audio/mp4",
        "weba" => "audio/webm",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_and_serde() {
        let c = MediaClip::new(MediaKind::Video, MediaId(2));
        let json = serde_json::to_string(&c).unwrap();
        assert_eq!(json, r#"{"kind":"video","media":2,"start":"onClick"}"#);
        assert_eq!(serde_json::from_str::<MediaClip>(&json).unwrap(), c);
        let c = MediaClip {
            loop_playback: true,
            poster: Some(MediaId(3)),
            volume: MediaClip::VOLUME_LOW,
            start: MediaStart::Automatically,
            ..c
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(json.contains(r#""loop":true"#), "{json}");
        assert!(c.autoplay());
        assert_eq!(c.media_ids().collect::<Vec<_>>(), [MediaId(2), MediaId(3)]);
        assert_eq!(serde_json::from_str::<MediaClip>(&json).unwrap(), c);
        let mut c = MediaClip {
            trim_start_ms: 1000,
            fade_out_ms: 250,
            play_across_slides: true,
            bookmarks: vec![Bookmark {
                name: "Bookmark 1".into(),
                time_ms: 1500,
            }],
            ..c
        };
        let json = serde_json::to_string(&c).unwrap();
        assert!(
            json.contains(r#""trimStartMs":1000,"fadeOutMs":250,"bookmarks":[{"name":"Bookmark 1","timeMs":1500}]"#),
            "{json}"
        );
        assert_eq!(serde_json::from_str::<MediaClip>(&json).unwrap(), c);
        assert_eq!(c.next_bookmark_name(), "Bookmark 2");
        assert!(c.validate().is_ok());
        c.bookmarks.push(c.bookmarks[0].clone());
        assert!(c.validate().is_err());
    }

    #[test]
    fn content_types() {
        for ext in ["mp4", "webm", "mp3", "wav", "ogg"] {
            let ct = media_content_type(ext).unwrap();
            assert_eq!(media_extension(ct), ext);
        }
        assert_eq!(MediaKind::of_content_type("audio/mpeg"), MediaKind::Audio);
        assert_eq!(MediaKind::of_content_type("video/webm"), MediaKind::Video);
        assert_eq!(media_content_type("png"), None);
    }
}
