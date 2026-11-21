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
    fw: Option<String>,
    bed_w: Option<f64>,
    bed_h: Option<f64>,
    ruida_port: Option<u16>,
    ruida_jog_port: Option<u16>,
    ruida_magic: Option<String>,
    ruida_origin: Option<String>,
    dtr: Option<bool>,
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

    if fw.as_deref() == Some("ruida") {
        let magic = match ruida_magic.as_deref() {
            Some("88") => Some(0x88),
            Some("11") => Some(0x11),
            Some("38") => Some(0x38),
            _ => None,
        };
        let rcfg = crate::ruida_link::RuidaConfig {
            bed_w: bed_w.unwrap_or(600.0).max(10.0),
            bed_h: bed_h.unwrap_or(400.0).max(10.0),
            origin: ruida_origin.unwrap_or_else(|| "top-right".into()),
            magic,
        };
        match kind.as_str() {
            "serial" => {
                if port.trim().is_empty() {
                    return Err("Keine Schnittstelle gewählt".into());
                }
                let p = crate::serial_transport::open(port.trim(), baud.max(9600), dtr)
                    .map_err(|e| format!("{}: {e}", port.trim()))?;
                let tr = crate::ruida_link::SerialRuidaTransport::new(p);
                let streamer = crate::ruida_link::RuidaStreamer::connect(tr, events, busy, rcfg)?;
                std::thread::spawn(move || streamer.run(rx));
            }
            "tcp" | "udp" => {
                let dport = ruida_port.unwrap_or(50200);
                let jport = ruida_jog_port.unwrap_or(50207);
                let tr = crate::ruida_link::UdpTransport::connect(host.trim(), dport, jport)?;
                let streamer = crate::ruida_link::RuidaStreamer::connect(tr, events, busy, rcfg)?;
                std::thread::spawn(move || streamer.run(rx));
            }
            _ => return Err(format!("Verbindungsart „{kind}“ wird für Ruida nicht unterstützt.")),
        }
        *state.tx.lock().unwrap() = Some(tx);
        return Ok(());
    }

    match kind.as_str() {
        "serial" => {
            if port.trim().is_empty() {
                return Err("Keine Schnittstelle gewählt".into());
            }
            let p = crate::serial_transport::open(port.trim(), baud, dtr)
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
pub async fn machine_disconnect(state: State<'_, Machine>, fire_session: Option<u64>, fire_smoothie: Option<bool>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?.take();
    if let Some(tx) = tx {
        if let Some(session) = fire_session {
            let (reply, received) = channel();
            // Taking tx prevents late invocations from targeting the closing connection.
            if tx.send(Cmd::FireClose { session, smoothie: fire_smoothie == Some(true), reply }).is_err() { return Ok(()); }
            return fire_response(received).await;
        }
        let _ = tx.send(Cmd::Close);
    }
    Ok(())
}

#[tauri::command]
pub async fn machine_send(state: State<'_, Machine>, line: String, fire_session: Option<u64>) -> Result<(), String> {
    if state.busy.load(Ordering::SeqCst) {
        return Err("Während ein Job läuft, sind keine Befehle möglich.".into());
    }
    state.send(match fire_session {
        Some(session) => Cmd::FireLine { session, line },
        None => Cmd::Line(line),
    })
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

#[tauri::command]
pub async fn machine_ruida_job(state: State<'_, Machine>, data: Vec<u8>) -> Result<(), String> {
    if state.busy.load(Ordering::SeqCst) {
        return Err("Es läuft bereits ein Job.".into());
    }
    state.send(Cmd::RuidaJob(data))
}

/// Job mit G-Code oder Ruida-Daten, die der Rust-Kern schon vorbereitet hat (native::gcode_prepare / ruida_prepare)
#[tauri::command]
pub async fn machine_job_prepared(state: State<'_, Machine>, native: State<'_, Arc<crate::native::Native>>, id: u32) -> Result<(), String> {
    if state.busy.load(Ordering::SeqCst) {
        return Err("Es läuft bereits ein Job.".into());
    }
    if let Some(rd) = native.ruida_opt(id) {
        return state.send(Cmd::RuidaJob(rd.as_ref().clone()));
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
pub async fn machine_stop(state: State<'_, Machine>, fire_session: Option<u64>, fire_smoothie: Option<bool>) -> Result<(), String> {
    if let Some(session) = fire_session {
        let (reply, received) = channel();
        state.send(Cmd::FireStop { session, smoothie: fire_smoothie == Some(true), reply })?;
        // A timeout would let confirmation race an activation still waiting in native code.
        // Smoothie replies only after the off ACK. Teardown drops the reply;
        // write errors also tear down its queue.
        fire_response(received).await
    } else {
        state.send(Cmd::Stop)
    }
}

async fn fire_response(received: std::sync::mpsc::Receiver<Result<(), String>>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || received.recv().map_err(|_| "Verbindung getrennt".to_string())?)
        .await.map_err(|e| e.to_string())?
}
