"""Generator for the PROVISIONAL pptx reference suite (35 decks).

Emits one flat ODP (.fodp) per topic plus manifest.json. Conversion to .pptx is done by
scripts/gen-pptx-suite.sh with headless LibreOffice. Python stdlib only; run with `python3 -I`.

  gen.py emit OUTDIR PNGDIR      write OUTDIR/*.fodp and OUTDIR/manifest.json
  gen.py post PPTXDIR            add what LibreOffice cannot export (PowerPoint 2010 sections, embedded media) to the .pptx files
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
    'xmlns:smil="urn:oasis:names:tc:opendocument:xmlns:smil-compatible:1.0" '
    'xmlns:anim="urn:oasis:names:tc:opendocument:xmlns:animation:1.0" '
    'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
    'xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0" '
    'xmlns:xlink="http://www.w3.org/1999/xlink" '
    'xmlns:script="urn:oasis:names:tc:opendocument:xmlns:script:1.0" '
    'xmlns:dom="http://www.w3.org/2001/xml-events" '
    'office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.presentation"'
)
SIZES = {"16x9": (28.0, 15.75), "4x3": (25.4, 19.05)}
IMAGES = {}
# An EBML header: the stand-in "video" when ffmpeg is missing (LibreOffice links media; `post` embeds it).
WEBM = bytes.fromhex("1a45dfa39f4286810142f7810142f2810442f381084282847765626d")
# The real clip of deck 33: 3 s, 320 x 240 test pattern with a 440 Hz tone, H.264 baseline + AAC (what
# PowerPoint plays), generated with ffmpeg.
FFMPEG_CLIP = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15",
               "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-profile:v", "baseline",
               "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"]


# Deck 35's clip: 3 s, 96 x 72 test pattern with a tone, VP8 + Vorbis in WebM (what browsers play), small.
FFMPEG_WEBM = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=96x72:rate=10",
               "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libvpx", "-b:v", "60k", "-c:a", "libvorbis",
               "-b:a", "32k", "-shortest", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact"]


def make_clip(path):
    """Writes the clip to `path` (MP4, or WebM for a `.webm` name; the EBML stand-in when ffmpeg is not installed)."""
    import shutil
    import subprocess
    if shutil.which("ffmpeg"):
        cmd = FFMPEG_WEBM if str(path).endswith(".webm") else FFMPEG_CLIP
        subprocess.run(cmd + [str(path)], check=True)
    else:
        Path(path).write_bytes(WEBM)
MEDIA_DIR = None  # where `emit` writes the media files the .fodp files link


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
        self.anims = []  # per slide: list of (node-type, duration s, effect xml)
        self.cur = None
        self.layouts = []
        self.counts = {}
        self.feats = []
        self.imgs = 0
        self.deck_bg = bg
        self.hf = None  # {"footer": text, "date": text, "number": bool}; not on title slides
        self.sections = []  # (name, index of the section's first slide)

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
    # ODF transition (smil type, subtype, extra) per manifest name; LibreOffice exports them as
    # p:fade, p:push dir="l", p:wipe dir="r", p:cover dir="l", p:split orient="vert" dir="in".
    TRANSITIONS = {
        "fade": ("fade", "crossfade", ""),
        "push": ("pushWipe", "fromRight", ""),
        "wipe": ("barWipe", "leftToRight", ""),
        "cover": ("slideWipe", "fromRight", ""),
        "split": ("barnDoorWipe", "vertical", ' smil:direction="reverse"'),
    }

    def slide(self, layout, bg=None, transition=None, advance=None):
        """transition: key of TRANSITIONS; advance: seconds until the slide advances by itself."""
        self.cur = []
        st = None
        a = []
        if bg:
            a.append(f'draw:fill="solid" draw:fill-color="#{bg}"')
            self.feat("background:solid")
        if transition:
            typ, sub, extra = self.TRANSITIONS[transition]
            a.append(f'smil:type="{typ}" smil:subtype="{sub}"{extra}')
            self.feat(f"transition:{transition}")
        if advance:
            a.append(f'presentation:transition-type="automatic" presentation:duration="PT{advance}S"')
            self.feat("transition:advance")
        if self.hf and layout != "title":
            a.append('presentation:display-footer="true" presentation:display-page-number="true" '
                     'presentation:display-date-time="true"')
            if self.hf.get("footer"):
                self.feat("footer")
            if self.hf.get("date"):
                self.feat("datetime")
            if self.hf.get("number"):
                self.feat("slidenum")
        elif self.hf:
            a.append('presentation:display-footer="false" presentation:display-page-number="false" '
                     'presentation:display-date-time="false"')
        if a:
            st = self.style("drawing-page", f'<style:drawing-page-properties {" ".join(a)}/>', "dp")
        self.slides.append((self.cur, st))
        self.anims.append([])
        self.layouts.append(layout)

    # ---- animations (LibreOffice presets, see effects.xml; exported as PowerPoint presets) ----
    FLY = {"bottom": ("x;x", "1+height/2;y"), "top": ("x;x", "0-height/2;y"),
           "left": ("0-width/2;x", "y;y"), "right": ("1+width/2;x", "y;y")}
    WIPE = {"bottom": ("topToBottom", True), "top": ("topToBottom", False),
            "left": ("leftToRight", False), "right": ("leftToRight", True)}

    def animate(self, target, cls, effect, trigger="on-click", side="bottom", dur=0.5):
        """Appends an effect on shape `target` (a draw:id) to the current slide's main sequence.
        cls: entrance|emphasis|exit; effect: appear|fade|flyIn|wipe|zoom|spin|growShrink."""
        t = f'smil:targetElement="{target}"'

        def vis(to, begin="0s"):
            return (f'<anim:set smil:begin="{begin}" smil:dur="0.001s" smil:fill="hold" {t} '
                    f'smil:attributeName="visibility" smil:to="{to}"/>')

        def an(attr, values):
            return (f'<anim:animate smil:dur="{dur}s" smil:fill="hold" {t} smil:attributeName="{attr}" '
                    f'smil:values="{values}" smil:keyTimes="0;1"/>')

        def tf(typ, sub, extra=""):
            return f'<anim:transitionFilter smil:dur="{dur}s" {t} smil:type="{typ}" smil:subtype="{sub}"{extra}/>'

        out = ' smil:mode="out"'
        hide = vis("hidden", f"{dur - 0.001:.3f}s")
        sub = None
        if cls == "entrance":
            body = {
                "appear": lambda: ("ooo-entrance-appear", vis("visible")),
                "fade": lambda: ("ooo-entrance-fade-in", vis("visible") + tf("fade", "crossfade")),
                "flyIn": lambda: ("ooo-entrance-fly-in", vis("visible") + an("x", self.FLY[side][0]) + an("y", self.FLY[side][1])),
                "wipe": lambda: ("ooo-entrance-wipe", vis("visible") + tf("barWipe", self.WIPE[side][0], ' smil:direction="reverse"' if self.WIPE[side][1] else "")),
                "zoom": lambda: ("ooo-entrance-fade-in-and-zoom", vis("visible") + an("width", "0;width") + an("height", "0;height") + tf("fade", "crossfade")),
            }[effect]
            if effect in ("flyIn", "wipe"):
                sub = f"from-{side}"
        elif cls == "exit":
            back = lambda v: ";".join(reversed(v.split(";")))  # noqa: E731
            body = {
                "appear": lambda: ("ooo-exit-disappear", vis("hidden")),
                "fade": lambda: ("ooo-exit-fade-out", tf("fade", "crossfade", out) + hide),
                "flyIn": lambda: ("ooo-exit-fly-out", an("x", back(self.FLY[side][0])) + an("y", back(self.FLY[side][1])) + hide),
                "wipe": lambda: ("ooo-exit-wipe", tf("barWipe", self.WIPE[side][0], out + (' smil:direction="reverse"' if self.WIPE[side][1] else "")) + hide),
                "zoom": lambda: ("ooo-exit-fade-out-and-zoom", an("width", "width;0") + an("height", "height;0") + tf("fade", "crossfade", out) + hide),
            }[effect]
            if effect == "flyIn":
                sub = f"to-{side}"
            elif effect == "wipe":
                sub = f"from-{side}"
        else:
            body = {
                "spin": lambda: ("ooo-emphasis-spin", f'<anim:animateTransform smil:dur="{dur}s" smil:fill="hold" {t} smil:by="360" svg:type="rotate"/>'),
                "growShrink": lambda: ("ooo-emphasis-grow-and-shrink", f'<anim:animateTransform smil:dur="{dur}s" smil:fill="hold" {t} smil:by="1.5,1.5" svg:type="scale"/>'),
            }[effect]
        pid, inner = body()
        st = f' presentation:preset-sub-type="{sub}"' if sub else ""
        xml = (f'<anim:par smil:begin="0s" smil:fill="hold" presentation:node-type="{trigger}" '
               f'presentation:preset-class="{cls}" presentation:preset-id="{pid}"{st}>{inner}</anim:par>')
        self.anims[-1].append((trigger, dur, xml))
        self.feat(f"animation:{cls}:{effect}")

    def timing(self, anims):
        """The main sequence: click groups -> after-previous groups -> effects."""
        if not anims:
            return ""
        groups = []
        for trig, dur, xml in anims:
            if trig == "on-click" or not groups:
                groups.append([[(dur, xml)]])
            elif trig == "after-previous":
                groups[-1].append([(dur, xml)])
            else:
                groups[-1][-1].append((dur, xml))
        out = ""
        for g in groups:
            out += '<anim:par smil:begin="indefinite" smil:fill="hold">'
            begin = 0.0
            for i, sub in enumerate(g):
                if i:
                    begin += max(d for d, _ in g[i - 1])
                out += f'<anim:par smil:begin="{begin:g}s" smil:fill="hold">' + "".join(x for _, x in sub) + "</anim:par>"
            out += "</anim:par>"
        return ('<anim:par presentation:node-type="timing-root"><anim:seq presentation:node-type="main-sequence">'
                + out + "</anim:seq></anim:par>")

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
    @staticmethod
    def ident(i):
        return f' draw:id="{i}" xml:id="{i}"' if i else ""

    def title(self, text, x=2.0, y=1.0, w=None, h=2.5, cls="title", ident=None):
        w = w or self.w - 4
        size = 40 if cls == "title" else 36
        self.add(f'<draw:frame{self.ident(ident)} presentation:style-name="pres-title" presentation:class="{cls}" '
                 f'svg:x="{x}cm" svg:y="{y}cm" svg:width="{w}cm" svg:height="{h}cm">'
                 f"<draw:text-box>{self.para(text)}</draw:text-box></draw:frame>")

    def subtitle(self, text, y=8.0, ident=None):
        self.add(f'<draw:frame{self.ident(ident)} presentation:style-name="pres-sub" presentation:class="subtitle" '
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

    # LibreOffice's own geometry (no enhanced path): ODF type per DrawingML preset
    PRESETS = {
        "flowChartProcess": "flowchart-process", "flowChartDecision": "flowchart-decision",
        "flowChartTerminator": "flowchart-terminator", "flowChartDocument": "flowchart-document",
        "flowChartInputOutput": "flowchart-data", "flowChartConnector": "flowchart-connector",
        "star5": "star5", "hexagon": "hexagon", "wedgeRectCallout": "rectangular-callout",
    }

    def preset(self, kind, x, y, w, h, text, fill="3465a4", ident=None):
        st = self.gstyle(fill, "204a87", 0.05, False, "middle")
        self.feat(f"shape:{kind}")
        self.count(kind)
        self.add(f'<draw:custom-shape{self.ident(ident)} draw:style-name="{st}" {self.xform(x, y, w, h)}>'
                 f'{self.para(text, "center")}<draw:enhanced-geometry draw:type="{self.PRESETS[kind]}"/>'
                 f"</draw:custom-shape>")

    def connector(self, kind, start, sglue, end, eglue, arrow=True):
        """kind: standard (elbow) | line | curve; glue points 0 top, 1 right, 2 bottom, 3 left."""
        extra = 'draw:marker-end="Arrow" draw:marker-end-width="0.3cm"' if arrow else ""
        st = self.style("graphic", f'<style:graphic-properties draw:stroke="solid" svg:stroke-color="#204a87" '
                                   f'svg:stroke-width="0.05cm" draw:fill="none" {extra}/>', "G")
        self.feat({"standard": "connector:elbow", "line": "connector:straight", "curve": "connector:curved"}[kind])
        self.feat("connector:attached")
        if arrow:
            self.feat("line:arrow")
        self.add(f'<draw:connector draw:style-name="{st}" draw:type="{kind}" draw:start-shape="{start}" '
                 f'draw:start-glue-point="{sglue}" draw:end-shape="{end}" draw:end-glue-point="{eglue}" '
                 f'svg:x1="0cm" svg:y1="0cm" svg:x2="1cm" svg:y2="1cm"/>')

    def table(self, x, y, w, rows, merges=(), fills=None):
        """rows: list of lists of text; merges: (row, col, rowspan, colspan); fills: {(row, col): rgb}."""
        self.feat("table")
        cols = len(rows[0])
        co = self.style("table-column", f'<style:table-column-properties style:column-width="{w / cols:.3f}cm"/>', "co")
        ro = self.style("table-row", '<style:table-row-properties style:row-height="1.2cm"/>', "ro")
        covered = set()
        for (r, c, rs, cs) in merges:
            self.feat("table:merged")
            covered |= {(rr, cc) for rr in range(r, r + rs) for cc in range(c, c + cs)} - {(r, c)}
        out = "".join(f'<table:table-column table:style-name="{co}"/>' for _ in range(cols))
        for r, row in enumerate(rows):
            out += f'<table:table-row table:style-name="{ro}">'
            for c, text in enumerate(row):
                if (r, c) in covered:
                    out += "<table:covered-table-cell/>"
                    continue
                a = ""
                for (mr, mc, rs, cs) in merges:
                    if (mr, mc) == (r, c):
                        a = f' table:number-rows-spanned="{rs}" table:number-columns-spanned="{cs}"'
                if fills and (r, c) in fills:
                    ce = self.style("table-cell", f'<style:graphic-properties draw:fill="solid" '
                                                  f'draw:fill-color="#{fills[(r, c)]}"/>', "ce")
                    a += f' table:style-name="{ce}"'
                out += f"<table:table-cell{a}>{self.para(text)}</table:table-cell>"
            out += "</table:table-row>"
        self.add(f'<draw:frame svg:x="{x}cm" svg:y="{y}cm" svg:width="{w}cm" svg:height="{1.2 * len(rows)}cm">'
                 f'<table:table table:template-name="default" table:use-first-row-styles="true" '
                 f'table:use-banding-rows-styles="true">{out}</table:table></draw:frame>')

    def shape(self, kind, x, y, w, h, text=None, fill=None, line=None, lw=None, dash=False, anchor=None,
              rot=None, flip=False, align=None, content=None, tag=True, ident=None):
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
        return (f'<draw:custom-shape{self.ident(ident)} draw:style-name="{st}" {self.xform(x, y, w, h, rot)}>{content}'
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

    def picture(self, k, x, y, w, h, clip=None, mode=None, luminance=None, contrast=None, opacity=None):
        """clip: (top, right, bottom, left) in cm of the 48 px (1.27 cm) image; mode: greyscale|mono;
        luminance/contrast: percent (-100..100); opacity: percent."""
        self.imgs += 1
        self.feat("picture"); self.count("picture")
        st = self.gstyle()
        a = []
        if clip:
            a.append('fo:clip="rect({}cm, {}cm, {}cm, {}cm)"'.format(*clip)); self.feat("picture:crop")
        if mode:
            a.append(f'draw:color-mode="{mode}"')
            self.feat({"greyscale": "picture:grayscale", "mono": "picture:blackWhite"}[mode])
        if luminance is not None or contrast is not None:
            a.append(f'draw:luminance="{luminance or 0}%" draw:contrast="{contrast or 0}%"'); self.feat("picture:lum")
        if opacity is not None:
            a.append(f'draw:image-opacity="{opacity}%"'); self.feat("picture:transparency")
        if a:
            st = self.style("graphic", f'<style:graphic-properties draw:stroke="none" draw:fill="none" {" ".join(a)}/>', "G")
        data = base64.b64encode(IMAGES[k]).decode()
        self.add(f'<draw:frame draw:style-name="{st}" draw:name="Image{self.imgs}" svg:x="{x}cm" svg:y="{y}cm" '
                 f'svg:width="{w}cm" svg:height="{h}cm"><draw:image><office:binary-data>{data}'
                 f"</office:binary-data></draw:image></draw:frame>")

    def chart(self, kind, x, y, w, h, title, cats, series):
        """An embedded chart (ODF chart object inline in the flat ODP); kind: bar|line|pie;
        series: [(name, [values])]. LibreOffice exports it as ppt/charts/chartN.xml."""
        cls = {"column": "bar", "bar": "bar", "line": "line", "pie": "circle"}[kind]
        self.feat(f"chart:{kind}")
        n = len(cats)
        cell = lambda v: (f'<table:table-cell office:value-type="float" office:value="{v}"><text:p>{v}</text:p></table:table-cell>'  # noqa: E731
                          if isinstance(v, (int, float)) else
                          f'<table:table-cell office:value-type="string"><text:p>{esc(v)}</text:p></table:table-cell>')
        head = "<table:table-cell/>" + "".join(cell(nm) for nm, _ in series)
        rows = "".join("<table:table-row>" + cell(c) + "".join(cell(vals[i]) for _, vals in series) + "</table:table-row>"
                       for i, c in enumerate(cats))
        col = lambda i: chr(66 + i)  # noqa: E731
        # LibreOffice's own range syntax (`local-table.$B$2:.$B$5`); without it the data is read by rows
        sers = "".join(f'<chart:series chart:values-cell-range-address="local-table.${col(i)}$2:.${col(i)}${n + 1}" '
                       f'chart:label-cell-address="local-table.${col(i)}$1" chart:class="chart:{cls}"/>' for i in range(len(series)))
        horizontal = kind == "bar"
        pa = ' chart:style-name="chv"' if horizontal else ""
        cstyle = ('<style:style style:name="chv" style:family="chart"><style:chart-properties chart:vertical="true"/></style:style>'
                  if horizontal else "")
        axes = ("" if kind == "pie" else
                f'<chart:axis chart:dimension="x" chart:name="primary-x"><chart:categories table:cell-range-address="local-table.$A$2:.$A${n + 1}"/></chart:axis>'
                '<chart:axis chart:dimension="y" chart:name="primary-y"><chart:grid chart:class="major"/></chart:axis>')
        if kind == "pie":
            axes = f'<chart:axis chart:dimension="x" chart:name="primary-x"><chart:categories table:cell-range-address="local-table.$A$2:.$A${n + 1}"/></chart:axis>'
        doc = (f'<office:document office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.chart">'
               f'<office:automatic-styles>{cstyle}</office:automatic-styles>'
               f'<office:body><office:chart><chart:chart svg:width="{w}cm" svg:height="{h}cm" chart:class="chart:{cls}">'
               f'<chart:title><text:p>{esc(title)}</text:p></chart:title><chart:legend chart:legend-position="bottom"/>'
               f'<chart:plot-area{pa} table:cell-range-address="local-table.$A$1:.${col(len(series) - 1)}${n + 1}" chart:data-source-has-labels="both">'
               f'{axes}{sers}</chart:plot-area>'
               f'<table:table table:name="local-table"><table:table-header-columns><table:table-column/></table:table-header-columns>'
               f'<table:table-columns><table:table-column table:number-columns-repeated="{len(series)}"/></table:table-columns>'
               f'<table:table-header-rows><table:table-row>{head}</table:table-row></table:table-header-rows>'
               f'<table:table-rows>{rows}</table:table-rows></table:table></chart:chart></office:chart></office:body></office:document>')
        self.add(f'<draw:frame svg:x="{x}cm" svg:y="{y}cm" svg:width="{w}cm" svg:height="{h}cm"><draw:object>{doc}</draw:object></draw:frame>')

    def link(self, text, href):
        """A hyperlink run (web address, or `#SlideN` for a slide of this deck)."""
        self.feat("link:slide" if href.startswith("#") else "link:url")
        return X(f'<text:a xlink:href="{esc(href)}" xlink:type="simple">{esc(text)}</text:a>')

    # presentation:action of an ODF click action → the manifest's action kind
    ACTIONS = {"next-page": "next", "previous-page": "previous", "first-page": "first", "last-page": "last", "stop": "endShow"}

    def action_shape(self, kind, x, y, w, h, text, action, href=None):
        """A shape with a mouse-click action (`presentation:event-listener`)."""
        self.feat("action:" + ("slide" if action == "show" else self.ACTIONS[action]))
        target = f' xlink:href="{esc(href)}" xlink:type="simple"' if href else ""
        listener = (f'<office:event-listeners><presentation:event-listener script:event-name="dom:click" '
                    f'presentation:action="{action}"{target}/></office:event-listeners>')
        xml = self.shape(kind, x, y, w, h, text, fill=BLUE)
        self.add(xml.replace(">", ">" + listener, 1))

    def video(self, x, y, w, h, name):
        """A video (LibreOffice links the file; `gen.py post` embeds it as ppt/media/media1.mp4)."""
        self.feat("media:video")
        make_clip(Path(MEDIA_DIR) / name)
        href = (Path(MEDIA_DIR) / name).resolve().as_uri()
        self.add(f'<draw:frame svg:x="{x}cm" svg:y="{y}cm" svg:width="{w}cm" svg:height="{h}cm">'
                 f'<draw:plugin xlink:href="{href}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" '
                 f'draw:mime-type="application/vnd.sun.star.media"><draw:param draw:name="Loop" draw:value="false"/>'
                 f'</draw:plugin></draw:frame>')

    def section(self, name):
        """Starts a section (PowerPoint 2010 p14:sectionLst, added by `gen.py post`) at the next slide."""
        self.sections.append((name, len(self.slides)))

    def group(self, inner):
        self.feat("group"); self.count("group")
        self.add("<draw:g>" + "".join(inner) + "</draw:g>")

    # ---- output ----
    def fodp(self):
        w, h = self.w, self.h
        pages = []
        hf_decl, hf_use, hf_master = "", "", ""
        if self.hf:
            if self.hf.get("footer"):
                hf_decl += f'<presentation:footer-decl presentation:name="ftr1">{esc(self.hf["footer"])}</presentation:footer-decl>'
                hf_use += ' presentation:use-footer-name="ftr1"'
            if self.hf.get("date"):
                hf_decl += (f'<presentation:date-time-decl presentation:name="dtd1" presentation:source="fixed">'
                            f'{esc(self.hf["date"])}</presentation:date-time-decl>')
                hf_use += ' presentation:use-date-time-name="dtd1"'
            y = h - 1.6
            hf_master = (f'<draw:frame presentation:style-name="pres-hf" presentation:class="date-time" svg:x="1cm" svg:y="{y}cm" '
                         f'svg:width="6cm" svg:height="1cm"><draw:text-box><text:p><presentation:date-time/></text:p></draw:text-box></draw:frame>'
                         f'<draw:frame presentation:style-name="pres-hf" presentation:class="footer" svg:x="{w / 2 - 5}cm" svg:y="{y}cm" '
                         f'svg:width="10cm" svg:height="1cm"><draw:text-box><text:p><presentation:footer/></text:p></draw:text-box></draw:frame>'
                         f'<draw:frame presentation:style-name="pres-hf" presentation:class="page-number" svg:x="{w - 7}cm" svg:y="{y}cm" '
                         f'svg:width="6cm" svg:height="1cm"><draw:text-box><text:p><text:page-number>&lt;number&gt;</text:page-number></text:p></draw:text-box></draw:frame>')
        for i, (els, bgst) in enumerate(self.slides, 1):
            st = bgst or "dp0"
            use = hf_use if self.layouts[i - 1] != "title" else ""
            pages.append(f'<draw:page draw:name="Slide{i}" draw:style-name="{st}" draw:master-page-name="Default"{use}>'
                         + "".join(els) + self.timing(self.anims[i - 1]) + "</draw:page>")
        return f"""<?xml version="1.0" encoding="UTF-8"?>
<office:document {NS}>
<office:styles>
<draw:marker draw:name="Arrow" svg:viewBox="0 0 20 30" svg:d="M10 0l-10 30h20z"/>
<style:style style:name="Default" style:family="graphic"><style:graphic-properties draw:stroke="none" draw:fill="none"/></style:style>
<style:style style:name="pres-title" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:text-properties fo:font-size="40pt" fo:font-weight="bold"/></style:style>
<style:style style:name="pres-sub" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:text-properties fo:font-size="24pt"/></style:style>
<style:style style:name="pres-outline" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:text-properties fo:font-size="28pt"/></style:style>
<style:style style:name="pres-hf" style:family="presentation"><style:graphic-properties draw:stroke="none" draw:fill="none"/><style:text-properties fo:font-size="12pt"/></style:style>
</office:styles>
<office:automatic-styles>
<style:page-layout style:name="PL"><style:page-layout-properties fo:page-width="{w}cm" fo:page-height="{h}cm" style:print-orientation="landscape"/></style:page-layout>
<style:style style:name="dp0" style:family="drawing-page"><style:drawing-page-properties presentation:background-visible="true" presentation:background-objects-visible="true"/></style:style>
{"".join(self.styles.values())}
<text:list-style style:name="LB"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:min-label-width="0.6cm"/></text:list-level-style-bullet><text:list-level-style-bullet text:level="2" text:bullet-char="–"><style:list-level-properties text:space-before="0.8cm" text:min-label-width="0.6cm"/></text:list-level-style-bullet><text:list-level-style-bullet text:level="3" text:bullet-char="▪"><style:list-level-properties text:space-before="1.6cm" text:min-label-width="0.6cm"/></text:list-level-style-bullet></text:list-style>
<text:list-style style:name="LN"><text:list-level-style-number text:level="1" style:num-suffix="." style:num-format="1"><style:list-level-properties text:min-label-width="0.8cm"/></text:list-level-style-number></text:list-style>
</office:automatic-styles>
<office:master-styles>
<style:master-page style:name="Default" style:page-layout-name="PL" draw:style-name="dp0">{hf_master}</style:master-page>
</office:master-styles>
<office:body><office:presentation>
{hf_decl}{"".join(pages)}
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
        if self.sections:
            feats.append(f"section:count={len(self.sections)}")
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


def d26():
    d = Deck(26, "transitions", "Slide transitions: fade, push, wipe, cover, split; one slide advances by itself")
    for i, (tr, label) in enumerate([("fade", "Fade"), ("push", "Push"), ("wipe", "Wipe"), ("cover", "Cover"),
                                     ("split", "Split")]):
        d.slide("blank", transition=tr, advance=3 if tr == "wipe" else None)
        d.add_shape("rect", 4, 3, 20, 9, text=label, fill=[BLUE, RED, GREEN, YELLOW, GREY][i])
    return d


def d27():
    d = Deck(27, "animations", "Entrance, emphasis and exit animations on click, with and after previous")
    d.slide("title"); d.title("Animated Title", y=4, ident="t1"); d.subtitle("Subtitle fades in", ident="t2")
    d.animate("t1", "entrance", "flyIn", side="bottom")
    d.animate("t2", "entrance", "fade", trigger="with-previous", dur=1.0)
    d.slide("blank")
    for i, (k, label) in enumerate([("rect", "Wipe"), ("ellipse", "Zoom"), ("roundRect", "Appear"), ("rect", "Fly")]):
        d.add_shape(k, 1 + i * 6.8, 4, 5.8, 5, text=label, fill=[BLUE, RED, GREEN, YELLOW][i], ident=f"s{i + 1}")
    d.animate("s1", "entrance", "wipe", side="left")
    d.animate("s2", "entrance", "zoom", trigger="after-previous")
    d.animate("s3", "entrance", "appear")
    d.animate("s1", "emphasis", "spin", dur=2.0)
    d.animate("s2", "emphasis", "growShrink", trigger="after-previous", dur=2.0)
    d.animate("s3", "exit", "fade")
    d.animate("s4", "exit", "flyIn", trigger="with-previous", side="right")
    d.animate("s2", "exit", "appear")
    return d


def d28():
    d = Deck(28, "flowchart", "Flowchart shapes joined by glued connectors with arrowheads; a few other presets")
    d.slide("blank")
    d.preset("flowChartTerminator", 1, 1, 5, 2, "Start", ident="f1")
    d.preset("flowChartInputOutput", 1, 5, 5, 2, "Read", ident="f2")
    d.preset("flowChartDecision", 9, 4.5, 6, 3, "OK?", ident="f3")
    d.preset("flowChartProcess", 19, 5, 5, 2, "Work", ident="f4")
    d.preset("flowChartDocument", 19, 10, 5, 2.5, "Report", ident="f5")
    d.preset("flowChartTerminator", 9, 12, 6, 2, "End", ident="f6")
    d.connector("line", "f1", 2, "f2", 0)
    d.connector("standard", "f2", 1, "f3", 3)
    d.connector("line", "f3", 1, "f4", 3)
    d.connector("standard", "f4", 2, "f5", 0)
    d.connector("standard", "f3", 2, "f6", 0)
    d.connector("curve", "f5", 2, "f6", 1)
    d.slide("blank")
    d.preset("flowChartConnector", 2, 2, 3, 3, "A")
    d.preset("star5", 7, 2, 4, 4, "")
    d.preset("hexagon", 13, 2, 5, 3, "Hex")
    d.preset("wedgeRectCallout", 20, 2, 6, 3, "Note")
    return d


def d29():
    d = Deck(29, "table", "Table with a header row, banded rows, merged cells and a filled cell")
    d.slide("blank")
    d.table(2, 2, 24, [["Region", "Q1", "Q2"], ["North", "12", "15"], ["South", "9", "11"], ["Total", "21", "26"]],
            merges=[(1, 0, 2, 1)], fills={(3, 2): "ffc000"})
    d.slide("blank")
    d.table(4, 3, 12, [["A", "B"], ["C", "D"]], merges=[(0, 0, 1, 2)])
    return d


def d30():
    d = Deck(30, "sections-footers", "Three sections; footer text, fixed date and slide numbers on all but the title slide")
    d.hf = {"footer": "Rusuite reference deck", "date": "16 October 2026", "number": True}
    d.section("Introduction")
    d.slide("title"); d.title("Sections and Footers", y=4.0); d.subtitle("Footers are not shown on the title slide")
    d.slide("titleContent"); d.title("Agenda", cls="title"); d.outline([(1, "Why"), (1, "How")])
    d.section("Details")
    d.slide("titleContent"); d.title("Why", cls="title"); d.outline([(1, "Readers need context")])
    d.slide("titleContent"); d.title("How", cls="title"); d.outline([(1, "With footers"), (1, "And sections")])
    d.section("Wrap-up")
    d.slide("titleContent"); d.title("Thanks", cls="title"); d.outline([(1, "Questions?")])
    return d


def d31():
    d = Deck(31, "picture-adjustments", "Cropped, grayscale, black-and-white, brightness/contrast and transparent pictures")
    d.slide("blank")
    d.picture("img0", 1, 2, 6, 6, clip=(0, 0, 0.3, 0.4))
    d.picture("img2", 8, 2, 6, 6, mode="greyscale")
    d.picture("img1", 15, 2, 6, 6, mode="mono")
    d.picture("img2", 22, 2, 5, 5, luminance=20, contrast=-30)
    d.slide("blank")
    d.picture("img0", 2, 2, 10, 10, opacity=50)
    d.picture("img2", 14, 2, 10, 10, clip=(0.2, 0.2, 0.2, 0.2), mode="greyscale")
    return d


def d32():
    d = Deck(32, "charts", "Charts: clustered column, line and pie with their data (LibreOffice chart objects)")
    d.slide("blank")
    d.textbox(1, 0.5, 20, 1.2, "Sales by region")
    d.chart("column", 1, 2, 16, 11, "Sales", ["North", "East", "South", "West"],
            [("2025", [12, 7.5, 3, 9]), ("2026", [14, 8, 4, 11])])
    d.slide("blank")
    d.chart("line", 1, 1, 13, 10, "Trend", ["Q1", "Q2", "Q3", "Q4"], [("Revenue", [4.3, 2.5, 3.5, 4.5]), ("Cost", [2.4, 4.4, 1.8, 2.8])])
    d.chart("pie", 15, 1, 11, 10, "Share", ["A", "B", "C"], [("Share", [50, 30, 20])])
    return d


def d33():
    d = Deck(33, "links-media", "Hyperlinks (web, slide), click actions (next, last, end show) and a video")
    d.slide("blank")
    d.textbox(1, 1, 24, 2, d.para([X("Visit "), d.link("example.com", "https://example.com/rusuite"),
                                   X(" or go to "), d.link("the media slide", "#Slide3")]))
    d.action_shape("rect", 1, 5, 5, 2, "Next", "next-page")
    d.action_shape("rect", 7, 5, 5, 2, "Last", "last-page")
    d.action_shape("ellipse", 13, 5, 5, 2, "End", "stop")
    d.slide("blank")
    d.textbox(1, 1, 20, 2, "Second slide")
    d.action_shape("rect", 1, 5, 5, 2, "Back", "previous-page")
    d.slide("blank")
    d.video(2, 2, 16, 9, "clip.mp4")
    return d


def d34():
    d = Deck(34, "views-design", "Custom show and Set Up Show, master and layout guides, gradient and pattern backgrounds")
    d.slide("title"); d.title("Views and Design", y=4.0); d.subtitle("Custom show, guides and backgrounds")
    d.slide("titleContent"); d.title("Gradient background", cls="title"); d.outline([(1, "A linear gradient in two accents")])
    d.slide("blank")
    d.textbox(1, 1, 20, 2, "Pattern background")
    d.slide("titleContent"); d.title("In the custom show", cls="title"); d.outline([(1, "Slides 4 and 1, in that order")])
    # added after LibreOffice's export (it writes none of them): see post_views
    d.views = True
    for f in ["customShow:count=1", "show:customShow", "guides:master", "guides:layout", "background:gradient", "background:pattern"]:
        d.feat(f)
    return d


def d35():
    d = Deck(35, "animations2", "PowerPoint 2010+ transitions (Cube, Vortex, Curtains), Float In by paragraph, a custom motion "
                                "path, a triggered spin, a trimmed video with fades and a bookmark that triggers an exit")
    d.slide("title"); d.title("Animations 2", y=4.0); d.subtitle("Transitions, builds, paths, triggers, media")
    d.slide("titleContent"); d.title("Float in by paragraph", cls="title")
    d.outline([(1, "First point"), (2, "A detail"), (1, "Second point")])
    d.slide("blank")
    d.add_shape("rect", 2, 4, 5, 3, text="Moves", fill="3465a4")
    d.add_shape("ellipse", 18, 4, 4, 4, text="Click me", fill="cc0000")
    d.slide("blank")
    d.video(2, 2, 12, 9, "clip.webm")
    d.textbox(16, 4, 10, 2, "Leaves at the bookmark")
    # added after LibreOffice's export (it writes none of them): see post_anim
    d.anim2 = True
    for f in ["transition:p14", "transition:p15", "anim:bldP", "anim:motionPath", "anim:trigger", "media:trim", "media:bookmark"]:
        d.feat(f)
    return d


TOPICS = [globals()[f"d{n:02d}"] for n in range(1, 36)]


def emit(outdir, pngdir):
    global MEDIA_DIR
    for k in range(3):
        IMAGES[f"img{k}"] = (Path(pngdir) / f"img{k}.png").read_bytes()
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    MEDIA_DIR = out
    man = []
    for t in TOPICS:
        d = t()
        (out / d.file.replace(".pptx", ".fodp")).write_text(d.fodp(), encoding="utf-8")
        man.append(d.manifest_entry())
    (out / "manifest.json").write_text(json.dumps(man, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


SECTION_URI = "{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"
P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main"


P15 = "http://schemas.microsoft.com/office/powerpoint/2012/main"
MASTER_GUIDES_URI = "{27BBF7A9-308A-43DC-89C8-2F10F3537804}"
LAYOUT_GUIDES_URI = "{DCECCB84-F9BA-43D5-87BE-67443E8EF086}"


def p15_guides(uri, guides):
    """`p:ext` with a `p15:sldGuideLst` of (orient, pos in 1/8 pt) guides, PowerPoint's orange."""
    gs = ""
    for i, (o, pos) in enumerate(guides):
        orient = ' orient="horz"' if o == "horz" else ""
        gs += (f'<p15:guide id="{i + 1}"{orient} pos="{pos}" userDrawn="1">'
               '<p15:clr><a:srgbClr val="FBAE40"/></p15:clr></p15:guide>')
    return f'<p:ext uri="{uri}"><p15:sldGuideLst xmlns:p15="{P15}">{gs}</p15:sldGuideLst></p:ext>'


def add_ext(xml, root, ext):
    """`ext` appended to the `p:extLst` of `root` (created before the root's end tag when missing)."""
    if "<p:extLst>" in xml:
        return xml.replace("</p:extLst>", ext + "</p:extLst>", 1)
    return xml.replace(f"</{root}>", f"<p:extLst>{ext}</p:extLst></{root}>", 1)


def add_bg(xml, bg):
    """A slide's `p:bg` (replacing LibreOffice's, before the shape tree)."""
    xml = re.sub(r"<p:bg>.*?</p:bg>", "", xml, flags=re.S)
    return re.sub(r"(<p:cSld[^>]*>)", r"\1" + bg, xml, count=1)


def post_views(path):
    """Deck 34: what LibreOffice does not export – a custom show (slides 4 and 1) that Set Up Show runs with a
    pen colour, guides on the master and the first layout, a gradient background on slide 2 and a pattern on
    slide 3 – added as PowerPoint writes them."""
    with zipfile.ZipFile(path) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    files = {i.filename: d for i, d in entries}
    rels = files["ppt/_rels/presentation.xml.rels"].decode("utf-8")
    pres = files["ppt/presentation.xml"].decode("utf-8")
    order = re.findall(r'<p:sldId id="\d+" r:id="(rId\d+)"', pres)
    target = {m.group(1): m.group(2) for m in re.finditer(r'Id="(rId\d+)"[^>]*Target="slides/(slide\d+\.xml)"', rels)}
    target.update({m.group(2): m.group(1) for m in re.finditer(r'Target="slides/(slide\d+\.xml)"[^>]*Id="(rId\d+)"', rels)})
    slides = [target[r] for r in order]
    out = []
    for info, data in entries:
        name = info.filename
        if name in ("ppt/presentation.xml", "ppt/presProps.xml", "ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout1.xml") \
                or name in (f"ppt/slides/{slides[1]}", f"ppt/slides/{slides[2]}"):
            xml = data.decode("utf-8")
            if name == "ppt/presentation.xml":
                show = f'<p:custShowLst><p:custShow name="Short" id="0"><p:sldLst><p:sld r:id="{order[3]}"/><p:sld r:id="{order[0]}"/></p:sldLst></p:custShow></p:custShowLst>'
                xml = re.sub(r"(<p:notesSz [^>]*/>)", r"\1" + show, xml, count=1)
            elif name == "ppt/presProps.xml":
                show = ('<p:showPr loop="1" showNarration="1"><p:present/><p:custShow id="0"/>'
                        '<p:penClr><a:srgbClr val="0070C0"/></p:penClr></p:showPr>')
                xml = re.sub(r"<p:showPr.*?</p:showPr>|<p:showPr[^>]*/>", "", xml, flags=re.S)
                xml = re.sub(r"(<p:presentationPr[^>]*?)/>", r"\1>" + show + "</p:presentationPr>", xml, count=1) \
                    if re.search(r"<p:presentationPr[^>]*/>", xml) else re.sub(r"(<p:presentationPr[^>]*>)", r"\1" + show, xml, count=1)
                if 'xmlns:a="' not in xml:
                    xml = xml.replace("<p:presentationPr ", '<p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ', 1)
            elif name.startswith("ppt/slideMasters/"):
                xml = add_ext(xml, "p:sldMaster", p15_guides(MASTER_GUIDES_URI, [("horz", 2160), ("vert", 3840)]))
            elif name.startswith("ppt/slideLayouts/"):
                xml = add_ext(xml, "p:sldLayout", p15_guides(LAYOUT_GUIDES_URI, [("vert", 576), ("vert", 7104)]))
            elif name == f"ppt/slides/{slides[1]}":
                xml = add_bg(xml, '<p:bg><p:bgPr><a:gradFill flip="none" rotWithShape="1"><a:gsLst>'
                                  '<a:gs pos="0"><a:schemeClr val="accent1"><a:lumMod val="20000"/><a:lumOff val="80000"/></a:schemeClr></a:gs>'
                                  '<a:gs pos="100000"><a:schemeClr val="accent2"/></a:gs></a:gsLst>'
                                  '<a:lin ang="5400000" scaled="1"/><a:tileRect/></a:gradFill><a:effectLst/></p:bgPr></p:bg>')
            else:
                xml = add_bg(xml, '<p:bg><p:bgPr><a:pattFill prst="smCheck"><a:fgClr><a:schemeClr val="accent1"/></a:fgClr>'
                                  '<a:bgClr><a:schemeClr val="bg1"/></a:bgClr></a:pattFill><a:effectLst/></p:bgPr></p:bg>')
            data = xml.encode("utf-8")
        out.append((info, data))
    with zipfile.ZipFile(path, "w") as z:
        for info, data in out:
            z.writestr(info, data, compress_type=info.compress_type)


P15_NS = "http://schemas.microsoft.com/office/powerpoint/2012/main"
MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"


def alt_transition(effect, requires, dur, ns_extra=""):
    """A transition as PowerPoint writes it: the effect with `p14:dur` in a choice, a fade in the fallback."""
    return (f'<mc:AlternateContent xmlns:mc="{MC_NS}"><mc:Choice xmlns:p14="{P14}"{ns_extra} Requires="{requires}">'
            f'<p:transition spd="slow" p14:dur="{dur}">{effect}</p:transition></mc:Choice>'
            f'<mc:Fallback><p:transition spd="slow"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>')


def tgt(spid, para=None):
    inner = f'<p:txEl><p:pRg st="{para}" end="{para}"/></p:txEl>' if para is not None else ""
    return f'<p:tgtEl><p:spTgt spid="{spid}">{inner}</p:spTgt></p:tgtEl>' if inner else f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>'


class Ids:
    def __init__(self):
        self.n = 2

    def __call__(self):
        self.n += 1
        return self.n


def eff(ids, preset, cls, sub, grp, node, children, extra=""):
    """One effect `p:par` (delay 0)."""
    return (f'<p:par><p:cTn id="{ids()}" presetID="{preset}" presetClass="{cls}" presetSubtype="{sub}"{extra} fill="hold" grpId="{grp}" '
            f'nodeType="{node}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>{children}</p:childTnLst></p:cTn></p:par>')


def step(ids, effects, first=False, delay="indefinite"):
    """A click step: one group with one sub-step."""
    return (f'<p:par><p:cTn id="{ids()}" fill="hold"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst><p:childTnLst>'
            f'<p:par><p:cTn id="{ids()}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
            f'{effects}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>')


def visible(ids, spid, para=None):
    return (f'<p:set><p:cBhvr><p:cTn id="{ids()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>'
            f'{tgt(spid, para)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>'
            f'<p:to><p:strVal val="visible"/></p:to></p:set>')


def float_in(ids, spid, para):
    return (visible(ids, spid, para)
            + f'<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="{ids()}" dur="1000"/>{tgt(spid, para)}</p:cBhvr></p:animEffect>'
            + f'<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="{ids()}" dur="1000" fill="hold"/>{tgt(spid, para)}'
              f'<p:attrNameLst><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst>'
              f'<p:tav tm="0"><p:val><p:strVal val="#ppt_y+.1"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#ppt_y"/></p:val></p:tav>'
              f'</p:tavLst></p:anim>')


def timing(ids, main, extra="", builds=""):
    seq = (f'<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>{main}</p:childTnLst></p:cTn>'
           '<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
           '<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>') if main else ""
    bl = f"<p:bldLst>{builds}</p:bldLst>" if builds else ""
    return (f'<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
            f'{seq}{extra}</p:childTnLst></p:cTn></p:par></p:tnLst>{bl}</p:timing>')


def interactive(ids, evt, spid, effects, bmk=None):
    name = f' p14:bmkName="{bmk}"' if bmk else ""
    cond = f'<p:cond evt="{evt}" delay="0"><p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cond>'
    seq = (f'<p:seq concurrent="1" nextAc="seek"><p:cTn id="{ids()}" restart="whenNotActive" fill="hold" evtFilter="cancelBubble" '
           f'nodeType="interactiveSeq"{name}><p:stCondLst>{cond}</p:stCondLst><p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync>'
           f'<p:childTnLst>{step(ids, effects, delay="0")}</p:childTnLst></p:cTn><p:nextCondLst>{cond}</p:nextCondLst></p:seq>')
    if bmk:
        return f'<mc:AlternateContent xmlns:mc="{MC_NS}"><mc:Choice xmlns:p14="{P14}" Requires="p14">{seq}</mc:Choice><mc:Fallback/></mc:AlternateContent>'
    return seq


def post_anim(path):
    """Deck 35: what LibreOffice does not export – PowerPoint 2010+ transitions in `mc:AlternateContent` (Cube, Vortex,
    Curtains), Float In by paragraph (`p:bldP build="p"`), a custom motion path and a Pulse, a Spin triggered by a click
    on the ellipse, and a trimmed video with fades and a bookmark (`p14:trim`, `p14:fade`, `p14:bmk`) that triggers the
    text box's exit – added as PowerPoint writes them."""
    with zipfile.ZipFile(path) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    files = {i.filename: d for i, d in entries}
    rels = files["ppt/_rels/presentation.xml.rels"].decode("utf-8")
    pres = files["ppt/presentation.xml"].decode("utf-8")
    order = re.findall(r'<p:sldId id="\d+" r:id="(rId\d+)"', pres)
    target = {m.group(1): m.group(2) for m in re.finditer(r'Id="(rId\d+)"[^>]*Target="slides/(slide\d+\.xml)"', rels)}
    target.update({m.group(2): m.group(1) for m in re.finditer(r'Target="slides/(slide\d+\.xml)"[^>]*Id="(rId\d+)"', rels)})
    slides = [f"ppt/slides/{target[r]}" for r in order]
    out = []
    for info, data in entries:
        name = info.filename
        if name in slides[1:]:
            xml = data.decode("utf-8")
            k = slides.index(name)
            spids = [int(v) for v in re.findall(r'<p:cNvPr id="(\d+)"', xml)][1:]
            # LibreOffice's own transition / timing (none expected) make way for PowerPoint's
            xml = re.sub(r"<mc:AlternateContent[^>]*>(?:(?!</mc:AlternateContent>).)*<p:transition.*?</mc:AlternateContent>", "", xml, flags=re.S)
            xml = re.sub(r"<p:transition.*?</p:transition>|<p:transition[^>]*/>", "", xml, flags=re.S)
            xml = re.sub(r"<p:timing>.*?</p:timing>", "", xml, flags=re.S)
            ids = Ids()
            if k == 1:
                tr = alt_transition('<p14:prism dir="u"/>', "p14", 1000)
                body = spids[1]
                main = step(ids, eff(ids, 42, "entr", 0, 0, "clickEffect", float_in(ids, body, 0))
                           + eff(ids, 42, "entr", 0, 0, "withEffect", float_in(ids, body, 1)))
                main += step(ids, eff(ids, 42, "entr", 0, 0, "clickEffect", float_in(ids, body, 2)))
                tm = timing(ids, main, builds=f'<p:bldP spid="{body}" grpId="0" build="p"/>')
            elif k == 2:
                tr = alt_transition('<p14:vortex dir="r"/>', "p14", 3000)
                rect, ellipse = spids[0], spids[1]
                motion = (f'<p:animMotion origin="layout" path="M 0 0 C 0.05 0.1 0.15 0.1 0.2 0 L 0.3 0.15 E" pathEditMode="relative" '
                        f'ptsTypes=""><p:cBhvr><p:cTn id="{ids()}" dur="2000" fill="hold"/>{tgt(rect)}<p:attrNameLst>'
                        f'<p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr></p:animMotion>')
                pulse = (f'<p:animScale><p:cBhvr><p:cTn id="{ids()}" dur="250" autoRev="1" fill="hold"/>{tgt(rect)}</p:cBhvr>'
                         f'<p:by x="105000" y="105000"/></p:animScale>')
                path_eff = eff(ids, 0, "path", 0, 0, "clickEffect", motion)
                pulse_eff = eff(ids, 26, "emph", 0, 1, "afterEffect", pulse)
                main = (f'<p:par><p:cTn id="{ids()}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>'
                        f'<p:par><p:cTn id="{ids()}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>{path_eff}'
                        f'</p:childTnLst></p:cTn></p:par><p:par><p:cTn id="{ids()}" fill="hold"><p:stCondLst><p:cond delay="2000"/>'
                        f'</p:stCondLst><p:childTnLst>{pulse_eff}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>')
                spin = (f'<p:animRot by="21600000"><p:cBhvr><p:cTn id="{ids()}" dur="2000" fill="hold"/>{tgt(rect)}'
                        f'<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>')
                extra = interactive(ids, "onClick", ellipse, eff(ids, 8, "emph", 0, 2, "clickEffect", spin))
                tm = timing(ids, main, extra, builds=f'<p:bldP spid="{rect}" grpId="0" animBg="1"/><p:bldP spid="{rect}" grpId="1" animBg="1"/>'
                                                     f'<p:bldP spid="{rect}" grpId="2" animBg="1"/>')
            else:
                tr = alt_transition('<p15:prstTrans prst="curtains"/>', "p15", 2750, f' xmlns:p15="{P15_NS}"')
                video, box = spids[0], spids[1]
                pause = (f'<p:cmd type="call" cmd="togglePause"><p:cBhvr><p:cTn id="{ids()}" dur="1" fill="hold"/>{tgt(video)}'
                         f'</p:cBhvr></p:cmd>')
                main = step(ids, eff(ids, 2, "mediacall", 0, 0, "clickEffect", pause))
                fade = (f'<p:animEffect transition="out" filter="fade"><p:cBhvr><p:cTn id="{ids()}" dur="500"/>{tgt(box)}</p:cBhvr></p:animEffect>'
                        f'<p:set><p:cBhvr><p:cTn id="{ids()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="499"/></p:stCondLst></p:cTn>'
                        f'{tgt(box)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr>'
                        f'<p:to><p:strVal val="hidden"/></p:to></p:set>')
                extra = interactive(ids, "onMediaBookmark", video, eff(ids, 10, "exit", 0, 0, "clickEffect", fade), bmk="Bookmark 1")
                extra += (f'<p:video><p:cMediaNode vol="80000"><p:cTn id="{ids()}" fill="hold" display="0"><p:stCondLst>'
                          f'<p:cond delay="indefinite"/></p:stCondLst></p:cTn>{tgt(video)}</p:cMediaNode></p:video>')
                tm = timing(ids, main, extra, builds=f'<p:bldP spid="{box}" grpId="0" animBg="1"/>')
                media = ('<p14:trim st="500" end="500"/><p14:fade in="250" out="250"/>'
                         '<p14:bmkLst><p14:bmk name="Bookmark 1" time="1000"/></p14:bmkLst>')
                xml = re.sub(r"(<p14:media [^>]*?)/>", r"\1>" + media + "</p14:media>", xml, count=1)
            anchor = "</p:clrMapOvr>" if "</p:clrMapOvr>" in xml else "</p:cSld>"
            xml = xml.replace(anchor, anchor + tr + tm, 1)
            data = xml.encode("utf-8")
        out.append((info, data))
    with zipfile.ZipFile(path, "w") as z:
        for info, data in out:
            z.writestr(info, data, compress_type=info.compress_type)


def post(pptxdir):
    """Adds the sections of every deck that has some (LibreOffice cannot export them) to its .pptx, and deck
    34's custom show, guides and backgrounds."""
    for k in range(3):
        IMAGES.setdefault(f"img{k}", b"")  # the decks are only rebuilt for their sections
    global MEDIA_DIR
    MEDIA_DIR = MEDIA_DIR or pptxdir
    for t in TOPICS:
        d = t()
        path = Path(pptxdir) / d.file
        if path.exists() and "media:video" in d.feats:
            embed_media(path)
        if path.exists() and getattr(d, "views", False):
            post_views(path)
        if path.exists() and getattr(d, "anim2", False):
            post_anim(path)
        if not d.sections or not path.exists():
            continue
        with zipfile.ZipFile(path) as z:
            entries = [(i, z.read(i.filename)) for i in z.infolist()]
        out = []
        for info, data in entries:
            if info.filename == "ppt/presentation.xml":
                xml = data.decode("utf-8")
                ids = re.findall(r'<p:sldId id="(\d+)"', xml)
                bounds = [first for _, first in d.sections] + [len(ids)]
                secs = ""
                for k, (name, first) in enumerate(d.sections):
                    sl = "".join(f'<p14:sldId id="{i}"/>' for i in ids[first:bounds[k + 1]])
                    guid = f"{{{0x5EC70000 + k:08X}-0000-4000-8000-{d.n:012d}}}"
                    secs += f'<p14:section name="{escape(name)}" id="{guid}"><p14:sldIdLst>{sl}</p14:sldIdLst></p14:section>'
                ext = (f'<p:ext uri="{SECTION_URI}"><p14:sectionLst xmlns:p14="{P14}">{secs}</p14:sectionLst></p:ext>')
                if "<p:extLst>" in xml:
                    xml = xml.replace("</p:extLst>", ext + "</p:extLst>", 1)
                else:
                    xml = xml.replace("</p:presentation>", f"<p:extLst>{ext}</p:extLst></p:presentation>", 1)
                data = xml.encode("utf-8")
            out.append((info, data))
        with zipfile.ZipFile(path, "w") as z:
            for info, data in out:
                z.writestr(info, data, compress_type=info.compress_type)


def embed_media(path):
    """LibreOffice links audio/video by absolute file URL: embed each file as ppt/media/mediaN.ext and point the
    `video`/`media` relationships at it (as PowerPoint writes them)."""
    with zipfile.ZipFile(path) as z:
        entries = [(i, z.read(i.filename)) for i in z.infolist()]
    files = {}
    out = []
    for info, data in entries:
        if re.fullmatch(r"ppt/slides/_rels/slide\d+\.xml\.rels", info.filename):
            xml = data.decode("utf-8")

            def repl(m):
                url = m.group(1)
                if url not in files:
                    files[url] = f"media{len(files) + 1}{Path(url).suffix}"
                return f'Target="../media/{files[url]}"'
            xml = re.sub(r'Target="(file://[^"]+)" TargetMode="External"', repl, xml)
            data = xml.encode("utf-8")
        out.append((info, data))
    if not files:
        return
    for info, data in list(out):
        if info.filename == "[Content_Types].xml":
            xml = data.decode("utf-8")
            for name in files.values():
                ext = Path(name).suffix[1:]
                if f'Extension="{ext}"' not in xml:
                    xml = xml.replace("<Default ", f'<Default Extension="{ext}" ContentType="video/{ext}"/><Default ', 1)
            out[out.index((info, data))] = (info, xml.encode("utf-8"))
    with zipfile.ZipFile(path, "w") as z:
        for info, data in out:
            z.writestr(info, data, compress_type=info.compress_type)
        for url, name in files.items():
            z.writestr(f"ppt/media/{name}", Path(url[len("file://"):]).read_bytes() if Path(url[len("file://"):]).exists() else WEBM,
                       compress_type=zipfile.ZIP_DEFLATED)


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
                design = "".join(z.read(n).decode("utf-8") for n in names if re.fullmatch(r"ppt/slide(Master|Layout)s/slide(Master|Layout)\d+\.xml", n))
                props = z.read("ppt/presProps.xml").decode("utf-8") if "ppt/presProps.xml" in names else ""
                charts = "".join(z.read(n).decode("utf-8") for n in names if re.fullmatch(r"ppt/charts/chart\d+\.xml", n))
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
            elif ft == "table" and "<a:tbl>" not in xml:
                errs.append("a:tbl not found")
            elif ft == "table:merged" and not re.search(r'(gridSpan|rowSpan)="[2-9]', xml):
                errs.append("merged cells not found")
            elif ft.startswith("connector:") and ft != "connector:attached":
                k = {"straight": "straightConnector1", "elbow": "bentConnector", "curved": "curvedConnector"}[ft.split(":")[1]]
                if k not in xml:
                    errs.append(f"{ft} not found")
            elif ft == "connector:attached" and "<a:stCxn" not in xml:
                errs.append("stCxn not found")
            elif ft == "line:arrow" and not re.search(r'<a:(head|tail)End [^>]*type="(?!none)', xml):
                errs.append("arrowhead not found")
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
            elif ft == "transition:advance" and " advTm=" not in xml:
                errs.append("advTm not found")
            elif ft.startswith("transition:") and ft not in ("transition:advance", "transition:p14", "transition:p15") \
                    and f"<p:{ft.split(':')[1]}" not in xml:
                errs.append(f"{ft} not found")
            elif ft.startswith("section:count="):
                if pres.count("<p14:section ") != int(ft.split("=")[1]):
                    errs.append(f"{ft}: found {pres.count('<p14:section ')}")
            elif ft == "footer" and '<p:ph type="ftr"' not in xml:
                errs.append("footer placeholder not found")
            elif ft == "datetime" and '<p:ph type="dt"' not in xml:
                errs.append("date placeholder not found")
            elif ft == "slidenum" and 'type="slidenum"' not in xml:
                errs.append("slide number field not found")
            elif ft == "picture:crop" and not re.search(r'<a:srcRect [^>]*="[1-9]', xml):
                errs.append("a:srcRect not found")
            elif ft == "picture:grayscale" and "<a:grayscl" not in xml:
                errs.append("a:grayscl not found")
            elif ft == "picture:blackWhite" and "<a:biLevel" not in xml:
                errs.append("a:biLevel not found")
            elif ft == "picture:lum" and "<a:lum " not in xml:
                errs.append("a:lum not found")
            elif ft == "picture:transparency" and "<a:alphaModFix" not in xml:
                errs.append("a:alphaModFix not found")
            elif ft.startswith("chart:"):
                k = {"column": "<c:barDir val=\"col\"/>", "bar": "<c:barDir val=\"bar\"/>", "line": "<c:lineChart>", "pie": "<c:pieChart>"}[ft.split(":")[1]]
                if k not in charts:
                    errs.append(f"{ft} not found")
            elif ft == "link:url" and not re.search(r'<a:hlinkClick r:id="rId\d+"', xml):
                errs.append("URL hyperlink not found")
            elif ft == "link:slide" and "ppaction://hlinksldjump" not in xml:
                errs.append("slide hyperlink not found")
            elif ft.startswith("action:") and ft != "action:slide":
                jump = {"next": "nextslide", "previous": "previousslide", "first": "firstslide", "last": "lastslide", "endShow": "endshow"}[ft.split(":")[1]]
                if f"ppaction://hlinkshowjump?jump={jump}" not in xml:
                    errs.append(f"{ft} not found")
            elif ft.startswith("customShow:count="):
                if pres.count("<p:custShow ") != int(ft.split("=")[1]):
                    errs.append(f"{ft}: found {pres.count('<p:custShow ')}")
            elif ft == "show:customShow" and "<p:custShow id=" not in props:
                errs.append("p:showPr custShow not found")
            elif ft in ("guides:master", "guides:layout"):
                uri = MASTER_GUIDES_URI if ft == "guides:master" else LAYOUT_GUIDES_URI
                if uri not in design or "<p15:guide " not in design:
                    errs.append(f"{ft} not found")
            elif ft == "background:gradient" and not re.search(r"<p:bg><p:bgPr><a:gradFill", xml):
                errs.append("gradient background not found")
            elif ft == "background:pattern" and not re.search(r"<p:bg><p:bgPr><a:pattFill", xml):
                errs.append("pattern background not found")
            elif ft == "media:video" and "<a:videoFile" not in xml:
                errs.append("a:videoFile not found")
            elif ft == "transition:p14" and not re.search(r'Requires="p14"><p:transition[^>]*><p14:', xml):
                errs.append("p14 transition in mc:AlternateContent not found")
            elif ft == "transition:p15" and "<p15:prstTrans " not in xml:
                errs.append("p15:prstTrans not found")
            elif ft == "anim:bldP" and not re.search(r'<p:bldP [^>]*build="p"', xml):
                errs.append('p:bldP build="p" not found')
            elif ft == "anim:motionPath" and "<p:animMotion " not in xml:
                errs.append("p:animMotion not found")
            elif ft == "anim:trigger" and 'nodeType="interactiveSeq"' not in xml:
                errs.append("interactive sequence not found")
            elif ft == "media:trim" and "<p14:trim " not in xml:
                errs.append("p14:trim not found")
            elif ft == "media:bookmark" and ("<p14:bmk " not in xml or "p14:bmkName=" not in xml):
                errs.append("p14:bmk / bmkName not found")
            elif ft.startswith("animation:"):
                _, cls, eff = ft.split(":")
                c = {"entrance": "entr", "emphasis": "emph", "exit": "exit"}[cls]
                ids = {"appear": "1", "fade": "10", "flyIn": "2", "wipe": "22", "zoom": "(?:53|23)",
                       "spin": "8", "growShrink": "6"}[eff]
                if not re.search(rf'presetClass="{c}" presetID="{ids}"|presetID="{ids}" presetClass="{c}"', xml):
                    errs.append(f"{ft} not found")
        if errs:
            fails += 1
            print(f"FAIL {e['file']}: " + "; ".join(errs))
    return fails


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "emit":
        emit(sys.argv[2], sys.argv[3])
    elif len(sys.argv) == 3 and sys.argv[1] == "post":
        post(sys.argv[2])
    elif len(sys.argv) == 4 and sys.argv[1] == "check":
        sys.exit(1 if check(sys.argv[2], sys.argv[3]) else 0)
    else:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
