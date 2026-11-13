/// Errors of the notes model.
#[derive(Debug, thiserror::Error)]
pub enum NotesError {
    /// Loro rejected an operation or an import.
    #[error("loro: {0}")]
    Loro(#[from] loro::LoroError),
    /// Loro could not encode an export.
    #[error("loro export: {0}")]
    Encode(#[from] loro::LoroEncodeError),
    /// No (live or soft-deleted) node with this id.
    #[error("unknown node {0}")]
    UnknownNode(String),
    /// The node kind is not allowed under that parent (pages live in sections or pages; sections and groups at
    /// the root or in groups).
    #[error("a {child} cannot be placed under {parent}")]
    InvalidParent { child: &'static str, parent: String },
    /// The move would put a node under itself or one of its descendants.
    #[error("a node cannot be moved under itself")]
    Cycle,
    /// Restoring a node whose parent is still in the recycle bin needs a target (`restore_to`).
    #[error("the parent of {0} is deleted; restore it or choose a target")]
    ParentDeleted(String),
    /// The node is not in the recycle bin.
    #[error("{0} is not deleted")]
    NotDeleted(String),
    /// Malformed content (PM JSON or Loro structure).
    #[error("invalid content: {0}")]
    Content(String),
    /// No tag definition with this id.
    #[error("unknown tag {0}")]
    UnknownTag(String),
    /// Unknown canvas item or ink stroke.
    #[error("unknown item {0}")]
    UnknownItem(String),
}
