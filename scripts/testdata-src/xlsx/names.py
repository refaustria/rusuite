"""Generate the PROVISIONAL defined-names / number-format reference workbook.

    python3 -I scripts/testdata-src/xlsx/names.py OUT_DIR

Writes provisional-names.xlsx (see testdata/README.md): workbook- and
sheet-scoped names, a hidden name with a comment, print area and print
titles, names used in formulas, and custom number formats of every family.
openpyxl is installed per user (see docs/setup.md); `-I` drops the user
site directory, so it is added back explicitly.
"""

import site
import sys

sys.path.append(site.getusersitepackages())

from openpyxl import Workbook  # noqa: E402
from openpyxl.workbook.defined_name import DefinedName  # noqa: E402

# (value, format code): one or more per family of the grammar.
FORMATS = [
    (1234.5678, "0.000"),
    (1234567.891, "#,##0.00"),
    (12200000, "0.0,,\"M\""),
    (0.256, "0.0%"),
    (12345, "0.00E+00"),
    (12345, "##0.0E+0"),
    (5.25, "# ?/?"),
    (3.14159265, "# ??/??"),
    (0.75, "?/8"),
    (-5, "[Red][<0]-0.0;0.0"),
    (150, "[>=100]\"big\";\"small\""),
    (-1234, "#,##0.00_);[Red](#,##0.00)"),
    (1234.5, "_(\"$\"* #,##0.00_);_(\"$\"* \\(#,##0.00\\);_(\"$\"* \"-\"??_);_(@_)"),
    (7, "#,##0.00 [$€-407]"),
    (45306, "[$-407]dddd, d. mmmm yyyy"),
    (45306.75, "yyyy-mm-dd hh:mm:ss"),
    (0.75, "h:mm AM/PM"),
    (1.0868981481, "[h]:mm:ss"),
    (0.0000142361, "mm:ss.000"),
    (123456789, "000-00-0000"),
    ("text", "0;-0;0;\"Text: \"@"),
    (0, "0;-0;;@"),
    (3, "[Color10]0"),
]


def fixed(wb):
    """Stable document properties (openpyxl stamps the current time)."""
    import datetime

    t = datetime.datetime(2026, 1, 1)
    wb.properties.created = t
    wb.properties.modified = t
    wb.properties.creator = "Rusuite"
    wb.properties.lastModifiedBy = "Rusuite"


def names(path):
    wb = Workbook()
    fixed(wb)
    ws = wb.active
    ws.title = "Sales"
    rows = [("Item", "Qty", "Price"), ("Pen", 10, 1.5), ("Pad", 4, 3.25), ("Ink", 7, 8), ("Cap", 2, 0.5)]
    for r in rows:
        ws.append(r)
    ws["E1"] = "Total"
    ws["E2"] = "=SUMPRODUCT(Qty,Price)"
    ws["E3"] = "=E2*(1+VAT)"
    ws["E4"] = "=COUNT(Qty)"
    ws["E5"] = "=Local*2"
    ws["E6"] = "=Rates!Local"
    ws.print_area = "A1:E5"
    ws.print_title_rows = "1:1"
    ws.print_title_cols = "A:A"

    rates = wb.create_sheet("Rates")
    rates["A1"] = "VAT"
    rates["B1"] = 0.2
    rates["B2"] = 5
    fmt = wb.create_sheet("Formats")
    for i, (value, code) in enumerate(FORMATS, start=1):
        fmt.cell(row=i, column=1, value=code)
        c = fmt.cell(row=i, column=2, value=value)
        c.number_format = code

    wb.defined_names["Qty"] = DefinedName("Qty", attr_text="Sales!$B$2:$B$5")
    wb.defined_names["Price"] = DefinedName("Price", attr_text="Sales!$C$2:$C$5")
    wb.defined_names["VAT"] = DefinedName("VAT", attr_text="Rates!$B$1", comment="Austrian VAT")
    wb.defined_names["Discount"] = DefinedName("Discount", attr_text="0.05", hidden=True)
    ws.defined_names["Local"] = DefinedName("Local", attr_text="Sales!$B$2")
    rates.defined_names["Local"] = DefinedName("Local", attr_text="Rates!$B$2")
    wb.save(path)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "testdata/xlsx"
    names(f"{out}/provisional-names.xlsx")


if __name__ == "__main__":
    main()
