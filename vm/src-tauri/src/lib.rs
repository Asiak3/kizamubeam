//! KizamuBeam Virtual Machine: Fenster zur virtuellen Lasermaschine. Die Steuerung selbst steckt in
//! `kizamubeam-vm-core`; hier werden die Einstellungen gespeichert und der Oberfläche Zustand,
//! Konsole und gefahrene Strecken übergeben.

use kizamubeam_vm_core::{net::ClientInfo, net::ServerInfo, Config, Event, Runner, Snapshot};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

pub struct Vm(pub Mutex<Runner>);

/// Gespeicherte Einstellungen (eigener Ordner, unabhängig von KizamuBeam)
pub fn config_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("org.kizamubeam.vm").join("config.json"))
}

pub fn load_config() -> Config {
    let mut c = config_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<Config>(&s).ok())
        .unwrap_or_default();
    c.sanitize();
    c
}

pub fn save_config(c: &Config) -> Result<(), String> {
    let p = config_path().ok_or("Kein Ordner für Einstellungen")?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, serde_json::to_string_pretty(c).unwrap()).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Poll {
    snapshot: Snapshot,
    events: Vec<Event>,
    /// je Strecke 7 Zahlen: x0, y0, x1, y1, Leistung 0…1, Dauer s, Eilgang 0/1
    segments: Vec<f32>,
    clients: Vec<ClientInfo>,
}

#[tauri::command]
fn vm_poll(vm: State<'_, Vm>) -> Poll {
    let r = vm.0.lock().unwrap();
    let events = r.take_events();
    if events.iter().any(|e| matches!(e, Event::ConfigChanged)) {
        let _ = save_config(&r.config());
    }
    let mut segments = Vec::new();
    for s in r.take_segments() {
        segments.extend_from_slice(&[s.x0, s.y0, s.x1, s.y1, s.power, s.dur, if s.rapid { 1.0 } else { 0.0 }]);
    }
    Poll { snapshot: r.snapshot(), events, segments, clients: r.clients() }
}

#[tauri::command]
fn vm_config(vm: State<'_, Vm>) -> Config {
    vm.0.lock().unwrap().config()
}

#[tauri::command]
fn vm_set_config(vm: State<'_, Vm>, config: Config) -> Result<ServerInfo, String> {
    let mut r = vm.0.lock().unwrap();
    r.set_config(config);
    save_config(&r.config())?;
    Ok(r.info())
}

#[tauri::command]
fn vm_server_info(vm: State<'_, Vm>) -> ServerInfo {
    vm.0.lock().unwrap().info()
}

#[tauri::command]
fn vm_restart_servers(vm: State<'_, Vm>) -> ServerInfo {
    let mut r = vm.0.lock().unwrap();
    r.restart_servers();
    r.info()
}

/// Zeile aus der Konsole des Fensters
#[tauri::command]
fn vm_send(vm: State<'_, Vm>, line: String) {
    vm.0.lock().unwrap().send_local(format!("{}\n", line.trim_end()).as_bytes());
}

#[tauri::command]
fn vm_realtime(vm: State<'_, Vm>, byte: u8) {
    vm.0.lock().unwrap().send_local(&[byte]);
}

#[tauri::command]
fn vm_power_cycle(vm: State<'_, Vm>) {
    vm.0.lock().unwrap().power_cycle();
}

#[tauri::command]
fn vm_lan_addresses() -> Vec<String> {
    // Eigene Adresse im Netz: UDP-Socket „verbinden“ (sendet nichts) und lokale Adresse ablesen
    let mut out = Vec::new();
    if let Ok(s) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if s.connect("192.0.2.1:9").is_ok() {
            if let Ok(a) = s.local_addr() {
                out.push(a.ip().to_string());
            }
        }
    }
    out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let runner = Runner::start(load_config());
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Vm(Mutex::new(runner)))
        .invoke_handler(tauri::generate_handler![
            vm_poll,
            vm_config,
            vm_set_config,
            vm_server_info,
            vm_restart_servers,
            vm_send,
            vm_realtime,
            vm_power_cycle,
            vm_lan_addresses
        ])
        .run(tauri::generate_context!())
        .expect("KizamuBeam Virtual Machine konnte nicht starten");
}
