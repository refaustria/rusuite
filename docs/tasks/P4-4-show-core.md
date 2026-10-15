# Task P4-4 – `show-core`: commands, patches, dispatch

Branch `p4/show-core`, worktree `/home/bojan/rusuite-wt/p4-show-core`. Scope: `apps/show/core/**` (replace placeholder), `apps/show/src/generated/`, additive helpers in `crates/model-show` (say which). Read: ADR 0001, 0002 (+amendments), 0005, 0008; `crates/model-show/src/*.rs`; `apps/write/core/src/*.rs` (mirror: doc/command/patch/dispatch/wire, ts-rs export, inverse commands, `Compound` rollback).

```rust
pub enum ShowCommand {
    AddSlide { after: Option<NodeId>, layout: LayoutKind, new_ids: Vec<i64> /* slide + placeholder shapes */ }, DeleteSlides { ids: Vec<NodeId> }, DuplicateSlide { id: NodeId, new_ids: Vec<i64> }, MoveSlide { id: NodeId, to_index: u32 },
    SetSlideBackground { slide: NodeId, fill: Option<Fill> },
    AddShape { slide: NodeId, shape: NewShape /* temp ids */, index: Option<u32> }, DeleteShapes { ids: Vec<NodeId> },
    SetTransform { shapes: Vec<(NodeId, Transform)> }, SetShapeStyle { shapes: Vec<NodeId>, fill: Option<Option<Fill>>, line: Option<Option<Line>> },   // Option<Option<_>>: None = unchanged, Some(None) = clear
    SetTextBody { shape: NodeId, body: TextBody }, SetRunProps { shape: NodeId, paragraph: u32, from: u32, to: u32, patch: RunProperties }, SetParagraphProps { shape: NodeId, paragraphs: Vec<u32>, patch: TextParagraphProps },
    SetName { shape: NodeId, name: String },
    ZOrder { shapes: Vec<NodeId>, op: ZOp { BringForward, SendBackward, BringToFront, SendToBack } },
    Align { shapes: Vec<NodeId>, mode: AlignMode, to: AlignTarget { Slide, Selection } }, Distribute { shapes, axis },
    Group { shapes: Vec<NodeId>, new_id: i64 }, Ungroup { group: NodeId },
    InsertPicture { slide: NodeId, content_type, bytes_base64, transform: Option<Transform> /* None = fit centered at natural size capped to slide */, new_id: i64 },
    SetSlideSize { size: SlideSize },
    Compound { commands },
    // internal inverses: RestoreSlides { after, slides }, RestoreShapes { slide, index, shapes }, RestoreTextBody, RestoreOrder { slide, ids }, RemoveMedia/RestoreMedia, …
}
pub struct ShowPatch { pub slides_order: Option<Vec<NodeId>>, pub slides: Vec<Slide> /* full slides whose content changed (shapes are small) */, pub deleted_slides: Vec<NodeId>, pub id_map: Vec<(i64, NodeId)>, pub slide_size: Option<SlideSize>, pub info: Option<String> }
```
- Requests: `apply`, `undo`, `redo`, `load{presentation}`, `getPresentation`, `newPresentation`, `getMedia{id}`, `documentState`, `markSaved{name?}` (pptx open/save come with P4-7). `pub fn dispatch_with(&mut ShowHost, &str) -> String`.
- Patches are per slide (whole `Slide`); keep it simple. Every command has an exact inverse; undo of a scripted 20-command session restores an identical presentation (test like write-core).
- Tests per command, z-order/align/group semantics (group absolute positions preserved on group/ungroup), text run offsets with emoji, dispatch JSON incl. errors; ts-rs export to `apps/show/src/generated/` stable; wasm check; rustdoc clean.
