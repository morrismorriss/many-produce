//! Many Produce desktop shell.
//!
//! The front end does all the logic. This side only exposes a handful of
//! file commands that are scoped to the vault folder the user picked, so the
//! web view can never read or write outside it.

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Default)]
struct VaultState(Mutex<Option<PathBuf>>);

#[derive(Serialize)]
struct Entry {
    name: String,
    is_dir: bool,
}

fn root(state: &tauri::State<VaultState>) -> Result<PathBuf, String> {
    state
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "No vault folder is open".to_string())
}

/// Resolve a vault-relative path, refusing anything that escapes the vault.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    for c in rel_path.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(format!("Path not allowed: {rel}")),
        }
    }
    Ok(root.join(rel_path))
}

#[tauri::command]
fn vault_open(state: tauri::State<VaultState>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(p);
    Ok(())
}

#[tauri::command]
fn vault_read(state: tauri::State<VaultState>, path: String) -> Result<Option<String>, String> {
    let p = resolve(&root(&state)?, &path)?;
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_write(state: tauri::State<VaultState>, path: String, contents: String) -> Result<(), String> {
    let p = resolve(&root(&state)?, &path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Write to a temp file then rename, so a crash never leaves half a file.
    let tmp = p.with_extension("mp-tmp");
    fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_list(state: tauri::State<VaultState>, path: String) -> Result<Vec<Entry>, String> {
    let p = resolve(&root(&state)?, &path)?;
    if !p.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for e in fs::read_dir(p).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && name != ".manyproduce" {
            continue;
        }
        out.push(Entry { name, is_dir: e.path().is_dir() });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Nothing is hard-deleted: move into .manyproduce/trash/<timestamp>-<name>.
#[tauri::command]
fn vault_trash(state: tauri::State<VaultState>, path: String) -> Result<String, String> {
    let r = root(&state)?;
    let src = resolve(&r, &path)?;
    if !src.exists() {
        return Err(format!("Not found: {path}"));
    }
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis();
    let name = path.replace(['/', '\\'], "__");
    let rel = format!(".manyproduce/trash/{ts}-{name}");
    let dest = r.join(&rel);
    fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::rename(src, dest).map_err(|e| e.to_string())?;
    Ok(rel)
}

/// Copy a file from anywhere the user picked (e.g. a receipt) into the vault.
#[tauri::command]
fn vault_import_file(state: tauri::State<VaultState>, source: String, dest: String) -> Result<(), String> {
    let d = resolve(&root(&state)?, &dest)?;
    if let Some(parent) = d.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(source, d).map(|_| ()).map_err(|e| e.to_string())
}

/// Write an export (CSV, .ics, report) to a path the user chose in a save dialog.
#[tauri::command]
fn export_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(VaultState::default())
        .invoke_handler(tauri::generate_handler![
            vault_open,
            vault_read,
            vault_write,
            vault_list,
            vault_trash,
            vault_import_file,
            export_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Many Produce");
}

#[cfg(test)]
mod tests {
    use super::resolve;
    use std::path::Path;

    #[test]
    fn rejects_escapes() {
        let r = Path::new("/vault");
        assert!(resolve(r, "../etc/passwd").is_err());
        assert!(resolve(r, "/etc/passwd").is_err());
        assert!(resolve(r, "ledger/2026.csv").is_ok());
    }
}
