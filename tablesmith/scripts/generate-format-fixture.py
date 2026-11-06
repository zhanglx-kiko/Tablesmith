"""Write sample-data/edge-cases/number_formats.xlsx: one row per (value, number format) pair,
covering the formats finance and operations workbooks actually use. Real Excel's rendering
of this file (scripts/excel-reference.ps1) is the reference the display formatter is tested
against.

Run from the tablesmith directory:  python -I scripts/generate-format-fixture.py
"""
import datetime as dt
import pathlib

import openpyxl

OUT = pathlib.Path("sample-data/edge-cases/number_formats.xlsx")

FORMATS = [
    "General", "0", "0.00", "#,##0", "#,##0.00", "#,##0.000", "0%", "0.0%", "0.00%",
    "$#,##0", "$#,##0.00", "$#,##0;($#,##0);-", "$#,##0.00_);($#,##0.00)", "$#,##0.00_);[Red]($#,##0.00)",
    '"¥"#,##0.00', "¥#,##0;¥-#,##0", '#,##0" 元"', '#,##0.00 "USD"', "0.00E+00", "##0.0E+0",
    "#,##0,", '#,##0.0,,"M"', "0.0,,", "# ?/?", "# ??/??", "?/8", "00000", "000-0000",
    "#,##0;[Red]-#,##0", "#,##0.00;-#,##0.00;0", "0.00;-0.00;\"zero\"", '0.0"x"', "+0.0%;-0.0%;0.0%",
    "[>=1000000]#,##0.0,,\"M\";[>=1000]#,##0.0,\"K\";0", "@", '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)',
    '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)', "#,##0_);(#,##0)", "0.000", "#.##", "0.#", "#",
]
VALUES = [0, 1, -1, 0.5, -0.5, 1234.5678, -1234.5678, 0.12345, 1234567.891, -98765432.1, 1e-7, 3.14159265358979, 0.004999]

DATE_FORMATS = [
    "yyyy-mm-dd", "yyyy/m/d", "m/d/yyyy", "d-mmm-yy", "mmm-yy", "mmmm yyyy", "yyyy\"年\"m\"月\"d\"日\"",
    "yyyy-mm-dd hh:mm", "yyyy-mm-dd hh:mm:ss", "h:mm AM/PM", "hh:mm:ss", "[h]:mm:ss", "mm:ss.0",
    "dddd", "ddd, mmm d", "yyyy\"年\"m\"月\"", "m\"月\"d\"日\"", "q", "General",
]
DATES = [dt.datetime(2024, 1, 31, 0, 0), dt.datetime(2024, 2, 29, 13, 45, 30), dt.datetime(1999, 12, 31, 23, 59, 59), dt.datetime(2025, 7, 4, 6, 5, 0)]

wb = openpyxl.Workbook()
ws = wb.active
ws.title = "数字格式"
ws.append(["格式", "值", "显示"])
for fmt in FORMATS:
    for v in VALUES:
        ws.append([fmt, v, v])
        ws.cell(row=ws.max_row, column=3).number_format = fmt

ws2 = wb.create_sheet("日期格式")
ws2.append(["格式", "值", "显示"])
for fmt in DATE_FORMATS:
    for d in DATES:
        ws2.append([fmt, d, d])
        ws2.cell(row=ws2.max_row, column=2).number_format = "yyyy-mm-dd hh:mm:ss"
        ws2.cell(row=ws2.max_row, column=3).number_format = fmt
for t in [0.25, 1.5, 36.75]:  # durations beyond 24h
    ws2.append(["[h]:mm:ss", t, t])
    ws2.cell(row=ws2.max_row, column=3).number_format = "[h]:mm:ss"

ws3 = wb.create_sheet("文本与布尔")
ws3.append(["类型", "显示"])
for label, v, fmt in [
    ("前导零文本", "00892", "@"), ("长订单号", "2026110488921001", "@"), ("布尔真", True, "General"),
    ("布尔假", False, "General"), ("公式错误", "=1/0", "General"), ("文本格式数字", 12345, "@"),
    ("负零", -0.0001, "0.00"), ("大整数", 123456789012, "#,##0"), ("百分比整数", 1, "0%"),
]:
    ws3.append([label, v])
    ws3.cell(row=ws3.max_row, column=2).number_format = fmt

OUT.parent.mkdir(parents=True, exist_ok=True)
wb.save(OUT)
print(f"wrote {OUT} ({len(FORMATS) * len(VALUES) + len(DATE_FORMATS) * len(DATES) + 3 + 9} formatted cells)")
