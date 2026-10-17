//! Slide transitions: `p:transition`, also inside `mc:AlternateContent`
//! with PowerPoint 2010's `p14:dur` and the PowerPoint 2010+ effects
//! (`p14:*`, `p15:prstTrans`, `p159:morph`), and the transition sound
//! (`p:sndAc`).
//!
//! Writing follows PowerPoint: `mc:AlternateContent` with the exact
//! duration (`p14:dur`) in the choice and only the speed in the fallback;
//! an extension effect sits in a choice that requires its namespace, the
//! fallback plays `p:fade`.

use model_show::{Direction, Transition, TransitionKind, TransitionOption, TransitionSound};

use crate::xml::{parse_bool, parse_u32, El, XmlOut};
use crate::Warnings;

const NS_MC: &str = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const NS_P14: &str = "http://schemas.microsoft.com/office/powerpoint/2010/main";
const NS_P15: &str = "http://schemas.microsoft.com/office/powerpoint/2012/main";
const NS_P159: &str = "http://schemas.microsoft.com/office/powerpoint/2015/09/main";

/// OOXML `dir` value of a side/eight direction.
pub(crate) fn side_name(d: Direction) -> Option<&'static str> {
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

pub(crate) fn side_from(v: &str) -> Option<Direction> {
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

/// `p15:prstTrans prst` of a kind.
fn prst_name(t: &Transition) -> Option<&'static str> {
    Some(match t.kind {
        TransitionKind::FallOver => "fallOver",
        TransitionKind::Drape => "drape",
        TransitionKind::Curtains => "curtains",
        TransitionKind::Wind => "wind",
        TransitionKind::Prestige => "prestige",
        TransitionKind::Fracture => "fracture",
        TransitionKind::Crush => "crush",
        TransitionKind::PeelOff => "peelOff",
        TransitionKind::PageCurl => match t.effective_option() {
            Some(TransitionOption::Single) => "pageCurlSingle",
            _ => "pageCurlDouble",
        },
        TransitionKind::Airplane => "airplane",
        TransitionKind::Origami => "origami",
        _ => return None,
    })
}

/// What an effect element read as.
type Read = (TransitionKind, Option<Direction>, Option<TransitionOption>);

/// The effect element of a `p:transition`: kind, direction and option,
/// or the unknown element's name.
fn transition_effect(t: &El, w: &mut Warnings) -> Result<Read, String> {
    let Some(e) = t
        .elements()
        .find(|e| !matches!(e.name.as_str(), "sndAc" | "extLst"))
    else {
        return Ok((TransitionKind::None, None, None));
    };
    let fits =
        |kind: TransitionKind, d: Option<Direction>| d.filter(|d| kind.directions().contains(d));
    let side = |kind: TransitionKind| (kind, fits(kind, e.attr("dir").and_then(side_from)), None);
    let flag = |name: &str| e.attr(name).and_then(parse_bool) == Some(true);
    // `invX` written: an explicit direction
    let inv =
        e.attr("invX").and_then(parse_bool).map(
            |i| {
                if i {
                    Direction::Right
                } else {
                    Direction::Left
                }
            },
        );
    let lr = |kind: TransitionKind| (kind, inv, None);
    Ok(match (e.prefix.as_str(), e.name.as_str()) {
        (_, "fade") => {
            if flag("thruBlk") {
                w.add("fade-through-black transition read as fade");
            }
            (TransitionKind::Fade, None, None)
        }
        ("p", "push") => side(TransitionKind::Push),
        ("p", "wipe") => side(TransitionKind::Wipe),
        ("p", "cover") => side(TransitionKind::Cover),
        ("p", "cut") => (TransitionKind::Cut, None, None),
        ("p", "split") => {
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
            (TransitionKind::Split, direction, None)
        }
        ("p", "zoom") => {
            let d = match e.attr("dir") {
                Some("in") => Some(Direction::In),
                Some("out") => Some(Direction::Out),
                _ => None,
            };
            (TransitionKind::Zoom, d, None)
        }
        (_, "vortex") => side(TransitionKind::Vortex),
        (_, "ripple") => {
            let d = match e.attr("dir") {
                Some("center") => Some(Direction::Center),
                Some(v) => side_from(v),
                None => None,
            };
            (
                TransitionKind::Ripple,
                fits(TransitionKind::Ripple, d),
                None,
            )
        }
        (_, "honeycomb") => (TransitionKind::Honeycomb, None, None),
        (_, "glitter") => {
            let (k, d, _) = side(TransitionKind::Glitter);
            let o = match e.attr("pattern") {
                Some("hexagon") => Some(TransitionOption::Hexagons),
                Some("diamond") => Some(TransitionOption::Diamonds),
                _ => None,
            };
            (k, d, o)
        }
        (_, "shred") => {
            let d = match e.attr("dir") {
                Some("out") => Some(Direction::Out),
                Some("in") => Some(Direction::In),
                _ => None,
            };
            let o = match e.attr("pattern") {
                Some("rectangle") => Some(TransitionOption::Particles),
                Some("strip") => Some(TransitionOption::Strips),
                _ => None,
            };
            (TransitionKind::Shred, d, o)
        }
        (_, "switch") => side(TransitionKind::Switch),
        (_, "flip") => side(TransitionKind::Flip),
        (_, "gallery") => side(TransitionKind::Gallery),
        (_, "prism") => {
            if flag("isContent") {
                return Err(e.qname());
            }
            side(if flag("isInverted") {
                TransitionKind::Box
            } else {
                TransitionKind::Cube
            })
        }
        (_, "doors") => {
            let d = match e.attr("dir") {
                Some("horz") => Some(Direction::Horizontal),
                Some("vert") => Some(Direction::Vertical),
                _ => None,
            };
            (TransitionKind::Doors, d, None)
        }
        (_, "reveal") => {
            let (k, d, _) = side(TransitionKind::Reveal);
            let o = e.attr("thruBlk").and_then(parse_bool).map(|b| {
                if b {
                    TransitionOption::ThroughBlack
                } else {
                    TransitionOption::Smoothly
                }
            });
            (k, d, o)
        }
        (_, "prstTrans") => {
            let kind = match e.attr("prst").unwrap_or("fallOver") {
                "fallOver" => TransitionKind::FallOver,
                "drape" => TransitionKind::Drape,
                "curtains" => TransitionKind::Curtains,
                "wind" => TransitionKind::Wind,
                "prestige" => TransitionKind::Prestige,
                "fracture" => TransitionKind::Fracture,
                "crush" => TransitionKind::Crush,
                "peelOff" => TransitionKind::PeelOff,
                "pageCurlDouble" | "pageCurlSingle" => {
                    // double is the default
                    let o = (e.attr("prst") == Some("pageCurlSingle"))
                        .then_some(TransitionOption::Single);
                    let (k, d, _) = lr(TransitionKind::PageCurl);
                    return Ok((k, d, o));
                }
                "airplane" => TransitionKind::Airplane,
                "origami" => TransitionKind::Origami,
                other => return Err(format!("p15:prstTrans prst=\"{other}\"")),
            };
            if kind.directions().is_empty() {
                (kind, None, None)
            } else {
                lr(kind)
            }
        }
        (_, "morph") => {
            let o = match e.attr("option") {
                Some("byWord") => Some(TransitionOption::Words),
                Some("byChar") => Some(TransitionOption::Characters),
                Some("byObject") => Some(TransitionOption::Objects),
                _ => None,
            };
            (TransitionKind::Morph, None, o)
        }
        _ => return Err(e.qname()),
    })
}

/// The transition's sound as written: `Some((None, _))` = stop the
/// previous sound, `Some((Some(rid), loop))` = play the sound of
/// relationship `rid`.
pub(crate) type SoundRef = (Option<String>, bool);

fn read_sound(t: &El) -> Option<SoundRef> {
    let snd = t.child("sndAc")?;
    if snd.child("endSnd").is_some() {
        return Some((None, false));
    }
    let st = snd.child("stSnd")?;
    let rid = st.child("snd")?.attr("embed")?.to_owned();
    Some((
        Some(rid),
        st.attr("loop").and_then(parse_bool) == Some(true),
    ))
}

/// Reads the slide's transition: a `p:transition` child of `p:sld`, or one
/// inside `mc:AlternateContent` (the choice's `p14:dur` and effect win; the
/// fallback's effect is used when the choice's is unknown), and the
/// relationship of its sound (resolved by the caller; the transition's
/// `sound` stays `None` here).
pub(crate) fn read_slide_transition(
    root: &El,
    w: &mut Warnings,
) -> Option<(Transition, Option<SoundRef>)> {
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
        let (kind, direction, option) = match effect {
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
            option,
            duration_ms,
            advance_on_click: primary.attr("advClick").and_then(parse_bool) != Some(false),
            advance_after_ms: primary.attr("advTm").and_then(parse_u32),
            sound: None,
        };
        let sound = read_sound(primary).or_else(|| fallback.and_then(read_sound));
        // LibreOffice writes an effect-less transition on every slide.
        if t.is_noop() && sound.is_none() {
            return None;
        }
        return Some((t, sound));
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

/// The effect element of an ECMA kind (`None`: no element).
fn ecma_effect(t: &Transition) -> Option<(&'static str, Vec<(&'static str, &'static str)>)> {
    match t.kind {
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
        // extensions: the fallback plays a fade
        _ => Some(("p:fade", vec![])),
    }
}

/// The effect element of an extension kind and the namespace prefix its
/// choice requires.
fn ext_effect(
    t: &Transition,
) -> (
    &'static str,
    Vec<(&'static str, &'static str)>,
    &'static str,
) {
    let side = t.direction.and_then(side_name);
    let dir = side.map(|d| vec![("dir", d)]).unwrap_or_default();
    let inv = match t.direction {
        Some(Direction::Right) => vec![("invX", "1")],
        Some(_) => vec![("invX", "0")],
        None => vec![],
    };
    let k = t.kind;
    if let Some(prst) = prst_name(t) {
        let mut a = vec![("prst", prst)];
        a.extend(inv);
        return ("p15:prstTrans", a, "p15");
    }
    let (name, attrs) = match k {
        TransitionKind::Vortex => ("p14:vortex", dir),
        TransitionKind::Switch => ("p14:switch", dir),
        TransitionKind::Flip => ("p14:flip", dir),
        TransitionKind::Gallery => ("p14:gallery", dir),
        TransitionKind::Honeycomb => ("p14:honeycomb", vec![]),
        TransitionKind::Ripple => (
            "p14:ripple",
            match t.direction {
                Some(Direction::Center) => vec![("dir", "center")],
                Some(d) => side_name(d).map(|d| vec![("dir", d)]).unwrap_or_default(),
                None => vec![],
            },
        ),
        TransitionKind::Glitter => {
            let mut a = dir;
            if let Some(o) = t.option {
                a.push((
                    "pattern",
                    if o == TransitionOption::Hexagons {
                        "hexagon"
                    } else {
                        "diamond"
                    },
                ));
            }
            ("p14:glitter", a)
        }
        TransitionKind::Shred => {
            let mut a = vec![];
            if let Some(o) = t.option {
                a.push((
                    "pattern",
                    if o == TransitionOption::Particles {
                        "rectangle"
                    } else {
                        "strip"
                    },
                ));
            }
            match t.direction {
                Some(Direction::Out) => a.push(("dir", "out")),
                Some(Direction::In) => a.push(("dir", "in")),
                _ => {}
            }
            ("p14:shred", a)
        }
        TransitionKind::Cube => ("p14:prism", dir),
        TransitionKind::Box => {
            let mut a = dir;
            a.push(("isInverted", "1"));
            ("p14:prism", a)
        }
        TransitionKind::Doors => (
            "p14:doors",
            match t.direction {
                Some(Direction::Horizontal) => vec![("dir", "horz")],
                Some(Direction::Vertical) => vec![("dir", "vert")],
                _ => vec![],
            },
        ),
        TransitionKind::Reveal => {
            let mut a = vec![];
            if let Some(o) = t.option {
                a.push((
                    "thruBlk",
                    if o == TransitionOption::ThroughBlack {
                        "1"
                    } else {
                        "0"
                    },
                ));
            }
            a.extend(dir);
            ("p14:reveal", a)
        }
        TransitionKind::Morph => {
            let opt = match t.option {
                Some(TransitionOption::Words) => vec![("option", "byWord")],
                Some(TransitionOption::Characters) => vec![("option", "byChar")],
                Some(_) => vec![("option", "byObject")],
                None => vec![],
            };
            return ("p159:morph", opt, "p159");
        }
        _ => ("p:fade", vec![]),
    };
    (name, attrs, "p14")
}

fn write_sound(x: &mut XmlOut, t: &Transition, rid: Option<&str>) {
    match (t.sound, rid) {
        (Some(TransitionSound::StopPrevious), _) => {
            x.start("p:sndAc", &[]);
            x.empty("p:endSnd", &[]);
            x.end("p:sndAc");
        }
        (
            Some(TransitionSound::Play {
                loop_until_next, ..
            }),
            Some(rid),
        ) => {
            x.start("p:sndAc", &[]);
            x.start(
                "p:stSnd",
                if loop_until_next {
                    &[("loop", "1")]
                } else {
                    &[]
                },
            );
            x.empty("p:snd", &[("r:embed", rid), ("name", "sound.wav")]);
            x.end("p:stSnd");
            x.end("p:sndAc");
        }
        _ => {}
    }
}

fn write_transition_el(x: &mut XmlOut, t: &Transition, choice: bool, sound_rid: Option<&str>) {
    let dur = t.duration_ms.to_string();
    let adv = t.advance_after_ms.map(|v| v.to_string());
    let mut attrs = vec![("spd", speed_of(t.duration_ms))];
    if !t.advance_on_click {
        attrs.push(("advClick", "0"));
    }
    if let Some(a) = &adv {
        attrs.push(("advTm", a));
    }
    if choice {
        attrs.push(("p14:dur", &dur));
    }
    let effect = if choice && t.kind.is_extension() {
        let (name, a, _) = ext_effect(t);
        Some((name, a))
    } else {
        ecma_effect(t)
    };
    let has_sound = t.sound.is_some()
        && (matches!(t.sound, Some(TransitionSound::StopPrevious)) || sound_rid.is_some());
    if effect.is_none() && !has_sound {
        x.empty("p:transition", &attrs);
        return;
    }
    x.start("p:transition", &attrs);
    if let Some((name, eattrs)) = effect {
        x.empty(name, &eattrs);
    }
    write_sound(x, t, sound_rid);
    x.end("p:transition");
}

/// Writes the transition the way PowerPoint does: `mc:AlternateContent`
/// with the exact duration (`p14:dur`) in the choice and only the speed in
/// the fallback; extension effects require their namespace in the choice
/// and fall back to a fade. `sound_rid` is the relationship of a
/// [`TransitionSound::Play`] sound. Writes nothing for a no-op transition
/// ([`Transition::is_noop`]).
pub(crate) fn write_transition(x: &mut XmlOut, t: &Transition, sound_rid: Option<&str>) {
    if t.is_noop() {
        return;
    }
    x.start("mc:AlternateContent", &[("xmlns:mc", NS_MC)]);
    let requires = if t.kind.is_extension() {
        ext_effect(t).2
    } else {
        "p14"
    };
    let mut choice = vec![("xmlns:p14", NS_P14)];
    match requires {
        "p15" => choice.push(("xmlns:p15", NS_P15)),
        "p159" => choice.push(("xmlns:p159", NS_P159)),
        _ => {}
    }
    choice.push(("Requires", requires));
    x.start("mc:Choice", &choice);
    write_transition_el(x, t, true, sound_rid);
    x.end("mc:Choice");
    x.start("mc:Fallback", &[]);
    write_transition_el(x, t, false, sound_rid);
    x.end("mc:Fallback");
    x.end("mc:AlternateContent");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse;
    use model_show::MediaId;

    fn written(t: &Transition, rid: Option<&str>) -> String {
        let mut x = XmlOut::fragment();
        write_transition(&mut x, t, rid);
        String::from_utf8(x.finish()).unwrap()
    }

    fn sld(inner: &str) -> El {
        parse(
            format!(
                r#"<p:sld xmlns:p="p" xmlns:mc="mc" xmlns:p14="p14" xmlns:p15="p15" xmlns:p159="p159" xmlns:r="r">{inner}</p:sld>"#
            )
            .as_bytes(),
            "s",
        )
        .unwrap()
    }

    fn read(xml: &str) -> Option<(Transition, Option<SoundRef>)> {
        let mut w = Warnings::default();
        let out = read_slide_transition(&sld(xml), &mut w);
        assert!(w.into_vec().is_empty(), "{xml}");
        out
    }

    #[test]
    fn transition_xml_like_powerpoint() {
        let t = Transition::new(TransitionKind::Fade);
        assert_eq!(
            written(&t, None),
            r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14"><p:transition spd="med" p14:dur="700"><p:fade/></p:transition></mc:Choice><mc:Fallback><p:transition spd="med"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>"#
        );
        let mut cube = Transition::new(TransitionKind::Cube);
        cube.direction = Some(Direction::Up);
        assert_eq!(
            written(&cube, None),
            r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14"><p:transition spd="slow" p14:dur="1000"><p14:prism dir="u"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>"#
        );
        let curtains = Transition::new(TransitionKind::Curtains);
        let xml = written(&curtains, None);
        assert!(xml.contains(r#"xmlns:p15="http://schemas.microsoft.com/office/powerpoint/2012/main" Requires="p15"><p:transition spd="slow" p14:dur="2750"><p15:prstTrans prst="curtains"/>"#), "{xml}");
        let morph = Transition::new(TransitionKind::Morph);
        let xml = written(&morph, None);
        assert!(
            xml.contains(
                r#"Requires="p159"><p:transition spd="slow" p14:dur="2000"><p159:morph/>"#
            ),
            "{xml}"
        );
    }

    #[test]
    fn every_kind_roundtrips() {
        let mut all = Vec::new();
        let mut timed = Transition::new(TransitionKind::None);
        timed.advance_after_ms = Some(5000);
        all.push(timed);
        for kind in TransitionKind::ALL {
            let t = Transition::new(kind);
            if t.is_noop() {
                assert!(written(&t, None).is_empty());
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
            for o in kind.options() {
                let mut t = Transition::new(kind);
                // Page Curl's double is its preset name's default
                if !(kind == TransitionKind::PageCurl && Some(*o) == kind.default_option()) {
                    t.option = Some(*o);
                }
                all.push(t);
            }
        }
        for t in all {
            let xml = written(&t, None);
            let back = read(&xml).map(|(t, _)| t);
            assert_eq!(back, Some(t), "{xml}");
        }
    }

    #[test]
    fn sounds() {
        let mut t = Transition::new(TransitionKind::Fade);
        t.sound = Some(TransitionSound::Play {
            media: MediaId(3),
            loop_until_next: true,
        });
        let xml = written(&t, Some("rId7"));
        assert!(xml.contains(r#"<p:fade/><p:sndAc><p:stSnd loop="1"><p:snd r:embed="rId7" name="sound.wav"/></p:stSnd></p:sndAc></p:transition>"#), "{xml}");
        let (back, snd) = read(&xml).unwrap();
        assert_eq!(snd, Some((Some("rId7".to_owned()), true)));
        assert_eq!(back.sound, None, "resolved by the caller");
        let mut stop = Transition::new(TransitionKind::None);
        stop.sound = Some(TransitionSound::StopPrevious);
        let xml = written(&stop, None);
        assert!(xml.contains("<p:sndAc><p:endSnd/></p:sndAc>"), "{xml}");
        let (back, snd) = read(&xml).unwrap();
        assert_eq!(
            (back.kind, snd),
            (TransitionKind::None, Some((None, false)))
        );
    }

    #[test]
    fn transitions_from_other_writers() {
        let mut w = Warnings::default();
        // plain p:transition, speed only
        let (t, _) = read_slide_transition(
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
        let (t, _) = read_slide_transition(
            &sld(r#"<mc:AlternateContent><mc:Choice Requires="p14"><p:transition spd="slow" p14:dur="2000"><p:fade thruBlk="true"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade thruBlk="true"/></p:transition></mc:Fallback></mc:AlternateContent>"#),
            &mut w,
        )
        .unwrap();
        assert_eq!((t.kind, t.duration_ms), (TransitionKind::Fade, 2000));
        // p14 effects of PowerPoint
        let (t, _) = read_slide_transition(
            &sld(r#"<mc:AlternateContent><mc:Choice Requires="p14"><p:transition spd="slow" p14:dur="1600"><p14:vortex dir="r"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>"#),
            &mut w,
        )
        .unwrap();
        assert_eq!(
            (t.kind, t.direction, t.duration_ms),
            (TransitionKind::Vortex, Some(Direction::Right), 1600)
        );
        let (t, _) = read_slide_transition(
            &sld(r#"<mc:AlternateContent><mc:Choice Requires="p15"><p:transition spd="slow" p14:dur="2000"><p15:prstTrans prst="pageCurlSingle" invX="1"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>"#),
            &mut w,
        )
        .unwrap();
        assert_eq!(
            (t.kind, t.direction, t.option),
            (
                TransitionKind::PageCurl,
                Some(Direction::Right),
                Some(TransitionOption::Single)
            )
        );
        // unknown choice effect: the fallback's effect, the choice's duration
        let (t, _) = read_slide_transition(
            &sld(r#"<mc:AlternateContent><mc:Choice Requires="p14"><p:transition spd="slow" p14:dur="1600"><p14:conveyor dir="r"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"><p:split orient="vert"/></p:transition></mc:Fallback></mc:AlternateContent>"#),
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
}
