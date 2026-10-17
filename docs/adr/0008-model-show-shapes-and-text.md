# ADR 0008 – `model-show`: slides, shapes and DrawingML-shaped text

- Status: accepted
- Date: 2026-10-15

## Context
Show needs a slide/shape model that maps to PresentationML + DrawingML (`.pptx`) and to a Konva object model in the frontend (README). Text in shapes follows DrawingML (`a:p` with level/bullet per paragraph, `a:r` runs), which differs from WordprocessingML paragraphs (styles, numbering definitions).

## Decision
- `Presentation { slide_size, slides: Vec<Slide>, layouts: [Layout; 3] (Title, TitleContent, Blank), theme: core_model::Theme, media: core_model::MediaStore }`. Masters/layouts are **fixed built-ins** written as minimal parts on save; layouts of imported files are not preserved beyond placeholder positions (documented in `docs/ooxml-subset.md`).
- `Slide { id, layout: LayoutKind, shapes: Vec<Shape> /* z-order = vector order */, background: Option<Fill> }`.
- `Shape { id, name, transform: Transform { x, y, w, h: Emu, rotation_deg, flip_h, flip_v }, kind: ShapeKind, fill, line, placeholder: Option<PlaceholderKind> }` with `ShapeKind = Auto { geometry: Preset { Rect | RoundRect | Ellipse | Line }, text: Option<TextBody> } | Picture { media: MediaId } | Group { children: Vec<Shape> }`. A text box is an `Auto Rect` without fill/line. Groups carry their own transform; child coordinates are relative to the group (as in `a:grpSpPr/a:xfrm` with `chOff/chExt`).
- `TextBody { props: BodyProps { anchor: Top|Middle|Bottom, wrap: bool, insets: Insets, autofit: None|Shrink|Resize }, paragraphs: Vec<TextParagraph { props: TextParagraphProps { alignment, level: u8, bullet: Option<Bullet { None | Char(String) | AutoNum(Scheme) }>, spacing_before, spacing_after, line_spacing }, runs: Vec<TextRun { props: core_model::RunProperties, text }> }> }`. Run formatting reuses `core_model::RunProperties` (ADR 0003) so the Write toolbar works unchanged.
- `MediaStore` moves from `model-text` to `core-model` (`model-text` re-exports it) because images are shared by Write and Show (README: images are core-model).
- Stable `NodeId`s for slides and shapes (same scheme as ADR 0006); commands address shapes by id; patches carry whole shapes or whole slides.

## Consequences
- The Konva frontend renders from the model (shapes → Konva nodes keyed by id); text editing uses an overlay editor that submits a whole `TextBody` (small) – no ProseMirror in Show.
- Presentation mode is a frontend-only render of the same model.
- Animations/transitions remain out of scope (README non-goal).

## Amendment 2026-10-15 – transitions and animations are in scope
The owner approved transitions and animations (parity backlog, Show tier 1). `Slide.transition` and `Slide.animations` (model-show `anim.rs`) model PowerPoint's presets we support (transitions: fade/push/wipe/cover/split/cut/zoom; entrance/exit: appear/fade/fly-in/wipe/zoom; emphasis: spin/grow-shrink) with PowerPoint's own `p:transition`/`p:timing` XML on save; unsupported effects are read as warnings and dropped. The "no animations" line in the Consequences section is superseded.

## Amendment 2026-10-16 (P8-19): themes, one editable master, layouts, sections

Masters and layouts are no longer fixed built-ins. A presentation has exactly one editable `SlideMaster` (background, placeholders, decorative shapes, title/body/other text styles with 9 levels, colour map, header/footer settings) and a list of `Layout`s (the 11 standard kinds plus `custom:<name>`), identified by kind rather than by id. Slides reference a layout; placeholder geometry and text defaults resolve slide → layout → master. The `Theme` carries the full format scheme and 8 built-in designs (Office plus 7 own designs) ship as data; `ApplyTheme` re-themes master and layouts in place. Sections (`p14:sectionLst`), header/footer fields (slide number, date formats) and picture adjustments (crop, brightness/contrast, recolour, transparency, shadow) are part of the model. Any design change is reported in one patch (`theme`, `master`, `layouts`).

## Amendment 2026-10-17 (P9-S5): several designs per deck

The P8-19 amendment fixed "one editable master" per presentation. P9-S5 (Reuse Slides with "Keep source formatting",
theme import from `.thmx`/`.potx`/`.pptx`) needs decks that carry more than one master, as PowerPoint files do.
Decision: `Presentation.designs: Vec<Design>` (a design = master + theme + its layouts), `Slide.design` names the design a
slide uses; `fmt-pptx` reads every `p:sldMasterId` and writes `slideMasterN`/`themeN` parts. The first design stays the
"main" one: layout galleries, the Slide Master view and the editor palettes show it only (follow-up in ROADMAP). Colour
maps (`p:clrMap`, slide `clrMapOvr`) are honoured per design. Everything else in this ADR is unchanged.
