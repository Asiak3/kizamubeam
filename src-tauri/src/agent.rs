//! Zugang für KI-Agenten über das Model Context Protocol (MCP).
//!
//! Ein kleiner HTTP-Server nur auf 127.0.0.1 (Streamable HTTP, Antworten als JSON). Er ist standardmäßig aus,
//! verlangt ein Token und gibt Werkzeugaufrufe an die Oberfläche weiter (Ereignis „agent-request“), die sie
//! mit den Funktionen des Editors ausführt und über `agent_respond` beantwortet. Welche Werkzeuge ein Agent
//! sieht und aufrufen darf, entscheidet hier die eingestellte Stufe, nicht die Oberfläche.
//!
//! Für Clients, die nur stdio sprechen, startet `kizamubeam --mcp-stdio` eine Brücke ohne Fenster, die jede
//! Zeile an den laufenden Server weiterreicht (Token und Port liest sie aus der Einstellungsdatei).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

/// Muss zu `identifier` in tauri.conf.json passen (gleicher Ordner wie die übrigen App-Daten).
/// Bleibt seit der Umbenennung in KizamuBeam unverändert, sonst gingen Einstellungen und Speicher verloren.
pub(crate) const APP_ID: &str = "org.laserwerk.app";
const DEFAULT_PORT: u16 = 47800;
const PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY: usize = 16 * 1024 * 1024;
/// So lange darf die Oberfläche für einen Aufruf brauchen
const CALL_TIMEOUT: Duration = Duration::from_secs(120);

/// Stufen: 1 Lesen, 2 Entwerfen, 3 G-Code, 4 Maschine
const MAX_LEVEL: u8 = 4;
/// Höchste Stufe, die gespeichert wird: Die Maschinenstufe gilt nur bis zum Beenden der App
const MAX_SAVED_LEVEL: u8 = 3;

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
    pub level: u8,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { enabled: false, port: DEFAULT_PORT, token: new_token(), level: 1 }
    }
}

fn settings_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join(APP_ID).join("agent.json"))
}

fn load_settings() -> Settings {
    let s = settings_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Settings>(&t).ok());
    match s {
        Some(mut s) => {
            s.level = s.level.clamp(1, MAX_SAVED_LEVEL);
            if s.token.len() < 32 {
                s.token = new_token();
            }
            s
        }
        None => Settings::default(),
    }
}

fn save_settings(s: &Settings) -> Result<(), String> {
    let p = settings_path().ok_or("Kein Ordner für Einstellungen")?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let saved = Settings { level: s.level.min(MAX_SAVED_LEVEL), ..s.clone() };
    std::fs::write(&p, serde_json::to_string_pretty(&saved).unwrap()).map_err(|e| e.to_string())?;
    // Das Token ist ein Schlüssel: Datei nur für den eigenen Benutzer lesbar
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn new_token() -> String {
    let mut b = [0u8; 24];
    getrandom::fill(&mut b).expect("Zufallszahlen nicht verfügbar");
    b.iter().map(|x| format!("{x:02x}")).collect()
}

// ---------- Zustand ----------

#[derive(Default)]
struct Shared {
    settings: Mutex<Settings>,
    /// Offene Aufrufe an die Oberfläche
    pending: Mutex<HashMap<u64, Sender<Value>>>,
    next_id: AtomicU64,
    /// Stufe je Werkzeug, aus der letzten Werkzeugliste der Oberfläche
    tiers: Mutex<HashMap<String, u8>>,
    /// Wechselt bei jedem Neustart des Servers; alte Server-Threads beenden sich dann
    generation: AtomicU64,
    /// Fehler beim Start (z. B. Port belegt)
    error: Mutex<Option<String>>,
}

pub struct Agent(Arc<Shared>);

impl Default for Agent {
    fn default() -> Self {
        let sh = Shared::default();
        *sh.settings.lock().unwrap() = load_settings();
        Agent(Arc::new(sh))
    }
}

#[derive(Serialize)]
pub struct AgentInfo {
    enabled: bool,
    port: u16,
    token: String,
    level: u8,
    max_level: u8,
    url: String,
    /// Pfad dieses Programms (für die stdio-Brücke in Client-Konfigurationen)
    exe: String,
    running: bool,
    error: Option<String>,
    /// Protokolldatei der Maschinenaktionen
    machine_log: String,
}

fn info(sh: &Shared) -> AgentInfo {
    let s = sh.settings.lock().unwrap().clone();
    let error = sh.error.lock().unwrap().clone();
    AgentInfo {
        enabled: s.enabled,
        port: s.port,
        url: format!("http://127.0.0.1:{}/mcp", s.port),
        token: s.token,
        level: s.level,
        max_level: MAX_LEVEL,
        exe: std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default(),
        running: s.enabled && error.is_none(),
        error,
        machine_log: machine_log_path().map(|p| p.display().to_string()).unwrap_or_default(),
    }
}

/// Server passend zu den Einstellungen starten oder anhalten
fn restart(app: &AppHandle, sh: &Arc<Shared>) {
    let gen = sh.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *sh.error.lock().unwrap() = None;
    let s = sh.settings.lock().unwrap().clone();
    if !s.enabled {
        return;
    }
    // Der vorige Server gibt den Port erst frei, wenn sein Thread die neue Generation bemerkt
    let mut tries = 0;
    let listener = loop {
        match TcpListener::bind(("127.0.0.1", s.port)) {
            Ok(l) => break l,
            Err(_) if tries < 10 => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(60));
            }
            Err(e) => {
                *sh.error.lock().unwrap() = Some(format!("Port {} nicht verfügbar: {e}", s.port));
                return;
            }
        }
    };
    let _ = listener.set_nonblocking(true);
    let sh = sh.clone();
    let app = app.clone();
    std::thread::spawn(move || loop {
        if sh.generation.load(Ordering::SeqCst) != gen {
            return; // abgeschaltet oder neu gestartet; der Port wird mit dem Listener frei
        }
        match listener.accept() {
            Ok((stream, _)) => {
                let sh = sh.clone();
                let app = app.clone();
                std::thread::spawn(move || {
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
                    handle_connection(stream, &app, &sh);
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => std::thread::sleep(Duration::from_millis(200)),
        }
    });
}

/// Beim Programmstart: Server starten, falls eingeschaltet
pub fn start(app: &AppHandle, state: &Agent) {
    restart(app, &state.0);
}

// ---------- Befehle für die Oberfläche ----------

#[tauri::command]
pub fn agent_info(state: State<'_, Agent>) -> AgentInfo {
    info(&state.0)
}

#[tauri::command]
pub fn agent_configure(
    app: AppHandle,
    state: State<'_, Agent>,
    enabled: bool,
    level: u8,
    port: u16,
) -> Result<AgentInfo, String> {
    {
        let mut s = state.0.settings.lock().unwrap();
        s.enabled = enabled;
        s.level = level.clamp(1, MAX_LEVEL);
        s.port = if port < 1024 { DEFAULT_PORT } else { port };
        save_settings(&s)?;
    }
    restart(&app, &state.0);
    Ok(info(&state.0))
}

/// Neues Token: alle bisher eingerichteten Clients verlieren den Zugang
#[tauri::command]
pub fn agent_new_token(app: AppHandle, state: State<'_, Agent>) -> Result<AgentInfo, String> {
    {
        let mut s = state.0.settings.lock().unwrap();
        s.token = new_token();
        save_settings(&s)?;
    }
    restart(&app, &state.0);
    Ok(info(&state.0))
}

/// Antwort der Oberfläche auf ein „agent-request“: { result } oder { error: { code, message } }
#[tauri::command]
pub fn agent_respond(state: State<'_, Agent>, id: u64, response: Value) {
    if let Some(tx) = state.0.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(response);
    }
}

/// Speichern für Agenten (Projekt, SVG, DXF, PDF, AI, G-Code) unter einem absoluten Pfad; nur diese
/// Endungen, vorhandene Dateien nur mit `overwrite`. `base64`: contents sind Binärdaten in Base64 (PDF/AI).
#[tauri::command]
pub fn agent_write_file(path: String, contents: String, overwrite: bool, base64: Option<bool>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        return Err(format!("{path}: Pfad muss absolut sein"));
    }
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(ext.as_str(), "kzb" | "lwk" | "svg" | "dxf" | "pdf" | "ai" | "gcode" | "nc") {
        return Err(format!("{path}: nur .kzb, .lwk, .svg, .dxf, .pdf, .ai, .gcode oder .nc"));
    }
    if p.exists() && !overwrite {
        return Err(format!("{path}: Datei gibt es schon (overwrite setzen, um sie zu ersetzen)"));
    }
    if base64.unwrap_or(false) {
        let data = crate::decode_base64(&contents).ok_or("Ungültige Daten")?;
        return std::fs::write(&p, data).map_err(|e| format!("{path}: {e}"));
    }
    std::fs::write(&p, contents).map_err(|e| format!("{path}: {e}"))
}

fn machine_log_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join(APP_ID).join("agent-machine.log"))
}

/// Maschinenaktionen von Agenten (Anfragen, Entscheidungen, Stopp) dauerhaft protokollieren
#[tauri::command]
pub fn agent_machine_log(line: String) -> Result<(), String> {
    let p = machine_log_path().ok_or("Kein Ordner für Einstellungen")?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&p).map_err(|e| e.to_string())?;
    writeln!(f, "{}", line.replace(['\r', '\n'], " ")).map_err(|e| e.to_string())
}

// ---------- HTTP ----------

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Option<Request> {
    let mut r = BufReader::new(stream);
    let mut line = String::new();
    r.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut headers = HashMap::new();
    loop {
        let mut l = String::new();
        if r.read_line(&mut l).ok()? == 0 {
            return None;
        }
        let l = l.trim_end();
        if l.is_empty() {
            break;
        }
        if headers.len() > 100 {
            return None;
        }
        if let Some((k, v)) = l.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if len > MAX_BODY {
        return None;
    }
    let mut body = vec![0; len];
    r.read_exact(&mut body).ok()?;
    Some(Request { method, path, headers, body })
}

fn respond(stream: &mut TcpStream, status: &str, body: &str, extra: &[(&str, &str)]) {
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n",
        body.len()
    );
    if !body.is_empty() {
        head.push_str("Content-Type: application/json\r\n");
    }
    for (k, v) in extra {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
    let _ = stream.flush();
    let _ = stream.shutdown(Shutdown::Both);
}

/// Vergleich ohne frühen Abbruch, damit die Laufzeit nichts über das Token verrät
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Nur Aufrufe von diesem Rechner: Browser-Seiten anderer Herkunft (DNS-Rebinding) abweisen
fn origin_ok(origin: Option<&String>) -> bool {
    let Some(o) = origin else { return true };
    let host = o.split("://").nth(1).unwrap_or("").split(['/', ':']).next().unwrap_or("");
    matches!(host, "127.0.0.1" | "localhost" | "[::1]")
}

fn handle_connection(mut stream: TcpStream, app: &AppHandle, sh: &Arc<Shared>) {
    let Some(req) = read_request(&mut stream) else {
        return respond(&mut stream, "400 Bad Request", "", &[]);
    };
    if !origin_ok(req.headers.get("origin")) {
        return respond(&mut stream, "403 Forbidden", "", &[]);
    }
    let path = req.path.split('?').next().unwrap_or("");
    if path != "/mcp" {
        return respond(&mut stream, "404 Not Found", "", &[]);
    }
    let token = sh.settings.lock().unwrap().token.clone();
    let given = req.headers.get("authorization").and_then(|v| v.strip_prefix("Bearer ")).unwrap_or("");
    if !same(given.trim(), &token) {
        return respond(&mut stream, "401 Unauthorized", "", &[("WWW-Authenticate", "Bearer")]);
    }
    if req.method != "POST" {
        // Keine Nachrichten vom Server an den Client, deshalb kein SSE-Kanal
        return respond(&mut stream, "405 Method Not Allowed", "", &[("Allow", "POST")]);
    }
    let Ok(msg) = serde_json::from_slice::<Value>(&req.body) else {
        let e = rpc_error(Value::Null, -32700, "Parse error");
        return respond(&mut stream, "400 Bad Request", &e.to_string(), &[]);
    };
    match handle_message(msg, app, sh) {
        Some(answer) => respond(&mut stream, "200 OK", &answer.to_string(), &[]),
        None => respond(&mut stream, "202 Accepted", "", &[]),
    }
}

// ---------- JSON-RPC / MCP ----------

fn rpc_result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

const INSTRUCTIONS: &str = "KizamuBeam ist eine Laser-Software (wie LightBurn). Einheiten sind Millimeter. \
Koordinaten sind Maschinenkoordinaten wie in der Oberfläche: Ursprung unten links auf dem Bett, x nach rechts, y nach oben. \
Objekte haben eine Nummer (id) und liegen auf einem Layer (0–29, je Layer eigene Laser-Einstellungen). \
Mit render_preview siehst du die Arbeitsfläche als Bild. Die Person sieht alle Änderungen live in der App. \
Den Laser startest du nie selbst: request_job, machine_frame und machine_home fragen die Person in der App, \
und nur ihr Klick startet die Aktion. machine_stop ist immer erlaubt.";

/// Antwort auf eine Nachricht, None bei Benachrichtigungen
fn handle_message(msg: Value, app: &AppHandle, sh: &Arc<Shared>) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("").to_string();
    let params = msg.get("params").cloned().unwrap_or(json!({}));
    let id = id?; // Benachrichtigung oder Antwort: nichts zurückzuschicken
    if method.is_empty() {
        return Some(rpc_error(id, -32600, "Invalid Request"));
    }
    Some(match method.as_str() {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
            let version = if PROTOCOL_VERSIONS.contains(&asked) { asked } else { PROTOCOL_VERSIONS[0] };
            rpc_result(
                id,
                json!({
                    "protocolVersion": version,
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": { "name": "kizamubeam", "title": "KizamuBeam", "version": env!("CARGO_PKG_VERSION") },
                    "instructions": INSTRUCTIONS,
                }),
            )
        }
        "ping" => rpc_result(id, json!({})),
        "tools/list" => match tool_list(app, sh) {
            Ok(tools) => rpc_result(id, json!({ "tools": tools })),
            Err(e) => rpc_error(id, -32603, &e),
        },
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            let level = sh.settings.lock().unwrap().level;
            let mut tier = sh.tiers.lock().unwrap().get(&name).copied();
            if tier.is_none() {
                let _ = tool_list(app, sh);
                tier = sh.tiers.lock().unwrap().get(&name).copied();
            }
            match tier {
                None => rpc_error(id, -32602, &format!("Unbekanntes Werkzeug: {name}")),
                Some(t) if t > level => rpc_result(
                    id,
                    json!({
                        "content": [{ "type": "text", "text": format!(
                            "Das Werkzeug „{name}“ ist in KizamuBeam nicht freigegeben. Die Person kann es unter Datei → KI-Agenten erlauben."
                        ) }],
                        "isError": true,
                    }),
                ),
                Some(_) => match forward(app, sh, "tools/call", params) {
                    Ok(r) => rpc_result(id, r),
                    Err(e) => rpc_error(id, -32603, &e),
                },
            }
        }
        _ => rpc_error(id, -32601, &format!("Method not found: {method}")),
    })
}

/// Werkzeugliste der Oberfläche, gefiltert nach Stufe; merkt sich die Stufe je Werkzeug
fn tool_list(app: &AppHandle, sh: &Arc<Shared>) -> Result<Vec<Value>, String> {
    let r = forward(app, sh, "tools/list", json!({}))?;
    let level = sh.settings.lock().unwrap().level;
    let mut tiers = HashMap::new();
    let mut out = Vec::new();
    for mut t in r.get("tools").and_then(Value::as_array).cloned().unwrap_or_default() {
        let Some(name) = t.get("name").and_then(Value::as_str).map(String::from) else { continue };
        // Ohne Angabe gilt die höchste Stufe: lieber zu streng
        let tier = t.get("_tier").and_then(Value::as_u64).unwrap_or(4) as u8;
        if let Some(o) = t.as_object_mut() {
            o.remove("_tier");
        }
        tiers.insert(name, tier);
        if tier <= level {
            out.push(t);
        }
    }
    *sh.tiers.lock().unwrap() = tiers;
    Ok(out)
}

/// Aufruf an die Oberfläche geben und auf die Antwort warten
fn forward(app: &AppHandle, sh: &Arc<Shared>, method: &str, params: Value) -> Result<Value, String> {
    let id = sh.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = channel();
    sh.pending.lock().unwrap().insert(id, tx);
    if app.emit("agent-request", json!({ "id": id, "method": method, "params": params })).is_err() {
        sh.pending.lock().unwrap().remove(&id);
        return Err("KizamuBeam-Fenster nicht erreichbar".into());
    }
    let answer = rx.recv_timeout(CALL_TIMEOUT);
    sh.pending.lock().unwrap().remove(&id);
    let answer = answer.map_err(|_| "KizamuBeam hat nicht rechtzeitig geantwortet".to_string())?;
    if let Some(e) = answer.get("error") {
        return Err(e.get("message").and_then(Value::as_str).unwrap_or("Fehler").to_string());
    }
    Ok(answer.get("result").cloned().unwrap_or(json!({})))
}

// ---------- stdio-Brücke ----------

/// `kizamubeam --mcp-stdio`: JSON-RPC-Zeilen von stdin an den laufenden Server, Antworten nach stdout
pub fn stdio_bridge() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let id = serde_json::from_str::<Value>(&line).ok().and_then(|v| v.get("id").cloned());
        // Einstellungen jedes Mal neu lesen: Token oder Port können sich in der App geändert haben
        let s = load_settings();
        let answer = match post(s.port, &s.token, &line) {
            Ok(body) => body,
            Err(e) => match &id {
                Some(id) => rpc_error(id.clone(), -32000, &e).to_string(),
                None => String::new(),
            },
        };
        if !answer.trim().is_empty() {
            let _ = writeln!(out, "{}", answer.trim());
            let _ = out.flush();
        }
    }
}

fn post(port: u16, token: &str, body: &str) -> Result<String, String> {
    const OFF: &str = "KizamuBeam läuft nicht oder der Zugang für KI-Agenten ist aus (KizamuBeam: Datei → KI-Agenten).";
    let mut s = TcpStream::connect(("127.0.0.1", port)).map_err(|_| OFF.to_string())?;
    let _ = s.set_read_timeout(Some(CALL_TIMEOUT + Duration::from_secs(5)));
    let req = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf);
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((&text, ""));
    let status = head.split_whitespace().nth(1).unwrap_or("");
    match status {
        "200" | "202" => Ok(body.to_string()),
        "401" => Err("KizamuBeam hat das Token abgelehnt.".into()),
        _ => Err(format!("KizamuBeam antwortet mit HTTP {status}")),
    }
}
