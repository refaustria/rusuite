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
        }
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
