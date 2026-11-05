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

/// Files above this size are rejected before parsing; mirrors MAX_IMPORT_BYTES in index.ts.
pub const MAX_IMPORT_BYTES: u64 = 200 * 1024 * 1024;

pub const SPREADSHEET_EXTENSIONS: &[&str] = &["xlsx", "xlsm", "xlsb", "xls", "ods"];
/// calamine silently drops cells in some xlsb files and rejects ods written by other
/// tools, so these always go to SheetJS on the frontend.
const FRONTEND_ONLY_EXTENSIONS: &[&str] = &["xlsb", "ods"];
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
    Date { date: String },
    Error { error: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawSheet {
    pub name: String,
    pub hidden: bool,
    pub cells: Vec<Vec<GridCell>>,
    /// Inclusive `[first_row, first_col, last_row, last_col]`, relative to `cells`.
    pub merges: Vec<[u32; 4]>,
    pub uncached_formulas: usize,
}

#[derive(Debug, Serialize)]
pub struct RawWorkbook {
    pub sheets: Vec<RawSheet>,
    pub notices: Vec<String>,
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

fn format_duration(serial: f64) -> String {
    let total = (serial * 86_400.0).round() as i64;
    let sign = if total < 0 { "-" } else { "" };
    let total = total.abs();
    format!(
        "{sign}{}:{:02}:{:02}",
        total / 3600,
        (total / 60) % 60,
        total % 60
    )
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
            if dt.is_duration() {
                return GridCell::Date {
                    date: format_duration(serial),
                };
            }
            match dt.as_datetime() {
                Some(value) => GridCell::Date {
                    date: format_excel_datetime(serial, value),
                },
                None => GridCell::Number(serial),
            }
        }
        Data::DateTimeIso(s) => GridCell::Date {
            date: format_iso_datetime(s),
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

/// Formula cells whose cached value is missing (workbooks written by tools that never calculate).
fn count_uncached_formulas<RS: std::io::Read + std::io::Seek>(
    workbook: &mut Sheets<RS>,
    name: &str,
    values: &Range<Data>,
) -> usize {
    let Ok(formulas) = workbook.worksheet_formula(name) else {
        return 0;
    };
    let Some((fr, fc)) = formulas.start() else {
        return 0;
    };
    formulas
        .used_cells()
        // `=""` (blank-out placeholder) evaluates to an empty string, so no cache is needed.
        .filter(|(_, _, f)| !f.is_empty() && f.trim() != "\"\"")
        .filter(|(r, c, _)| {
            // An empty `<v></v>` comes back as an empty string rather than `Empty`.
            let cached = values.get_value((fr + *r as u32, fc + *c as u32));
            matches!(cached, None | Some(Data::Empty))
                || matches!(cached, Some(Data::String(s)) if s.is_empty())
        })
        .count()
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
    let metadata: Vec<calamine::Sheet> = workbook.sheets_metadata().to_vec();
    let mut sheets = Vec::new();
    let mut notices = Vec::new();

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
        let (cells, origin) = range_to_grid(&range);
        let merges = relative_merges(&sheet_merges(&mut workbook, &meta.name), origin);
        let uncached_formulas = count_uncached_formulas(&mut workbook, &meta.name, &range);
        sheets.push(RawSheet {
            name: meta.name,
            hidden: meta.visible != SheetVisible::Visible,
            cells,
            merges,
            uncached_formulas,
        });
    }
    Ok(RawWorkbook { sheets, notices })
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
            assert_eq!(
                row[1],
                GridCell::Date {
                    date: "2024-01-31".into()
                },
                "{ext}"
            );
            assert_eq!(
                row[2],
                GridCell::Date {
                    date: "13:45:00".into()
                },
                "{ext}"
            );
            assert_eq!(
                row[3],
                GridCell::Date {
                    date: "2024-02-01 09:30:15".into()
                },
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
