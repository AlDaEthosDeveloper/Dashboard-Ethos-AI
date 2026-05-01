// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

static APPROVED_DIRECTORIES: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

fn approved_directories() -> &'static Mutex<HashSet<PathBuf>> {
  APPROVED_DIRECTORIES.get_or_init(|| Mutex::new(HashSet::new()))
}

fn canonicalize_path(path: &str) -> Result<PathBuf, String> {
  std::fs::canonicalize(Path::new(path)).map_err(|error| error.to_string())
}

fn ensure_approved(path: &str) -> Result<PathBuf, String> {
  let target = canonicalize_path(path)?;
  let guard = approved_directories()
    .lock()
    .map_err(|_| String::from("Failed to access approval store"))?;

  if guard.iter().any(|approved| target.starts_with(approved)) {
    Ok(target)
  } else {
    Err(String::from("Path is not in approved directories"))
  }
}

#[tauri::command]
fn executable_dir_fallback() -> Result<String, String> {
  let current_exe = std::env::current_exe().map_err(|error| error.to_string())?;
  let exe_dir = current_exe
    .parent()
    .ok_or_else(|| String::from("Unable to resolve executable parent directory"))?;
  Ok(exe_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn ai_navigate(route: String) -> String {
  format!("Navigated to {}", route)
}

#[tauri::command]
fn ai_create_item(name: String) -> String {
  format!("Created item {}", name)
}

#[tauri::command]
fn ai_approve_directory(path: String) -> Result<String, String> {
  let canonical = canonicalize_path(&path)?;
  let mut guard = approved_directories()
    .lock()
    .map_err(|_| String::from("Failed to access approval store"))?;
  guard.insert(canonical.clone());
  Ok(format!("Approved {}", canonical.display()))
}

#[tauri::command]
fn ai_read_directory(path: String) -> Result<Vec<String>, String> {
  let canonical = ensure_approved(&path)?;
  let entries = std::fs::read_dir(canonical).map_err(|error| error.to_string())?;

  let mut files = Vec::new();
  for entry in entries {
    let entry = entry.map_err(|error| error.to_string())?;
    let entry_path = entry.path();
    if entry_path.is_file() {
      files.push(entry_path.to_string_lossy().to_string());
    }
  }

  Ok(files)
}

#[tauri::command]
fn ai_read_file(path: String) -> Result<String, String> {
  let canonical = ensure_approved(&path)?;
  std::fs::read_to_string(canonical).map_err(|error| error.to_string())
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![
      executable_dir_fallback,
      ai_navigate,
      ai_create_item,
      ai_approve_directory,
      ai_read_directory,
      ai_read_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
