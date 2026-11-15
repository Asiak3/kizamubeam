//! Updates aus den GitHub-Releases. Die Oberfläche sucht den passenden Release (Kanal stabil/Beta) und gibt die
//! Adresse seiner latest.json herein; hier wird geprüft, ob er neuer ist, und das Paket nach Prüfung der Signatur
//! installiert. Der öffentliche Schlüssel kommt beim Bauen aus KIZAMUBEAM_UPDATER_PUBKEY (Release-Workflow);
//! Builds ohne Schlüssel können nicht aktualisieren.

use serde::Serialize;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri_plugin_updater::{Update, UpdaterExt};

/// Only files from this repository's releases. The repository moved from negurvulkan/kizamubeam to the
/// KizamuBeam organization; GitHub redirects the old address, so both are accepted. GitHub treats the owner
/// and repository name case-insensitively, so the comparison does too.
const ALLOWED_PREFIXES: [&str; 2] = ["https://github.com/kizamubeam/kizamubeam/", "https://github.com/negurvulkan/kizamubeam/"];

fn allowed_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    ALLOWED_PREFIXES.iter().any(|p| lower.starts_with(p))
}

pub const PUBKEY: Option<&str> = option_env!("KIZAMUBEAM_UPDATER_PUBKEY");

#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    version: String,
    notes: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum Progress {
    Started { total: Option<u64> },
    Chunk { len: usize },
    Finished,
}

fn pubkey() -> Option<&'static str> {
    PUBKEY.filter(|k| !k.trim().is_empty())
}

/// Kann dieser Build sich selbst aktualisieren?
#[tauri::command]
pub fn update_supported() -> bool {
    pubkey().is_some()
}

/// Prüft die latest.json unter `url`. Gibt die neue Version zurück oder None, wenn sie nicht neuer ist.
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle, pending: tauri::State<'_, Pending>, url: String) -> Result<Option<UpdateInfo>, String> {
    let key = pubkey().ok_or("Dieser Build kann sich nicht selbst aktualisieren (kein Update-Schlüssel).")?;
    if !allowed_url(&url) {
        return Err(format!("Unerwartete Update-Adresse: {url}"));
    }
    let url = url.parse().map_err(|e| format!("{e}"))?;
    let update = app
        .updater_builder()
        .pubkey(key)
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;
    let info = update.as_ref().map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone() });
    *pending.0.lock().unwrap() = update;
    Ok(info)
}

/// Lädt das zuletzt gefundene Update, prüft die Signatur, installiert es und startet die App neu.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, pending: tauri::State<'_, Pending>, on_progress: Channel<Progress>) -> Result<(), String> {
    let update = pending.0.lock().unwrap().take().ok_or("Kein Update gefunden")?;
    let mut started = false;
    update
        .download_and_install(
            |len, total| {
                if !started {
                    started = true;
                    let _ = on_progress.send(Progress::Started { total });
                }
                let _ = on_progress.send(Progress::Chunk { len });
            },
            || {
                let _ = on_progress.send(Progress::Finished);
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::allowed_url;

    #[test]
    fn accepts_releases_of_this_repository_only() {
        assert!(allowed_url("https://github.com/KizamuBeam/kizamubeam/releases/download/v2.9.0/latest.json"));
        assert!(allowed_url("https://github.com/kizamubeam/kizamubeam/releases/download/v2.9.0/latest.json"));
        assert!(allowed_url("https://github.com/negurvulkan/kizamubeam/releases/download/v2.8.0/latest.json"));
        assert!(!allowed_url("https://github.com/KizamuBeam/other/releases/download/v1/latest.json"));
        assert!(!allowed_url("https://github.com/someone/kizamubeam/releases/download/v1/latest.json"));
        assert!(!allowed_url("https://example.com/https://github.com/KizamuBeam/kizamubeam/latest.json"));
    }
}
