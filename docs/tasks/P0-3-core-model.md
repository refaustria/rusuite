# Task P0-3 – `core-model`: run formatting, colors, fonts, theme

Branch: `p0/core-model` (worktree `/home/bojan/rusuite-wt/p0-core-model`). In scope: `crates/core-model/**` only.

## Goal
Implement the Phase 0 part of the shared document model: character-run formatting, colors (RGB / theme-based with tint-shade / automatic), font specification and size, and the theme (color scheme + font scheme) with the Office defaults. These types will be reused verbatim by `model-text`, `model-sheet` and `model-show` and shipped over IPC as JSON, so serde shape matters. Format-specific details (Word's 16 highlight names, Excel's indexed colors, DrawingML `<a:srgbClr>`) do NOT belong here – they are mapped in the fmt crates later.

## Required types (module layout: `color.rs`, `font.rs`, `theme.rs`, `run.rs`, re-exported from `lib.rs`)
All public types: `Debug, Clone, PartialEq, Serialize, Deserialize`; `#[serde(rename_all = "camelCase")]` on structs and enums; enums with data use `#[serde(tag = "kind")]` or `tag`+`content` as appropriate so TypeScript gets a discriminated union. Add `Eq, Hash, Copy` where cheap.

### color
- `Rgb { r: u8, g: u8, b: u8 }` – `Copy, Eq, Hash`. `Rgb::new`, `Rgb::from_hex(&str)` accepting `"FF0000"`, `"#FF0000"`, `"ff0000"` and 8-digit `AARRGGBB` (alpha ignored); `to_hex()` → `"FF0000"` (uppercase, 6 digits). Serde as a hex string `"FF0000"` (custom impl), not as a struct. `Display` = hex.
- `ThemeColorSlot` enum: `Dark1, Light1, Dark2, Light2, Accent1, …, Accent6, Hyperlink, FollowedHyperlink` (12). `from_ooxml_name(&str)` accepting scheme names (`dk1 lt1 dk2 lt2 accent1.. hlink folHlink`) AND the mapped names used by Word/Excel (`tx1→Dark1, bg1→Light1, tx2→Dark2, bg2→Light2`); `ooxml_scheme_name()` returns the `dk1` form. `ALL: [ThemeColorSlot; 12]`.
- `Color` enum: `Auto`, `Rgb(Rgb)`, `Theme { slot: ThemeColorSlot, tint: f64 }` where tint is in `-1.0..=1.0` (negative = shade/darken, positive = lighten, 0 = none; this is Excel's single `tint` number; Word's separate `themeTint`/`themeShade` bytes map onto it later in fmt-docx).
- `ColorScheme { name: String, colors: [Rgb; 12] }` indexed by slot: `get(slot) -> Rgb`, `set`. `Default` = the Office theme (2013–2022): dk1 000000, lt1 FFFFFF, dk2 44546A, lt2 E7E6E6, accent1 4472C4, accent2 ED7D31, accent3 A5A5A5, accent4 FFC000, accent5 5B9BD5, accent6 70AD47, hlink 0563C1, folHlink 954F72; name "Office".
- `Color::resolve(&self, scheme: &ColorScheme, auto: Rgb) -> Rgb`. Tint algorithm = the Excel/ECMA one (as implemented by openpyxl/ClosedXML): convert RGB→HLS with L in 0..=1; if tint < 0: `L' = L * (1 + tint)`; if tint > 0: `L' = L * (1 - tint) + tint`; convert back, round to nearest u8. Also expose `apply_tint(Rgb, f64) -> Rgb`.
  Reference values (assert each channel within ±1): `FFFFFF` tint -0.05→`F2F2F2`, -0.15→`D9D9D9`, -0.25→`BFBFBF`, -0.35→`A6A6A6`, -0.50→`808080`; `000000` tint 0.05→`F2F2F2`, 0.15→`D9D9D9`, 0.25→`BFBFBF`, 0.35→`A6A6A6`, 0.50→`808080`; `4F81BD` tint 0.80→`DCE6F1`, 0.60→`B8CCE4`, 0.40→`95B3D7`, -0.25→`376092`, -0.50→`244061`; `C0504D` tint 0.60→`E6B9B8`, -0.25→`953735`. If a reference fails by more than ±1, the algorithm is wrong – fix the algorithm, never the reference.

### font
- `FontSize` newtype storing **hundredths of a point** as `u32` (exact for Word half-points ×50, PowerPoint `sz="1800"` ×1, Excel decimal points ×100). Constructors `from_pt(f64)`, `from_half_points(u32)`, `from_hundredths(u32)`; accessors `pt() -> f64`, `half_points() -> u32` (rounded), `hundredths()`. Serde as the plain integer hundredths. `Copy, Eq, Hash, Ord`.
- `ThemeFontSlot` enum: `MajorLatin, MinorLatin, MajorEastAsian, MinorEastAsian, MajorComplexScript, MinorComplexScript`.
- `FontFace` enum: `Named(String)` | `Theme(ThemeFontSlot)`. (Per-script font variants ascii/hAnsi/eastAsia/cs are a fmt-docx concern; the model keeps one face.)
- `FontScheme { name: String, major_latin: String, minor_latin: String, major_east_asian: String, minor_east_asian: String, major_complex_script: String, minor_complex_script: String }` with `get(slot) -> &str`; `Default` = name "Office", major "Calibri Light", minor "Calibri", east-asian/complex-script empty strings (meaning "inherit"). `FontFace::resolve(&self, &FontScheme) -> &str`.

### theme
- `Theme { name: String, colors: ColorScheme, fonts: FontScheme }` with `Default` = "Office".

### run
- `Underline` enum: `None, Single, Double, Dotted, Dashed, Wavy`.
- `VerticalAlign` enum: `Baseline, Superscript, Subscript`.
- `RunProperties` – every field `Option<_>` where `None` means "inherit from the style / parent" and `Some(false)` means "explicitly off": `font: Option<FontFace>`, `size: Option<FontSize>`, `bold: Option<bool>`, `italic: Option<bool>`, `underline: Option<Underline>`, `strike: Option<bool>`, `color: Option<Color>`, `highlight: Option<Color>`, `vertical_align: Option<VerticalAlign>`. `#[serde(default, skip_serializing_if = "Option::is_none")]` on every field. Methods: `Default` (all None), `is_empty()`, `merged_with(&self, over: &RunProperties) -> RunProperties` (fields `Some` in `over` win), `apply(&mut self, over)`.

## Tests (required)
- Rgb parse/format edge cases (all accepted forms, rejection of bad input with a `ColorParseError` thiserror type).
- All tint reference values listed above.
- ThemeColorSlot name mapping both directions incl. `tx1/bg1`.
- FontSize conversions are exact for 11pt, 10.5pt, half-points 21, pptx 1800.
- RunProperties merge semantics (None/Some(true)/Some(false)).
- `insta` JSON snapshot tests (`insta` with `serde_json` – add `serde_json` and `insta` as dev-dependencies) for: a fully populated `RunProperties`, `Theme::default()`, and each `Color` variant. Commit the `.snap` files (`cargo insta` is NOT installed; use `INSTA_UPDATE=always cargo test` once, then review the snapshots and run tests again normally).
- Doc comments on every public item; `cargo doc -p core-model --no-deps` must build without warnings (`RUSTDOCFLAGS="-D warnings"`).

## Non-goals here
No paragraph properties, styles, images, borders, number formats, units (EMU/twips) – later phases. No format-specific names.
