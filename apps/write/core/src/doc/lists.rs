//! List galleries and presets (`ApplyNumbering`): Word's numbering,
//! bullet and multilevel list libraries, Define New Number Format /
//! Define New Bullet, and heading numbering (levels linked to the Heading
//! styles, whose numbering then points to the list).

use model_text::{Level, ListPreset};

use super::*;

impl WriteDocument {
    /// The nine levels a new list gets from `ApplyNumbering`: explicit
    /// `levels`, a multilevel `preset`, or the list of the first item (Word's
    /// default list of the format's kind when it has none) with level
    /// `at` replaced by a single-level `format` / `preset` (keeping that
    /// level's indent, restart rule and style link).
    fn numbering_levels(
        &self,
        levels: &[Level],
        preset: Option<ListPreset>,
        format: Option<&Level>,
        first: NodeId,
        at: u8,
    ) -> R<Vec<Level>> {
        if !levels.is_empty() {
            return Ok(levels.to_vec());
        }
        if let Some(l) = preset.and_then(ListPreset::levels) {
            return Ok(l);
        }
        let format = format
            .cloned()
            .or_else(|| preset.and_then(|p| p.level_format(at)))
            .ok_or_else(|| invalid("no levels, preset or format"))?;
        let bullet = format.kind == model_text::LevelKind::Bullet;
        let current = self
            .numbering_of(self.para(first)?)
            .and_then(|n| self.doc.numbering.get(n.num_id))
            .map(|d| d.levels.clone());
        let fallback = if bullet {
            NumberingDef::bullet_default(0).levels
        } else {
            NumberingDef::decimal_default(0).levels
        };
        let mut out = current.unwrap_or_else(|| fallback.clone());
        while out.len() < 9 {
            out.push(fallback[out.len()].clone());
        }
        let i = usize::from(at.min(8));
        let old = &out[i];
        out[i] = Level {
            indent: format.indent.or(old.indent),
            restart: old.restart,
            style: old.style.clone(),
            ..format
        };
        Ok(out)
    }

    /// `ApplyNumbering`: a new list for `items` (`[paragraph, level]`). A
    /// level linked to a paragraph style (heading presets) numbers that
    /// style: the style's numbering points to the level, and items on that
    /// level get the style instead of direct numbering (as in Word).
    pub(super) fn apply_numbering(
        &mut self,
        levels: &[Level],
        preset: Option<ListPreset>,
        format: Option<&Level>,
        items: &[(NodeId, u8)],
        ch: &mut Changes,
    ) -> R<C> {
        let Some(&(first, at)) = items.first() else {
            return Err(invalid("no paragraphs"));
        };
        let ids: Vec<NodeId> = items.iter().map(|(id, _)| *id).collect();
        self.paras(&ids)?;
        let levels = self.numbering_levels(levels, preset, format, first, at)?;
        if levels.is_empty() || levels.len() > 9 {
            return Err(invalid("a list needs 1 to 9 levels"));
        }
        let old = self.doc.numbering.clone();
        let old_styles = self.doc.styles.clone();
        let num_id = self.doc.numbering.next_id();
        // Linked styles: level → style id (styles the document has or can add).
        let mut linked: HashMap<u8, String> = HashMap::new();
        for (i, l) in levels.iter().enumerate() {
            if let Some(s) = &l.style {
                self.ensure_builtin_style(s);
                if self.doc.styles.get(s).is_some() {
                    linked.insert(i as u8, s.clone());
                }
            }
        }
        for (&level, id) in &linked {
            // A style numbered by another list's level is taken over.
            if let Some(style) = self.doc.styles.styles.iter_mut().find(|s| &s.id == id) {
                style.paragraph.numbering = Some(NumberingRef { num_id, level });
            }
        }
        // Items in a linked style keep it (a Heading 2 stays on level 2);
        // others on a linked level get its style.
        let linked_styles: HashSet<&String> = linked.values().collect();
        let mut styled: HashMap<NodeId, Option<String>> = HashMap::new();
        for &(id, level) in items {
            let style = self.para(id)?.props.style.clone();
            if style.as_ref().is_some_and(|s| linked_styles.contains(s)) {
                styled.insert(id, None);
            } else if let Some(s) = linked.get(&level.min(8)) {
                styled.insert(id, Some(s.clone()));
            }
        }
        let plain: Vec<NodeId> = ids
            .iter()
            .copied()
            .filter(|id| !styled.contains_key(id))
            .collect();
        let list_style = self.list_paragraph_targets(&plain);
        self.doc
            .numbering
            .insert(NumberingDef::standalone(num_id, levels));
        let levels_of: HashMap<NodeId, u8> = items.iter().copied().collect();
        let restore = self.edit_paragraph_props(&ids, ch, |id, p| {
            if let Some(style) = styled.get(&id) {
                if let Some(s) = style {
                    p.style = Some(s.clone());
                }
                p.numbering = None;
                return;
            }
            let level = levels_of.get(&id).copied().unwrap_or(0).min(8);
            p.numbering = Some(NumberingRef { num_id, level });
            if list_style.contains(&id) {
                p.style = Some(super::LIST_PARAGRAPH.to_owned());
            }
        })?;
        let restore = self.with_styles(restore, old_styles, ch);
        ch.numbering = true;
        Ok(C::Compound {
            commands: vec![restore, C::RestoreNumbering { numbering: old }],
        })
    }
}
