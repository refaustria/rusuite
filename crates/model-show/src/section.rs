//! Sections (`p14:sectionLst`): named, contiguous runs of slides.
//!
//! When a presentation has sections they partition its slides in order:
//! every slide is in exactly one section, and the sections' slides,
//! concatenated, are the slide order. Sections may be empty.

use serde::{Deserialize, Serialize};

use crate::presentation::Presentation;
use crate::{Error, NodeId, Result};

/// A section.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(
    feature = "ts",
    derive(ts_rs::TS),
    ts(export, export_to = "apps/show/src/generated/")
)]
pub struct Section {
    /// Name.
    pub name: String,
    /// Its slides, in order.
    #[serde(default)]
    pub slide_ids: Vec<NodeId>,
}

impl Section {
    /// An empty section.
    pub fn new(name: impl Into<String>) -> Self {
        Section {
            name: name.into(),
            slide_ids: Vec::new(),
        }
    }
}

/// PowerPoint's name for the section that holds the slides before the
/// first section a user adds.
pub const DEFAULT_SECTION: &str = "Default Section";

impl Presentation {
    /// The index of the section holding slide `id`.
    pub fn section_of(&self, id: NodeId) -> Option<usize> {
        self.sections.iter().position(|s| s.slide_ids.contains(&id))
    }

    /// Checks that the sections partition the slides in order.
    pub fn validate_sections(&self) -> Result<()> {
        if self.sections.is_empty() {
            return Ok(());
        }
        let flat: Vec<NodeId> = self
            .sections
            .iter()
            .flat_map(|s| s.slide_ids.iter().copied())
            .collect();
        let order: Vec<NodeId> = self.slides.iter().map(|s| s.id).collect();
        if flat != order {
            return Err(Error::InvalidSections(
                "sections must hold every slide once, in slide order".into(),
            ));
        }
        Ok(())
    }

    /// Repairs the sections after slides were added, removed or moved:
    /// unknown ids are dropped, each slide not in a section joins the
    /// section of the slide before it (the first section at the start),
    /// and the slides of each section are put back into slide order. A
    /// slide that ended up between two other sections' slides (after a
    /// move) joins the section of the slide before it.
    pub fn fix_sections(&mut self) {
        if self.sections.is_empty() {
            return;
        }
        let order: Vec<NodeId> = self.slides.iter().map(|s| s.id).collect();
        // the section of each slide, in slide order
        let mut assigned: Vec<Option<usize>> =
            order.iter().map(|id| self.section_of(*id)).collect();
        // fill gaps and enforce non-decreasing section indexes
        let mut cur = 0usize;
        for a in assigned.iter_mut() {
            match a {
                Some(s) if *s >= cur => cur = *s,
                _ => *a = Some(cur),
            }
        }
        for s in &mut self.sections {
            s.slide_ids.clear();
        }
        for (id, a) in order.iter().zip(assigned) {
            self.sections[a.unwrap_or(0)].slide_ids.push(*id);
        }
    }

    /// Moves slide `id` into the section of the slide now before it (the
    /// first section when it is first) – call after moving a slide.
    pub(crate) fn resection_moved(&mut self, id: NodeId) {
        if self.sections.is_empty() {
            return;
        }
        let Some(i) = self.slide_index(id) else {
            return;
        };
        let target = if i == 0 {
            0
        } else {
            let prev = self.slides[i - 1].id;
            self.section_of(prev).unwrap_or(0)
        };
        for s in &mut self.sections {
            s.slide_ids.retain(|x| *x != id);
        }
        self.sections[target].slide_ids.push(id);
        self.fix_sections();
    }

    /// Adds a section named `name` starting at slide `first` (PowerPoint's
    /// Add Section): the slides from `first` to the end of its section move
    /// into the new section, inserted after it. Without sections, the
    /// slides before `first` go into a [`DEFAULT_SECTION`]. `first: None`
    /// appends an empty section. Returns the new section's index.
    pub fn add_section(&mut self, name: &str, first: Option<NodeId>) -> Result<usize> {
        let order: Vec<NodeId> = self.slides.iter().map(|s| s.id).collect();
        let Some(first) = first else {
            if self.sections.is_empty() && !order.is_empty() {
                let mut d = Section::new(DEFAULT_SECTION);
                d.slide_ids = order;
                self.sections.push(d);
            }
            self.sections.push(Section::new(name));
            return Ok(self.sections.len() - 1);
        };
        let at = self.slide_index(first).ok_or(Error::UnknownSlide(first))?;
        if self.sections.is_empty() {
            if at == 0 {
                let mut s = Section::new(name);
                s.slide_ids = order;
                self.sections.push(s);
                return Ok(0);
            }
            let mut d = Section::new(DEFAULT_SECTION);
            d.slide_ids = order[..at].to_vec();
            let mut s = Section::new(name);
            s.slide_ids = order[at..].to_vec();
            self.sections = vec![d, s];
            return Ok(1);
        }
        let si = self.section_of(first).unwrap_or(0);
        let pos = self.sections[si]
            .slide_ids
            .iter()
            .position(|x| *x == first)
            .unwrap_or(0);
        let tail = self.sections[si].slide_ids.split_off(pos);
        let mut s = Section::new(name);
        s.slide_ids = tail;
        self.sections.insert(si + 1, s);
        Ok(si + 1)
    }

    /// Removes section `index`. With `keep_slides` its slides join the
    /// previous section (the next one for the first section; removing the
    /// only section removes sectioning); otherwise they are deleted and
    /// returned with their old positions (ascending).
    pub fn remove_section(
        &mut self,
        index: usize,
        keep_slides: bool,
    ) -> Result<Vec<(usize, crate::Slide)>> {
        if index >= self.sections.len() {
            return Err(Error::InvalidSections(format!("no section {index}")));
        }
        let s = self.sections.remove(index);
        if keep_slides {
            if !self.sections.is_empty() {
                let target = index.saturating_sub(1).min(self.sections.len() - 1);
                let t = &mut self.sections[target];
                if index == 0 {
                    let mut ids = s.slide_ids;
                    ids.append(&mut t.slide_ids);
                    t.slide_ids = ids;
                } else {
                    t.slide_ids.extend(s.slide_ids);
                }
            }
            return Ok(Vec::new());
        }
        // positions before the removal, ascending; remove from the back
        let mut at: Vec<usize> = s
            .slide_ids
            .iter()
            .filter_map(|id| self.slide_index(*id))
            .collect();
        at.sort_unstable();
        let mut removed: Vec<(usize, crate::Slide)> = at
            .iter()
            .rev()
            .map(|&i| (i, self.slides.remove(i)))
            .collect();
        removed.reverse();
        Ok(removed)
    }

    /// Moves section `index` with its slides to position `to_index`
    /// (`0..sections`).
    pub fn move_section(&mut self, index: usize, to_index: usize) -> Result<()> {
        let n = self.sections.len();
        if index >= n || to_index >= n {
            return Err(Error::InvalidSections(format!(
                "section index out of range 0..{n}"
            )));
        }
        let s = self.sections.remove(index);
        self.sections.insert(to_index, s);
        let order: Vec<NodeId> = self
            .sections
            .iter()
            .flat_map(|s| s.slide_ids.iter().copied())
            .collect();
        let mut slides = std::mem::take(&mut self.slides);
        for id in order {
            if let Some(i) = slides.iter().position(|s| s.id == id) {
                self.slides.push(slides.remove(i));
            }
        }
        self.slides.append(&mut slides);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::{LayoutKind, Presentation, SlideSize};

    fn deck(n: usize) -> (Presentation, Vec<crate::NodeId>) {
        let mut p = Presentation::empty(SlideSize::widescreen());
        let ids = (0..n).map(|_| p.add_slide(LayoutKind::Blank)).collect();
        (p, ids)
    }

    fn names(p: &Presentation) -> Vec<(String, usize)> {
        p.sections
            .iter()
            .map(|s| (s.name.clone(), s.slide_ids.len()))
            .collect()
    }

    #[test]
    fn add_split_and_slide_moves() {
        let (mut p, ids) = deck(5);
        assert_eq!(p.add_section("Intro", Some(ids[2])).unwrap(), 1);
        assert_eq!(
            names(&p),
            [("Default Section".into(), 2), ("Intro".into(), 3)]
        );
        p.add_section("End", Some(ids[4])).unwrap();
        p.validate_sections().unwrap();
        // a slide moved to the start joins the first section
        p.move_slide(ids[3], 0).unwrap();
        p.validate().unwrap();
        assert_eq!(p.sections[0].slide_ids, [ids[3], ids[0], ids[1]]);
        // moved to the end: the last section
        p.move_slide(ids[0], 4).unwrap();
        p.validate().unwrap();
        assert_eq!(p.sections[2].slide_ids, [ids[4], ids[0]]);
        // new slides join the section of the slide before them
        let s = p.add_slide(LayoutKind::Blank);
        assert_eq!(p.section_of(s), Some(2));
        // removed slides leave their section (it may become empty)
        p.remove_slide(ids[2]).unwrap();
        p.validate().unwrap();
        assert_eq!(names(&p)[1], ("Intro".into(), 0));
        let dup = p.duplicate_slide(ids[1]).unwrap();
        assert_eq!(p.section_of(dup), Some(0));
        p.validate().unwrap();
    }

    #[test]
    fn remove_and_move_sections() {
        let (mut p, ids) = deck(4);
        p.add_section("A", Some(ids[0])).unwrap();
        p.add_section("B", Some(ids[2])).unwrap();
        assert_eq!(names(&p), [("A".into(), 2), ("B".into(), 2)]);
        p.move_section(1, 0).unwrap();
        let order: Vec<_> = p.slides.iter().map(|s| s.id).collect();
        assert_eq!(order, [ids[2], ids[3], ids[0], ids[1]]);
        p.validate().unwrap();
        // keep slides: they join the previous section (the next for the first)
        p.remove_section(0, true).unwrap();
        assert_eq!(names(&p), [("A".into(), 4)]);
        p.validate().unwrap();
        p.add_section("C", Some(ids[0])).unwrap();
        let removed = p.remove_section(1, false).unwrap();
        assert_eq!(removed.len(), 2);
        assert_eq!(p.slides.len(), 2);
        p.validate().unwrap();
        p.remove_section(0, true).unwrap();
        assert!(p.sections.is_empty());
        assert!(p.remove_section(0, true).is_err());
        // appending an empty section to an unsectioned deck
        p.add_section("Later", None).unwrap();
        assert_eq!(
            names(&p),
            [("Default Section".into(), 2), ("Later".into(), 0)]
        );
        p.validate().unwrap();
    }
}
