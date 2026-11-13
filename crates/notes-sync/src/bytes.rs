//! Small byte helpers: hex, unpadded base64url (invite links), and serde for 64-byte arrays.

pub(crate) fn hex(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(b.len() * 2);
    for &x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 15) as usize] as char);
    }
    s
}

pub(crate) fn unhex(s: &str) -> Option<Vec<u8>> {
    let s = s.as_bytes();
    if s.len() % 2 != 0 {
        return None;
    }
    let nib = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    };
    s.chunks(2)
        .map(|p| Some(nib(p[0])? << 4 | nib(p[1])?))
        .collect()
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

pub(crate) fn b64url(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        let chars = chunk.len() + 1;
        for i in 0..chars {
            out.push(B64[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

pub(crate) fn unb64url(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| B64.iter().position(|&x| x == c).map(|p| p as u32);
    let s = s.as_bytes();
    if s.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    for chunk in s.chunks(4) {
        let mut n = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            n |= val(c)? << (18 - 6 * i);
        }
        let bytes = chunk.len() - 1;
        for i in 0..bytes {
            out.push((n >> (16 - 8 * i)) as u8);
        }
        // Non-canonical encodings (stray low bits) are refused so one link has one spelling.
        let used = bytes * 8;
        let total = chunk.len() * 6;
        if total > used && n >> (24 - total) & ((1 << (total - used)) - 1) != 0 {
            return None;
        }
    }
    Some(out)
}

/// `#[serde(with = "crate::bytes::arr64")]` for signatures (serde derives stop at 32-element arrays).
pub(crate) mod arr64 {
    use serde::de::{Error, SeqAccess, Visitor};
    use serde::{Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &[u8; 64], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bytes(v)
    }

    struct V;
    impl<'de> Visitor<'de> for V {
        type Value = [u8; 64];
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("64 bytes")
        }
        fn visit_bytes<E: Error>(self, v: &[u8]) -> Result<Self::Value, E> {
            v.try_into().map_err(|_| E::invalid_length(v.len(), &self))
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
            let mut out = [0u8; 64];
            for (i, b) in out.iter_mut().enumerate() {
                *b = seq
                    .next_element()?
                    .ok_or_else(|| A::Error::invalid_length(i, &self))?;
            }
            Ok(out)
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<[u8; 64], D::Error> {
        d.deserialize_bytes(V)
    }
}

/// postcard decoding that refuses trailing bytes (one value has one encoding).
pub(crate) fn decode_exact<'a, T: serde::Deserialize<'a>>(
    b: &'a [u8],
    what: &'static str,
) -> Result<T, crate::SyncError> {
    match postcard::take_from_bytes::<T>(b) {
        Ok((v, [])) => Ok(v),
        _ => Err(crate::SyncError::Malformed(what)),
    }
}

pub(crate) fn encode<T: serde::Serialize>(v: &T) -> Vec<u8> {
    postcard::to_allocvec(v).expect("postcard encoding into a Vec cannot fail")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_roundtrip() {
        assert_eq!(hex(&[0, 1, 0xfe]), "0001fe");
        assert_eq!(unhex("0001FE").unwrap(), vec![0, 1, 0xfe]);
        assert!(unhex("0g").is_none());
    }

    #[test]
    fn b64url_roundtrip_all_lengths() {
        for n in 0..70u8 {
            let data: Vec<u8> = (0..n).map(|i| i.wrapping_mul(37).wrapping_add(n)).collect();
            let s = b64url(&data);
            assert!(!s.contains('=') && !s.contains('+') && !s.contains('/'));
            assert_eq!(unb64url(&s).unwrap(), data, "n={n}");
        }
        assert_eq!(b64url(b"hi"), "aGk");
        assert!(unb64url("aGl").is_none(), "non-canonical trailing bits");
        assert!(unb64url("a").is_none());
        assert!(unb64url("a*bc").is_none());
    }
}
