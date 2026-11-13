//! Byte-based entry points into `onenote_parser`. Its `native-fs` feature
//! (real file system) is off, so this crate builds for wasm; the parser is
//! given a file system that serves one in-memory file. `.onepkg` CAB
//! extraction is the parser's `onepkg` feature (the `cab` crate), which keeps
//! the unpacked files in memory too.

use std::io::{Error, ErrorKind, Read};

use onenote_parser::notebook::Notebook;
use onenote_parser::section::Section;
use onenote_parser::{FileSystem, Parser};
use typed_path::{PathType, TypedPath, TypedPathBuf};

/// The single file the parser may read; every other operation fails.
#[derive(Clone, Copy)]
struct OneFile<'a> {
    data: &'a [u8],
}

const PATH: &str = "notebook.onepkg";

impl FileSystem for OneFile<'_> {
    fn is_directory(&self, _: TypedPath) -> Result<bool, Error> {
        Ok(false)
    }
    fn read_dir(&self, _: TypedPath) -> Result<Vec<TypedPathBuf>, Error> {
        Err(unsupported())
    }
    fn read_file(&self, path: TypedPath) -> Result<Vec<u8>, Error> {
        if path.as_bytes() == PATH.as_bytes() {
            Ok(self.data.to_vec())
        } else {
            Err(Error::from(ErrorKind::NotFound))
        }
    }
    fn write_file(&self, _: TypedPath, _: &[u8]) -> Result<(), Error> {
        Err(unsupported())
    }
    fn stream_to_file(&self, _: TypedPath, _: &mut dyn Read) -> Result<(), Error> {
        Err(unsupported())
    }
    fn make_dir(&self, _: TypedPath) -> Result<(), Error> {
        Err(unsupported())
    }
    fn canonicalize(&self, path: TypedPath) -> Result<TypedPathBuf, Error> {
        Ok(path.to_path_buf())
    }
    fn exists(&self, path: TypedPath) -> Result<bool, Error> {
        Ok(path.as_bytes() == PATH.as_bytes())
    }
    fn is_windows(&self) -> bool {
        false
    }
}

fn unsupported() -> Error {
    Error::from(ErrorKind::Unsupported)
}

/// Parses a section from bytes.
pub(crate) fn parse_section(
    bytes: &[u8],
    file_name: &str,
) -> onenote_parser::errors::Result<Section> {
    Parser::new_with_fs(OneFile { data: &[] })
        .parse_section_buffer(bytes, TypedPath::new(file_name, PathType::Windows))
}

/// Parses a `.onepkg` package from bytes.
pub(crate) fn parse_package(bytes: &[u8]) -> onenote_parser::errors::Result<Notebook> {
    Parser::new_with_fs(OneFile { data: bytes }).parse_package(TypedPath::new(PATH, PathType::Unix))
}
