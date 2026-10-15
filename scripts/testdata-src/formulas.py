#!/usr/bin/env python3
"""Helper for scripts/gen-formula-suite.sh (stdlib only, run with `python3 -I`).

  formulas.py build   OUT.xlsx
  formulas.py extract XLSX OUTDIR [--provisional "LibreOffice x.y"]
  formulas.py verify  ROOT

Layout of the generated workbook: sheet `Data` holds the fixture grid (A1:H6) and, in
columns K/L, the suite: K<n> = formula text (string), L<n> = the formula itself. Hosting the
formulas on `Data` makes unqualified references like A1 mean Data!A1. `Other` holds A1/B1.
"""
import os
import re
import sys
import zipfile
from decimal import Decimal
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_FORMULAS = os.path.join(HERE, "formulas.tsv")
SRC_FIXTURE = os.path.join(HERE, "formulas.fixture.tsv")
FAMILIES = ["math", "logical", "info", "text", "lookup", "datetime", "operators", "references", "errors"]
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
NONDET = re.compile(r"^=(TODAY|NOW)\(\)$")
TYPES = {"number", "text", "bool", "error", "number?"}
ERRORS = {"#DIV/0!", "#N/A", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#NULL!", "#SPILL!", "#CALC!"}


def die(msg):
    sys.exit("error: " + msg)


def read_tsv(path):
    """Non-comment, non-blank lines split on tabs (header included)."""
    rows = []
    with open(path, encoding="utf-8") as fh:
        for line in fh.read().split("\n"):
            if line and not line.startswith("#"):
                rows.append(line.split("\t"))
    return rows


def read_cases():
    rows = read_tsv(SRC_FORMULAS)
    if rows[0] != ["family", "formula", "note"]:
        die("formulas.tsv: bad header")
    cases = []
    for r in rows[1:]:
        if len(r) != 3:
            die("formulas.tsv: expected 3 columns: %r" % r)
        if r[0] not in FAMILIES:
            die("formulas.tsv: unknown family %r" % r[0])
        if not r[1].startswith("="):
            die("formulas.tsv: formula must start with '=': %r" % r[1])
        cases.append(tuple(r))
    return cases


def col_letter(n):  # 1-based
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def split_ref(ref):
    m = re.match(r"([A-Z]+)(\d+)$", ref)
    return m.group(1), int(m.group(2))


def col_num(letters):
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n


# ---------------------------------------------------------------- build
# Functions Excel stores with the `_xlfn.` prefix (added after Excel 2007).
FUTURE_NAMES = """CONCAT DAYS IFNA IFS MAXIFS MINIFS SWITCH TEXTJOIN XLOOKUP XMATCH XOR NUMBERVALUE UNICODE UNICHAR
ISOWEEKNUM CEILING.MATH FLOOR.MATH STDEV.S STDEV.P VAR.S VAR.P MODE.SNGL RANK.EQ RANK.AVG PERCENTILE.INC
PERCENTILE.EXC QUARTILE.INC QUARTILE.EXC PERCENTRANK.INC COVARIANCE.P COVARIANCE.S FORECAST.LINEAR
SORTBY UNIQUE SEQUENCE RANDARRAY""".split()
FUTURE = re.compile(r"(?<![A-Za-z0-9_.])(%s)\(" % "|".join(re.escape(n) for n in FUTURE_NAMES))
# Dynamic array functions Excel stores as `_xlfn._xlws.NAME`.
XLWS_NAMES = ["SORT", "FILTER"]
XLWS = re.compile(r"(?<![A-Za-z0-9_.])(%s)\(" % "|".join(XLWS_NAMES))


def file_formula(formula):
    """Formula text as stored in OOXML: no leading '=', newer functions carry the _xlfn. prefix."""
    return XLWS.sub(r"_xlfn._xlws.\1(", FUTURE.sub(r"_xlfn.\1(", formula[1:]))


def build(out):
    fixture = read_tsv(SRC_FIXTURE)
    if fixture[0] != ["sheet", "cell", "type", "value"]:
        die("fixture: bad header")
    cases = read_cases()
    sst, sst_idx = [], {}

    def sidx(text):
        if text not in sst_idx:
            sst_idx[text] = len(sst)
            sst.append(text)
        return sst_idx[text]

    sheets = {"Data": {}, "Other": {}}  # sheet -> {(row, col): xml}
    for sheet, cell, typ, val in fixture[1:]:
        c, r = split_ref(cell)
        pos = (r, col_num(c))
        if typ == "number":
            xml = '<c r="%s"><v>%s</v></c>' % (cell, val)
        elif typ == "date":
            xml = '<c r="%s" s="1"><v>%s</v></c>' % (cell, val)
        elif typ == "bool":
            xml = '<c r="%s" t="b"><v>%d</v></c>' % (cell, 1 if val == "TRUE" else 0)
        elif typ == "text" and val == "":
            # LibreOffice drops empty-string constants on import (the cell would be blank), so the
            # generated workbook uses ="" here. Excel semantics are identical for every suite case.
            xml = '<c r="%s" t="str"><f>""</f></c>' % cell
        elif typ == "text":
            xml = '<c r="%s" t="s"><v>%d</v></c>' % (cell, sidx(val))
        elif typ == "formula":
            xml = '<c r="%s"><f>%s</f></c>' % (cell, escape(val[1:]))
        elif typ == "empty":
            continue
        else:
            die("fixture: unknown type " + typ)
        sheets[sheet][pos] = xml
    for i, (_fam, formula, _note) in enumerate(cases, 1):
        sheets["Data"][(i, 11)] = '<c r="K%d" t="s"><v>%d</v></c>' % (i, sidx(formula))
        sheets["Data"][(i, 12)] = '<c r="L%d"><f>%s</f></c>' % (i, escape(file_formula(formula)))

    def sheet_xml(cells):
        rows = {}
        for (r, c), xml in cells.items():
            rows.setdefault(r, []).append((c, xml))
        body = "".join(
            '<row r="%d">%s</row>' % (r, "".join(x for _, x in sorted(rows[r]))) for r in sorted(rows)
        )
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<worksheet xmlns="%s"><sheetData>%s</sheetData></worksheet>' % (NS["m"], body)
        )

    sst_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<sst xmlns="%s" count="%d" uniqueCount="%d">%s</sst>'
        % (
            NS["m"],
            len(sst),
            len(sst),
            "".join('<si><t xml:space="preserve">%s</t></si>' % escape(s) for s in sst),
        )
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<styleSheet xmlns="%s"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>'
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
        "</styleSheet>" % NS["m"]
    )
    wb = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<workbook xmlns="%s" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets>'
        '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>' % NS["m"]
    )
    rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
    wb_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="%sworksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="%sworksheet" Target="worksheets/sheet2.xml"/>'
        '<Relationship Id="rId3" Type="%sstyles" Target="styles.xml"/>'
        '<Relationship Id="rId4" Type="%ssharedStrings" Target="sharedStrings.xml"/>'
        "</Relationships>" % (rel, rel, rel, rel)
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="%sofficeDocument" Target="xl/workbook.xml"/></Relationships>' % rel
    )
    ct_main = "application/vnd.openxmlformats-officedocument.spreadsheetml."
    ct = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="%ssheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="%sworksheet+xml"/>'
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="%sworksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="%sstyles+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" ContentType="%ssharedStrings+xml"/></Types>'
        % (ct_main, ct_main, ct_main, ct_main, ct_main)
    )
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", ct)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        z.writestr("xl/styles.xml", styles)
        z.writestr("xl/sharedStrings.xml", sst_xml)
        z.writestr("xl/worksheets/sheet1.xml", sheet_xml(sheets["Data"]))
        z.writestr("xl/worksheets/sheet2.xml", sheet_xml(sheets["Other"]))
    print("built %s: %d cases" % (out, len(cases)))


# ---------------------------------------------------------------- extract
def load_data_sheet(path):
    """Return ({ref: (t, v)}, app string) for sheet `Data` of an xlsx."""
    with zipfile.ZipFile(path) as z:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        targets = {r.get("Id"): r.get("Target") for r in rels}
        target = None
        for s in wb.find("m:sheets", NS):
            if s.get("name") == "Data":
                target = targets[s.get(RNS + "id")]
        if target is None:
            die("%s: no sheet named Data" % path)
        target = target.lstrip("/")
        if not target.startswith("xl/"):
            target = "xl/" + target
        strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
                strings.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
        app = ""
        if "docProps/app.xml" in z.namelist():
            a = ET.fromstring(z.read("docProps/app.xml"))
            name = ver = ""
            for el in a:
                tag = el.tag.split("}")[1]
                if tag == "Application":
                    name = el.text or ""
                if tag == "AppVersion":
                    ver = el.text or ""
            app = (name + " " + ver).strip()
        cells = {}
        for c in ET.fromstring(z.read(target)).iter("{%s}c" % NS["m"]):
            t = c.get("t", "n")
            v = c.find("m:v", NS)
            vt = v.text if v is not None and v.text is not None else ""
            if t == "s":
                vt, t = strings[int(vt)], "text"
            elif t == "inlineStr":
                vt, t = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"])), "text"
            elif t == "str":
                t = "text"
            cells[c.get("r")] = (t, vt)
        return cells, app


def fmt_number(text):
    f = float(text)
    if f == 0:
        return "0"
    s = "%.15g" % f
    d = Decimal(s)
    if -20 < d.adjusted() < 21:
        out = format(d, "f")
        if "." in out:
            out = out.rstrip("0").rstrip(".")
        return out
    return s.replace("e+", "e")


def esc_text(s):
    return s.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r")


def classify(formula, cell):
    t, v = cell
    if t == "b":
        return "bool", "TRUE" if v == "1" else "FALSE"
    if t == "e":
        return "error", v
    if t == "text":
        if v in ERRORS:  # defensive: error stored as string
            return "error", v
        return "text", esc_text(v)
    return "number", fmt_number(v)


def extract(xlsx, outdir, provisional):
    cases = read_cases()
    cells, app = load_data_sheet(xlsx)
    if provisional:
        header = "# PROVISIONAL \u2013 expected values computed by %s; replace with Excel values" % provisional
    else:
        header = "# Expected values computed by %s (from %s); not provisional" % (app or "unknown application", os.path.basename(xlsx))
    by_family = {f: [] for f in FAMILIES}
    for i, (fam, formula, note) in enumerate(cases, 1):
        k = cells.get("K%d" % i)
        if k is None or k[1] != formula:
            die("row %d: formula text in K%d does not match source (%r)" % (i, i, formula))
        res = cells.get("L%d" % i)
        if res is None:
            die("row %d: no result cell L%d for %s" % (i, i, formula))
        typ, exp = classify(formula, res)
        if NONDET.match(formula):
            if typ != "number":
                die("row %d: %s did not yield a number" % (i, formula))
            typ, exp = "number?", ""
        by_family[fam].append((formula, typ, exp, note))
    os.makedirs(outdir, exist_ok=True)
    for fam in FAMILIES:
        lines = [header, "# family: %s (%d cases); evaluate in the context of sheet Data, see fixture.tsv" % (fam, len(by_family[fam])),
                 "formula\ttype\texpected\tnote"]
        for formula, typ, exp, note in by_family[fam]:
            if note.startswith("DIFF:"):
                lines.append("# NOTE: " + note[5:].strip())
            lines.append("\t".join([formula, typ, exp, note]))
        with open(os.path.join(outdir, fam + ".tsv"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write("\n".join(lines) + "\n")
    print("extracted %d cases from %s" % (len(cases), xlsx))


# ---------------------------------------------------------------- verify
def verify(root):
    fails = []
    doc = os.path.join(root, "docs", "functions.md")
    names = []
    with open(doc, encoding="utf-8") as fh:
        for line in fh:
            m = re.match(r"\| `([A-Z][A-Z0-9.]*)` \|", line)
            if m:
                names.append(m.group(1))
    if len(set(names)) != len(names):
        fails.append("docs/functions.md lists %d functions, only %d unique" % (len(names), len(set(names))))
    cases = read_cases()
    fdir = os.path.join(root, "testdata", "formulas")
    total = 0
    for fam in FAMILIES:
        path = os.path.join(fdir, fam + ".tsv")
        if not os.path.exists(path):
            fails.append("missing " + path)
            continue
        rows = read_tsv(path)
        if rows[0] != ["formula", "type", "expected", "note"]:
            fails.append("%s: bad header" % fam)
        rows = rows[1:]
        for r in rows:
            if len(r) != 4:
                fails.append("%s: row has %d columns: %r" % (fam, len(r), r[0]))
            elif r[1] not in TYPES:
                fails.append("%s: bad type %r for %s" % (fam, r[1], r[0]))
            elif r[1] == "bool" and r[2] not in ("TRUE", "FALSE"):
                fails.append("%s: bad bool %r for %s" % (fam, r[2], r[0]))
            elif r[1] == "error" and r[2] not in ERRORS:
                fails.append("%s: unexpected error value %r for %s" % (fam, r[2], r[0]))
            elif r[1] == "number" and not re.match(r"^-?\d+(\.\d+)?(e-?\d+)?$", r[2]):
                fails.append("%s: bad number %r for %s" % (fam, r[2], r[0]))
        want = [c[1] for c in cases if c[0] == fam]
        got = [r[0] for r in rows]
        if want != got:
            fails.append("%s: formulas differ from scripts/testdata-src/formulas.tsv (regenerate)" % fam)
        print("%-11s %4d cases" % (fam, len(rows)))
        total += len(rows)
    print("%-11s %4d cases" % ("TOTAL", total))
    if total < 350:
        fails.append("only %d cases, need >= 350" % total)
    alltext = "\n".join(c[1] for c in cases)
    for n in names:
        cnt = len(re.findall(r"(?<![A-Z0-9._])%s\(" % re.escape(n), alltext))
        if cnt < 4:
            fails.append("function %s has only %d cases" % (n, cnt))
    with open(SRC_FIXTURE, "rb") as a, open(os.path.join(fdir, "fixture.tsv"), "rb") as b:
        if a.read() != b.read():
            fails.append("fixture.tsv differs from scripts/testdata-src/formulas.fixture.tsv")
    if not os.path.exists(os.path.join(fdir, "formula-suite.xlsx")):
        fails.append("missing formula-suite.xlsx")
    for f in fails:
        print("FAIL " + f)
    if fails:
        sys.exit(1)
    print("OK   %d functions, %d cases" % (len(names), total))


if __name__ == "__main__":
    a = sys.argv[1:]
    if a[:1] == ["build"] and len(a) == 2:
        build(a[1])
    elif a[:1] == ["extract"] and len(a) in (3, 5):
        extract(a[1], a[2], a[4] if len(a) == 5 else None)
    elif a[:1] == ["verify"] and len(a) == 2:
        verify(a[1])
    else:
        die("usage: formulas.py build OUT | extract XLSX OUTDIR [--provisional TEXT] | verify ROOT")
