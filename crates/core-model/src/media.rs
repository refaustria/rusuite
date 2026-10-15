//! Binary media (images) of a document, deduplicated by content.
//!
//! Shared by Write and Show (ADR 0008). Includes a small standard base64
//! codec ([`base64_encode`], [`base64_decode`]) used for the JSON shape of
//! [`Media`] and for byte payloads crossing the IPC/wasm boundary.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use serde::de::Deserializer;
use serde::ser::{SerializeSeq, Serializer};
use serde::{Deserialize, Serialize};

/// Id of a [`Media`] item in a [`MediaStore`]. Serializes as a plain number.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct MediaId(pub u32);

/// A binary part, e.g. a PNG image.
///
/// `data` serializes as a standard base64 string (with padding).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    /// MIME type, e.g. `image/png`.
    pub content_type: String,
    /// The raw bytes.
    #[serde(with = "base64_serde")]
    pub data: Vec<u8>,
}

/// All media of a document, keyed by [`MediaId`].
///
/// [`MediaStore::insert`] deduplicates identical content. Serializes as an
/// array of `{"id", "contentType", "data"}` objects sorted by id.
#[derive(Debug, Clone, Default)]
pub struct MediaStore {
    items: HashMap<MediaId, Media>,
    /// Content hash → ids with that hash (derived, rebuilt on load).
    index: HashMap<u64, Vec<MediaId>>,
    /// Next id to allocate; ids of removed items are never reused.
    next_id: u32,
}

fn content_hash(content_type: &str, data: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    content_type.hash(&mut h);
    data.hash(&mut h);
    h.finish()
}

impl MediaStore {
    /// An empty store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a media item and returns its id. If an item with the same
    /// content type and bytes exists, its id is returned instead.
    pub fn insert(&mut self, content_type: impl Into<String>, data: Vec<u8>) -> MediaId {
        let content_type = content_type.into();
        let hash = content_hash(&content_type, &data);
        if let Some(ids) = self.index.get(&hash) {
            for id in ids {
                let m = &self.items[id];
                if m.content_type == content_type && m.data == data {
                    return *id;
                }
            }
        }
        self.next_id = self.next_id.max(1);
        let id = MediaId(self.next_id);
        self.next_id += 1;
        self.items.insert(id, Media { content_type, data });
        self.index.entry(hash).or_default().push(id);
        id
    }

    /// Puts `media` back under its old id `id` (e.g. when undoing its
    /// removal), replacing an item with that id. Later
    /// [`insert`](Self::insert)s never allocate `id` again.
    pub fn insert_with_id(&mut self, id: MediaId, media: Media) {
        self.remove(id);
        let hash = content_hash(&media.content_type, &media.data);
        self.next_id = self.next_id.max(id.0.saturating_add(1));
        self.items.insert(id, media);
        self.index.entry(hash).or_default().push(id);
    }

    /// The item with id `id`.
    pub fn get(&self, id: MediaId) -> Option<&Media> {
        self.items.get(&id)
    }

    /// Removes and returns the item with id `id`.
    pub fn remove(&mut self, id: MediaId) -> Option<Media> {
        let media = self.items.remove(&id)?;
        let hash = content_hash(&media.content_type, &media.data);
        if let Some(ids) = self.index.get_mut(&hash) {
            ids.retain(|i| *i != id);
            if ids.is_empty() {
                self.index.remove(&hash);
            }
        }
        Some(media)
    }

    /// Number of items.
    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// Whether the store is empty.
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    /// All items, sorted by id.
    pub fn iter(&self) -> impl Iterator<Item = (MediaId, &Media)> {
        let mut ids: Vec<MediaId> = self.items.keys().copied().collect();
        ids.sort_unstable();
        ids.into_iter().map(move |id| (id, &self.items[&id]))
    }

    fn from_entries(entries: Vec<MediaEntry>) -> Self {
        let mut store = Self::default();
        for e in entries {
            let hash = content_hash(&e.content_type, &e.data);
            let media = Media {
                content_type: e.content_type,
                data: e.data,
            };
            store.next_id = store.next_id.max(e.id.0.saturating_add(1));
            if store.items.insert(e.id, media).is_none() {
                store.index.entry(hash).or_default().push(e.id);
            }
        }
        store
    }
}

impl PartialEq for MediaStore {
    fn eq(&self, other: &Self) -> bool {
        self.items == other.items
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaEntryRef<'a> {
    id: MediaId,
    content_type: &'a str,
    #[serde(serialize_with = "base64_serde::serialize")]
    data: &'a [u8],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaEntry {
    id: MediaId,
    content_type: String,
    #[serde(with = "base64_serde")]
    data: Vec<u8>,
}

impl Serialize for MediaStore {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut seq = serializer.serialize_seq(Some(self.items.len()))?;
        for (id, m) in self.iter() {
            seq.serialize_element(&MediaEntryRef {
                id,
                content_type: &m.content_type,
                data: &m.data,
            })?;
        }
        seq.end()
    }
}

impl<'de> Deserialize<'de> for MediaStore {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Vec::<MediaEntry>::deserialize(deserializer).map(Self::from_entries)
    }
}

/// Error decoding a base64 string.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Base64Error {
    /// The length is not a multiple of 4.
    #[error("base64 length {0} is not a multiple of 4")]
    InvalidLength(usize),
    /// A byte outside the standard alphabet.
    #[error("invalid base64 character at offset {0}")]
    InvalidCharacter(usize),
    /// `=` padding in a wrong place.
    #[error("invalid base64 padding")]
    InvalidPadding,
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Encodes `data` as standard base64 with `=` padding (RFC 4648 §4).
pub fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = u32::from(b[0]) << 16 | u32::from(b[1]) << 8 | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(char::from(ALPHABET[(n >> (18 - 6 * i)) as usize & 63]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Decodes standard base64 with `=` padding (RFC 4648 §4). No whitespace.
pub fn base64_decode(text: &str) -> Result<Vec<u8>, Base64Error> {
    let bytes = text.as_bytes();
    if bytes.len() % 4 != 0 {
        return Err(Base64Error::InvalidLength(bytes.len()));
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let chunks = bytes.len() / 4;
    for (ci, chunk) in bytes.chunks(4).enumerate() {
        let pad = chunk.iter().rev().take_while(|&&c| c == b'=').count();
        if pad > 2 || (pad > 0 && ci + 1 != chunks) {
            return Err(Base64Error::InvalidPadding);
        }
        let mut n = 0u32;
        for (i, &c) in chunk[..4 - pad].iter().enumerate() {
            let v = match c {
                b'A'..=b'Z' => c - b'A',
                b'a'..=b'z' => c - b'a' + 26,
                b'0'..=b'9' => c - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                _ => return Err(Base64Error::InvalidCharacter(ci * 4 + i)),
            };
            n |= u32::from(v) << (18 - 6 * i);
        }
        let decoded = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
        out.extend_from_slice(&decoded[..3 - pad]);
    }
    Ok(out)
}

mod base64_serde {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(data: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&super::base64_encode(data))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
        let s = std::borrow::Cow::<str>::deserialize(deserializer)?;
        super::base64_decode(&s).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insert_with_id_restores_and_reserves() {
        let mut store = MediaStore::new();
        let a = store.insert("image/png", vec![1]);
        let b = store.insert("image/png", vec![2]);
        let removed = store.remove(b).unwrap();
        store.insert_with_id(b, removed.clone());
        assert_eq!(store.get(b), Some(&removed));
        // Dedup sees the restored item; new items get fresh ids.
        assert_eq!(store.insert("image/png", vec![2]), b);
        store.insert_with_id(MediaId(10), removed);
        let c = store.insert("image/gif", vec![3]);
        assert!(c.0 > 10 && c != a);
    }

    #[test]
    fn base64_rfc4648_vectors() {
        let cases = [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg=="),
            ("fooba", "Zm9vYmE="),
            ("foobar", "Zm9vYmFy"),
        ];
        for (plain, encoded) in cases {
            assert_eq!(base64_encode(plain.as_bytes()), encoded);
            assert_eq!(base64_decode(encoded).unwrap(), plain.as_bytes());
        }
    }

    #[test]
    fn base64_roundtrip_all_bytes() {
        let data: Vec<u8> = (0..=255u8).chain((0..=255u8).rev()).collect();
        for len in 0..data.len() {
            let enc = base64_encode(&data[..len]);
            assert_eq!(base64_decode(&enc).unwrap(), &data[..len], "len {len}");
        }
        assert_eq!(base64_encode(&[0xFB, 0xFF, 0xBF]), "+/+/");
    }

    #[test]
    fn base64_rejects_bad_input() {
        assert_eq!(base64_decode("Zg="), Err(Base64Error::InvalidLength(3)));
        assert_eq!(base64_decode("Z==="), Err(Base64Error::InvalidPadding));
        assert_eq!(base64_decode("Zg==Zg=="), Err(Base64Error::InvalidPadding));
        assert_eq!(
            base64_decode("Zm9v!A=="),
            Err(Base64Error::InvalidCharacter(4))
        );
        assert_eq!(base64_decode("Z=g="), Err(Base64Error::InvalidCharacter(1)));
        assert_eq!(base64_decode("Zm 9"), Err(Base64Error::InvalidCharacter(2)));
    }

    #[test]
    fn insert_dedups() {
        let mut store = MediaStore::new();
        let a = store.insert("image/png", vec![1, 2, 3]);
        let b = store.insert("image/png", vec![4, 5]);
        let a2 = store.insert("image/png", vec![1, 2, 3]);
        let c = store.insert("image/jpeg", vec![1, 2, 3]);
        assert_eq!(a, MediaId(1));
        assert_eq!(b, MediaId(2));
        assert_eq!(a2, a);
        assert_eq!(c, MediaId(3));
        assert_eq!(store.len(), 3);
        assert_eq!(store.get(b).unwrap().data, vec![4, 5]);

        assert_eq!(store.remove(a).unwrap().data, vec![1, 2, 3]);
        assert!(store.get(a).is_none());
        // re-inserting removed content gets a fresh id, not the removed one
        let a3 = store.insert("image/png", vec![1, 2, 3]);
        assert_eq!(a3, MediaId(4));
        store.remove(a3);
        assert_eq!(store.insert("image/png", vec![9]), MediaId(5));
        assert_eq!(store.len(), 3);
    }

    #[test]
    fn store_serde_roundtrip() {
        let mut store = MediaStore::new();
        store.insert("image/png", b"PNG!".to_vec());
        store.insert("image/gif", b"GIF89a".to_vec());
        let json = serde_json::to_string(&store).unwrap();
        assert_eq!(
            json,
            r#"[{"id":1,"contentType":"image/png","data":"UE5HIQ=="},{"id":2,"contentType":"image/gif","data":"R0lGODlh"}]"#
        );
        let mut back: MediaStore = serde_json::from_str(&json).unwrap();
        assert_eq!(back, store);
        // dedup index is rebuilt on load
        assert_eq!(back.insert("image/gif", b"GIF89a".to_vec()), MediaId(2));
        assert!(serde_json::from_str::<MediaStore>(
            r#"[{"id":1,"contentType":"image/png","data":"!!!!"}]"#
        )
        .is_err());
    }
}
