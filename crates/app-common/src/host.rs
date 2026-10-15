//! The [`Document`] trait and the undo/redo [`Host`].
//!
//! # Undo model
//!
//! Every command returns its *inverse* ([`Applied::inverse`]). The host
//! keeps two stacks of inverses: [`Host::undo`] pops the undo stack,
//! applies that command and pushes *its* inverse on the redo stack, and
//! vice versa for [`Host::redo`]. A new undoable command clears the redo
//! stack. A command without an inverse (`None`, e.g. view-only or not yet
//! undoable commands) leaves both stacks untouched.
//!
//! # Dirty tracking
//!
//! [`Host::mark_saved`] remembers the undo depth at save time; the
//! document is clean while the undo stack has exactly that depth again
//! (so undoing back to the saved state clears the dirty flag). A
//! non-undoable command, trimming the saved state off the undo limit or
//! clearing the redo branch that contained it makes the saved state
//! unreachable: the document stays dirty until the next save.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Default maximum depth of the undo stack.
pub const DEFAULT_UNDO_LIMIT: usize = 200;

/// Monotonically increasing document revision (ADR 0002 §5), a plain JSON
/// number on the wire. Bumped by every applied command, undo, redo and
/// document replacement; the frontend discards replies older than the
/// newest one it has seen.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize, TS,
)]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub struct Revision(#[ts(type = "number")] pub u64);

/// A change description that can absorb a later one (used to fold the
/// patches of compound commands into one reply).
pub trait Patch: Serialize + Default {
    /// Folds `other` (which happened after `self`) into `self`.
    fn merge(&mut self, other: Self);
}

/// The result of applying a command.
#[derive(Debug, Clone, PartialEq)]
pub struct Applied<C, P> {
    /// What changed, for the UI.
    pub patch: P,
    /// The command that reverts this one; `None` = not undoable.
    pub inverse: Option<C>,
}

/// An app's document: applies serializable commands and reports patches.
pub trait Document: Sized {
    type Command: Serialize + DeserializeOwned + Clone;
    type Patch: Patch;
    type Error: std::error::Error;

    /// Applies `cmd`. On error the document must be unchanged.
    fn apply(
        &mut self,
        cmd: &Self::Command,
    ) -> Result<Applied<Self::Command, Self::Patch>, Self::Error>;
}

/// The reply to every document mutation (ADR 0002 §1): the patch plus the
/// host state the UI shows (undo/redo availability, dirty flag).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "packages/ui-shared/src/generated/")]
pub struct Envelope<P> {
    pub revision: Revision,
    pub patch: P,
    pub can_undo: bool,
    pub can_redo: bool,
    pub dirty: bool,
}

/// Owns a [`Document`] and its undo/redo history. See the module docs.
pub struct Host<D: Document> {
    doc: D,
    undo: Vec<D::Command>,
    redo: Vec<D::Command>,
    revision: Revision,
    /// Undo depth of the saved state; `None` = unreachable.
    saved: Option<usize>,
    undo_limit: usize,
}

impl<D: Document> Host<D> {
    /// A clean host around `doc` with revision 0 and the default undo
    /// limit.
    pub fn new(doc: D) -> Self {
        Host {
            doc,
            undo: Vec::new(),
            redo: Vec::new(),
            revision: Revision(0),
            saved: Some(0),
            undo_limit: DEFAULT_UNDO_LIMIT,
        }
    }

    pub fn doc(&self) -> &D {
        &self.doc
    }

    /// Mutable access that bypasses undo, revision and dirty tracking
    /// (for loading or host-side setup such as installing a clock).
    pub fn doc_mut(&mut self) -> &mut D {
        &mut self.doc
    }

    /// Replaces the document (new/open): clears both stacks, marks the
    /// host clean and bumps the revision (it never goes back).
    pub fn replace(&mut self, doc: D) {
        self.doc = doc;
        self.undo.clear();
        self.redo.clear();
        self.saved = Some(0);
        self.bump();
    }

    pub fn undo_limit(&self) -> usize {
        self.undo_limit
    }

    /// Sets the maximum undo depth (oldest entries are dropped first).
    pub fn set_undo_limit(&mut self, limit: usize) {
        self.undo_limit = limit;
        self.trim();
    }

    /// Applies `cmd`: an undoable command pushes its inverse and clears
    /// the redo stack. Bumps the revision and makes the document dirty.
    pub fn apply(&mut self, cmd: D::Command) -> Result<Envelope<D::Patch>, D::Error> {
        let applied = self.doc.apply(&cmd)?;
        match applied.inverse {
            Some(inverse) => {
                if self.saved.is_some_and(|s| s > self.undo.len()) {
                    self.saved = None; // the saved state was in the redo branch
                }
                self.redo.clear();
                self.undo.push(inverse);
                self.trim();
            }
            None => self.saved = None,
        }
        self.bump();
        Ok(self.envelope(applied.patch))
    }

    /// Reverts the last undoable command; `Ok(None)` when there is none.
    /// On error the entry stays on the undo stack.
    pub fn undo(&mut self) -> Result<Option<Envelope<D::Patch>>, D::Error> {
        let Some(cmd) = self.undo.pop() else {
            return Ok(None);
        };
        match self.doc.apply(&cmd) {
            Ok(applied) => {
                self.redo.extend(applied.inverse);
                self.bump();
                Ok(Some(self.envelope(applied.patch)))
            }
            Err(e) => {
                self.undo.push(cmd);
                Err(e)
            }
        }
    }

    /// Re-applies the last undone command; `Ok(None)` when there is none.
    /// On error the entry stays on the redo stack.
    pub fn redo(&mut self) -> Result<Option<Envelope<D::Patch>>, D::Error> {
        let Some(cmd) = self.redo.pop() else {
            return Ok(None);
        };
        match self.doc.apply(&cmd) {
            Ok(applied) => {
                self.undo.extend(applied.inverse);
                self.trim();
                self.bump();
                Ok(Some(self.envelope(applied.patch)))
            }
            Err(e) => {
                self.redo.push(cmd);
                Err(e)
            }
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn revision(&self) -> Revision {
        self.revision
    }

    pub fn is_dirty(&self) -> bool {
        self.saved != Some(self.undo.len())
    }

    /// Records the current state as saved.
    pub fn mark_saved(&mut self) {
        self.saved = Some(self.undo.len());
    }

    /// An envelope carrying `patch` and the current host state (also used
    /// for replies that change nothing, e.g. an undo with an empty stack).
    pub fn envelope(&self, patch: D::Patch) -> Envelope<D::Patch> {
        Envelope {
            revision: self.revision,
            patch,
            can_undo: self.can_undo(),
            can_redo: self.can_redo(),
            dirty: self.is_dirty(),
        }
    }

    fn bump(&mut self) {
        self.revision.0 += 1;
    }

    fn trim(&mut self) {
        if self.undo.len() > self.undo_limit {
            let excess = self.undo.len() - self.undo_limit;
            self.undo.drain(..excess);
            self.saved = self.saved.and_then(|s| s.checked_sub(excess));
        }
    }
}

impl<D: Document + std::fmt::Debug> std::fmt::Debug for Host<D> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Host")
            .field("doc", &self.doc)
            .field("undo", &self.undo.len())
            .field("redo", &self.redo.len())
            .field("revision", &self.revision)
            .field("dirty", &self.is_dirty())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A list of strings; commands push/pop, `Mark` is not undoable.
    #[derive(Debug, Default)]
    struct Log(Vec<String>);

    #[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
    enum Cmd {
        Push(String),
        Pop,
        Mark,
        Fail,
    }

    #[derive(Debug, Default, Serialize)]
    struct Len(usize);

    impl Patch for Len {
        fn merge(&mut self, other: Self) {
            *self = other;
        }
    }

    #[derive(Debug, PartialEq)]
    struct Failed;

    impl std::fmt::Display for Failed {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("failed")
        }
    }

    impl std::error::Error for Failed {}

    impl Document for Log {
        type Command = Cmd;
        type Patch = Len;
        type Error = Failed;

        fn apply(&mut self, cmd: &Cmd) -> Result<Applied<Cmd, Len>, Failed> {
            let inverse = match cmd {
                Cmd::Push(s) => {
                    self.0.push(s.clone());
                    Some(Cmd::Pop)
                }
                Cmd::Pop => Some(Cmd::Push(self.0.pop().ok_or(Failed)?)),
                Cmd::Mark => None,
                Cmd::Fail => return Err(Failed),
            };
            Ok(Applied {
                patch: Len(self.0.len()),
                inverse,
            })
        }
    }

    fn push(s: &str) -> Cmd {
        Cmd::Push(s.into())
    }

    #[test]
    fn apply_undo_redo_order() {
        let mut h = Host::new(Log::default());
        assert!(!h.can_undo() && !h.can_redo());
        for s in ["a", "b", "c"] {
            h.apply(push(s)).unwrap();
        }
        assert_eq!(h.doc().0, ["a", "b", "c"]);
        h.undo().unwrap().unwrap();
        h.undo().unwrap().unwrap();
        assert_eq!(h.doc().0, ["a"]);
        assert!(h.can_undo() && h.can_redo());
        let env = h.redo().unwrap().unwrap();
        assert_eq!(env.patch.0, 2);
        assert_eq!(h.doc().0, ["a", "b"]);
        h.redo().unwrap().unwrap();
        assert_eq!(h.doc().0, ["a", "b", "c"]);
        assert!(h.redo().unwrap().is_none());
        for _ in 0..3 {
            h.undo().unwrap().unwrap();
        }
        assert!(h.doc().0.is_empty());
        assert!(h.undo().unwrap().is_none());
        assert!(!h.can_undo() && h.can_redo());
    }

    #[test]
    fn new_command_clears_redo() {
        let mut h = Host::new(Log::default());
        h.apply(push("a")).unwrap();
        h.apply(push("b")).unwrap();
        h.undo().unwrap();
        assert!(h.can_redo());
        let env = h.apply(push("x")).unwrap();
        assert!(!env.can_redo && env.can_undo);
        assert!(h.redo().unwrap().is_none());
        assert_eq!(h.doc().0, ["a", "x"]);
    }

    #[test]
    fn undo_limit_drops_oldest() {
        let mut h = Host::new(Log::default());
        assert_eq!(h.undo_limit(), DEFAULT_UNDO_LIMIT);
        h.set_undo_limit(2);
        for s in ["a", "b", "c", "d"] {
            h.apply(push(s)).unwrap();
        }
        assert!(h.undo().unwrap().is_some());
        assert!(h.undo().unwrap().is_some());
        assert!(h.undo().unwrap().is_none());
        assert_eq!(h.doc().0, ["a", "b"]);
        // The original (empty) saved state is unreachable now.
        assert!(h.is_dirty());
        h.set_undo_limit(0);
        assert!(!h.can_undo());
    }

    #[test]
    fn non_undoable_command_keeps_stacks() {
        let mut h = Host::new(Log::default());
        h.apply(push("a")).unwrap();
        h.apply(push("b")).unwrap();
        h.undo().unwrap();
        let env = h.apply(Cmd::Mark).unwrap();
        assert!(env.can_undo && env.can_redo && env.dirty);
        h.redo().unwrap().unwrap();
        assert_eq!(h.doc().0, ["a", "b"]);
    }

    #[test]
    fn revision_is_monotonic() {
        let mut h = Host::new(Log::default());
        let mut last = h.revision();
        let mut check = |r: Revision| {
            assert!(r > last, "{r:?} after {last:?}");
            last = r;
        };
        check(h.apply(push("a")).unwrap().revision);
        check(h.apply(Cmd::Mark).unwrap().revision);
        check(h.undo().unwrap().unwrap().revision);
        check(h.redo().unwrap().unwrap().revision);
        // Failures and no-op undo/redo do not bump.
        let before = h.revision();
        assert_eq!(h.apply(Cmd::Fail).unwrap_err(), Failed);
        assert!(h.redo().unwrap().is_none());
        assert_eq!(h.revision(), before);
        h.replace(Log::default());
        check(h.revision());
        assert!(!h.can_undo() && !h.is_dirty());
    }

    #[test]
    fn dirty_tracks_the_saved_state() {
        let mut h = Host::new(Log::default());
        assert!(!h.is_dirty());
        assert!(h.apply(push("a")).unwrap().dirty);
        h.mark_saved();
        assert!(!h.is_dirty());
        h.apply(push("b")).unwrap();
        assert!(h.is_dirty());
        assert!(!h.undo().unwrap().unwrap().dirty);
        assert!(h.undo().unwrap().unwrap().dirty);
        assert!(!h.redo().unwrap().unwrap().dirty);
        // Saved state in the redo branch, then the branch is replaced.
        h.undo().unwrap();
        h.apply(push("z")).unwrap();
        h.undo().unwrap();
        assert!(h.is_dirty());
        h.mark_saved();
        h.apply(Cmd::Mark).unwrap();
        assert!(h.is_dirty());
        h.mark_saved();
        assert!(!h.is_dirty());
    }

    #[test]
    fn failed_undo_keeps_the_entry() {
        let mut h = Host::new(Log::default());
        h.apply(push("a")).unwrap();
        // Corrupt the document behind the host's back: Pop now fails.
        h.doc_mut().0.clear();
        assert_eq!(h.undo().unwrap_err(), Failed);
        assert!(h.can_undo());
    }

    #[test]
    fn envelope_serializes_camel_case() {
        let mut h = Host::new(Log::default());
        let env = h.apply(push("a")).unwrap();
        assert_eq!(
            serde_json::to_string(&env).unwrap(),
            r#"{"revision":1,"patch":1,"canUndo":true,"canRedo":false,"dirty":true}"#
        );
    }
}
