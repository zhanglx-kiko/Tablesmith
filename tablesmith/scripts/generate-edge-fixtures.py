"""Generate edge-case import fixtures into sample-data/edge-cases/.

Run from the tablesmith directory:
    python -I scripts/generate-edge-fixtures.py
Binary spreadsheet variants (xls / xlsb / ods) are produced afterwards by
scripts/generate-edge-fixtures.cjs from the xlsx written here.
"""
import datetime as dt
import json
import pathlib
import sys

import openpyxl
from openpyxl.styles import Alignment

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "sample-data/edge-cases")
OUT.mkdir(parents=True, exist_ok=True)


def write_report_workbook() -> None:
    wb = openpyxl.Workbook()

    # Sheet 1: banner title + blank row + two-level merged header + vertical merges
    ws = wb.active
    ws.title = "区域销售"
    ws["A1"] = "2024 年区域销售汇总"
    ws.merge_cells("A1:F1")
    ws["A3"] = "地区"
    ws.merge_cells("A3:A4")
    ws["B3"] = "城市"
    ws.merge_cells("B3:B4")
    ws["C3"] = "上半年"
    ws.merge_cells("C3:D3")
    ws["E3"] = "下半年"
    ws.merge_cells("E3:F3")
    for col, label in zip("CDEF", ["Q1", "Q2", "Q3", "Q4"]):
        ws[f"{col}4"] = label
    data = [
        ("华东", "上海", 120.5, 98, 130.25, 0.1 + 0.2),
        (None, "杭州", 80, 85.5, 90, 99),
        ("华南", "广州", 70, None, 75, 88),
        (None, "深圳", 66.6, 70, 71, 72),
    ]
    for i, row in enumerate(data, start=5):
        for j, v in enumerate(row, start=1):
            if v is not None:
                ws.cell(row=i, column=j, value=v)
    ws.merge_cells("A5:A6")
    ws.merge_cells("A7:A8")
    ws["A10"] = "数据来源：内部系统导出"
    ws.merge_cells("A10:F10")

    # Sheet 2: typed cells (dates, times, datetimes, booleans, errors, formulas without cache)
    ws2 = wb.create_sheet("类型样例")
    ws2.append(["订单号", "下单日期", "下单时间", "完成时间", "金额", "已付款", "备注", "公式"])
    ws2.append(["A-001", dt.date(2024, 1, 31), dt.time(13, 45, 0), dt.datetime(2024, 2, 1, 9, 30, 15), 1234.5, True, "含\n换行", "=E2*2"])
    ws2.append(["A-002", dt.date(2024, 2, 29), dt.time(0, 5, 0), dt.datetime(2024, 3, 1, 0, 0, 0), -0.75, False, "  前导空格", "=1/0"])
    ws2.append(["A-003", dt.date(1999, 12, 31), None, None, 1e-7, None, "", "=E4+1"])
    for r in range(2, 5):
        ws2.cell(row=r, column=2).number_format = "yyyy-mm-dd"
        ws2.cell(row=r, column=3).number_format = "hh:mm:ss"
        ws2.cell(row=r, column=4).number_format = "yyyy-mm-dd hh:mm:ss"
        ws2.cell(row=r, column=7).alignment = Alignment(wrap_text=True)

    # Sheet 3: duplicate / empty headers, empty interior column, trailing blank rows
    ws3 = wb.create_sheet("重复表头")
    ws3.append(["名称", "金额", None, "金额", "", "名称"])
    ws3.append(["甲", 1, None, 2, None, "x"])
    ws3.append(["乙", 3, None, 4, None, "y"])
    ws3.append([])
    ws3.append([])

    # Sheet 4: header row is not first, numbers stored as text, header with dates
    ws4 = wb.create_sheet("月度宽表")
    ws4["A1"] = "Revenue Build"
    ws4.merge_cells("A1:E1")
    ws4.append(["Month", dt.datetime(2024, 1, 1), dt.datetime(2024, 2, 1), dt.datetime(2024, 3, 1), dt.datetime(2024, 4, 1)])
    for c in range(2, 6):
        ws4.cell(row=2, column=c).number_format = "mmm-yy"
    ws4.append(["Period ID", "2024-01", "2024-02", "2024-03", "2024-04"])
    ws4.append(["Unit volume"])
    ws4.append(["  Cloud Services", 13221, 13750, 14139, 14278])
    ws4.append(["  Data Products", "1,200", "1,350", "1,410", "1,500"])

    # Sheet 5: hidden sheet
    ws5 = wb.create_sheet("隐藏参数")
    ws5.append(["参数", "值"])
    ws5.append(["税率", 0.13])
    ws5.sheet_state = "hidden"

    # Sheet 6: empty sheet
    wb.create_sheet("空白页")

    # Sheet 7: no header (pure numeric grid)
    ws7 = wb.create_sheet("无表头")
    for r in range(5):
        ws7.append([r + 1, (r + 1) * 10, (r + 1) * 100.5])

    wb.save(OUT / "report_layouts.xlsx")


def write_text_fixtures() -> None:
    csv_rows = [
        ["客户", "城市", "金额", "备注"],
        ["张三", "北京", "1,200.50", "首单"],
        ["李四", "上海", "980", "含,逗号"],
        ["王五", "广州", "-15", ""],
    ]

    def to_csv(rows, delim=","):
        out = []
        for row in rows:
            cells = []
            for v in row:
                if delim in v or '"' in v or "\n" in v:
                    v = '"' + v.replace('"', '""') + '"'
                cells.append(v)
            out.append(delim.join(cells))
        return "\r\n".join(out) + "\r\n"

    (OUT / "gbk_encoded.csv").write_bytes(to_csv(csv_rows).encode("gb18030"))
    (OUT / "utf8_bom.csv").write_bytes(b"\xef\xbb\xbf" + to_csv(csv_rows).encode("utf-8"))
    (OUT / "utf16le_bom.csv").write_bytes(b"\xff\xfe" + to_csv(csv_rows, "\t").encode("utf-16-le"))
    (OUT / "semicolon_quoted.csv").write_text(
        'id;name;comment;amount\n1;"Smith; John";"said ""hi""\nthen left";3,5\n2;Doe;plain;4,25\n',
        encoding="utf-8",
        newline="\n",
    )
    (OUT / "no_header.csv").write_text("1,2.5,3\n4,5.5,6\n7,8.5,9\n", encoding="utf-8", newline="\n")
    (OUT / "ragged_rows.csv").write_text(
        "a,b,c\n1,2\n3,4,5,6\n\n\n7,8,9\n", encoding="utf-8", newline="\n"
    )
    (OUT / "tab_separated.tsv").write_text(
        "sku\tqty\tprice\nX-1\t3\t9.99\nX-2\t10\t0.5\n", encoding="utf-8", newline="\n"
    )
    (OUT / "pipe_delimited.txt").write_text(
        "code|label|value\nA|Alpha|1\nB|Beta|2\n", encoding="utf-8", newline="\n"
    )

    nested = {
        "meta": {"exportedAt": "2024-05-01", "source": "crm"},
        "data": {
            "customers": [
                {"id": 1, "name": "Acme", "address": {"city": "Berlin", "zip": "10115"}, "tags": ["vip", "eu"], "active": True},
                {"id": 2, "name": "Globex", "address": {"city": "Paris"}, "tags": [], "active": False, "note": None},
            ],
            "orders": [
                {"orderId": "O-1", "customerId": 1, "lines": [{"sku": "A", "qty": 2}]},
                {"orderId": "O-2", "customerId": 2, "total": 99.9},
            ],
        },
    }
    (OUT / "nested_wrapped.json").write_text(json.dumps(nested, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    (OUT / "config_object.json").write_text(
        json.dumps({"name": "demo", "version": 3, "flags": {"beta": True}, "ports": [80, 443]}, indent=2),
        encoding="utf-8",
        newline="\n",
    )
    (OUT / "primitives_array.json").write_text(json.dumps([3, 1, 4, 1, 5]), encoding="utf-8", newline="\n")
    (OUT / "events.jsonl").write_text(
        '{"ts":"2024-01-01T10:00:00Z","event":"login","user":"u1"}\n'
        '{"ts":"2024-01-01T10:05:00Z","event":"view","user":"u1","page":"/home"}\n'
        "\n"
        '{"ts":"2024-01-01T10:06:00Z","event":"logout","user":"u1"}\n',
        encoding="utf-8",
        newline="\n",
    )
    (OUT / "multi_doc.yaml").write_text(
        "---\nname: alpha\nlimits:\n  cpu: 2\n  mem: 4Gi\n---\nname: beta\nlimits:\n  cpu: 4\n",
        encoding="utf-8",
        newline="\n",
    )
    (OUT / "invalid.json").write_text('{"a": 1,, }', encoding="utf-8", newline="\n")

    (OUT / "namespaced_orders.xml").write_text(
        """<?xml version="1.0" encoding="UTF-8"?>
<ns:Orders xmlns:ns="urn:example:orders" exported="2024-06-01">
  <ns:Order id="O-1" status="paid">
    <ns:Customer>Acme</ns:Customer>
    <ns:Total currency="EUR">120.50</ns:Total>
    <ns:Tag>vip</ns:Tag>
    <ns:Tag>eu</ns:Tag>
    <ns:Note><![CDATA[Deliver <before> noon & call]]></ns:Note>
  </ns:Order>
  <ns:Order id="O-2" status="open">
    <ns:Customer>Globex</ns:Customer>
    <ns:Total currency="USD">99</ns:Total>
  </ns:Order>
</ns:Orders>
""",
        encoding="utf-8",
        newline="\n",
    )
    (OUT / "gbk_declared.xml").write_bytes(
        '<?xml version="1.0" encoding="GBK"?>\n<人员表><人员 编号="1"><姓名>张三</姓名><部门>研发</部门></人员><人员 编号="2"><姓名>李四</姓名><部门>市场</部门></人员></人员表>\n'.encode("gb18030")
    )


write_report_workbook()
write_text_fixtures()
print(f"fixtures written to {OUT.resolve()}")
