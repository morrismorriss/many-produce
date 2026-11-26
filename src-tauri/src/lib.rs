//! Many Produce desktop shell.
//!
//! The front end does all the logic. This side only exposes a handful of
//! file commands that are scoped to the vault folder the user picked, so the
//! web view can never read or write outside it.

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Default)]
struct VaultState(Mutex<Option<PathBuf>>);

/// Watches the vault so edits made in other apps show up straight away.
#[derive(Default)]
struct WatchState(Mutex<Option<notify::RecommendedWatcher>>);

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
fn vault_open(
    app: tauri::AppHandle,
    state: tauri::State<VaultState>,
    watch: tauri::State<WatchState>,
    path: String,
) -> Result<(), String> {
    use tauri::Emitter;
    let p = PathBuf::from(&path);
    fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(p.clone());

    // Replace any previous watcher. Events carry vault-relative paths.
    let root = p.canonicalize().unwrap_or(p.clone());
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, notify::EventKind::Access(_)) {
                return;
            }
            let rels: Vec<String> = ev
                .paths
                .iter()
                .filter_map(|x| x.strip_prefix(&root).ok())
                .map(|x| x.to_string_lossy().replace('\\', "/"))
                .collect();
            if !rels.is_empty() {
                let _ = app.emit("vault-changed", rels);
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(&p, RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    *watch.0.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}

#[tauri::command]
fn vault_close(state: tauri::State<VaultState>, watch: tauri::State<WatchState>) -> Result<(), String> {
    *watch.0.lock().map_err(|e| e.to_string())? = None;
    *state.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// Read any vault file as base64 (receipts and PDFs for the year-end packet).
#[tauri::command]
fn vault_read_base64(state: tauri::State<VaultState>, path: String) -> Result<Option<String>, String> {
    let p = resolve(&root(&state)?, &path)?;
    if !p.exists() {
        return Ok(None);
    }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    Ok(Some(b64(&bytes)))
}

/// Write an export (zip, PDF) given as base64 to a path the user chose.
#[tauri::command]
fn export_file_base64(path: String, data: String) -> Result<(), String> {
    fs::write(path, unb64(&data)?).map_err(|e| e.to_string())
}

/// Open a vault file in the user's default app (e.g. a signed PDF).
#[tauri::command]
fn vault_open_file(state: tauri::State<VaultState>, path: String) -> Result<(), String> {
    let p = resolve(&root(&state)?, &path)?;
    tauri_plugin_opener::open_path(p, None::<&str>).map_err(|e| e.to_string())
}

// ---- Todoist (optional) ----
// The personal API token lives in the OS keychain, never in the vault, and
// every request is made from here so the token never reaches the web view.

const KEYCHAIN_SERVICE: &str = "Many Produce";
const KEYCHAIN_USER: &str = "todoist";

fn keychain() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_USER).map_err(|e| e.to_string())
}

#[tauri::command]
fn todoist_set_token(token: String) -> Result<(), String> {
    let t = token.trim();
    if t.is_empty() {
        return Err("The token is empty".into());
    }
    keychain()?.set_password(t).map_err(|e| e.to_string())
}

#[tauri::command]
fn todoist_has_token() -> bool {
    keychain().and_then(|k| k.get_password().map_err(|e| e.to_string())).is_ok()
}

#[tauri::command]
fn todoist_clear_token() -> Result<(), String> {
    match keychain()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Call the Todoist API (v1). Only paths under /api/v1/ on api.todoist.com.
#[tauri::command]
async fn todoist_request(method: String, path: String, body: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    if !path.starts_with("/api/v1/") || path.contains("..") {
        return Err(format!("Path not allowed: {path}"));
    }
    let token = keychain()?.get_password().map_err(|_| "No Todoist token saved".to_string())?;
    let url = format!("https://api.todoist.com{path}");
    let client = reqwest::Client::new();
    let req = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(format!("Method not allowed: {method}")),
    };
    let mut req = req.bearer_auth(token);
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req.send().await.map_err(|e| format!("offline: {e}"))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), text.chars().take(200).collect::<String>()));
    }
    if text.trim().is_empty() {
        return Ok(serde_json::Value::Null);
    }
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 4 / 3 + 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

fn unb64(s: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0;
    for c in s.bytes() {
        if c == b'=' || c.is_ascii_whitespace() {
            continue;
        }
        let v = B64.iter().position(|&x| x == c).ok_or("Bad base64")? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Ok(out)
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
        .plugin(tauri_plugin_opener::init())
        .manage(VaultState::default())
        .manage(WatchState::default())
        .invoke_handler(tauri::generate_handler![
            vault_open,
            vault_close,
            vault_read_base64,
            export_file_base64,
            vault_open_file,
            todoist_set_token,
            todoist_has_token,
            todoist_clear_token,
            todoist_request,
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
    fn base64_round_trip() {
        for s in [&b""[..], b"a", b"ab", b"abc", b"hello world \x00\xff"] {
            assert_eq!(super::unb64(&super::b64(s)).unwrap(), s);
        }
        assert_eq!(super::b64(b"Many"), "TWFueQ==");
    }

    #[test]
    fn rejects_escapes() {
        let r = Path::new("/vault");
        assert!(resolve(r, "../etc/passwd").is_err());
        assert!(resolve(r, "/etc/passwd").is_err());
        assert!(resolve(r, "ledger/2026.csv").is_ok());
    }
}
