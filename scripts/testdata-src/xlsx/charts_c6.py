"""Generate the PROVISIONAL charts round 2 / sparklines workbook of P9-C6.

    python3 -I scripts/testdata-src/xlsx/charts_c6.py OUT_DIR

Writes provisional-charts-c6.xlsx (see testdata/README.md). openpyxl writes
the cells, the charts (gradient chart area, plot area fill, rotated
category labels, title font, error bars, a data table, a manual plot area
layout, up/down bars and high-low lines) and the chart sheet; the Excel
2010 sparkline groups (`x14:sparklineGroups`), which openpyxl cannot
write, are added to the sheet XML afterwards in the form Excel writes them.
openpyxl is installed per user (docs/setup.md); `-I` drops the user site
directory, so it is added back explicitly.
"""

import datetime
import os
import site
import sys
import zipfile

sys.path.append(site.getusersitepackages())

from openpyxl import Workbook  # noqa: E402
from openpyxl.chart import BarChart, LineChart, PieChart, Reference  # noqa: E402
from openpyxl.chart.axis import ChartLines  # noqa: E402
from openpyxl.chart.error_bar import ErrorBars  # noqa: E402
from openpyxl.chart.layout import Layout, ManualLayout  # noqa: E402
from openpyxl.chart.plotarea import DataTable  # noqa: E402
from openpyxl.chart.shapes import GraphicalProperties  # noqa: E402
from openpyxl.chart.text import RichText  # noqa: E402
from openpyxl.chart.updown_bars import UpDownBars  # noqa: E402
from openpyxl.drawing.fill import ColorChoice, GradientFillProperties, GradientStop, LinearShadeProperties  # noqa: E402
from openpyxl.drawing.text import CharacterProperties, Paragraph, ParagraphProperties, RichTextProperties  # noqa: E402

X14 = "http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"
XM = "http://schemas.microsoft.com/office/excel/2006/main"


def fixed(wb):
    t = datetime.datetime(2026, 1, 1)
    wb.properties.created = t
    wb.properties.modified = t
    wb.properties.creator = "Rusuite"
    wb.properties.lastModifiedBy = "Rusuite"


def text(sz, rot=None, bold=None):
    body = RichTextProperties(rot=rot, vert="horz") if rot is not None else RichTextProperties()
    return RichText(bodyPr=body, p=[Paragraph(pPr=ParagraphProperties(defRPr=CharacterProperties(sz=sz, b=bold)), endParaRPr=CharacterProperties())])


def main(out: str) -> None:
    wb = Workbook()
    fixed(wb)
    ws = wb.active
    ws.title = "Data"
    rows = [
        ("Month", "North", "South", "Low", "High", "Q1", "Q2", "Q3", "Q4"),
        ("Jan", 12, 9, 7, 14, 5, -2, 8, 3),
        ("Feb", 15, 11, 9, 18, 6, 4, -1, 7),
        ("Mar", 11, 14, 8, 16, 2, 9, 4, -3),
        ("Apr", 18, 12, 10, 21, 7, 3, 6, 9),
        ("May", 21, 16, 13, 24, -4, 5, 8, 2),
    ]
    for r in rows:
        ws.append(r)
    cats = Reference(ws, min_col=1, min_row=2, max_row=6)

    col = BarChart()
    col.type = "col"
    col.title = "Sales by month"
    col.add_data(Reference(ws, min_col=2, max_col=3, min_row=1, max_row=6), titles_from_data=True)
    col.set_categories(cats)
    col.series[0].errBars = ErrorBars(errDir="y", errBarType="both", errValType="fixedVal", val=2, noEndCap=False)
    col.series[1].errBars = ErrorBars(errDir="y", errBarType="plus", errValType="percentage", val=10)
    grad = GradientFillProperties(
        gsLst=[GradientStop(pos=0, srgbClr="FFFFFF"), GradientStop(pos=100000, srgbClr="DDEBF7")],
        lin=LinearShadeProperties(ang=5400000, scaled=False),
    )
    col.graphical_properties = GraphicalProperties(gradFill=grad)
    col.plot_area.graphicalProperties = GraphicalProperties(solidFill=ColorChoice(srgbClr="F2F2F2"))
    col.plot_area.dTable = DataTable(showHorzBorder=True, showVertBorder=True, showOutline=True, showKeys=True)
    col.plot_area.layout = Layout(manualLayout=ManualLayout(layoutTarget="inner", xMode="edge", yMode="edge", x=0.1, y=0.15, w=0.85, h=0.55))
    col.x_axis.txPr = text(900, rot=-2700000)
    col.x_axis.delete = False
    col.y_axis.delete = False
    col.width, col.height = 16, 9
    ws.add_chart(col, "K2")

    line = LineChart()
    line.title = "Daily range"
    line.add_data(Reference(ws, min_col=4, max_col=5, min_row=1, max_row=6), titles_from_data=True)
    line.set_categories(cats)
    line.upDownBars = UpDownBars(gapWidth=150)
    line.hiLowLines = ChartLines()
    line.x_axis.delete = False
    line.y_axis.delete = False
    ws.add_chart(line, "K22")

    pie = PieChart()
    pie.title = "North"
    pie.add_data(Reference(ws, min_col=2, min_row=1, max_row=6), titles_from_data=True)
    pie.set_categories(cats)
    cs = wb.create_chartsheet("Chart1")
    cs.add_chart(pie)

    path = os.path.join(out, "provisional-charts-c6.xlsx")
    wb.save(path)
    add_sparklines(path)


def add_sparklines(path: str) -> None:
    """Line sparklines with high/low points (F8:F9 ← B2:F6 columns) and
    column sparklines with negative points (J2:J6 ← F2:I6)."""
    with zipfile.ZipFile(path) as z:
        parts = {n: z.read(n) for n in z.namelist()}
    name = "xl/worksheets/sheet1.xml"
    xml = parts[name].decode()
    ext = (
        f'<extLst><ext uri="{{05C60535-1F16-4fd2-B633-F4F36F0B64E0}}" xmlns:x14="{X14}">'
        f'<x14:sparklineGroups xmlns:xm="{XM}">'
        '<x14:sparklineGroup displayEmptyCellsAs="gap" markers="1" high="1" low="1">'
        '<x14:colorSeries theme="4" tint="-0.499984740745262"/><x14:colorNegative theme="5"/>'
        '<x14:colorAxis rgb="FF000000"/><x14:colorMarkers theme="4" tint="-0.499984740745262"/>'
        '<x14:colorFirst theme="4" tint="0.39997558519241921"/><x14:colorLast theme="4" tint="0.39997558519241921"/>'
        '<x14:colorHigh rgb="FF00B050"/><x14:colorLow rgb="FFFF0000"/>'
        '<x14:sparklines><x14:sparkline><xm:f>Data!B2:B6</xm:f><xm:sqref>B8</xm:sqref></x14:sparkline>'
        '<x14:sparkline><xm:f>Data!C2:C6</xm:f><xm:sqref>C8</xm:sqref></x14:sparkline></x14:sparklines>'
        '</x14:sparklineGroup>'
        '<x14:sparklineGroup type="column" displayEmptyCellsAs="gap" negative="1" displayXAxis="1">'
        '<x14:colorSeries theme="5" tint="-0.249977111117893"/><x14:colorNegative rgb="FFC00000"/>'
        '<x14:colorAxis rgb="FF000000"/><x14:colorMarkers theme="5"/><x14:colorFirst theme="5"/>'
        '<x14:colorLast theme="5"/><x14:colorHigh theme="5"/><x14:colorLow theme="5"/>'
        '<x14:sparklines>'
        + "".join(f'<x14:sparkline><xm:f>Data!F{r}:I{r}</xm:f><xm:sqref>J{r}</xm:sqref></x14:sparkline>' for r in range(2, 7))
        + '</x14:sparklines></x14:sparklineGroup>'
        '</x14:sparklineGroups></ext></extLst></worksheet>'
    )
    xml = xml.replace("</worksheet>", ext)
    parts[name] = xml.encode()
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for n, data in parts.items():
            z.writestr(zipfile.ZipInfo(n, date_time=(2026, 10, 17, 0, 0, 0)), data, zipfile.ZIP_DEFLATED)


if __name__ == "__main__":
    main(sys.argv[1])
