//! Shape geometry: `a:prstGeom` with its adjust values (`a:avLst`) and
//! `a:custGeom` (guides evaluated at read time, paths kept in their own
//! coordinate space).

use std::collections::HashMap;

use model_show::{Adjust, GeomPath, PathCmd, Preset};

use crate::xml::{parse_i64, El, XmlOut};
use crate::Warnings;

/// Adjust values of `a:prstGeom` (`a:avLst/a:gd name fmla="val N"`) that
/// are in `allowed`; others are dropped with a warning naming `what`.
pub fn read_adjust(geom: &El, allowed: &[(&str, i64)], what: &str, w: &mut Warnings) -> Adjust {
    let mut out = Adjust::new();
    let Some(list) = geom.child("avLst") else {
        return out;
    };
    for gd in list.elements().filter(|e| e.name == "gd") {
        let name = gd.attr("name").unwrap_or("");
        let value = gd
            .attr("fmla")
            .and_then(|f| f.strip_prefix("val "))
            .and_then(|v| parse_i64(v.trim()));
        match value {
            Some(v) if allowed.iter().any(|(n, _)| *n == name) => {
                out.insert(name.to_owned(), v);
            }
            _ => w.add(format!("adjust value {name} of {what} dropped")),
        }
    }
    out
}

/// The geometry of `p:spPr` (`None`: no geometry element → rectangle).
/// `w`/`h` are the shape's size in EMU (custom geometry guides refer to
/// them).
pub fn read_geometry(sp_pr: Option<&El>, w: f64, h: f64, warn: &mut Warnings) -> (Preset, Adjust) {
    let Some(sp_pr) = sp_pr else {
        return (Preset::Rect, Adjust::new());
    };
    if let Some(g) = sp_pr.child("prstGeom") {
        let prst = g.attr("prst").unwrap_or("rect");
        return match Preset::from_prst(prst) {
            Some(p) => {
                let adj = read_adjust(g, p.adjust_defaults(), prst, warn);
                (p, adj)
            }
            None => {
                warn.add(format!("preset geometry {prst} read as rectangle"));
                (Preset::Rect, Adjust::new())
            }
        };
    }
    if let Some(c) = sp_pr.child("custGeom") {
        let paths = read_cust_geom(c, w, h, warn);
        if paths.is_empty() {
            warn.add("custom geometry without paths read as rectangle");
            return (Preset::Rect, Adjust::new());
        }
        return (Preset::Custom { paths }, Adjust::new());
    }
    (Preset::Rect, Adjust::new())
}

/// Writes `a:prstGeom` (with `a:avLst`) or, for a custom geometry,
/// `a:custGeom`.
pub fn write_geometry(x: &mut XmlOut, preset: &Preset, adjust: &Adjust) {
    let Preset::Custom { paths } = preset else {
        x.start("a:prstGeom", &[("prst", preset.prst())]);
        write_av_lst(x, adjust);
        x.end("a:prstGeom");
        return;
    };
    x.start("a:custGeom", &[]);
    x.empty("a:avLst", &[]);
    x.empty("a:gdLst", &[]);
    x.empty("a:ahLst", &[]);
    x.empty("a:cxnLst", &[]);
    x.empty("a:rect", &[("l", "l"), ("t", "t"), ("r", "r"), ("b", "b")]);
    x.start("a:pathLst", &[]);
    let n = |v: f64| (v.round() as i64).to_string();
    let ang = |deg: f64| ((deg * 60_000.0).round() as i64).to_string();
    for p in paths {
        let (pw, ph) = (n(p.w), n(p.h));
        let mut attrs = vec![("w", pw.as_str()), ("h", ph.as_str())];
        if !p.fill {
            attrs.push(("fill", "none"));
        }
        if !p.stroke {
            attrs.push(("stroke", "0"));
        }
        x.start("a:path", &attrs);
        let pt = |x: &mut XmlOut, px: f64, py: f64| {
            x.empty("a:pt", &[("x", &n(px)), ("y", &n(py))]);
        };
        for c in &p.commands {
            match *c {
                PathCmd::MoveTo { x: px, y: py } => {
                    x.start("a:moveTo", &[]);
                    pt(x, px, py);
                    x.end("a:moveTo");
                }
                PathCmd::LineTo { x: px, y: py } => {
                    x.start("a:lnTo", &[]);
                    pt(x, px, py);
                    x.end("a:lnTo");
                }
                PathCmd::ArcTo {
                    wr,
                    hr,
                    start_deg,
                    sweep_deg,
                } => x.empty(
                    "a:arcTo",
                    &[
                        ("wR", &n(wr)),
                        ("hR", &n(hr)),
                        ("stAng", &ang(start_deg)),
                        ("swAng", &ang(sweep_deg)),
                    ],
                ),
                PathCmd::QuadTo {
                    x1,
                    y1,
                    x: px,
                    y: py,
                } => {
                    x.start("a:quadBezTo", &[]);
                    pt(x, x1, y1);
                    pt(x, px, py);
                    x.end("a:quadBezTo");
                }
                PathCmd::CubicTo {
                    x1,
                    y1,
                    x2,
                    y2,
                    x: px,
                    y: py,
                } => {
                    x.start("a:cubicBezTo", &[]);
                    pt(x, x1, y1);
                    pt(x, x2, y2);
                    pt(x, px, py);
                    x.end("a:cubicBezTo");
                }
                PathCmd::Close => x.empty("a:close", &[]),
            }
        }
        x.end("a:path");
    }
    x.end("a:pathLst");
    x.end("a:custGeom");
}

/// Writes `a:avLst` with one `a:gd` per adjust value.
pub fn write_av_lst(x: &mut XmlOut, adjust: &Adjust) {
    if adjust.is_empty() {
        x.empty("a:avLst", &[]);
        return;
    }
    x.start("a:avLst", &[]);
    for (name, v) in adjust {
        x.empty("a:gd", &[("name", name), ("fmla", &format!("val {v}"))]);
    }
    x.end("a:avLst");
}

// --- custom geometry -----------------------------------------------------------

/// Guide values: the built-ins of a `w` × `h` box plus `a:avLst`/`a:gdLst`.
struct Guides {
    vars: HashMap<String, f64>,
    w: f64,
    h: f64,
}

impl Guides {
    fn new(w: f64, h: f64) -> Self {
        Guides {
            vars: HashMap::new(),
            w,
            h,
        }
    }

    /// A built-in guide (ECMA-376 §20.1.10.56 `ST_ShapeType` guides).
    fn builtin(&self, name: &str) -> Option<f64> {
        let (w, h) = (self.w, self.h);
        let ss = w.min(h);
        Some(match name {
            "w" | "r" => w,
            "h" | "b" => h,
            "l" | "t" => 0.0,
            "hc" => w / 2.0,
            "vc" => h / 2.0,
            "ss" => ss,
            "ls" => w.max(h),
            "cd2" => 10_800_000.0,
            "cd4" => 5_400_000.0,
            "cd8" => 2_700_000.0,
            "3cd4" => 16_200_000.0,
            "3cd8" => 8_100_000.0,
            "5cd8" => 13_500_000.0,
            "7cd8" => 18_900_000.0,
            _ => {
                let (base, n) = [("wd", w), ("hd", h), ("ssd", ss)]
                    .into_iter()
                    .find_map(|(p, base)| name.strip_prefix(p).map(|n| (base, n)))?;
                let n: f64 = n.parse().ok()?;
                base / n
            }
        })
    }

    /// An operand: a number or a guide name (unknown names → 0, warning).
    fn val(&self, s: &str, w: &mut Warnings) -> f64 {
        if let Ok(v) = s.parse::<f64>() {
            return v;
        }
        if let Some(v) = self.vars.get(s) {
            return *v;
        }
        self.builtin(s).unwrap_or_else(|| {
            w.add(format!("custom geometry guide {s} unknown (read as 0)"));
            0.0
        })
    }

    /// Evaluates a guide formula (`*/ w 1 2`, `+- a b c`, `?: …`, `pin`,
    /// `sin`, `at2`, …; angles in 60000ths of a degree).
    fn eval(&self, fmla: &str, w: &mut Warnings) -> f64 {
        let mut it = fmla.split_whitespace();
        let op = it.next().unwrap_or("val");
        let args: Vec<f64> = it.map(|a| self.val(a, w)).collect();
        let a = |i: usize| args.get(i).copied().unwrap_or(0.0);
        let rad = |v: f64| (v / 60_000.0).to_radians();
        let deg = |r: f64| r.to_degrees() * 60_000.0;
        match op {
            "val" => a(0),
            "*/" => {
                if a(2) == 0.0 {
                    0.0
                } else {
                    a(0) * a(1) / a(2)
                }
            }
            "+-" => a(0) + a(1) - a(2),
            "+/" => {
                if a(2) == 0.0 {
                    0.0
                } else {
                    (a(0) + a(1)) / a(2)
                }
            }
            "?:" => {
                if a(0) > 0.0 {
                    a(1)
                } else {
                    a(2)
                }
            }
            "abs" => a(0).abs(),
            "at2" => deg(a(1).atan2(a(0))),
            "cat2" => a(0) * a(2).atan2(a(1)).cos(),
            "sat2" => a(0) * a(2).atan2(a(1)).sin(),
            "cos" => a(0) * rad(a(1)).cos(),
            "sin" => a(0) * rad(a(1)).sin(),
            "tan" => a(0) * rad(a(1)).tan(),
            "max" => a(0).max(a(1)),
            "min" => a(0).min(a(1)),
            "mod" => (a(0) * a(0) + a(1) * a(1) + a(2) * a(2)).sqrt(),
            "pin" => {
                if a(1) < a(0) {
                    a(0)
                } else if a(1) > a(2) {
                    a(2)
                } else {
                    a(1)
                }
            }
            "sqrt" => a(0).max(0.0).sqrt(),
            other => {
                w.add(format!(
                    "custom geometry formula {other} unknown (read as 0)"
                ));
                0.0
            }
        }
    }

    /// Evaluates the `a:gd` children of `list` in order.
    fn define(&mut self, list: Option<&El>, w: &mut Warnings) {
        for gd in list
            .into_iter()
            .flat_map(|l| l.elements())
            .filter(|e| e.name == "gd")
        {
            let v = self.eval(gd.attr("fmla").unwrap_or("val 0"), w);
            if let Some(name) = gd.attr("name") {
                self.vars.insert(name.to_owned(), v);
            }
        }
    }
}

/// The paths of `a:custGeom` in the shape's `w` × `h` box.
fn read_cust_geom(c: &El, w: f64, h: f64, warn: &mut Warnings) -> Vec<GeomPath> {
    let mut g = Guides::new(w, h);
    g.define(c.child("avLst"), warn);
    g.define(c.child("gdLst"), warn);
    let mut out = Vec::new();
    let Some(list) = c.child("pathLst") else {
        return out;
    };
    for path in list.elements().filter(|e| e.name == "path") {
        let num = |a: &str| path.attr(a).and_then(|v| v.parse::<f64>().ok());
        // without a coordinate space the path is in the shape's EMU
        let (pw, ph) = match (num("w"), num("h")) {
            (Some(pw), Some(ph)) if pw > 0.0 || ph > 0.0 => (pw, ph),
            _ => (w, h),
        };
        let pt = |e: &El, g: &Guides, warn: &mut Warnings| {
            (
                g.val(e.attr("x").unwrap_or("0"), warn),
                g.val(e.attr("y").unwrap_or("0"), warn),
            )
        };
        let pts = |e: &El, g: &Guides, warn: &mut Warnings| -> Vec<(f64, f64)> {
            e.elements()
                .filter(|p| p.name == "pt")
                .map(|p| pt(p, g, warn))
                .collect()
        };
        let mut commands = Vec::new();
        for cmd in path.elements() {
            match cmd.name.as_str() {
                "moveTo" | "lnTo" => {
                    if let Some(&(x, y)) = pts(cmd, &g, warn).first() {
                        commands.push(if cmd.name == "moveTo" {
                            PathCmd::MoveTo { x, y }
                        } else {
                            PathCmd::LineTo { x, y }
                        });
                    }
                }
                "arcTo" => {
                    let v = |a: &str, warn: &mut Warnings| g.val(cmd.attr(a).unwrap_or("0"), warn);
                    commands.push(PathCmd::ArcTo {
                        wr: v("wR", warn),
                        hr: v("hR", warn),
                        start_deg: v("stAng", warn) / 60_000.0,
                        sweep_deg: v("swAng", warn) / 60_000.0,
                    });
                }
                "quadBezTo" => {
                    if let [(x1, y1), (x, y)] = pts(cmd, &g, warn)[..] {
                        commands.push(PathCmd::QuadTo { x1, y1, x, y });
                    }
                }
                "cubicBezTo" => {
                    if let [(x1, y1), (x2, y2), (x, y)] = pts(cmd, &g, warn)[..] {
                        commands.push(PathCmd::CubicTo {
                            x1,
                            y1,
                            x2,
                            y2,
                            x,
                            y,
                        });
                    }
                }
                "close" => commands.push(PathCmd::Close),
                other => warn.add(format!("custom geometry command {other} dropped")),
            }
        }
        out.push(GeomPath {
            w: pw,
            h: ph,
            fill: path.attr("fill") != Some("none"),
            stroke: !matches!(path.attr("stroke"), Some("0" | "false")),
            commands,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xml::parse;

    fn el(xml: &str) -> El {
        parse(xml.as_bytes(), "t").unwrap()
    }

    #[test]
    fn preset_with_adjust_values() {
        let mut w = Warnings::default();
        let sp = el(
            r#"<p:spPr><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 5000"/><a:gd name="foo" fmla="val 1"/></a:avLst></a:prstGeom></p:spPr>"#,
        );
        let (p, adj) = read_geometry(Some(&sp), 10.0, 10.0, &mut w);
        assert_eq!(p, Preset::RoundRect);
        assert_eq!(adj, Adjust::from([("adj".to_owned(), 5_000)]));
        assert_eq!(w.into_vec(), ["adjust value foo of roundRect dropped"]);
        let mut x = XmlOut::fragment();
        write_geometry(&mut x, &p, &adj);
        assert_eq!(
            String::from_utf8(x.finish()).unwrap(),
            r#"<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 5000"/></a:avLst></a:prstGeom>"#
        );
        let mut w = Warnings::default();
        let sp = el(r#"<p:spPr><a:prstGeom prst="gear12"/></p:spPr>"#);
        assert_eq!(read_geometry(Some(&sp), 1.0, 1.0, &mut w).0, Preset::Rect);
        assert_eq!(w.into_vec(), ["preset geometry gear12 read as rectangle"]);
        // every non-connector preset of ECMA-376 is supported (P9-S2)
        let mut w = Warnings::default();
        for prst in [
            "gear9",
            "accentBorderCallout3",
            "circularArrow",
            "ellipseRibbon2",
            "star32",
            "verticalScroll",
        ] {
            let sp = el(&format!(r#"<p:spPr><a:prstGeom prst="{prst}"/></p:spPr>"#));
            assert_eq!(read_geometry(Some(&sp), 1.0, 1.0, &mut w).0.prst(), prst);
        }
        assert!(w.into_vec().is_empty());
    }

    #[test]
    fn custom_geometry_with_guides() {
        let mut w = Warnings::default();
        let sp = el(
            r#"<p:spPr><a:custGeom><a:avLst/><a:gdLst><a:gd name="x1" fmla="*/ w 1 4"/><a:gd name="y1" fmla="+- vc 0 hd4"/></a:gdLst><a:pathLst><a:path><a:moveTo><a:pt x="l" y="t"/></a:moveTo><a:lnTo><a:pt x="x1" y="y1"/></a:lnTo><a:arcTo wR="wd2" hR="hd2" stAng="cd2" swAng="-5400000"/><a:cubicBezTo><a:pt x="1" y="2"/><a:pt x="3" y="4"/><a:pt x="r" y="b"/></a:cubicBezTo><a:close/></a:path><a:path w="10" h="20" fill="none" stroke="0"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:quadBezTo><a:pt x="5" y="5"/><a:pt x="10" y="20"/></a:quadBezTo></a:path></a:pathLst></a:custGeom></p:spPr>"#,
        );
        let (p, _) = read_geometry(Some(&sp), 400.0, 200.0, &mut w);
        assert!(w.into_vec().is_empty());
        let Preset::Custom { paths } = &p else {
            panic!("{p:?}")
        };
        assert_eq!((paths[0].w, paths[0].h), (400.0, 200.0));
        assert_eq!(paths[0].commands[1], PathCmd::LineTo { x: 100.0, y: 50.0 });
        assert_eq!(
            paths[0].commands[2],
            PathCmd::ArcTo {
                wr: 200.0,
                hr: 100.0,
                start_deg: 180.0,
                sweep_deg: -90.0
            }
        );
        assert!(!paths[1].fill && !paths[1].stroke);
        // written and read back unchanged
        let mut x = XmlOut::fragment();
        x.start("p:spPr", &[]);
        write_geometry(&mut x, &p, &Adjust::new());
        x.end("p:spPr");
        let xml = String::from_utf8(x.finish()).unwrap();
        let mut w = Warnings::default();
        assert_eq!(read_geometry(Some(&el(&xml)), 400.0, 200.0, &mut w).0, p);
        assert!(w.into_vec().is_empty());
    }

    #[test]
    fn freeform_paths_roundtrip() {
        // what Insert › Shapes › Freeform / Scribble make: the path in the
        // box's own coordinates, open (no fill) with smoothed curves
        let path = |fill| GeomPath {
            w: 1_200.0,
            h: 900.0,
            fill,
            stroke: true,
            commands: vec![
                PathCmd::MoveTo { x: 0.0, y: 900.0 },
                PathCmd::LineTo { x: 400.0, y: 0.0 },
                PathCmd::CubicTo {
                    x1: 500.0,
                    y1: 100.0,
                    x2: 800.0,
                    y2: 300.0,
                    x: 1_200.0,
                    y: 450.0,
                },
            ],
        };
        for fill in [false, true] {
            let mut g = path(fill);
            if fill {
                g.commands.push(PathCmd::Close);
            }
            let p = Preset::Custom { paths: vec![g] };
            let mut x = XmlOut::fragment();
            x.start("p:spPr", &[]);
            write_geometry(&mut x, &p, &Adjust::new());
            x.end("p:spPr");
            let xml = String::from_utf8(x.finish()).unwrap();
            assert!(xml.contains(r#"<a:path w="1200" h="900""#), "{xml}");
            assert_eq!(xml.contains(r#"fill="none""#), !fill);
            assert!(xml.contains("<a:cubicBezTo>"));
            let mut w = Warnings::default();
            assert_eq!(read_geometry(Some(&el(&xml)), 1_200.0, 900.0, &mut w).0, p);
            assert!(w.into_vec().is_empty());
        }
    }

    #[test]
    fn formulas() {
        let g = Guides::new(1_000.0, 500.0);
        let mut w = Warnings::default();
        let e = |f: &str, w: &mut Warnings| g.eval(f, w).round();
        assert_eq!(e("*/ w 3 4", &mut w), 750.0);
        assert_eq!(e("+/ w h 2", &mut w), 750.0);
        assert_eq!(e("?: -1 w h", &mut w), 500.0);
        assert_eq!(e("pin 0 ss 100", &mut w), 100.0);
        assert_eq!(e("sin 100 cd4", &mut w), 100.0);
        assert_eq!(e("cos 100 cd2", &mut w), -100.0);
        assert_eq!(e("at2 0 10", &mut w), 5_400_000.0);
        assert_eq!(e("mod 3 4 0", &mut w), 5.0);
        assert_eq!(e("max wd2 hd10", &mut w), 500.0);
        assert_eq!(e("sqrt 16", &mut w), 4.0);
        assert!(w.into_vec().is_empty());
        let mut w = Warnings::default();
        assert_eq!(g.eval("foo 1", &mut w), 0.0);
        assert_eq!(g.eval("val nope", &mut w), 0.0);
        assert_eq!(w.into_vec().len(), 2);
    }
}
