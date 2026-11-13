//! Recognises what a byte buffer is before it goes to the parser, so wrong
//! or unsupported files get a clear error (MS-ONESTORE 2.3.1 header, CAB
//! signature).

/// What the first bytes say.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Sniff {
    /// A OneNote 2010+ revision store (desktop `.one` / `.onetoc2`).
    Desktop {
        /// `true` for a `.onetoc2` table of contents.
        toc: bool,
        /// `ffvLastCodeThatWroteToThisFile` (0x2A for 2010+ sections).
        ffv: u32,
    },
    /// The FSSHTTP packaging used by OneDrive downloads (section or toc).
    Package,
    /// A OneNote file whose format GUID is unknown: OneNote 2007 or older.
    LegacyOneNote,
    /// A cabinet archive (`.onepkg`).
    Cab,
    /// Anything else.
    Other,
}

const SECTION: [u8; 16] = guid_le(
    0x7B5C52E4,
    0xD88C,
    0x4DA7,
    [0xAE, 0xB1, 0x53, 0x78, 0xD0, 0x29, 0x96, 0xD3],
);
const TOC: [u8; 16] = guid_le(
    0x43FF2FA1,
    0xEFD9,
    0x4C76,
    [0x9E, 0xE2, 0x10, 0xEA, 0x57, 0x22, 0x76, 0x5F],
);
const FORMAT_REVISION_STORE: [u8; 16] = guid_le(
    0x109ADD3F,
    0x911B,
    0x49F5,
    [0xA5, 0xD0, 0x17, 0x91, 0xED, 0xC8, 0xAE, 0xD8],
);
const FORMAT_PACKAGE: [u8; 16] = guid_le(
    0x638DE92F,
    0xA6D4,
    0x4BC1,
    [0x9A, 0x36, 0xB3, 0xFC, 0x25, 0x11, 0xA5, 0xB7],
);

/// The on-disk (little-endian) byte form of a GUID.
const fn guid_le(a: u32, b: u16, c: u16, d: [u8; 8]) -> [u8; 16] {
    let a = a.to_le_bytes();
    let b = b.to_le_bytes();
    let c = c.to_le_bytes();
    [
        a[0], a[1], a[2], a[3], b[0], b[1], c[0], c[1], d[0], d[1], d[2], d[3], d[4], d[5], d[6],
        d[7],
    ]
}

/// Classifies `bytes` by their header.
pub(crate) fn sniff(bytes: &[u8]) -> Sniff {
    if bytes.starts_with(b"MSCF") {
        return Sniff::Cab;
    }
    if bytes.len() < 68 {
        return Sniff::Other;
    }
    let file_type = &bytes[0..16];
    let toc = file_type == TOC;
    if file_type != SECTION && !toc {
        return Sniff::Other;
    }
    let format = &bytes[48..64];
    if format == FORMAT_PACKAGE {
        Sniff::Package
    } else if format == FORMAT_REVISION_STORE {
        let ffv = u32::from_le_bytes([bytes[64], bytes[65], bytes[66], bytes[67]]);
        Sniff::Desktop { toc, ffv }
    } else {
        Sniff::LegacyOneNote
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(file_type: [u8; 16], format: [u8; 16], ffv: u32) -> Vec<u8> {
        let mut b = vec![0u8; 1024];
        b[0..16].copy_from_slice(&file_type);
        b[48..64].copy_from_slice(&format);
        b[64..68].copy_from_slice(&ffv.to_le_bytes());
        b
    }

    #[test]
    fn guid_bytes_are_little_endian() {
        assert_eq!(&SECTION[0..4], &[0xE4, 0x52, 0x5C, 0x7B]);
        assert_eq!(&SECTION[4..8], &[0x8C, 0xD8, 0xA7, 0x4D]);
        assert_eq!(
            &SECTION[8..],
            &[0xAE, 0xB1, 0x53, 0x78, 0xD0, 0x29, 0x96, 0xD3]
        );
    }

    #[test]
    fn recognises_the_header_kinds() {
        assert_eq!(
            sniff(&header(SECTION, FORMAT_REVISION_STORE, 0x2A)),
            Sniff::Desktop {
                toc: false,
                ffv: 0x2A
            }
        );
        assert_eq!(
            sniff(&header(TOC, FORMAT_REVISION_STORE, 0x1B)),
            Sniff::Desktop {
                toc: true,
                ffv: 0x1B
            }
        );
        assert_eq!(sniff(&header(SECTION, FORMAT_PACKAGE, 0)), Sniff::Package);
        assert_eq!(sniff(&header(SECTION, [7; 16], 0)), Sniff::LegacyOneNote);
        assert_eq!(sniff(b"MSCF\0\0\0\0rest"), Sniff::Cab);
        assert_eq!(sniff(b"PK\x03\x04"), Sniff::Other);
        assert_eq!(sniff(&[]), Sniff::Other);
        assert_eq!(sniff(&SECTION), Sniff::Other, "truncated header");
    }
}
