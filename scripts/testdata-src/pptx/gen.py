"""Generator for the PROVISIONAL pptx reference suite (25 decks).

Emits one flat ODP (.fodp) per topic plus manifest.json. Conversion to .pptx is done by
scripts/gen-pptx-suite.sh with headless LibreOffice. Python stdlib only; run with `python3 -I`.

  gen.py emit OUTDIR PNGDIR      write OUTDIR/*.fodp and OUTDIR/manifest.json
  gen.py check MANIFEST PPTXDIR  structural checks of the converted .pptx files against the manifest
"""
import base64
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

NS = (
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
    'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
    'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
    'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
    'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
    'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" '
    'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" '
    'office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.presentation"'
)
SIZES = {"16x9": (28.0, 15.75), "4x3": (25.4, 19.05)}
IMAGES = {}


class X(str):
    """Raw (already escaped) XML fragment."""


def esc(v):
    return v if isinstance(v, X) else escape(v)


class Deck:
    def __init__(self, n, slug, topic, size="16x9", bg=None):
        self.n, self.slug, self.topic, self.size = n, slug, topic, size
        self.w, self.h = SIZES[size]
        self.styles = {}
        self.names = {}
        self.slides = []  # list of (xml-list, bgstyle)
        self.cur = None
        self.layouts = []
        self.counts = {}
        self.feats = []
        self.imgs = 0
        self.deck_bg = bg

    @property
    def file(self):
        return f"provisional-{self.n:02d}-{self.slug}.pptx"

    def feat(self, f):
        if f not in self.feats:
            self.feats.append(f)

    def count(self, k, n=1):
        self.counts[k] = self.counts.get(k, 0) + n

    def style(self, family, xml, prefix):
        key = (family, xml)
        if key not in self.names:
            name = f"{prefix}{len(self.names) + 1}"
            self.names[key] = name
            self.styles[name] = f'<style:style style:name="{name}" style:family="{family}">{xml}</style:style>'
        return self.names[key]

    # ---- slides ----
    def slide(self, layout, bg=None):
        self.cur = []
        st = None
        if bg:
            st = self.style("drawing-page", f'<style:drawing-page-properties draw:fill="solid" draw:fill-color="#{bg}"/>', "dp")
            self.feat("background:solid")
        self.slides.append((self.cur, st))
        self.layouts.append(layout)

    def add(self, xml):
        self.cur.append(xml)

    # ---- text ----
    def run(self, text, b=False, i=False, u=False, font=None, size=None, color=None):
        a = []
        if b:
            a.append('fo:font-weight="bold"'); self.feat("text:bold")
        if i:
            a.append('fo:font-style="italic"'); self.feat("text:italic")
        if u:
            a.append('style:text-underline-style="solid" style:text-underline-width="auto" '
                     'style:text-underline-color="font-color"'); self.feat("text:underline")
        if font:
            a.append(f'fo:font-family="{font}" style:font-family-generic="swiss"'); self.feat("text:font")
        if size:
            a.append(f'fo:font-size="{size}pt"'); self.feat("text:size")
        if color:
            a.append(f'fo:color="#{color}"'); self.feat("text:color")
        nm = self.style("text", f'<style:text-properties {" ".join(a)}/>', "T")
        return X(f'<text:span text:style-name="{nm}">{esc(text)}</text:span>')

    def para(self, content, align=None):
        body = "".join(esc(c) for c in content) if isinstance(content, (list, tuple)) else esc(content)
        if align:
            fo = {"left": "start", "center": "center", "right": "end"}[align]
            nm = self.style("paragraph", f'<style:paragraph-properties fo:text-align="{fo}"/>', "P")
            self.feat(f"text:align:{align}")
            return f'<text:p text:style-name="{nm}">{body}</text:p>'
        return f"<text:p>{body}</text:p>"

    def paras(self, items):
        return "".join(self.para(i) if not isinstance(i, X) else i for i in items)

    # ---- graphic styles ----
    def gstyle(self, fill=None, line=None, lw=None, dash=None, anchor=None, extra=""):
        a = []
        if fill:
            a.append(f'draw:fill="solid" draw:fill-color="#{fill}"'); self.feat("fill:solid")
        else:
            a.append('draw:fill="none"')
        if line:
            a.append(f'draw:stroke="{"dash" if dash else "solid"}" svg:stroke-color="#{line}"')
            if lw:
                a.append(f'svg:stroke-width="{lw}cm"')
            if dash:
                a.append('draw:stroke-dash="Dash"'); self.feat("line:dash")
        else:
            a.append('draw:stroke="none"')
        if anchor:
            a.append(f'draw:textarea-vertical-align="{anchor}"'); self.feat(f"text:anchor:{anchor}")
        return self.style("graphic", f'<style:graphic-properties {" ".join(a)} {extra or "draw:auto-grow-height=" + chr(34) + "false" + chr(34) + " draw:auto-grow-width=" + chr(34) + "false" + chr(34)}/>', "G")

    # ---- placeholders ----
    def title(self, text, x=2.0, y=1.0, w=None, h=2.5, cls="title"):
        w = w or self.w - 4
        size = 40 if cls == "title" else 36
        self.add(f'<draw:frame presentation:style-name="pres-title" presentation:class="{cls}" '
                 f'svg:x="{x}cm" svg:y="{y}cm" svg:width="{w}cm" svg:height="{h}cm">'
                 f"<draw:text-box>{self.para(text)}</draw:text-box></draw:frame>")

    def subtitle(self, text, y=8.0):
        self.add(f'<draw:frame presentation:style-name="pres-sub" presentation:class="subtitle" '
                 f'svg:x="2cm" svg:y="{y}cm" svg:width="{self.w - 4}cm" svg:height="2cm">'
                 f"<draw:text-box>{self.para(text)}</draw:text-box></draw:frame>")

    def outline(self, items, numbered=False, y=4.0, h=None):
        """items: list of (level, text); level starts at 1."""
        h = h or self.h - y - 1.5
        ls = "LN" if numbered else "LB"
        if numbered:
            self.feat("numbered")
        else:
            self.feat(f"bullets:levels={max(l for l, _ in items)}")
        out, depth = "", 0
        for lv, t in items:
            if lv > depth:  # levels only ever go one deeper at a time
                out += f'<text:list text:style-name="{ls}">' if depth == 0 else "<text:list>"
                out += "<text:list-item>"
                depth += 1
            else:
                while depth > lv:
                    out += "</text:list-item></text:list>"
                    depth -= 1
                out += "</text:list-item><text:list-item>"
            out += f"<text:p>{esc(t)}</text:p>"
        out += "</text:list-item></text:list>" * depth
        self.add(f'<draw:frame presentation:style-name="pres-outline" presentation:class="outline" '
                 f'svg:x="2cm" svg:y="{y}cm" svg:width="{self.w - 4}cm" svg:height="{h}cm">'
                 f"<draw:text-box>{out}</draw:text-box></draw:frame>")

    # ---- shapes ----
    def xform(self, x, y, w, h, rot=None, flip=None):
        a = f'svg:x="{x}cm" svg:y="{y}cm" svg:width="{w}cm" svg:height="{h}cm"'
        if rot:
            import math
            r = math.radians(rot)
            cx, cy = x + w / 2, y + h / 2
            # ODF: rotate(a) translate(t) maps p to R(a)*(p + t), R counter-clockwise on screen.
            # Keep the shape centre at (cx, cy):  t = R^-1 * c - (w/2, h/2)
            ox = cx * math.cos(r) - cy * math.sin(r) - w / 2
            oy = cx * math.sin(r) + cy * math.cos(r) - h / 2
            a = (f'svg:width="{w}cm" svg:height="{h}cm" '
                 f'draw:transform="rotate ({r:.5f}) translate ({ox:.3f}cm {oy:.3f}cm)"')
            self.feat("rotation")
        return a

    GEOM = {
        "rect": ("rectangle", "M 0 0 L 21600 0 21600 21600 0 21600 0 0 Z N", ""),
        "roundRect": ("round-rectangle", "M 3590 0 X 0 3590 L 0 18010 Y 3590 21600 L 18010 21600 X 21600 18010 L 21600 3590 Y 18010 0 Z N", ""),
        "ellipse": ("ellipse", "U 10800 10800 10800 10800 0 360 Z N", ""),
        "rightArrow": ("right-arrow", "M 0 6350 L 14500 6350 14500 0 21600 10800 14500 21600 14500 15250 0 15250 Z N", ""),
    }

    def shape(self, kind, x, y, w, h, text=None, fill=None, line=None, lw=None, dash=False, anchor=None,
              rot=None, flip=False, align=None, content=None, tag=True):
        gtype, path, _ = self.GEOM[kind]
        st = self.gstyle(fill, line, lw, dash, anchor)
        mir = ' draw:mirror-horizontal="true"' if flip else ""
        if flip:
            self.feat("flip")
        if tag:
            self.feat(f"shape:{kind}")
            self.count(kind)
        if content is None:
            content = self.para(text, align) if text is not None else ""
        return (f'<draw:custom-shape draw:style-name="{st}" {self.xform(x, y, w, h, rot)}>{content}'
                f'<draw:enhanced-geometry draw:type="{gtype}" svg:viewBox="0 0 21600 21600" '
                f'draw:enhanced-path="{path}"{mir}/></draw:custom-shape>')

    def add_shape(self, *a, **k):
        self.add(self.shape(*a, **k))

    def line(self, x1, y1, x2, y2, color="204a87", lw=0.1):
        st = self.gstyle(None, color, lw)
        self.feat("shape:line"); self.count("line")
        self.add(f'<draw:line draw:style-name="{st}" svg:x1="{x1}cm" svg:y1="{y1}cm" svg:x2="{x2}cm" svg:y2="{y2}cm"/>')

    def textbox(self, x, y, w, h, content, fill=None, anchor=None):
        st = self.gstyle(fill, None, None, False, anchor, 'draw:auto-grow-height="false"')
        self.feat("shape:textBox"); self.count("textBox")
        if isinstance(content, str) and not content.startswith("<text:"):
            content = self.para(content)
        self.add(f'<draw:frame draw:style-name="{st}" svg:x="{x}cm" svg:y="{y}cm" svg:width="{w}cm" svg:height="{h}cm">'
                 f"<draw:text-box>{content}</draw:text-box></draw:frame>")

    def picture(self, k, x, y, w, h):
        self.imgs += 1
        self.feat("picture"); self.count("picture")
        data = base64.b64encode(IMAGES[k]).decode()
        self.add(f'<draw:frame draw:style-name="{self.gstyle()}" draw:name="Image{self.imgs}" svg:x="{x}cm" svg:y="{y}cm" '
                 f'svg:width="{w}cm" svg:height="{h}cm"><draw:image><office:binary-data>{data}'
                 f"</office:binary-data></draw:image></draw:frame>")

    def group(self, inner):
        self.feat("group"); self.count("group")
        self.add("<draw:g>" + "".join(inner) + "</draw:g>")

    # ---- output ----
    def fodp(self):
        w, h = self.w, self.h
        pages = []
        for i, (els, bgst) in enumerate(self.slides, 1):
            st = bgst or "dp0"
            pages.append(f'<draw:page draw:name="Slide{i}" draw:style-name="{st}" draw:master-page-name="Default">'
                         + "".join(els) + "</draw:page>")
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<office:document {NS}>
<office:styles>
<style:style style:name="Default" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none"/></style:style>
<style:style style:name="pres-title" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:text-properties fo:font-size="40pt" fo:font-weight="bold"/></style:style>
<style:style style:name="pres-sub" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:text-properties fo:font-size="24pt"/></style:style>
<style:style style:name="pres-outline" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:text-properties fo:font-size="28pt"/></style:style>
</office:styles>
<office:automatic-styles>
<style:page-layout style:name="PL"><style:page-layout-properties fo:page-width="{w}cm" fo:page-height="{h}cm" style:print-orientation="landscape"/></style:page-layout>
<style:style style:name="dp0" style:family="drawing-page"><style:drawing-page-properties presentation:background-visible="true" presentation:background-objects-visible="true"/></style:style>
{"".join(self.styles.values())}
<text:list-style style:name="LB"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:min-label-width="0.6cm"/></text:list-level-style-bullet><text:list-level-style-bullet text:level="2" text:bullet-char="–"><style:list-level-properties text:space-before="0.8cm" text:min-label-width="0.6cm"/></text:list-level-style-bullet><text:list-level-style-bullet text:level="3" text:bullet-char="▪"><style:list-level-properties text:space-before="1.6cm" text:min-label-width="0.6cm"/></text:list-level-style-bullet></text:list-style>
<text:list-style style:name="LN"><text:list-level-style-number text:level="1" style:num-suffix="." style:num-format="1"><style:list-level-properties text:min-label-width="0.8cm"/></text:list-level-style-number></text:list-style>
</office:automatic-styles>
<office:master-styles>
<style:master-page style:name="Default" style:page-layout-name="PL" draw:style-name="dp0"/>
</office:master-styles>
<office:body><office:presentation>
{"".join(pages)}
</office:presentation></office:body></office:document>
"""

    def manifest_entry(self):
        feats = [f"slides:{len(self.slides)}"]
        for l in dict.fromkeys(self.layouts):
            feats.append(f"layout:{l}")
        feats.append(f"size:{self.size}")
        for f in self.feats:
            if f.startswith("shape:") or f in ("picture", "group"):
                k = f.split(":")[-1]
                feats.append(f"{f}:count={self.counts[k]}")
            elif f.startswith("bullets:"):
                feats.append(f)
            else:
                feats.append(f)
        return {"file": self.file, "topic": self.topic, "features": feats}


# ---------------------------------------------------------------- topics
BLUE, RED, GREEN, YELLOW, GREY = "3465a4", "cc0000", "4e9a06", "fce94f", "888a85"


def d01():
    d = Deck(1, "single-title-slide", "One slide with a title only")
    d.slide("title"); d.title("Single Title Slide", y=6.0, cls="title")
    return d


def d02():
    d = Deck(2, "title-subtitle", "Title slide with subtitle")
    d.slide("title"); d.title("Quarterly Review", y=4.0); d.subtitle("Prepared by the Rusuite team")
    return d


def d03():
    d = Deck(3, "title-content-3-bullets", "Title and content with three bullets")
    d.slide("titleContent"); d.title("Three Points", cls="title")
    d.outline([(1, "First point"), (1, "Second point"), (1, "Third point")])
    return d


def d04():
    d = Deck(4, "bullets-3-levels", "Bullets nested three levels deep")
    d.slide("titleContent"); d.title("Nested Bullets")
    d.outline([(1, "Level one A"), (2, "Level two A"), (3, "Level three A"), (3, "Level three B"),
               (2, "Level two B"), (1, "Level one B"), (2, "Level two C")])
    return d


def d05():
    d = Deck(5, "numbered-list", "Numbered list in the content placeholder")
    d.slide("titleContent"); d.title("Steps")
    d.outline([(1, "Open the file"), (1, "Edit the slide"), (1, "Save the deck"), (1, "Share it")], numbered=True)
    return d


def d06():
    d = Deck(6, "blank-rectangle", "Blank slide with one rectangle")
    d.slide("blank"); d.add_shape("rect", 6, 4, 16, 7, text="Rectangle", fill=BLUE)
    return d


def d07():
    d = Deck(7, "ellipse", "Blank slide with an ellipse")
    d.slide("blank"); d.add_shape("ellipse", 6, 3.5, 16, 8, text="Ellipse", fill=RED)
    return d


def d08():
    d = Deck(8, "line", "Blank slide with a line")
    d.slide("blank"); d.line(4, 3, 24, 12, "204a87", 0.15)
    return d


def d09():
    d = Deck(9, "rounded-rectangle", "Blank slide with a rounded rectangle")
    d.slide("blank"); d.add_shape("roundRect", 6, 4, 16, 7, text="Rounded", fill=GREEN)
    return d


def d10():
    d = Deck(10, "text-box", "Free text box on a blank slide")
    d.slide("blank")
    d.textbox(3, 3, 22, 3, "A free-standing text box")
    d.textbox(3, 7, 22, 4, d.paras(["Second paragraph in a box", "and a third line"]))
    return d


def d11():
    d = Deck(11, "fill-colour", "Shapes with solid fill colours")
    d.slide("blank")
    for i, c in enumerate(["cc0000", "4e9a06", "3465a4", "fce94f"]):
        d.add_shape("rect", 1.5 + i * 6.5, 5, 5.5, 5, text=f"#{c}", fill=c)
    return d


def d12():
    d = Deck(12, "outline-width-colour-dash", "Shapes with outline width, colour and dash")
    d.slide("blank")
    d.add_shape("rect", 2, 3, 7, 4, text="0.05 cm", fill="eeeeec", line="cc0000", lw=0.05)
    d.add_shape("rect", 10.5, 3, 7, 4, text="0.3 cm", fill="eeeeec", line="3465a4", lw=0.3)
    d.add_shape("rect", 19, 3, 7, 4, text="dashed", fill="eeeeec", line="4e9a06", lw=0.15, dash=True)
    d.add_shape("ellipse", 8, 9, 12, 5, text="dashed ellipse", line="204a87", lw=0.2, dash=True)
    return d


def d13():
    d = Deck(13, "text-formatting", "Bold, italic, underline, colour, size, font in shapes")
    d.slide("blank")
    r = d.run
    d.textbox(2, 1, 24, 2, d.para([r("Bold", b=True), " ", r("Italic", i=True), " ", r("Underline", u=True)]))
    d.textbox(2, 3.5, 24, 2, d.para([r("Red text", color="cc0000"), " and ", r("blue text", color="3465a4")]))
    d.textbox(2, 6, 24, 3, d.para([r("Small", size=12), " ", r("Medium", size=24), " ", r("Large", size=36)]))
    d.textbox(2, 9.5, 24, 2, d.para([r("Serif", font="Liberation Serif"), " ", r("Mono", font="Liberation Mono"),
                                      " ", r("Sans", font="Liberation Sans")]))
    d.add_shape("rect", 2, 12, 24, 2.5, fill="eeeeec",
                content=d.para([r("All in a shape: ", b=True, i=True, u=True, color="4e9a06", size=20, font="Liberation Serif")]))
    return d


def d14():
    d = Deck(14, "alignment-anchor", "Horizontal alignment and vertical anchor")
    d.slide("blank")
    for i, a in enumerate(["left", "center", "right"]):
        d.add_shape("rect", 1.5 + i * 8.7, 1.5, 8, 3, text=f"Align {a}", fill="eeeeec", line=GREY, lw=0.05, align=a)
    for i, an in enumerate(["top", "middle", "bottom"]):
        d.add_shape("rect", 1.5 + i * 8.7, 6.5, 8, 6, text=f"Anchor {an}", fill="eeeeec", line=GREY, lw=0.05,
                    anchor=an, align="center")
    return d


def d15():
    d = Deck(15, "image", "One small PNG picture")
    d.slide("blank"); d.picture("img0", 9, 3, 10, 10)
    return d


def d16():
    d = Deck(16, "two-images", "Two pictures side by side")
    d.slide("blank"); d.picture("img1", 3, 3.5, 9, 9); d.picture("img2", 16, 3.5, 9, 9)
    return d


def d17():
    d = Deck(17, "group", "Group of a rectangle and an ellipse")
    d.slide("blank")
    d.group([d.shape("rect", 5, 4, 10, 6, text="Rect", fill=BLUE), d.shape("ellipse", 12, 7, 10, 6, text="Ellipse", fill=RED)])
    return d


def d18():
    d = Deck(18, "z-order", "Overlapping shapes, later shapes on top")
    d.slide("blank")
    d.add_shape("rect", 5, 3, 12, 8, text="Back", fill=BLUE)
    d.add_shape("ellipse", 9, 5, 12, 8, text="Middle", fill=RED)
    d.add_shape("roundRect", 13, 7, 10, 6, text="Front", fill=YELLOW)
    return d


def d19():
    d = Deck(19, "rotation", "Rectangle rotated by 30 degrees")
    d.slide("blank"); d.add_shape("rect", 8, 5, 12, 5, text="Rotated 30", fill=GREEN, rot=30)
    return d


def d20():
    d = Deck(20, "flip", "Right arrow flipped horizontally")
    d.slide("blank")
    d.add_shape("rightArrow", 3, 3, 10, 5, text="Normal", fill=BLUE)
    d.add_shape("rightArrow", 15, 3, 10, 5, text="Flipped", fill=RED, flip=True)
    return d


def d21():
    d = Deck(21, "background-colour", "Slide with a solid background colour")
    d.slide("titleContent", bg="fce94f"); d.title("Yellow Slide")
    d.outline([(1, "Background is solid yellow")])
    return d


def d22():
    d = Deck(22, "ten-slides-mixed", "Ten slides mixing layouts")
    d.slide("title"); d.title("Mixed Deck", y=4); d.subtitle("Ten slides")
    for i in range(2, 6):
        d.slide("titleContent"); d.title(f"Slide {i}")
        d.outline([(1, f"Point {i}.1"), (1, f"Point {i}.2"), (2, f"Detail {i}")])
    for i in range(6, 9):
        d.slide("blank"); d.add_shape("rect", 4, 3, 20, 9, text=f"Slide {i}", fill=["3465a4", "cc0000", "4e9a06"][i - 6])
    d.slide("titleContent"); d.title("Slide 9"); d.outline([(1, "Numbered A"), (1, "Numbered B")], numbered=True)
    d.slide("title"); d.title("The End", y=5); d.subtitle("Thank you")
    return d


def d23():
    d = Deck(23, "unicode", "Umlauts, CJK and emoji text")
    d.slide("titleContent"); d.title("Unicode: Grüße")
    d.outline([(1, "Umlauts: ÄÖÜ äöü ß"), (1, "CJK: 日本語のテキスト 中文 한국어"), (1, "Emoji: 😀 🚀 ✅")])
    d.slide("blank"); d.textbox(3, 4, 22, 6, d.paras(["Ελληνικά — Русский — עברית", "Ünïcödé ✓ € £ ¥ © ®"]))
    d.feat("text:unicode")
    return d


def d24():
    d = Deck(24, "size-4x3", "Standard 4:3 slide size", size="4x3")
    d.slide("title"); d.title("Four by Three", y=6); d.subtitle("Standard 4:3", y=10)
    d.slide("titleContent"); d.title("Content"); d.outline([(1, "Narrower page"), (1, "25.4 x 19.05 cm")])
    return d


def d25():
    d = Deck(25, "pitch-deck", "Pitch deck: title, agenda, three content slides, closing")
    d.slide("title", bg="204a87"); d.title("Rusuite", y=4, cls="title"); d.subtitle("Office suite pitch", y=8)
    d.slide("titleContent"); d.title("Agenda")
    d.outline([(1, "Problem"), (1, "Solution"), (2, "Write, Calc, Show"), (1, "Market"), (1, "Ask")], numbered=False)
    d.slide("blank")
    d.textbox(2, 1, 24, 2.5, d.para([d.run("The Problem", b=True, size=32)]))
    d.add_shape("roundRect", 2, 4.5, 11, 8, text="Costly", fill=RED)
    d.add_shape("roundRect", 15, 4.5, 11, 8, text="Closed", fill=GREY)
    d.slide("blank")
    d.textbox(2, 1, 24, 2.5, d.para([d.run("The Solution", b=True, size=32)]))
    d.picture("img0", 2, 4.5, 8, 8)
    d.textbox(12, 5, 14, 6, d.paras(["Open source", "Rust core", "Runs in the browser"]))
    d.slide("blank")
    d.textbox(2, 1, 24, 2.5, d.para([d.run("The Market", b=True, size=32)]))
    d.add_shape("ellipse", 3, 5, 10, 8, text="Office", fill=BLUE)
    d.add_shape("ellipse", 14, 5, 10, 8, text="Education", fill=GREEN)
    d.line(2, 14, 26, 14, "204a87", 0.1)
    d.slide("title", bg="204a87"); d.title("Thank You", y=5); d.subtitle("questions@example.invalid", y=9)
    return d


TOPICS = [globals()[f"d{n:02d}"] for n in range(1, 26)]


def emit(outdir, pngdir):
    for k in range(3):
        IMAGES[f"img{k}"] = (Path(pngdir) / f"img{k}.png").read_bytes()
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    man = []
    for t in TOPICS:
        d = t()
        (out / d.file.replace(".pptx", ".fodp")).write_text(d.fodp(), encoding="utf-8")
        man.append(d.manifest_entry())
    (out / "manifest.json").write_text(json.dumps(man, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def check(manifest_path, pptxdir):
    fails = 0
    for e in json.loads(Path(manifest_path).read_text(encoding="utf-8")):
        errs = []
        try:
            with zipfile.ZipFile(Path(pptxdir) / e["file"]) as z:
                names = z.namelist()
                slides = sorted(n for n in names if re.fullmatch(r"ppt/slides/slide\d+\.xml", n))
                xml = "".join(z.read(n).decode("utf-8") for n in slides)
                pres = z.read("ppt/presentation.xml").decode("utf-8")
        except Exception as ex:  # noqa: BLE001
            print(f"FAIL {e['file']}: {ex}")
            fails += 1
            continue
        prst = lambda p: len(re.findall(rf'<a:prstGeom prst="{p}"', xml))  # noqa: E731
        for ft in e["features"]:
            if ft.startswith("slides:"):
                if len(slides) != int(ft.split(":")[1]):
                    errs.append(f"{ft}: found {len(slides)}")
            elif ft.startswith("size:"):
                m = re.search(r'<p:sldSz cx="(\d+)" cy="(\d+)"', pres)
                ratio = int(m.group(1)) / int(m.group(2))
                want = 16 / 9 if ft == "size:16x9" else 4 / 3
                if abs(ratio - want) > 0.01:
                    errs.append(f"{ft}: ratio {ratio:.3f}")
            elif ft.startswith("layout:"):
                has_title = bool(re.search(r'<p:ph type="(title|ctrTitle)"', xml))
                has_body = bool(re.search(r'<p:ph(/>| type="(body|subTitle)")', xml)) or "<p:ph idx=" in xml
                if ft == "layout:title" and not has_title:
                    errs.append("title placeholder not found")
                elif ft == "layout:titleContent" and not (has_title and has_body):
                    errs.append("title and body placeholders not found")
                elif ft == "layout:blank" and not any(
                        "<p:ph" not in sl for sl in [z2 for z2 in xml.split("<p:sld ")[1:]]):
                    errs.append("placeholder-free slide not found")
            elif ft.startswith("shape:textBox:count="):
                n = int(ft.split("=")[1])
                if xml.count('txBox="1"') != n:
                    errs.append(f"{ft}: found {xml.count('txBox=\"1\"')}")
            elif ft.startswith("shape:line:count="):
                if prst("line") < int(ft.split("=")[1]):
                    errs.append(f"{ft}: found {prst('line')}")
            elif ft.startswith("shape:"):
                _, k, c = ft.split(":")
                if prst(k) < int(c.split("=")[1]):
                    errs.append(f"{ft}: found {prst(k)}")
            elif ft.startswith("picture:count="):
                if xml.count("<p:pic>") != int(ft.split("=")[1]):
                    errs.append(f"{ft}: found {xml.count('<p:pic>')}")
            elif ft.startswith("group:count="):
                if xml.count("<p:grpSp>") != int(ft.split("=")[1]):
                    errs.append(f"{ft}: found {xml.count('<p:grpSp>')}")
            elif ft == "fill:solid" and "<a:solidFill>" not in xml:
                errs.append("solidFill not found")
            elif ft == "line:dash" and "<a:prstDash" not in xml:
                errs.append("prstDash not found")
            elif ft == "text:bold" and 'b="1"' not in xml:
                errs.append("bold not found")
            elif ft == "text:italic" and 'i="1"' not in xml:
                errs.append("italic not found")
            elif ft == "text:underline" and 'u="sng"' not in xml:
                errs.append("underline not found")
            elif ft == "text:size" and " sz=" not in xml:
                errs.append("size not found")
            elif ft == "text:font" and "<a:latin" not in xml:
                errs.append("font not found")
            elif ft.startswith("text:align:") and ft != "text:align:left":  # left is the default, LO omits algn
                a = {"left": "l", "center": "ctr", "right": "r"}[ft.split(":")[2]]
                if f'algn="{a}"' not in xml:
                    errs.append(f"{ft} not found")
            elif ft.startswith("text:anchor:"):
                a = {"top": "t", "middle": "ctr", "bottom": "b"}[ft.split(":")[2]]
                if f'anchor="{a}"' not in xml:
                    errs.append(f"{ft} not found")
            elif ft.startswith("bullets:levels="):
                n = int(ft.split("=")[1])
                if n > 1 and f'lvl="{n - 1}"' not in xml:
                    errs.append(f"{ft}: lvl={n - 1} not found")
            elif ft == "numbered" and "<a:buAutoNum" not in xml:
                errs.append("buAutoNum not found")
            elif ft == "rotation" and ' rot="' not in xml:
                errs.append("rot not found")
            elif ft == "flip" and 'flipH="1"' not in xml:
                errs.append("flipH not found")
            elif ft == "background:solid" and "<p:bg>" not in xml:
                errs.append("p:bg not found")
        if errs:
            fails += 1
            print(f"FAIL {e['file']}: " + "; ".join(errs))
    return fails


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "emit":
        emit(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 4 and sys.argv[1] == "check":
        sys.exit(1 if check(sys.argv[2], sys.argv[3]) else 0)
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
