"""Generator for the PROVISIONAL docx reference suite (67 documents: 66 .docx, one .dotx template).

Emits one flat ODT (.fodt) per topic plus manifest.json. Conversion to .docx is done by
scripts/gen-docx-suite.sh with headless LibreOffice. Python stdlib only; run with `python3 -I`.

  gen.py emit OUTDIR PNGDIR     write OUTDIR/*.fodt and OUTDIR/manifest.json
  gen.py patch DOCXDIR          add what LibreOffice cannot export to the converted files (style flags)
  gen.py check MANIFEST DOCXDIR structural checks of the converted .docx files against the manifest
"""
import base64
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

NS = (
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
    'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
    'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
    'xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" '
    'xmlns:xlink="http://www.w3.org/1999/xlink" '
    'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" '
    'xmlns:dc="http://purl.org/dc/elements/1.1/" '
    'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" '
    'office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text"'
)


class X(str):
    """Raw (already escaped) XML fragment."""


def esc(v):
    return v if isinstance(v, X) else escape(v)


def seq(content):
    if isinstance(content, (list, tuple)):
        return "".join(esc(c) for c in content)
    return esc(content)


TAB = X("<text:tab/>")
LB = X("<text:line-break/>")

HEADING_SIZES = {1: 20, 2: 16, 3: 14, 4: 12, 5: 11, 6: 10}
LIST_KINDS = {
    "bullet": None,
    "decimal": "1",
    "lower-alpha": "a",
    "lower-roman": "i",
}
BULLETS = ["•", "◦", "▪", "•", "◦"]
HL = {"yellow": "#ffff00", "green": "#00ff00", "cyan": "#00ffff", "magenta": "#ff00ff"}


class Doc:
    def __init__(self, n, slug, topic):
        self.n, self.slug, self.topic = n, slug, topic
        self.styles = {}  # key -> xml
        self.names = {}
        self.feats = []
        self.body = []
        self.list_styles = {}
        self.page_w, self.page_h, self.orient = 21.0, 29.7, "portrait"
        self.margins = (2.54, 2.54, 2.54, 2.54)  # top right bottom left
        self.page_name = "a4"
        self.page_custom = False
        self.imgs = 0
        self.extra_styles = ""  # appended to office:styles
        self.extra_auto = ""  # appended to office:automatic-styles
        self.master_xml = None  # replaces the Standard master page
        self.meta_xml = ""  # office:meta content (document properties)
        self.text_decls = ""  # first children of office:text (sequence declarations)
        self.ext = "docx"  # "dotx": converted as a Word template

    @property
    def file(self):
        return f"provisional-{self.n:02d}-{self.slug}.{self.ext}"

    def feat(self, f):
        if f not in self.feats:
            self.feats.append(f)

    # ---- style registry ----
    def style(self, family, xml_props, parent=None):
        key = (family, xml_props, parent)
        if key not in self.names:
            prefix = {"text": "T", "paragraph": "P", "table-cell": "C", "table": "Tbl"}[family]
            name = f"{prefix}{len(self.names) + 1}"
            self.names[key] = name
            par = f' style:parent-style-name="{parent}"' if parent else ""
            self.styles[name] = (
                f'<style:style style:name="{name}" style:family="{family}"{par}>{xml_props}</style:style>'
            )
        return self.names[key]

    # ---- inline ----
    def run(self, text, b=False, i=False, u=False, s=False, sup=False, sub=False,
            font=None, size=None, color=None, hl=None):
        a = []
        if b:
            a.append('fo:font-weight="bold"'); self.feat("run:bold")
        if i:
            a.append('fo:font-style="italic"'); self.feat("run:italic")
        if u:
            a.append('style:text-underline-style="solid" style:text-underline-width="auto" '
                     'style:text-underline-color="font-color"'); self.feat("run:underline")
        if s:
            a.append('style:text-line-through-style="solid"'); self.feat("run:strike")
        if sup:
            a.append('style:text-position="super 58%"'); self.feat("run:superscript")
        if sub:
            a.append('style:text-position="sub 58%"'); self.feat("run:subscript")
        if font:
            a.append(f'fo:font-family="{font}" style:font-family-generic="roman"')
            self.feat(f"run:font={font}")
        if size:
            a.append(f'fo:font-size="{size}pt"'); self.feat(f"run:size={size}")
        if color:
            a.append(f'fo:color="#{color}"'); self.feat(f"run:color={color.upper()}")
        if hl:
            a.append(f'fo:background-color="{HL[hl]}"'); self.feat(f"run:highlight={hl}")
        name = self.style("text", f'<style:text-properties {" ".join(a)}/>')
        return X(f'<text:span text:style-name="{name}">{esc(text)}</text:span>')

    def image(self, k, w=2.0, h=2.0, alt=None):
        self.imgs += 1
        alt_xml = ""
        if alt:
            alt_xml = f"<svg:title>{escape(alt)}</svg:title><svg:desc>{escape(alt)}</svg:desc>"
        data = base64.b64encode(IMAGES[k]).decode()
        return X(
            f'<draw:frame draw:style-name="fr1" draw:name="Image{self.imgs}" text:anchor-type="as-char" '
            f'svg:width="{w}cm" svg:height="{h}cm"><draw:image><office:binary-data>{data}'
            f"</office:binary-data></draw:image>{alt_xml}</draw:frame>"
        )

    # ---- blocks ----
    def pprops(self, align=None, ml=None, mr=None, indent=None, before=None, after=None, lh=None,
               brk=None, rtl=False):
        a = []
        if align:
            a.append(f'fo:text-align="{ {"left": "start", "right": "end", "center": "center", "justify": "justify"}[align] }"')
            self.feat(f"para:align={align}")
        if ml is not None:
            a.append(f'fo:margin-left="{ml}cm"'); self.feat(f"para:indent-left={ml}cm")
        if mr is not None:
            a.append(f'fo:margin-right="{mr}cm"'); self.feat(f"para:indent-right={mr}cm")
        if indent is not None:
            a.append(f'fo:text-indent="{indent}cm"')
            self.feat(f"para:indent-first={indent}cm" if indent > 0 else f"para:indent-hanging={-indent}cm")
        if before is not None:
            a.append(f'fo:margin-top="{before}pt"'); self.feat(f"para:space-before={before}pt")
        if after is not None:
            a.append(f'fo:margin-bottom="{after}pt"'); self.feat(f"para:space-after={after}pt")
        if lh is not None:
            a.append(f'fo:line-height="{lh}"')
            if isinstance(lh, str) and lh.endswith("%"):
                v = {"100%": "single", "150%": "1.5", "200%": "double"}.get(lh, lh)
            else:
                v = "exact"
            self.feat(f"para:line-spacing={v}")
        if brk:
            a.append('fo:break-before="page"'); self.feat("break:page")
        if rtl:
            a.append('style:writing-mode="rl-tb"'); self.feat("text:rtl")
        return " ".join(a)

    def p_xml(self, content, parent="Standard", **kw):
        pp = self.pprops(**kw)
        if pp:
            name = self.style("paragraph", f"<style:paragraph-properties {pp}/>", parent)
        else:
            name = parent
        return X(f'<text:p text:style-name="{name}">{seq(content)}</text:p>')

    def p(self, content="", parent="Standard", **kw):
        x = self.p_xml(content, parent, **kw)
        self.body.append(x)
        return x

    def empty(self):
        self.feat("para:empty")
        return self.p("")

    def title(self, text):
        self.feat("title")
        self.body.append(X(f'<text:p text:style-name="Title">{esc(text)}</text:p>'))

    def h(self, level, content, **kw):
        self.feat(f"heading:{level}")
        x = self.h_xml(level, content, **kw)
        self.body.append(x)
        return x

    def h_xml(self, level, content, **kw):
        pp = self.pprops(**kw)
        sname = f"Heading_20_{level}"
        if pp:
            sname = self.style("paragraph", f"<style:paragraph-properties {pp}/>", sname)
        return X(f'<text:h text:style-name="{sname}" text:outline-level="{level}">{seq(content)}</text:h>')

    def lst_xml(self, items, kind="bullet", restart=False):
        """items: [(level, content)], level starting at 1."""
        sname = self.list_style(kind)
        maxl = max(l for l, _ in items)
        if kind == "bullet":
            self.feat(f"list:bullet:levels={maxl}")
        else:
            self.feat(f"list:number:levels={maxl}:format={kind}")

        def build(idx, level, first_of_list):
            out = []
            while idx < len(items) and items[idx][0] >= level:
                lv, content = items[idx]
                if lv > level:
                    # nested list belongs to previous item: handled below
                    raise ValueError("level jump")
                idx += 1
                inner = ""
                if idx < len(items) and items[idx][0] > level:
                    sub, idx = build(idx, level + 1, False)
                    inner = sub
                attr = ' text:start-value="1"' if restart and first_of_list and not out and level == 1 else ""
                out.append(f'<text:list-item{attr}><text:p text:style-name="Standard">{seq(content)}</text:p>{inner}</text:list-item>')
            return f"<text:list>{''.join(out)}</text:list>", idx

        xml, _ = build(0, 1, True)
        return X(xml.replace("<text:list>", f'<text:list text:style-name="{sname}">', 1))

    def lst(self, items, kind="bullet", restart=False):
        if restart:
            self.feat("list:restart")
        x = self.lst_xml(items, kind, restart)
        self.body.append(x)
        return x

    def list_style(self, kind):
        if kind in self.list_styles:
            return self.list_styles[kind]
        name = "L" + str(len(self.list_styles) + 1)
        lv = []
        for i in range(1, 6):
            pos = f'<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="{0.9 * i + 0.1:.1f}cm" fo:text-indent="-0.6cm" fo:margin-left="{0.9 * i + 0.1:.1f}cm"/></style:list-level-properties>'
            if kind == "bullet":
                lv.append(f'<text:list-level-style-bullet text:level="{i}" text:bullet-char="{BULLETS[i - 1]}">{pos}</text:list-level-style-bullet>')
            else:
                lv.append(f'<text:list-level-style-number text:level="{i}" style:num-suffix="." style:num-format="{LIST_KINDS[kind]}">{pos}</text:list-level-style-number>')
        self.styles[name] = f'<text:list-style style:name="{name}">{"".join(lv)}</text:list-style>'
        self.list_styles[kind] = name
        return name

    def table_xml(self, rows, widths=None, header=False, shade=None, border="0.5pt solid #000000",
                  border_by_cell=None):
        nr, nc = len(rows), len(rows[0])
        total = 16.0
        if widths is None:
            widths = [total / nc] * nc
            ws = False
        else:
            ws = True
        tname = self.style("table", f'<style:table-properties style:width="{sum(widths):.2f}cm" table:align="left"/>')
        cols = []
        for k, w in enumerate(widths):
            cn = self.style_col(w)
            cols.append(f'<table:table-column table:style-name="{cn}"/>')
        out = [f'<table:table table:name="Table{len(self.names)}" table:style-name="{tname}">', "".join(cols)]
        for r, row in enumerate(rows):
            cells = []
            for c, cell in enumerate(row):
                bd = border_by_cell(r, c) if border_by_cell else border
                bg = ""
                if shade and shade(r, c):
                    bg = f' fo:background-color="#{shade(r, c)}"'
                cn = self.style("table-cell", f'<style:table-cell-properties fo:padding="0.1cm" fo:border="{bd}"{bg}/>')
                if isinstance(cell, (list, tuple)):
                    inner = "".join(esc(x) if isinstance(x, X) else f'<text:p text:style-name="Standard">{escape(x)}</text:p>' for x in cell)
                elif isinstance(cell, X):
                    inner = cell
                else:
                    t = esc(cell)
                    if header and r == 0:
                        t = self.run(cell, b=True)
                    inner = f'<text:p text:style-name="Standard">{t}</text:p>'
                cells.append(f'<table:table-cell table:style-name="{cn}" office:value-type="string">{inner}</table:table-cell>')
            row_xml = f'<table:table-row>{"".join(cells)}</table:table-row>'
            if header and r == 0:
                row_xml = f"<table:table-header-rows>{row_xml}</table:table-header-rows>"
            out.append(row_xml)
        out.append("</table:table>")
        self.feat(f"table:rows={nr}:cols={nc}" + (":header" if header else ""))
        if ws:
            self.feat("table:col-widths=" + ",".join(f"{w:g}cm" for w in widths))
        return X("".join(out))

    def style_col(self, w):
        key = ("col", w)
        if key not in self.names:
            name = f"Col{len([k for k in self.names if k[0] == 'col']) + 1}"
            self.names[key] = name
            self.styles[name] = f'<style:style style:name="{name}" style:family="table-column"><style:table-column-properties style:column-width="{w:.2f}cm"/></style:style>'
        return self.names[key]

    def table(self, rows, **kw):
        x = self.table_xml(rows, **kw)
        self.body.append(x)
        return x

    def page(self, name, w, h, orient="portrait", margins=None):
        self.page_name, self.page_w, self.page_h, self.orient = name, w, h, orient
        if margins:
            self.margins, self.page_custom = margins, True

    # ---- output ----
    def finalize(self):
        body = "\n".join(self.body)
        # Note bodies end up in footnotes.xml / endnotes.xml, not in the body.
        # Comment texts end up in comments.xml.
        counted = re.sub(r"<text:note-body>.*?</text:note-body>", "", body)
        counted = re.sub(r"<office:annotation[ >].*?</office:annotation>", "", counted)
        # Text of shapes and text boxes lives in the drawing, not in the body.
        counted = re.sub(r"<draw:text-box[ >].*?</draw:text-box>", "", counted)
        counted = re.sub(r"<draw:custom-shape .*?</draw:custom-shape>", "", counted)
        paragraphs = len(re.findall(r"<text:(?:p|h)[ >]", counted))
        if self.imgs:
            self.feat(f"image:count={self.imgs}")
        if "<svg:title>" in body:
            self.feat("image:alt")
        if "<text:tab/>" in body:
            self.feat("tab")
        if "<text:line-break/>" in body:
            self.feat("break:line")
        self.feat(f"page:{self.page_name}")
        if self.orient == "landscape":
            self.feat("page:landscape")
        if self.page_custom:
            self.feat("page:margins=" + ",".join(f"{m:g}" for m in self.margins) + "cm")
        t, r, b, l = self.margins
        hs = "".join(
            f'<style:style style:name="Heading_20_{k}" style:display-name="Heading {k}" style:family="paragraph" '
            f'style:parent-style-name="Heading" style:next-style-name="Standard" style:default-outline-level="{k}" style:class="text">'
            f'<style:text-properties fo:font-size="{s}pt" fo:font-weight="bold"/>'
            f'<style:paragraph-properties fo:margin-top="12pt" fo:margin-bottom="6pt"/></style:style>'
            for k, s in HEADING_SIZES.items()
        )
        styles = (
            '<office:styles>'
            '<style:default-style style:family="paragraph"><style:text-properties fo:font-size="11pt" fo:font-family="Liberation Sans"/></style:default-style>'
            '<style:style style:name="Standard" style:family="paragraph" style:class="text"><style:paragraph-properties fo:margin-bottom="6pt"/></style:style>'
            '<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="text"><style:text-properties fo:font-weight="bold"/></style:style>'
            '<style:style style:name="Title" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Standard" style:class="chapter"><style:paragraph-properties fo:text-align="center" fo:margin-bottom="12pt"/><style:text-properties fo:font-size="26pt" fo:font-weight="bold"/></style:style>'
            f"{hs}{self.extra_styles}</office:styles>"
        )
        auto = (
            "<office:automatic-styles>"
            f'<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="{self.page_w}cm" fo:page-height="{self.page_h}cm" '
            f'style:print-orientation="{self.orient}" fo:margin-top="{t}cm" fo:margin-right="{r}cm" fo:margin-bottom="{b}cm" fo:margin-left="{l}cm"/></style:page-layout>'
            '<style:style style:name="fr1" style:family="graphic"><style:graphic-properties style:wrap="none" text:anchor-type="as-char" style:vertical-pos="top" style:vertical-rel="baseline"/></style:style>'
            + "".join(self.styles.values())
            + self.extra_auto
            + "</office:automatic-styles>"
        )
        master = self.master_xml or '<style:master-page style:name="Standard" style:page-layout-name="pm1"/>'
        master = f"<office:master-styles>{master}</office:master-styles>"
        meta = f"<office:meta>{self.meta_xml}</office:meta>\n" if self.meta_xml else ""
        xml = (
            f'<?xml version="1.0" encoding="UTF-8"?>\n<office:document {NS}>\n{meta}{styles}\n{auto}\n{master}\n'
            f"<office:body><office:text>{self.text_decls}\n{body}\n</office:text></office:body></office:document>\n"
        )
        return xml, paragraphs


IMAGES = {}
TOPICS = []


def topic(n, slug, desc):
    def deco(fn):
        TOPICS.append((n, slug, desc, fn))
        return fn
    return deco


SENT = [
    "The quick brown fox jumps over the lazy dog.",
    "Reference documents should be small, boring and precise.",
    "Every supported feature appears in at least one file.",
    "Roundtrip means nothing is lost between open and save.",
    "Short sentences keep the generated files tiny.",
]


def txt(k=2, off=0):
    return " ".join(SENT[(off + j) % len(SENT)] for j in range(k))


# ---------------- 1-7 headings ----------------
def _heading(n, lvl):
    @topic(n, f"heading-{lvl}", f"Heading {lvl} with body text")
    def f(d):
        d.h(lvl, f"Heading level {lvl}")
        d.p(txt(3, lvl))
        d.h(lvl, f"Second heading level {lvl}")
        d.p(txt(2, lvl + 1))
    return f


for _k in range(1, 7):
    _heading(_k, _k)


@topic(7, "title-headings", "Title with Heading 1-3 mixed")
def _(d):
    d.title("Document Title")
    d.h(1, "First chapter"); d.p(txt(2))
    d.h(2, "A section"); d.p(txt(2, 1))
    d.h(3, "A subsection"); d.p(txt(2, 2))
    d.h(2, "Another section"); d.p(txt(1, 3))
    d.h(1, "Second chapter"); d.p(txt(2, 4))
    d.h(3, "Deep subsection without H2"); d.p(txt(1))


# ---------------- 8-17 character and paragraph formatting ----------------
@topic(8, "bold-italic-underline-strike", "Bold, italic, underline, strike runs")
def _(d):
    d.p(["Plain, ", d.run("bold", b=True), ", ", d.run("italic", i=True), ", ", d.run("underline", u=True), ", ", d.run("strikethrough", s=True), "."])
    d.p([d.run("Bold italic", b=True, i=True), " and ", d.run("underline strike", u=True, s=True), " and ", d.run("all four", b=True, i=True, u=True, s=True), "."])
    d.p(["A ", d.run("bold word", b=True), " inside a sentence, followed by plain text again."])


@topic(9, "superscript-subscript", "Superscript and subscript")
def _(d):
    d.p(["E = mc", d.run("2", sup=True), " and x", d.run("10", sup=True), " + y", d.run("n", sup=True), "."])
    d.p(["Water is H", d.run("2", sub=True), "O and carbon dioxide is CO", d.run("2", sub=True), "."])
    d.p(["Mixed: a", d.run("i", sub=True), d.run("j", sup=True), " end."])


@topic(10, "fonts", "Font families Arial, Times New Roman, Courier New, Georgia")
def _(d):
    for f in ["Arial", "Times New Roman", "Courier New", "Georgia"]:
        d.p([d.run(f"{f}: ", font=f, b=True), d.run(txt(1), font=f)])


@topic(11, "font-sizes", "Font sizes 8 to 36 pt")
def _(d):
    for s in [8, 10, 12, 14, 18, 24, 36]:
        d.p([d.run(f"Size {s} pt sample", size=s)])


@topic(12, "text-colors", "Text colors (RGB)")
def _(d):
    for name, c in [("red", "FF0000"), ("green", "008000"), ("blue", "0000FF"), ("orange", "FF8000"), ("purple", "800080"), ("dark gray", "404040")]:
        d.p([d.run(f"This text is {name} (#{c}).", color=c)])


@topic(13, "highlight-colors", "Highlight colors yellow, green, cyan, magenta")
def _(d):
    for c in HL:
        d.p(["Text with ", d.run(f"{c} highlight", hl=c), " and plain text after."])


@topic(14, "alignment", "Paragraph alignment left, center, right, justify")
def _(d):
    long = " ".join(SENT * 2)
    for a in ["left", "center", "right", "justify"]:
        d.p([d.run(f"{a.capitalize()}: ", b=True), long], align=a)


@topic(15, "indentation", "Indentation left, right, first-line, hanging")
def _(d):
    long = " ".join(SENT)
    d.p("Left indent 2 cm. " + long, ml=2.0)
    d.p("Right indent 3 cm. " + long, mr=3.0)
    d.p("First-line indent 1.5 cm. " + long, indent=1.5)
    d.p("Hanging indent 1.5 cm. " + long, ml=1.5, indent=-1.5)
    d.p("Left 1 cm, right 1 cm, first-line 0.5 cm. " + long, ml=1.0, mr=1.0, indent=0.5)


@topic(16, "spacing", "Spacing before and after paragraphs")
def _(d):
    d.p("No extra spacing paragraph.", before=0, after=0)
    d.p("Paragraph with 24 pt before.", before=24, after=0)
    d.p("Paragraph with 24 pt after.", before=0, after=24)
    d.p("Paragraph with 12 pt before and 36 pt after.", before=12, after=36)
    d.p("Final paragraph.", before=0, after=0)


@topic(17, "line-spacing", "Line spacing single, 1.5, double, exact")
def _(d):
    long = " ".join(SENT * 2)
    for lab, lh in [("Single", "100%"), ("1.5 lines", "150%"), ("Double", "200%"), ("Exactly 18 pt", "18pt")]:
        d.p(f"{lab}: " + long, lh=lh)


# ---------------- 18-22 lists ----------------
@topic(18, "bullet-list-3-levels", "Bulleted list with 3 levels")
def _(d):
    d.p("Intro paragraph before the list.")
    d.lst([(1, "Fruit"), (2, "Apple"), (3, "Cox Orange"), (3, "Granny Smith"), (2, "Pear"), (1, "Vegetables"), (2, "Carrot"), (1, "Grains")])


@topic(19, "numbered-list-3-levels", "Numbered list with 3 levels (decimal)")
def _(d):
    d.lst([(1, "Plan"), (2, "Collect requirements"), (3, "Interview users"), (3, "Read tickets"), (2, "Estimate"), (1, "Build"), (2, "Implement"), (1, "Ship")], "decimal")


@topic(20, "numbered-list-letters-roman", "Numbered lists with letters and roman numerals")
def _(d):
    d.lst([(1, "Alpha item"), (1, "Beta item"), (1, "Gamma item"), (2, "Nested delta"), (2, "Nested epsilon")], "lower-alpha")
    d.p("Between the lists.")
    d.lst([(1, "First roman"), (1, "Second roman"), (1, "Third roman"), (1, "Fourth roman")], "lower-roman")


@topic(21, "list-restart", "Two separate numbered lists, second restarts at 1")
def _(d):
    d.p("First list:")
    d.lst([(1, "One"), (1, "Two"), (1, "Three")], "decimal")
    d.p("Second list restarts:")
    d.lst([(1, "Uno"), (1, "Dos"), (1, "Tres")], "decimal", restart=True)


@topic(22, "mixed-lists-paragraphs", "Lists mixed with paragraphs")
def _(d):
    d.h(1, "Shopping")
    d.p(txt(1))
    d.lst([(1, "Milk"), (1, "Bread"), (1, "Eggs")])
    d.p("A paragraph between two lists.")
    d.lst([(1, "Step one"), (1, "Step two"), (2, "Detail"), (1, "Step three")], "decimal")
    d.p("A closing paragraph.")


# ---------------- 23-29 tables ----------------
def _grid(r, c, prefix="R"):
    return [[f"{prefix}{i + 1}C{j + 1}" for j in range(c)] for i in range(r)]


@topic(23, "table-2x2", "Table 2x2 plain")
def _(d):
    d.p("A plain table follows.")
    d.table(_grid(2, 2))
    d.p("Text after the table.")


@topic(24, "table-4x3-header", "Table 4x3 with header row")
def _(d):
    d.table([["Name", "Role", "Score"], ["Alice", "Author", "10"], ["Bob", "Editor", "20"], ["Carol", "Reviewer", "30"]], header=True)
    d.p("Text after the table.")


@topic(25, "table-column-widths", "Table with explicit column widths")
def _(d):
    d.table([["Narrow", "Medium", "Wide"], ["1", "Some text", "A much longer cell with text that wraps around inside the wide column."], ["2", "More", "Short"]], widths=[2.0, 4.0, 10.0], header=True)


@topic(26, "table-cell-shading", "Table with cell shading")
def _(d):
    cols = {(0, 0): "FFFF99", (1, 1): "CCE5FF", (2, 2): "FFCCCC"}
    d.table(_grid(3, 3), shade=lambda r, c: cols.get((r, c)) or ("D9D9D9" if r == 0 else None))


@topic(27, "table-border-styles", "Table with different border styles")
def _(d):
    styles = ["0.5pt solid #000000", "2pt solid #000000", "1.5pt double #000000", "1pt dotted #000000", "1pt dashed #000000", "1pt solid #FF0000"]
    d.table(_grid(3, 2), border_by_cell=lambda r, c: styles[r * 2 + c])
    for s in ["solid", "double", "dotted", "dashed"]:
        d.feat(f"table:border={s}")
    d.feat("table:border-color")


@topic(28, "table-with-lists", "Table containing lists")
def _(d):
    l1 = d.lst_xml([(1, "Apples"), (1, "Pears"), (2, "Conference")], "bullet")
    l2 = d.lst_xml([(1, "Wake"), (1, "Work"), (1, "Sleep")], "decimal")
    d.table([["Bullets", "Numbers"], [l1, l2]], header=True)
    d.feat("table:contains-list")
    d.p("After the table.")


@topic(29, "table-multi-paragraph-cells", "Table with several paragraphs per cell")
def _(d):
    d.table([["Topic", "Notes"], [["Alpha", "Second line of alpha"], ["First note.", "Second note.", "Third note."]], [["Beta"], [txt(1), "Another paragraph in the cell."]]], header=True)
    d.feat("table:multi-paragraph-cells")


# ---------------- 30-32 images ----------------
@topic(30, "image-inline", "Inline image, small")
def _(d):
    d.p("Text before the image.")
    d.p([d.image(0, 3, 3)])
    d.p("Text after the image.")


@topic(31, "two-images-one-paragraph", "Two inline images in one paragraph")
def _(d):
    d.p(["First ", d.image(1, 2, 2), " and second ", d.image(2, 2, 2), " side by side."])


@topic(32, "image-alt-text", "Image with alt text")
def _(d):
    d.p([d.image(0, 3, 3, alt="A blue to yellow gradient square")])
    d.p([d.image(1, 2.5, 2.5, alt="A black and white checkerboard")])


# ---------------- 33-37 page setup ----------------
@topic(33, "page-a4", "Page A4 portrait, default margins")
def _(d):
    d.h(1, "A4 portrait"); d.p(txt(3))


@topic(34, "page-letter", "Page US Letter")
def _(d):
    d.page("letter", 21.59, 27.94)
    d.h(1, "US Letter"); d.p(txt(3))


@topic(35, "page-landscape", "Page A4 landscape")
def _(d):
    d.page("a4", 29.7, 21.0, "landscape")
    d.h(1, "Landscape"); d.p(txt(3))


@topic(36, "page-custom-margins", "Page with custom margins")
def _(d):
    d.page("a4", 21.0, 29.7, margins=(1.5, 3.0, 2.0, 4.0))
    d.h(1, "Custom margins"); d.p(txt(4))


@topic(37, "page-break", "Page break")
def _(d):
    d.h(1, "Page one"); d.p(txt(2))
    d.p("This paragraph starts on page two.", brk=True)
    d.p(txt(1, 2))


# ---------------- 38-42 misc content ----------------
@topic(38, "line-break", "Line break inside a paragraph")
def _(d):
    d.p(["First line", LB, "second line", LB, "third line of the same paragraph."])
    d.p(["Another ", d.run("formatted", b=True), LB, "paragraph with a break."])


@topic(39, "tabs", "Tabs inside paragraph")
def _(d):
    d.p(["Name", TAB, "Qty", TAB, "Price"])
    d.p(["Apple", TAB, "3", TAB, "1.20"])
    d.p(["Pear", TAB, "12", TAB, "0.80"])


@topic(40, "empty-paragraphs", "Empty paragraphs between content")
def _(d):
    d.p("Before the gap.")
    d.empty(); d.empty(); d.empty()
    d.p("After three empty paragraphs.")
    d.empty()
    d.p("Last paragraph.")


@topic(41, "long-document", "Long document, 200 paragraphs")
def _(d):
    for i in range(200):
        if i % 20 == 0:
            d.h(1, f"Section {i // 20 + 1}")
        else:
            d.p(f"Paragraph {i}. " + txt(2, i))
    d.feat("long:200-paragraphs")


@topic(42, "unicode", "Unicode text: umlauts, CJK, emoji, Hebrew")
def _(d):
    d.p("Umlauts: ÄÖÜ äöü ß, accents: café à la crème, ñ, å.")
    d.p("CJK: 日本語のテキスト 中文文本 한국어")
    d.p("Emoji: \U0001F600 \U0001F680 \U0001F4C4 ❤️")
    d.p("Hebrew: שלום עולם, זוהי בדיקה.", rtl=True, align="right")
    d.p("Symbols: © ® ™ € ½ ≤ ≠ ∞ →")
    d.feat("text:unicode")


# ---------------- 43-46 style interplay ----------------
@topic(43, "normal-direct-overrides", "Normal style with direct formatting overrides")
def _(d):
    d.p("Plain Normal paragraph.")
    d.p([d.run("Normal paragraph with direct run overrides.", size=14, color="0000FF", font="Georgia")], align="center")
    d.p("Normal paragraph with direct paragraph overrides.", ml=1.5, before=12, after=12, align="right")
    d.p([d.run("Everything overridden at once.", b=True, i=True, size=16)], ml=1, lh="150%", align="justify")
    d.feat("style:normal")


@topic(44, "heading-color-override", "Heading with direct color override")
def _(d):
    d.h(1, [d.run("Red Heading One", color="CC0000")])
    d.p(txt(1))
    d.h(2, [d.run("Green Heading Two", color="008000")])
    d.p(txt(1, 1))
    d.h(1, "Untouched Heading One")
    d.h(3, [d.run("Blue and Georgia", color="0000CC", font="Georgia")])


@topic(45, "nested-list-table-images", "List inside table inside document, with images")
def _(d):
    d.h(1, "Nested content")
    l1 = d.lst_xml([(1, "Cell bullet one"), (1, "Cell bullet two"), (2, "Cell sub-bullet")], "bullet")
    l2 = d.lst_xml([(1, "Cell step one"), (1, "Cell step two")], "decimal")
    img = X(f'<text:p text:style-name="Standard">{d.image(0, 2, 2, alt="Gradient")}</text:p>')
    img2 = X(f'<text:p text:style-name="Standard">Image: {d.image(2, 1.5, 1.5)} inline</text:p>')
    d.table([["List", "Image"], [l1, img], [l2, img2]], header=True)
    d.feat("table:contains-list"); d.feat("table:contains-image")
    d.p("Closing paragraph.")


@topic(46, "all-run-properties", "One paragraph using every run property")
def _(d):
    d.p([
        d.run("All properties at once", b=True, i=True, u=True, s=True, font="Georgia", size=18, color="C00000", hl="yellow"),
        " then ",
        d.run("sup", sup=True, b=True, color="0000FF"), " ",
        d.run("sub", sub=True, i=True, font="Courier New"),
        " and ",
        d.run("cyan on magenta", hl="cyan", color="800080", size=12),
        " and plain.",
    ], align="center", before=6, after=12, lh="150%")
    for h in ["green", "magenta"]:
        d.feat(f"run:highlight={h}")


# ---------------- 47-50 realistic combinations ----------------
@topic(47, "report", "Report: title, headings, paragraphs, table, image")
def _(d):
    d.title("Quarterly Report")
    d.p([d.run("Prepared by: ", b=True), "Example Team"], align="center")
    d.h(1, "Summary"); d.p(txt(3))
    d.h(2, "Highlights"); d.lst([(1, "Revenue up"), (1, "Costs stable"), (1, "New office")])
    d.h(1, "Figures")
    d.table([["Quarter", "Revenue", "Costs"], ["Q1", "100", "80"], ["Q2", "120", "85"], ["Q3", "130", "90"]], header=True, widths=[4, 6, 6])
    d.p([d.run("Table 1: Revenue and costs.", i=True)], align="center", before=6)
    d.h(1, "Chart"); d.p([d.image(0, 5, 3, alt="Placeholder chart")], align="center")
    d.h(1, "Conclusion"); d.p(txt(2, 2), align="justify")


@topic(48, "letter", "Letter: address block, date, body, signature")
def _(d):
    d.p(["Example Sender", LB, "Sample Street 1", LB, "1010 Vienna", LB, "Austria"], after=24)
    d.p(["Example Recipient", LB, "Another Road 22", LB, "8010 Graz"], before=12, after=24)
    d.p("Vienna, 1 January 2026", align="right", after=24)
    d.p([d.run("Subject: Reference letter", b=True)], after=12)
    d.p("Dear Sir or Madam,", after=12)
    d.p(txt(4), align="justify", after=12)
    d.p(txt(3, 2), align="justify", after=24)
    d.p("Yours faithfully,", after=36)
    d.p([d.run("Example Sender", i=True)])


@topic(49, "minutes", "Minutes: numbered agenda, table of actions")
def _(d):
    d.title("Meeting Minutes")
    d.p([d.run("Date: ", b=True), "1 January 2026", TAB, d.run("Place: ", b=True), "Room 1"])
    d.h(2, "Agenda")
    d.lst([(1, "Welcome"), (1, "Review of last minutes"), (1, "Project status"), (2, "Backend"), (2, "Frontend"), (1, "Any other business")], "decimal")
    d.h(2, "Action items")
    d.table([["Action", "Owner", "Due"], ["Write spec", "Alice", "Mon"], ["Review spec", "Bob", "Wed"], ["Ship it", "Carol", "Fri"]], header=True, widths=[8, 4, 4])
    d.p("Minutes taken by Alice.", before=12)


@topic(50, "cv", "CV: headings, bullet lists, two tables")
def _(d):
    d.title("Jane Example")
    d.p("jane@example.org · +43 1 234567 · Vienna", align="center")
    d.h(1, "Profile"); d.p(txt(2))
    d.h(1, "Experience")
    d.table([["2022–now", "Senior Engineer, Example GmbH"], ["2018–2022", "Engineer, Sample AG"]], widths=[4, 12])
    d.lst([(1, "Led a team of five"), (1, "Shipped three products"), (2, "One of them award winning")])
    d.h(1, "Education")
    d.table([["Degree", "Year"], ["MSc Computer Science", "2018"], ["BSc Computer Science", "2016"]], header=True, widths=[12, 4])
    d.h(1, "Skills")
    d.lst([(1, "Rust"), (1, "Python"), (1, "Documentation")])


# ---------------- 51-54 document structure (P8-9) ----------------
@topic(51, "multilevel-legal-numbering", "Multilevel legal numbering 1. / 1.1. / 1.1.1. with restart of deeper levels")
def _(d):
    lv = []
    for i in range(1, 6):
        pos = (f'<style:list-level-properties text:list-level-position-and-space-mode="label-alignment">'
               f'<style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="{0.9 * i + 0.4:.1f}cm" '
               f'fo:text-indent="-{0.4 + 0.3 * i:.1f}cm" fo:margin-left="{0.9 * i + 0.4:.1f}cm"/></style:list-level-properties>')
        lv.append(f'<text:list-level-style-number text:level="{i}" style:num-suffix="." style:num-format="1" text:display-levels="{i}">{pos}</text:list-level-style-number>')
    d.styles["LLegal"] = f'<text:list-style style:name="LLegal">{"".join(lv)}</text:list-style>'
    items = [(1, "Scope"), (2, "Purpose"), (2, "Audience"), (3, "Internal readers"), (3, "External readers"),
             (1, "Definitions"), (2, "Terms"), (3, "Document"), (1, "Obligations"), (2, "Parties")]

    def build(idx, level):
        out = []
        while idx < len(items) and items[idx][0] == level:
            content = items[idx][1]
            idx += 1
            inner = ""
            if idx < len(items) and items[idx][0] > level:
                inner, idx = build(idx, level + 1)
            out.append(f'<text:list-item><text:p text:style-name="Standard">{escape(content)}</text:p>{inner}</text:list-item>')
        return f'<text:list>{"".join(out)}</text:list>', idx

    xml, _ = build(0, 1)
    d.p("Legal numbering follows.")
    d.body.append(X(xml.replace("<text:list>", '<text:list text:style-name="LLegal">', 1)))
    d.p("End of the numbered clauses.")
    d.feat("list:number:levels=3:format=decimal")
    for label in ["1.", "1.2.", "1.2.2.", "2.1.1.", "3.1."]:
        d.feat(f"list:label={label}")


def _hf(tag, content):
    return f'<style:{tag}><text:p text:style-name="Standard">{content}</text:p></style:{tag}>'


PAGE_NO = X('<text:page-number text:select-page="current">1</text:page-number>')
PAGE_COUNT = X("<text:page-count>3</text:page-count>")


@topic(52, "sections-headers-fields", "Three sections: title page, portrait and landscape with own headers, footers and page fields")
def _(d):
    d.extra_auto = (
        '<style:page-layout style:name="pm2"><style:page-layout-properties fo:page-width="29.7cm" fo:page-height="21cm" '
        'style:print-orientation="landscape" fo:margin-top="2cm" fo:margin-right="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm"/>'
        '<style:header-style><style:header-footer-properties fo:min-height="0.6cm"/></style:header-style>'
        '<style:footer-style><style:header-footer-properties fo:min-height="0.6cm"/></style:footer-style></style:page-layout>'
        '<style:page-layout style:name="pm3"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" '
        'style:print-orientation="portrait" fo:margin-top="2.54cm" fo:margin-right="2.54cm" fo:margin-bottom="2.54cm" fo:margin-left="2.54cm"/>'
        '<style:header-style><style:header-footer-properties fo:min-height="0.6cm"/></style:header-style>'
        '<style:footer-style><style:header-footer-properties fo:min-height="0.6cm"/></style:footer-style></style:page-layout>'
        '<number:date-style style:name="D1" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0">'
        '<number:day/><number:text>.</number:text><number:month/><number:text>.</number:text><number:year number:style="long"/></number:date-style>'
        '<style:style style:name="PLand" style:family="paragraph" style:parent-style-name="Heading_20_1" style:master-page-name="Landscape">'
        '<style:paragraph-properties style:page-number="auto"/></style:style>'
        '<style:style style:name="PBody" style:family="paragraph" style:parent-style-name="Heading_20_1" style:master-page-name="Body">'
        '<style:paragraph-properties style:page-number="1"/></style:style>'
    )
    d.master_xml = (
        '<style:master-page style:name="Standard" style:page-layout-name="pm3" style:next-style-name="Body">'
        + _hf("header", "Title page header")
        + "</style:master-page>"
        '<style:master-page style:name="Body" style:page-layout-name="pm3">'
        + _hf("header", "Report body header")
        + _hf("footer", f"Page {PAGE_NO} of {PAGE_COUNT}")
        + "</style:master-page>"
        '<style:master-page style:name="Landscape" style:page-layout-name="pm2">'
        + _hf("header", "Landscape appendix header")
        + _hf("footer", f"Appendix page {PAGE_NO}")
        + "</style:master-page>"
    )
    d.title("Structured Report")
    d.p(["Created on ", X('<text:date style:data-style-name="D1" text:date-value="2026-01-01">01.01.2026</text:date>'), "."])
    d.body.append(X('<text:h text:style-name="PBody" text:outline-level="1">Body section</text:h>'))
    d.feat("heading:1")
    d.p(txt(3))
    d.p(["This is page ", PAGE_NO, " of ", PAGE_COUNT, "."])
    d.body.append(X('<text:h text:style-name="PLand" text:outline-level="1">Landscape appendix</text:h>'))
    d.p(txt(2, 1))
    for f in ["section:count=3", "section:landscape", "header:default", "footer:default",
              "field:page", "field:numpages", "field:date", "page-number:start=1"]:
        d.feat(f)


@topic(53, "footnotes-endnotes", "Footnotes and endnotes with references in body text")
def _(d):
    def note(cls, n, text):
        return X(f'<text:note text:id="{cls[:3]}{n}" text:note-class="{cls}"><text:note-citation>{n}</text:note-citation>'
                 f'<text:note-body><text:p text:style-name="Standard">{escape(text)}</text:p></text:note-body></text:note>')
    d.h(1, "Notes")
    d.p(["A sentence with a footnote", note("footnote", 1, "The first footnote."), " and more text."])
    d.p(["Another claim", note("footnote", 2, "Second footnote, with a longer explanation."),
         " followed by an endnote", note("endnote", 1, "The only endnote."), "."])
    d.p(["A third footnote", note("footnote", 3, "Third footnote."), " closes the paragraph."])
    d.feat("note:footnote=3")
    d.feat("note:endnote=1")


@topic(54, "table-of-contents", "Table of contents over Heading 1-3 with hyperlinks and page numbers")
def _(d):
    heads = [(1, "Introduction"), (2, "Background"), (2, "Goals"), (1, "Design"), (2, "Architecture"), (3, "Storage"), (1, "Summary")]
    entries = "".join(
        f'<text:p text:style-name="Contents_20_{lv}"><text:a xlink:type="simple" xlink:href="#{escape(t)}|outline" text:style-name="Index_20_Link">'
        f'{escape(t)}<text:tab/>{1 + i // 3}</text:a></text:p>'
        for i, (lv, t) in enumerate(heads)
    )
    tmpl = "".join(
        f'<text:table-of-content-entry-template text:outline-level="{k}" text:style-name="Contents_20_{k}">'
        '<text:index-entry-link-start text:style-name="Index_20_Link"/><text:index-entry-chapter/><text:index-entry-text/>'
        '<text:index-entry-tab-stop style:type="right" style:leader-char="."/><text:index-entry-page-number/>'
        '<text:index-entry-link-end/></text:table-of-content-entry-template>'
        for k in range(1, 4)
    )
    d.extra_styles = (
        '<style:style style:name="Index" style:family="paragraph" style:parent-style-name="Standard" style:class="index"/>'
        '<style:style style:name="Contents_20_Heading" style:display-name="Contents Heading" style:family="paragraph" style:parent-style-name="Heading" style:class="index">'
        '<style:text-properties fo:font-size="16pt" fo:font-weight="bold"/></style:style>'
        + "".join(
            f'<style:style style:name="Contents_20_{k}" style:display-name="Contents {k}" style:family="paragraph" style:parent-style-name="Index" style:class="index">'
            f'<style:paragraph-properties fo:margin-left="{0.5 * (k - 1):.1f}cm"><style:tab-stops><style:tab-stop style:position="16cm" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties></style:style>'
            for k in range(1, 4)
        )
        + '<style:style style:name="Index_20_Link" style:display-name="Index Link" style:family="text"/>'
    )
    d.body.append(X(
        '<text:table-of-content text:style-name="Sect1" text:protected="true" text:name="Table of Contents1">'
        '<text:table-of-content-source text:outline-level="3">'
        '<text:index-title-template text:style-name="Contents_20_Heading">Contents</text:index-title-template>'
        f"{tmpl}</text:table-of-content-source>"
        '<text:index-body><text:index-title text:style-name="Sect1" text:name="Table of Contents1_Head">'
        '<text:p text:style-name="Contents_20_Heading">Contents</text:p></text:index-title>'
        f"{entries}</text:index-body></text:table-of-content>"
    ))
    d.extra_auto = '<style:style style:name="Sect1" style:family="section"><style:section-properties style:editable="false"/></style:style>'
    for i, (lv, t) in enumerate(heads):
        d.h(lv, t, brk=(lv == 1 and i > 0))
        d.p(txt(2, i))
    d.feat("toc:levels=1-3")
    d.feat(f"toc:entries={len(heads)}")


# ---------------- 55-57 merged cells, floating images, paragraph borders and tabs ----------------
def _span_table(d, rows, widths):
    """rows: list of rows; a cell is text, ("text", colspan, rowspan) or None (covered)."""
    cols = "".join(f'<table:table-column table:style-name="{d.style_col(w)}"/>' for w in widths)
    tname = d.style("table", f'<style:table-properties style:width="{sum(widths):.2f}cm" table:align="left"/>')
    cn = d.style("table-cell", '<style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #000000"/>')
    out = [f'<table:table table:name="Table{len(d.names)}" table:style-name="{tname}">', cols]
    for row in rows:
        cells = []
        for cell in row:
            if cell is None:
                cells.append("<table:covered-table-cell/>")
                continue
            text, cs, rs = cell if isinstance(cell, tuple) else (cell, 1, 1)
            span = ""
            if cs > 1:
                span += f' table:number-columns-spanned="{cs}"'
            if rs > 1:
                span += f' table:number-rows-spanned="{rs}"'
            cells.append(f'<table:table-cell table:style-name="{cn}"{span} office:value-type="string">'
                         f'<text:p text:style-name="Standard">{escape(text)}</text:p></table:table-cell>')
        out.append(f'<table:table-row>{"".join(cells)}</table:table-row>')
    out.append("</table:table>")
    d.body.append(X("".join(out)))
    d.feat(f"table:rows={len(rows)}:cols={len(widths)}")


@topic(55, "table-merged-cells", "Tables with horizontally, vertically and block merged cells")
def _(d):
    d.h(1, "Merged cells")
    d.p("A header spanning all columns, a label spanning two rows and a merged pair:")
    _span_table(d, [
        [("Quarterly figures", 4, 1), None, None, None],
        [("Region", 1, 2), "Q1", "Q2", "Total"],
        [None, "10", "12", "22"],
        ["North", "5", ("8 (merged)", 2, 1), None],
    ], [4.0, 4.0, 4.0, 4.0])
    d.p("A 2x2 block merged in the middle of a 3x3 table:")
    _span_table(d, [
        ["A1", ("Block B1:C2", 2, 2), None],
        ["A2", None, None],
        ["A3", "B3", "C3"],
    ], [5.0, 5.0, 5.0])
    d.feat("table:merged=horizontal")
    d.feat("table:merged=vertical")
    d.p("Text after the tables.")


def _float_image(d, k, w, h, wrap, hpos, extra="", alt=None):
    """An image anchored to its paragraph. wrap: square|tight|top-bottom|behind."""
    d.imgs += 1
    name = f"fl{d.imgs}"
    wraps = {
        "square": 'style:wrap="parallel" style:wrap-contour="false" style:run-through="foreground"',
        "tight": 'style:wrap="parallel" style:wrap-contour="true" style:contour-mode="full" style:run-through="foreground"',
        "top-bottom": 'style:wrap="none" style:run-through="foreground"',
        "behind": 'style:wrap="run-through" style:run-through="background"',
    }
    d.styles[name] = (
        f'<style:style style:name="{name}" style:family="graphic"><style:graphic-properties {wraps[wrap]} '
        f'style:number-wrapped-paragraphs="no-limit" fo:margin-left="0.2cm" fo:margin-right="0.2cm" '
        f'fo:margin-top="0cm" fo:margin-bottom="0cm" style:vertical-pos="top" style:vertical-rel="paragraph" '
        f'style:horizontal-pos="{hpos}" style:horizontal-rel="paragraph" {extra}/></style:style>'
    )
    data = base64.b64encode(IMAGES[k]).decode()
    alt_xml = f"<svg:title>{escape(alt)}</svg:title><svg:desc>{escape(alt)}</svg:desc>" if alt else ""
    d.feat(f"image:float={wrap}")
    d.feat(f"image:float-align={hpos}")
    return X(
        f'<draw:frame draw:style-name="{name}" draw:name="Image{d.imgs}" text:anchor-type="paragraph" '
        f'svg:width="{w}cm" svg:height="{h}cm" svg:y="0cm"><draw:image><office:binary-data>{data}'
        f"</office:binary-data></draw:image>{alt_xml}</draw:frame>"
    )


@topic(56, "images-floating", "Floating images: square left, tight right, top-and-bottom centered, behind text")
def _(d):
    d.h(1, "Floating images")
    d.p([_float_image(d, 0, 3, 3, "square", "left", alt="Square wrap"), txt(5), " ", txt(5, 2)])
    d.p([_float_image(d, 1, 3, 3, "tight", "right"), txt(5, 1), " ", txt(5, 3)])
    d.p([_float_image(d, 2, 4, 2, "top-bottom", "center"), txt(3, 2)])
    d.p([_float_image(d, 0, 5, 1, "behind", "center"), txt(4, 4)])
    d.feat("image:alt")


@topic(57, "paragraph-borders-shading-tabs", "Paragraph borders, shading and custom tab stops")
def _(d):
    def para(props, content, inner=""):
        name = d.style("paragraph", f"<style:paragraph-properties {props}>{inner}</style:paragraph-properties>", "Standard")
        d.body.append(X(f'<text:p text:style-name="{name}">{seq(content)}</text:p>'))

    d.h(1, "Borders and shading")
    para('fo:border="0.5pt solid #000000" fo:padding="0.1cm"', "A paragraph in a box.")
    d.feat("para:border")
    para('fo:border-bottom="1.5pt solid #4472c4" fo:padding-bottom="0.05cm"', "A paragraph with a blue bottom rule.")
    para('fo:background-color="#fff2cc"', "A shaded paragraph (light yellow).")
    d.feat("para:shading")
    para('fo:background-color="#deebf7" fo:border-left="3pt solid #2e75b6" fo:padding-left="0.2cm"', "A call-out: shading and a thick left border.")
    d.h(1, "Tab stops")
    stops = (
        '<style:tab-stops>'
        '<style:tab-stop style:position="3cm"/>'
        '<style:tab-stop style:position="8cm" style:type="center"/>'
        '<style:tab-stop style:position="12cm" style:type="char" style:char="."/>'
        '<style:tab-stop style:position="16cm" style:type="right" style:leader-style="dotted" style:leader-text="."/>'
        '</style:tab-stops>'
    )
    for row in [("Item", "Centered", "12.5", "Page 1"), ("Second", "Middle", "1234.75", "Page 12"), ("Third", "Text", "3.1", "Page 123")]:
        para("", [row[0], TAB, row[1], TAB, row[2], TAB, row[3]], stops)
    for k in ["left", "center", "decimal", "right"]:
        d.feat(f"para:tab={k}")
    d.feat("para:tab-leader=dot")


# ---------------- 58 named styles ----------------
@topic(58, "styles-custom", "Custom paragraph, character and linked styles, next style, hidden and gallery flags")
def _(d):
    d.extra_styles = (
        # A custom paragraph style in the gallery whose next paragraph uses "Memo Body".
        '<style:style style:name="Memo_20_Heading" style:display-name="Memo Heading" style:family="paragraph" '
        'style:parent-style-name="Standard" style:next-style-name="Memo_20_Body" style:class="text" '
        'loext:linked-style-name="Memo_20_Heading_20_Char">'
        '<style:paragraph-properties fo:text-align="center" fo:margin-top="12pt" fo:margin-bottom="6pt"/>'
        '<style:text-properties fo:font-size="16pt" fo:font-weight="bold" fo:color="#1f4e79"/></style:style>'
        '<style:style style:name="Memo_20_Heading_20_Char" style:display-name="Memo Heading Char" style:family="text" '
        'loext:linked-style-name="Memo_20_Heading">'
        '<style:text-properties fo:font-size="16pt" fo:font-weight="bold" fo:color="#1f4e79"/></style:style>'
        '<style:style style:name="Memo_20_Body" style:display-name="Memo Body" style:family="paragraph" '
        'style:parent-style-name="Standard" style:class="text">'
        '<style:paragraph-properties fo:margin-left="1cm"/><style:text-properties fo:font-style="italic"/></style:style>'
        # A hidden paragraph style.
        '<style:style style:name="Internal_20_Note" style:display-name="Internal Note" style:family="paragraph" '
        'style:parent-style-name="Standard" style:hidden="true">'
        '<style:text-properties fo:color="#808080"/></style:style>'
        # A custom character style.
        '<style:style style:name="Key_20_Term" style:display-name="Key Term" style:family="text">'
        '<style:text-properties fo:font-weight="bold" fo:color="#c00000"/></style:style>'
    )
    d.body.append(X('<text:p text:style-name="Memo_20_Heading">Quarterly memo</text:p>'))
    d.body.append(X('<text:p text:style-name="Memo_20_Body">' + escape(txt(2)) + '</text:p>'))
    d.body.append(X('<text:p text:style-name="Standard">A <text:span text:style-name="Key_20_Term">key term</text:span> '
                    'and a <text:span text:style-name="Memo_20_Heading_20_Char">linked run</text:span> in Normal text.</text:p>'))
    d.body.append(X('<text:p text:style-name="Internal_20_Note">' + escape(txt(1, 3)) + '</text:p>'))
    for f in ["style:custom-paragraph", "style:custom-character", "style:linked", "style:next", "style:hidden"]:
        d.feat(f)


# ---------------- 59 comments ----------------
def _annotation(d, name, author, date, paras, initials=None, parent=None, resolved=False):
    """An ODF annotation (a docx comment); LibreOffice writes threads and "done" to commentsExtended.xml."""
    attrs = f' office:name="{name}"'
    if parent:
        attrs += f' loext:parent-name="{parent}"'
        d.feat("comment:reply")
    if resolved:
        attrs += ' loext:resolved="true"'
        d.feat("comment:resolved")
    ini = f"<meta:creator-initials>{escape(initials)}</meta:creator-initials>" if initials else ""
    text = "".join(f'<text:p text:style-name="Standard">{escape(t)}</text:p>' for t in paras)
    return X(f"<office:annotation{attrs}><dc:creator>{escape(author)}</dc:creator>{ini}<dc:date>{date}</dc:date>{text}</office:annotation>")


def _annotation_end(name):
    return X(f'<office:annotation-end office:name="{name}"/>')


@topic(59, "comments", "Comments on words, a whole paragraph and a table cell; a reply thread, a resolved comment, two authors with initials and dates")
def _(d):
    d.h(1, "Review comments")
    d.p(["The ", _annotation(d, "c1", "Anna Berg", "2026-10-01T09:30:00", ["Is \"quick\" the right word?"], initials="AB"),
         "quick brown", _annotation_end("c1"), " fox jumps over the lazy dog."])
    d.p([_annotation(d, "c2", "Ben Cole", "2026-10-02T10:00:00", ["This whole paragraph needs a source.", "Second paragraph of the comment."], initials="BC"),
         txt(1, 1), _annotation_end("c2"),
         _annotation(d, "c3", "Anna Berg", "2026-10-02T11:15:00", ["Added in the appendix."], initials="AB", parent="c2"), _annotation_end("c3")])
    d.p(["A ", _annotation(d, "c4", "Ben Cole", "2026-10-03T08:00:00", ["Fixed the spelling."], initials="BC", resolved=True),
         "resolved", _annotation_end("c4"), " comment and plain text."])
    d.table([[X('<text:p text:style-name="Standard">Cell '
                + _annotation(d, "c5", "Anna Berg", "2026-10-04T14:45:00", ["A comment in a table."], initials="AB")
                + "with a note" + _annotation_end("c5") + "</text:p>"), "Plain cell"]])
    d.feat("comment:in-table")
    d.feat("comment:count=5")
    d.feat("comment:authors=2")


# ---------------- 60 links, bookmarks, cross-references, captions, columns, properties ----------------
def _link(href, text):
    return X(f'<text:a xlink:type="simple" xlink:href="{escape(href)}">{escape(text)}</text:a>')


def _caption(d, label, n, text):
    """A caption paragraph `Label N: text` with a sequence field (docx SEQ Label \\* ARABIC)."""
    return d.p([f"{label} ", X(f'<text:sequence text:ref-name="ref{label}{n - 1}" text:name="{label}" '
                               f'text:formula="ooow:{label}+1" style:num-format="1">{n}</text:sequence>'), f": {text}"],
               parent="Caption")


@topic(60, "links-bookmarks-columns", "Hyperlinks (web, e-mail, bookmark), bookmarks, cross-references (REF/PAGEREF), captions with SEQ, 2- and 3-column sections with a column break, document properties")
def _(d):
    d.meta_xml = (
        "<dc:title>Links and columns</dc:title><dc:subject>Reference suite</dc:subject>"
        "<meta:initial-creator>Anna Berg</meta:initial-creator><dc:creator>Anna Berg</dc:creator>"
        "<meta:keyword>links</meta:keyword><meta:keyword>columns</meta:keyword>"
        "<dc:description>Provisional test document</dc:description>"
    )
    d.text_decls = (
        '<text:sequence-decls><text:sequence-decl text:display-outline-level="0" text:name="Illustration"/>'
        '<text:sequence-decl text:display-outline-level="0" text:name="Table"/>'
        '<text:sequence-decl text:display-outline-level="0" text:name="Figure"/></text:sequence-decls>'
    )
    d.extra_styles = (
        '<style:style style:name="Caption" style:family="paragraph" style:parent-style-name="Standard" style:class="extra">'
        '<style:text-properties fo:font-size="9pt" fo:font-style="italic"/></style:style>'
    )
    d.extra_auto = (
        '<style:style style:name="Sect2" style:family="section"><style:section-properties>'
        '<style:columns fo:column-count="2" fo:column-gap="0.5cm"/></style:section-properties></style:style>'
        '<style:style style:name="Sect3" style:family="section"><style:section-properties>'
        '<style:columns fo:column-count="3" fo:column-gap="0.4cm"><style:column-sep style:width="0.02cm" style:color="#000000" '
        'style:height="100%" style:style="solid"/></style:columns></style:section-properties></style:style>'
        '<style:style style:name="PCol" style:family="paragraph" style:parent-style-name="Standard">'
        '<style:paragraph-properties fo:break-before="column"/></style:style>'
    )
    d.h(1, ["Links and ", X('<text:bookmark-start text:name="results"/>'), "results", X('<text:bookmark-end text:name="results"/>')])
    d.p(["Visit ", _link("https://www.example.com/", "the example site"), ", write to ",
         _link("mailto:info@example.com", "info@example.com"), " or jump to ", _link("#summary", "the summary"), "."])
    d.p(["The results are on page ",
         X('<text:bookmark-ref text:reference-format="page" text:ref-name="results">1</text:bookmark-ref>'),
         ", see \u201c", X('<text:bookmark-ref text:reference-format="text" text:ref-name="results">results</text:bookmark-ref>'),
         "\u201d."])
    _caption(d, "Figure", 1, "A first picture")
    _caption(d, "Figure", 2, "A second picture")
    _caption(d, "Table", 1, "Some numbers")
    d.body.append(X('<text:section text:style-name="Sect2" text:name="TwoColumns">'
                    + d.p_xml(txt(3)) + f'<text:p text:style-name="PCol">{escape(txt(2, 1))}</text:p>'
                    + "</text:section>"))
    d.body.append(X('<text:section text:style-name="Sect3" text:name="ThreeColumns">'
                    + d.p_xml(txt(4, 2)) + "</text:section>"))
    d.p([X('<text:bookmark-start text:name="summary"/>'), "Summary paragraph", X('<text:bookmark-end text:name="summary"/>'), "."])
    for f in ["link:url", "link:email", "link:bookmark", "field:ref", "field:pageref", "field:seq=Figure", "field:seq=Table",
              "section:columns=2", "section:columns=3", "section:column-separator", "break:column",
              "props:title", "props:subject", "props:author", "props:keywords", "bookmark:count=2"]:
        d.feat(f)


def _gstyle(d, name, props):
    d.styles[name] = f'<style:style style:name="{name}" style:family="graphic"><style:graphic-properties {props}/></style:style>'
    return name


# Word's default shape look (accent 1 fill, darker outline) and its Simple Text Box (white, thin black outline).
SHAPE_LOOK = 'draw:fill="solid" draw:fill-color="#4472c4" draw:stroke="solid" svg:stroke-color="#2f528f" svg:stroke-width="0.035cm"'
BOX_LOOK = 'draw:fill="solid" draw:fill-color="#ffffff" draw:stroke="solid" svg:stroke-color="#000000" svg:stroke-width="0.026cm"'


def _shape(d, name, kind, w, h, text, anchor="as-char", extra=""):
    """A custom shape (`round-rectangle`, `ellipse`, `right-arrow`) with optional text."""
    d.imgs += 0
    body = f'<text:p text:style-name="PShape">{escape(text)}</text:p>' if text else ""
    pos = 'svg:x="0cm" svg:y="0cm" ' if anchor != "as-char" else ""
    return X(
        f'<draw:custom-shape text:anchor-type="{anchor}" draw:z-index="0" draw:name="{name}" draw:style-name="{extra or "grShape"}" '
        f'{pos}svg:width="{w}cm" svg:height="{h}cm">{body}'
        f'<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="{kind}"/></draw:custom-shape>'
    )


def _text_box(d, name, w, h, paras, anchor="as-char", style="grBox"):
    inner = "".join(f"<text:p>{escape(t)}</text:p>" for t in paras)
    pos = 'svg:x="0cm" svg:y="0cm" ' if anchor != "as-char" else ""
    return X(
        f'<draw:frame text:anchor-type="{anchor}" draw:z-index="1" draw:name="{name}" draw:style-name="{style}" '
        f'{pos}svg:width="{w}cm" svg:height="{h}cm"><draw:text-box>{inner}</draw:text-box></draw:frame>'
    )


@topic(61, "shapes-text-boxes", "Shapes and text boxes: inline rounded rectangle with text, floating text box right with square wrap, floating arrow")
def _(d):
    _gstyle(d, "grShape", SHAPE_LOOK + ' style:vertical-pos="middle" style:vertical-rel="baseline" draw:textarea-vertical-align="middle"')
    _gstyle(d, "grBox", BOX_LOOK + ' style:vertical-pos="top" style:vertical-rel="baseline" fo:padding="0.13cm"')
    _gstyle(d, "grBoxRight", BOX_LOOK + ' style:wrap="parallel" style:number-wrapped-paragraphs="no-limit" '
            'style:wrap-contour="false" style:run-through="foreground" fo:margin-left="0.32cm" fo:margin-right="0.32cm" '
            'style:vertical-pos="top" style:vertical-rel="paragraph" style:horizontal-pos="right" style:horizontal-rel="paragraph" fo:padding="0.13cm"')
    _gstyle(d, "grArrow", SHAPE_LOOK + ' style:wrap="none" style:run-through="foreground" style:vertical-pos="top" '
            'style:vertical-rel="paragraph" style:horizontal-pos="center" style:horizontal-rel="paragraph"')
    d.extra_styles = (
        '<style:style style:name="PShape" style:family="paragraph" style:parent-style-name="Standard">'
        '<style:paragraph-properties fo:text-align="center"/><style:text-properties fo:color="#ffffff"/></style:style>'
    )
    d.h(1, "Shapes and text boxes")
    d.p(["An inline shape: ", _shape(d, "Rounded Rectangle 1", "round-rectangle", 4, 1.5, "Shape text"), " and more text."])
    d.p([_text_box(d, "Text Box 2", 5, 2.5, ["Floating text box", "Second line"], anchor="paragraph", style="grBoxRight"),
         txt(5), " ", txt(5, 2)])
    d.p(["An inline text box: ", _text_box(d, "Text Box 3", 4, 1.2, ["Boxed text"]), " ends here."])
    d.p([_shape(d, "Right Arrow 4", "right-arrow", 3, 1.5, "", anchor="paragraph", extra="grArrow"), txt(3, 1)])
    for f in ["drawing:shape=roundRect", "drawing:shape=rightArrow", "drawing:textbox", "drawing:text", "drawing:inline",
              "drawing:float=square", "drawing:float=top-bottom"]:
        d.feat(f)


@topic(62, "character-formatting", "Character formatting: small caps, all caps, spacing, position, scale, double strike, outline, shadow, emboss, engrave, hidden")
def _(d):
    def span(props, text, *feats):
        for f in feats:
            d.feat(f)
        name = d.style("text", f"<style:text-properties {props}/>")
        return X(f'<text:span text:style-name="{name}">{esc(text)}</text:span>')
    d.h(1, "Character formatting")
    d.p(["Normal, ", span('fo:font-variant="small-caps"', "Small Caps", "run:small-caps"), ", ",
         span('fo:text-transform="uppercase"', "all caps", "run:all-caps"), "."])
    d.p(["Spacing: ", span('fo:letter-spacing="0.0706cm"', "expanded by two points", "run:spacing=2pt"), ", ",
         span('fo:letter-spacing="-0.0176cm"', "condensed", "run:spacing=-0.5pt"), "."])
    d.p(["Position: ", span('style:text-position="33% 100%"', "raised", "run:position=3.5pt"), " and ",
         span('style:text-scale="150%"', "wide", "run:scale=150"), "."])
    d.p(["Effects: ", span('style:text-line-through-style="solid" style:text-line-through-type="double"', "double strike", "run:double-strike"), ", ",
         span('style:text-outline="true"', "outline", "run:outline"), ", ",
         span('fo:text-shadow="1pt 1pt"', "shadow", "run:shadow"), ", ",
         span('style:font-relief="embossed"', "emboss", "run:emboss"), ", ",
         span('style:font-relief="engraved"', "engrave", "run:imprint"), "."])
    d.p(["Hidden: [", span('text:display="none"', "secret", "run:hidden"), "] done."])


# ---------------- 63-64 style sets, document properties, a template (P9-W3) ----------------
@topic(63, "style-sets-properties", "Linked styles with style-set looks (caps, shading, bottom rule), document defaults, words underline, small caps and spacing, document properties with TITLE/SUBJECT/AUTHOR/KEYWORDS fields and DOCPROPERTY Company")
def _(d):
    d.meta_xml = (
        "<dc:title>Style sets and properties</dc:title><dc:subject>Reference suite</dc:subject>"
        "<meta:initial-creator>Anna Berg</meta:initial-creator><dc:creator>Anna Berg</dc:creator>"
        "<meta:keyword>styles</meta:keyword><dc:description>Provisional test document</dc:description>"
    )
    d.extra_styles = (
        # Shaded heading (white caps on blue) and a heading with a bottom rule, both linked like Word's.
        '<style:style style:name="Shaded_20_Heading" style:display-name="Shaded Heading" style:family="paragraph" '
        'style:parent-style-name="Standard" style:next-style-name="Standard" style:class="text" '
        'loext:linked-style-name="Shaded_20_Heading_20_Char">'
        '<style:paragraph-properties fo:background-color="#4472c4" fo:margin-top="12pt" fo:margin-bottom="0pt" fo:keep-with-next="always"/>'
        '<style:text-properties fo:font-size="14pt" fo:color="#ffffff" fo:text-transform="uppercase"/></style:style>'
        '<style:style style:name="Shaded_20_Heading_20_Char" style:display-name="Shaded Heading Char" style:family="text" '
        'loext:linked-style-name="Shaded_20_Heading">'
        '<style:text-properties fo:font-size="14pt" fo:color="#ffffff" fo:text-transform="uppercase"/></style:style>'
        '<style:style style:name="Lined_20_Heading" style:display-name="Lined Heading" style:family="paragraph" '
        'style:parent-style-name="Standard" style:next-style-name="Standard" style:class="text">'
        '<style:paragraph-properties fo:border-bottom="1pt solid #4472c4" fo:padding-bottom="1pt" fo:margin-top="12pt"/>'
        '<style:text-properties fo:font-size="13pt" fo:color="#2f5496" fo:font-variant="small-caps" fo:letter-spacing="0.0353cm"/></style:style>'
    )
    d.body.append(X('<text:p text:style-name="Shaded_20_Heading">Shaded heading</text:p>'))
    d.p(["Title: ", X("<text:title>Style sets and properties</text:title>"),
         ", subject: ", X("<text:subject>Reference suite</text:subject>"), "."])
    d.p(["Author: ", X("<text:initial-creator>Anna Berg</text:initial-creator>"),
         ", keywords: ", X("<text:keywords>styles</text:keywords>"), ", company: COMPANY."])
    d.body.append(X('<text:p text:style-name="Lined_20_Heading">Lined heading</text:p>'))
    name = d.style("text", '<style:text-properties style:text-underline-style="solid" style:text-underline-width="auto" '
                           'style:text-underline-color="font-color" style:text-underline-mode="skip-white-space"/>')
    d.p(["Words only: ", X(f'<text:span text:style-name="{name}">underlined words only</text:span>'), "."])
    d.p(["A linked run: ", X('<text:span text:style-name="Shaded_20_Heading_20_Char">in Normal text</text:span>'), "."])
    for f in ["style:linked", "style:shading", "style:bottom-rule", "run:words-underline",
              "field:title", "field:subject", "field:author", "field:keywords", "field:docproperty=company",
              "props:title", "props:subject", "props:author", "props:keywords", "props:company", "page:a4"]:
        d.feat(f)


@topic(64, "template-memo", "A Word template (.dotx): memo title, To/From/Date/Re lines with a tab stop and a DATE field, a rule, body placeholder")
def _(d):
    d.ext = "dotx"
    d.meta_xml = "<dc:title>Memo</dc:title>"
    d.title("Memo")
    for label, value in [("To:", "[Recipient names]"), ("From:", "[Your name]"), ("Re:", "[Subject]")]:
        d.p([label, TAB, value])
    d.p(["Date:", TAB, X('<text:date style:data-style-name="N37" text:date-value="2026-10-17">17.10.2026</text:date>')])
    d.p(txt(1))
    d.p("[Type the text of the memo here.]")
    for f in ["template", "title", "tab", "field:date", "props:title", "page:a4"]:
        d.feat(f)


# ---------------- 65 drawings round 2 (P9-W4) ----------------
@topic(65, "drawings-floating-2", "Drawings round 2: a group (rectangle and oval), two linked text boxes, a drawing canvas, a centred picture wrapped on both sides, a linked picture with soft edges and a bevel, a HYPERLINK field, a hidden decorative shape")
def _(d):
    _gstyle(d, "grGroup", SHAPE_LOOK + ' style:wrap="run-through" style:run-through="foreground" style:vertical-pos="top" '
            'style:vertical-rel="paragraph" style:horizontal-pos="from-left" style:horizontal-rel="paragraph"')
    _gstyle(d, "grLinked", BOX_LOOK + ' style:wrap="parallel" style:number-wrapped-paragraphs="no-limit" style:wrap-contour="false" '
            'style:run-through="foreground" style:vertical-pos="top" style:vertical-rel="paragraph" '
            'style:horizontal-pos="from-left" style:horizontal-rel="paragraph" fo:padding="0.13cm"')
    d.h(1, "Drawings round 2")
    shape = lambda name, kind, x, y, w, h: (
        f'<draw:custom-shape draw:name="{name}" draw:style-name="grShapeG" svg:x="{x}cm" svg:y="{y}cm" '
        f'svg:width="{w}cm" svg:height="{h}cm"><draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="{kind}"/></draw:custom-shape>'
    )
    _gstyle(d, "grShapeG", SHAPE_LOOK)
    group = X(
        '<draw:g draw:style-name="grGroup" draw:name="Group 1" text:anchor-type="paragraph" draw:z-index="2">'
        + shape("Rectangle 2", "rectangle", 0, 0, 3, 1.5)
        + shape("Oval 3", "ellipse", 3.5, 0.5, 2, 2)
        + "</draw:g>"
    )
    d.p([group, "A group of a rectangle and an oval floats in front of this paragraph. ", txt(2)])
    d.feat("drawing:group")
    box = lambda name, x, nxt, paras: X(
        f'<draw:frame draw:style-name="grLinked" draw:name="{name}" text:anchor-type="paragraph" draw:z-index="3" '
        f'svg:x="{x}cm" svg:y="0cm" svg:width="5cm" svg:height="1.6cm"><draw:text-box'
        + (f' draw:chain-next-name="{nxt}"' if nxt else "")
        + ">" + "".join(f"<text:p>{escape(t)}</text:p>" for t in paras) + "</draw:text-box></draw:frame>"
    )
    d.p([box("Text Box 4", 0, "Text Box 5", ["Linked text boxes: this story is longer than the first box,",
                                             "so it continues in the second box next to it, as in Word."]),
         box("Text Box 5", 9, None, []), txt(4)])
    d.feat("drawing:linked-textbox")
    d.p(["A drawing canvas: CANVAS_HERE"])
    d.feat("drawing:canvas")
    d.p([_float_image(d, 0, 4, 3, "square", "center", alt="Centred picture"), txt(10)])
    d.feat("image:wrap-both-sides")
    d.styles["frLink"] = (
        '<style:style style:name="frLink" style:family="graphic"><style:graphic-properties '
        'style:vertical-pos="top" style:vertical-rel="baseline" loext:softedge-radius="0.18cm"/></style:style>'
    )
    data = base64.b64encode(IMAGES[1]).decode()
    d.imgs += 1
    linked = X(
        '<draw:a xlink:type="simple" xlink:href="https://rusuit.es/" office:title="Rusuite">'
        f'<draw:frame draw:style-name="frLink" draw:name="Image{d.imgs}" text:anchor-type="as-char" svg:width="2cm" svg:height="2cm">'
        f"<draw:image><office:binary-data>{data}</office:binary-data></draw:image></draw:frame></draw:a>"
    )
    d.p(["A linked picture with soft edges and a bevel: ", linked, "."])
    d.feat("image:link")
    d.feat("image:soft-edge")
    d.p(["A HYPERLINK field: FIELD_HERE."])
    d.feat("field:hyperlink")
    _gstyle(d, "grFront", SHAPE_LOOK + ' style:wrap="none" style:run-through="foreground" style:vertical-pos="top" '
            'style:vertical-rel="paragraph" style:horizontal-pos="right" style:horizontal-rel="paragraph"')
    d.p([_shape(d, "Hidden Shape 6", "ellipse", 1, 1, "", anchor="paragraph", extra="grFront"), "A hidden decorative oval is anchored here."])
    d.feat("drawing:hidden")
    d.feat("page:a4")


# ---------------- 66 tables round 2, ruler and symbols (P9-W5) ----------------
@topic(66, "tables-2-columns-symbols", "Tables round 2: a merged header over a vertically merged column, a fixed-layout floating table with "
       "a table style and look, indents and tab stops of every kind, two unequal text columns with a line between, special "
       "characters (non-breaking space and hyphen, optional hyphen, dashes, (c) (r) (tm), ellipsis, smart quotes)")
def _(d):
    d.extra_auto = (
        '<style:style style:name="SectU" style:family="section"><style:section-properties>'
        '<style:columns fo:column-count="2"><style:column-sep style:width="0.02cm" style:color="#000000" style:height="100%" '
        'style:style="solid"/><style:column style:rel-width="3000*" fo:start-indent="0cm" fo:end-indent="0.25cm"/>'
        '<style:column style:rel-width="6000*" fo:start-indent="0.25cm" fo:end-indent="0cm"/></style:columns>'
        "</style:section-properties></style:style>"
        '<style:style style:name="PTabs" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties>'
        '<style:tab-stops><style:tab-stop style:position="2cm"/><style:tab-stop style:position="6cm" style:type="center"/>'
        '<style:tab-stop style:position="10cm" style:type="char" style:char=","/><style:tab-stop style:position="14cm" style:type="right"/>'
        "</style:tab-stops></style:paragraph-properties></style:style>"
    )
    d.h(1, "Tables round 2")
    d.p("A header over three columns above a column merged over two rows:")
    _span_table(d, [
        [("Quarter overview", 3, 1), None, None],
        ["Region", "Q1", ("Notes over two rows", 1, 2)],
        ["North", "12", None],
    ], [4.0, 4.0, 6.0])
    d.feat("table:merged=horizontal")
    d.feat("table:merged=vertical")
    d.p("A table with a fixed layout that the text wraps around:")
    d.table([["Item", "Price"], ["Coffee", "3,40"], ["Tea", "2,90"]], widths=[4.0, 3.0], header=True)
    d.feat("table:floating")
    d.feat("table:layout-fixed")
    d.feat("table:look")
    d.p(txt(4))
    d.h(2, "Indents and tab stops")
    d.p(txt(3), indent=1.0, ml=1.5, mr=1.0)
    d.p(txt(3), indent=-1.0, ml=2.0)
    d.body.append(X('<text:p text:style-name="PTabs">Left<text:tab/>Center<text:tab/>12,50<text:tab/>Right</text:p>'))
    d.feat("tab")
    d.feat("para:tab=bar")
    d.h(2, "Unequal columns")
    d.body.append(X('<text:section text:style-name="SectU" text:name="Unequal">' + d.p_xml(txt(5)) + d.p_xml(txt(6, 3)) + "</text:section>"))
    d.feat("section:columns=2")
    d.feat("section:columns-unequal")
    d.feat("section:column-separator")
    d.h(2, "Special characters")
    d.p("Non\u2011breaking hyphen, op\u00adtional hyphen, 10\u00a0km, en dash \u2013 em dash \u2014, "
        "\u00a9 \u00ae \u2122, ellipsis\u2026 and \u201csmart quotes\u201d.")
    d.feat("char:no-break-hyphen")
    d.feat("char:soft-hyphen")
    d.feat("char:nbsp")
    d.feat("page:a4")


# ---------------- 67 comments, notes and fields round 2 (P9-W6) ----------------
@topic(67, "comments-notes-fields-2", "Comments round 2: formatted comment text with an @mention (people.xml), a reply and a resolved thread, a comment inside a footnote; a custom footnote continuation separator; STYLEREF in the header, SEQ with \\c and \\s, a locked field, REF with \\p and \\w, SECTIONPAGES")
def _(d):
    def fn(n, paras):
        body = "".join(paras)
        return X(f'<text:note text:id="ftn{n}" text:note-class="footnote"><text:note-citation>{n}</text:note-citation>'
                 f"<text:note-body>{body}</text:note-body></text:note>")
    d.master_xml = (
        '<style:master-page style:name="Standard" style:page-layout-name="pm1">'
        + _hf("header", f"Chapter: STYLEREF_HERE – page {PAGE_NO} of SECTIONPAGES_HERE")
        + "</style:master-page>"
    )
    d.h(1, "Methods")
    d.p(["The ", _annotation(d, "c1", "Anna Berg", "2026-10-17T08:00:00", ["Please CHECK_HERE this, MENTION_HERE"], initials="AB"),
         "draft", _annotation_end("c1"), " needs a review",
         fn(1, ['<text:p text:style-name="Standard">A footnote with a '
                + _annotation(d, "c2", "Ben Cole", "2026-10-17T09:00:00", ["Comment inside the note."], initials="BC")
                + "commented" + _annotation_end("c2") + " word.</text:p>"]),
         "."])
    d.p([_annotation(d, "c3", "Ben Cole", "2026-10-17T10:00:00", ["Agreed."], initials="BC", parent="c1"), _annotation_end("c3"),
         _annotation(d, "c4", "Anna Berg", "2026-10-17T11:00:00", ["Done."], initials="AB", resolved=True),
         "Resolved", _annotation_end("c4"), " text. BOOKMARK_HERE"])
    d.p("Figure SEQ_HERE shows the setup; it is still figure SEQC_HERE. Locked date: LOCKED_HERE. See REFP_HERE.")
    d.h(1, "Results")
    d.p(txt(4))
    for f in ["comment:count=4", "comment:reply", "comment:resolved", "comment:formatted", "comment:mention", "comment:in-note",
              "people", "note:footnote=1", "note:separator-text", "field:styleref", "field:sectionpages", "field:seq-switches",
              "field:locked", "field:ref-switches", "header:default", "field:page", "page:a4"]:
        d.feat(f)


def emit(outdir, pngdir):
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    for k in range(3):
        IMAGES[k] = (Path(pngdir) / f"img{k}.png").read_bytes()
    manifest = []
    assert [t[0] for t in sorted(TOPICS)] == list(range(1, 68)), "need exactly topics 1..67"
    for n, slug, desc, fn in sorted(TOPICS):
        d = Doc(n, slug, desc)
        fn(d)
        xml, paras = d.finalize()
        (out / f"provisional-{n:02d}-{slug}.fodt").write_text(xml, encoding="utf-8")
        manifest.append({"file": d.file, "topic": desc, "features": d.feats, "paragraphs": paras})
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"emitted {len(manifest)} documents")


# Word style flags LibreOffice does not export (it marks every style qFormat and writes no
# hidden / uiPriority / customStyle / latentStyles): added to file 58 after the conversion.
STYLE_PATCHES = {
    "provisional-58-styles-custom.docx": [
        ('<w:style w:type="paragraph" w:styleId="MemoHeading">', '<w:style w:type="paragraph" w:customStyle="1" w:styleId="MemoHeading">'),
        ('<w:link w:val="MemoHeadingChar"/><w:qFormat/>', '<w:link w:val="MemoHeadingChar"/><w:uiPriority w:val="5"/><w:qFormat/>'),
        ('<w:style w:type="character" w:styleId="MemoHeadingChar">', '<w:style w:type="character" w:customStyle="1" w:styleId="MemoHeadingChar">'),
        ('<w:style w:type="paragraph" w:styleId="MemoBody"><w:name w:val="Memo Body"/><w:basedOn w:val="Normal"/><w:qFormat/>',
         '<w:style w:type="paragraph" w:customStyle="1" w:styleId="MemoBody"><w:name w:val="Memo Body"/><w:basedOn w:val="Normal"/><w:uiPriority w:val="6"/>'),
        ('<w:style w:type="paragraph" w:styleId="InternalNote"><w:name w:val="Internal Note"/><w:basedOn w:val="Normal"/><w:qFormat/>',
         '<w:style w:type="paragraph" w:customStyle="1" w:styleId="InternalNote"><w:name w:val="Internal Note"/><w:basedOn w:val="Normal"/><w:hidden/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>'),
        ('<w:style w:type="character" w:styleId="KeyTerm">', '<w:style w:type="character" w:customStyle="1" w:styleId="KeyTerm">'),
        ('</w:docDefaults>', '</w:docDefaults><w:latentStyles w:defLockedState="0" w:defUIPriority="99" w:defSemiHidden="0" '
         'w:defUnhideWhenUsed="0" w:defQFormat="0" w:count="2"><w:lsdException w:name="Normal" w:uiPriority="0" w:qFormat="1"/>'
         '<w:lsdException w:name="heading 1" w:uiPriority="9" w:qFormat="1"/></w:latentStyles>'),
    ],
}


# What LibreOffice cannot export in file 63 (P9-W3): the words-only underline (it writes single), a DOCPROPERTY
# Company field and the company in docProps/app.xml.
CANVAS_65 = (
    '<w:r><mc:AlternateContent><mc:Choice Requires="wpc"><w:drawing>'
    '<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="3600000" cy="1080000"/>'
    '<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="20" name="Canvas 20"/><wp:cNvGraphicFramePr/>'
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
    '<a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas">'
    '<wpc:wpc xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"><wpc:bg>'
    '<a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill></wpc:bg><wpc:whole><a:ln><a:noFill/></a:ln>'
    '</wpc:whole><wps:wsp><wps:cNvPr id="21" name="Rectangle 21"/><wps:cNvSpPr/><wps:spPr><a:xfrm>'
    '<a:off x="180000" y="180000"/><a:ext cx="1080000" cy="720000"/></a:xfrm><a:prstGeom prst="rect">'
    '<a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="4472C4"/></a:solidFill><a:ln w="12700"><a:solidFill>'
    '<a:srgbClr val="2F528F"/></a:solidFill></a:ln></wps:spPr><wps:bodyPr/></wps:wsp><wps:wsp>'
    '<wps:cNvPr id="22" name="Oval 22"/><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="1620000" y="180000"/>'
    '<a:ext cx="720000" cy="720000"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill>'
    '<a:srgbClr val="ED7D31"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="AE5A21"/>'
    '</a:solidFill></a:ln></wps:spPr><wps:bodyPr/></wps:wsp></wpc:wpc></a:graphicData></a:graphic></wp:inline>'
    '</w:drawing></mc:Choice><mc:Fallback><w:t>[canvas]</w:t></mc:Fallback></mc:AlternateContent></w:r>'
)
FIELD_65 = (
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r>'
    '<w:instrText xml:space="preserve"> HYPERLINK "https://rusuit.es/docs" \\o "Rusuite docs" </w:instrText>'
    '</w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:color w:val="0563C1"/>'
    '<w:u w:val="single"/></w:rPr><w:t>the documentation</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/>'
    '</w:r><w:r><w:t>.</w:t></w:r>'
)

PART_PATCHES = {
    "provisional-66-tables-2-columns-symbols.docx": {
        "word/document.xml": [
            # The second table floats (Around, 0.32 cm from the text, right of the column, never overlapping), has a
            # table style with a header row look (LibreOffice writes neither).
            ('<w:tbl><w:tblPr><w:tblW w:w="3969" w:type="dxa"/>',
             '<w:tbl><w:tblPr><w:tblStyle w:val="W5Table"/><w:tblpPr w:leftFromText="180" w:rightFromText="180" '
             'w:vertAnchor="text" w:horzAnchor="margin" w:tblpXSpec="right" w:tblpY="1"/><w:tblOverlap w:val="never"/>'
             '<w:tblW w:w="3969" w:type="dxa"/>'),
            ('</w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2268"/><w:gridCol w:w="1701"/>',
             '</w:tblCellMar><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" '
             'w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="2268"/><w:gridCol w:w="1701"/>'),
            # A bar tab next to the left, center, decimal and right stops.
            ('<w:tab w:val="right" w:pos="7937" w:leader="none"/></w:tabs>',
             '<w:tab w:val="right" w:pos="7937" w:leader="none"/><w:tab w:val="bar" w:pos="8505"/></w:tabs>'),
        ],
        "word/styles.xml": [
            # A table style whose header row is bold and shaded (tblStylePr firstRow).
            ('</w:styles>',
             '<w:style w:type="table" w:styleId="W5Table"><w:name w:val="W5 Table"/><w:uiPriority w:val="40"/><w:pPr>'
             '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders>'
             '<w:top w:val="single" w:sz="4" w:space="0" w:color="4472C4"/><w:bottom w:val="single" w:sz="4" w:space="0" '
             'w:color="4472C4"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="8EAADB"/></w:tblBorders></w:tblPr>'
             '<w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:tcPr><w:shd w:val="clear" '
             'w:color="auto" w:fill="4472C4"/></w:tcPr></w:tblStylePr></w:style></w:styles>'),
        ],
    },
    "provisional-65-drawings-floating-2.docx": {
        "word/document.xml": [
            # The chain of the two text boxes (LibreOffice exports separate boxes).
            ('<wps:txbx><w:txbxContent>', '<wps:txbx id="1"><w:txbxContent>'),
            ('<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape id="shape_0" ID="Text Box 5"',
             '<wps:linkedTxbx id="1" seq="1"/><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape id="shape_0" ID="Text Box 5"'),
            # A drawing canvas with two shapes (LibreOffice has none).
            ('<w:t>A drawing canvas: CANVAS_HERE</w:t></w:r>', '<w:t xml:space="preserve">A drawing canvas: </w:t></w:r>' + CANVAS_65),
            # The picture link's ScreenTip and a bevel next to the soft edges.
            ('<a:hlinkClick r:id="rId4" ', '<a:hlinkClick tooltip="Rusuite" r:id="rId4" '),
            ('<a:effectLst><a:softEdge rad="64800"></a:softEdge></a:effectLst></pic:spPr>',
             '<a:effectLst><a:softEdge rad="64800"></a:softEdge></a:effectLst><a:scene3d><a:camera prst="orthographicFront"/>'
             '<a:lightRig rig="threePt" dir="t"/></a:scene3d><a:sp3d><a:bevelT w="76200" h="25400" prst="circle"/></a:sp3d></pic:spPr>'),
            # A HYPERLINK field with a ScreenTip.
            ('<w:t>A HYPERLINK field: FIELD_HERE.</w:t></w:r>', '<w:t xml:space="preserve">A HYPERLINK field: </w:t></w:r>' + FIELD_65),
            # The oval hidden and marked decorative (Selection Pane, Alt Text).
            ('<wp:docPr id="10" name="Hidden Shape 6"></wp:docPr>',
             '<wp:docPr id="10" name="Hidden Shape 6" hidden="1"><a:extLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
             '<a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"><adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/>'
             '</a:ext></a:extLst></wp:docPr>'),
        ],
    },
    "provisional-63-style-sets-properties.docx": {
        "word/document.xml": [
            ('<w:u w:val="single"/>', '<w:u w:val="words"/>'),
            ('<w:r><w:rPr></w:rPr><w:t>, company: COMPANY.</w:t></w:r>',
             '<w:r><w:rPr></w:rPr><w:t xml:space="preserve">, company: </w:t></w:r>'
             '<w:fldSimple w:instr=" DOCPROPERTY Company \\* MERGEFORMAT "><w:r><w:t>ACME Corp</w:t></w:r></w:fldSimple>'
             '<w:r><w:t>.</w:t></w:r>'),
        ],
        "docProps/app.xml": [("<Template></Template>", "<Template></Template><Company>ACME Corp</Company>")],
    },
}

# File 67 (P9-W6): what LibreOffice cannot export – formatted comment text with an @mention (a hyperlink in the
# Mention style, people.xml), a comment inside a footnote, a custom continuation separator, STYLEREF / SECTIONPAGES in
# the header, SEQ with \c and \s, a locked DATE field, a bookmark and a REF with \p.
PEOPLE_67 = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w15:people xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" '
    'mc:Ignorable="w15"><w15:person w15:author="Anna Berg"><w15:presenceInfo w15:providerId="None" w15:userId="Anna Berg"/></w15:person>'
    '<w15:person w15:author="Ben Cole"><w15:presenceInfo w15:providerId="AD" w15:userId="ben.cole@example.com"/></w15:person></w15:people>'
)
COMMENT_RELS_67 = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rIdM1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" '
    'Target="mailto:ben.cole@example.com" TargetMode="External"/></Relationships>'
)
ADD_PARTS = {
    "provisional-67-comments-notes-fields-2.docx": {
        "word/people.xml": PEOPLE_67,
        "word/_rels/comments.xml.rels": COMMENT_RELS_67,
    },
}
_FS = lambda instr, cached, extra="": f'<w:fldSimple w:instr=" {instr.replace(chr(34), "&quot;")} "{extra}><w:r><w:t>{cached}</w:t></w:r></w:fldSimple>'
PART_PATCHES["provisional-67-comments-notes-fields-2.docx"] = {
    "word/comments.xml": [
        ('<w:t>Please CHECK_HERE this, MENTION_HERE</w:t></w:r>',
         '<w:t xml:space="preserve">Please </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>check</w:t></w:r><w:r>'
         '<w:t xml:space="preserve"> this, </w:t></w:r><w:hyperlink r:id="rIdM1"><w:r><w:rPr><w:rStyle w:val="Mention"/></w:rPr>'
         '<w:t>@Ben Cole</w:t></w:r></w:hyperlink>'),
        ('</w:comments>',
         '<w:comment w:id="3" w:author="Ben Cole" w:date="2026-10-17T09:00:00Z" w:initials="BC"><w:p w14:paraId="04000000"><w:r>'
         '<w:t>Comment inside the note.</w:t></w:r></w:p></w:comment></w:comments>'),
    ],
    "word/footnotes.xml": [
        ('<w:r><w:continuationSeparator/></w:r>', '<w:r><w:t>Continued from the previous page</w:t></w:r>'),
        # The range only: LibreOffice 25.2 cannot load a w:commentReference inside a note (Word writes one).
        ('<w:r><w:rPr></w:rPr><w:t>commented</w:t></w:r>',
         '<w:commentRangeStart w:id="3"/><w:r><w:rPr></w:rPr><w:t>commented</w:t></w:r><w:commentRangeEnd w:id="3"/>'),
    ],
    "word/header1.xml": [
        ('<w:t xml:space="preserve">Chapter: STYLEREF_HERE – page </w:t></w:r>',
         '<w:t xml:space="preserve">Chapter: </w:t></w:r>' + _FS('STYLEREF "Heading 1"', "Methods") + '<w:r><w:t xml:space="preserve"> – page </w:t></w:r>'),
        ('<w:t xml:space="preserve"> of SECTIONPAGES_HERE</w:t></w:r>',
         '<w:t xml:space="preserve"> of </w:t></w:r>' + _FS("SECTIONPAGES", "1")),
    ],
    "word/document.xml": [
        ('<w:t xml:space="preserve"> text. BOOKMARK_HERE</w:t></w:r>',
         '<w:t xml:space="preserve"> text. </w:t></w:r><w:bookmarkStart w:id="0" w:name="Target"/><w:r><w:t>Target text</w:t></w:r>'
         '<w:bookmarkEnd w:id="0"/>'),
        ('<w:t>Figure SEQ_HERE shows the setup; it is still figure SEQC_HERE. Locked date: LOCKED_HERE. See REFP_HERE.</w:t></w:r>',
         '<w:t xml:space="preserve">Figure </w:t></w:r>' + _FS("SEQ Figure \\* ARABIC \\s 1", "1")
         + '<w:r><w:t xml:space="preserve"> shows the setup; it is still figure </w:t></w:r>' + _FS("SEQ Figure \\* ARABIC \\c", "1")
         + '<w:r><w:t xml:space="preserve">. Locked date: </w:t></w:r>' + _FS('DATE \\@ "d.M.yyyy"', "1.1.2020", ' w:fldLock="1"')
         + '<w:r><w:t xml:space="preserve">. See </w:t></w:r>' + _FS("REF Target \\p \\h", "above") + '<w:r><w:t>.</w:t></w:r>'),
    ],
    "word/_rels/document.xml.rels": [
        ('</Relationships>', '<Relationship Id="rIdP1" Type="http://schemas.microsoft.com/office/2011/relationships/people" Target="people.xml"/></Relationships>'),
    ],
    "[Content_Types].xml": [
        ('</Types>', '<Override PartName="/word/people.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/></Types>'),
    ],
    "word/styles.xml": [
        ('</w:styles>',
         '<w:style w:type="character" w:styleId="Mention"><w:name w:val="Mention"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/>'
         '<w:rPr><w:color w:val="2B579A"/></w:rPr></w:style></w:styles>'),
    ],
}


def patch(docxdir):
    for name, parts in PART_PATCHES.items():
        path = Path(docxdir) / name
        if not path.exists():
            continue
        with zipfile.ZipFile(path) as z:
            items = [(i, z.read(i.filename)) for i in z.infolist()]
        out = []
        for info, data in items:
            for old, new in parts.get(info.filename, []):
                xml = data.decode("utf-8")
                if old not in xml:
                    raise SystemExit(f"{name}: {old!r} not found in {info.filename}")
                data = xml.replace(old, new, 1).encode("utf-8")
            out.append((info, data))
        # Parts LibreOffice does not write at all (P9-W6: people.xml, the comments' relationships).
        for part, xml in ADD_PARTS.get(name, {}).items():
            out.append((zipfile.ZipInfo(part, date_time=out[0][0].date_time), xml.encode("utf-8")))
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            for info, data in out:
                z.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED)
        print(f"patched {name}")
    for name, edits in STYLE_PATCHES.items():
        path = Path(docxdir) / name
        if not path.exists():  # converting only some topics
            continue
        with zipfile.ZipFile(path) as z:
            items = [(i, z.read(i.filename)) for i in z.infolist()]
        out = []
        for info, data in items:
            if info.filename == "word/styles.xml":
                xml = data.decode("utf-8")
                for old, new in edits:
                    if old not in xml:
                        raise SystemExit(f"{name}: {old!r} not found in styles.xml")
                    xml = xml.replace(old, new, 1)
                data = xml.encode("utf-8")
            out.append((info, data))
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            for info, data in out:
                z.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED)
        print(f"patched {name}")


RUN_XML = {
    "run:small-caps": "<w:smallCaps/>", "run:all-caps": "<w:caps/>", "run:spacing": "<w:spacing w:val=",
    "run:scale": "<w:w w:val=", "run:double-strike": "<w:dstrike/>", "run:outline": "<w:outline/>",
    "run:shadow": "<w:shadow/>", "run:emboss": "<w:emboss/>", "run:imprint": "<w:imprint/>", "run:hidden": "<w:vanish/>",
    "run:words-underline": '<w:u w:val="words"/>',
}


TABLE2_XML = {
    "table:floating": "<w:tblpPr ", "table:layout-fixed": '<w:tblLayout w:type="fixed"/>', "table:look": "<w:tblLook ",
    "section:columns-unequal": "<w:col w:w=", "char:no-break-hyphen": "<w:noBreakHyphen/>",
    "char:soft-hyphen": "<w:softHyphen/>", "char:nbsp": "\u00a0", "para:tab=bar": 'w:val="bar"',
}


DRAWING_XML = {
    "drawing:group": "<wpg:wgp>", "drawing:linked-textbox": "<wps:linkedTxbx ", "drawing:canvas": "<wpc:wpc",
    "image:link": "<a:hlinkClick ", "image:soft-edge": "<a:softEdge ", "drawing:hidden": 'hidden="1"',
    "image:wrap-both-sides": 'wrapText="bothSides"',
}


# File 67 (P9-W6): feature → (part, text it must contain).
W6_XML = {
    "comment:formatted": ("word/comments.xml", "<w:b/>"), "comment:mention": ("word/comments.xml", '<w:rStyle w:val="Mention"/>'),
    "comment:in-note": ("word/footnotes.xml", "<w:commentRangeStart "), "people": ("word/people.xml", "<w15:presenceInfo "),
    "note:separator-text": ("word/footnotes.xml", "Continued from the previous page"),
    "field:styleref": ("word/header1.xml", "STYLEREF &quot;Heading 1&quot;"), "field:sectionpages": ("word/header1.xml", " SECTIONPAGES "),
    "field:seq-switches": ("word/document.xml", "\\c "), "field:locked": ("word/document.xml", 'w:fldLock="1"'),
    "field:ref-switches": ("word/document.xml", "REF Target \\p \\h"), "field:page": ("word/header1.xml", " PAGE "),
}


def check(manifest_path, docxdir):
    """Structural sanity checks of converted files vs. manifest. Returns number of failures."""
    fails = 0
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    for e in manifest:
        f = Path(docxdir) / e["file"]
        errs = []
        try:
            with zipfile.ZipFile(f) as z:
                doc = z.read("word/document.xml").decode("utf-8")
        except Exception as ex:  # noqa: BLE001
            print(f"FAIL {e['file']}: {ex}")
            fails += 1
            continue
        for ft in e["features"]:
            if ft.startswith("heading:"):
                lv = ft.split(":")[1]
                if not re.search(rf'w:pStyle w:val="Heading{lv}"', doc):
                    errs.append(f"{ft} not found")
            elif ft == "title" and 'w:pStyle w:val="Title"' not in doc:
                errs.append("title not found")
            elif ft.startswith("image:count="):
                # Pictures only (shapes, groups and canvases are drawings too).
                want = int(ft.split("=")[1])
                if doc.count("<pic:pic") != want:
                    errs.append(f"{ft}: found {doc.count('<pic:pic')}")
            elif ft.startswith("table:rows="):
                m = re.match(r"table:rows=(\d+):cols=(\d+)", ft)
                if doc.count("<w:tr>") + doc.count("<w:tr ") < int(m.group(1)):
                    errs.append(f"{ft}: too few rows")
                if "<w:tbl>" not in doc:
                    errs.append(f"{ft}: no table")
            elif ft.startswith("list:") and "<w:numPr>" not in doc:
                errs.append(f"{ft}: no numPr")
            elif ft == "page:landscape" and 'w:orient="landscape"' not in doc:
                errs.append("landscape not found")
            elif ft == "page:letter" and 'w:w="12240"' not in doc:
                errs.append("letter size not found")
            elif ft == "page:a4" and 'w:w="11906"' not in doc and 'w:w="16838"' not in doc:
                errs.append("a4 size not found")
            elif ft == "break:page" and 'w:pageBreakBefore' not in doc and 'w:type="page"' not in doc:
                errs.append("page break not found")
            elif ft == "break:line" and "<w:br" not in doc:
                errs.append("line break not found")
            elif ft == "tab" and "<w:tab/>" not in doc:
                errs.append("tab not found")
            elif ft == "table:merged=horizontal" and "<w:gridSpan" not in doc:
                errs.append("gridSpan not found")
            elif ft == "table:merged=vertical" and "<w:vMerge" not in doc:
                errs.append("vMerge not found")
            elif ft.startswith("image:float=") and "<wp:anchor" not in doc:
                errs.append("wp:anchor not found")
            elif ft == "para:border" and "<w:pBdr>" not in doc:
                errs.append("pBdr not found")
            elif ft.startswith("para:tab=") and "<w:tabs>" not in doc:
                errs.append("tabs not found")
            elif ft == "style:custom-character" and "<w:rStyle " not in doc:
                errs.append("rStyle not found")
            elif ft.startswith("comment:count="):
                with zipfile.ZipFile(f) as z:
                    comments = z.read("word/comments.xml").decode("utf-8")
                want = int(ft.split("=")[1])
                if comments.count("<w:comment ") != want:
                    errs.append(f"{ft}: found {comments.count('<w:comment ')}")
                if "<w:commentRangeStart" not in doc:
                    errs.append("commentRangeStart not found")
            elif ft in ("comment:reply", "comment:resolved"):
                with zipfile.ZipFile(f) as z:
                    ext = z.read("word/commentsExtended.xml").decode("utf-8")
                if ft == "comment:reply" and "paraIdParent" not in ext:
                    errs.append("paraIdParent not found")
                if ft == "comment:resolved" and 'w15:done="1"' not in ext:
                    errs.append("w15:done not found")
            elif ft.startswith("link:") or ft.startswith("props:"):
                with zipfile.ZipFile(f) as z:
                    rels = z.read("word/_rels/document.xml.rels").decode("utf-8")
                    core = z.read("docProps/core.xml").decode("utf-8")
                want = {
                    "link:url": ("<w:hyperlink r:id=" in doc and 'Target="http' in rels),
                    "link:email": 'Target="mailto:' in rels,
                    "link:bookmark": "<w:hyperlink w:anchor=" in doc,
                    "props:title": "<dc:title>" in core,
                    "props:subject": "<dc:subject>" in core,
                    "props:author": "<dc:creator>" in core,
                    "props:keywords": "<cp:keywords>" in core,
                }.get(ft, True)
                if not want:
                    errs.append(f"{ft} not found")
            elif ft.startswith("bookmark:count="):
                names = [n for n in re.findall(r'<w:bookmarkStart [^>]*w:name="([^"]*)"', doc) if not n.startswith("_")]
                if len(names) != int(ft.split("=")[1]):
                    errs.append(f"{ft}: found {len(names)}")
            elif ft in ("field:ref", "field:pageref") or ft.startswith("field:seq="):
                instr = {"field:ref": " REF ", "field:pageref": " PAGEREF "}.get(ft) or f" SEQ {ft.split('=')[1]} "
                if instr not in doc:
                    errs.append(f"{ft} not found")
            elif ft.startswith("section:columns="):
                if f'w:num="{ft.split("=")[1]}"' not in doc:
                    errs.append(f"{ft} not found")
            elif ft == "section:column-separator" and not re.search(r'w:sep="(true|1)"', doc):
                errs.append("column separator not found")
            elif ft == "break:column" and 'w:type="column"' not in doc:
                errs.append("column break not found")
            elif ft.startswith("drawing:shape="):
                if f'prst="{ft.split("=")[1]}"' not in doc or "<wps:wsp" not in doc:
                    errs.append(f"{ft} not found")
            elif ft in DRAWING_XML and DRAWING_XML[ft] not in doc:
                errs.append(f"{ft} not found")
            elif ft in W6_XML:
                part, needle = W6_XML[ft]
                with zipfile.ZipFile(f) as z:
                    text = z.read(part).decode("utf-8") if part in z.namelist() else ""
                if needle not in text:
                    errs.append(f"{ft} not found in {part}")
            elif ft in TABLE2_XML and TABLE2_XML[ft] not in doc:
                errs.append(f"{ft} not found")
            elif ft == "drawing:textbox" and "<w:txbxContent>" not in doc:
                errs.append("txbxContent not found")
            elif ft.startswith("drawing:float=") and "<wp:anchor" not in doc:
                errs.append("wp:anchor not found")
            elif ft == "template":
                with zipfile.ZipFile(f) as z:
                    types = z.read("[Content_Types].xml").decode("utf-8")
                if "wordprocessingml.template.main+xml" not in types:
                    errs.append("template content type not found")
            elif ft.startswith("field:") and ft not in ("field:ref", "field:pageref") and not ft.startswith("field:seq="):
                instr = {"field:docproperty=company": "DOCPROPERTY Company"}.get(ft, ft.split(":")[1].upper())
                if instr not in doc:
                    errs.append(f"{ft} not found")
            elif ft == "props:company":
                with zipfile.ZipFile(f) as z:
                    if "<Company>" not in z.read("docProps/app.xml").decode("utf-8"):
                        errs.append("Company not found")
            elif ft.startswith("style:") and ft in ("style:shading", "style:bottom-rule"):
                with zipfile.ZipFile(f) as z:
                    styles = z.read("word/styles.xml").decode("utf-8")
                if ("<w:shd " if ft == "style:shading" else "<w:pBdr>") not in styles:
                    errs.append(f"{ft} not found")
            elif ft.startswith("run:") and ft.split("=")[0] in RUN_XML and RUN_XML[ft.split("=")[0]] not in doc:
                errs.append(f"{ft} not found")
        n = len(re.findall(r"<w:p[ >]", doc))
        if n < e["paragraphs"]:
            errs.append(f"paragraphs: manifest {e['paragraphs']}, docx {n}")
        if errs:
            fails += 1
            print(f"FAIL {e['file']}: " + "; ".join(errs))
    return fails


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "emit":
        emit(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == "patch":
        patch(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] == "check":
        sys.exit(1 if check(sys.argv[2], sys.argv[3]) else 0)
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
