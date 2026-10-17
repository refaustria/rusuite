//! Shapes and text boxes (`InsertDrawing`, `SetDrawingProps`,
//! `SetDrawingText`), picture formatting and links and Change Case.
//!
//! A drawing is one inline position of its paragraph; its text blocks are
//! a nested container (the drawing's id is the container id) that the text
//! commands address by block id like table cells. Every edit of a drawing
//! replaces the inline (`RestoreInlines` is the exact inverse, ids
//! included); edits inside its text report the paragraph holding it.

use model_text::{Alignment, Drawing, DrawingKind, DrawingText, PictureFormat, VAlignPos};

use super::*;
use crate::command::TextCase;

/// Default size of a shape or text box inserted with a click (Word: 1
/// inch square shapes; text boxes 2 × 1 inches are set by the UI).
const MAX_DRAWING_EMU: i64 = 20 * 914_400;

impl WriteDocument {
    /// The drawing at position `offset` of `block`.
    fn drawing_at(&self, block: NodeId, offset: u32) -> R<Drawing> {
        let (at, _) = self.range(block, offset, offset)?;
        let p = self.para(block)?;
        match slice(p, at, (at + 1).min(p.len())).into_iter().next() {
            Some(Inline::Drawing(d)) => Ok(*d),
            _ => Err(invalid(format!(
                "no drawing at {offset} in block {}",
                block.0
            ))),
        }
    }

    /// Puts `d` in place of the drawing at `offset` of `block`.
    fn replace_drawing(
        &mut self,
        block: NodeId,
        offset: u32,
        d: Drawing,
        ch: &mut Changes,
    ) -> R<C> {
        self.restore_inlines(
            block,
            offset,
            offset + 1,
            vec![Inline::Drawing(Box::new(d))],
            false,
            ch,
        )
    }

    pub(super) fn insert_drawing(&mut self, cmd: &C, ch: &mut Changes) -> R<C> {
        let C::InsertDrawing {
            block,
            offset,
            kind,
            preset,
            width,
            height,
            anchor,
            text,
        } = cmd
        else {
            unreachable!("insert_drawing takes InsertDrawing");
        };
        let (at, _) = self.range(*block, *offset, *offset)?;
        if self.doc.drawing_host(*block).is_some() {
            return Err(invalid("drawings cannot be placed inside a text box"));
        }
        if width.0 <= 0 || height.0 <= 0 || width.0 > MAX_DRAWING_EMU || height.0 > MAX_DRAWING_EMU
        {
            return Err(invalid("drawing size out of range"));
        }
        if preset.is_empty() || !preset.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(invalid(format!("invalid preset {preset:?}")));
        }
        let id = self.doc.alloc_id();
        let pid = self.doc.alloc_id();
        let mut para = Paragraph::with_text(pid, text.as_deref().unwrap_or(""));
        let mut d = match kind {
            DrawingKind::TextBox => Drawing::text_box(id, *width, *height, Vec::new()),
            DrawingKind::Shape => {
                // Word centres the text of a shape both ways.
                para.props.alignment = Some(Alignment::Center);
                let mut d = Drawing::shape(id, preset, *width, *height);
                let mut t = DrawingText::new(Vec::new());
                t.vertical_align = VAlignPos::Center;
                d.text = Some(t);
                d
            }
            DrawingKind::Group | DrawingKind::Picture => {
                return Err(invalid("groups are made from existing drawings"))
            }
        };
        if let Some(blocks) = d.blocks_mut() {
            blocks.push(Block::Paragraph(para));
        }
        d.anchor = *anchor;
        replace_range(
            self.para_mut(*block)?,
            at,
            at,
            vec![Inline::Drawing(Box::new(d))],
        );
        ch.block(*block);
        Ok(C::DeleteText {
            block: *block,
            from: *offset,
            to: *offset + 1,
        })
    }

    pub(super) fn set_drawing_props(
        &mut self,
        block: NodeId,
        offset: u32,
        new: &Drawing,
        ch: &mut Changes,
    ) -> R<C> {
        let old = self.drawing_at(block, offset)?;
        if new.width.0 <= 0 || new.height.0 <= 0 {
            return Err(invalid("drawing size must be positive"));
        }
        if new.width.0 > MAX_DRAWING_EMU || new.height.0 > MAX_DRAWING_EMU {
            return Err(invalid("drawing size out of range"));
        }
        if new.preset.is_empty() {
            return Err(invalid("missing preset"));
        }
        let mut d = new.clone();
        d.id = old.id;
        d.text = match (new.text.as_ref(), old.text) {
            (None, _) => None,
            (Some(t), Some(mut o)) => {
                o.insets = t.insets;
                o.vertical_align = t.vertical_align;
                o.autofit = t.autofit;
                o.wrap = t.wrap;
                Some(o)
            }
            (Some(t), None) => {
                let mut t = t.clone();
                t.blocks = self.fresh_text_blocks(&t.blocks, &[], ch)?;
                Some(t)
            }
        };
        if d.kind == DrawingKind::TextBox && d.text.is_none() {
            return Err(invalid("a text box keeps its text"));
        }
        if d.kind.is_container() != old.kind.is_container() {
            return Err(invalid("a group stays a group"));
        }
        if d.kind.is_container() && d.children.is_empty() {
            return Err(invalid("a group needs members"));
        }
        // A box later in a chain shows the first box's text: it has none.
        if d.chain.is_some_and(|c| c.seq > 0) {
            if d.kind != DrawingKind::TextBox {
                return Err(invalid("only text boxes are linked"));
            }
            if let Some(t) = d.text.as_mut() {
                let pid = t.blocks.iter().find_map(|b| match b {
                    Block::Paragraph(p) => Some(p.id),
                    _ => None,
                });
                let empty =
                    matches!(t.blocks.as_slice(), [Block::Paragraph(p)] if p.inlines.is_empty());
                if !empty {
                    let id = pid.unwrap_or_else(|| self.doc.alloc_id());
                    t.blocks = vec![Block::Paragraph(Paragraph::new(id))];
                    ch.block(id);
                }
            }
        }
        // Group members (and their text) come with the command; their ids
        // are kept where unused, else fresh.
        let freed: Vec<NodeId> = old
            .children
            .iter()
            .flat_map(|c| c.walk())
            .flat_map(|c| std::iter::once(c.id).chain(subtree_ids(c.blocks())))
            .collect();
        let mut ids = Ids::new(&self.doc, &freed);
        let mut fail = None;
        for c in &mut d.children {
            c.walk_mut(&mut |m| {
                m.id = ids.keep_or_alloc(&mut self.doc, m.id);
                if let Some(t) = m.text.as_mut() {
                    let mut out = Vec::with_capacity(t.blocks.len());
                    for b in &t.blocks {
                        match ids.block(&mut self.doc, ch, &NewBlock::from(b)) {
                            Ok(mut b) => {
                                strip_nested_drawings(&mut b);
                                out.push(b);
                            }
                            Err(e) => fail = Some(e),
                        }
                    }
                    if !matches!(out.last(), Some(Block::Paragraph(_))) {
                        out.push(Block::Paragraph(Paragraph::new(self.doc.alloc_id())));
                    }
                    t.blocks = out;
                }
                if m.kind == DrawingKind::TextBox && m.text.is_none() {
                    m.text = Some(DrawingText::new(vec![Block::Paragraph(Paragraph::new(
                        self.doc.alloc_id(),
                    ))]));
                }
            });
        }
        if let Some(e) = fail {
            return Err(e);
        }
        self.replace_drawing(block, offset, d, ch)
    }

    pub(super) fn set_drawing_text(
        &mut self,
        block: NodeId,
        offset: u32,
        blocks: Option<&[NewBlock]>,
        ch: &mut Changes,
    ) -> R<C> {
        let mut d = self.drawing_at(block, offset)?;
        match blocks {
            None => {
                if d.kind == DrawingKind::TextBox {
                    return Err(invalid("a text box keeps its text"));
                }
                d.text = None;
            }
            Some(new) => {
                let freed = subtree_ids(d.blocks());
                let mut ids = Ids::new(&self.doc, &freed);
                let mut out = Vec::with_capacity(new.len());
                for b in new {
                    let mut b = ids.block(&mut self.doc, ch, b)?;
                    strip_nested_drawings(&mut b);
                    out.push(b);
                }
                if !matches!(out.last(), Some(Block::Paragraph(_))) {
                    out.push(Block::Paragraph(Paragraph::new(self.doc.alloc_id())));
                }
                match &mut d.text {
                    Some(t) => t.blocks = out,
                    None => {
                        let mut t = DrawingText::new(out);
                        t.vertical_align = VAlignPos::Center;
                        d.text = Some(t);
                    }
                }
            }
        }
        self.replace_drawing(block, offset, d, ch)
    }

    /// Blocks for the text of a drawing from `blocks` (ids kept when
    /// unused, else fresh; no drawings inside; ends with a paragraph).
    fn fresh_text_blocks(
        &mut self,
        blocks: &[Block],
        freed: &[NodeId],
        ch: &mut Changes,
    ) -> R<Vec<Block>> {
        let mut ids = Ids::new(&self.doc, freed);
        let mut out = Vec::with_capacity(blocks.len());
        for b in blocks {
            let nb = NewBlock::from(b);
            let mut b = ids.block(&mut self.doc, ch, &nb)?;
            strip_nested_drawings(&mut b);
            out.push(b);
        }
        if !matches!(out.last(), Some(Block::Paragraph(_))) {
            out.push(Block::Paragraph(Paragraph::new(self.doc.alloc_id())));
        }
        Ok(out)
    }

    pub(super) fn set_image_format(
        &mut self,
        block: NodeId,
        offset: u32,
        format: &PictureFormat,
        ch: &mut Changes,
    ) -> R<C> {
        let mut f = format.clone();
        for v in [&mut f.brightness, &mut f.contrast] {
            *v = (*v).clamp(-100_000, 100_000);
        }
        let c = &mut f.crop;
        if c.left + c.right >= 100_000 || c.top + c.bottom >= 100_000 {
            return Err(invalid("the crop leaves nothing of the picture"));
        }
        if f.geometry.as_deref() == Some("rect") {
            f.geometry = None;
        }
        self.edit_image(block, offset, ch, |img| img.format = f)
    }

    pub(super) fn change_case(
        &mut self,
        block: NodeId,
        from: u32,
        to: u32,
        case: TextCase,
        ch: &mut Changes,
    ) -> R<C> {
        let (f, t) = self.range(block, from, to)?;
        let p = self.para(block)?;
        let chars: Vec<char> = p.text().chars().collect();
        let mut inl = slice(p, f, t);
        let before = inl.clone();
        let mut pos = f;
        for inline in &mut inl {
            match inline {
                Inline::Run(run) => {
                    let mut s = String::with_capacity(run.text.len());
                    for c in run.text.chars() {
                        s.push_str(&transform_char(&chars, pos, c, case));
                        pos += 1;
                    }
                    run.text = s;
                }
                _ => pos += 1,
            }
        }
        if inl == before {
            return Ok(C::Compound {
                commands: Vec::new(),
            });
        }
        self.restore_inlines(block, from, to, inl, false, ch)
    }
}

/// Removes drawings from the paragraphs of `b` (text boxes do not nest).
fn strip_nested_drawings(b: &mut Block) {
    for_each_paragraph_mut(b, &mut |p| {
        p.inlines.retain(|i| !matches!(i, Inline::Drawing(_)))
    });
}

/// Whether the char at `i` of `chars` starts a word.
fn word_start(chars: &[char], i: usize) -> bool {
    i == 0 || !chars[i - 1].is_alphanumeric() && chars[i - 1] != '\''
}

/// Whether the letter at `i` starts a sentence: nothing but spaces, quotes
/// and brackets since the paragraph start or since `.`, `!` or `?`
/// followed by a space.
fn sentence_start(chars: &[char], i: usize) -> bool {
    let mut j = i;
    let mut spaced = false;
    while j > 0 {
        let c = chars[j - 1];
        if c.is_whitespace() {
            spaced = true;
        } else if matches!(c, '.' | '!' | '?') {
            return spaced;
        } else if !matches!(
            c,
            '"' | '\'' | '(' | '[' | '“' | '‘' | '«' | '„' | '\u{FEFF}'
        ) {
            return false;
        }
        j -= 1;
    }
    true
}

/// `c` (at index `i` of the paragraph text `chars`) in case `case`.
fn transform_char(chars: &[char], i: usize, c: char, case: TextCase) -> String {
    let upper = || c.to_uppercase().collect::<String>();
    let lower = || c.to_lowercase().collect::<String>();
    match case {
        TextCase::Upper => upper(),
        TextCase::Lower => lower(),
        TextCase::Toggle if c.is_uppercase() => lower(),
        TextCase::Toggle if c.is_lowercase() => upper(),
        TextCase::Toggle => c.to_string(),
        TextCase::Capitalize if word_start(chars, i) => upper(),
        TextCase::Capitalize => lower(),
        TextCase::Sentence if c.is_alphabetic() && sentence_start(chars, i) => upper(),
        TextCase::Sentence => lower(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(s: &str, case: TextCase) -> String {
        let chars: Vec<char> = s.chars().collect();
        chars
            .iter()
            .enumerate()
            .map(|(i, &c)| transform_char(&chars, i, c, case))
            .collect()
    }

    #[test]
    fn cases() {
        let s = "hello WORLD. it's me! ok?no";
        assert_eq!(apply(s, TextCase::Upper), "HELLO WORLD. IT'S ME! OK?NO");
        assert_eq!(apply(s, TextCase::Lower), "hello world. it's me! ok?no");
        assert_eq!(apply(s, TextCase::Toggle), "HELLO world. IT'S ME! OK?NO");
        assert_eq!(
            apply(s, TextCase::Capitalize),
            "Hello World. It's Me! Ok?No"
        );
        assert_eq!(apply(s, TextCase::Sentence), "Hello world. It's me! Ok?no");
        assert_eq!(apply("straße", TextCase::Upper), "STRASSE");
    }
}
