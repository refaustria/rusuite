//! Word's undo steps for typing: consecutive characters typed (or deleted
//! with Backspace / Delete) at one place of a paragraph are one undo step
//! ("Typing"), not one step per key. The [`Host`](app_common::Host) keeps
//! one inverse per command; this records how many of them the next Undo /
//! Redo request takes together. It lives with the document (a replaced
//! document starts with empty groups).

use crate::WriteCommand;
use model_text::NodeId;

/// Where the current typing run continues.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Run {
    /// Text inserted up to `end` (char offset) of `block`.
    Typing { block: NodeId, end: u32 },
    /// Text deleted at `at` of `block` (Backspace: the next deletion ends
    /// there, Delete: it starts there).
    Deleting { block: NodeId, at: u32 },
}

/// The effect of a command on the groups (see [`UndoGroups::plan`]).
#[derive(Debug, Clone, Copy)]
pub struct Planned {
    next: Option<Run>,
    joins: bool,
}

/// Group sizes parallel to the host's undo and redo stacks.
#[derive(Debug, Clone, Default)]
pub struct UndoGroups {
    undo: Vec<usize>,
    redo: Vec<usize>,
    run: Option<Run>,
}

/// Groups are bookkeeping, not document content.
impl PartialEq for UndoGroups {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}

/// The typing run `cmd` belongs to and whether it may continue the
/// current one (a compound, e.g. typing over a selection, starts a run).
fn run_of(cmd: &WriteCommand) -> (Option<Run>, bool) {
    match cmd {
        WriteCommand::InsertText {
            block,
            offset,
            text,
            ..
        } if !text.contains('\n') => (
            Some(Run::Typing {
                block: *block,
                end: offset + text.chars().count() as u32,
            }),
            true,
        ),
        WriteCommand::DeleteText { block, from, to } if to > from => (
            Some(Run::Deleting {
                block: *block,
                at: *from,
            }),
            true,
        ),
        WriteCommand::Compound { commands } => (commands.last().and_then(|c| run_of(c).0), false),
        _ => (None, false),
    }
}

/// Whether `next` continues `prev` (`cmd` is the command of `next`).
fn continues(prev: Run, next: Run, cmd: &WriteCommand) -> bool {
    match (prev, next, cmd) {
        (
            Run::Typing { block: a, end },
            Run::Typing { block: b, .. },
            WriteCommand::InsertText { offset, .. },
        ) => a == b && *offset == end,
        (
            Run::Deleting { block: a, at },
            Run::Deleting { block: b, .. },
            WriteCommand::DeleteText { from, to, .. },
        ) => a == b && (*to == at || *from == at),
        _ => false,
    }
}

impl UndoGroups {
    /// What `cmd` would do to the groups, decided before it is applied
    /// (the command is consumed by the host).
    pub fn plan(&self, cmd: &WriteCommand) -> Planned {
        let (next, may_continue) = run_of(cmd);
        let joins = match (self.run, next) {
            (Some(prev), Some(next)) => {
                may_continue && !self.undo.is_empty() && continues(prev, next, cmd)
            }
            _ => false,
        };
        Planned { next, joins }
    }

    /// Records an applied (undoable) command planned with [`plan`](Self::plan);
    /// `limit` is the host's undo depth.
    pub fn applied(&mut self, planned: Planned, limit: usize) {
        self.redo.clear();
        match self.undo.last_mut() {
            Some(top) if planned.joins => *top += 1,
            _ => self.undo.push(1),
        }
        self.run = planned.next;
        // The host drops its oldest entries beyond the limit.
        let mut total: usize = self.undo.iter().sum();
        while total > limit && !self.undo.is_empty() {
            let first = &mut self.undo[0];
            let drop = (*first).min(total - limit);
            *first -= drop;
            total -= drop;
            if *first == 0 {
                self.undo.remove(0);
            }
        }
    }

    /// How many host entries the next Undo reverts (1 when unknown).
    pub fn take_undo(&mut self) -> usize {
        self.run = None;
        self.undo.pop().unwrap_or(1)
    }

    /// `n` entries were undone: one Redo step.
    pub fn undone(&mut self, n: usize) {
        self.redo.push(n);
    }

    /// How many host entries the next Redo re-applies (1 when unknown).
    pub fn take_redo(&mut self) -> usize {
        self.run = None;
        self.redo.pop().unwrap_or(1)
    }

    /// `n` entries were redone: one Undo step.
    pub fn redone(&mut self, n: usize) {
        self.undo.push(n);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ins(block: u64, offset: u32, text: &str) -> WriteCommand {
        WriteCommand::InsertText {
            block: NodeId(block),
            offset,
            text: text.into(),
            props: None,
            style: None,
            link: None,
        }
    }

    fn del(block: u64, from: u32, to: u32) -> WriteCommand {
        WriteCommand::DeleteText {
            block: NodeId(block),
            from,
            to,
        }
    }

    fn apply(g: &mut UndoGroups, cmd: &WriteCommand, limit: usize) {
        let p = g.plan(cmd);
        g.applied(p, limit);
    }

    #[test]
    fn typing_in_a_row_is_one_step() {
        let mut g = UndoGroups::default();
        for (i, c) in "abc".chars().enumerate() {
            apply(&mut g, &ins(1, i as u32, &c.to_string()), 200);
        }
        assert_eq!(g.undo, vec![3]);
        // A jump elsewhere starts a new step; so does another paragraph.
        apply(&mut g, &ins(1, 0, "x"), 200);
        apply(&mut g, &ins(2, 0, "y"), 200);
        assert_eq!(g.undo, vec![3, 1, 1]);
    }

    #[test]
    fn backspaces_and_deletes_group_typing_does_not_join_them() {
        let mut g = UndoGroups::default();
        apply(&mut g, &ins(1, 0, "abcd"), 200);
        apply(&mut g, &del(1, 3, 4), 200);
        apply(&mut g, &del(1, 2, 3), 200);
        apply(&mut g, &ins(1, 2, "z"), 200);
        apply(&mut g, &del(1, 0, 1), 200);
        apply(&mut g, &del(1, 0, 1), 200);
        assert_eq!(g.undo, vec![1, 2, 1, 2]);
    }

    #[test]
    fn other_commands_end_the_run_and_undo_redo_move_groups() {
        let mut g = UndoGroups::default();
        apply(&mut g, &ins(1, 0, "a"), 200);
        apply(&mut g, &ins(1, 1, "b"), 200);
        apply(
            &mut g,
            &WriteCommand::SplitParagraph {
                block: NodeId(1),
                offset: 2,
                new_id: -1,
            },
            200,
        );
        apply(&mut g, &ins(1, 2, "c"), 200);
        assert_eq!(g.undo, vec![2, 1, 1]);
        assert_eq!(g.take_undo(), 1);
        g.undone(1);
        // After an undo the next typing never joins the step below.
        assert_eq!(g.take_redo(), 1);
        g.redone(1);
        apply(&mut g, &ins(1, 3, "d"), 200);
        assert_eq!(g.undo, vec![2, 1, 1, 1]);
        assert!(g.redo.is_empty());
    }

    #[test]
    fn the_limit_trims_the_oldest_entries() {
        let mut g = UndoGroups::default();
        for i in 0..5 {
            apply(&mut g, &ins(1, i, "a"), 3);
        }
        assert_eq!(g.undo, vec![3]);
        apply(&mut g, &ins(2, 0, "a"), 3);
        assert_eq!(g.undo, vec![2, 1]);
    }
}
