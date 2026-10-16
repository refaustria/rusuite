//! Slide transitions (`p:transition`, also inside `mc:AlternateContent`
//! with PowerPoint 2010's `p14:dur`) and animations (`p:timing`).
//!
//! Writing follows the structure PowerPoint itself writes: the transition
//! as `mc:AlternateContent` (`p14:dur` in the choice, `spd` in the
//! fallback); the timing tree `tmRoot` → `mainSeq` → one `p:par` per click
//! step → one `p:par` per "after previous" step → one `p:par` per effect
//! (`presetID`/`presetClass`/`presetSubtype`, `grpId`, `nodeType`) with the
//! preset's behaviors (`p:set`, `p:anim`, `p:animEffect`, `p:animRot`,
//! `p:animScale`) on a `p:spTgt`, and a `p:bldLst` entry per animated text
//! shape. Reading recognizes the same presets by `presetClass` +
//! `presetID`; anything else is dropped with a warning.

use std::collections::HashMap;

use model_show::{
    Animation, AnimationKind, Direction, Effect, MediaClip, MediaKind, MediaStart, NodeId,
    Transition, TransitionKind, Trigger,
};

use crate::xml::{parse_bool, parse_u32, El, XmlOut};
use crate::Warnings;

const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const NS_P14: &str = "http://schemas.microsoft.com/office/powerpoint/2010/main";

// --- transitions -------------------------------------------------------------------

/// OOXML `dir` value of a side/eight direction.
fn side_name(d: Direction) -> Option<&'static str> {
    Some(match d {
        Direction::Left => "l",
        Direction::Up => "u",
        Direction::Right => "r",
        Direction::Down => "d",
        Direction::LeftUp => "lu",
        Direction::RightUp => "ru",
        Direction::LeftDown => "ld",
        Direction::RightDown => "rd",
        _ => return None,
    })
}

fn side_from(v: &str) -> Option<Direction> {
    Some(match v {
        "l" => Direction::Left,
        "u" => Direction::Up,
        "r" => Direction::Right,
        "d" => Direction::Down,
        "lu" => Direction::LeftUp,
        "ru" => Direction::RightUp,
        "ld" => Direction::LeftDown,
        "rd" => Direction::RightDown,
        _ => return None,
    })
}

/// The effect element of a `p:transition`: kind and direction, or the
/// unknown element's name.
fn transition_effect(
    t: &El,
    w: &mut Warnings,
) -> Result<(TransitionKind, Option<Direction>), String> {
    let Some(e) = t
        .elements()
        .find(|e| !matches!(e.name.as_str(), "sndAc" | "extLst"))
    else {
        return Ok((TransitionKind::None, None));
    };
    let dir = |kind: TransitionKind| {
        let d = e.attr("dir").and_then(side_from);
        (kind, d.filter(|d| kind.directions().contains(d)))
    };
    Ok(match e.name.as_str() {
        "fade" => {
            if e.attr("thruBlk").and_then(parse_bool) == Some(true) {
                w.add("fade-through-black transition read as fade");
            }
            (TransitionKind::Fade, None)
        }
        "push" => dir(TransitionKind::Push),
        "wipe" => dir(TransitionKind::Wipe),
        "cover" => dir(TransitionKind::Cover),
        "cut" => (TransitionKind::Cut, None),
        "split" => {
            let (orient, d) = (e.attr("orient"), e.attr("dir"));
            let direction = (orient.is_some() || d.is_some()).then(|| {
                match (
                    orient.unwrap_or("horz") == "vert",
                    d.unwrap_or("out") == "in",
                ) {
                    (false, false) => Direction::HorizontalOut,
                    (false, true) => Direction::HorizontalIn,
                    (true, false) => Direction::VerticalOut,
                    (true, true) => Direction::VerticalIn,
                }
            });
            (TransitionKind::Split, direction)
        }
        "zoom" => {
            let d = match e.attr("dir") {
                Some("in") => Some(Direction::In),
                Some("out") => Some(Direction::Out),
                _ => None,
            };
            (TransitionKind::Zoom, d)
        }
        _ => return Err(e.qname()),
    })
}

/// Reads the slide's transition: a `p:transition` child of `p:sld`, or one
/// inside `mc:AlternateContent` (the choice's `p14:dur` and effect win; the
/// fallback's effect is used when the choice's is unknown).
pub(crate) fn read_slide_transition(root: &El, w: &mut Warnings) -> Option<Transition> {
    for el in root.elements() {
        let (primary, fallback) = match el.name.as_str() {
            "transition" => (el, None),
            "AlternateContent" => {
                let choice = el
                    .elements()
                    .filter(|c| c.name == "Choice")
                    .find_map(|c| c.child("transition"));
                let fb = el.child("Fallback").and_then(|f| f.child("transition"));
                match (choice, fb) {
                    (Some(c), fb) => (c, fb),
                    (None, Some(f)) => (f, None),
                    (None, None) => continue,
                }
            }
            _ => continue,
        };
        let effect = transition_effect(primary, w).or_else(|unknown| {
            fallback
                .map_or(Err(unknown.clone()), |f| transition_effect(f, w))
                .map_err(|_| unknown)
        });
        let (kind, direction) = match effect {
            Ok(e) => e,
            Err(name) => {
                w.add(format!("slide transition {name} dropped"));
                return None;
            }
        };
        // `p14:dur` (stored by local name), else the speed.
        let duration_ms =
            primary
                .attr("dur")
                .and_then(parse_u32)
                .unwrap_or(match primary.attr("spd") {
                    Some("slow") => 1000,
                    Some("med") => 750,
                    _ => 500,
                });
        let t = Transition {
            kind,
            direction,
            duration_ms,
            advance_on_click: primary.attr("advClick").and_then(parse_bool) != Some(false),
            advance_after_ms: primary.attr("advTm").and_then(parse_u32),
        };
        // LibreOffice writes an effect-less transition on every slide.
        return (!t.is_noop()).then_some(t);
    }
    None
}

/// `spd` for the fallback branch (PowerPoint's speeds are 0.5/0.75/1 s).
fn speed_of(ms: u32) -> &'static str {
    match ms {
        0..=500 => "fast",
        501..=750 => "med",
        _ => "slow",
    }
}

fn write_transition_el(x: &mut XmlOut, t: &Transition, with_dur: bool) {
    let dur = t.duration_ms.to_string();
    let adv = t.advance_after_ms.map(|v| v.to_string());
    let mut attrs = vec![("spd", speed_of(t.duration_ms))];
    if !t.advance_on_click {
        attrs.push(("advClick", "0"));
    }
    if let Some(a) = &adv {
        attrs.push(("advTm", a));
    }
    if with_dur {
        attrs.push(("p14:dur", &dur));
    }
    let effect: Option<(&str, Vec<(&str, &str)>)> = match t.kind {
        TransitionKind::None => None,
        TransitionKind::Fade => Some(("p:fade", vec![])),
        TransitionKind::Cut => Some(("p:cut", vec![])),
        TransitionKind::Push | TransitionKind::Wipe | TransitionKind::Cover => {
            let name = match t.kind {
                TransitionKind::Push => "p:push",
                TransitionKind::Wipe => "p:wipe",
                _ => "p:cover",
            };
            let dir = t.direction.and_then(side_name);
            Some((name, dir.map(|d| vec![("dir", d)]).unwrap_or_default()))
        }
        TransitionKind::Split => {
            let a = match t.direction {
                Some(Direction::HorizontalIn) => vec![("orient", "horz"), ("dir", "in")],
                Some(Direction::HorizontalOut) => vec![("orient", "horz"), ("dir", "out")],
                Some(Direction::VerticalIn) => vec![("orient", "vert"), ("dir", "in")],
                Some(Direction::VerticalOut) => vec![("orient", "vert"), ("dir", "out")],
                _ => vec![],
            };
            Some(("p:split", a))
        }
        TransitionKind::Zoom => {
            let a = match t.direction {
                Some(Direction::In) => vec![("dir", "in")],
                Some(Direction::Out) => vec![("dir", "out")],
                _ => vec![],
            };
            Some(("p:zoom", a))
        }
    };
    match effect {
        Some((name, eattrs)) => {
            x.start("p:transition", &attrs);
            x.empty(name, &eattrs);
            x.end("p:transition");
        }
        None => x.empty("p:transition", &attrs),
    }
}

/// Writes the transition the way PowerPoint does: `mc:AlternateContent`
/// with the exact duration (`p14:dur`) in the choice and only the speed in
/// the fallback.
/// Writes nothing for a no-op transition ([`Transition::is_noop`]).
pub(crate) fn write_transition(x: &mut XmlOut, t: &Transition) {
    if t.is_noop() {
        return;
    }
    x.start("mc:AlternateContent", &[("xmlns:mc", NS_MC)]);
    x.start("mc:Choice", &[("xmlns:p14", NS_P14), ("Requires", "p14")]);
    write_transition_el(x, t, true);
    x.end("mc:Choice");
    x.start("mc:Fallback", &[]);
    write_transition_el(x, t, false);
    x.end("mc:Fallback");
    x.end("mc:AlternateContent");
}

// --- animations: presets --------------------------------------------------------------

/// `presetSubtype` of a side direction (PowerPoint: 1 top, 2 right,
/// 4 bottom, 8 left, sums for diagonals).
fn subtype_of(d: Direction) -> u32 {
    match d {
        Direction::Up => 1,
        Direction::Right => 2,
        Direction::Down => 4,
        Direction::Left => 8,
        Direction::RightUp => 3,
        Direction::RightDown => 6,
        Direction::LeftUp => 9,
        Direction::LeftDown => 12,
        _ => 0,
    }
}

fn direction_of_subtype(v: u32) -> Option<Direction> {
    Some(match v {
        1 => Direction::Up,
        2 => Direction::Right,
        4 => Direction::Down,
        8 => Direction::Left,
        3 => Direction::RightUp,
        6 => Direction::RightDown,
        9 => Direction::LeftUp,
        12 => Direction::LeftDown,
        _ => return None,
    })
}

/// Off-slide position formulas for Fly In/Out from/to `d`.
fn fly_values(d: Direction) -> (&'static str, &'static str) {
    let x = match d {
        Direction::Left | Direction::LeftUp | Direction::LeftDown => "0-#ppt_w/2",
        Direction::Right | Direction::RightUp | Direction::RightDown => "1+#ppt_w/2",
        _ => "#ppt_x",
    };
    let y = match d {
        Direction::Up | Direction::LeftUp | Direction::RightUp => "0-#ppt_h/2",
        Direction::Down | Direction::LeftDown | Direction::RightDown => "1+#ppt_h/2",
        _ => "#ppt_y",
    };
    (x, y)
}

/// The `wipe(…)` filter of a wipe from side `d` (as PowerPoint names it).
fn wipe_filter(d: Direction) -> &'static str {
    match d {
        Direction::Up => "wipe(up)",
        Direction::Right => "wipe(right)",
        Direction::Left => "wipe(left)",
        _ => "wipe(down)",
    }
}

/// `presetID` and `presetSubtype` of an effect.
fn preset_of(a: &Animation) -> (u32, u32) {
    let dir = a.effective_direction().map_or(0, subtype_of);
    match a.effect {
        Effect::Appear => (1, 0),
        Effect::FlyIn => (2, dir),
        Effect::GrowShrink => (6, 0),
        Effect::Spin => (8, 0),
        Effect::Fade => (10, 0),
        Effect::Wipe => (22, dir),
        Effect::Zoom => (53, 16),
    }
}

fn effect_of(class: AnimationKind, preset: u32) -> Option<Effect> {
    Some(match (class, preset) {
        (AnimationKind::Emphasis, 6) => Effect::GrowShrink,
        (AnimationKind::Emphasis, 8) => Effect::Spin,
        (AnimationKind::Emphasis, _) => return None,
        (_, 1) => Effect::Appear,
        (_, 2) => Effect::FlyIn,
        (_, 10) => Effect::Fade,
        (_, 22) => Effect::Wipe,
        // 53 = Zoom (PowerPoint 2010+), 23 = Basic Zoom
        (_, 53 | 23) => Effect::Zoom,
        _ => return None,
    })
}

// --- animations: writing ---------------------------------------------------------------

/// How an animated shape was written.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Target {
    /// `p:cNvPr/@id`.
    pub spid: u32,
    /// A `p:sp` with a text body (gets a `p:bldP`).
    pub text: bool,
    /// A placeholder (its `p:bldP` has no `animBg`).
    pub placeholder: bool,
}

struct TimingWriter<'a> {
    x: &'a mut XmlOut,
    next_id: u32,
}

impl TimingWriter<'_> {
    /// Starts `<p:cTn id=… attrs>` with the next id.
    fn ctn_start(&mut self, attrs: &[(&str, &str)]) {
        let id = self.next_id.to_string();
        self.next_id += 1;
        let mut all = vec![("id", id.as_str())];
        all.extend_from_slice(attrs);
        self.x.start("p:cTn", &all);
    }

    fn ctn_empty(&mut self, attrs: &[(&str, &str)]) {
        let id = self.next_id.to_string();
        self.next_id += 1;
        let mut all = vec![("id", id.as_str())];
        all.extend_from_slice(attrs);
        self.x.empty("p:cTn", &all);
    }

    fn cond_list(&mut self, delay: &str) {
        self.x.start("p:stCondLst", &[]);
        self.x.empty("p:cond", &[("delay", delay)]);
        self.x.end("p:stCondLst");
    }

    fn target(&mut self, spid: &str) {
        self.x.start("p:tgtEl", &[]);
        self.x.empty("p:spTgt", &[("spid", spid)]);
        self.x.end("p:tgtEl");
    }

    fn attr_name(&mut self, name: &str) {
        self.x.start("p:attrNameLst", &[]);
        self.x.text_el("p:attrName", &[], name);
        self.x.end("p:attrNameLst");
    }

    /// `p:set` of `style.visibility` to `to` at `delay`.
    fn set_visibility(&mut self, spid: &str, to: &str, delay: u32) {
        self.x.start("p:set", &[]);
        self.x.start("p:cBhvr", &[]);
        self.ctn_start(&[("dur", "1"), ("fill", "hold")]);
        self.cond_list(&delay.to_string());
        self.x.end("p:cTn");
        self.target(spid);
        self.attr_name("style.visibility");
        self.x.end("p:cBhvr");
        self.x.start("p:to", &[]);
        self.x.empty("p:strVal", &[("val", to)]);
        self.x.end("p:to");
        self.x.end("p:set");
    }

    /// A linear `p:anim` of `attr` from `from` to `to`; `"0"` is written as
    /// a float value, everything else as a formula string.
    fn anim(&mut self, spid: &str, attr: &str, from: &str, to: &str, dur: &str, base: bool) {
        self.x
            .start("p:anim", &[("calcmode", "lin"), ("valueType", "num")]);
        self.x
            .start("p:cBhvr", if base { &[("additive", "base")] } else { &[] });
        self.ctn_empty(&[("dur", dur), ("fill", "hold")]);
        self.target(spid);
        self.attr_name(attr);
        self.x.end("p:cBhvr");
        self.x.start("p:tavLst", &[]);
        for (tm, v) in [("0", from), ("100000", to)] {
            self.x.start("p:tav", &[("tm", tm)]);
            self.x.start("p:val", &[]);
            if v == "0" {
                self.x.empty("p:fltVal", &[("val", "0")]);
            } else {
                self.x.empty("p:strVal", &[("val", v)]);
            }
            self.x.end("p:val");
            self.x.end("p:tav");
        }
        self.x.end("p:tavLst");
        self.x.end("p:anim");
    }

    fn anim_effect(&mut self, spid: &str, transition: &str, filter: &str, dur: &str) {
        self.x.start(
            "p:animEffect",
            &[("transition", transition), ("filter", filter)],
        );
        self.x.start("p:cBhvr", &[]);
        self.ctn_empty(&[("dur", dur)]);
        self.target(spid);
        self.x.end("p:cBhvr");
        self.x.end("p:animEffect");
    }

    /// The behaviors of one effect.
    fn behaviors(&mut self, a: &Animation, spid: &str) {
        let dur = a.duration_ms.to_string();
        let dur = dur.as_str();
        let hide_at = a.duration_ms.saturating_sub(1);
        let dir = a.effective_direction().unwrap_or(Direction::Down);
        match (a.kind, a.effect) {
            (AnimationKind::Emphasis, Effect::Spin) => {
                self.x.start("p:animRot", &[("by", "21600000")]);
                self.x.start("p:cBhvr", &[]);
                self.ctn_empty(&[("dur", dur), ("fill", "hold")]);
                self.target(spid);
                self.attr_name("r");
                self.x.end("p:cBhvr");
                self.x.end("p:animRot");
            }
            (AnimationKind::Emphasis, _) => {
                self.x.start("p:animScale", &[]);
                self.x.start("p:cBhvr", &[]);
                self.ctn_empty(&[("dur", dur), ("fill", "hold")]);
                self.target(spid);
                self.x.end("p:cBhvr");
                self.x.empty("p:by", &[("x", "150000"), ("y", "150000")]);
                self.x.end("p:animScale");
            }
            (AnimationKind::Entrance, effect) => {
                self.set_visibility(spid, "visible", 0);
                match effect {
                    Effect::Fade => self.anim_effect(spid, "in", "fade", dur),
                    Effect::FlyIn => {
                        let (x, y) = fly_values(dir);
                        self.anim(spid, "ppt_x", x, "#ppt_x", dur, true);
                        self.anim(spid, "ppt_y", y, "#ppt_y", dur, true);
                    }
                    Effect::Wipe => self.anim_effect(spid, "in", wipe_filter(dir), dur),
                    Effect::Zoom => {
                        self.anim(spid, "ppt_w", "0", "#ppt_w", dur, false);
                        self.anim(spid, "ppt_h", "0", "#ppt_h", dur, false);
                        self.anim_effect(spid, "in", "fade", dur);
                    }
                    _ => {}
                }
            }
            (AnimationKind::Exit, effect) => {
                match effect {
                    Effect::Appear => {
                        self.set_visibility(spid, "hidden", 0);
                        return;
                    }
                    Effect::Fade => self.anim_effect(spid, "out", "fade", dur),
                    Effect::FlyIn => {
                        let (x, y) = fly_values(dir);
                        self.anim(spid, "ppt_x", "#ppt_x", x, dur, true);
                        self.anim(spid, "ppt_y", "#ppt_y", y, dur, true);
                    }
                    Effect::Wipe => self.anim_effect(spid, "out", wipe_filter(dir), dur),
                    _ => {
                        self.anim(spid, "ppt_w", "#ppt_w", "0", dur, false);
                        self.anim(spid, "ppt_h", "#ppt_h", "0", dur, false);
                        self.anim_effect(spid, "out", "fade", dur);
                    }
                }
                self.set_visibility(spid, "hidden", hide_at);
            }
        }
    }
}

/// How long an effect runs (Appear is instant).
fn run_time(a: &Animation) -> u32 {
    let d = if a.effect == Effect::Appear {
        0
    } else {
        a.duration_ms
    };
    a.delay_ms.saturating_add(d)
}

/// A media shape on the slide being written (see [`write_timing`]).
#[derive(Debug, Clone, Copy)]
pub(crate) struct MediaTarget<'a> {
    /// `p:cNvPr/@id`.
    pub spid: u32,
    pub clip: &'a MediaClip,
}

/// One effect of the main sequence: an animation, or a media clip's
/// "play" (`presetClass="mediacall"`).
#[derive(Clone, Copy)]
enum Eff<'a> {
    Anim(&'a Animation),
    Media(MediaTarget<'a>),
}

impl Eff<'_> {
    fn trigger(&self) -> Trigger {
        match self {
            Eff::Anim(a) => a.trigger,
            Eff::Media(m) if m.clip.start == MediaStart::Automatically => Trigger::AfterPrevious,
            Eff::Media(_) => Trigger::OnClick,
        }
    }

    fn run_time(&self) -> u32 {
        match self {
            Eff::Anim(a) => run_time(a),
            Eff::Media(_) => 0,
        }
    }
}

/// Writes `p:timing` for `anims` (in play order) and the slide's media
/// clips: "Automatically" clips play first when the slide appears, "In
/// Click Sequence" ones get a click step after the animations; every clip
/// gets its `p:video`/`p:audio` node (volume, mute, loop, hide while not
/// playing). Fails with the id of an animation whose shape was not
/// written.
pub(crate) fn write_timing(
    x: &mut XmlOut,
    anims: &[Animation],
    targets: &HashMap<NodeId, Target>,
    media: &[MediaTarget<'_>],
) -> Result<(), NodeId> {
    // click steps → "after previous" steps → effects
    let mut groups: Vec<Vec<Vec<Eff<'_>>>> = Vec::new();
    for a in anims {
        if !targets.contains_key(&a.shape) {
            return Err(a.id);
        }
        match (a.trigger, groups.last_mut()) {
            (Trigger::OnClick, _) | (_, None) => groups.push(vec![vec![Eff::Anim(a)]]),
            (Trigger::AfterPrevious, Some(g)) => g.push(vec![Eff::Anim(a)]),
            (Trigger::WithPrevious, Some(g)) => {
                if let Some(sub) = g.last_mut() {
                    sub.push(Eff::Anim(a));
                }
            }
        }
    }
    let auto: Vec<Vec<Eff<'_>>> = media
        .iter()
        .filter(|m| m.clip.start == MediaStart::Automatically)
        .map(|m| vec![Eff::Media(*m)])
        .collect();
    if !auto.is_empty() {
        match groups.first_mut() {
            Some(g) if g[0][0].trigger() != Trigger::OnClick => {
                g.splice(0..0, auto);
            }
            _ => groups.insert(0, auto),
        }
    }
    for m in media
        .iter()
        .filter(|m| m.clip.start == MediaStart::InClickSequence)
    {
        groups.push(vec![vec![Eff::Media(*m)]]);
    }
    let starts_on_load = groups
        .first()
        .is_some_and(|g| g[0][0].trigger() != Trigger::OnClick);

    let mut t = TimingWriter { x, next_id: 1 };
    t.x.start("p:timing", &[]);
    t.x.start("p:tnLst", &[]);
    t.x.start("p:par", &[]);
    t.ctn_start(&[
        ("dur", "indefinite"),
        ("restart", "never"),
        ("nodeType", "tmRoot"),
    ]);
    t.x.start("p:childTnLst", &[]);
    let mut builds: Vec<(u32, u32, bool)> = Vec::new();
    if !groups.is_empty() {
        t.x.start("p:seq", &[("concurrent", "1"), ("nextAc", "seek")]);
        t.ctn_start(&[("dur", "indefinite"), ("nodeType", "mainSeq")]);
        t.x.start("p:childTnLst", &[]);
        let mut grp_ids: HashMap<u32, u32> = HashMap::new();
        for (gi, group) in groups.iter().enumerate() {
            t.x.start("p:par", &[]);
            t.ctn_start(&[("fill", "hold")]);
            t.x.start("p:stCondLst", &[]);
            t.x.empty("p:cond", &[("delay", "indefinite")]);
            if gi == 0 && starts_on_load {
                t.x.start("p:cond", &[("evt", "onBegin"), ("delay", "0")]);
                t.x.empty("p:tn", &[("val", "2")]);
                t.x.end("p:cond");
            }
            t.x.end("p:stCondLst");
            t.x.start("p:childTnLst", &[]);
            let mut start = 0u32;
            for (si, sub) in group.iter().enumerate() {
                if si > 0 {
                    start = start
                        .saturating_add(group[si - 1].iter().map(Eff::run_time).max().unwrap_or(0));
                }
                t.x.start("p:par", &[]);
                t.ctn_start(&[("fill", "hold")]);
                t.cond_list(&start.to_string());
                t.x.start("p:childTnLst", &[]);
                for (ei, eff) in sub.iter().enumerate() {
                    let node_type = match (si, ei, eff.trigger()) {
                        (0, 0, Trigger::OnClick) => "clickEffect",
                        (0, 0, Trigger::WithPrevious) => "withEffect",
                        (_, 0, _) => "afterEffect",
                        _ => "withEffect",
                    };
                    match eff {
                        Eff::Anim(a) => {
                            let target = targets[&a.shape];
                            let grp = grp_ids.entry(target.spid).or_insert(0);
                            let grp_id = *grp;
                            *grp += 1;
                            if target.text {
                                builds.push((target.spid, grp_id, target.placeholder));
                            }
                            t.effect(a, target.spid, grp_id, node_type);
                        }
                        Eff::Media(m) => {
                            let grp = grp_ids.entry(m.spid).or_insert(0);
                            let grp_id = *grp;
                            *grp += 1;
                            t.media_call(m.spid, grp_id, node_type);
                        }
                    }
                }
                t.x.end("p:childTnLst");
                t.x.end("p:cTn");
                t.x.end("p:par");
            }
            t.x.end("p:childTnLst");
            t.x.end("p:cTn");
            t.x.end("p:par");
        }
        t.x.end("p:childTnLst");
        t.x.end("p:cTn");
        for (list, evt) in [("p:prevCondLst", "onPrev"), ("p:nextCondLst", "onNext")] {
            t.x.start(list, &[]);
            t.x.start("p:cond", &[("evt", evt), ("delay", "0")]);
            t.x.start("p:tgtEl", &[]);
            t.x.empty("p:sldTgt", &[]);
            t.x.end("p:tgtEl");
            t.x.end("p:cond");
            t.x.end(list);
        }
        t.x.end("p:seq");
    }
    for m in media {
        t.media_node(m);
    }
    t.x.end("p:childTnLst");
    t.x.end("p:cTn");
    t.x.end("p:par");
    t.x.end("p:tnLst");
    if !builds.is_empty() {
        t.x.start("p:bldLst", &[]);
        for (spid, grp, placeholder) in builds {
            let (spid, grp) = (spid.to_string(), grp.to_string());
            let mut attrs = vec![("spid", spid.as_str()), ("grpId", grp.as_str())];
            if !placeholder {
                attrs.push(("animBg", "1"));
            }
            t.x.empty("p:bldP", &attrs);
        }
        t.x.end("p:bldLst");
    }
    t.x.end("p:timing");
    Ok(())
}

impl TimingWriter<'_> {
    /// One animation effect `p:par`.
    fn effect(&mut self, a: &Animation, spid: u32, grp_id: u32, node_type: &str) {
        let (preset, subtype) = preset_of(a);
        let class = match a.kind {
            AnimationKind::Entrance => "entr",
            AnimationKind::Emphasis => "emph",
            AnimationKind::Exit => "exit",
        };
        let (preset, subtype, grp_s) =
            (preset.to_string(), subtype.to_string(), grp_id.to_string());
        self.x.start("p:par", &[]);
        self.ctn_start(&[
            ("presetID", &preset),
            ("presetClass", class),
            ("presetSubtype", &subtype),
            ("fill", "hold"),
            ("grpId", &grp_s),
            ("nodeType", node_type),
        ]);
        self.cond_list(&a.delay_ms.to_string());
        self.x.start("p:childTnLst", &[]);
        self.behaviors(a, &spid.to_string());
        self.x.end("p:childTnLst");
        self.x.end("p:cTn");
        self.x.end("p:par");
    }

    /// A media "play" effect (`presetClass="mediacall"`, `p:cmd
    /// playFrom(0.0)`).
    fn media_call(&mut self, spid: u32, grp_id: u32, node_type: &str) {
        let grp_s = grp_id.to_string();
        self.x.start("p:par", &[]);
        self.ctn_start(&[
            ("presetID", "1"),
            ("presetClass", "mediacall"),
            ("presetSubtype", "0"),
            ("fill", "hold"),
            ("grpId", &grp_s),
            ("nodeType", node_type),
        ]);
        self.cond_list("0");
        self.x.start("p:childTnLst", &[]);
        self.x
            .start("p:cmd", &[("type", "call"), ("cmd", "playFrom(0.0)")]);
        self.x.start("p:cBhvr", &[]);
        self.ctn_empty(&[("dur", "1"), ("fill", "hold")]);
        self.target(&spid.to_string());
        self.x.end("p:cBhvr");
        self.x.end("p:cmd");
        self.x.end("p:childTnLst");
        self.x.end("p:cTn");
        self.x.end("p:par");
    }

    /// The clip's `p:video` / `p:audio` node.
    fn media_node(&mut self, m: &MediaTarget<'_>) {
        let el = match m.clip.kind {
            MediaKind::Video => "p:video",
            MediaKind::Audio => "p:audio",
        };
        let vol = m.clip.volume.min(100_000).to_string();
        let mut attrs = vec![("vol", vol.as_str())];
        if m.clip.muted {
            attrs.push(("mute", "1"));
        }
        if m.clip.hide_when_not_playing {
            attrs.push(("showWhenStopped", "0"));
        }
        self.x.start(el, &[]);
        self.x.start("p:cMediaNode", &attrs);
        let mut ctn = vec![("fill", "hold"), ("display", "0")];
        if m.clip.loop_playback {
            ctn.insert(0, ("repeatCount", "indefinite"));
        }
        self.ctn_start(&ctn);
        self.x.start("p:stCondLst", &[]);
        self.x.empty("p:cond", &[("delay", "indefinite")]);
        self.x.end("p:stCondLst");
        self.x.end("p:cTn");
        self.target(&m.spid.to_string());
        self.x.end("p:cMediaNode");
        self.x.end(el);
    }
}

/// Playback settings of one media shape found in `p:timing`.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct MediaTiming {
    pub start: Option<MediaStart>,
    pub volume: Option<u32>,
    pub muted: bool,
    pub hide: bool,
    pub looped: bool,
}

/// The media settings of `p:timing` by `spid`: the `p:video`/`p:audio`
/// nodes (volume, mute, `showWhenStopped`, `repeatCount`) and the
/// `mediacall` effects of the main sequence (in a group that starts on
/// load → Automatically, else In Click Sequence; clips without one play
/// when clicked).
pub(crate) fn read_media_timing(timing: &El) -> HashMap<u32, MediaTiming> {
    let mut out: HashMap<u32, MediaTiming> = HashMap::new();
    let Some((_, roots)) = timing
        .child("tnLst")
        .and_then(|l| l.child("par"))
        .and_then(ctn_children)
    else {
        return out;
    };
    for node in roots {
        match node.name.as_str() {
            "video" | "audio" => {
                let Some(m) = node.child("cMediaNode") else {
                    continue;
                };
                let Some(spid) = m
                    .find("spTgt")
                    .and_then(|t| t.attr("spid"))
                    .and_then(parse_u32)
                else {
                    continue;
                };
                let e = out.entry(spid).or_default();
                e.volume = m.attr("vol").and_then(parse_u32);
                e.muted = m.attr("mute").and_then(parse_bool) == Some(true);
                e.hide = m.attr("showWhenStopped").and_then(parse_bool) == Some(false);
                e.looped = m
                    .child("cTn")
                    .and_then(|c| c.attr("repeatCount"))
                    .is_some_and(|r| r == "indefinite");
            }
            "seq" => {
                let Some((ctn, groups)) = ctn_children(node) else {
                    continue;
                };
                if ctn.attr("nodeType") != Some("mainSeq") {
                    continue;
                }
                for group in groups {
                    let on_load = group.child("cTn").is_some_and(|c| {
                        c.child("stCondLst")
                            .is_some_and(|l| l.elements().any(|c| c.attr("evt") == Some("onBegin")))
                    });
                    let mut calls = Vec::new();
                    descendants(group, "cTn", &mut calls);
                    for c in calls {
                        if c.attr("presetClass") != Some("mediacall") {
                            continue;
                        }
                        let Some(spid) = c
                            .find("spTgt")
                            .and_then(|t| t.attr("spid"))
                            .and_then(parse_u32)
                        else {
                            continue;
                        };
                        let click = c.attr("nodeType") == Some("clickEffect");
                        out.entry(spid).or_default().start = Some(if on_load && !click {
                            MediaStart::Automatically
                        } else {
                            MediaStart::InClickSequence
                        });
                    }
                }
            }
            _ => {}
        }
    }
    out
}

// --- animations: reading ----------------------------------------------------------------

/// All descendants of `el` named `name`, depth-first.
fn descendants<'a>(el: &'a El, name: &str, out: &mut Vec<&'a El>) {
    for c in el.elements() {
        if c.name == name {
            out.push(c);
        }
        descendants(c, name, out);
    }
}

/// The `p:cTn` of a `p:par`/`p:seq` and its child time nodes.
fn ctn_children(node: &El) -> Option<(&El, Vec<&El>)> {
    let ctn = node.child("cTn")?;
    let kids = ctn
        .child("childTnLst")
        .map(|l| l.elements().collect())
        .unwrap_or_default();
    Some((ctn, kids))
}

/// Delay of the first `p:cond` with a numeric delay in `p:stCondLst`.
fn start_delay(ctn: &El) -> u32 {
    ctn.child("stCondLst")
        .into_iter()
        .flat_map(|l| l.elements())
        .find_map(|c| c.attr("delay").and_then(parse_u32))
        .unwrap_or(0)
}

/// Reads one effect `p:cTn` (one with `presetClass`). `position` is the
/// trigger implied by the tree (for files without `nodeType`).
fn read_effect(
    ctn: &El,
    position: Trigger,
    spids: &HashMap<u32, NodeId>,
    w: &mut Warnings,
) -> Option<Animation> {
    let class = ctn.attr("presetClass").unwrap_or("");
    let kind = match class {
        "entr" => AnimationKind::Entrance,
        "exit" => AnimationKind::Exit,
        "emph" => AnimationKind::Emphasis,
        "path" => {
            w.add("motion path animations dropped");
            return None;
        }
        // media play/pause/stop: read by `read_media_timing`
        "mediacall" => return None,
        _ => {
            w.add(format!("animations of class {class} dropped"));
            return None;
        }
    };
    let preset = ctn.attr("presetID").and_then(parse_u32).unwrap_or(0);
    let Some(effect) = effect_of(kind, preset) else {
        w.add(format!("animation effect {class} #{preset} dropped"));
        return None;
    };
    let Some(tgt) = ctn.find("spTgt") else {
        w.add("animations without a shape target dropped");
        return None;
    };
    let Some(&shape) = tgt
        .attr("spid")
        .and_then(parse_u32)
        .and_then(|s| spids.get(&s))
    else {
        w.add("animations of dropped shapes dropped");
        return None;
    };
    if tgt.elements().next().is_some() {
        w.add("animations of text paragraphs applied to the whole shape");
    }
    let trigger = match ctn.attr("nodeType") {
        Some("clickEffect") => Trigger::OnClick,
        Some("withEffect") => Trigger::WithPrevious,
        Some("afterEffect") => Trigger::AfterPrevious,
        _ => position,
    };
    // duration: the longest behavior other than the visibility switch
    let mut dur = None::<u32>;
    for b in ctn
        .child("childTnLst")
        .into_iter()
        .flat_map(|l| l.elements())
        .filter(|b| b.name != "set")
    {
        if let Some(d) = b
            .child("cBhvr")
            .and_then(|c| c.child("cTn"))
            .and_then(|c| c.attr("dur"))
            .and_then(parse_u32)
        {
            dur = Some(dur.map_or(d, |m| m.max(d)));
        }
    }
    let duration_ms = if effect == Effect::Appear {
        0
    } else {
        dur.unwrap_or(effect.default_duration_ms())
    };
    let direction = if effect.directions().is_empty() {
        None
    } else {
        let sub = ctn.attr("presetSubtype").and_then(parse_u32).unwrap_or(0);
        direction_of_subtype(sub)
            .filter(|d| effect.directions().contains(d))
            .or_else(|| fly_direction_of_values(ctn))
            .filter(|d| effect.directions().contains(d))
            .filter(|d| Some(*d) != effect.default_direction())
    };
    Some(Animation {
        id: NodeId(0),
        shape,
        kind,
        effect,
        trigger,
        duration_ms,
        delay_ms: start_delay(ctn),
        direction,
    })
}

/// Direction of a Fly In/Out from its position formulas (for writers that
/// leave `presetSubtype` at 0).
fn fly_direction_of_values(ctn: &El) -> Option<Direction> {
    let mut vals = Vec::new();
    descendants(ctn, "strVal", &mut vals);
    let has = |s: &str| vals.iter().any(|v| v.attr("val") == Some(s));
    let h = if has("0-#ppt_w/2") {
        -1
    } else if has("1+#ppt_w/2") {
        1
    } else {
        0
    };
    let v = if has("0-#ppt_h/2") {
        -1
    } else if has("1+#ppt_h/2") {
        1
    } else {
        0
    };
    Some(match (h, v) {
        (-1, 0) => Direction::Left,
        (1, 0) => Direction::Right,
        (0, -1) => Direction::Up,
        (0, 1) => Direction::Down,
        (-1, -1) => Direction::LeftUp,
        (1, -1) => Direction::RightUp,
        (-1, 1) => Direction::LeftDown,
        (1, 1) => Direction::RightDown,
        _ => return None,
    })
}

/// Reads the main sequence of `p:timing` into animations (ids 0; the
/// caller assigns them). `spids` maps `p:cNvPr/@id` to the read shapes.
pub(crate) fn read_timing(
    timing: &El,
    spids: &HashMap<u32, NodeId>,
    w: &mut Warnings,
) -> Vec<Animation> {
    let mut out = Vec::new();
    let Some(root) = timing
        .child("tnLst")
        .and_then(|l| l.child("par"))
        .and_then(ctn_children)
    else {
        return out;
    };
    for seq in root.1 {
        let Some((ctn, groups)) = ctn_children(seq) else {
            continue;
        };
        match ctn.attr("nodeType") {
            Some("mainSeq") => {}
            Some("interactiveSeq") => {
                // a media clip's "When Clicked On" trigger is no animation
                let mut kids = Vec::new();
                descendants(seq, "cTn", &mut kids);
                let classes: Vec<&str> =
                    kids.iter().filter_map(|c| c.attr("presetClass")).collect();
                let only_media = !classes.is_empty() && classes.iter().all(|c| *c == "mediacall");
                if !only_media {
                    w.add("triggered animations dropped");
                }
                continue;
            }
            _ if matches!(seq.name.as_str(), "video" | "audio") => continue,
            _ => {
                w.add("animation timing nodes outside the main sequence dropped");
                continue;
            }
        }
        for group in groups {
            let Some((_, subs)) = ctn_children(group) else {
                continue;
            };
            for (si, sub) in subs.iter().enumerate() {
                let Some((_, effects)) = ctn_children(sub) else {
                    continue;
                };
                for (ei, eff) in effects.iter().enumerate() {
                    let Some(ectn) = eff.child("cTn") else {
                        continue;
                    };
                    let position = match (si, ei) {
                        (0, 0) => Trigger::OnClick,
                        (_, 0) => Trigger::AfterPrevious,
                        _ => Trigger::WithPrevious,
                    };
                    if ectn.attr("presetClass").is_none() {
                        w.add("animations without a preset dropped");
                        continue;
                    }
                    out.extend(read_effect(ectn, position, spids, w));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse;

    fn written(f: impl FnOnce(&mut XmlOut)) -> String {
        let mut x = XmlOut::fragment();
        f(&mut x);
        String::from_utf8(x.finish()).unwrap()
    }

    fn sld(inner: &str) -> El {
        parse(
            format!(r#"<p:sld xmlns:p="p" xmlns:mc="mc" xmlns:p14="p14">{inner}</p:sld>"#)
                .as_bytes(),
            "s",
        )
        .unwrap()
    }

    #[test]
    fn transition_xml_like_powerpoint() {
        let t = Transition::new(TransitionKind::Fade);
        assert_eq!(
            written(|x| write_transition(x, &t)),
            r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14"><p:transition spd="med" p14:dur="700"><p:fade/></p:transition></mc:Choice><mc:Fallback><p:transition spd="med"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>"#
        );
    }

    #[test]
    fn transitions_roundtrip() {
        let mut all = Vec::new();
        let mut timed = Transition::new(TransitionKind::None);
        timed.advance_after_ms = Some(5000);
        all.push(timed);
        for kind in TransitionKind::ALL {
            let t = Transition::new(kind);
            if t.is_noop() {
                assert!(written(|x| write_transition(x, &t)).is_empty());
                continue;
            }
            all.push(t);
            for d in kind.directions() {
                let mut t = Transition::new(kind);
                t.direction = Some(*d);
                t.duration_ms = 1234;
                t.advance_on_click = false;
                t.advance_after_ms = Some(2500);
                all.push(t);
            }
        }
        for t in all {
            let xml = written(|x| write_transition(x, &t));
            let mut w = Warnings::default();
            let back = read_slide_transition(&sld(&xml), &mut w);
            assert_eq!(back, Some(t), "{xml}");
            assert!(w.into_vec().is_empty());
        }
    }

    #[test]
    fn transitions_from_other_writers() {
        let mut w = Warnings::default();
        // plain p:transition, speed only
        let t = read_slide_transition(
            &sld(r#"<p:transition spd="slow" advClick="0" advTm="3000"><p:wipe dir="r"/></p:transition>"#),
            &mut w,
        )
        .unwrap();
        assert_eq!(
            (
                t.kind,
                t.direction,
                t.duration_ms,
                t.advance_on_click,
                t.advance_after_ms
            ),
            (
                TransitionKind::Wipe,
                Some(Direction::Right),
                1000,
                false,
                Some(3000)
            )
        );
        // LibreOffice: fade through black
        let t = read_slide_transition(
            &sld(r#"<mc:AlternateContent><mc:Choice Requires="p14"><p:transition spd="slow" p14:dur="2000"><p:fade thruBlk="true"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade thruBlk="true"/></p:transition></mc:Fallback></mc:AlternateContent>"#),
            &mut w,
        )
        .unwrap();
        assert_eq!((t.kind, t.duration_ms), (TransitionKind::Fade, 2000));
        // unknown choice effect: the fallback's effect, the choice's duration
        let t = read_slide_transition(
            &sld(r#"<mc:AlternateContent><mc:Choice Requires="p14"><p:transition spd="slow" p14:dur="1600"><p14:vortex dir="r"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:split orient="vert"/></p:transition></mc:Fallback></mc:AlternateContent>"#),
            &mut w,
        )
        .unwrap();
        assert_eq!(
            (t.kind, t.direction, t.duration_ms),
            (TransitionKind::Split, Some(Direction::VerticalOut), 1600)
        );
        // unknown everywhere: dropped
        assert_eq!(
            read_slide_transition(
                &sld(r#"<p:transition><p:dissolve/></p:transition>"#),
                &mut w
            ),
            None
        );
        assert_eq!(
            w.into_vec(),
            [
                "fade-through-black transition read as fade",
                "slide transition p:dissolve dropped"
            ]
        );
    }

    fn all_effects() -> Vec<Animation> {
        let mut out = Vec::new();
        let mut n = 100;
        for kind in [
            AnimationKind::Entrance,
            AnimationKind::Emphasis,
            AnimationKind::Exit,
        ] {
            for effect in Effect::ALL.into_iter().filter(|e| e.supports(kind)) {
                let mut dirs: Vec<Option<Direction>> = vec![None];
                dirs.extend(
                    effect
                        .directions()
                        .iter()
                        .filter(|d| Some(**d) != effect.default_direction())
                        .map(|d| Some(*d)),
                );
                for direction in dirs {
                    n += 1;
                    let mut a = Animation::new(NodeId(1 + n % 3), kind, effect);
                    a.id = NodeId(n);
                    a.direction = direction;
                    a.trigger = [
                        Trigger::OnClick,
                        Trigger::WithPrevious,
                        Trigger::AfterPrevious,
                    ][(n % 3) as usize];
                    a.delay_ms = (n % 2) as u32 * 250;
                    if effect != Effect::Appear {
                        a.duration_ms += 100;
                    }
                    out.push(a);
                }
            }
        }
        out
    }

    #[test]
    fn every_effect_roundtrips() {
        let targets: HashMap<NodeId, Target> = (1..=3)
            .map(|n| {
                (
                    NodeId(n),
                    Target {
                        spid: n as u32 + 1,
                        text: n != 3,
                        placeholder: n == 1,
                    },
                )
            })
            .collect();
        let spids: HashMap<u32, NodeId> = (1..=3).map(|n| (n as u32 + 1, NodeId(n))).collect();
        let mut anims = all_effects();
        // the first one may start with the slide
        anims[0].trigger = Trigger::AfterPrevious;
        let xml = written(|x| write_timing(x, &anims, &targets, &[]).unwrap());
        assert!(xml.contains(r#"<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>"#));
        assert!(xml.contains(r#"<p:bldP spid="2" grpId="0"/>"#));
        assert!(xml.contains(r#"<p:bldP spid="3" grpId="0" animBg="1"/>"#));
        assert!(!xml.contains(r#"<p:bldP spid="4""#));
        let el = parse(
            format!(r#"<p:timing xmlns:p="p">{}"#, &xml["<p:timing>".len()..]).as_bytes(),
            "t",
        )
        .unwrap();
        let mut w = Warnings::default();
        let back = read_timing(&el, &spids, &mut w);
        assert!(w.into_vec().is_empty());
        let expect: Vec<Animation> = anims
            .iter()
            .map(|a| Animation {
                id: NodeId(0),
                ..*a
            })
            .collect();
        assert_eq!(back, expect);
        // unknown targets are an error on write
        let mut bad = anims[0];
        bad.shape = NodeId(77);
        assert_eq!(
            write_timing(&mut XmlOut::fragment(), &[bad], &targets, &[]),
            Err(bad.id)
        );
    }

    #[test]
    fn libreoffice_style_timing() {
        // LibreOffice: no grpId/bldLst, `additive="repl"`, fly-out subtype 0
        let xml = r##"<p:timing xmlns:p="p"><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>
<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
<p:par><p:cTn id="5" nodeType="clickEffect" fill="hold" presetClass="exit" presetID="2" presetSubtype="0"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="repl"><p:cTn id="6" dur="500" fill="hold"/><p:tgtEl><p:spTgt spid="7"/></p:tgtEl><p:attrNameLst><p:attrName>ppt_x</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="#ppt_x"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="0-#ppt_w/2"/></p:val></p:tav></p:tavLst></p:anim>
<p:set><p:cBhvr><p:cTn id="7" dur="1" fill="hold"><p:stCondLst><p:cond delay="499"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="7"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="hidden"/></p:to></p:set>
</p:childTnLst></p:cTn></p:par>
<p:par><p:cTn id="8" presetClass="entr" presetID="16" presetSubtype="21"><p:childTnLst/></p:cTn></p:par>
<p:par><p:cTn id="9" presetClass="entr" presetID="10"><p:stCondLst><p:cond delay="100"/></p:stCondLst><p:childTnLst><p:animEffect filter="fade" transition="in"><p:cBhvr><p:cTn id="10" dur="800"/><p:tgtEl><p:spTgt spid="7"><p:txEl><p:pRg st="0" end="0"/></p:txEl></p:spTgt></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>
</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>
</p:childTnLst></p:cTn></p:seq><p:seq><p:cTn id="20" nodeType="interactiveSeq"/></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>"##;
        let el = parse(xml.as_bytes(), "t").unwrap();
        let spids = HashMap::from([(7, NodeId(70))]);
        let mut w = Warnings::default();
        let back = read_timing(&el, &spids, &mut w);
        assert_eq!(back.len(), 2);
        assert_eq!(
            (
                back[0].kind,
                back[0].effect,
                back[0].direction,
                back[0].duration_ms
            ),
            (
                AnimationKind::Exit,
                Effect::FlyIn,
                Some(Direction::Left),
                500
            )
        );
        assert_eq!(
            (
                back[1].effect,
                back[1].trigger,
                back[1].delay_ms,
                back[1].duration_ms,
                back[1].shape
            ),
            (Effect::Fade, Trigger::WithPrevious, 100, 800, NodeId(70))
        );
        assert_eq!(
            w.into_vec(),
            [
                "animation effect entr #16 dropped",
                "animations of text paragraphs applied to the whole shape",
                "triggered animations dropped"
            ]
        );
    }
}
