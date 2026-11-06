"""Write sample-data/edge-cases/health_defects.csv: 300 order rows with known planted
defects, used by tools/verify-health-e2e.cjs. Every defect and its row is listed in
PLANTED so the check can assert exact positions.

Run from the tablesmith directory:  python -I scripts/generate-health-fixture.py
"""
import csv
import json
import pathlib
import random

OUT = pathlib.Path("sample-data/edge-cases/health_defects.csv")
random.seed(20261106)

regions = ["华东", "华南", "华北", "Online"]
rows = []
for i in range(300):
    rows.append([
        f"SO-{100000 + i}",
        f"2024-{(i % 12) + 1:02d}-{(i % 28) + 1:02d}",
        regions[i % len(regions)],
        f"{random.randint(1000, 900000) / 100:.2f}",
    ])

# Data row index (0-based, excluding header) -> defect.
planted = {}
rows[40][0] = rows[12][0]; planted["duplicateKey"] = [12, 40]
rows[77][1] = "2024/3/5"; planted["mixedDateFormat"] = [77]
rows[91][2] = "online"; planted["variantSpelling"] = [91]
rows[120][3] = "12,345.60"; planted["numberAsText"] = [120]
rows[150][3] = "待定"; planted["nonNumeric"] = [150]
rows[180][3] = "#DIV/0!"; planted["formulaError"] = [180]
rows[200][2] = " 华东"; planted["whitespace"] = [200]
rows[222][3] = "99000000.00"; planted["outlier"] = [222]
rows[250][3] = ""; planted["missing"] = [250]
rows.append(list(rows[5])); planted["duplicateRow"] = [300]

OUT.parent.mkdir(parents=True, exist_ok=True)
with OUT.open("w", encoding="utf-8", newline="") as f:
    w = csv.writer(f, lineterminator="\n")
    w.writerow(["订单号", "下单日期", "区域", "金额"])
    w.writerows(rows)
# Bytes, not write_text: on Windows text mode turns "\n" into CRLF.
OUT.with_suffix(".planted.json").write_bytes((json.dumps(planted, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
print(f"wrote {OUT} ({len(rows)} rows, {len(planted)} planted defects)")
