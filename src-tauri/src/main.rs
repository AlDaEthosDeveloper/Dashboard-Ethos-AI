// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn executable_dir_fallback() -> Result<String, String> {
  let current_exe = std::env::current_exe().map_err(|error| error.to_string())?;
  let exe_dir = current_exe
    .parent()
    .ok_or_else(|| String::from("Unable to resolve executable parent directory"))?;
  Ok(exe_dir.to_string_lossy().to_string())
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![executable_dir_fallback])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
