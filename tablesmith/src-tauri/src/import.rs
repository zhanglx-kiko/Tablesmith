//! File reading for the import pipeline.
//!
//! Rust only reads: spreadsheets become a raw cell grid (`RawWorkbook`) via calamine,
//! text files are decoded to UTF-8. Header detection, merged-cell handling and the
//! conversion into tables happen once, in `src/services/import/` on the TypeScript side,
//! so desktop and browser imports produce identical results. Keep `GridCell`, `RawSheet`,
//! `RawWorkbook` and `ReadPayload` in sync with `src/services/import/types.ts` and
//! `DesktopPayload` in `src/services/import/index.ts`.

use std::fs;
use std::path::Path;

use calamine::{open_workbook_auto, Data, Range, Reader, SheetType, SheetVisible, Sheets};
use encoding_rs::{Encoding, GB18030, UTF_16BE, UTF_16LE};
use serde::Serialize;
use std::collections::HashMap;

use crate::binary_formats::{read_xls_formats, read_xlsb_formats};
use crate::xlsx_formats::{read_xlsx_formats, SheetFormats};

/// Files above this size are rejected before parsing; mirrors MAX_IMPORT_BYTES in index.ts.
pub const MAX_IMPORT_BYTES: u64 = 200 * 1024 * 1024;

pub const SPREADSHEET_EXTENSIONS: &[&str] = &["xlsx", "xlsm", "xlsb", "xls", "ods"];
/// calamine rejects ods written by other tools, so ods always goes to SheetJS on the
/// frontend. xlsb is read here; files whose sheets come back empty (SheetJS-written xlsb
/// lack the row index calamine relies on) are detected in `read_payload` and handed over.
const FRONTEND_ONLY_EXTENSIONS: &[&str] = &["ods"];
pub const TEXT_EXTENSIONS: &[&str] = &[
    "csv", "tsv", "txt", "json", "jsonl", "ndjson", "xml", "xsd", "yaml", "yml",
];

const OLE_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const ZIP_MAGIC: [u8; 4] = [0x50, 0x4B, 0x03, 0x04];

#[derive(Debug, Serialize, PartialEq)]
#[serde(untagged)]
pub enum GridCell {
    Null,
    Text(String),
    Number(f64),
    Bool(bool),
    /// `serial` is the Excel date number, kept so the frontend can apply the cell's format.
    Date {
        date: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        serial: Option<f64>,
    },
    Error {
        error: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSheet {
    pub name: String,
    pub hidden: bool,
    /// Sheet address (0-based row, col) of `cells[0][0]`.
    pub origin: [u32; 2],
    pub cells: Vec<Vec<GridCell>>,
    /// Inclusive `[first_row, first_col, last_row, last_col]`, relative to `cells`.
    pub merges: Vec<[u32; 4]>,
    pub uncached_formulas: usize,
    /// Number format codes used in the sheet; `#14` means built-in id 14 (resolved in
    /// numberFormat.ts). Empty when the reader has no format information.
    pub formats: Vec<String>,
    /// Same shape as `cells`: index into `formats`, or -1 for General.
    pub cell_formats: Vec<Vec<i32>>,
    /// `(row, col, formula)` relative to `cells`, without the leading `=`; the cell holds
    /// the value Excel last calculated. xlsx only: calamine decodes BIFF / xlsb formula
    /// tokens incompletely (wrong shared formulas and sheet names), so for xls / xlsb the
    /// frontend reads formulas with SheetJS (see formulas.ts).
    pub formulas: Vec<(u32, u32, String)>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawWorkbook {
    pub sheets: Vec<RawSheet>,
    pub notices: Vec<String>,
    /// Serial 0 is 1904-01-01 (Mac workbooks); the frontend needs it to turn serials into dates.
    pub date1904: bool,
    /// calamine skips xlsb cells that are not preceded by a row header (SheetJS writes
    /// them that way); set when the format reader saw cells the grid lacks.
    #[serde(skip)]
    pub lost_cells: bool,
    /// xls / xlsb workbook with formulas: their text is not in `RawSheet::formulas` (see
    /// there); the frontend reads it from the file bytes (`read_file_bytes`).
    pub formulas_pending: bool,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReadPayload {
    Workbook {
        workbook: RawWorkbook,
    },
    Text {
        text: String,
        encoding: String,
    },
    /// calamine could not open the workbook; the frontend retries with SheetJS using
    /// the bytes from `read_file_bytes` and only reports `reason` if that fails too.
    Unparsed {
        reason: String,
    },
}

/// Validate the path coming from the (untrusted) WebView before touching it.
pub fn read_payload(path: &str) -> Result<ReadPayload, String> {
    let p = Path::new(path);
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let is_sheet = SPREADSHEET_EXTENSIONS.contains(&ext.as_str());
    if !is_sheet && !TEXT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("不支持的文件类型（.{ext}）"));
    }
    let meta = fs::metadata(p).map_err(|e| format!("无法访问文件：{e}"))?;
    if !meta.is_file() {
        return Err("所选路径不是文件".into());
    }
    if meta.len() == 0 {
        return Err("文件内容为空".into());
    }
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(format!(
            "文件超过 {} MB，暂不支持导入",
            MAX_IMPORT_BYTES / 1024 / 1024
        ));
    }

    let bytes = fs::read(p).map_err(|e| format!("读取文件失败：{e}"))?;
    if is_sheet {
        if bytes.starts_with(&OLE_MAGIC) && ext != "xls" {
            return Err("文件设置了打开密码，请在 Excel 中取消密码后再导入".into());
        }
        if FRONTEND_ONLY_EXTENSIONS.contains(&ext.as_str()) {
            return Ok(ReadPayload::Unparsed {
                reason: format!(".{ext} 由前端解析"),
            });
        }
        if bytes.starts_with(&ZIP_MAGIC) || bytes.starts_with(&OLE_MAGIC) {
            drop(bytes);
            return Ok(match read_workbook(p) {
                Ok(workbook) if workbook.lost_cells => ReadPayload::Unparsed {
                    reason: "单元格读取不完整，改由前端解析".into(),
                },
                Ok(workbook) => ReadPayload::Workbook { workbook },
                Err(reason) if reason.contains("密码") => return Err(reason),
                Err(reason) => ReadPayload::Unparsed { reason },
            });
        }
        // Spreadsheet extension but text content (HTML / SpreadsheetML / CSV saved as .xls):
        // the TypeScript side recognises these from the decoded text.
    }
    let (text, encoding) = decode_text(&bytes);
    Ok(ReadPayload::Text { text, encoding })
}

// ── spreadsheets ─────────────────────────────────────────────────────

fn pad2(n: u32) -> String {
    format!("{n:02}")
}

/// Same rules as `formatExcelSerial` in sheetjsReader.ts: serial < 1 is a time of day,
/// a whole number is a date, anything else is a date with time.
fn format_excel_datetime(serial: f64, dt: chrono::NaiveDateTime) -> String {
    use chrono::{Datelike, Timelike};
    let date = format!("{}-{}-{}", dt.year(), pad2(dt.month()), pad2(dt.day()));
    let time = format!(
        "{}:{}:{}",
        pad2(dt.hour()),
        pad2(dt.minute()),
        pad2(dt.second())
    );
    if serial < 1.0 {
        time
    } else if serial.fract() == 0.0 {
        date
    } else {
        format!("{date} {time}")
    }
}

/// `2024-01-01T00:00:00.000Z` (xlsx cells stored with `t="d"`) → `2024-01-01`, same rules as serials.
fn format_iso_datetime(iso: &str) -> String {
    let trimmed = iso.trim_end_matches('Z');
    let trimmed = trimmed.split('.').next().unwrap_or(trimmed);
    let (date, time) = trimmed.split_once('T').unwrap_or((trimmed, ""));
    if date.is_empty() || date.starts_with("1899-12-3") {
        return time.to_string();
    }
    if time.is_empty() || time == "00:00:00" || time == "00:00" {
        return date.to_string();
    }
    format!("{date} {time}")
}

fn to_grid_cell(cell: &Data) -> GridCell {
    match cell {
        Data::Empty => GridCell::Null,
        Data::String(s) if s.is_empty() => GridCell::Null,
        Data::String(s) => GridCell::Text(s.clone()),
        Data::Float(f) => GridCell::Number(*f),
        Data::Int(i) => GridCell::Number(*i as f64),
        Data::Bool(b) => GridCell::Bool(*b),
        Data::DateTime(dt) => {
            let serial = dt.as_f64();
            // Durations (`[h]:mm:ss`) are dates too as far as the stored value goes; the
            // elapsed-time text comes from the cell's format on the frontend.
            // Negative serials are not dates (Excel shows ####); keep the number, as SheetJS does.
            if serial < 0.0 {
                return GridCell::Number(serial);
            }
            match dt.as_datetime() {
                Some(value) => GridCell::Date {
                    date: format_excel_datetime(serial, value),
                    serial: Some(serial),
                },
                None => GridCell::Number(serial),
            }
        }
        Data::DateTimeIso(s) => GridCell::Date {
            date: format_iso_datetime(s),
            serial: None,
        },
        Data::DurationIso(s) => GridCell::Text(s.clone()),
        Data::Error(e) => GridCell::Error {
            error: e.to_string(),
        },
    }
}

fn range_to_grid(range: &Range<Data>) -> (Vec<Vec<GridCell>>, (u32, u32)) {
    let Some(start) = range.start() else {
        return (Vec::new(), (0, 0));
    };
    let mut cells: Vec<Vec<GridCell>> = range
        .rows()
        .map(|row| {
            let mut out: Vec<GridCell> = row.iter().map(to_grid_cell).collect();
            while matches!(out.last(), Some(GridCell::Null)) {
                out.pop();
            }
            out
        })
        .collect();
    while matches!(cells.last(), Some(r) if r.is_empty()) {
        cells.pop();
    }
    (cells, start)
}

/// Put formula errors calamine dropped back into the grid (positions are absolute). An
/// error above / left of the first cell calamine kept moves the origin, so it is returned.
fn restore_errors(
    cells: &mut Vec<Vec<GridCell>>,
    origin: (u32, u32),
    errors: &[((u32, u32), &'static str)],
) -> (u32, u32) {
    if errors.is_empty() {
        return origin;
    }
    let start = if cells.is_empty() {
        (u32::MAX, u32::MAX)
    } else {
        origin
    };
    let new_origin = errors
        .iter()
        .fold(start, |o, &((r, c), _)| (o.0.min(r), o.1.min(c)));
    if !cells.is_empty() {
        let dr = (origin.0 - new_origin.0) as usize;
        let dc = (origin.1 - new_origin.1) as usize;
        cells.splice(0..0, std::iter::repeat_with(Vec::new).take(dr));
        for row in cells.iter_mut().filter(|r| !r.is_empty()) {
            row.splice(0..0, std::iter::repeat_with(|| GridCell::Null).take(dc));
        }
    }
    for &((r, c), text) in errors {
        let (r, c) = ((r - new_origin.0) as usize, (c - new_origin.1) as usize);
        if cells.len() <= r {
            cells.resize_with(r + 1, Vec::new);
        }
        let row = &mut cells[r];
        if row.len() <= c {
            row.resize_with(c + 1, || GridCell::Null);
        }
        if row[c] == GridCell::Null {
            row[c] = GridCell::Error {
                error: text.to_string(),
            };
        }
    }
    new_origin
}

/// Replace calamine's text with Excel's where the whitespace rule changes it. A text that
/// becomes empty becomes a blank cell, as in Excel.
fn apply_excel_text(
    cells: &mut [Vec<GridCell>],
    origin: (u32, u32),
    texts: &HashMap<(u32, u32), String>,
) {
    for (&(r, c), text) in texts {
        let (Some(r), Some(c)) = (r.checked_sub(origin.0), c.checked_sub(origin.1)) else {
            continue;
        };
        if let Some(cell @ GridCell::Text(_)) = cells
            .get_mut(r as usize)
            .and_then(|row| row.get_mut(c as usize))
        {
            *cell = if text.is_empty() {
                GridCell::Null
            } else {
                GridCell::Text(text.clone())
            };
        }
    }
}

fn grid_cell_count(cells: &[Vec<GridCell>]) -> usize {
    cells
        .iter()
        .map(|r| r.iter().filter(|c| **c != GridCell::Null).count())
        .sum()
}

/// Per-cell format indexes aligned with `cells` (which start at `origin`).
fn grid_formats(
    cells: &[Vec<GridCell>],
    origin: (u32, u32),
    f: SheetFormats,
) -> (Vec<String>, Vec<Vec<i32>>) {
    let grid = cells
        .iter()
        .enumerate()
        .map(|(r, row)| {
            (0..row.len())
                .map(|c| {
                    f.cells
                        .get(&(origin.0 + r as u32, origin.1 + c as u32))
                        .map_or(-1, |&i| i as i32)
                })
                .collect()
        })
        .collect();
    (f.codes, grid)
}

/// calamine merge regions are absolute; the grid starts at the first used cell.
fn relative_merges(dims: &[calamine::Dimensions], origin: (u32, u32)) -> Vec<[u32; 4]> {
    dims.iter()
        .filter(|d| d.end.0 >= origin.0 && d.end.1 >= origin.1)
        .map(|d| {
            [
                d.start.0.saturating_sub(origin.0),
                d.start.1.saturating_sub(origin.1),
                d.end.0 - origin.0,
                d.end.1 - origin.1,
            ]
        })
        .collect()
}

fn sheet_merges<RS: std::io::Read + std::io::Seek>(
    workbook: &mut Sheets<RS>,
    name: &str,
) -> Vec<calamine::Dimensions> {
    match workbook {
        Sheets::Xlsx(x) => x
            .worksheet_merge_cells(name)
            .and_then(|r| r.ok())
            .unwrap_or_default(),
        Sheets::Xls(x) => x.worksheet_merge_cells(name).unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// The sheet's formulas relative to `origin`, and how many formula cells have no cached
/// value (workbooks written by tools that never calculate). `errors` are the error results
/// calamine dropped and [`restore_errors`] put back, so those cells do have a value.
fn sheet_formulas<RS: std::io::Read + std::io::Seek>(
    workbook: &mut Sheets<RS>,
    name: &str,
    values: &Range<Data>,
    errors: &[((u32, u32), &'static str)],
    origin: (u32, u32),
) -> (Vec<(u32, u32, String)>, usize) {
    let Ok(formulas) = workbook.worksheet_formula(name) else {
        return (Vec::new(), 0);
    };
    let Some((fr, fc)) = formulas.start() else {
        return (Vec::new(), 0);
    };
    let mut out = Vec::new();
    let mut uncached = 0;
    for (r, c, f) in formulas.used_cells() {
        if f.is_empty() {
            continue;
        }
        let (row, col) = (fr + r as u32, fc + c as u32);
        // `=""` (blank-out placeholder) evaluates to an empty string, so no cache is needed.
        if f.trim() != "\"\"" {
            // An empty `<v></v>` comes back as an empty string rather than `Empty`.
            let cached = values.get_value((row, col));
            let empty = matches!(cached, None | Some(Data::Empty))
                || matches!(cached, Some(Data::String(s)) if s.is_empty());
            if empty && !errors.iter().any(|(pos, _)| *pos == (row, col)) {
                uncached += 1;
            }
        }
        if row >= origin.0 && col >= origin.1 {
            out.push((row - origin.0, col - origin.1, f.clone()));
        }
    }
    (out, uncached)
}

/// Copy each legacy array formula from its first cell to the rest of its range, as Excel
/// shows it (`{=B2:B4*2}` on K2, K3 and K4).
fn spread_array_formulas(
    formulas: &mut Vec<(u32, u32, String)>,
    origin: (u32, u32),
    arrays: &[(u32, u32, u32, u32)],
) {
    if arrays.is_empty() {
        return;
    }
    let mut at: HashMap<(u32, u32), usize> = formulas
        .iter()
        .enumerate()
        .map(|(i, (r, c, _))| ((*r, *c), i))
        .collect();
    for &(r1, c1, r2, c2) in arrays {
        let (Some(fr), Some(fc)) = (r1.checked_sub(origin.0), c1.checked_sub(origin.1)) else {
            continue;
        };
        let Some(text) = at.get(&(fr, fc)).map(|&i| formulas[i].2.clone()) else {
            continue;
        };
        for r in r1..=r2 {
            for c in c1..=c2 {
                let pos = (r - origin.0, c - origin.1);
                if let std::collections::hash_map::Entry::Vacant(e) = at.entry(pos) {
                    e.insert(formulas.len());
                    formulas.push((pos.0, pos.1, text.clone()));
                }
            }
        }
    }
}

fn describe_open_error(err: calamine::Error) -> String {
    let message = err.to_string();
    let lower = message.to_lowercase();
    if lower.contains("password") || lower.contains("encrypt") {
        "文件设置了打开密码，请在 Excel 中取消密码后再导入".into()
    } else {
        format!("无法打开表格文件：{message}")
    }
}

pub fn read_workbook(path: &Path) -> Result<RawWorkbook, String> {
    let mut workbook = open_workbook_auto(path).map_err(describe_open_error)?;
    let reader = || fs::File::open(path).map(std::io::BufReader::new);
    let mut sheet_formats = match &workbook {
        Sheets::Xlsx(_) => reader().map(read_xlsx_formats).unwrap_or_default(),
        Sheets::Xlsb(_) => reader().map(read_xlsb_formats).unwrap_or_default(),
        Sheets::Xls(_) => reader().map(read_xls_formats).unwrap_or_default(),
        Sheets::Ods(_) => Default::default(),
    };
    let date1904 = sheet_formats.date1904;
    let mut sheet_formats = std::mem::take(&mut sheet_formats.sheets);
    let metadata: Vec<calamine::Sheet> = workbook.sheets_metadata().to_vec();
    let mut sheets = Vec::new();
    let mut notices = Vec::new();
    let mut lost_cells = false;
    let mut formulas_pending = false;

    for meta in metadata {
        if meta.typ != SheetType::WorkSheet {
            continue;
        }
        let range = match workbook.worksheet_range(&meta.name) {
            Ok(r) => r,
            Err(e) => {
                notices.push(format!("工作表“{}”读取失败，已跳过：{e}", meta.name));
                continue;
            }
        };
        let (mut cells, mut origin) = range_to_grid(&range);
        if let Some(f) = sheet_formats.get(&meta.name) {
            origin = restore_errors(&mut cells, origin, &f.errors);
            apply_excel_text(&mut cells, origin, &f.texts);
        }
        let mut merge_dims = sheet_merges(&mut workbook, &meta.name);
        let errors = sheet_formats
            .get(&meta.name)
            .map_or(&[][..], |f| f.errors.as_slice());
        let (mut formulas, uncached_formulas) =
            sheet_formulas(&mut workbook, &meta.name, &range, errors, origin);
        if !matches!(workbook, Sheets::Xlsx(_)) {
            formulas_pending |= !formulas.is_empty();
            formulas.clear();
        }
        if let Some(f) = sheet_formats.get(&meta.name) {
            spread_array_formulas(&mut formulas, origin, &f.arrays);
        }
        let (formats, cell_formats) = match sheet_formats.remove(&meta.name) {
            Some(mut f) => {
                lost_cells |= f.valued > grid_cell_count(&cells);
                merge_dims.extend(f.merges.drain(..).map(|(r1, c1, r2, c2)| {
                    calamine::Dimensions {
                        start: (r1, c1),
                        end: (r2, c2),
                    }
                }));
                grid_formats(&cells, origin, f)
            }
            None => (Vec::new(), Vec::new()),
        };
        let merges = relative_merges(&merge_dims, origin);
        sheets.push(RawSheet {
            name: meta.name,
            hidden: meta.visible != SheetVisible::Visible,
            origin: [origin.0, origin.1],
            cells,
            merges,
            uncached_formulas,
            formats,
            cell_formats,
            formulas,
        });
    }
    Ok(RawWorkbook {
        sheets,
        notices,
        date1904,
        lost_cells,
        formulas_pending,
    })
}

// ── text ─────────────────────────────────────────────────────────────

fn sniff_utf16(bytes: &[u8]) -> Option<&'static Encoding> {
    let sample = bytes.len().min(4096) & !1;
    if sample < 4 {
        return None;
    }
    let pairs = (sample / 2) as f64;
    let even = bytes[..sample]
        .iter()
        .step_by(2)
        .filter(|b| **b == 0)
        .count() as f64;
    let odd = bytes[1..sample]
        .iter()
        .step_by(2)
        .filter(|b| **b == 0)
        .count() as f64;
    if odd / pairs > 0.4 && even / pairs < 0.05 {
        Some(UTF_16LE)
    } else if even / pairs > 0.4 && odd / pairs < 0.05 {
        Some(UTF_16BE)
    } else {
        None
    }
}

fn declared_xml_encoding(bytes: &[u8]) -> Option<&'static Encoding> {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(200)]);
    let head = head.trim_start();
    if !head.starts_with("<?xml") {
        return None;
    }
    let decl = &head[..head.find("?>")?];
    let idx = decl.find("encoding")?;
    let rest = decl[idx + "encoding".len()..]
        .trim_start()
        .strip_prefix('=')?
        .trim_start();
    let quote = rest.chars().next()?;
    let label = rest[1..].split(quote).next()?;
    Encoding::for_label(label.as_bytes())
}

/// Same order as `decodeText` in decode.ts: BOM, UTF-16 sniffing, strict UTF-8,
/// XML-declared encoding, then GB18030.
pub fn decode_text(bytes: &[u8]) -> (String, String) {
    if let Some((encoding, bom_len)) = Encoding::for_bom(bytes) {
        let (text, _) = encoding.decode_without_bom_handling(&bytes[bom_len..]);
        return (text.into_owned(), encoding.name().to_lowercase());
    }
    if let Some(encoding) = sniff_utf16(bytes) {
        let (text, _) = encoding.decode_without_bom_handling(bytes);
        return (text.into_owned(), encoding.name().to_lowercase());
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return (text.to_string(), "utf-8".into());
    }
    let encoding = declared_xml_encoding(bytes)
        .filter(|e| *e != encoding_rs::UTF_8)
        .unwrap_or(GB18030);
    let (text, _) = encoding.decode_without_bom_handling(bytes);
    (text.into_owned(), encoding.name().to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture(name: &str) -> String {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sample-data/edge-cases");
        dir.join(name).to_string_lossy().into_owned()
    }

    fn workbook(name: &str) -> Option<RawWorkbook> {
        match read_payload(&fixture(name)).expect("readable") {
            ReadPayload::Workbook { workbook } => Some(workbook),
            ReadPayload::Unparsed { .. } => None,
            ReadPayload::Text { .. } => panic!("{name} should be read as a workbook"),
        }
    }

    fn text(name: &str) -> (String, String) {
        match read_payload(&fixture(name)).expect("readable") {
            ReadPayload::Text { text, encoding } => (text, encoding),
            _ => panic!("{name} should be read as text"),
        }
    }

    #[test]
    fn reads_typed_cells_merges_and_sheet_state() {
        // The .xls fixture is written by SheetJS, which calamine rejects; that file must
        // come back as `Unparsed` so the frontend falls back to SheetJS.
        assert!(workbook("report_layouts.xls").is_none());
        assert!(workbook("report_layouts.xlsb").is_none());
        assert!(workbook("report_layouts.ods").is_none());
        for ext in ["xlsx"] {
            let wb = workbook(&format!("report_layouts.{ext}")).expect(ext);
            let typed = wb.sheets.iter().find(|s| s.name == "类型样例").expect(ext);
            let row = &typed.cells[1];
            let date_text = |c: &GridCell| match c {
                GridCell::Date { date, .. } => date.clone(),
                other => format!("{other:?}"),
            };
            assert_eq!(date_text(&row[1]), "2024-01-31", "{ext}");
            assert_eq!(date_text(&row[2]), "13:45:00", "{ext}");
            assert_eq!(date_text(&row[3]), "2024-02-01 09:30:15", "{ext}");
            // The serial is kept so the frontend can render the cell's Excel format.
            assert!(
                matches!(row[1], GridCell::Date { serial: Some(s), .. } if s == 45322.0),
                "{ext}"
            );
            assert_eq!(row[4], GridCell::Number(1234.5), "{ext}");
            assert_eq!(row[5], GridCell::Bool(true), "{ext}");

            let sales = wb.sheets.iter().find(|s| s.name == "区域销售").expect(ext);
            if ext == "xlsx" {
                assert!(
                    sales.merges.contains(&[2, 2, 2, 3]),
                    "{ext}: {:?}",
                    sales.merges
                );
            }
        }
        let wb = workbook("report_layouts.xlsx").unwrap();
        let hidden = wb.sheets.iter().find(|s| s.name == "隐藏参数").unwrap();
        assert!(hidden.hidden);
        let typed = wb.sheets.iter().find(|s| s.name == "类型样例").unwrap();
        assert_eq!(typed.uncached_formulas, 3);
    }

    /// Every formula desktop Excel reports (sample-data/excel-reference/formulas.json,
    /// written by scripts/excel-formula-fixture.ps1) comes back with the same text at the
    /// same address; typed cells in a formula column have none.
    #[test]
    fn reads_xlsx_formulas_like_excel() {
        let reference: Vec<serde_json::Value> = serde_json::from_str(
            &fs::read_to_string(
                PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join("../sample-data/excel-reference/formulas.json"),
            )
            .expect("formulas.json"),
        )
        .expect("json");
        let wb = workbook("formulas.xlsx").expect("parsed");
        let mut got = std::collections::BTreeMap::new();
        for s in &wb.sheets {
            for (r, c, f) in &s.formulas {
                got.insert(
                    (s.name.clone(), r + s.origin[0], c + s.origin[1]),
                    f.clone(),
                );
            }
        }
        let want: std::collections::BTreeMap<_, _> = reference
            .iter()
            .map(|cell| {
                let key = (
                    cell["sheet"].as_str().unwrap().to_string(),
                    cell["row"].as_u64().unwrap() as u32,
                    cell["col"].as_u64().unwrap() as u32,
                );
                (key, cell["formula"].as_str().unwrap().to_string())
            })
            .collect();
        assert_eq!(got, want);
        // xls / xlsb formulas come from the frontend.
        for ext in ["xls", "xlsb"] {
            let wb = workbook(&format!("formulas.{ext}")).expect(ext);
            assert!(wb.sheets.iter().all(|s| s.formulas.is_empty()), "{ext}");
        }
        // Excel calculated and saved every formula, so none is reported as uncached.
        for ext in ["xlsx", "xls", "xlsb"] {
            let wb = workbook(&format!("formulas.{ext}")).expect(ext);
            let uncached: usize = wb.sheets.iter().map(|s| s.uncached_formulas).sum();
            assert_eq!(uncached, 0, "{ext}");
        }
    }

    /// The formula fixtures open without the lost-cell fallback: `=""` cells are blank
    /// in Excel, so they must not count as cells calamine dropped.
    #[test]
    fn empty_text_formulas_are_not_lost_cells() {
        for ext in ["xlsx", "xls", "xlsb"] {
            assert!(workbook(&format!("formulas.{ext}")).is_some(), "{ext}");
        }
    }

    #[test]
    fn formats_iso_datetimes_like_serials() {
        assert_eq!(
            format_iso_datetime("2024-01-01T00:00:00.000Z"),
            "2024-01-01"
        );
        assert_eq!(
            format_iso_datetime("2024-02-01T09:30:15"),
            "2024-02-01 09:30:15"
        );
        assert_eq!(format_iso_datetime("1899-12-30T13:45:00"), "13:45:00");
        assert_eq!(format_iso_datetime("2024-03-05"), "2024-03-05");
    }

    #[test]
    fn decodes_text_encodings() {
        assert_eq!(text("gbk_encoded.csv").1, "gb18030");
        assert!(text("gbk_encoded.csv").0.starts_with("客户,城市"));
        assert_eq!(text("utf8_bom.csv").1, "utf-8");
        assert!(text("utf8_bom.csv").0.starts_with("客户"));
        assert_eq!(text("utf16le_bom.csv").1, "utf-16le");
        assert!(text("utf16le_bom.csv").0.starts_with("客户\t城市"));
        assert_eq!(text("gbk_declared.xml").1, "gbk");
        assert!(text("gbk_declared.xml").0.contains("张三"));
        assert_eq!(
            decode_text(&[b'a', 0, b',', 0, b'b', 0, b'\n', 0]).1,
            "utf-16le"
        );
    }

    #[test]
    fn rejects_bad_input() {
        assert!(read_payload(&fixture("missing.csv")).is_err());
        assert!(read_payload("C:/Windows/notepad.exe")
            .unwrap_err()
            .contains("不支持"));
        let dir = std::env::temp_dir().join("tablesmith-import-test");
        fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("secret.xlsx");
        fs::write(&fake, OLE_MAGIC).unwrap();
        assert!(read_payload(&fake.to_string_lossy())
            .unwrap_err()
            .contains("密码"));
        let empty = dir.join("empty.csv");
        fs::write(&empty, b"").unwrap();
        assert!(read_payload(&empty.to_string_lossy())
            .unwrap_err()
            .contains("为空"));
    }

    /// Writes the desktop payload for every fixture so the TypeScript test suite can
    /// assert that desktop and browser imports produce identical tables.
    /// Run with: cargo test --lib export_payloads -- --ignored
    #[test]
    #[ignore]
    fn export_payloads() {
        let out = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/import-payloads");
        fs::create_dir_all(&out).unwrap();
        let mut dirs =
            vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sample-data/edge-cases")];
        if Path::new("D:/tmp/excel").exists() {
            dirs.push(PathBuf::from("D:/tmp/excel"));
        }
        for dir in dirs {
            for entry in fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                let result = match read_payload(&path.to_string_lossy()) {
                    Ok(p) => serde_json::json!({ "ok": p }),
                    Err(e) => serde_json::json!({ "err": e }),
                };
                fs::write(out.join(format!("{name}.json")), result.to_string()).unwrap();
            }
        }
    }
}
