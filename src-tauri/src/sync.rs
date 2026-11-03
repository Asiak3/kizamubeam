//! Einstellungen übertragen (src/sync.ts): Dateien im frei gewählten Sync-Ordner und die Ordner für Bibliothek,
//! Vorlagen und Erweiterungen im Einstellungsordner. Jeder Rechner schreibt nur seine eigene Datei
//! (<rechner>.kzsync) in den Unterordner „KizamuBeam“ des gewählten Ordners. Dateien werden über eine temporäre
//! Datei ersetzt, damit Cloud-Programme nie eine halb geschriebene Datei hochladen.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri_plugin_dialog::DialogExt;

/// Größte Datei im Sync-Ordner (alle Einträge eines Rechners samt Bibliothek)
const MAX_SYNC_BYTES: u64 = 200 * 1024 * 1024;
/// Größte Datei in den Ordnern der App (wie library.rs und packs.rs)
const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
const SUBDIR: &str = "KizamuBeam";

fn simple_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && !name.contains(['/', '\\', ':', '\0']) && name.len() <= 200
}

fn sync_dir(folder: &str) -> Result<PathBuf, String> {
    let base = Path::new(folder);
    if folder.is_empty() || !base.is_absolute() || !base.is_dir() {
        return Err(format!("Ordner nicht gefunden: {folder}"));
    }
    let d = base.join(SUBDIR);
    std::fs::create_dir_all(&d).map_err(|e| format!("{}: {e}", d.display()))?;
    Ok(d)
}

fn sync_file(folder: &str, name: &str) -> Result<PathBuf, String> {
    if !simple_name(name) || !name.to_lowercase().ends_with(".kzsync") {
        return Err(format!("Ungültiger Dateiname: {name}"));
    }
    Ok(sync_dir(folder)?.join(name))
}

fn mtime_ms(m: &std::fs::Metadata) -> u64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Über eine temporäre Datei im selben Ordner ersetzen
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.tmp"));
    std::fs::write(&tmp, contents).map_err(|e| format!("{name}: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("{name}: {e}")
    })
}

/// Ordner für den Abgleich wählen
#[tauri::command]
pub async fn sync_pick_folder(app: tauri::AppHandle) -> Option<String> {
    let p = app.dialog().file().blocking_pick_folder()?;
    p.into_path().ok().map(|p| p.display().to_string())
}

/// Name dieses Rechners als Vorschlag (Windows: COMPUTERNAME, sonst `hostname`)
#[tauri::command]
pub fn sync_machine_name() -> String {
    if let Ok(n) = std::env::var("COMPUTERNAME") {
        if !n.trim().is_empty() {
            return n.trim().to_string();
        }
    }
    #[cfg(target_os = "macos")]
    if let Ok(o) = std::process::Command::new("scutil").args(["--get", "ComputerName"]).output() {
        let n = String::from_utf8_lossy(&o.stdout).trim().to_string();
        if o.status.success() && !n.is_empty() {
            return n;
        }
    }
    std::process::Command::new("hostname")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().trim_end_matches(".local").to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_default()
}

/// Dateien der Rechner im Sync-Ordner: (Name, Änderungszeit in ms, Größe)
#[tauri::command]
pub async fn sync_list(folder: String) -> Result<Vec<(String, u64, u64)>, String> {
    let d = sync_dir(&folder)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&d).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if !simple_name(&name) || !name.to_lowercase().ends_with(".kzsync") {
            continue;
        }
        let Ok(m) = entry.metadata() else { continue };
        if m.is_file() {
            out.push((name, mtime_ms(&m), m.len()));
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
pub async fn sync_read(folder: String, name: String) -> Result<String, String> {
    let p = sync_file(&folder, &name)?;
    let len = std::fs::metadata(&p).map_err(|e| format!("{name}: {e}"))?.len();
    if len > MAX_SYNC_BYTES {
        return Err(format!("{name}: Datei zu groß"));
    }
    std::fs::read_to_string(&p).map_err(|e| format!("{name}: {e}"))
}

#[tauri::command]
pub async fn sync_write(folder: String, name: String, contents: String) -> Result<(), String> {
    if contents.len() as u64 > MAX_SYNC_BYTES {
        return Err(format!("{name}: Datei zu groß"));
    }
    write_atomic(&sync_file(&folder, &name)?, &contents)
}

/// Sync-Ordner im Finder bzw. Explorer zeigen
#[tauri::command]
pub async fn sync_open_folder(folder: String) -> Result<(), String> {
    let d = sync_dir(&folder)?;
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let cmd = "xdg-open";
    std::process::Command::new(cmd).arg(&d).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------- Ordner der App ----------

fn app_dir(kind: &str) -> Result<(PathBuf, &'static str), String> {
    let (sub, ext) = match kind {
        "library" => ("library", ".kza"),
        "templates" => ("templates", ".kzt"),
        "packs" => ("packs", ".kzp"),
        _ => return Err(format!("Unbekannter Ordner: {kind}")),
    };
    let d = dirs::config_dir()
        .ok_or("Kein Ordner für Einstellungen")?
        .join(crate::agent::APP_ID)
        .join(sub);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok((d, ext))
}

fn app_file(kind: &str, file: &str) -> Result<PathBuf, String> {
    let (d, ext) = app_dir(kind)?;
    if !simple_name(file) || !file.to_lowercase().ends_with(ext) {
        return Err(format!("Ungültiger Dateiname: {file}"));
    }
    Ok(d.join(file))
}

/// Dateien eines Ordners der App: (Name, Größe, Änderungszeit in ms); zu große Dateien fehlen
#[tauri::command]
pub async fn sync_dir_stat(kind: String) -> Result<Vec<(String, u64, u64)>, String> {
    let (d, ext) = app_dir(&kind)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&d).map_err(|e| e.to_string())? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        if !simple_name(&name) || !name.to_lowercase().ends_with(ext) {
            continue;
        }
        let Ok(m) = entry.metadata() else { continue };
        if m.is_file() && m.len() <= MAX_FILE_BYTES {
            out.push((name, m.len(), mtime_ms(&m)));
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
pub async fn sync_dir_read(kind: String, file: String) -> Result<String, String> {
    std::fs::read_to_string(app_file(&kind, &file)?).map_err(|e| format!("{file}: {e}"))
}

#[tauri::command]
pub async fn sync_dir_write(kind: String, file: String, contents: String) -> Result<(), String> {
    if contents.len() as u64 > MAX_FILE_BYTES {
        return Err(format!("{file}: Datei zu groß"));
    }
    write_atomic(&app_file(&kind, &file)?, &contents)
}

#[tauri::command]
pub async fn sync_dir_delete(kind: String, file: String) -> Result<(), String> {
    let p = app_file(&kind, &file)?;
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{file}: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(simple_name("Mac-1234.kzsync"));
        assert!(!simple_name("../x.kzsync"));
        assert!(!simple_name(".hidden"));
        assert!(!simple_name("a\\b"));
        assert!(app_file("library", "../x.kza").is_err());
        assert!(app_file("library", "x.kzt").is_err());
        assert!(app_file("other", "x.kza").is_err());
        assert!(sync_dir("relative/path").is_err());
    }

    #[test]
    fn atomic_write_replaces() {
        let d = std::env::temp_dir().join(format!("kzb-sync-test-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("a.kzsync");
        write_atomic(&f, "1").unwrap();
        write_atomic(&f, "2").unwrap();
        assert_eq!(std::fs::read_to_string(&f).unwrap(), "2");
        assert_eq!(std::fs::read_dir(&d).unwrap().count(), 1);
        std::fs::remove_dir_all(&d).unwrap();
    }
}
