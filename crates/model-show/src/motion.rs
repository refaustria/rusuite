//! Motion paths (`p:animMotion path`): the path language PowerPoint
//! writes and reads, and the default paths of the motion path presets.
//!
//! A path is a list of commands in **slide fractions** relative to the
//! shape's resting position: `M x y` (move), `L x y` (line), `C x1 y1 x2 y2
//! x y` (cubic Bézier), `Z` (close) and `E` (end, written last by
//! PowerPoint). `x` is a fraction of the slide width, `y` of the slide
//! height: `M 0 0 L 0.25 0 E` moves the shape a quarter of the slide to the
//! right. Lowercase commands (relative coordinates) are read as well and
//! turned into absolute ones.

use crate::anim::{Direction, Effect};

/// One command of a motion path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PathCmd {
    /// Move to.
    M(f64, f64),
    /// Line to.
    L(f64, f64),
    /// Cubic Bézier: two control points, then the end point.
    C(f64, f64, f64, f64, f64, f64),
    /// Close the subpath.
    Z,
}

impl PathCmd {
    /// The command's end point (`None` for `Z`).
    pub fn end(&self) -> Option<(f64, f64)> {
        match *self {
            PathCmd::M(x, y) | PathCmd::L(x, y) | PathCmd::C(_, _, _, _, x, y) => Some((x, y)),
            PathCmd::Z => None,
        }
    }
}

fn is_cmd(c: char) -> bool {
    matches!(c, 'M' | 'm' | 'L' | 'l' | 'C' | 'c' | 'Z' | 'z' | 'E' | 'e')
}

/// Parses a motion path. Numbers may use exponents (`-4.16667E-6`) and be
/// separated by spaces or commas; an implicit repeat of the last command
/// is accepted (`L 0 0 1 1`). `E` ends the path (anything after it is
/// ignored). Fails on unknown commands, a missing first `M`, or a
/// command with too few numbers.
pub fn parse_path(s: &str) -> Result<Vec<PathCmd>, String> {
    // tokenize: commands and numbers
    let mut toks: Vec<Result<char, f64>> = Vec::new();
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() || c == ',' {
            i += 1;
        } else if is_cmd(c) && !(c == 'e' || c == 'E')
            || (c == 'E' || c == 'e') && !after_mantissa(&chars, i)
        {
            toks.push(Ok(c));
            i += 1;
        } else if c == '-' || c == '+' || c == '.' || c.is_ascii_digit() {
            let start = i;
            i += 1;
            while i < chars.len() {
                let d = chars[i];
                let exp_sign = (d == '-' || d == '+') && matches!(chars[i - 1], 'e' | 'E');
                let exp = (d == 'e' || d == 'E')
                    && chars
                        .get(i + 1)
                        .is_some_and(|n| n.is_ascii_digit() || *n == '-' || *n == '+');
                if d.is_ascii_digit() || d == '.' || exp || exp_sign {
                    i += 1;
                } else {
                    break;
                }
            }
            let text: String = chars[start..i].iter().collect();
            let v: f64 = text
                .parse()
                .map_err(|_| format!("bad number {text:?} in motion path"))?;
            if !v.is_finite() {
                return Err(format!("bad number {text:?} in motion path"));
            }
            toks.push(Err(v));
        } else {
            return Err(format!("unexpected {c:?} in motion path"));
        }
    }
    let mut out = Vec::new();
    let mut cur = (0.0, 0.0);
    let mut start = (0.0, 0.0);
    let mut k = 0;
    let mut last: Option<char> = None;
    while k < toks.len() {
        let cmd = match toks[k] {
            Ok(c) => {
                k += 1;
                c
            }
            Err(_) => match last {
                Some(c) if !matches!(c, 'Z' | 'z') => {
                    // implicit repeat; after M it is L
                    match c {
                        'M' => 'L',
                        'm' => 'l',
                        c => c,
                    }
                }
                _ => return Err("motion path must start with a command".into()),
            },
        };
        if matches!(cmd, 'E' | 'e') {
            break;
        }
        let n = match cmd {
            'M' | 'm' | 'L' | 'l' => 2,
            'C' | 'c' => 6,
            _ => 0,
        };
        let mut v = [0.0f64; 6];
        for slot in v.iter_mut().take(n) {
            match toks.get(k) {
                Some(Err(x)) => *slot = *x,
                _ => return Err(format!("motion path command {cmd} needs {n} numbers")),
            }
            k += 1;
        }
        if out.is_empty() && !matches!(cmd, 'M' | 'm') {
            return Err("motion path must start with M".into());
        }
        let rel = cmd.is_ascii_lowercase();
        let (ox, oy) = if rel { cur } else { (0.0, 0.0) };
        let c = match cmd.to_ascii_uppercase() {
            'M' => {
                cur = (ox + v[0], oy + v[1]);
                start = cur;
                PathCmd::M(cur.0, cur.1)
            }
            'L' => {
                cur = (ox + v[0], oy + v[1]);
                PathCmd::L(cur.0, cur.1)
            }
            'C' => {
                let c = PathCmd::C(
                    ox + v[0],
                    oy + v[1],
                    ox + v[2],
                    oy + v[3],
                    ox + v[4],
                    oy + v[5],
                );
                cur = (ox + v[4], oy + v[5]);
                c
            }
            _ => {
                cur = start;
                PathCmd::Z
            }
        };
        out.push(c);
        last = Some(cmd);
    }
    if out.is_empty() {
        return Err("empty motion path".into());
    }
    Ok(out)
}

/// Whether `E` at `i` is an exponent (follows a digit and precedes a
/// digit or sign) rather than the end command.
fn after_mantissa(chars: &[char], i: usize) -> bool {
    i > 0
        && (chars[i - 1].is_ascii_digit() || chars[i - 1] == '.')
        && chars
            .get(i + 1)
            .is_some_and(|n| n.is_ascii_digit() || *n == '-' || *n == '+')
}

/// A number as PowerPoint writes it in paths (up to 5 decimals, no
/// trailing zeros, `0` for tiny values).
fn num(v: f64) -> String {
    let r = (v * 100_000.0).round() / 100_000.0;
    if r == 0.0 {
        return "0".into();
    }
    let s = format!("{r:.5}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    s.to_owned()
}

/// Writes commands as a path string ending in ` E` (PowerPoint's form:
/// `M 0 0 L 0.25 0 E`).
pub fn format_path(cmds: &[PathCmd]) -> String {
    let mut out = String::new();
    for c in cmds {
        if !out.is_empty() {
            out.push(' ');
        }
        match *c {
            PathCmd::M(x, y) => out.push_str(&format!("M {} {}", num(x), num(y))),
            PathCmd::L(x, y) => out.push_str(&format!("L {} {}", num(x), num(y))),
            PathCmd::C(a, b, c2, d, x, y) => out.push_str(&format!(
                "C {} {} {} {} {} {}",
                num(a),
                num(b),
                num(c2),
                num(d),
                num(x),
                num(y)
            )),
            PathCmd::Z => out.push('Z'),
        }
    }
    out.push_str(" E");
    out
}

/// The end point of a path (where the shape rests afterwards; the start
/// point for a closed path).
pub fn path_end(cmds: &[PathCmd]) -> (f64, f64) {
    let mut start = (0.0, 0.0);
    let mut cur = (0.0, 0.0);
    for c in cmds {
        match c {
            PathCmd::M(x, y) => {
                start = (*x, *y);
                cur = start;
            }
            PathCmd::Z => cur = start,
            c => cur = c.end().unwrap_or(cur),
        }
    }
    cur
}

/// The default path of a motion path preset in a direction (what
/// PowerPoint inserts from the gallery; Lines move a quarter of the slide,
/// Arcs and Turns about a quarter in both axes). `None` for effects that
/// are no motion path presets (and for Custom Path, which is drawn).
pub fn default_path(effect: Effect, direction: Option<Direction>) -> Option<String> {
    use Direction::*;
    let d = direction.or(effect.default_direction());
    Some(
        match (effect, d) {
            (Effect::PathLines, Some(Left)) => "M 0 0 L -0.25 0 E",
            (Effect::PathLines, Some(Right)) => "M 0 0 L 0.25 0 E",
            (Effect::PathLines, Some(Up)) => "M 0 0 L 0 -0.25 E",
            (Effect::PathLines, _) => "M 0 0 L 0 0.25 E",
            (Effect::PathArcs, Some(Left)) => "M 0 0 C -0.069 0 -0.125 0.056 -0.125 0.125 C -0.125 0.194 -0.069 0.25 0 0.25 E",
            (Effect::PathArcs, Some(Right)) => "M 0 0 C 0.069 0 0.125 0.056 0.125 0.125 C 0.125 0.194 0.069 0.25 0 0.25 E",
            (Effect::PathArcs, Some(Up)) => "M 0 0 C 0 -0.069 0.056 -0.125 0.125 -0.125 C 0.194 -0.125 0.25 -0.069 0.25 0 E",
            (Effect::PathArcs, _) => "M 0 0 C 0 0.069 0.056 0.125 0.125 0.125 C 0.194 0.125 0.25 0.069 0.25 0 E",
            (Effect::PathTurns, Some(Up)) => "M 0 0 L 0.125 0 C 0.194 0 0.25 -0.056 0.25 -0.125 L 0.25 -0.25 E",
            (Effect::PathTurns, Some(RightDown)) => "M 0 0 L 0 0.125 C 0 0.194 0.056 0.25 0.125 0.25 L 0.25 0.25 E",
            (Effect::PathTurns, Some(RightUp)) => "M 0 0 L 0 -0.125 C 0 -0.194 0.056 -0.25 0.125 -0.25 L 0.25 -0.25 E",
            (Effect::PathTurns, _) => "M 0 0 L 0.125 0 C 0.194 0 0.25 0.056 0.25 0.125 L 0.25 0.25 E",
            (Effect::PathShapes, _) => "M 0 0 C 0 0.069 0.056 0.125 0.125 0.125 C 0.194 0.125 0.25 0.069 0.25 0 C 0.25 -0.069 0.194 -0.125 0.125 -0.125 C 0.056 -0.125 0 -0.069 0 0 Z E",
            (Effect::PathLoops, _) => "M 0 0 C 0.05 0.1 0.15 0.1 0.15 0 C 0.15 -0.1 0.05 -0.1 0.08 0 C 0.11 0.1 0.21 0.1 0.25 0 E",
            _ => return None,
        }
        .to_owned(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_powerpoint_paths() {
        let p = parse_path("M -4.16667E-6 -4.07407E-6 L 0.25 0.33 E").unwrap();
        assert_eq!(p.len(), 2);
        assert!(matches!(p[0], PathCmd::M(x, y) if x.abs() < 1e-5 && y.abs() < 1e-5));
        assert_eq!(p[1], PathCmd::L(0.25, 0.33));
        let p = parse_path("M 0 0 C 0.1 0.2 0.3 0.4 0.5 0.6 Z E").unwrap();
        assert_eq!(p[1], PathCmd::C(0.1, 0.2, 0.3, 0.4, 0.5, 0.6));
        assert_eq!(p[2], PathCmd::Z);
        assert_eq!(path_end(&p), (0.0, 0.0));
        // relative commands, commas, implicit repeats
        let p = parse_path("m 0.1,0.1 l 0.1 0 0 0.1").unwrap();
        assert_eq!(
            p,
            [
                PathCmd::M(0.1, 0.1),
                PathCmd::L(0.2, 0.1),
                PathCmd::L(0.2, 0.2)
            ]
        );
        assert_eq!(path_end(&p), (0.2, 0.2));
        for bad in ["", "L 0 0", "M 0", "M 0 0 Q 1 1", "M a b"] {
            assert!(parse_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn formats_and_roundtrips() {
        let p = parse_path("M 0 0 L 0.123456789 -0.5 C 1 2 3 4 5 6 E").unwrap();
        let s = format_path(&p);
        assert_eq!(s, "M 0 0 L 0.12346 -0.5 C 1 2 3 4 5 6 E");
        assert_eq!(format_path(&parse_path(&s).unwrap()), s);
        for e in Effect::ALL {
            let mut dirs: Vec<Option<Direction>> = vec![None];
            dirs.extend(e.directions().iter().map(|d| Some(*d)));
            for d in dirs {
                if let Some(p) = default_path(e, d) {
                    let cmds = parse_path(&p).unwrap();
                    assert_eq!(format_path(&cmds), p, "{e:?} {d:?}");
                }
            }
        }
        assert_eq!(default_path(Effect::Fade, None), None);
        assert_eq!(default_path(Effect::PathCustom, None), None);
    }
}
