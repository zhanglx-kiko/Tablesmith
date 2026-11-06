"""Mutation check for the raw-value red line (src/services/import/rawValues.test.ts):
apply one corrupting change at a time to normalize.ts, run the suite, restore. Every
mutation must make the suite fail; run after changing the import pipeline:
    python -I scripts/check-raw-value-guard.py
"""
import pathlib
import subprocess
import sys

target = pathlib.Path("src/services/import/normalize.ts")
original = target.read_bytes()
anchor = "  const raw = dataRows.map(({ cells }) => keep.map((c) => cellToText(cells[c] ?? null)));"
assert anchor.encode() in original

mutations = {
    "round long decimals to 2 places": anchor.replace(
        "cellToText(cells[c] ?? null)",
        "((t) => (/^-?\\d+\\.\\d{6,}$/.test(t) ? Number(t).toFixed(2) : t))(cellToText(cells[c] ?? null))",
    ),
    "trim leading zeros of text": anchor.replace(
        "cellToText(cells[c] ?? null)",
        "((t) => (/^0\\d+$/.test(t) ? String(Number(t)) : t))(cellToText(cells[c] ?? null))",
    ),
    "use display text as raw": anchor.replace(
        "cellToText(cells[c] ?? null)",
        "(displayText(cells[c] ?? null, formatFor(source, c), formatFor.spreadsheet) ?? cellToText(cells[c] ?? null))",
    ).replace("({ cells })", "({ cells, source })"),
    "shift dates by one day": anchor.replace(
        "cellToText(cells[c] ?? null)",
        "((v) => (isDateCell(v) && v.serial !== undefined ? serialToText(v.serial + 1, false) ?? '' : cellToText(v)))(cells[c] ?? null)",
    ),
}

failed_to_catch = []
try:
    for name, line in mutations.items():
        target.write_bytes(original.replace(anchor.encode(), line.encode()))
        r = subprocess.run(
            "npx vitest run src/services/import/rawValues.test.ts",
            shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        caught = r.returncode != 0
        print(f"{'CAUGHT ' if caught else 'MISSED '} {name}")
        if not caught:
            failed_to_catch.append(name)
finally:
    target.write_bytes(original)
sys.exit(1 if failed_to_catch else 0)
