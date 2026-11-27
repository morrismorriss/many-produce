//! Many Produce desktop shell.
//!
//! The front end does all the logic. This side only exposes a handful of
//! file commands that are scoped to the vault folder the user picked, so the
//! web view can never read or write outside it. Anything outside the vault
//! (choosing a vault, importing a receipt, saving an export) goes through a
//! native dialog shown from here, so the web view never supplies a path
//! outside the vault itself.
//!
//! Network: the only outbound connection the app makes is `todoist_request`,
//! to api.todoist.com, and only when the user has saved a Todoist token and
//! turned sync on (or pressed a Todoist button). The web view's CSP
//! (tauri.conf.json) blocks every other connection.

use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Default)]
struct VaultState(Mutex<Option<PathBuf>>);

/// Vault folders the user chose in a native folder dialog. `vault_open` only
/// accepts one of these, so the web view can't point the vault at, say, `/`.
const VAULTS_FILE: &str = "vaults.json";

fn vaults_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let d = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d.join(VAULTS_FILE))
}

fn canon(p: &Path) -> String {
    p.canonicalize().unwrap_or_else(|_| p.to_path_buf()).to_string_lossy().to_string()
}

/// None when the list has never been written (first run after updating).
fn read_vaults(app: &tauri::AppHandle) -> Result<Option<Vec<String>>, String> {
    let f = vaults_file(app)?;
    if !f.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(f).map_err(|e| e.to_string())?;
    Ok(Some(serde_json::from_str(&text).unwrap_or_default()))
}

fn remember_vault(app: &tauri::AppHandle, p: &Path) -> Result<(), String> {
    let mut list = read_vaults(app)?.unwrap_or_default();
    let c = canon(p);
    if !list.contains(&c) {
        list.push(c);
    }
    fs::write(vaults_file(app)?, serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Run a blocking native dialog off the main thread.
async fn off_main<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())
}

/// Show a native folder picker; the folder chosen becomes an allowed vault.
#[tauri::command]
async fn vault_pick(app: tauri::AppHandle, title: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let a = app.clone();
    let picked = off_main(move || a.dialog().file().set_title(title).blocking_pick_folder()).await?;
    let Some(fp) = picked else { return Ok(None) };
    let p = fp.into_path().map_err(|e| e.to_string())?;
    remember_vault(&app, &p)?;
    Ok(Some(p.to_string_lossy().to_string()))
}

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
    if !p.is_absolute() {
        return Err("The vault path must be absolute".into());
    }
    match read_vaults(&app)? {
        // Only folders the user picked in the folder dialog.
        Some(list) if !list.contains(&canon(&p)) => return Err("Choose the vault folder again".into()),
        Some(_) => {}
        // First run after updating: trust the vault that was already open.
        None => remember_vault(&app, &p)?,
    }
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

/// Ask where to save an export (native save dialog). None if cancelled.
async fn ask_save_path(app: &tauri::AppHandle, name: String) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let a = app.clone();
    let picked = off_main(move || a.dialog().file().set_file_name(name).blocking_save_file()).await?;
    match picked {
        Some(fp) => Ok(Some(fp.into_path().map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

/// Save an export (zip, PDF) given as base64. Returns false if cancelled.
#[tauri::command]
async fn export_file_base64(app: tauri::AppHandle, name: String, data: String) -> Result<bool, String> {
    let bytes = unb64(&data)?;
    let Some(path) = ask_save_path(&app, name).await? else { return Ok(false) };
    fs::write(path, bytes).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Open a vault file in the user's default app (e.g. a signed PDF).
#[tauri::command]
fn vault_open_file(state: tauri::State<VaultState>, path: String) -> Result<(), String> {
    let p = resolve(&root(&state)?, &path)?;
    tauri_plugin_opener::open_path(p, None::<&str>).map_err(|e| e.to_string())
}

/// Open a link in the user's default browser or mail app (the "Buy me a
/// coffee" link, shopping links, email addresses). Only web and mail links.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let u = reqwest::Url::parse(url.trim()).map_err(|_| "That isn't a valid link.".to_string())?;
    if !matches!(u.scheme(), "https" | "http" | "mailto") {
        return Err("Only web and email links can be opened.".into());
    }
    tauri_plugin_opener::open_url(u.as_str(), None::<&str>).map_err(|e| e.to_string())
}

// ---- Shared themes ----
// Themes live outside any vault, in a folder Many Write, Many Apply and
// Many Produce all read, so a theme made in one shows up in the others:
//   macOS   ~/Library/Application Support/Many Apps/themes
//   Windows %APPDATA%\Many Apps\themes
//   Linux   ~/.local/share/Many Apps/themes

fn themes_dir_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let d = app.path().data_dir().map_err(|e| e.to_string())?.join("Many Apps").join("themes");
    fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn theme_file(name: &str) -> Result<String, String> {
    let ok = !name.is_empty() && name.len() <= 60 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok { Ok(format!("{name}.json")) } else { Err(format!("Bad theme name: {name}")) }
}

#[tauri::command]
fn themes_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(themes_dir_path(&app)?.to_string_lossy().to_string())
}

/// Many Write keeps its own themes in its config folder; Many Produce reads
/// them too, and saves a copy there so Many Write sees Many Produce's themes.
fn many_write_themes(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    let d = app.path().config_dir().ok()?.join("app.manywrite.desktop").join("themes");
    if d.parent().map(|p| p.exists()).unwrap_or(false) { Some(d) } else { None }
}

fn read_json_dir(d: &Path, source: &str, out: &mut Vec<(String, String, String)>) {
    let Ok(rd) = fs::read_dir(d) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().and_then(|x| x.to_str()) != Some("json") {
            continue;
        }
        if let (Some(stem), Ok(text)) = (p.file_stem().and_then(|x| x.to_str()), fs::read_to_string(&p)) {
            out.push((stem.to_string(), text, source.to_string()));
        }
    }
}

/// (id, json, source) where source is "shared" or "many-write".
#[tauri::command]
fn themes_list(app: tauri::AppHandle) -> Result<Vec<(String, String, String)>, String> {
    let mut out = vec![];
    read_json_dir(&themes_dir_path(&app)?, "shared", &mut out);
    if let Some(mw) = many_write_themes(&app) {
        read_json_dir(&mw, "many-write", &mut out);
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
fn theme_save(app: tauri::AppHandle, name: String, contents: String) -> Result<(), String> {
    fs::write(themes_dir_path(&app)?.join(theme_file(&name)?), &contents).map_err(|e| e.to_string())?;
    if let Some(mw) = many_write_themes(&app) {
        // Many Write lists files named custom-<id>.json; the file is a superset of its format.
        let _ = fs::create_dir_all(&mw);
        let _ = fs::write(mw.join(format!("custom-{}", theme_file(&name)?)), &contents);
    }
    Ok(())
}

#[tauri::command]
fn theme_delete(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let p = themes_dir_path(&app)?.join(theme_file(&name)?);
    if p.exists() {
        fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    if let Some(mw) = many_write_themes(&app) {
        let _ = fs::remove_file(mw.join(format!("custom-{}", theme_file(&name)?)));
    }
    Ok(())
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

fn todoist_path_ok(path: &str) -> bool {
    path.starts_with("/api/v1/")
        && !path.contains("..")
        && !path.contains("//")
        && path.chars().all(|c| c.is_ascii_alphanumeric() || "/-_?=&%.".contains(c))
}

/// Call the Todoist API (v1). Only paths under /api/v1/ on api.todoist.com.
#[tauri::command]
async fn todoist_request(method: String, path: String, body: Option<serde_json::Value>) -> Result<serde_json::Value, String> {
    if !todoist_path_ok(&path) {
        return Err(format!("Path not allowed: {path}"));
    }
    let token = keychain()?.get_password().map_err(|_| "No Todoist token saved".to_string())?;
    let url = format!("https://api.todoist.com{path}");
    // No redirects (the token must only ever go to api.todoist.com) and a timeout.
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
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
    // The temp name keeps the full file name, so budget.csv and budget.md
    // written at the same moment can't clobber each other's temp file.
    let mut tmp_name = p.file_name().ok_or("Bad file name")?.to_os_string();
    tmp_name.push(".mp-tmp");
    let tmp = p.with_file_name(tmp_name);
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

/// File extension of a picked file, lowercased; only short alphanumeric ones.
fn safe_ext(p: &Path) -> String {
    p.extension()
        .and_then(|x| x.to_str())
        .map(|x| x.to_ascii_lowercase())
        .filter(|x| !x.is_empty() && x.len() <= 8 && x.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or_else(|| "bin".into())
}

/// Let the user pick a file (e.g. a receipt) in a native dialog and copy it
/// into the vault as `<dir>/<base>.<ext>`, adding -2, -3… rather than
/// overwriting a file already there. Returns the vault-relative path, or
/// None if cancelled.
#[tauri::command]
async fn vault_import_pick(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    dir: String,
    base: String,
    title: String,
    extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let r = root(&state)?;
    let base: String = base.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(80).collect();
    let base = if base.is_empty() { "file".to_string() } else { base };
    resolve(&r, &dir)?;
    let a = app.clone();
    let picked = off_main(move || {
        let mut d = a.dialog().file().set_title(title);
        if let Some(ext) = &extensions {
            let exts: Vec<&str> = ext.iter().map(String::as_str).collect();
            d = d.add_filter("Files", &exts);
        }
        d.blocking_pick_file()
    })
    .await?;
    let Some(fp) = picked else { return Ok(None) };
    let src = fp.into_path().map_err(|e| e.to_string())?;
    let ext = safe_ext(&src);
    let mut rel = format!("{dir}/{base}.{ext}");
    let mut n = 2;
    while resolve(&r, &rel)?.exists() {
        rel = format!("{dir}/{base}-{n}.{ext}");
        n += 1;
    }
    let dest = resolve(&r, &rel)?;
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(Some(rel))
}

/// Save an export (CSV, .ics, report). Returns false if cancelled.
#[tauri::command]
async fn export_file(app: tauri::AppHandle, name: String, contents: String) -> Result<bool, String> {
    let Some(path) = ask_save_path(&app, name).await? else { return Ok(false) };
    fs::write(path, contents).map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(VaultState::default())
        .manage(WatchState::default())
        .invoke_handler(tauri::generate_handler![
            vault_pick,
            vault_open,
            vault_close,
            vault_read_base64,
            export_file_base64,
            vault_open_file,
            open_url,
            themes_dir,
            themes_list,
            theme_save,
            theme_delete,
            todoist_set_token,
            todoist_has_token,
            todoist_clear_token,
            todoist_request,
            vault_read,
            vault_write,
            vault_list,
            vault_trash,
            vault_import_pick,
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
    fn todoist_paths() {
        assert!(super::todoist_path_ok("/api/v1/tasks?project_id=123"));
        assert!(super::todoist_path_ok("/api/v1/tasks/abc/close"));
        assert!(!super::todoist_path_ok("/api/v1/../v2"));
        assert!(!super::todoist_path_ok("/api/v1//evil"));
        assert!(!super::todoist_path_ok("/api/v1/x#frag"));
        assert!(!super::todoist_path_ok("/sync/v9"));
    }

    #[test]
    fn safe_extensions() {
        assert_eq!(super::safe_ext(Path::new("/a/b.PDF")), "pdf");
        assert_eq!(super::safe_ext(Path::new("/a.dir/noext")), "bin");
        assert_eq!(super::safe_ext(Path::new("/a/b.c d")), "bin");
    }

    #[test]
    fn rejects_escapes() {
        let r = Path::new("/vault");
        assert!(resolve(r, "../etc/passwd").is_err());
        assert!(resolve(r, "/etc/passwd").is_err());
        assert!(resolve(r, "ledger/2026.csv").is_ok());
    }
}
