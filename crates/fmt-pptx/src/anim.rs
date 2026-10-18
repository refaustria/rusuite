//! Animations (`p:timing`); transitions are in [`crate::transition`].
//!
//! Writing follows the structure PowerPoint itself writes: the timing tree
//! `tmRoot` → `mainSeq` → one `p:par` per click step → one `p:par` per
//! "after previous" step → one `p:par` per effect
//! (`presetID`/`presetClass`/`presetSubtype`, `grpId`, `nodeType`) with the
//! preset's behaviors (`p:set`, `p:anim`, `p:animEffect`, `p:animRot`,
//! `p:animScale`, `p:animClr`, `p:animMotion`, `p:cmd`) on a `p:spTgt`
//! (a paragraph range `p:txEl/p:pRg` for text built by paragraphs, `p:bg`
//! for the attached shape), one `interactiveSeq` per trigger (a click on a
//! shape, a media bookmark), and a `p:bldLst` entry per animated text
//! shape (`build="p"`, `bldLvl`, `rev`, `animBg`). Reading recognizes the
//! same presets by `presetClass` + `presetID` (+ `presetSubtype`) and
//! folds the effects of one paragraph build back into one animation;
//! anything else is dropped with a warning.

use std::collections::HashMap;

use model_show::{
    Animation, AnimationKind, Direction, Effect, Iterate, IterateUnit, MediaClip, MediaKind,
    MediaStart, NodeId, Repeat, StartOn, TextBuild, Trigger,
};

use crate::warn::note;
use crate::xml::{parse_bool, parse_u32, El, XmlOut};
use crate::Warnings;

const NS_P14: &str = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";

// --- presets ---------------------------------------------------------------------------

/// `presetSubtype` of a direction (PowerPoint: 1 top, 2 right, 4 bottom,
/// 8 left, sums for diagonals; 16 in, 32 out, 10 horizontal, 5 vertical
/// and their sums; 528 slide center).
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
        Direction::In | Direction::ObjectCenter => 16,
        Direction::Out => 32,
        Direction::Horizontal => 10,
        Direction::Vertical => 5,
        Direction::HorizontalIn => 26,
        Direction::VerticalIn => 21,
        Direction::HorizontalOut => 42,
        Direction::VerticalOut => 37,
        Direction::SlideCenter => 528,
        Direction::Center => 0,
    }
}

fn direction_of_subtype(effect: Effect, v: u32) -> Option<Direction> {
    effect
        .directions()
        .iter()
        .copied()
        .find(|d| subtype_of(*d) == v)
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

/// `presetID` of an animation.
fn preset_id(a: &Animation) -> u32 {
    use Effect::*;
    let d = a.effective_direction();
    match a.effect {
        Appear => 1,
        FlyIn => 2,
        Fade => 10,
        Float => {
            if d == Some(Direction::Down) {
                47
            } else {
                42
            }
        }
        Split => 16,
        Wipe => 22,
        Circle => 6,
        Box => 4,
        Diamond => 8,
        Plus => 13,
        Wheel => 21,
        RandomBars => 14,
        GrowTurn => 31,
        Zoom => 53,
        Swivel => 19,
        Bounce => 26,
        Pulse => 26,
        ColorPulse => 27,
        Teeter => 32,
        Spin => 8,
        GrowShrink => 6,
        Desaturate => 25,
        Darken => 24,
        Lighten => 30,
        Transparency => 9,
        ObjectColor => 19,
        LineColor => 7,
        FillColor => 1,
        BrushColor => 16,
        FontColor => 3,
        Underline => 18,
        BoldFlash => 10,
        BoldReveal => 15,
        Wave => 34,
        PathLines => match d {
            Some(Direction::Left) => 35,
            Some(Direction::Right) => 64,
            Some(Direction::Up) => 63,
            _ => 42,
        },
        PathArcs => match d {
            Some(Direction::Left) => 51,
            Some(Direction::Right) => 58,
            Some(Direction::Up) => 44,
            _ => 37,
        },
        PathTurns => match d {
            Some(Direction::RightDown) => 36,
            Some(Direction::Up) => 43,
            Some(Direction::RightUp) => 57,
            _ => 50,
        },
        PathShapes => 1,
        PathLoops => 24,
        PathCustom => 0,
        MediaPlay => 1,
        MediaPause => 2,
        MediaStop => 3,
    }
}

/// `presetSubtype` of an animation.
fn preset_subtype(a: &Animation) -> u32 {
    match a.effect {
        Effect::Wheel => a.effective_amount().unwrap_or(1).max(0) as u32,
        Effect::Float | Effect::PathLines | Effect::PathArcs | Effect::PathTurns => 0,
        e if e.directions().is_empty() => 0,
        _ => a.effective_direction().map_or(0, subtype_of),
    }
}

/// The effect (and the direction implied by the preset id) of a preset.
fn effect_of(class: AnimationKind, preset: u32) -> Option<(Effect, Option<Direction>)> {
    use Effect::*;
    let e = |e: Effect| Some((e, None));
    let ed = |e: Effect, d: Direction| Some((e, Some(d)));
    match class {
        AnimationKind::Emphasis => match preset {
            26 => e(Pulse),
            27 => e(ColorPulse),
            32 => e(Teeter),
            8 => e(Spin),
            6 => e(GrowShrink),
            25 => e(Desaturate),
            24 => e(Darken),
            30 => e(Lighten),
            9 => e(Transparency),
            19 => e(ObjectColor),
            7 => e(LineColor),
            1 => e(FillColor),
            16 => e(BrushColor),
            3 => e(FontColor),
            18 => e(Underline),
            10 => e(BoldFlash),
            15 => e(BoldReveal),
            34 => e(Wave),
            _ => None,
        },
        AnimationKind::Path => match preset {
            42 => ed(PathLines, Direction::Down),
            35 => ed(PathLines, Direction::Left),
            64 => ed(PathLines, Direction::Right),
            63 => ed(PathLines, Direction::Up),
            37 => ed(PathArcs, Direction::Down),
            51 => ed(PathArcs, Direction::Left),
            58 => ed(PathArcs, Direction::Right),
            44 => ed(PathArcs, Direction::Up),
            50 => ed(PathTurns, Direction::Down),
            36 => ed(PathTurns, Direction::RightDown),
            43 => ed(PathTurns, Direction::Up),
            57 => ed(PathTurns, Direction::RightUp),
            1 => e(PathShapes),
            24 => e(PathLoops),
            // every other path preset keeps its path as a custom path
            _ => e(PathCustom),
        },
        AnimationKind::Media => match preset {
            1 => e(MediaPlay),
            2 => e(MediaPause),
            3 => e(MediaStop),
            _ => None,
        },
        AnimationKind::Entrance | AnimationKind::Exit => match preset {
            1 => e(Appear),
            2 => e(FlyIn),
            10 => e(Fade),
            42 => ed(Float, Direction::Up),
            47 => ed(Float, Direction::Down),
            16 => e(Split),
            22 => e(Wipe),
            6 => e(Circle),
            4 => e(Box),
            8 => e(Diamond),
            13 => e(Plus),
            21 => e(Wheel),
            14 => e(RandomBars),
            31 => e(GrowTurn),
            // 53 = Zoom (PowerPoint 2010+), 23 = Basic Zoom
            53 | 23 => e(Zoom),
            19 => e(Swivel),
            26 => e(Bounce),
            _ => None,
        },
    }
}

fn class_name(k: AnimationKind) -> &'static str {
    match k {
        AnimationKind::Entrance => "entr",
        AnimationKind::Emphasis => "emph",
        AnimationKind::Exit => "exit",
        AnimationKind::Path => "path",
        AnimationKind::Media => "mediacall",
    }
}

// --- writing ---------------------------------------------------------------------------

/// How an animated shape was written.
#[derive(Debug, Clone, Default)]
pub(crate) struct Target {
    /// `p:cNvPr/@id`.
    pub spid: u32,
    /// A `p:sp` with a text body (gets a `p:bldP`).
    pub text: bool,
    /// A placeholder (its `p:bldP` has no `animBg`).
    pub placeholder: bool,
    /// The outline level (0-based) of each paragraph, `None` for empty
    /// ones (skipped by paragraph builds).
    pub paragraphs: Vec<Option<u8>>,
}

/// What a written effect targets.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Tgt {
    Shape,
    Para(usize),
    Bg,
}

/// The behaviors' target.
struct Bhv<'a> {
    spid: &'a str,
    tgt: Tgt,
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

    /// A behavior's `p:cTn`: duration, optional start delay and
    /// auto-reverse, `fill="hold"` unless `fill` is false.
    fn bhvr_ctn(&mut self, dur: &str, delay: u32, auto_rev: bool, fill: bool) {
        let mut attrs = vec![("dur", dur)];
        if auto_rev {
            attrs.push(("autoRev", "1"));
        }
        if fill {
            attrs.push(("fill", "hold"));
        }
        if delay > 0 {
            self.ctn_start(&attrs);
            self.cond_list(&delay.to_string());
            self.x.end("p:cTn");
        } else {
            self.ctn_empty(&attrs);
        }
    }

    fn cond_list(&mut self, delay: &str) {
        self.x.start("p:stCondLst", &[]);
        self.x.empty("p:cond", &[("delay", delay)]);
        self.x.end("p:stCondLst");
    }

    fn target(&mut self, spid: &str, tgt: Tgt) {
        self.x.start("p:tgtEl", &[]);
        match tgt {
            Tgt::Shape => self.x.empty("p:spTgt", &[("spid", spid)]),
            Tgt::Bg => {
                self.x.start("p:spTgt", &[("spid", spid)]);
                self.x.empty("p:bg", &[]);
                self.x.end("p:spTgt");
            }
            Tgt::Para(i) => {
                let i = i.to_string();
                self.x.start("p:spTgt", &[("spid", spid)]);
                self.x.start("p:txEl", &[]);
                self.x.empty("p:pRg", &[("st", &i), ("end", &i)]);
                self.x.end("p:txEl");
                self.x.end("p:spTgt");
            }
        }
        self.x.end("p:tgtEl");
    }

    fn attr_name(&mut self, names: &[&str]) {
        self.x.start("p:attrNameLst", &[]);
        for name in names {
            self.x.text_el("p:attrName", &[], name);
        }
        self.x.end("p:attrNameLst");
    }

    /// `p:set` of `style.visibility` to `to` at `delay`.
    fn set_visibility(&mut self, b: &Bhv<'_>, to: &str, delay: u32) {
        self.x.start("p:set", &[]);
        self.x.start("p:cBhvr", &[]);
        self.ctn_start(&[("dur", "1"), ("fill", "hold")]);
        self.cond_list(&delay.to_string());
        self.x.end("p:cTn");
        self.target(b.spid, b.tgt);
        self.attr_name(&["style.visibility"]);
        self.x.end("p:cBhvr");
        self.x.start("p:to", &[]);
        self.x.empty("p:strVal", &[("val", to)]);
        self.x.end("p:to");
        self.x.end("p:set");
    }

    /// `p:set` of `attr` to `to` for `dur`.
    fn set_attr(&mut self, b: &Bhv<'_>, attr: &str, to: &str, dur: &str, fill: bool) {
        self.x.start("p:set", &[]);
        self.x.start("p:cBhvr", &[]);
        self.bhvr_ctn(dur, 0, false, fill);
        self.target(b.spid, b.tgt);
        self.attr_name(&[attr]);
        self.x.end("p:cBhvr");
        self.x.start("p:to", &[]);
        self.x.empty("p:strVal", &[("val", to)]);
        self.x.end("p:to");
        self.x.end("p:set");
    }

    /// A linear `p:anim` of `attr` from `from` to `to`; `"0"` is written as
    /// a float value, everything else as a formula string.
    #[allow(clippy::too_many_arguments)]
    fn anim(
        &mut self,
        b: &Bhv<'_>,
        attr: &str,
        from: &str,
        to: &str,
        dur: &str,
        base: bool,
        auto_rev: bool,
    ) {
        self.x
            .start("p:anim", &[("calcmode", "lin"), ("valueType", "num")]);
        self.x
            .start("p:cBhvr", if base { &[("additive", "base")] } else { &[] });
        self.bhvr_ctn(dur, 0, auto_rev, true);
        self.target(b.spid, b.tgt);
        self.attr_name(&[attr]);
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

    fn anim_effect(&mut self, b: &Bhv<'_>, transition: &str, filter: &str, dur: &str) {
        self.x.start(
            "p:animEffect",
            &[("transition", transition), ("filter", filter)],
        );
        self.x.start("p:cBhvr", &[]);
        self.ctn_empty(&[("dur", dur)]);
        self.target(b.spid, b.tgt);
        self.x.end("p:cBhvr");
        self.x.end("p:animEffect");
    }

    fn anim_rot(&mut self, b: &Bhv<'_>, by: i64, dur: &str, delay: u32) {
        self.x.start("p:animRot", &[("by", &by.to_string())]);
        self.x.start("p:cBhvr", &[]);
        self.bhvr_ctn(dur, delay, false, true);
        self.target(b.spid, b.tgt);
        self.attr_name(&["r"]);
        self.x.end("p:cBhvr");
        self.x.end("p:animRot");
    }

    fn anim_scale(&mut self, b: &Bhv<'_>, by: i64, dur: &str, auto_rev: bool) {
        self.x.start("p:animScale", &[]);
        self.x.start("p:cBhvr", &[]);
        self.bhvr_ctn(dur, 0, auto_rev, true);
        self.target(b.spid, b.tgt);
        self.x.end("p:cBhvr");
        let by = by.to_string();
        self.x.empty("p:by", &[("x", &by), ("y", &by)]);
        self.x.end("p:animScale");
    }

    /// `p:animClr` of `attr` to an sRGB colour.
    fn anim_clr_to(&mut self, b: &Bhv<'_>, attr: &str, rgb: &str, dur: &str, auto_rev: bool) {
        self.x
            .start("p:animClr", &[("clrSpc", "rgb"), ("dir", "cw")]);
        self.x.start("p:cBhvr", &[]);
        self.bhvr_ctn(dur, 0, auto_rev, true);
        self.target(b.spid, b.tgt);
        self.attr_name(&[attr]);
        self.x.end("p:cBhvr");
        self.x.start("p:to", &[]);
        self.x.empty("a:srgbClr", &[("val", rgb)]);
        self.x.end("p:to");
        self.x.end("p:animClr");
    }

    /// `p:animClr` of the fill by an HSL offset (Desaturate, Darken,
    /// Lighten).
    fn anim_clr_by(&mut self, b: &Bhv<'_>, s: &str, l: &str, dur: &str) {
        self.x
            .start("p:animClr", &[("clrSpc", "hsl"), ("dir", "cw")]);
        self.x.start("p:cBhvr", &[]);
        self.bhvr_ctn(dur, 0, false, true);
        self.target(b.spid, b.tgt);
        self.attr_name(&["fillcolor"]);
        self.x.end("p:cBhvr");
        self.x.start("p:by", &[]);
        self.x.empty("p:hsl", &[("h", "0"), ("s", s), ("l", l)]);
        self.x.end("p:by");
        self.x.end("p:animClr");
    }

    fn anim_motion(&mut self, b: &Bhv<'_>, path: &str, dur: &str) {
        self.x.start(
            "p:animMotion",
            &[
                ("origin", "layout"),
                ("path", path),
                ("pathEditMode", "relative"),
                ("ptsTypes", ""),
            ],
        );
        self.x.start("p:cBhvr", &[]);
        self.bhvr_ctn(dur, 0, false, true);
        self.target(b.spid, b.tgt);
        self.attr_name(&["ppt_x", "ppt_y"]);
        self.x.end("p:cBhvr");
        self.x.end("p:animMotion");
    }

    fn cmd(&mut self, b: &Bhv<'_>, cmd: &str) {
        self.x.start("p:cmd", &[("type", "call"), ("cmd", cmd)]);
        self.x.start("p:cBhvr", &[]);
        self.ctn_empty(&[("dur", "1"), ("fill", "hold")]);
        self.target(b.spid, b.tgt);
        self.x.end("p:cBhvr");
        self.x.end("p:cmd");
    }

    /// The behaviors of one effect.
    fn behaviors(&mut self, a: &Animation, b: &Bhv<'_>) {
        let dur_s = a.duration_ms.to_string();
        let dur = dur_s.as_str();
        let half_s = (a.duration_ms / 2).max(1).to_string();
        let half = half_s.as_str();
        let quarter = (a.duration_ms / 4).max(1);
        let quarter_s = quarter.to_string();
        let hide_at = a.duration_ms.saturating_sub(1);
        let dir = a.effective_direction().unwrap_or(Direction::Down);
        let color = a.effective_color().unwrap_or("FF0000").to_owned();
        match a.kind {
            AnimationKind::Media => {
                let cmd = match a.effect {
                    Effect::MediaPause => "togglePause",
                    Effect::MediaStop => "stop",
                    _ => "playFrom(0.0)",
                };
                self.cmd(b, cmd);
            }
            AnimationKind::Path => {
                let path = a
                    .effective_path()
                    .unwrap_or_else(|| "M 0 0 L 0 0 E".to_owned());
                self.anim_motion(b, &path, dur);
            }
            AnimationKind::Emphasis => match a.effect {
                Effect::Pulse => self.anim_scale(b, 105_000, half, true),
                Effect::ColorPulse => self.anim_clr_to(b, "fillcolor", &color, half, true),
                Effect::Teeter => {
                    // four swings; the last one takes the rest of the duration
                    let last = (a.duration_ms.saturating_sub(3 * quarter))
                        .max(1)
                        .to_string();
                    for (i, by) in [240_000i64, -480_000, 480_000, -240_000]
                        .into_iter()
                        .enumerate()
                    {
                        let d = if i == 3 { &last } else { &quarter_s };
                        self.anim_rot(b, by, d, quarter * i as u32);
                    }
                }
                Effect::Spin => {
                    let deg = i64::from(a.effective_amount().unwrap_or(360));
                    self.anim_rot(b, deg * 60_000, dur, 0);
                }
                Effect::GrowShrink => {
                    let pct = i64::from(a.effective_amount().unwrap_or(150));
                    self.anim_scale(b, pct * 1000, dur, false);
                }
                Effect::Desaturate => self.anim_clr_by(b, "-100000", "0", dur),
                Effect::Darken => self.anim_clr_by(b, "0", "-25000", dur),
                Effect::Lighten => self.anim_clr_by(b, "0", "25000", dur),
                Effect::Transparency => {
                    let pct = a.effective_amount().unwrap_or(50).clamp(0, 100);
                    let opacity = format!("{}", f64::from(100 - pct) / 100.0);
                    self.set_attr(b, "style.opacity", &opacity, dur, true);
                    self.anim_effect(b, "out", "image", dur);
                }
                Effect::ObjectColor | Effect::FillColor => {
                    self.anim_clr_to(b, "fillcolor", &color, dur, false);
                    self.set_attr(b, "fill.type", "solid", dur, true);
                }
                Effect::LineColor => self.anim_clr_to(b, "stroke.color", &color, dur, false),
                Effect::BrushColor | Effect::FontColor => {
                    self.anim_clr_to(b, "style.color", &color, dur, false)
                }
                Effect::Underline => {
                    self.set_attr(b, "style.textDecorationUnderline", "true", dur, true)
                }
                Effect::BoldFlash => self.set_attr(b, "style.fontWeight", "bold", dur, false),
                Effect::BoldReveal => self.set_attr(b, "style.fontWeight", "bold", dur, true),
                Effect::Wave => self.anim(b, "ppt_y", "#ppt_y", "#ppt_y-0.05", half, false, true),
                _ => {}
            },
            AnimationKind::Entrance | AnimationKind::Exit => {
                let entr = a.kind == AnimationKind::Entrance;
                let tr = if entr { "in" } else { "out" };
                // `(from, to)` of the entrance; swapped for exits
                let ft = |hidden: &'static str, shown: &'static str| {
                    if entr {
                        (hidden, shown)
                    } else {
                        (shown, hidden)
                    }
                };
                if entr {
                    self.set_visibility(b, "visible", 0);
                } else if a.effect == Effect::Appear {
                    self.set_visibility(b, "hidden", 0);
                    return;
                }
                match a.effect {
                    Effect::Appear => {}
                    Effect::Fade => self.anim_effect(b, tr, "fade", dur),
                    Effect::FlyIn => {
                        let (x, y) = fly_values(dir);
                        let (fx, tx) = ft(x, "#ppt_x");
                        let (fy, ty) = ft(y, "#ppt_y");
                        self.anim(b, "ppt_x", fx, tx, dur, true, false);
                        self.anim(b, "ppt_y", fy, ty, dur, true, false);
                    }
                    Effect::Float => {
                        self.anim_effect(b, tr, "fade", dur);
                        // Float Up comes from below and leaves upward
                        let off = if (dir == Direction::Up) == entr {
                            "#ppt_y+.1"
                        } else {
                            "#ppt_y-.1"
                        };
                        let (f, t) = ft(off, "#ppt_y");
                        self.anim(b, "ppt_y", f, t, dur, false, false);
                    }
                    Effect::Split => {
                        let filter = match dir {
                            Direction::VerticalIn => "barn(inVertical)",
                            Direction::HorizontalIn => "barn(inHorizontal)",
                            Direction::HorizontalOut => "barn(outHorizontal)",
                            _ => "barn(outVertical)",
                        };
                        self.anim_effect(b, tr, filter, dur);
                    }
                    Effect::Wipe => self.anim_effect(b, tr, wipe_filter(dir), dur),
                    Effect::Circle | Effect::Box | Effect::Diamond | Effect::Plus => {
                        let shape = match a.effect {
                            Effect::Circle => "circle",
                            Effect::Box => "box",
                            Effect::Diamond => "diamond",
                            _ => "plus",
                        };
                        let io = if dir == Direction::Out { "out" } else { "in" };
                        self.anim_effect(b, tr, &format!("{shape}({io})"), dur);
                    }
                    Effect::Wheel => {
                        let n = a.effective_amount().unwrap_or(1);
                        self.anim_effect(b, tr, &format!("wheel({n})"), dur);
                    }
                    Effect::RandomBars => {
                        let f = if dir == Direction::Vertical {
                            "randombar(vertical)"
                        } else {
                            "randombar(horizontal)"
                        };
                        self.anim_effect(b, tr, f, dur);
                    }
                    Effect::GrowTurn => {
                        let (f, t) = ft("0", "#ppt_w");
                        self.anim(b, "ppt_w", f, t, dur, false, false);
                        let (f, t) = ft("0", "#ppt_h");
                        self.anim(b, "ppt_h", f, t, dur, false, false);
                        let (f, t) = ft("-90", "0");
                        self.anim(b, "style.rotation", f, t, dur, false, false);
                        self.anim_effect(b, tr, "fade", dur);
                    }
                    Effect::Zoom => {
                        let (f, t) = ft("0", "#ppt_w");
                        self.anim(b, "ppt_w", f, t, dur, false, false);
                        let (f, t) = ft("0", "#ppt_h");
                        self.anim(b, "ppt_h", f, t, dur, false, false);
                        if dir == Direction::SlideCenter {
                            let (f, t) = ft("0.5", "#ppt_x");
                            self.anim(b, "ppt_x", f, t, dur, false, false);
                            let (f, t) = ft("0.5", "#ppt_y");
                            self.anim(b, "ppt_y", f, t, dur, false, false);
                        }
                        self.anim_effect(b, tr, "fade", dur);
                    }
                    Effect::Swivel => {
                        let (attr, shown) = if dir == Direction::Vertical {
                            ("ppt_h", "#ppt_h")
                        } else {
                            ("ppt_w", "#ppt_w")
                        };
                        let (f, t) = ft("0", shown);
                        self.anim(b, attr, f, t, dur, false, false);
                        self.anim_effect(b, tr, "fade", dur);
                    }
                    Effect::Bounce => {
                        let (f, t) = ft("#ppt_y-0.25", "#ppt_y");
                        self.anim(b, "ppt_y", f, t, dur, false, false);
                        self.anim_effect(b, tr, "fade", dur);
                    }
                    _ => {}
                }
                if !entr {
                    self.set_visibility(b, "hidden", hide_at);
                }
            }
        }
    }
}

/// How long an effect runs (Appear and media commands are instant;
/// auto-reverse doubles, a repeat count multiplies).
fn run_time(a: &Animation) -> u32 {
    let mut d = if a.effect == Effect::Appear || a.kind == AnimationKind::Media {
        0
    } else {
        a.duration_ms
    };
    if a.auto_reverse {
        d = d.saturating_mul(2);
    }
    if let Some(Repeat::Times(n)) = a.repeat {
        d = (u64::from(d) * u64::from(n) / 1000).min(u64::from(u32::MAX)) as u32;
    }
    a.delay_ms.saturating_add(d)
}

/// A media shape on the slide being written (see [`write_timing`]).
#[derive(Debug, Clone, Copy)]
pub(crate) struct MediaTarget<'a> {
    /// `p:cNvPr/@id`.
    pub spid: u32,
    pub clip: &'a MediaClip,
}

/// One effect of a sequence: an animation instance (the whole shape, a
/// paragraph or the attached shape of a paragraph build), or a media
/// clip's "play" from its Start setting (`presetClass="mediacall"`).
#[derive(Clone, Copy)]
enum Eff<'a> {
    Anim {
        a: &'a Animation,
        trigger: Trigger,
        tgt: Tgt,
    },
    Media(MediaTarget<'a>),
}

impl Eff<'_> {
    fn trigger(&self) -> Trigger {
        match self {
            Eff::Anim { trigger, .. } => *trigger,
            Eff::Media(m) if m.clip.start == MediaStart::Automatically => Trigger::AfterPrevious,
            Eff::Media(_) => Trigger::OnClick,
        }
    }

    fn run_time(&self) -> u32 {
        match self {
            Eff::Anim { a, .. } => run_time(a),
            Eff::Media(_) => 0,
        }
    }
}

/// The paragraph steps of a paragraph build: each step's paragraph
/// indices (a paragraph of a level up to `level` with its deeper ones; all
/// in one step for `level` 0), in play order. Empty paragraphs are
/// skipped.
pub(crate) fn build_steps(paragraphs: &[Option<u8>], b: &TextBuild) -> Vec<Vec<usize>> {
    let mut steps: Vec<Vec<usize>> = Vec::new();
    for (i, lvl) in paragraphs.iter().enumerate() {
        let Some(lvl) = lvl else { continue };
        let starts = b.level > 0 && *lvl < b.level;
        match steps.last_mut() {
            Some(s) if !starts => s.push(i),
            _ => steps.push(vec![i]),
        }
    }
    if b.reverse {
        steps.reverse();
    }
    steps
}

/// The effect instances of `a` on `target` (one, or one per paragraph):
/// the first gets the animation's trigger, every further step On Click
/// (for On Click animations) or After Previous, the paragraphs of a step
/// With Previous.
fn instances<'a>(a: &'a Animation, target: &Target) -> Vec<Eff<'a>> {
    let one = |trigger, tgt| Eff::Anim { a, trigger, tgt };
    let Some(b) = a.build.filter(|_| target.text) else {
        return vec![one(a.trigger, Tgt::Shape)];
    };
    let steps = build_steps(&target.paragraphs, &b);
    if steps.is_empty() {
        return vec![one(a.trigger, Tgt::Shape)];
    }
    let mut out = Vec::new();
    if b.animate_background {
        out.push(one(a.trigger, Tgt::Bg));
    }
    for (si, step) in steps.iter().enumerate() {
        for (pi, &p) in step.iter().enumerate() {
            let trigger = if out.is_empty() {
                a.trigger
            } else if pi > 0 || si == 0 {
                Trigger::WithPrevious
            } else if a.trigger == Trigger::OnClick {
                Trigger::OnClick
            } else {
                Trigger::AfterPrevious
            };
            out.push(one(trigger, Tgt::Para(p)));
        }
    }
    out
}

/// click steps → "after previous" steps → effects
type Groups<'a> = Vec<Vec<Vec<Eff<'a>>>>;

fn group(effs: Vec<Eff<'_>>) -> Groups<'_> {
    let mut groups: Groups<'_> = Vec::new();
    for e in effs {
        match (e.trigger(), groups.last_mut()) {
            (Trigger::OnClick, _) | (_, None) => groups.push(vec![vec![e]]),
            (Trigger::AfterPrevious, Some(g)) => g.push(vec![e]),
            (Trigger::WithPrevious, Some(g)) => {
                if let Some(sub) = g.last_mut() {
                    sub.push(e);
                }
            }
        }
    }
    groups
}

/// A `p:bldP` entry: spid, grpId, placeholder, paragraph build.
type BuildEntry = (u32, u32, bool, Option<TextBuild>);

/// Writes `p:timing` for `anims` (in play order) and the slide's media
/// clips: "Automatically" clips play first when the slide appears, "In
/// Click Sequence" ones get a click step after the animations; every clip
/// gets its `p:video`/`p:audio` node (volume, mute, loop, hide while not
/// playing, play across slides, rewind). Triggered animations go into one
/// interactive sequence per trigger. Fails with the id of an animation
/// whose shape (or trigger shape) was not written.
pub(crate) fn write_timing(
    x: &mut XmlOut,
    anims: &[Animation],
    targets: &HashMap<NodeId, Target>,
    media: &[MediaTarget<'_>],
) -> Result<(), NodeId> {
    let mut main: Vec<Eff<'_>> = Vec::new();
    // trigger → its effects, in order of first appearance
    let mut triggered: Vec<(&StartOn, Vec<Eff<'_>>)> = Vec::new();
    for a in anims {
        let Some(target) = targets.get(&a.shape) else {
            return Err(a.id);
        };
        let inst = instances(a, target);
        match &a.start_on {
            None => main.extend(inst),
            Some(on) => {
                if !targets.contains_key(&on.shape()) {
                    return Err(a.id);
                }
                match triggered.iter_mut().find(|(k, _)| *k == on) {
                    Some((_, v)) => v.extend(inst),
                    None => triggered.push((on, inst)),
                }
            }
        }
    }
    let mut groups = group(main);
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
    let mut builds: Vec<BuildEntry> = Vec::new();
    let mut grp_ids: HashMap<(u32, Option<NodeId>), u32> = HashMap::new();
    let mut next_grp: HashMap<u32, u32> = HashMap::new();
    let mut ctx = SeqCtx {
        targets,
        builds: &mut builds,
        grp_ids: &mut grp_ids,
        next_grp: &mut next_grp,
    };
    if !groups.is_empty() {
        t.x.start("p:seq", &[("concurrent", "1"), ("nextAc", "seek")]);
        t.ctn_start(&[("dur", "indefinite"), ("nodeType", "mainSeq")]);
        t.x.start("p:childTnLst", &[]);
        t.groups(&groups, starts_on_load, false, &mut ctx);
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
    for (on, effs) in triggered {
        let spid = targets[&on.shape()].spid.to_string();
        let groups = group(effs);
        let (evt, bmk) = match on {
            StartOn::Click(_) => ("onClick", None),
            StartOn::Bookmark { name, .. } => ("onMediaBookmark", Some(name.as_str())),
        };
        if bmk.is_some() {
            t.x.start("mc:AlternateContent", &[("xmlns:mc", NS_MC)]);
            t.x.start("mc:Choice", &[("xmlns:p14", NS_P14), ("Requires", "p14")]);
        }
        t.x.start("p:seq", &[("concurrent", "1"), ("nextAc", "seek")]);
        let mut attrs = vec![
            ("restart", "whenNotActive"),
            ("fill", "hold"),
            ("evtFilter", "cancelBubble"),
            ("nodeType", "interactiveSeq"),
        ];
        if let Some(name) = bmk {
            attrs.push(("p14:bmkName", name));
        }
        t.ctn_start(&attrs);
        t.trigger_cond("p:stCondLst", evt, &spid);
        t.x.start("p:endSync", &[("evt", "end"), ("delay", "0")]);
        t.x.empty("p:rtn", &[("val", "all")]);
        t.x.end("p:endSync");
        t.x.start("p:childTnLst", &[]);
        t.groups(&groups, false, true, &mut ctx);
        t.x.end("p:childTnLst");
        t.x.end("p:cTn");
        t.trigger_cond("p:nextCondLst", evt, &spid);
        t.x.end("p:seq");
        if bmk.is_some() {
            t.x.end("mc:Choice");
            t.x.empty("mc:Fallback", &[]);
            t.x.end("mc:AlternateContent");
        }
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
        for (spid, grp, placeholder, build) in builds {
            let (spid, grp) = (spid.to_string(), grp.to_string());
            let mut attrs = vec![("spid", spid.as_str()), ("grpId", grp.as_str())];
            let lvl = build.map(|b| b.level.to_string()).unwrap_or_default();
            match build {
                Some(b) => {
                    attrs.push(("build", if b.level == 0 { "allAtOnce" } else { "p" }));
                    if b.level > 1 {
                        attrs.push(("bldLvl", &lvl));
                    }
                    if b.reverse {
                        attrs.push(("rev", "1"));
                    }
                    if b.animate_background {
                        attrs.push(("animBg", "1"));
                    }
                }
                None if !placeholder => attrs.push(("animBg", "1")),
                None => {}
            }
            t.x.empty("p:bldP", &attrs);
        }
        t.x.end("p:bldLst");
    }
    t.x.end("p:timing");
    Ok(())
}

/// Shared state of the sequences of one slide: the `grpId` of each
/// animation (per shape, in order) and the `p:bldP` entries.
struct SeqCtx<'a, 'b> {
    targets: &'a HashMap<NodeId, Target>,
    builds: &'b mut Vec<BuildEntry>,
    grp_ids: &'b mut HashMap<(u32, Option<NodeId>), u32>,
    next_grp: &'b mut HashMap<u32, u32>,
}

impl SeqCtx<'_, '_> {
    /// The `grpId` of animation `a` (`None`: a clip's Start play) on shape
    /// `spid`: the next free one on first use; a text shape's first use
    /// adds its `p:bldP`.
    fn grp(&mut self, spid: u32, a: Option<&Animation>) -> u32 {
        let key = (spid, a.map(|a| a.id));
        if let Some(g) = self.grp_ids.get(&key) {
            return *g;
        }
        let n = self.next_grp.entry(spid).or_insert(0);
        let g = *n;
        *n += 1;
        self.grp_ids.insert(key, g);
        if let Some(a) = a {
            if let Some(t) = self.targets.get(&a.shape).filter(|t| t.text) {
                let build = a
                    .build
                    .filter(|b| !build_steps(&t.paragraphs, b).is_empty());
                self.builds.push((spid, g, t.placeholder, build));
            }
        }
        g
    }
}

impl TimingWriter<'_> {
    /// `<list><p:cond evt=… delay="0"><p:tgtEl><p:spTgt spid/></p:tgtEl></p:cond></list>`
    fn trigger_cond(&mut self, list: &str, evt: &str, spid: &str) {
        self.x.start(list, &[]);
        self.x.start("p:cond", &[("evt", evt), ("delay", "0")]);
        self.x.start("p:tgtEl", &[]);
        self.x.empty("p:spTgt", &[("spid", spid)]);
        self.x.end("p:tgtEl");
        self.x.end("p:cond");
        self.x.end(list);
    }

    /// The click groups of a sequence.
    fn groups(
        &mut self,
        groups: &Groups<'_>,
        starts_on_load: bool,
        interactive: bool,
        ctx: &mut SeqCtx<'_, '_>,
    ) {
        for (gi, group) in groups.iter().enumerate() {
            self.x.start("p:par", &[]);
            self.ctn_start(&[("fill", "hold")]);
            self.x.start("p:stCondLst", &[]);
            if interactive && gi == 0 {
                self.x.empty("p:cond", &[("delay", "0")]);
            } else {
                self.x.empty("p:cond", &[("delay", "indefinite")]);
            }
            if gi == 0 && starts_on_load {
                self.x
                    .start("p:cond", &[("evt", "onBegin"), ("delay", "0")]);
                self.x.empty("p:tn", &[("val", "2")]);
                self.x.end("p:cond");
            }
            self.x.end("p:stCondLst");
            self.x.start("p:childTnLst", &[]);
            let mut start = 0u32;
            for (si, sub) in group.iter().enumerate() {
                if si > 0 {
                    start = start
                        .saturating_add(group[si - 1].iter().map(Eff::run_time).max().unwrap_or(0));
                }
                self.x.start("p:par", &[]);
                self.ctn_start(&[("fill", "hold")]);
                self.cond_list(&start.to_string());
                self.x.start("p:childTnLst", &[]);
                for (ei, eff) in sub.iter().enumerate() {
                    let node_type = match (si, ei, eff.trigger()) {
                        _ if interactive && gi == 0 && si == 0 && ei == 0 => "clickEffect",
                        (0, 0, Trigger::OnClick) => "clickEffect",
                        (0, 0, Trigger::WithPrevious) => "withEffect",
                        (_, 0, _) => "afterEffect",
                        _ => "withEffect",
                    };
                    match eff {
                        Eff::Anim { a, tgt, .. } => {
                            let spid = ctx.targets[&a.shape].spid;
                            let grp = ctx.grp(spid, Some(a));
                            self.effect(a, spid, *tgt, grp, node_type);
                        }
                        Eff::Media(m) => {
                            let grp = ctx.grp(m.spid, None);
                            self.media_call(m.spid, grp, node_type);
                        }
                    }
                }
                self.x.end("p:childTnLst");
                self.x.end("p:cTn");
                self.x.end("p:par");
            }
            self.x.end("p:childTnLst");
            self.x.end("p:cTn");
            self.x.end("p:par");
        }
    }

    /// One animation effect `p:par`.
    fn effect(&mut self, a: &Animation, spid: u32, tgt: Tgt, grp_id: u32, node_type: &str) {
        let class = class_name(a.kind);
        let (preset, subtype, grp_s) = (
            preset_id(a).to_string(),
            preset_subtype(a).to_string(),
            grp_id.to_string(),
        );
        let repeat = match a.repeat {
            Some(Repeat::Times(n)) => Some(n.to_string()),
            Some(_) => Some("indefinite".to_owned()),
            None => None,
        };
        let mut attrs = vec![
            ("presetID", preset.as_str()),
            ("presetClass", class),
            ("presetSubtype", subtype.as_str()),
        ];
        if let Some(r) = &repeat {
            attrs.push(("repeatCount", r));
        }
        if a.auto_reverse {
            attrs.push(("autoRev", "1"));
        }
        attrs.push(("fill", if a.rewind { "remove" } else { "hold" }));
        attrs.push(("grpId", &grp_s));
        attrs.push(("nodeType", node_type));
        self.x.start("p:par", &[]);
        self.ctn_start(&attrs);
        self.cond_list(&a.delay_ms.to_string());
        if a.repeat == Some(Repeat::UntilNextClick) {
            self.x.start("p:endCondLst", &[]);
            self.x.start("p:cond", &[("evt", "onNext"), ("delay", "0")]);
            self.x.start("p:tgtEl", &[]);
            self.x.empty("p:sldTgt", &[]);
            self.x.end("p:tgtEl");
            self.x.end("p:cond");
            self.x.end("p:endCondLst");
        }
        if let Some(it) = a.iterate {
            let ty = match it.unit {
                IterateUnit::Word => "wd",
                IterateUnit::Letter => "lt",
            };
            self.x.start("p:iterate", &[("type", ty)]);
            self.x
                .empty("p:tmPct", &[("val", &it.delay_pct.to_string())]);
            self.x.end("p:iterate");
        }
        self.x.start("p:childTnLst", &[]);
        let spid = spid.to_string();
        self.behaviors(a, &Bhv { spid: &spid, tgt });
        self.x.end("p:childTnLst");
        self.x.end("p:cTn");
        self.x.end("p:par");
    }

    /// A media "play" effect from the clip's Start setting
    /// (`presetClass="mediacall"`, `p:cmd playFrom(0.0)`).
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
        let spid = spid.to_string();
        self.cmd(
            &Bhv {
                spid: &spid,
                tgt: Tgt::Shape,
            },
            "playFrom(0.0)",
        );
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
        if m.clip.play_across_slides {
            attrs.push(("numSld", "999"));
        }
        if m.clip.hide_when_not_playing {
            attrs.push(("showWhenStopped", "0"));
        }
        self.x.start(el, &[]);
        self.x.start("p:cMediaNode", &attrs);
        let mut ctn = vec![
            ("fill", if m.clip.rewind { "remove" } else { "hold" }),
            ("display", "0"),
        ];
        if m.clip.loop_playback {
            ctn.insert(0, ("repeatCount", "indefinite"));
        }
        self.ctn_start(&ctn);
        self.x.start("p:stCondLst", &[]);
        self.x.empty("p:cond", &[("delay", "indefinite")]);
        self.x.end("p:stCondLst");
        self.x.end("p:cTn");
        self.target(&m.spid.to_string(), Tgt::Shape);
        self.x.end("p:cMediaNode");
        self.x.end(el);
    }
}

// --- reading: media -----------------------------------------------------------------------

/// Playback settings of one media shape found in `p:timing`.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct MediaTiming {
    pub start: Option<MediaStart>,
    pub volume: Option<u32>,
    pub muted: bool,
    pub hide: bool,
    pub looped: bool,
    pub across_slides: bool,
    pub rewind: bool,
}

/// `el`, or for `mc:AlternateContent` its (first) choice's (else the
/// fallback's) first element.
fn unwrap_alternate(el: &El) -> Option<&El> {
    if el.name == "AlternateContent" {
        el.elements()
            .filter(|c| c.name == "Choice")
            .find_map(|c| c.elements().next())
            .or_else(|| el.child("Fallback").and_then(|f| f.elements().next()))
    } else {
        Some(el)
    }
}

/// The time nodes under `tmRoot`.
fn root_nodes(timing: &El) -> Vec<&El> {
    timing
        .child("tnLst")
        .and_then(|l| l.child("par"))
        .and_then(ctn_children)
        .map(|(_, roots)| roots)
        .unwrap_or_default()
}

/// The media settings of `p:timing` by `spid`: the `p:video`/`p:audio`
/// nodes (volume, mute, `showWhenStopped`, `repeatCount`, `numSld`,
/// `fill`) and the first `mediacall` play of each clip in the main
/// sequence (in a group that starts on load → Automatically, else In Click
/// Sequence; clips without one play when clicked).
pub(crate) fn read_media_timing(timing: &El) -> HashMap<u32, MediaTiming> {
    let mut out: HashMap<u32, MediaTiming> = HashMap::new();
    for node in root_nodes(timing) {
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
                e.across_slides = m.attr("numSld").and_then(parse_u32).is_some_and(|n| n > 1);
                let ctn = m.child("cTn");
                e.looped = ctn
                    .and_then(|c| c.attr("repeatCount"))
                    .is_some_and(|r| r == "indefinite");
                e.rewind = ctn.and_then(|c| c.attr("fill")) == Some("remove");
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
                        if c.attr("presetClass") != Some("mediacall")
                            || c.attr("presetID").and_then(parse_u32).unwrap_or(1) != 1
                        {
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
                        let e = out.entry(spid).or_default();
                        if e.start.is_none() {
                            e.start = Some(if on_load && !click {
                                MediaStart::Automatically
                            } else {
                                MediaStart::InClickSequence
                            });
                        }
                    }
                }
            }
            _ => {}
        }
    }
    out
}

// --- reading: animations ----------------------------------------------------------------

/// All descendants of `el` named `name`, depth-first.
fn descendants<'a>(el: &'a El, name: &str, out: &mut Vec<&'a El>) {
    for c in el.elements() {
        if c.name == name {
            out.push(c);
        }
        descendants(c, name, out);
    }
}

/// The `p:cTn` of a `p:par`/`p:seq` and its child time nodes (the
/// choices of `mc:AlternateContent` children included).
fn ctn_children(node: &El) -> Option<(&El, Vec<&El>)> {
    let ctn = node.child("cTn")?;
    let kids = ctn
        .child("childTnLst")
        .map(|l| l.elements().filter_map(unwrap_alternate).collect())
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

/// The `p:bldP` entries with a paragraph build, by `(spid, grpId)`.
type Builds = HashMap<(u32, u32), TextBuild>;

fn read_builds(timing: &El) -> Builds {
    let mut out = HashMap::new();
    for b in timing
        .child("bldLst")
        .into_iter()
        .flat_map(|l| l.elements())
        .filter(|b| b.name == "bldP")
    {
        let (Some(spid), Some(grp)) = (
            b.attr("spid").and_then(parse_u32),
            b.attr("grpId").and_then(parse_u32),
        ) else {
            continue;
        };
        let level = match b.attr("build") {
            Some("p") => b
                .attr("bldLvl")
                .and_then(parse_u32)
                .unwrap_or(1)
                .clamp(1, u32::from(TextBuild::MAX_LEVEL)) as u8,
            Some("allAtOnce") => 0,
            _ => continue,
        };
        out.insert(
            (spid, grp),
            TextBuild {
                level,
                reverse: b.attr("rev").and_then(parse_bool) == Some(true),
                animate_background: b.attr("animBg").and_then(parse_bool) == Some(true),
            },
        );
    }
    out
}

/// Duration of an effect from its behaviors: the latest end (start delay
/// plus duration, doubled by `autoRev`) of the behaviors other than the
/// visibility switch and commands.
fn behaviors_duration(ctn: &El) -> Option<u32> {
    let mut dur = None::<u32>;
    for b in ctn
        .child("childTnLst")
        .into_iter()
        .flat_map(|l| l.elements())
    {
        let Some(bctn) = b.child("cBhvr").and_then(|c| c.child("cTn")) else {
            continue;
        };
        let visibility = b.name == "set"
            && b.find("attrName")
                .is_some_and(|n| n.text() == "style.visibility");
        if visibility || b.name == "cmd" {
            continue;
        }
        let Some(d) = bctn.attr("dur").and_then(parse_u32) else {
            continue;
        };
        let d = if bctn.attr("autoRev").and_then(parse_bool) == Some(true) {
            d.saturating_mul(2)
        } else {
            d
        };
        let end = start_delay(bctn).saturating_add(d);
        dur = Some(dur.map_or(end, |m| m.max(end)));
    }
    dur
}

/// The amount of an effect from its preset subtype or behaviors (`None`
/// for the default).
fn read_amount(effect: Effect, ctn: &El, subtype: u32) -> Option<i32> {
    let v = match effect {
        Effect::Wheel => i32::try_from(subtype)
            .ok()
            .filter(|n| matches!(n, 1 | 2 | 3 | 4 | 8))?,
        Effect::Spin => {
            let by: i64 = ctn.find("animRot")?.attr("by")?.parse().ok()?;
            i32::try_from(by / 60_000).ok().filter(|d| *d != 0)?
        }
        Effect::GrowShrink => {
            let by: i64 = ctn
                .find("animScale")?
                .child("by")?
                .attr("x")?
                .parse()
                .ok()?;
            i32::try_from(by / 1000)
                .ok()
                .filter(|p| (1..=1000).contains(p))?
        }
        Effect::Transparency => {
            let mut sets = Vec::new();
            descendants(ctn, "set", &mut sets);
            let set = sets.into_iter().find(|s| {
                s.find("attrName")
                    .is_some_and(|n| n.text() == "style.opacity")
            })?;
            let o: f64 = set.find("strVal")?.attr("val")?.parse().ok()?;
            ((1.0 - o.clamp(0.0, 1.0)) * 100.0).round() as i32
        }
        _ => return None,
    };
    (Some(v) != effect.default_amount()).then_some(v)
}

/// What one effect `p:cTn` read as.
struct ReadEffect {
    anim: Animation,
    spid: u32,
    grp: Option<u32>,
    /// The effect targets a paragraph range or the attached shape.
    part: bool,
}

/// Reads one effect `p:cTn` (one with `presetClass`). `position` is the
/// trigger implied by the tree (for files without `nodeType`).
fn read_effect(
    ctn: &El,
    position: Trigger,
    spids: &HashMap<u32, NodeId>,
    w: &mut Warnings,
) -> Option<ReadEffect> {
    let class = ctn.attr("presetClass").unwrap_or("");
    let kind = match class {
        "entr" => AnimationKind::Entrance,
        "exit" => AnimationKind::Exit,
        "emph" => AnimationKind::Emphasis,
        "path" => AnimationKind::Path,
        "mediacall" => AnimationKind::Media,
        _ => {
            w.add(note!("pptx.anim.classDropped", class = class));
            return None;
        }
    };
    let preset = ctn.attr("presetID").and_then(parse_u32).unwrap_or(0);
    let Some((effect, preset_dir)) = effect_of(kind, preset) else {
        w.add(note!(
            "pptx.anim.effectDropped",
            class = class,
            preset = preset
        ));
        return None;
    };
    let Some(tgt) = ctn.find("spTgt") else {
        w.add(note!("pptx.anim.noTarget"));
        return None;
    };
    let Some(spid) = tgt.attr("spid").and_then(parse_u32) else {
        w.add(note!("pptx.anim.noTarget"));
        return None;
    };
    let Some(&shape) = spids.get(&spid) else {
        w.add(note!("pptx.anim.droppedShapes"));
        return None;
    };
    let trigger = match ctn.attr("nodeType") {
        Some("clickEffect") => Trigger::OnClick,
        Some("withEffect") => Trigger::WithPrevious,
        Some("afterEffect") => Trigger::AfterPrevious,
        _ => position,
    };
    let duration_ms = if effect == Effect::Appear || kind == AnimationKind::Media {
        0
    } else {
        behaviors_duration(ctn).unwrap_or(effect.default_duration_ms())
    };
    let subtype = ctn.attr("presetSubtype").and_then(parse_u32).unwrap_or(0);
    let direction = if effect.directions().is_empty() {
        None
    } else {
        preset_dir
            .or_else(|| direction_of_subtype(effect, subtype))
            .or_else(|| {
                if effect == Effect::FlyIn {
                    fly_direction_of_values(ctn)
                } else {
                    None
                }
            })
            .filter(|d| effect.directions().contains(d))
            .filter(|d| Some(*d) != effect.default_direction())
    };
    let mut a = Animation::new(shape, kind, effect);
    a.trigger = trigger;
    a.duration_ms = duration_ms;
    a.delay_ms = start_delay(ctn);
    a.direction = direction;
    a.amount = read_amount(effect, ctn, subtype);
    if effect.has_color() {
        a.color = ctn
            .find("srgbClr")
            .and_then(|c| c.val())
            .map(str::to_ascii_uppercase)
            .filter(|c| c.len() == 6 && Some(c.as_str()) != effect.default_color());
    }
    if kind == AnimationKind::Path {
        match ctn
            .find("animMotion")
            .and_then(|m| m.attr("path"))
            .map(model_show::motion::parse_path)
        {
            Some(Ok(cmds)) => {
                let p = model_show::motion::format_path(&cmds);
                // a preset's own path stays implicit
                let preset_path = model_show::motion::default_path(effect, a.effective_direction());
                if Some(&p) != preset_path.as_ref() {
                    a.path = Some(p);
                }
            }
            Some(Err(_)) => {
                w.add(note!("pptx.anim.badPath"));
                return None;
            }
            None => {}
        }
        if effect == Effect::PathCustom && a.path.is_none() {
            a.path = Some("M 0 0 L 0 0 E".to_owned());
        }
    }
    a.auto_reverse = ctn.attr("autoRev").and_then(parse_bool) == Some(true);
    a.rewind = ctn.attr("fill") == Some("remove");
    a.repeat = match ctn.attr("repeatCount") {
        Some("indefinite") => {
            let next = ctn
                .child("endCondLst")
                .is_some_and(|l| l.elements().any(|c| c.attr("evt") == Some("onNext")));
            Some(if next {
                Repeat::UntilNextClick
            } else {
                Repeat::UntilEndOfSlide
            })
        }
        Some(n) => parse_u32(n)
            .filter(|n| *n > 0 && *n != 1000)
            .map(Repeat::Times),
        None => None,
    };
    if let Some(it) = ctn.child("iterate") {
        let unit = match it.attr("type") {
            Some("wd") => Some(IterateUnit::Word),
            Some("lt") => Some(IterateUnit::Letter),
            _ => None,
        };
        if let Some(unit) = unit {
            let delay_pct = it
                .child("tmPct")
                .and_then(|p| p.val())
                .and_then(parse_u32)
                .unwrap_or(10_000)
                .min(100_000);
            a.iterate = Some(Iterate { unit, delay_pct });
        }
    }
    Some(ReadEffect {
        anim: a,
        spid,
        grp: ctn.attr("grpId").and_then(parse_u32),
        part: tgt.elements().next().is_some(),
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

/// The trigger of an interactive sequence: a click on a shape or a media
/// bookmark, with the trigger's `spid` (`None`: something else).
fn sequence_trigger(ctn: &El, spids: &HashMap<u32, NodeId>) -> Option<(StartOn, u32)> {
    let cond = ctn
        .child("stCondLst")?
        .elements()
        .find(|c| matches!(c.attr("evt"), Some("onClick" | "onMediaBookmark")))?;
    let spid = cond
        .find("spTgt")
        .and_then(|t| t.attr("spid"))
        .and_then(parse_u32)?;
    let shape = *spids.get(&spid)?;
    Some(match cond.attr("evt") {
        Some("onMediaBookmark") => (
            StartOn::Bookmark {
                shape,
                name: ctn.attr("bmkName")?.to_owned(),
            },
            spid,
        ),
        _ => (StartOn::Click(shape), spid),
    })
}

/// Reads the main sequence and the interactive sequences of `p:timing`
/// into animations (ids 0; the caller assigns them). `spids` maps
/// `p:cNvPr/@id` to the read shapes. The effects of one paragraph build
/// (same shape and `grpId`, a `p:bldP` with `build="p"`/`"allAtOnce"`)
/// become one animation; the clip plays of the media Start setting stay
/// with the clip ([`read_media_timing`]).
pub(crate) fn read_timing(
    timing: &El,
    spids: &HashMap<u32, NodeId>,
    w: &mut Warnings,
) -> Vec<Animation> {
    let builds = read_builds(timing);
    let mut out: Vec<Animation> = Vec::new();
    // (spid, grpId) of a paragraph build already read
    let mut merged: std::collections::HashSet<(u32, u32)> = Default::default();
    // clips whose main-sequence play was taken as their Start setting
    let mut start_plays: std::collections::HashSet<u32> = Default::default();
    for seq in root_nodes(timing) {
        if matches!(seq.name.as_str(), "video" | "audio") {
            continue;
        }
        let Some((ctn, groups)) = ctn_children(seq) else {
            continue;
        };
        let start_on = match ctn.attr("nodeType") {
            Some("mainSeq") => None,
            Some("interactiveSeq") => match sequence_trigger(ctn, spids) {
                Some(t) => Some(t),
                None => {
                    w.add(note!("pptx.anim.triggered"));
                    continue;
                }
            },
            _ => {
                w.add(note!("pptx.anim.outsideMain"));
                continue;
            }
        };
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
                        w.add(note!("pptx.anim.noPreset"));
                        continue;
                    }
                    let Some(r) = read_effect(ectn, position, spids, w) else {
                        continue;
                    };
                    let mut a = r.anim;
                    if a.kind == AnimationKind::Media {
                        let play = a.effect == Effect::MediaPlay;
                        match &start_on {
                            // the clip's Start setting
                            None if play && start_plays.insert(r.spid) => continue,
                            // "When Clicked On": a click on the clip itself
                            Some((StartOn::Click(_), s)) if *s == r.spid => continue,
                            _ => {}
                        }
                    }
                    if r.part {
                        match r.grp.filter(|g| builds.contains_key(&(r.spid, *g))) {
                            Some(g) => {
                                if !merged.insert((r.spid, g)) {
                                    continue;
                                }
                                a.build = Some(builds[&(r.spid, g)]);
                            }
                            None => w.add(note!("pptx.anim.paragraphs")),
                        }
                    }
                    if let Some((on, _)) = &start_on {
                        a.start_on = Some(on.clone());
                    }
                    out.push(a);
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
    use model_show::{Bookmark, MediaId};

    fn written(f: impl FnOnce(&mut XmlOut)) -> String {
        let mut x = XmlOut::fragment();
        f(&mut x);
        String::from_utf8(x.finish()).unwrap()
    }

    fn targets() -> HashMap<NodeId, Target> {
        (1..=3)
            .map(|n| {
                (
                    NodeId(n),
                    Target {
                        spid: n as u32 + 1,
                        text: n != 3,
                        placeholder: n == 1,
                        paragraphs: vec![Some(0), Some(1), None, Some(0)],
                    },
                )
            })
            .collect()
    }

    fn spids() -> HashMap<u32, NodeId> {
        (1..=3).map(|n| (n as u32 + 1, NodeId(n))).collect()
    }

    fn timing_el(xml: &str) -> El {
        parse(
            format!(
                r#"<p:timing xmlns:p="p" xmlns:a="a" xmlns:p14="p14" xmlns:mc="mc">{}"#,
                &xml["<p:timing>".len()..]
            )
            .as_bytes(),
            "t",
        )
        .unwrap()
    }

    fn roundtrip(anims: &[Animation]) -> (String, Vec<Animation>, Vec<String>) {
        let xml = written(|x| write_timing(x, anims, &targets(), &[]).unwrap());
        let mut w = Warnings::default();
        let back = read_timing(&timing_el(&xml), &spids(), &mut w);
        (xml, back, w.into_vec())
    }

    fn without_ids(anims: &[Animation]) -> Vec<Animation> {
        anims
            .iter()
            .map(|a| Animation {
                id: NodeId(0),
                ..a.clone()
            })
            .collect()
    }

    fn all_effects() -> Vec<Animation> {
        let mut out = Vec::new();
        let mut n = 100;
        for kind in [
            AnimationKind::Entrance,
            AnimationKind::Emphasis,
            AnimationKind::Exit,
            AnimationKind::Path,
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
                    if effect == Effect::PathCustom {
                        a.path = Some("M 0 0 L 0.1 0.2 C 0.3 0.3 0.4 0.1 0.5 0 E".into());
                    }
                    out.push(a);
                }
            }
        }
        out
    }

    #[test]
    fn every_effect_roundtrips() {
        let mut anims = all_effects();
        // the first one may start with the slide
        anims[0].trigger = Trigger::AfterPrevious;
        let (xml, back, warnings) = roundtrip(&anims);
        assert!(xml.contains(r#"<p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>"#));
        assert!(xml.contains(r#"<p:bldP spid="2" grpId="0"/>"#));
        assert!(xml.contains(r#"<p:bldP spid="3" grpId="0" animBg="1"/>"#));
        assert!(!xml.contains(r#"<p:bldP spid="4""#));
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(back, without_ids(&anims));
        // unknown targets are an error on write
        let mut bad = anims[0].clone();
        bad.shape = NodeId(77);
        assert_eq!(
            write_timing(
                &mut XmlOut::fragment(),
                std::slice::from_ref(&bad),
                &targets(),
                &[]
            ),
            Err(bad.id)
        );
    }

    #[test]
    fn presets_like_powerpoint() {
        let mut float = Animation::new(NodeId(1), AnimationKind::Entrance, Effect::Float);
        float.id = NodeId(10);
        let mut split = Animation::new(NodeId(2), AnimationKind::Exit, Effect::Split);
        split.id = NodeId(11);
        split.direction = Some(Direction::HorizontalIn);
        let mut wheel = Animation::new(NodeId(3), AnimationKind::Entrance, Effect::Wheel);
        wheel.id = NodeId(12);
        wheel.amount = Some(4);
        let mut zoom = Animation::new(NodeId(3), AnimationKind::Entrance, Effect::Zoom);
        zoom.id = NodeId(13);
        zoom.direction = Some(Direction::SlideCenter);
        let mut line = Animation::new(NodeId(3), AnimationKind::Path, Effect::PathLines);
        line.id = NodeId(14);
        line.direction = Some(Direction::Right);
        let list = [float, split, wheel, zoom, line];
        let (xml, back, w) = roundtrip(&list);
        assert!(w.is_empty(), "{w:?}");
        for want in [
            r#"presetID="42" presetClass="entr" presetSubtype="0""#,
            r#"presetID="16" presetClass="exit" presetSubtype="26""#,
            r#"filter="barn(inHorizontal)""#,
            r#"presetID="21" presetClass="entr" presetSubtype="4""#,
            r#"filter="wheel(4)""#,
            r#"presetID="53" presetClass="entr" presetSubtype="528""#,
            r#"presetID="64" presetClass="path" presetSubtype="0""#,
            r#"<p:animMotion origin="layout" path="M 0 0 L 0.25 0 E" pathEditMode="relative" ptsTypes="">"#,
        ] {
            assert!(xml.contains(want), "{want}\n{xml}");
        }
        assert_eq!(back, without_ids(&list));
    }

    #[test]
    fn emphasis_options_roundtrip() {
        let mut list: Vec<Animation> = Vec::new();
        let mut add = |effect: Effect, f: &dyn Fn(&mut Animation)| {
            let mut a = Animation::new(NodeId(3), AnimationKind::Emphasis, effect);
            a.id = NodeId(50 + list.len() as u64);
            f(&mut a);
            list.push(a);
        };
        add(Effect::Spin, &|a| a.amount = Some(-90));
        add(Effect::GrowShrink, &|a| a.amount = Some(250));
        add(Effect::Transparency, &|a| a.amount = Some(75));
        add(Effect::FillColor, &|a| a.color = Some("00B050".into()));
        add(Effect::FontColor, &|a| a.color = Some("7030A0".into()));
        add(Effect::Pulse, &|a| a.auto_reverse = true);
        add(Effect::Teeter, &|a| a.repeat = Some(Repeat::Times(3000)));
        add(Effect::Spin, &|a| a.repeat = Some(Repeat::UntilNextClick));
        add(Effect::Spin, &|a| a.repeat = Some(Repeat::UntilEndOfSlide));
        add(Effect::Wave, &|a| a.rewind = true);
        let (xml, back, w) = roundtrip(&list);
        assert!(w.is_empty(), "{w:?}");
        assert!(xml.contains(r#"<p:animRot by="-5400000">"#), "{xml}");
        assert!(xml.contains(r#"<p:by x="250000" y="250000"/>"#));
        assert!(xml.contains(r#"<p:strVal val="0.25"/>"#));
        assert!(xml.contains(r#"<a:srgbClr val="00B050"/>"#));
        assert!(xml.contains(r#"repeatCount="3000""#));
        assert!(xml.contains(r#"<p:endCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:endCondLst>"#));
        assert!(xml.contains(r#"autoRev="1" fill="hold""#));
        assert!(xml.contains(r#"fill="remove""#));
        assert_eq!(back, without_ids(&list));
    }

    #[test]
    fn paragraph_builds() {
        // paragraphs: level 0, level 1, empty, level 0
        let mut a = Animation::new(NodeId(1), AnimationKind::Entrance, Effect::Float);
        a.id = NodeId(20);
        a.build = Some(TextBuild::by_paragraph());
        let (xml, back, w) = roundtrip(std::slice::from_ref(&a));
        assert!(w.is_empty(), "{w:?}");
        assert!(
            xml.contains(r#"<p:bldP spid="2" grpId="0" build="p"/>"#),
            "{xml}"
        );
        assert!(xml.contains(r#"<p:txEl><p:pRg st="0" end="0"/></p:txEl>"#));
        assert!(xml.contains(r#"<p:pRg st="1" end="1"/>"#));
        assert!(xml.contains(r#"<p:pRg st="3" end="3"/>"#));
        assert!(
            !xml.contains(r#"<p:pRg st="2""#),
            "empty paragraphs are skipped"
        );
        // two click steps: paragraph 0 with its sub-paragraph, then paragraph 3
        assert_eq!(xml.matches(r#"nodeType="clickEffect""#).count(), 2);
        assert_eq!(back, without_ids(std::slice::from_ref(&a)));

        // 2nd level, reversed, with the attached shape, after previous
        a.build = Some(TextBuild {
            level: 2,
            reverse: true,
            animate_background: true,
        });
        a.trigger = Trigger::AfterPrevious;
        let (xml, back, w) = roundtrip(std::slice::from_ref(&a));
        assert!(w.is_empty(), "{w:?}");
        assert!(
            xml.contains(r#"<p:bldP spid="2" grpId="0" build="p" bldLvl="2" rev="1" animBg="1"/>"#),
            "{xml}"
        );
        assert!(xml.contains(r#"<p:spTgt spid="2"><p:bg/></p:spTgt>"#));
        let first_para = xml.find("<p:pRg").unwrap();
        assert!(
            xml[first_para..].starts_with(r#"<p:pRg st="3""#),
            "reverse order"
        );
        assert_eq!(back, without_ids(std::slice::from_ref(&a)));
        assert_eq!(
            build_steps(&[Some(0), Some(1), None, Some(0)], &a.build.unwrap()),
            [vec![3], vec![1], vec![0]]
        );
        // all at once
        a.build = Some(TextBuild {
            level: 0,
            reverse: false,
            animate_background: false,
        });
        let (xml, back, _) = roundtrip(std::slice::from_ref(&a));
        assert!(xml.contains(r#"build="allAtOnce""#));
        assert_eq!(back, without_ids(&[a]));
    }

    #[test]
    fn iterate_by_letter() {
        let mut a = Animation::new(NodeId(2), AnimationKind::Entrance, Effect::Fade);
        a.id = NodeId(30);
        a.iterate = Some(Iterate {
            unit: IterateUnit::Letter,
            delay_pct: 10_000,
        });
        let (xml, back, _) = roundtrip(std::slice::from_ref(&a));
        assert!(
            xml.contains(
                r#"<p:iterate type="lt"><p:tmPct val="10000"/></p:iterate><p:childTnLst>"#
            ),
            "{xml}"
        );
        assert_eq!(back, without_ids(&[a]));
    }

    #[test]
    fn triggers_roundtrip() {
        let mut a = Animation::new(NodeId(1), AnimationKind::Entrance, Effect::Fade);
        a.id = NodeId(40);
        a.start_on = Some(StartOn::Click(NodeId(3)));
        let mut b = Animation::new(NodeId(2), AnimationKind::Emphasis, Effect::Spin);
        b.id = NodeId(41);
        b.trigger = Trigger::WithPrevious;
        b.start_on = Some(StartOn::Click(NodeId(3)));
        let mut c = Animation::new(NodeId(3), AnimationKind::Exit, Effect::Fade);
        c.id = NodeId(42);
        c.start_on = Some(StartOn::Bookmark {
            shape: NodeId(1),
            name: "Bookmark 1".into(),
        });
        let main = Animation {
            id: NodeId(43),
            ..Animation::new(NodeId(2), AnimationKind::Entrance, Effect::Appear)
        };
        let list = [a, b, main, c];
        let (xml, back, w) = roundtrip(&list);
        assert!(w.is_empty(), "{w:?}");
        assert!(xml.contains(r#"nodeType="interactiveSeq"><p:stCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cond></p:stCondLst>"#), "{xml}");
        assert!(xml.contains(
            r#"<p:nextCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="4"/>"#
        ));
        assert!(xml.contains(r#"p14:bmkName="Bookmark 1"><p:stCondLst><p:cond evt="onMediaBookmark" delay="0"><p:tgtEl><p:spTgt spid="2"/>"#));
        // main sequence first, then the triggers in order
        let expect = without_ids(&[
            list[2].clone(),
            list[0].clone(),
            list[1].clone(),
            list[3].clone(),
        ]);
        assert_eq!(back, expect);
        // a trigger shape that was not written
        let mut bad = list[0].clone();
        bad.start_on = Some(StartOn::Click(NodeId(9)));
        assert!(write_timing(&mut XmlOut::fragment(), &[bad], &targets(), &[]).is_err());
    }

    #[test]
    fn media_commands_and_nodes() {
        let mut clip = MediaClip::new(MediaKind::Video, MediaId(1));
        clip.start = MediaStart::Automatically;
        clip.play_across_slides = true;
        clip.rewind = true;
        clip.bookmarks = vec![Bookmark {
            name: "B".into(),
            time_ms: 500,
        }];
        let mut targets = targets();
        targets.insert(
            NodeId(9),
            Target {
                spid: 10,
                ..Target::default()
            },
        );
        let mut spids = spids();
        spids.insert(10, NodeId(9));
        let mut pause = Animation::new(NodeId(9), AnimationKind::Media, Effect::MediaPause);
        pause.id = NodeId(60);
        let mut stop = Animation::new(NodeId(9), AnimationKind::Media, Effect::MediaStop);
        stop.id = NodeId(61);
        stop.trigger = Trigger::AfterPrevious;
        let mut play = Animation::new(NodeId(9), AnimationKind::Media, Effect::MediaPlay);
        play.id = NodeId(62);
        play.start_on = Some(StartOn::Click(NodeId(1)));
        let list = [pause, stop, play];
        let media = [MediaTarget {
            spid: 10,
            clip: &clip,
        }];
        let xml = written(|x| write_timing(x, &list, &targets, &media).unwrap());
        assert!(
            xml.contains(r#"cmd="togglePause""#) && xml.contains(r#"cmd="stop""#),
            "{xml}"
        );
        assert!(
            xml.contains(r#"<p:cMediaNode vol="100000" numSld="999">"#),
            "{xml}"
        );
        assert!(xml.contains(r#"fill="remove" display="0""#));
        let el = timing_el(&xml);
        let mut w = Warnings::default();
        let back = read_timing(&el, &spids, &mut w);
        assert!(w.into_vec().is_empty());
        assert_eq!(back, without_ids(&list));
        let mt = &read_media_timing(&el)[&10];
        assert_eq!(mt.start, Some(MediaStart::Automatically));
        assert!(mt.across_slides && mt.rewind);
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
<p:par><p:cTn id="8" presetClass="entr" presetID="17" presetSubtype="21"><p:childTnLst/></p:cTn></p:par>
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
                "animation effect entr #17 dropped",
                "animations of text paragraphs applied to the whole shape",
                "triggered animations dropped"
            ]
        );
    }

    #[test]
    fn powerpoint_custom_motion_path() {
        // PowerPoint 2016: a custom path with exponents
        let xml = r##"<p:timing xmlns:p="p"><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>
<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
<p:par><p:cTn id="5" presetID="0" presetClass="path" presetSubtype="0" accel="50000" decel="50000" fill="hold" grpId="0" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:animMotion origin="layout" path="M -4.16667E-6 -4.07407E-6 L 0.21823 0.28704 E" pathEditMode="relative" rAng="0" ptsTypes="AA"><p:cBhvr><p:cTn id="6" dur="2000" fill="hold"/><p:tgtEl><p:spTgt spid="7"/></p:tgtEl><p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr><p:rCtr x="10911" y="14352"/></p:animMotion></p:childTnLst></p:cTn></p:par>
</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>
</p:childTnLst></p:cTn><p:prevCondLst/><p:nextCondLst/></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst><p:bldP spid="7" grpId="0" animBg="1"/></p:bldLst></p:timing>"##;
        let el = parse(xml.as_bytes(), "t").unwrap();
        let mut w = Warnings::default();
        let back = read_timing(&el, &HashMap::from([(7, NodeId(70))]), &mut w);
        assert!(w.into_vec().is_empty());
        assert_eq!(back[0].effect, Effect::PathCustom);
        assert_eq!(back[0].path.as_deref(), Some("M 0 0 L 0.21823 0.28704 E"));
        assert_eq!(back[0].duration_ms, 2000);
    }
}
