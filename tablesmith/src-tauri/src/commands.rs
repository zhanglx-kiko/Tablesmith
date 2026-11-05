use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use calamine::{open_workbook, Reader, Xlsx, Xls};
use csv::ReaderBuilder;
use quick_xml::events::Event;

/// Represents the full data extracted from a file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileData {
    pub file_name: String,
    pub file_type: String,
    pub sheets: Vec<SheetData>,
    pub raw_content: Option<String>,
}

/// Represents a single sheet / table of data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetData {
    pub name: String,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

// ── helpers ──────────────────────────────────────────────────────────

fn cell_to_string(cell: &calamine::Data) -> String {
    match cell {
        calamine::Data::Empty => String::new(),
        calamine::Data::String(s) => s.clone(),
        calamine::Data::Float(f) => {
            if *f == (*f as i64) as f64 {
                format!("{}", *f as i64)
            } else {
                format!("{f}")
            }
        }
        calamine::Data::Int(i) => format!("{i}"),
        calamine::Data::Bool(b) => format!("{b}"),
        calamine::Data::DateTime(dt) => {
            if let Some(d) = dt.as_datetime() {
                let s = d.to_string();
                if s.ends_with(" 00:00:00") {
                    s.trim_end_matches(" 00:00:00").to_string()
                } else {
                    s
                }
            } else {
                format!("{dt}")
            }
        }
        calamine::Data::DateTimeIso(s) => s.clone(),
        calamine::Data::DurationIso(s) => s.clone(),
        calamine::Data::Error(e) => format!("{e:?}"),
    }
}

/// Detect the most likely header row index in the first few rows of a spreadsheet.
/// Prevents single-cell banner titles (e.g. "Revenue Build") from usurping actual column headers.
fn detect_header_row_index(raw_rows: &[Vec<String>]) -> usize {
    if raw_rows.is_empty() || raw_rows.len() == 1 {
        return 0;
    }
    let max_inspect = raw_rows.len().min(8);
    let mut best_idx = 0;
    let mut best_score: f64 = -1.0;

    for (i, row) in raw_rows.iter().enumerate().take(max_inspect) {
        let non_empty: Vec<&String> = row.iter().filter(|c| !c.trim().is_empty()).collect();
        let filled_count = non_empty.len();
        if filled_count == 0 {
            continue;
        }

        // Count strings that are non-numeric labels
        let string_count = non_empty
            .iter()
            .filter(|c| c.trim().parse::<f64>().is_err())
            .count();

        let mut set = HashSet::new();
        for c in &non_empty {
            set.insert(c.trim());
        }
        let unique_count = set.len();

        let mut score = (filled_count as f64) * 2.0 + (string_count as f64) * 1.5 + (unique_count as f64);
        if filled_count == 1 {
            score = 0.5; // title banner penalty
        }

        if score > best_score {
            best_score = score;
            best_idx = i;
        }
    }

    best_idx
}

/// Normalizes raw spreadsheet rows:
/// 1. Auto-detects real header row (bypassing title banners).
/// 2. Guarantees non-empty and unique headers (e.g. "列1", "列2", "Amount", "Amount_1").
/// 3. Normalizes all rows to exact header length (padding missing cells, trimming excess).
/// 4. Discards trailing/interstitial empty rows.
fn normalize_sheet_data(name: String, raw_rows: Vec<Vec<String>>) -> SheetData {
    if raw_rows.is_empty() {
        return SheetData {
            name,
            headers: Vec::new(),
            rows: Vec::new(),
        };
    }

    let header_idx = detect_header_row_index(&raw_rows);
    let raw_headers = &raw_rows[header_idx];

    let mut max_cols = raw_headers.len();
    for r in &raw_rows {
        if r.len() > max_cols {
            max_cols = r.len();
        }
    }
    if max_cols == 0 {
        max_cols = 1;
    }

    // Build unique, non-empty headers
    let mut headers = Vec::new();
    let mut counts: HashMap<String, usize> = HashMap::new();

    for c in 0..max_cols {
        let mut raw_h = raw_headers
            .get(c)
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        if raw_h.is_empty() {
            raw_h = format!("列{}", c + 1);
        }

        let entry = counts.entry(raw_h.clone()).or_insert(0);
        let final_h = if *entry == 0 {
            raw_h
        } else {
            format!("{raw_h}_{entry}")
        };
        *entry += 1;
        headers.push(final_h);
    }

    // Collect data rows after header_idx, skipping empty rows
    let mut rows = Vec::new();
    for r in raw_rows.into_iter().skip(header_idx + 1) {
        let has_data = r.iter().any(|c| !c.trim().is_empty());
        if !has_data {
            continue;
        }

        let mut row = Vec::with_capacity(max_cols);
        for c in 0..max_cols {
            let val = r.get(c).map(|s| s.trim().to_string()).unwrap_or_default();
            row.push(val);
        }
        rows.push(row);
    }

    SheetData {
        name,
        headers,
        rows,
    }
}

fn read_xlsx(path: &str) -> Result<Vec<SheetData>, String> {
    let mut workbook: Xlsx<_> =
        open_workbook(path).map_err(|e| format!("Failed to open xlsx: {e}"))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let mut sheets = Vec::new();

    for name in sheet_names {
        let range = workbook
            .worksheet_range(&name)
            .map_err(|e| format!("Failed to read sheet '{name}': {e}"))?;

        let raw_rows: Vec<Vec<String>> = range
            .rows()
            .map(|row| row.iter().map(cell_to_string).collect())
            .collect();

        let sheet = normalize_sheet_data(name, raw_rows);
        sheets.push(sheet);
    }

    Ok(sheets)
}

fn read_xls(path: &str) -> Result<Vec<SheetData>, String> {
    let mut workbook: Xls<_> =
        open_workbook(path).map_err(|e| format!("Failed to open xls: {e}"))?;
    let sheet_names = workbook.sheet_names().to_vec();
    let mut sheets = Vec::new();

    for name in sheet_names {
        let range = workbook
            .worksheet_range(&name)
            .map_err(|e| format!("Failed to read sheet '{name}': {e}"))?;

        let raw_rows: Vec<Vec<String>> = range
            .rows()
            .map(|row| row.iter().map(cell_to_string).collect())
            .collect();

        let sheet = normalize_sheet_data(name, raw_rows);
        sheets.push(sheet);
    }

    Ok(sheets)
}

fn decode_text_bytes(bytes: &[u8]) -> String {
    let slice = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        bytes
    };

    if let Ok(s) = std::str::from_utf8(slice) {
        return s.to_string();
    }

    // Fallback to GB18030 (covers GBK, GB2312, and Chinese Windows Excel exports)
    let (cow, _encoding, _had_errors) = encoding_rs::GB18030.decode(slice);
    cow.into_owned()
}

fn detect_csv_delimiter(content: &str) -> u8 {
    let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).take(10).collect();
    if lines.is_empty() {
        return b',';
    }

    let candidates = [b',', b';', b'\t', b'|'];
    let mut best_delim = b',';
    let mut best_score = -100.0;

    for &delim in &candidates {
        let counts: Vec<usize> = lines
            .iter()
            .map(|l| l.as_bytes().iter().filter(|&&b| b == delim).count())
            .collect();
        let min_count = counts.iter().cloned().min().unwrap_or(0);
        let max_count = counts.iter().cloned().max().unwrap_or(0);
        let avg = counts.iter().sum::<usize>() as f64 / counts.len() as f64;

        if avg >= 1.0 {
            let variance = (max_count - min_count) as f64;
            let score = avg * 2.0 - variance * 1.5;
            if score > best_score {
                best_score = score;
                best_delim = delim;
            }
        }
    }

    best_delim
}

fn read_csv_file(path: &str) -> Result<Vec<SheetData>, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let content = decode_text_bytes(&bytes);
    let delim = detect_csv_delimiter(&content);

    let mut csv_reader = ReaderBuilder::new()
        .delimiter(delim)
        .has_headers(false)
        .flexible(true)
        .from_reader(content.as_bytes());

    let mut raw_rows: Vec<Vec<String>> = Vec::new();
    for result in csv_reader.records() {
        let record = result.map_err(|e| e.to_string())?;
        raw_rows.push(record.iter().map(|f| f.to_string()).collect());
    }

    let sheet = normalize_sheet_data("Sheet1".to_string(), raw_rows);
    Ok(vec![sheet])
}

/// Helper struct for nested XML hierarchy preservation
#[derive(Debug, Clone)]
struct ActiveElement {
    clean_tag: String,
    attrs: HashMap<String, String>,
    child_texts: HashMap<String, String>,
}

fn clean_xml_tag(raw_tag: &str) -> String {
    if let Some((_ns, name)) = raw_tag.split_once(':') {
        name.to_string()
    } else {
        raw_tag.to_string()
    }
}

fn read_xml_file(path: &str) -> Result<(Vec<SheetData>, Option<String>), String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let content = decode_text_bytes(&bytes);
    let raw = content.clone();

    let mut reader = quick_xml::Reader::from_str(&content);
    reader.config_mut().trim_text(true);

    let mut table_map: HashMap<String, Vec<HashMap<String, String>>> = HashMap::new();
    let mut col_order_map: HashMap<String, Vec<String>> = HashMap::new();

    let mut element_stack: Vec<ActiveElement> = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let raw_tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let clean_tag = clean_xml_tag(&raw_tag);
                let mut attrs: HashMap<String, String> = HashMap::new();
                for a in e.attributes().flatten() {
                    let k = clean_xml_tag(&String::from_utf8_lossy(a.key.as_ref()));
                    let v = a.decode_and_unescape_value(reader.decoder()).unwrap_or_default().to_string();
                    attrs.insert(k, v);
                }

                element_stack.push(ActiveElement {
                    clean_tag,
                    attrs,
                    child_texts: HashMap::new(),
                });
            }
            Ok(Event::Empty(ref e)) => {
                let raw_tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let clean_tag = clean_xml_tag(&raw_tag);
                let mut attrs: HashMap<String, String> = HashMap::new();
                for a in e.attributes().flatten() {
                    let k = clean_xml_tag(&String::from_utf8_lossy(a.key.as_ref()));
                    let v = a.decode_and_unescape_value(reader.decoder()).unwrap_or_default().to_string();
                    attrs.insert(k, v);
                }

                if !attrs.is_empty() {
                    let cols = col_order_map.entry(clean_tag.clone()).or_default();
                    for k in attrs.keys() {
                        if !cols.contains(k) {
                            cols.push(k.clone());
                        }
                    }
                    table_map.entry(clean_tag).or_default().push(attrs);
                }
            }
            Ok(Event::Text(ref e)) => {
                let text = e.unescape().unwrap_or_default().trim().to_string();
                if !text.is_empty() {
                    let len = element_stack.len();
                    if len >= 1 {
                        // Current leaf tag text
                        let leaf = &mut element_stack[len - 1];
                        leaf.child_texts.insert("_text".to_string(), text.clone());

                        // If parent exists, record leaf_tag: text on parent
                        if len >= 2 {
                            let leaf_clean_tag = leaf.clean_tag.clone();
                            let parent = &mut element_stack[len - 2];
                            parent.child_texts.insert(leaf_clean_tag, text);
                        }
                    }
                }
            }
            Ok(Event::End(ref _e)) => {
                if let Some(elem) = element_stack.pop() {
                    let mut unified_row: HashMap<String, String> = elem.attrs;
                    for (k, v) in elem.child_texts {
                        if k != "_text" || unified_row.is_empty() {
                            unified_row.insert(k, v);
                        }
                    }

                    // Only emit if it contains meaningful fields or is not a wrapper
                    if !unified_row.is_empty() && unified_row.len() > 0 {
                        let cols = col_order_map.entry(elem.clean_tag.clone()).or_default();
                        for k in unified_row.keys() {
                            if !cols.contains(k) {
                                cols.push(k.clone());
                            }
                        }
                        table_map.entry(elem.clean_tag).or_default().push(unified_row);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }

    let mut sheets = Vec::new();
    for (tag, row_maps) in table_map {
        let headers = col_order_map.get(&tag).cloned().unwrap_or_default();
        if headers.is_empty() || row_maps.is_empty() {
            continue;
        }

        let rows: Vec<Vec<String>> = row_maps
            .into_iter()
            .map(|row_map| {
                headers
                    .iter()
                    .map(|h| row_map.get(h).cloned().unwrap_or_default())
                    .collect()
            })
            .collect();

        sheets.push(SheetData {
            name: tag,
            headers,
            rows,
        });
    }

    sheets.sort_by(|a, b| b.rows.len().cmp(&a.rows.len()));

    Ok((sheets, Some(raw)))
}

/// Specialized enterprise parser for XML Schema Definition (.xsd) files
fn read_xsd_file(path: &str) -> Result<(Vec<SheetData>, Option<String>), String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let content = decode_text_bytes(&bytes);
    let raw = content.clone();

    let mut reader = quick_xml::Reader::from_str(&content);
    reader.config_mut().trim_text(true);

    let mut elements_list: Vec<HashMap<String, String>> = Vec::new();
    let mut attributes_list: Vec<HashMap<String, String>> = Vec::new();
    let mut simple_types_list: Vec<HashMap<String, String>> = Vec::new();
    let mut constraints_list: Vec<HashMap<String, String>> = Vec::new();
    let mut schema_info_list: Vec<HashMap<String, String>> = Vec::new();

    let mut current_element_stack: Vec<String> = Vec::new();
    let mut current_simple_type: Option<(String, String, Vec<String>)> = None; // (name, base, enums)
    let mut current_constraint: Option<(String, String, String, String, String)> = None; // (name, kind, selector, field, refer)

    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let raw_tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let clean_tag = clean_xml_tag(&raw_tag);
                let mut attrs: HashMap<String, String> = HashMap::new();
                for a in e.attributes().flatten() {
                    let k = clean_xml_tag(&String::from_utf8_lossy(a.key.as_ref()));
                    let v = a.decode_and_unescape_value(reader.decoder()).unwrap_or_default().to_string();
                    attrs.insert(k, v);
                }

                match clean_tag.as_str() {
                    "schema" => {
                        for (k, v) in attrs {
                            let mut row = HashMap::new();
                            row.insert("属性名".to_string(), k);
                            row.insert("属性值".to_string(), v);
                            schema_info_list.push(row);
                        }
                    }
                    "simpleType" => {
                        let name = attrs.get("name").cloned().unwrap_or_default();
                        current_simple_type = Some((name, String::new(), Vec::new()));
                    }
                    "restriction" => {
                        if let Some((_, ref mut base, _)) = current_simple_type {
                            if let Some(b) = attrs.get("base") {
                                *base = clean_xml_tag(b);
                            }
                        }
                    }
                    "element" => {
                        let name = attrs.get("name").cloned().unwrap_or_default();
                        let elem_type = attrs.get("type").map(|s| clean_xml_tag(s)).unwrap_or_else(|| "complexType".to_string());
                        let parent = current_element_stack.last().cloned().unwrap_or_else(|| "Root".to_string());
                        let min_occurs = attrs.get("minOccurs").cloned().unwrap_or_else(|| "1".to_string());
                        let max_occurs = attrs.get("maxOccurs").cloned().unwrap_or_else(|| "1".to_string());

                        if !name.is_empty() {
                            let mut row = HashMap::new();
                            row.insert("元素名称".to_string(), name.clone());
                            row.insert("所属父节点".to_string(), parent);
                            row.insert("数据类型".to_string(), elem_type);
                            row.insert("最小出现".to_string(), min_occurs);
                            row.insert("最大出现".to_string(), max_occurs);
                            elements_list.push(row);
                            current_element_stack.push(name);
                        }
                    }
                    "attribute" => {
                        let name = attrs.get("name").cloned().unwrap_or_default();
                        let attr_type = attrs.get("type").map(|s| clean_xml_tag(s)).unwrap_or_else(|| "string".to_string());
                        let use_type = attrs.get("use").cloned().unwrap_or_else(|| "optional".to_string());
                        let default_val = attrs.get("default").cloned().unwrap_or_default();
                        let owner = current_element_stack.last().cloned().unwrap_or_else(|| "Schema".to_string());

                        if !name.is_empty() {
                            let mut row = HashMap::new();
                            row.insert("属性名称".to_string(), name);
                            row.insert("所属元素".to_string(), owner);
                            row.insert("数据类型".to_string(), attr_type);
                            row.insert("约束 (Use)".to_string(), use_type);
                            row.insert("默认值".to_string(), default_val);
                            attributes_list.push(row);
                        }
                    }
                    "key" => {
                        let name = attrs.get("name").cloned().unwrap_or_default();
                        current_constraint = Some((name, "主键 (Key)".to_string(), String::new(), String::new(), String::new()));
                    }
                    "keyref" => {
                        let name = attrs.get("name").cloned().unwrap_or_default();
                        let refer = attrs.get("refer").cloned().unwrap_or_default();
                        current_constraint = Some((name, "外键 (KeyRef)".to_string(), String::new(), String::new(), refer));
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                let raw_tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let clean_tag = clean_xml_tag(&raw_tag);
                let mut attrs: HashMap<String, String> = HashMap::new();
                for a in e.attributes().flatten() {
                    let k = clean_xml_tag(&String::from_utf8_lossy(a.key.as_ref()));
                    let v = a.decode_and_unescape_value(reader.decoder()).unwrap_or_default().to_string();
                    attrs.insert(k, v);
                }

                match clean_tag.as_str() {
                    "enumeration" => {
                        if let Some((_, _, ref mut enums)) = current_simple_type {
                            if let Some(val) = attrs.get("value") {
                                enums.push(val.clone());
                            }
                        }
                    }
                    "element" => {
                        let name = attrs.get("name").cloned().unwrap_or_default();
                        let elem_type = attrs.get("type").map(|s| clean_xml_tag(s)).unwrap_or_else(|| "string".to_string());
                        let parent = current_element_stack.last().cloned().unwrap_or_else(|| "Root".to_string());
                        let min_occurs = attrs.get("minOccurs").cloned().unwrap_or_else(|| "1".to_string());
                        let max_occurs = attrs.get("maxOccurs").cloned().unwrap_or_else(|| "1".to_string());

                        if !name.is_empty() {
                            let mut row = HashMap::new();
                            row.insert("元素名称".to_string(), name);
                            row.insert("所属父节点".to_string(), parent);
                            row.insert("数据类型".to_string(), elem_type);
                            row.insert("最小出现".to_string(), min_occurs);
                            row.insert("最大出现".to_string(), max_occurs);
                            elements_list.push(row);
                        }
                    }
                    "attribute" => {
                        let name = attrs.get("name").cloned().unwrap_or_default();
                        let attr_type = attrs.get("type").map(|s| clean_xml_tag(s)).unwrap_or_else(|| "string".to_string());
                        let use_type = attrs.get("use").cloned().unwrap_or_else(|| "optional".to_string());
                        let default_val = attrs.get("default").cloned().unwrap_or_default();
                        let owner = current_element_stack.last().cloned().unwrap_or_else(|| "Schema".to_string());

                        if !name.is_empty() {
                            let mut row = HashMap::new();
                            row.insert("属性名称".to_string(), name);
                            row.insert("所属元素".to_string(), owner);
                            row.insert("数据类型".to_string(), attr_type);
                            row.insert("约束 (Use)".to_string(), use_type);
                            row.insert("默认值".to_string(), default_val);
                            attributes_list.push(row);
                        }
                    }
                    "selector" => {
                        if let Some((_, _, ref mut selector, _, _)) = current_constraint {
                            if let Some(xpath) = attrs.get("xpath") {
                                *selector = xpath.clone();
                            }
                        }
                    }
                    "field" => {
                        if let Some((_, _, _, ref mut field, _)) = current_constraint {
                            if let Some(xpath) = attrs.get("xpath") {
                                *field = xpath.clone();
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let raw_tag = String::from_utf8_lossy(e.name().as_ref()).to_string();
                let clean_tag = clean_xml_tag(&raw_tag);

                match clean_tag.as_str() {
                    "simpleType" => {
                        if let Some((name, base, enums)) = current_simple_type.take() {
                            let mut row = HashMap::new();
                            row.insert("类型名称".to_string(), name);
                            row.insert("基础数据类型".to_string(), base);
                            row.insert("枚举候选值".to_string(), enums.join(" | "));
                            simple_types_list.push(row);
                        }
                    }
                    "key" | "keyref" => {
                        if let Some((name, kind, selector, field, refer)) = current_constraint.take() {
                            let mut row = HashMap::new();
                            row.insert("约束名称".to_string(), name);
                            row.insert("约束类型".to_string(), kind);
                            row.insert("目标选择器 (Selector)".to_string(), selector);
                            row.insert("对应字段 (Field)".to_string(), field);
                            row.insert("引用主键 (Refer)".to_string(), refer);
                            constraints_list.push(row);
                        }
                    }
                    "element" => {
                        current_element_stack.pop();
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XSD parse error: {e}")),
            _ => {}
        }
        buf.clear();
    }

    let mut sheets = Vec::new();

    // 1. Elements sheet
    if !elements_list.is_empty() {
        let headers = vec![
            "元素名称".to_string(),
            "所属父节点".to_string(),
            "数据类型".to_string(),
            "最小出现".to_string(),
            "最大出现".to_string(),
        ];
        let rows = elements_list
            .into_iter()
            .map(|row| headers.iter().map(|h| row.get(h).cloned().unwrap_or_default()).collect())
            .collect();
        sheets.push(SheetData {
            name: "Elements (元素结构)".to_string(),
            headers,
            rows,
        });
    }

    // 2. Attributes sheet
    if !attributes_list.is_empty() {
        let headers = vec![
            "属性名称".to_string(),
            "所属元素".to_string(),
            "数据类型".to_string(),
            "约束 (Use)".to_string(),
            "默认值".to_string(),
        ];
        let rows = attributes_list
            .into_iter()
            .map(|row| headers.iter().map(|h| row.get(h).cloned().unwrap_or_default()).collect())
            .collect();
        sheets.push(SheetData {
            name: "Attributes (字段属性)".to_string(),
            headers,
            rows,
        });
    }

    // 3. SimpleTypes sheet
    if !simple_types_list.is_empty() {
        let headers = vec![
            "类型名称".to_string(),
            "基础数据类型".to_string(),
            "枚举候选值".to_string(),
        ];
        let rows = simple_types_list
            .into_iter()
            .map(|row| headers.iter().map(|h| row.get(h).cloned().unwrap_or_default()).collect())
            .collect();
        sheets.push(SheetData {
            name: "SimpleTypes (枚举与类型)".to_string(),
            headers,
            rows,
        });
    }

    // 4. Constraints sheet
    if !constraints_list.is_empty() {
        let headers = vec![
            "约束名称".to_string(),
            "约束类型".to_string(),
            "目标选择器 (Selector)".to_string(),
            "对应字段 (Field)".to_string(),
            "引用主键 (Refer)".to_string(),
        ];
        let rows = constraints_list
            .into_iter()
            .map(|row| headers.iter().map(|h| row.get(h).cloned().unwrap_or_default()).collect())
            .collect();
        sheets.push(SheetData {
            name: "Constraints (主外键约束)".to_string(),
            headers,
            rows,
        });
    }

    // 5. SchemaInfo sheet
    if !schema_info_list.is_empty() {
        let headers = vec!["属性名".to_string(), "属性值".to_string()];
        let rows = schema_info_list
            .into_iter()
            .map(|row| headers.iter().map(|h| row.get(h).cloned().unwrap_or_default()).collect())
            .collect();
        sheets.push(SheetData {
            name: "SchemaSummary (元信息)".to_string(),
            headers,
            rows,
        });
    }

    Ok((sheets, Some(raw)))
}

// ── commands ─────────────────────────────────────────────────────────

/// Read and parse a file into structured `FileData`.
#[tauri::command]
pub async fn read_file_data(path: String) -> Result<FileData, String> {
    let p = Path::new(&path);
    let file_name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "xlsx" => {
            let sheets = read_xlsx(&path)?;
            Ok(FileData {
                file_name,
                file_type: "xlsx".into(),
                sheets,
                raw_content: None,
            })
        }
        "xls" => {
            let sheets = read_xls(&path)?;
            Ok(FileData {
                file_name,
                file_type: "xls".into(),
                sheets,
                raw_content: None,
            })
        }
        "csv" => {
            let sheets = read_csv_file(&path)?;
            Ok(FileData {
                file_name,
                file_type: "csv".into(),
                sheets,
                raw_content: None,
            })
        }
        "xml" => {
            let (sheets, raw) = read_xml_file(&path)?;
            Ok(FileData {
                file_name,
                file_type: "xml".into(),
                sheets,
                raw_content: raw,
            })
        }
        "xsd" => {
            let (sheets, raw) = read_xsd_file(&path)?;
            Ok(FileData {
                file_name,
                file_type: "xsd".into(),
                sheets,
                raw_content: raw,
            })
        }
        "json" => {
            let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            Ok(FileData {
                file_name,
                file_type: "json".into(),
                sheets: Vec::new(),
                raw_content: Some(raw),
            })
        }
        "yaml" | "yml" => {
            let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            Ok(FileData {
                file_name,
                file_type: "yaml".into(),
                sheets: Vec::new(),
                raw_content: Some(raw),
            })
        }
        other => Err(format!("Unsupported file type: .{other}")),
    }
}

/// Write arbitrary text content to a file path (creating parent directories if needed).
#[tauri::command]
pub async fn save_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
        }
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

/// Write arbitrary binary content (bytes) to a file path (creating parent directories if needed).
#[tauri::command]
pub async fn save_binary_file(path: String, data: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {e}"))?;
        }
    }
    fs::write(&path, data).map_err(|e| e.to_string())
}

/// Check if a target file path already exists, and if so, return a non-colliding
/// path by appending (1), (2), etc. before the extension.
/// For example: "test.xlsx" -> "test (1).xlsx" -> "test (2).xlsx"
#[tauri::command]
pub async fn get_unique_filepath(path: String) -> Result<String, String> {
    if path.trim().is_empty() {
        return Err("File path is empty".into());
    }
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(path);
    }

    let parent = p.parent().unwrap_or_else(|| Path::new(""));
    let file_stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let extension = p.extension().and_then(|s| s.to_str());

    // If file_stem already ends with " (N)", parse N and increment to prevent "name (1) (1).ext"
    let (base_stem, start_counter) = {
        if let Some(open_paren) = file_stem.rfind(" (") {
            if file_stem.ends_with(')') {
                let num_str = &file_stem[open_paren + 2..file_stem.len() - 1];
                if let Ok(n) = num_str.parse::<usize>() {
                    (&file_stem[..open_paren], n + 1)
                } else {
                    (file_stem, 1)
                }
            } else {
                (file_stem, 1)
            }
        } else {
            (file_stem, 1)
        }
    };

    let mut counter = start_counter;
    loop {
        let new_filename = match extension {
            Some(ext) => format!("{base_stem} ({counter}).{ext}"),
            None => format!("{base_stem} ({counter})"),
        };
        let candidate = parent.join(&new_filename);
        if !candidate.exists() {
            return Ok(candidate.to_string_lossy().to_string());
        }
        counter += 1;
        if counter > 10000 {
            return Err("Too many duplicate files in directory".into());
        }
    }
}

/// Export structured data as a CSV file.
#[tauri::command]
pub async fn export_csv(
    path: String,
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
) -> Result<(), String> {
    let file = fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut writer = csv::Writer::from_writer(file);

    writer.write_record(&headers).map_err(|e| e.to_string())?;
    for row in &rows {
        writer.write_record(row).map_err(|e| e.to_string())?;
    }
    writer.flush().map_err(|e| e.to_string())?;

    Ok(())
}

/// Open the system file manager and highlight the specified file.
#[tauri::command]
pub async fn show_in_folder(path: String) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("File path is empty".into());
    }
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("File does not exist: {path}"));
    }

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to open finder: {e}"))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        use std::process::Command;
        let p = std::path::Path::new(&path);
        let dir = p.parent().unwrap_or(p);
        Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {e}"))?;
        Ok(())
    }
}

/// Export data as an Excel file (not yet implemented in Rust).
#[tauri::command]
pub async fn export_excel(
    _path: String,
    _sheet_name: String,
    _headers: Vec<String>,
    _rows: Vec<Vec<String>>,
) -> Result<(), String> {
    Err("Excel export not yet implemented in Rust, use frontend xlsx library".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_tmp_excel_dir() {
        tauri::async_runtime::block_on(async {
            let dir = Path::new("D:/tmp/excel");
            if !dir.exists() {
                println!("D:/tmp/excel does not exist, skipping");
                return;
            }

            for entry in fs::read_dir(dir).unwrap() {
                let entry = entry.unwrap();
                let path = entry.path();
                let name = path.file_name().unwrap().to_string_lossy();
                if name.ends_with(".md") {
                    continue;
                }

                println!("\n=== Testing Rust read_file_data: {} ===", name);
                let path_str = path.to_string_lossy().to_string();
                match read_file_data(path_str).await {
                    Ok(data) => {
                        println!("SUCCESS: file_name={}, sheets count={}", data.file_name, data.sheets.len());
                        for (i, s) in data.sheets.iter().enumerate() {
                            println!("  Sheet {}: '{}', headers len={}, rows len={}", i, s.name, s.headers.len(), s.rows.len());
                            if !s.headers.is_empty() {
                                println!("    headers: {:?}", &s.headers[..s.headers.len().min(5)]);
                            }
                            let empty_headers_count = s.headers.iter().filter(|h| h.trim().is_empty()).count();
                            if empty_headers_count > 0 {
                                println!("    WARNING: {} empty headers detected!", empty_headers_count);
                            }
                        }
                    }
                    Err(e) => {
                        println!("FAILURE on {}: {}", name, e);
                    }
                }
            }
        });
    }
}
