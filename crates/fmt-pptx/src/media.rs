//! Audio and video (`p:pic` with `a:videoFile`/`a:audioFile` and the
//! PowerPoint 2010 `p14:media` embedding): constants shared by the reader
//! and the writer.

/// The poster frame written for clips without one (a dark 16:9 frame
/// with a play symbol); read back as "no poster".
pub const PLACEHOLDER_POSTER: &[u8] = include_bytes!("poster.png");

/// `p:ext/@uri` of the `p14:media` extension of `p:nvPr`.
pub const MEDIA_EXT_URI: &str = "{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}";
/// Relationship type of `p14:media r:embed`.
pub const MEDIA_REL: &str = "http://schemas.microsoft.com/office/2007/relationships/media";
/// Relationship type of `a:videoFile r:link`.
pub const VIDEO_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/video";
/// Relationship type of `a:audioFile r:link`.
pub const AUDIO_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_is_a_png() {
        assert!(PLACEHOLDER_POSTER.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(PLACEHOLDER_POSTER.len() < 2048);
    }
}
