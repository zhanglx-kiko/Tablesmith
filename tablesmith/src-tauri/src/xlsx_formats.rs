//! Per-cell number format codes for xlsx / xlsm, which calamine does not expose.
//!
//! Reads `xl/workbook.xml` (+ rels) to map sheet names to parts, `xl/styles.xml` for
//! `numFmts` / `cellXfs`, and each worksheet's `<c r="B5" s="41">` attributes. Built-in
//! ids are resolved on the TypeScript side (`BUILTIN_FORMATS_ZH_CN` in numberFormat.ts),
//! so a cell without a custom code is reported as `#<id>`.
//!
//! Also applies Excel's whitespace rule to text, which calamine does not: a `<t>` / `<v>`
//! without `xml:space="preserve"` loses leading and trailing spaces, tabs and line breaks
//! when Excel opens the file (measured: sample-data/excel-reference/text_whitespace.xlsx.json).

use std::collections::HashMap;
use std::io::{Read, Seek};

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use zip::ZipArchive;

/// Number formats for a whole workbook.
#[derive(Debug, Default)]
pub struct WorkbookFormats {
    pub sheets: HashMap<String, SheetFormats>,
    /// Serial 0 is 1904-01-01 instead of 1900-01-00 (Mac workbooks).
    pub date1904: bool,
}

/// Format table and per-cell indexes for one sheet, in absolute sheet coordinates.
#[derive(Debug, Default)]
pub struct SheetFormats {
    /// Merged ranges `(first_row, first_col, last_row, last_col)`; only the xlsb reader
    /// fills it (calamine reports merges for xlsx / xls itself).
    pub merges: Vec<(u32, u32, u32, u32)>,
    /// Distinct format codes used in the sheet (`#14` = built-in id 14).
    pub codes: Vec<String>,
    /// `(row, col) -> index into codes`, only for cells whose format is not General.
    pub cells: HashMap<(u32, u32), u32>,
    /// Cells with a value (not blank), formatted or not. Only the binary readers fill it;
    /// used to detect cells calamine dropped.
    pub valued: usize,
    /// Formula error results calamine drops in xlsb (BrtFmlaError), restored into the grid.
    pub errors: Vec<((u32, u32), &'static str)>,
    /// Text cells whose value in Excel differs from calamine's (whitespace rule above).
    pub texts: HashMap<(u32, u32), String>,
    /// Legacy array formulas: `(first_row, first_col, last_row, last_col)`. The file
    /// stores the formula on the first cell only; Excel shows it on every cell.
    pub arrays: Vec<(u32, u32, u32, u32)>,
}

/// Parts are decoded to UTF-8 before parsing, so the reader's decoder is plain UTF-8.
/// (calamine enables quick-xml's `encoding` feature, which hides `unescape_value`.)
fn attr(e: &BytesStart, name: &[u8]) -> Option<String> {
    let decoder = Reader::from_str("").decoder();
    e.attributes()
        .flatten()
        .find(|a| a.key.local_name().as_ref() == name)
        .and_then(|a| {
            a.decode_and_unescape_value(decoder)
                .ok()
                .map(|v| v.into_owned())
        })
}

fn read_part<R: Read + Seek>(zip: &mut ZipArchive<R>, path: &str) -> Option<String> {
    let mut f = zip.by_name(path.trim_start_matches('/')).ok()?;
    let mut s = String::new();
    f.read_to_string(&mut s).ok()?;
    Some(s)
}

/// `A1` -> (row 0, col 0).
fn parse_ref(r: &str) -> Option<(u32, u32)> {
    let split = r.find(|c: char| c.is_ascii_digit())?;
    let (letters, digits) = r.split_at(split);
    let mut col: u32 = 0;
    for ch in letters.chars() {
        col = col * 26 + (ch.to_ascii_uppercase() as u32 - 'A' as u32 + 1);
    }
    let row: u32 = digits.parse().ok()?;
    Some((row.checked_sub(1)?, col.checked_sub(1)?))
}

/// Resolve a relationship target against `xl/`.
fn resolve_target(target: &str) -> String {
    if let Some(abs) = target.strip_prefix('/') {
        abs.to_string()
    } else {
        format!("xl/{target}")
    }
}

/// Style index -> format code (custom codes) or `#id` (built-in ids).
fn style_codes(styles: &str) -> Vec<String> {
    let mut custom: HashMap<u32, String> = HashMap::new();
    let mut xfs: Vec<String> = Vec::new();
    let mut reader = Reader::from_str(styles);
    let mut in_cell_xfs = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => match e.local_name().as_ref() {
                b"numFmt" => {
                    if let (Some(id), Some(code)) = (attr(&e, b"numFmtId"), attr(&e, b"formatCode"))
                    {
                        if let Ok(id) = id.parse() {
                            custom.insert(id, code);
                        }
                    }
                }
                b"cellXfs" => in_cell_xfs = true,
                b"xf" if in_cell_xfs => {
                    let id: u32 = attr(&e, b"numFmtId")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0);
                    xfs.push(custom.get(&id).cloned().unwrap_or_else(|| format!("#{id}")));
                }
                _ => {}
            },
            Ok(Event::End(e)) if e.local_name().as_ref() == b"cellXfs" => in_cell_xfs = false,
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    xfs
}

/// Relationship id -> part path, from a `.rels` part (shared with the xlsb reader).
pub fn relationships<R: Read + Seek>(
    zip: &mut ZipArchive<R>,
    rels_path: &str,
) -> HashMap<String, String> {
    let mut rels: HashMap<String, String> = HashMap::new();
    if let Some(xml) = read_part(zip, rels_path) {
        let mut reader = Reader::from_str(&xml);
        loop {
            match reader.read_event() {
                Ok(Event::Start(e)) | Ok(Event::Empty(e))
                    if e.local_name().as_ref() == b"Relationship" =>
                {
                    if let (Some(id), Some(target)) = (attr(&e, b"Id"), attr(&e, b"Target")) {
                        rels.insert(id, resolve_target(&target));
                    }
                }
                Ok(Event::Eof) | Err(_) => break,
                _ => {}
            }
        }
    }
    rels
}

/// Sheet name -> worksheet part path.
fn sheet_parts<R: Read + Seek>(zip: &mut ZipArchive<R>) -> HashMap<String, String> {
    let rels = relationships(zip, "xl/_rels/workbook.xml.rels");
    let mut out = HashMap::new();
    if let Some(xml) = read_part(zip, "xl/workbook.xml") {
        let mut reader = Reader::from_str(&xml);
        loop {
            match reader.read_event() {
                Ok(Event::Start(e)) | Ok(Event::Empty(e))
                    if e.local_name().as_ref() == b"sheet" =>
                {
                    if let (Some(name), Some(rid)) = (attr(&e, b"name"), attr(&e, b"id")) {
                        if let Some(part) = rels.get(&rid) {
                            out.insert(name, part.clone());
                        }
                    }
                }
                Ok(Event::Eof) | Err(_) => break,
                _ => {}
            }
        }
    }
    out
}

const XML_WS: &[char] = &[' ', '\t', '\n', '\r'];

fn preserves(e: &BytesStart) -> bool {
    attr(e, b"space").as_deref() == Some("preserve")
}

/// Text of one `<t>` / `<v>` element as Excel keeps it.
fn excel_text(raw: &str, preserve: bool) -> String {
    if preserve {
        raw.to_string()
    } else {
        raw.trim_matches(XML_WS).to_string()
    }
}

/// Shared strings as `(calamine's text, Excel's text)`. Runs (`<r><t>`) are trimmed one by
/// one; phonetic guides (`<rPh>`) are not part of the value.
fn shared_strings(xml: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut reader = Reader::from_str(xml);
    let (mut raw, mut excel) = (String::new(), String::new());
    let mut in_t: Option<bool> = None;
    let mut in_rph = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match e.local_name().as_ref() {
                b"si" => {
                    raw.clear();
                    excel.clear();
                }
                b"rPh" => in_rph = true,
                b"t" if !in_rph => in_t = Some(preserves(&e)),
                _ => {}
            },
            Ok(Event::Text(t)) => {
                if let (Some(preserve), Ok(text)) = (in_t, t.unescape()) {
                    raw.push_str(&text);
                    excel.push_str(&excel_text(&text, preserve));
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"t" => in_t = None,
                b"rPh" => in_rph = false,
                b"si" => out.push((std::mem::take(&mut raw), std::mem::take(&mut excel))),
                _ => {}
            },
            Ok(Event::Empty(e)) if e.local_name().as_ref() == b"si" => {
                out.push((String::new(), String::new()))
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

fn sheet_cell_styles(xml: &str, xfs: &[String], shared: &[(String, String)]) -> SheetFormats {
    let mut formats = SheetFormats::default();
    let mut index: HashMap<String, u32> = HashMap::new();
    let mut reader = Reader::from_str(xml);
    // Current text cell: position, type (s / inlineStr / str), collected raw and Excel text.
    let mut cell: Option<((u32, u32), Vec<u8>)> = None;
    let (mut raw, mut excel) = (String::new(), String::new());
    let mut text_el: Option<bool> = None;
    let mut in_rph = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) if e.local_name().as_ref() == b"c" => {
                let pos = attr(&e, b"r").as_deref().and_then(parse_ref);
                if let (Some(pos), Some(t)) = (pos, attr(&e, b"t")) {
                    if matches!(t.as_str(), "s" | "inlineStr" | "str") {
                        cell = Some((pos, t.into_bytes()));
                        raw.clear();
                        excel.clear();
                    }
                }
                let Some(s) = attr(&e, b"s").and_then(|v| v.parse::<usize>().ok()) else {
                    continue;
                };
                let Some(code) = xfs.get(s) else { continue };
                if code == "#0" {
                    continue;
                }
                let Some(pos) = pos else { continue };
                let next = formats.codes.len() as u32;
                let i = *index.entry(code.clone()).or_insert_with(|| {
                    formats.codes.push(code.clone());
                    next
                });
                formats.cells.insert(pos, i);
            }
            Ok(Event::Start(e)) | Ok(Event::Empty(e))
                if e.local_name().as_ref() == b"f"
                    && attr(&e, b"t").as_deref() == Some("array") =>
            {
                if let Some((a, b)) = attr(&e, b"ref").as_deref().and_then(|r| r.split_once(':')) {
                    if let (Some(a), Some(b)) = (parse_ref(a), parse_ref(b)) {
                        formats.arrays.push((a.0, a.1, b.0, b.1));
                    }
                }
            }
            Ok(Event::Start(e)) if cell.is_some() => match e.local_name().as_ref() {
                b"rPh" => in_rph = true,
                b"v" | b"t" if !in_rph => text_el = Some(preserves(&e)),
                _ => {}
            },
            Ok(Event::Text(t)) => {
                if let (Some(preserve), Ok(text)) = (text_el, t.unescape()) {
                    raw.push_str(&text);
                    excel.push_str(&excel_text(&text, preserve));
                }
            }
            Ok(Event::End(e)) => match e.local_name().as_ref() {
                b"v" | b"t" => text_el = None,
                b"rPh" => in_rph = false,
                b"c" => {
                    if let Some((pos, t)) = cell.take() {
                        let pair = if t == b"s" {
                            raw.trim()
                                .parse::<usize>()
                                .ok()
                                .and_then(|i| shared.get(i))
                                .cloned()
                        } else {
                            Some((std::mem::take(&mut raw), std::mem::take(&mut excel)))
                        };
                        if let Some((r, x)) = pair {
                            if r != x {
                                formats.texts.insert(pos, x);
                            }
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    formats
}

fn xlsx_date1904<R: Read + Seek>(zip: &mut ZipArchive<R>) -> bool {
    let Some(xml) = read_part(zip, "xl/workbook.xml") else {
        return false;
    };
    let mut reader = Reader::from_str(&xml);
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) | Ok(Event::Empty(e))
                if e.local_name().as_ref() == b"workbookPr" =>
            {
                return matches!(attr(&e, b"date1904").as_deref(), Some("1" | "true"));
            }
            Ok(Event::Eof) | Err(_) => return false,
            _ => {}
        }
    }
}

/// Format codes (and Excel text) per sheet name. Any structural problem yields an empty
/// result: the import still succeeds, cells just show their raw values.
pub fn read_xlsx_formats<R: Read + Seek>(reader: R) -> WorkbookFormats {
    let Ok(mut zip) = ZipArchive::new(reader) else {
        return WorkbookFormats::default();
    };
    let date1904 = xlsx_date1904(&mut zip);
    let mut out = WorkbookFormats {
        date1904,
        ..Default::default()
    };
    // No styles part: no formats, but the text rule still applies.
    let xfs = read_part(&mut zip, "xl/styles.xml")
        .map(|x| style_codes(&x))
        .unwrap_or_default();
    let shared = read_part(&mut zip, "xl/sharedStrings.xml")
        .map(|x| shared_strings(&x))
        .unwrap_or_default();
    for (name, part) in sheet_parts(&mut zip) {
        if let Some(xml) = read_part(&mut zip, &part) {
            out.sheets
                .insert(name, sheet_cell_styles(&xml, &xfs, &shared));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cell_refs() {
        assert_eq!(parse_ref("A1"), Some((0, 0)));
        assert_eq!(parse_ref("B5"), Some((4, 1)));
        assert_eq!(parse_ref("AA10"), Some((9, 26)));
        assert_eq!(parse_ref("XFD1048576"), Some((1048575, 16383)));
        assert_eq!(parse_ref("1"), None);
    }

    /// Every formatted cell in the fixture must carry the code Excel reports for it
    /// (`NumberFormat` in sample-data/excel-reference, captured from desktop Excel).
    #[test]
    fn matches_excel_number_format_per_cell() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let file =
            std::fs::File::open(root.join("sample-data/edge-cases/number_formats.xlsx")).unwrap();
        let formats = read_xlsx_formats(file).sheets;
        let reference: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(
                root.join("sample-data/excel-reference/number_formats.xlsx.json"),
            )
            .unwrap(),
        )
        .unwrap();
        let mut checked = 0;
        for sheet in reference["sheets"].as_array().unwrap() {
            let name = sheet["name"].as_str().unwrap();
            let f = &formats[name];
            for cell in sheet["cells"].as_array().unwrap() {
                let (r, c) = (
                    cell[0].as_u64().unwrap() as u32,
                    cell[1].as_u64().unwrap() as u32,
                );
                let excel = cell[3].as_str().unwrap();
                let ours = f.cells.get(&(r, c)).map(|&i| f.codes[i as usize].as_str());
                match ours {
                    // Excel localises built-in ids; the id itself is what we store.
                    Some(code) if code.starts_with('#') && code[1..].parse::<u32>().is_ok() => {}
                    // Excel reports codes in its own spelling (`[红色]`, unquoted `¥`); the
                    // rendered text is compared in numberFormat.test.ts, here only the pick.
                    Some(code) => {
                        let canon =
                            |s: &str| s.replace("[红色]", "[Red]").replace(['"', '!', '\\'], "");
                        assert_eq!(canon(code), canon(excel), "{name} r{r} c{c}")
                    }
                    None => assert_eq!(excel, "G/通用格式", "{name} r{r} c{c} lost its format"),
                }
                checked += 1;
            }
        }
        assert!(checked > 1000, "only {checked} cells checked");
    }

    /// builtin_format_ids.{xlsx,xlsb,xls}: row r has numFmtId r on columns B-D (the xlsb /
    /// xls copies were saved by desktop Excel from the xlsx). Every container must report
    /// the same id per cell.
    #[test]
    fn reads_builtin_ids_from_every_container() {
        let dir =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sample-data/edge-cases");
        let open =
            |ext: &str| std::fs::File::open(dir.join(format!("builtin_format_ids.{ext}"))).unwrap();
        let containers = [
            ("xlsx", read_xlsx_formats(open("xlsx")).sheets),
            (
                "xlsb",
                crate::binary_formats::read_xlsb_formats(open("xlsb")).sheets,
            ),
            (
                "xls",
                crate::binary_formats::read_xls_formats(open("xls")).sheets,
            ),
        ];
        for (ext, all) in &containers {
            let f = all
                .get("ids")
                .unwrap_or_else(|| panic!("{ext}: sheet 'ids' missing, got {:?}", all.keys()));
            for id in 1..82u32 {
                for col in 1..=3u32 {
                    let code = f
                        .cells
                        .get(&(id, col))
                        .map(|&i| f.codes[i as usize].as_str());
                    // Excel may save a built-in as an equivalent id (27 -> 57, both
                    // yyyy"年"m"月" in zh-CN) or as an explicit code; the rendered text is
                    // compared with Excel's in display.test.ts. Here: the format is not lost.
                    assert!(code.is_some(), "{ext}: id {id} col {col} lost its format");
                }
            }
        }
    }

    /// Timing for large files: `cargo test --release --lib format_read_timing -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn format_read_timing() {
        let root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        for path in [
            root.join("target/perf/big_50k.xlsx"),
            std::path::PathBuf::from("D:/tmp/excel/Financial_BP_Rolling_Forecast.xlsx"),
        ] {
            if !path.exists() {
                continue;
            }
            let t = std::time::Instant::now();
            let p = crate::import::read_payload(&path.to_string_lossy()).unwrap();
            let total = t.elapsed();
            let t = std::time::Instant::now();
            let f = read_xlsx_formats(std::fs::File::open(&path).unwrap()).sheets;
            let fmt = t.elapsed();
            let cells: usize = f.values().map(|s| s.cells.len()).sum();
            let json = serde_json::to_string(&p).unwrap().len();
            println!("{}: read_payload {total:?} (of which formats {fmt:?}), {cells} formatted cells, payload {} KB", path.display(), json / 1024);
        }
    }

    #[test]
    fn resolves_relationship_targets() {
        assert_eq!(
            resolve_target("worksheets/sheet1.xml"),
            "xl/worksheets/sheet1.xml"
        );
        assert_eq!(
            resolve_target("/xl/worksheets/sheet1.xml"),
            "xl/worksheets/sheet1.xml"
        );
    }
}
