//! Per-cell number format codes for the binary workbooks calamine reads (xlsb, xls), which
//! it does not expose either. Output matches `xlsx_formats::SheetFormats`: custom codes as
//! text, built-in ids as `#<id>` (resolved on the TypeScript side).
//!
//! xlsb: MS-XLSB records in `xl/styles.bin` (BrtFmt 0x002C, BrtXF 0x002F inside
//! BrtBeginCellXFs 0x0269) and each sheet's cell records, which all start with
//! `col: u32, ixfe: u24`. xls: MS-XLS BIFF8 records in the `Workbook` stream (Format 0x041E,
//! XF 0x00E0, BoundSheet8 0x0085) and per-sheet cell records with `row, col, ixfe: u16`.

use std::collections::HashMap;
use std::io::{Read, Seek};

use zip::ZipArchive;

use crate::xlsx_formats::{SheetFormats, WorkbookFormats};

fn u16_at(b: &[u8], i: usize) -> Option<u16> {
    Some(u16::from_le_bytes([*b.get(i)?, *b.get(i + 1)?]))
}

fn u32_at(b: &[u8], i: usize) -> Option<u32> {
    Some(u32::from_le_bytes([
        *b.get(i)?,
        *b.get(i + 1)?,
        *b.get(i + 2)?,
        *b.get(i + 3)?,
    ]))
}

/// Collects distinct codes and the per-cell index, dropping General.
#[derive(Default)]
struct Builder {
    out: SheetFormats,
    index: HashMap<String, u32>,
}

impl Builder {
    fn put(&mut self, pos: (u32, u32), code: &str) {
        if code == "#0" {
            return;
        }
        let next = self.out.codes.len() as u32;
        let i = *self.index.entry(code.to_string()).or_insert_with(|| {
            self.out.codes.push(code.to_string());
            next
        });
        self.out.cells.insert(pos, i);
    }
}

fn code_for(id: u32, custom: &HashMap<u32, String>) -> String {
    custom.get(&id).cloned().unwrap_or_else(|| format!("#{id}"))
}

// ── xlsb ─────────────────────────────────────────────────────────────

/// MS-XLSB 2.1.4 record stream: variable-length type and size.
struct XlsbRecords<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Iterator for XlsbRecords<'a> {
    type Item = (u16, &'a [u8]);
    fn next(&mut self) -> Option<Self::Item> {
        let mut byte = || {
            let v = *self.b.get(self.pos)?;
            self.pos += 1;
            Some(v)
        };
        let b0 = byte()?;
        let typ = if b0 & 0x80 != 0 {
            (b0 & 0x7F) as u16 | (((byte()? & 0x7F) as u16) << 7)
        } else {
            b0 as u16
        };
        let mut len = 0usize;
        for i in 0..4 {
            let v = byte()?;
            len |= ((v & 0x7F) as usize) << (7 * i);
            if v & 0x80 == 0 {
                break;
            }
        }
        let data = self.b.get(self.pos..self.pos + len)?;
        self.pos += len;
        Some((typ, data))
    }
}

/// XLWideString: u32 char count + UTF-16LE.
fn wide_str(b: &[u8]) -> Option<String> {
    let n = u32_at(b, 0)? as usize;
    let bytes = b.get(4..4 + n * 2)?;
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    Some(String::from_utf16_lossy(&units))
}

fn zip_bytes<R: Read + Seek>(zip: &mut ZipArchive<R>, path: &str) -> Option<Vec<u8>> {
    let mut f = zip.by_name(path.trim_start_matches('/')).ok()?;
    let mut v = Vec::new();
    f.read_to_end(&mut v).ok()?;
    Some(v)
}

/// BErr (MS-XLSB 2.5.97.2), spelled like calamine's `CellErrorType` Display.
fn error_text(code: u8) -> Option<&'static str> {
    Some(match code {
        0x00 => "#NULL!",
        0x07 => "#DIV/0!",
        0x0F => "#VALUE!",
        0x17 => "#REF!",
        0x1D => "#NAME?",
        0x24 => "#NUM!",
        0x2A => "#N/A",
        0x2B => "#DATA!",
        _ => return None,
    })
}

fn xlsb_xfs(styles: &[u8]) -> Vec<String> {
    let mut custom = HashMap::new();
    let mut xfs = Vec::new();
    let mut in_cell_xfs = false;
    for (typ, d) in (XlsbRecords { b: styles, pos: 0 }) {
        match typ {
            0x002C => {
                if let (Some(id), Some(code)) = (u16_at(d, 0), d.get(2..).and_then(wide_str)) {
                    custom.insert(id as u32, code);
                }
            }
            0x0269 => in_cell_xfs = true,
            0x026A => in_cell_xfs = false,
            0x002F if in_cell_xfs => xfs.push(code_for(u16_at(d, 2).unwrap_or(0) as u32, &custom)),
            _ => {}
        }
    }
    xfs
}

/// BrtWbProp (0x0099) in xl/workbook.bin: bit 0 of the flags is f1904.
fn xlsb_date1904<R: Read + Seek>(zip: &mut ZipArchive<R>) -> bool {
    let Some(wb) = zip_bytes(zip, "xl/workbook.bin") else {
        return false;
    };
    (XlsbRecords { b: &wb, pos: 0 })
        .find(|(t, _)| *t == 0x0099)
        .and_then(|(_, d)| d.first().copied())
        .is_some_and(|f| f & 0x01 != 0)
}

/// Sheet name -> part path, from xl/workbook.bin (BrtBundleSh 0x009C) and its rels.
fn xlsb_sheet_parts<R: Read + Seek>(zip: &mut ZipArchive<R>) -> Vec<(String, String)> {
    let rels: HashMap<String, String> =
        crate::xlsx_formats::relationships(zip, "xl/_rels/workbook.bin.rels");
    let Some(wb) = zip_bytes(zip, "xl/workbook.bin") else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (typ, d) in (XlsbRecords { b: &wb, pos: 0 }) {
        if typ != 0x009C {
            continue;
        }
        // hsState u32, iTabID u32, strRelID (nullable wide string), strName
        let Some(rel_len) = u32_at(d, 8) else {
            continue;
        };
        if rel_len == 0xFFFF_FFFF {
            continue;
        }
        let Some(rel) = wide_str(&d[8..]) else {
            continue;
        };
        let name_at = 12 + rel_len as usize * 2;
        let Some(name) = d.get(name_at..).and_then(wide_str) else {
            continue;
        };
        if let Some(part) = rels.get(&rel) {
            out.push((name, part.clone()));
        }
    }
    out
}

fn xlsb_sheet(data: &[u8], xfs: &[String]) -> SheetFormats {
    let mut b = Builder::default();
    let mut row = 0u32;
    for (typ, d) in (XlsbRecords { b: data, pos: 0 }) {
        match typ {
            0x0000 => row = u32_at(d, 0).unwrap_or(row), // BrtRowHdr
            // Cell records (blank, rk, error, bool, real, st, isst, fmla*) share the header.
            0x0001..=0x000B => {
                // BrtFmlaString with an empty result (`=""`, cch 0 at offset 8) shows as a
                // blank cell, so it has no value.
                let empty_text = typ == 0x0008 && u32_at(d, 8) == Some(0);
                if typ != 0x0001 && !empty_text {
                    b.out.valued += 1;
                }
                // calamine drops BrtFmlaError (e.g. `=1/0`); keep the error so the cell
                // is not silently emptied.
                if typ == 0x000B {
                    if let (Some(col), Some(code)) =
                        (u32_at(d, 0), d.get(8).and_then(|&e| error_text(e)))
                    {
                        b.out.errors.push(((row, col), code));
                    }
                }
                let (Some(col), Some(lo), Some(hi)) = (u32_at(d, 0), u16_at(d, 4), d.get(6)) else {
                    continue;
                };
                let ixfe = lo as usize | ((*hi as usize) << 16);
                if let Some(code) = xfs.get(ixfe) {
                    b.put((row, col), code);
                }
            }
            // BrtMergeCell (MS-XLSB 2.4.636): rwFirst, rwLast, colFirst, colLast. It comes
            // after BrtEndSheetData, so the loop keeps reading past 0x0092.
            0x00B0 => {
                if let (Some(r1), Some(r2), Some(c1), Some(c2)) =
                    (u32_at(d, 0), u32_at(d, 4), u32_at(d, 8), u32_at(d, 12))
                {
                    b.out.merges.push((r1, c1, r2, c2));
                }
            }
            _ => {}
        }
    }
    b.out
}

pub fn read_xlsb_formats<R: Read + Seek>(reader: R) -> WorkbookFormats {
    let Ok(mut zip) = ZipArchive::new(reader) else {
        return WorkbookFormats::default();
    };
    let mut out = WorkbookFormats {
        date1904: xlsb_date1904(&mut zip),
        ..Default::default()
    };
    let Some(styles) = zip_bytes(&mut zip, "xl/styles.bin") else {
        return out;
    };
    let xfs = xlsb_xfs(&styles);
    for (name, part) in xlsb_sheet_parts(&mut zip) {
        if let Some(data) = zip_bytes(&mut zip, &part) {
            out.sheets.insert(name, xlsb_sheet(&data, &xfs));
        }
    }
    out
}

// ── xls (BIFF8) ──────────────────────────────────────────────────────

struct BiffRecords<'a> {
    b: &'a [u8],
    pos: usize,
}

impl<'a> Iterator for BiffRecords<'a> {
    type Item = (u16, &'a [u8]);
    fn next(&mut self) -> Option<Self::Item> {
        let typ = u16_at(self.b, self.pos)?;
        let len = u16_at(self.b, self.pos + 2)? as usize;
        let data = self.b.get(self.pos + 4..self.pos + 4 + len)?;
        self.pos += 4 + len;
        Some((typ, data))
    }
}

/// XLUnicodeString (u16 count, flags, chars) or ShortXLUnicodeString (u8 count).
fn biff_string(d: &[u8], short: bool, enc: &'static encoding_rs::Encoding) -> Option<String> {
    let (n, at) = if short {
        (*d.first()? as usize, 1)
    } else {
        (u16_at(d, 0)? as usize, 2)
    };
    let flags = *d.get(at)?;
    let body = &d[at + 1..];
    if flags & 0x01 != 0 {
        let bytes = body.get(..n * 2)?;
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        Some(String::from_utf16_lossy(&units))
    } else {
        Some(
            enc.decode_without_bom_handling(body.get(..n)?)
                .0
                .into_owned(),
        )
    }
}

pub fn read_xls_formats<R: Read + Seek>(reader: R) -> WorkbookFormats {
    let Ok(mut cfb) = cfb::CompoundFile::open(reader) else {
        return WorkbookFormats::default();
    };
    let mut stream = Vec::new();
    let ok = ["Workbook", "Book"].iter().any(|n| {
        cfb.open_stream(n)
            .and_then(|mut s| s.read_to_end(&mut stream))
            .is_ok()
    });
    if !ok {
        return WorkbookFormats::default();
    }
    let mut date1904 = false;

    let mut enc: &'static encoding_rs::Encoding = encoding_rs::WINDOWS_1252;
    let mut custom = HashMap::new();
    let mut xfs: Vec<String> = Vec::new();
    let mut sheets: Vec<(usize, String)> = Vec::new();
    for (typ, d) in (BiffRecords { b: &stream, pos: 0 }) {
        match typ {
            0x0042 => {
                // 1200 (UTF-16) is what BIFF8 files declare; their "compressed" 8-bit
                // strings are then the low bytes of UTF-16, i.e. Latin-1.
                if let Some(e) = u16_at(d, 0)
                    .filter(|&cp| cp != 1200)
                    .and_then(codepage::to_encoding)
                {
                    enc = e;
                }
            }
            0x041E => {
                if let (Some(id), Some(code)) = (
                    u16_at(d, 0),
                    d.get(2..).and_then(|s| biff_string(s, false, enc)),
                ) {
                    custom.insert(id as u32, code);
                }
            }
            0x00E0 => xfs.push(code_for(u16_at(d, 2).unwrap_or(0) as u32, &custom)),
            0x0085 => {
                if let (Some(pos), Some(name)) = (
                    u32_at(d, 0),
                    d.get(6..).and_then(|s| biff_string(s, true, enc)),
                ) {
                    sheets.push((pos as usize, name));
                }
            }
            // Date1904 (MS-XLS 2.4.77)
            0x0022 => date1904 = u16_at(d, 0) == Some(1),
            0x000A => break, // EOF of the globals substream
            _ => {}
        }
    }

    let mut out = WorkbookFormats {
        date1904,
        ..Default::default()
    };
    for (pos, name) in sheets {
        let Some(sub) = stream.get(pos..) else {
            continue;
        };
        let mut b = Builder::default();
        for (typ, d) in (BiffRecords { b: sub, pos: 0 }) {
            match typ {
                // Number, Label, BoolErr, Rk, LabelSst, Formula: row, col, ixfe
                0x0203 | 0x0204 | 0x0205 | 0x027E | 0x00FD | 0x0006 | 0x0201 => {
                    // A formula whose result is empty text (`=""`, FormulaValue type 3 with
                    // fExprO 0xFFFF, MS-XLS 2.5.133) shows as a blank cell, so it has no value.
                    let empty_text = typ == 0x0006
                        && d.get(6) == Some(&3)
                        && d.get(12..14) == Some(&[0xFF, 0xFF][..]);
                    if typ != 0x0201 && !empty_text {
                        b.out.valued += 1;
                    }
                    let (Some(r), Some(c), Some(x)) = (u16_at(d, 0), u16_at(d, 2), u16_at(d, 4))
                    else {
                        continue;
                    };
                    if let Some(code) = xfs.get(x as usize) {
                        b.put((r as u32, c as u32), code);
                    }
                }
                // MulRk / MulBlank: row, colFirst, (ixfe [+ rk])*, colLast
                0x00BD | 0x00BE => {
                    let (Some(r), Some(first)) = (u16_at(d, 0), u16_at(d, 2)) else {
                        continue;
                    };
                    let step = if typ == 0x00BD { 6 } else { 2 };
                    if typ == 0x00BD {
                        b.out.valued += d.len().saturating_sub(6) / 6;
                    }
                    let body = &d[4..d.len().saturating_sub(2)];
                    for (i, chunk) in body.chunks(step).enumerate() {
                        if let Some(code) = u16_at(chunk, 0).and_then(|x| xfs.get(x as usize)) {
                            b.put((r as u32, first as u32 + i as u32), code);
                        }
                    }
                }
                0x000A => break,
                _ => {}
            }
        }
        out.sheets.insert(name, b.out);
    }
    out
}
