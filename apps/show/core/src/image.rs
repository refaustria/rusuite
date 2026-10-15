//! Pixel size of PNG, JPEG, GIF and BMP images from their headers.

fn be16(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(u16::from_be_bytes([
        *b.get(at)?,
        *b.get(at + 1)?,
    ])))
}

fn le16(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from(u16::from_le_bytes([
        *b.get(at)?,
        *b.get(at + 1)?,
    ])))
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

fn le32(b: &[u8], at: usize) -> Option<i32> {
    Some(i32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// `(width, height)` in pixels, or `None` for unknown or truncated data.
pub(crate) fn pixel_size(b: &[u8]) -> Option<(u32, u32)> {
    let size = if b.starts_with(b"\x89PNG\r\n\x1a\n") {
        (be32(b, 16)?, be32(b, 20)?)
    } else if b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a") {
        (le16(b, 6)?, le16(b, 8)?)
    } else if b.starts_with(b"BM") {
        (le32(b, 18)?.unsigned_abs(), le32(b, 22)?.unsigned_abs())
    } else if b.starts_with(&[0xFF, 0xD8]) {
        jpeg_size(b)?
    } else {
        return None;
    };
    (size.0 > 0 && size.1 > 0).then_some(size)
}

fn jpeg_size(b: &[u8]) -> Option<(u32, u32)> {
    let mut i = 2;
    loop {
        while *b.get(i)? != 0xFF {
            i += 1;
        }
        while *b.get(i)? == 0xFF {
            i += 1;
        }
        let marker = *b.get(i)?;
        i += 1;
        match marker {
            0xD8 | 0x01 | 0xD0..=0xD7 => continue, // no payload
            0xC0..=0xCF if !matches!(marker, 0xC4 | 0xC8 | 0xCC) => {
                return Some((be16(b, i + 5)?, be16(b, i + 3)?));
            }
            _ => i += usize::try_from(be16(b, i)?).ok()?,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headers() {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
        png.extend([0, 0, 1, 0, 0, 0, 0, 200]);
        assert_eq!(pixel_size(&png), Some((256, 200)));
        assert_eq!(pixel_size(b"GIF89a\x10\x00\x20\x00"), Some((16, 32)));
        let mut bmp = vec![0u8; 26];
        bmp[..2].copy_from_slice(b"BM");
        bmp[18..22].copy_from_slice(&40i32.to_le_bytes());
        bmp[22..26].copy_from_slice(&(-30i32).to_le_bytes());
        assert_eq!(pixel_size(&bmp), Some((40, 30)));
        // SOI, APP0 (len 4), SOF0: len, precision, height 0x0102, width 0x0304
        let jpg = [
            0xFF, 0xD8, 0xFF, 0xE0, 0, 4, 0, 0, 0xFF, 0xC0, 0, 17, 8, 1, 2, 3, 4,
        ];
        assert_eq!(pixel_size(&jpg), Some((0x0304, 0x0102)));
        assert_eq!(pixel_size(b"\x89PNG"), None);
        assert_eq!(pixel_size(&[0xFF, 0xD8, 0xFF]), None);
        assert_eq!(pixel_size(b"hello"), None);
    }
}
