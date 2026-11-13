//! Page history from the CRDT: change groups (who, when, how much) and frontiers to preview/restore.
use std::ops::ControlFlow;

use loro::{ChangeMeta, Frontiers, LoroDoc, VersionVector, ID};
use serde::{Deserialize, Serialize};

use crate::{NotesError, GENESIS_PEER};

/// Adjacent changes of the same peer within this many seconds form one group.
pub const HISTORY_MERGE_SECS: i64 = 60;

/// A group of adjacent changes by one peer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/notes/src/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct ChangeGroup {
    /// Loro peer id (decimal string: u64 does not fit a JS number).
    pub peer: String,
    /// First and last change time, Unix ms (0 when the change carried no timestamp).
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub start: i64,
    #[cfg_attr(feature = "ts", ts(type = "number"))]
    pub end: i64,
    /// Number of operations.
    pub ops: u32,
    /// The version right after this group (history order), for `CheckoutPreview` / `Restore`.
    pub frontiers: Vec<String>,
}

/// All change groups of `doc`, oldest first (causal order). The genesis (peer 0) is not listed.
#[must_use]
pub fn change_groups(doc: &LoroDoc, merge_secs: i64) -> Vec<ChangeGroup> {
    let heads: Vec<ID> = doc.oplog_frontiers().iter().collect();
    let mut changes: Vec<ChangeMeta> = Vec::new();
    let _ = doc.travel_change_ancestors(&heads, &mut |c| {
        changes.push(c);
        ControlFlow::Continue(())
    });
    changes.sort_by(|a, b| a.lamport.cmp(&b.lamport).then(a.id.peer.cmp(&b.id.peer)));
    let mut vv = VersionVector::new();
    let mut out: Vec<ChangeGroup> = Vec::new();
    let mut last_peer: Option<u64> = None;
    for c in changes {
        let len = i32::try_from(c.len).unwrap_or(i32::MAX);
        let end = c.id.counter + len;
        let cur = vv.get(&c.id.peer).copied().unwrap_or(0);
        if end > cur {
            vv.insert(c.id.peer, end);
        }
        if c.id.peer == GENESIS_PEER {
            continue;
        }
        let frontiers = frontiers_to_strings(&doc.vv_to_frontiers(&vv));
        let ts = c.timestamp * 1000;
        let ops = u32::try_from(c.len).unwrap_or(u32::MAX);
        match out.last_mut() {
            Some(g)
                if last_peer == Some(c.id.peer)
                    && ts >= g.end
                    && ts - g.end <= merge_secs * 1000 =>
            {
                g.end = ts;
                g.ops = g.ops.saturating_add(ops);
                g.frontiers = frontiers;
            }
            _ => out.push(ChangeGroup {
                peer: c.id.peer.to_string(),
                start: ts,
                end: ts,
                ops,
                frontiers,
            }),
        }
        last_peer = Some(c.id.peer);
    }
    out
}

/// Frontiers as `"counter@peer"` strings (the format of JS `OpId` strings).
#[must_use]
pub fn frontiers_to_strings(f: &Frontiers) -> Vec<String> {
    f.iter().map(|id| id.to_string()).collect()
}

pub fn frontiers_from_strings(s: &[String]) -> Result<Frontiers, NotesError> {
    let ids = s
        .iter()
        .map(|x| {
            ID::try_from(x.as_str()).map_err(|_| NotesError::Content(format!("bad op id {x}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Frontiers::from(ids))
}

#[cfg(test)]
mod tests {
    use super::*;
    use loro::CommitOptions;

    #[test]
    fn groups_merge_same_peer_within_the_window() {
        let doc = LoroDoc::new();
        doc.import(&crate::page_genesis()).unwrap();
        doc.set_peer_id(5).unwrap();
        doc.set_change_merge_interval(0);
        let t = doc.get_text("t");
        for (i, secs) in [100, 130, 160, 400].iter().enumerate() {
            t.insert(i, "x").unwrap();
            doc.commit_with(CommitOptions::new().timestamp(*secs));
        }
        let g = change_groups(&doc, HISTORY_MERGE_SECS);
        assert_eq!(g.len(), 2, "{g:?}");
        assert_eq!((g[0].start, g[0].end, g[0].ops), (100_000, 160_000, 3));
        assert_eq!(
            (g[1].start, g[1].ops, g[1].peer.as_str()),
            (400_000, 1, "5")
        );
        let f = frontiers_from_strings(&g[0].frontiers).unwrap();
        assert_eq!(doc.fork_at(&f).unwrap().get_text("t").to_string(), "xxx");
        assert_eq!(frontiers_to_strings(&f), g[0].frontiers);
        assert!(frontiers_from_strings(&["bogus".into()]).is_err());
    }
}
