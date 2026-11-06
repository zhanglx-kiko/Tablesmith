"""Write sample-data/edge-cases/text_whitespace.xlsx: text cells stored every way xlsx
allows (shared / inline / formula-string, with and without xml:space="preserve"), each
with leading, trailing and inner spaces, tabs and line breaks. Feed it to
scripts/excel-reference.ps1 to see which whitespace desktop Excel keeps.

Run from the tablesmith directory:  python -I scripts/generate-whitespace-fixture.py
"""
import pathlib
import zipfile
from xml.sax.saxutils import escape

OUT = pathlib.Path("sample-data/edge-cases/text_whitespace.xlsx")

SAMPLES = [
    "  lead",
    "trail  ",
    "  both  ",
    "in  ner",
    "\ttab",
    "line1\nline2",
    "\nlead newline",
    "trail newline\n",
    "　全角空格",
    "plain",
]

shared: list[str] = []
rows = ['<row r="1"><c r="A1" t="inlineStr"><is><t>kind</t></is></c><c r="B1" t="inlineStr"><is><t>value</t></is></c></row>']
r = 2


def cell_ref(col: str, row: int) -> str:
    return f"{col}{row}"


for preserve in (False, True):
    attr = ' xml:space="preserve"' if preserve else ""
    tag = "preserve" if preserve else "plain"
    for s in SAMPLES:
        # shared string
        shared.append(f"<si><t{attr}>{escape(s)}</t></si>")
        rows.append(
            f'<row r="{r}"><c r="A{r}" t="inlineStr"><is><t>shared-{tag}</t></is></c>'
            f'<c r="B{r}" t="s"><v>{len(shared) - 1}</v></c></row>'
        )
        r += 1
        # inline string
        rows.append(
            f'<row r="{r}"><c r="A{r}" t="inlineStr"><is><t>inline-{tag}</t></is></c>'
            f'<c r="B{r}" t="inlineStr"><is><t{attr}>{escape(s)}</t></is></c></row>'
        )
        r += 1
        # formula-string type without a formula (what the financial model uses)
        rows.append(
            f'<row r="{r}"><c r="A{r}" t="inlineStr"><is><t>str-{tag}</t></is></c>'
            f'<c r="B{r}" t="str"><v{attr}>{escape(s)}</v></c></row>'
        )
        r += 1

NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
RNS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
parts = {
    "[Content_Types].xml": (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        "</Types>"
    ),
    "_rels/.rels": (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    ),
    "xl/workbook.xml": (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook {NS} {RNS}>'
        '<sheets><sheet name="ws" sheetId="1" r:id="rId1"/></sheets></workbook>'
    ),
    "xl/_rels/workbook.xml.rels": (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
        "</Relationships>"
    ),
    "xl/sharedStrings.xml": (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst {NS} count="{len(shared)}" uniqueCount="{len(shared)}">'
        + "".join(shared)
        + "</sst>"
    ),
    "xl/worksheets/sheet1.xml": (
        f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet {NS}><sheetData>'
        + "".join(rows)
        + "</sheetData></worksheet>"
    ),
}

OUT.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    for name, body in parts.items():
        z.writestr(name, body)
print(f"wrote {OUT} ({r - 2} text cells)")
