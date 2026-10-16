#!/usr/bin/env python3
"""Converts ECMA-376 presetShapeDefinitions.xml into the compact line format
read by crates/model-show/src/presets/mod.rs (see its module docs).

Usage: python3 -I gen_presets.py presetShapeDefinitions.xml names.txt > defs.txt
`names.txt` lists the DrawingML preset names to keep, one per line.
"""
import sys
import xml.etree.ElementTree as ET

NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
FILL = {"norm": "n", "none": "0", "darken": "d", "darkenLess": "dl", "lighten": "l", "lightenLess": "ll"}


def loc(tag):
    return tag.split("}")[-1]


def a(e, name, default="-"):
    v = e.get(name)
    return default if v is None else v


def main():
    root = ET.parse(sys.argv[1]).getroot()
    keep = [n.strip() for n in open(sys.argv[2], encoding="utf-8") if n.strip() and not n.startswith("#")]
    defs = {c.tag: c for c in root}
    out = []
    for name in keep:
        d = defs[name]
        out.append("@" + name)
        for part in d:
            kind = loc(part.tag)
            if kind == "avLst":
                for gd in part:
                    f = gd.get("fmla").split()
                    assert f[0] == "val", (name, f)
                    out.append("v %s %s" % (gd.get("name"), f[1]))
            elif kind == "gdLst":
                for gd in part:
                    out.append("g %s %s" % (gd.get("name"), " ".join(gd.get("fmla").split())))
            elif kind == "ahLst":
                for ah in part:
                    pos = ah.find(NS + "pos")
                    if loc(ah.tag) == "ahXY":
                        out.append("h %s %s %s %s %s %s %s %s" % (
                            a(ah, "gdRefX"), a(ah, "minX"), a(ah, "maxX"),
                            a(ah, "gdRefY"), a(ah, "minY"), a(ah, "maxY"), pos.get("x"), pos.get("y")))
                    else:
                        out.append("p %s %s %s %s %s %s %s %s" % (
                            a(ah, "gdRefR"), a(ah, "minR"), a(ah, "maxR"),
                            a(ah, "gdRefAng"), a(ah, "minAng"), a(ah, "maxAng"), pos.get("x"), pos.get("y")))
            elif kind == "cxnLst":
                for c in part:
                    pos = c.find(NS + "pos")
                    out.append("c %s %s %s" % (c.get("ang"), pos.get("x"), pos.get("y")))
            elif kind == "rect":
                out.append("r %s %s %s %s" % (part.get("l"), part.get("t"), part.get("r"), part.get("b")))
            elif kind == "pathLst":
                for p in part:
                    out.append("P %s %s %s %s" % (
                        p.get("w", "0"), p.get("h", "0"), FILL[p.get("fill", "norm")],
                        "0" if p.get("stroke") in ("0", "false") else "1"))
                    for cmd in p:
                        ck = loc(cmd.tag)
                        pts = [(pt.get("x"), pt.get("y")) for pt in cmd.findall(NS + "pt")]
                        flat = " ".join("%s %s" % xy for xy in pts)
                        if ck == "moveTo":
                            out.append("M " + flat)
                        elif ck == "lnTo":
                            out.append("L " + flat)
                        elif ck == "arcTo":
                            out.append("A %s %s %s %s" % (cmd.get("wR"), cmd.get("hR"), cmd.get("stAng"), cmd.get("swAng")))
                        elif ck == "quadBezTo":
                            out.append("Q " + flat)
                        elif ck == "cubicBezTo":
                            out.append("C " + flat)
                        elif ck == "close":
                            out.append("Z")
                        else:
                            raise SystemExit("unknown path command %s in %s" % (ck, name))
            else:
                raise SystemExit("unknown part %s in %s" % (kind, name))
    sys.stdout.write("\n".join(out) + "\n")


main()
