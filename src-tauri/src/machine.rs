//! Maschinenanbindung für die Oberfläche: Verbindung über USB-Seriell, Telnet (z. B. FluidNC, Port 23) oder WebSocket (ws.rs),
//! Ereignisse an das Fenster, Befehle aus dem Fenster an den Übertragungs-Thread (stream.rs).

use crate::stream::{Cmd, Events, Protocol, Streamer};
use serde::Serialize;
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct Machine {
    tx: Mutex<Option<Sender<Cmd>>>,
    busy: Arc<AtomicBool>,
}

impl Machine {
    fn send(&self, c: Cmd) -> Result<(), String> {
        let tx = self.tx.lock().unwrap();
        let tx = tx.as_ref().ok_or("Nicht verbunden")?;
        tx.send(c).map_err(|_| "Verbindung getrennt".to_string())
    }
}

struct WindowEvents(AppHandle);

#[derive(Serialize, Clone)]
struct Progress {
    sent: usize,
    acked: usize,
    total: usize,
    errors: usize,
}

#[derive(Serialize, Clone)]
struct Done {
    ok: bool,
    message: String,
}

impl Events for WindowEvents {
    fn line(&self, line: &str) {
        let _ = self.0.emit("machine-line", line);
        crate::remote::machine_event("line", serde_json::json!(line));
    }
    fn progress(&self, sent: usize, acked: usize, total: usize, errors: usize) {
        let p = Progress { sent, acked, total, errors };
        crate::remote::machine_event("progress", serde_json::to_value(&p).unwrap_or_default());
        let _ = self.0.emit("machine-progress", p);
    }
    fn done(&self, ok: bool, message: &str) {
        let d = Done { ok, message: message.into() };
        crate::remote::machine_event("done", serde_json::to_value(&d).unwrap_or_default());
        let _ = self.0.emit("machine-done", d);
    }
    fn closed(&self, reason: Option<String>) {
        let reason = reason.unwrap_or_default();
        crate::remote::machine_event("machine_closed", serde_json::json!(reason));
        let _ = self.0.emit("machine-closed", reason);
    }
}

#[derive(Serialize)]
pub struct PortInfo {
    name: String,
    description: String,
}

/// Serielle Schnittstellen des Rechners
#[tauri::command]
pub async fn machine_ports() -> Vec<PortInfo> {
    let mut out: Vec<PortInfo> = serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        .map(|p| {
            let description = match p.port_type {
                serialport::SerialPortType::UsbPort(u) => {
                    [u.manufacturer, u.product].into_iter().flatten().collect::<Vec<_>>().join(" ")
                }
                serialport::SerialPortType::BluetoothPort => "Bluetooth".into(),
                _ => String::new(),
            };
            PortInfo { name: p.port_name, description }
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn machine_connect(
    app: AppHandle,
    state: State<'_, Machine>,
    kind: String,
    port: String,
    baud: u32,
    host: String,
    tcp_port: u16,
    sync: bool,
    realtime: bool,
    poll: Option<String>,
    rx_buffer: Option<usize>,
) -> Result<(), String> {
    // Ältere Oberflächen schicken keinen Puffer; unter 64 und über 16 KiB ist sicher ein Tippfehler
    let rx_buffer = rx_buffer.unwrap_or(crate::stream::RX_BUFFER).clamp(64, 16384);
    if let Some(tx) = state.tx.lock().unwrap().take() {
        let _ = tx.send(Cmd::Close);
    }
    let (tx, rx) = channel();
    let busy = state.busy.clone();
    busy.store(false, Ordering::SeqCst);
    let events = WindowEvents(app);
    match kind.as_str() {
        "serial" => {
            if port.trim().is_empty() {
                return Err("Keine Schnittstelle gewählt".into());
            }
            let p = crate::serial_transport::open(port.trim(), baud)
                .map_err(|e| format!("{}: {e}", port.trim()))?;
            std::thread::spawn(move || Streamer::new(p, events, busy, Protocol { telnet: false, sync, realtime, poll, rx_buffer }).with_serial_retries().run(rx));
        }
        "tcp" => {
            let addr = (host.trim(), tcp_port)
                .to_socket_addrs()
                .map_err(|e| format!("{}: {e}", host.trim()))?
                .next()
                .ok_or_else(|| format!("{}: Adresse nicht gefunden", host.trim()))?;
            let s = TcpStream::connect_timeout(&addr, Duration::from_secs(5)).map_err(|e| format!("{addr}: {e}"))?;
            s.set_read_timeout(Some(Duration::from_millis(10))).map_err(|e| e.to_string())?;
            s.set_write_timeout(Some(Duration::from_secs(5))).map_err(|e| e.to_string())?;
            let _ = s.set_nodelay(true);
            std::thread::spawn(move || Streamer::new(s, events, busy, Protocol { telnet: true, sync, realtime, poll, rx_buffer }).run(rx));
        }
        "ws" => {
            let ws = crate::ws::connect(&host, tcp_port)?;
            std::thread::spawn(move || Streamer::new(ws, events, busy, Protocol { telnet: false, sync, realtime, poll, rx_buffer }).run(rx));
        }
        _ => return Err(format!("Unbekannte Verbindungsart „{kind}“")),
    }
    *state.tx.lock().unwrap() = Some(tx);
    Ok(())
}

#[tauri::command]
pub async fn machine_disconnect(state: State<'_, Machine>) -> Result<(), String> {
    if let Some(tx) = state.tx.lock().unwrap().take() {
        let _ = tx.send(Cmd::Close);
    }
    Ok(())
}

#[tauri::command]
pub async fn machine_send(state: State<'_, Machine>, line: String) -> Result<(), String> {
    if state.busy.load(Ordering::SeqCst) {
        return Err("Während ein Job läuft, sind keine Befehle möglich.".into());
    }
    state.send(Cmd::Line(line))
}

#[tauri::command]
pub async fn machine_realtime(state: State<'_, Machine>, byte: u8) -> Result<(), String> {
    state.send(Cmd::Realtime(byte))
}

#[tauri::command]
pub async fn machine_job(state: State<'_, Machine>, lines: Vec<String>) -> Result<(), String> {
    if state.busy.load(Ordering::SeqCst) {
        return Err("Es läuft bereits ein Job.".into());
    }
    state.send(Cmd::Job(lines))
}

/// Job mit G-Code, den der Rust-Kern schon vorbereitet hat (native::gcode_prepare)
#[tauri::command]
pub async fn machine_job_prepared(state: State<'_, Machine>, native: State<'_, Arc<crate::native::Native>>, id: u32) -> Result<(), String> {
    if state.busy.load(Ordering::SeqCst) {
        return Err("Es läuft bereits ein Job.".into());
    }
    let lines = native.gcode(id)?;
    state.send(Cmd::Job(lines.as_ref().clone()))
}

#[tauri::command]
pub async fn machine_pause(state: State<'_, Machine>) -> Result<(), String> {
    state.send(Cmd::Pause)
}

#[tauri::command]
pub async fn machine_resume(state: State<'_, Machine>) -> Result<(), String> {
    state.send(Cmd::Resume)
}

#[tauri::command]
pub async fn machine_stop(state: State<'_, Machine>) -> Result<(), String> {
    state.send(Cmd::Stop)
}
