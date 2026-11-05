use std::fs;
use std::path::Path;

use tauri::ipc::Response;

use crate::import::{read_payload, ReadPayload, MAX_IMPORT_BYTES, SPREADSHEET_EXTENSIONS};

// ── commands ─────────────────────────────────────────────────────────

/// Read a user-selected file for import. Spreadsheets are returned as a raw cell grid and
/// text formats as decoded UTF-8; the frontend turns either into tables (see `import.rs`).
#[tauri::command]
pub async fn read_file_data(path: String) -> Result<ReadPayload, String> {
    tauri::async_runtime::spawn_blocking(move || read_payload(&path))
        .await
        .map_err(|e| format!("读取任务异常结束：{e}"))?
}

/// Raw bytes of a spreadsheet, used only when `read_file_data` returned `Unparsed`.
/// Sent as a binary IPC response instead of a JSON number array.
#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<Response, String> {
    let p = Path::new(&path);
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !SPREADSHEET_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("不支持的文件类型（.{ext}）"));
    }
    let meta = fs::metadata(p).map_err(|e| format!("无法访问文件：{e}"))?;
    if !meta.is_file() || meta.len() > MAX_IMPORT_BYTES {
        return Err("文件不可读取或超过大小限制".into());
    }
    let bytes = fs::read(p).map_err(|e| format!("读取文件失败：{e}"))?;
    Ok(Response::new(bytes))
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
