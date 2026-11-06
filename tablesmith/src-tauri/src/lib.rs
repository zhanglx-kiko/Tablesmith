mod binary_formats;
mod commands;
mod import;
mod xlsx_formats;

use commands::{
    get_unique_filepath, read_file_bytes, read_file_data, save_binary_file, save_file,
    show_in_folder,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            read_file_data,
            read_file_bytes,
            save_file,
            save_binary_file,
            show_in_folder,
            get_unique_filepath,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tablesmith");
}
