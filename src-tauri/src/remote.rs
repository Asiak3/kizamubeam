//! Control a laser through another KizamuBeam on the local network or a VPN (issue #188).
//!
//! **Host:** with host mode switched on, a TLS server (self-signed certificate, default port 47900) accepts
//! paired computers. Messages are JSON lines in both directions. Requests from clients go to the window as
//! `remote-request` events; the window computes jobs with its own device and answers with `remote_respond`.
//! Machine output (`machine-line`, `-progress`, `-done`, `-closed`) is forwarded to every client from
//! machine.rs (`machine_event`), so all clients see exactly what the laser does.
//!
//! **Client:** the "Remote KizamuBeam" connection pins the host certificate from pairing and re-emits the
//! host's machine events under the same names, so the laser window keeps working unchanged.
//!
//! **Pairing:** the host shows a 6-digit code. The client answers with an HMAC of that code over the host
//! certificate fingerprint it saw, so a machine in the middle cannot relay the pairing. The host then hands
//! out a per-client key (only its hash is stored on the host); the client stores key and fingerprint.

use ring::rand::{SecureRandom, SystemRandom};
use ring::{digest, hmac};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, WebPkiSupportedAlgorithms};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use rustls::{ClientConfig, ClientConnection, DigitallySignedStruct, ServerConfig, ServerConnection, SignatureScheme, StreamOwned};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

/// Protocol version; host and client must agree
pub const PROTO: u64 = 1;
pub const DEFAULT_PORT: u16 = 47900;
/// Largest message (a job bundle with embedded images and fonts)
const MAX_MSG: usize = 256 * 1024 * 1024;
/// How long a request may take on the host (job computation, confirmation dialog)
const CALL_TIMEOUT: Duration = Duration::from_secs(330);
const PAIR_TIMEOUT: Duration = Duration::from_secs(300);
const PAIR_TRIES: u32 = 3;
const PAIR_LABEL: &[u8] = b"kizamubeam-pair-v1";
/// Poll interval of the connection threads (reading and sending)
const TICK: Duration = Duration::from_millis(40);
const SERVER_NAME: &str = "kizamubeam";

pub const VIEWER: &str = "viewer";
pub const OPERATOR: &str = "operator";

// ---------- Stored settings ----------

#[derive(Serialize, Deserialize, Clone)]
pub struct PairedClient {
    id: String,
    name: String,
    role: String,
    /// SHA-256 of the client key (hex); the key itself only lives on the client
    key_hash: String,
    paired_at: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct HostSettings {
    enabled: bool,
    port: u16,
    /// Name shown to clients (empty = computer name)
    name: String,
    /// Ask on this computer before a remote job starts
    confirm: bool,
    clients: Vec<PairedClient>,
}

impl Default for HostSettings {
    fn default() -> Self {
        HostSettings { enabled: false, port: DEFAULT_PORT, name: String::new(), confirm: false, clients: Vec::new() }
    }
}

/// What a client keeps for a paired host
#[derive(Serialize, Deserialize, Clone)]
pub struct Credential {
    fingerprint: String,
    id: String,
    key: String,
    host_name: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
struct Store {
    host: HostSettings,
    credentials: Vec<Credential>,
}

fn config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join(crate::agent::APP_ID))
}

fn load_store() -> Store {
    config_dir()
        .and_then(|d| std::fs::read_to_string(d.join("remote.json")).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Write a file only the current user can read (keys and certificate)
fn write_private(name: &str, data: &[u8]) -> Result<(), String> {
    let dir = config_dir().ok_or("Kein Ordner für Einstellungen")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join(name);
    std::fs::write(&p, data).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn save_store(s: &Store) -> Result<(), String> {
    if cfg!(test) {
        return Ok(());
    }
    write_private("remote.json", serde_json::to_string_pretty(s).unwrap().as_bytes())
}

/// Certificate and private key (DER) of this host; created on first use
fn host_identity() -> Result<(Vec<u8>, Vec<u8>), String> {
    let dir = config_dir().ok_or("Kein Ordner für Einstellungen")?;
    if let (Ok(c), Ok(k)) = (std::fs::read(dir.join("remote-cert.der")), std::fs::read(dir.join("remote-key.der"))) {
        if !c.is_empty() && !k.is_empty() {
            return Ok((c, k));
        }
    }
    let (c, k) = new_identity()?;
    write_private("remote-cert.der", &c)?;
    write_private("remote-key.der", &k)?;
    Ok((c, k))
}

fn new_identity() -> Result<(Vec<u8>, Vec<u8>), String> {
    let ck = rcgen::generate_simple_self_signed(vec![SERVER_NAME.to_string()]).map_err(|e| e.to_string())?;
    Ok((ck.cert.der().to_vec(), ck.signing_key.serialize_der()))
}

// ---------- Small helpers ----------

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    let s: String = s.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

fn sha256(b: &[u8]) -> Vec<u8> {
    digest::digest(&digest::SHA256, b).as_ref().to_vec()
}

fn random_bytes(n: usize) -> Vec<u8> {
    let mut b = vec![0u8; n];
    SystemRandom::new().fill(&mut b).expect("Zufallszahlen nicht verfügbar");
    b
}

fn pair_code() -> String {
    let b = random_bytes(4);
    format!("{:06}", u32::from_le_bytes([b[0], b[1], b[2], b[3]]) % 1_000_000)
}

/// Proof that the client knows the code and saw this certificate
pub fn pair_proof(code: &str, fingerprint: &[u8]) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, code.trim().as_bytes());
    let mut msg = fingerprint.to_vec();
    msg.extend_from_slice(PAIR_LABEL);
    hex(hmac::sign(&key, &msg).as_ref())
}

fn proof_ok(code: &str, fingerprint: &[u8], proof: &str) -> bool {
    let Some(tag) = unhex(proof) else { return false };
    let key = hmac::Key::new(hmac::HMAC_SHA256, code.as_bytes());
    let mut msg = fingerprint.to_vec();
    msg.extend_from_slice(PAIR_LABEL);
    hmac::verify(&key, &msg, &tag).is_ok()
}

/// Compare without stopping early, so timing tells nothing about the secret
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Fingerprint for people: groups of four hex digits
pub fn show_fingerprint(fp: &[u8]) -> String {
    let h = hex(fp).to_uppercase();
    h.as_bytes().chunks(4).map(|c| String::from_utf8_lossy(c).to_string()).collect::<Vec<_>>().join(" ")
}

fn host_name(s: &HostSettings) -> String {
    if s.name.trim().is_empty() {
        crate::sync::sync_machine_name()
    } else {
        s.name.trim().to_string()
    }
}

// ---------- Framing: one JSON message per line ----------

struct Lines<S> {
    s: S,
    buf: Vec<u8>,
    /// Bytes of buf already searched for a line end
    scanned: usize,
}

impl<S: Read + Write> Lines<S> {
    fn new(s: S) -> Self {
        Lines { s, buf: Vec::new(), scanned: 0 }
    }

    /// Next complete message; Ok(None) when nothing arrived before the read timeout
    fn next(&mut self) -> io::Result<Option<Value>> {
        loop {
            if let Some(p) = self.buf[self.scanned..].iter().position(|&b| b == b'\n') {
                let end = self.scanned + p;
                let line: Vec<u8> = self.buf.drain(..=end).collect();
                self.scanned = 0;
                let line = &line[..line.len() - 1];
                if line.iter().all(|b| b.is_ascii_whitespace()) {
                    continue;
                }
                return serde_json::from_slice(line).map(Some).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e));
            }
            self.scanned = self.buf.len();
            if self.buf.len() > MAX_MSG {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "Nachricht zu groß"));
            }
            let mut chunk = [0u8; 65536];
            match self.s.read(&mut chunk) {
                Ok(0) => return Err(io::ErrorKind::UnexpectedEof.into()),
                Ok(n) => self.buf.extend_from_slice(&chunk[..n]),
                Err(e) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => return Ok(None),
                Err(e) if e.kind() == io::ErrorKind::Interrupted => {}
                Err(e) => return Err(e),
            }
        }
    }

    /// Wait up to `limit` for the next message
    fn wait(&mut self, limit: Duration) -> io::Result<Value> {
        let t0 = Instant::now();
        loop {
            if let Some(v) = self.next()? {
                return Ok(v);
            }
            if t0.elapsed() > limit {
                return Err(io::ErrorKind::TimedOut.into());
            }
        }
    }

    fn send(&mut self, v: &Value) -> io::Result<()> {
        let mut b = serde_json::to_vec(v).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        b.push(b'\n');
        self.s.write_all(&b)?;
        self.s.flush()
    }
}

fn kind(v: &Value) -> &str {
    v.get("t").and_then(Value::as_str).unwrap_or("")
}

fn error_text(v: &Value) -> String {
    v.get("msg").and_then(Value::as_str).unwrap_or("Unerwartete Antwort vom Host").to_string()
}

// ---------- TLS ----------

fn provider() -> Arc<rustls::crypto::CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

fn server_config(cert: &[u8], key: &[u8]) -> Result<Arc<ServerConfig>, String> {
    let cfg = ServerConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_no_client_auth()
        .with_single_cert(vec![CertificateDer::from(cert.to_vec())], PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(key.to_vec())))
        .map_err(|e| e.to_string())?;
    Ok(Arc::new(cfg))
}

/// Accepts exactly the pinned certificate (or, while pairing, any certificate, remembering its fingerprint)
#[derive(Debug)]
struct Pin {
    want: Option<Vec<u8>>,
    seen: Mutex<Option<Vec<u8>>>,
    algs: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for Pin {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        let fp = sha256(end_entity.as_ref());
        *self.seen.lock().unwrap() = Some(fp.clone());
        match &self.want {
            Some(w) if *w != fp => Err(rustls::Error::General("fingerprint".into())),
            _ => Ok(ServerCertVerified::assertion()),
        }
    }
    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls12_signature(message, cert, dss, &self.algs)
    }
    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        verify_tls13_signature(message, cert, dss, &self.algs)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algs.supported_schemes()
    }
}

type ClientIo = Lines<StreamOwned<ClientConnection, TcpStream>>;
type ServerIo = Lines<StreamOwned<ServerConnection, TcpStream>>;

/// Connect to a host; returns the connection and the certificate fingerprint it presented
fn open_client(host: &str, port: u16, want: Option<Vec<u8>>) -> Result<(ClientIo, Vec<u8>), String> {
    let host = host.trim();
    if host.is_empty() {
        return Err("Keine Adresse angegeben".into());
    }
    let addr = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("{host}: {e}"))?
        .next()
        .ok_or_else(|| format!("{host}: Adresse nicht gefunden"))?;
    let mut sock = TcpStream::connect_timeout(&addr, Duration::from_secs(5)).map_err(|e| format!("{addr}: {e}"))?;
    let _ = sock.set_nodelay(true);
    sock.set_read_timeout(Some(Duration::from_secs(10))).map_err(|e| e.to_string())?;
    sock.set_write_timeout(Some(Duration::from_secs(30))).map_err(|e| e.to_string())?;
    let p = provider();
    let pin = Arc::new(Pin { want: want.clone(), seen: Mutex::new(None), algs: p.signature_verification_algorithms });
    let cfg = ClientConfig::builder_with_provider(p)
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .dangerous()
        .with_custom_certificate_verifier(pin.clone())
        .with_no_client_auth();
    let mut conn = ClientConnection::new(Arc::new(cfg), ServerName::try_from(SERVER_NAME).unwrap()).map_err(|e| e.to_string())?;
    while conn.is_handshaking() {
        if let Err(e) = conn.complete_io(&mut sock) {
            if want.is_some() && pin.seen.lock().unwrap().as_ref() != want.as_ref() {
                return Err("Der Host meldet sich mit einem anderen Zertifikat. Wurde KizamuBeam dort neu eingerichtet, bitte neu koppeln.".into());
            }
            return Err(format!("TLS: {e}"));
        }
    }
    sock.set_read_timeout(Some(TICK)).map_err(|e| e.to_string())?;
    let fp = pin.seen.lock().unwrap().clone().unwrap_or_default();
    Ok((Lines::new(StreamOwned::new(conn, sock)), fp))
}

// ---------- Shared state ----------

struct Peer {
    client: String,
    name: String,
    role: String,
    addr: String,
    tx: Sender<Value>,
    kill: Arc<AtomicBool>,
}

struct Pairing {
    conn: u64,
    code: String,
    role: String,
    started: Instant,
}

struct Link {
    tx: Sender<Value>,
    kill: Arc<AtomicBool>,
}

struct PairSession {
    io: ClientIo,
    fp: Vec<u8>,
}

#[derive(Default)]
struct Inner {
    store: Mutex<Store>,
    app: OnceLock<AppHandle>,
    // host
    generation: AtomicU64,
    error: Mutex<Option<String>>,
    fingerprint: Mutex<Vec<u8>>,
    peers: Mutex<HashMap<u64, Peer>>,
    next_conn: AtomicU64,
    pending: Mutex<HashMap<u64, Sender<Value>>>,
    next_req: AtomicU64,
    state: Mutex<Value>,
    pairing: Mutex<Option<Pairing>>,
    // client
    link: Mutex<Option<Link>>,
    link_pending: Mutex<HashMap<u64, Sender<Value>>>,
    pair_session: Mutex<Option<PairSession>>,
}

pub struct Remote(Arc<Inner>);

static INNER: OnceLock<Arc<Inner>> = OnceLock::new();

impl Default for Remote {
    fn default() -> Self {
        let inner = Arc::new(Inner::default());
        *inner.store.lock().unwrap() = load_store();
        *inner.state.lock().unwrap() = json!({});
        let _ = INNER.set(inner.clone());
        Remote(inner)
    }
}

impl Inner {
    fn emit(&self, event: &str, payload: Value) {
        if let Some(app) = self.app.get() {
            let _ = app.emit(event, payload);
        }
    }

    fn broadcast(&self, msg: Value) {
        for p in self.peers.lock().unwrap().values() {
            let _ = p.tx.send(msg.clone());
        }
    }

    fn clients_changed(&self) {
        self.emit("remote-clients", json!(clients(self)));
    }
}

/// Machine output on the host: forward to every connected client (called from machine.rs)
pub fn machine_event(event: &str, data: Value) {
    if let Some(inner) = INNER.get() {
        if inner.peers.lock().unwrap().is_empty() {
            return;
        }
        inner.broadcast(json!({ "t": "ev", "e": event, "d": data }));
    }
}

// ---------- Host ----------

#[derive(Serialize)]
pub struct HostInfo {
    enabled: bool,
    port: u16,
    name: String,
    /// Name shown to clients (name or computer name)
    shown_name: String,
    confirm: bool,
    running: bool,
    error: Option<String>,
    fingerprint: String,
    /// Address in the local network, if known
    address: Option<String>,
}

fn host_info(inner: &Inner) -> HostInfo {
    let s = inner.store.lock().unwrap().host.clone();
    let error = inner.error.lock().unwrap().clone();
    let fp = inner.fingerprint.lock().unwrap().clone();
    HostInfo {
        enabled: s.enabled,
        port: s.port,
        shown_name: host_name(&s),
        name: s.name,
        confirm: s.confirm,
        running: s.enabled && error.is_none(),
        error,
        fingerprint: if fp.is_empty() { String::new() } else { show_fingerprint(&fp) },
        address: crate::fluid::local_ipv4().map(|ip| ip.to_string()),
    }
}

#[derive(Serialize)]
pub struct ClientInfo {
    id: String,
    name: String,
    role: String,
    paired_at: u64,
    connected: usize,
    /// Address of the open connection(s)
    address: String,
}

fn clients(inner: &Inner) -> Vec<ClientInfo> {
    let s = inner.store.lock().unwrap().host.clone();
    let peers = inner.peers.lock().unwrap();
    s.clients
        .iter()
        .map(|c| {
            let open: Vec<&Peer> = peers.values().filter(|p| p.client == c.id).collect();
            ClientInfo {
                id: c.id.clone(),
                name: c.name.clone(),
                role: c.role.clone(),
                paired_at: c.paired_at,
                connected: open.len(),
                address: open.iter().map(|p| p.addr.clone()).collect::<Vec<_>>().join(", "),
            }
        })
        .collect()
}

/// Start or stop the server to match the settings
fn restart(inner: &Arc<Inner>) {
    let gen = inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
    *inner.error.lock().unwrap() = None;
    // Connections of the previous server end with it
    for p in inner.peers.lock().unwrap().values() {
        p.kill.store(true, Ordering::SeqCst);
    }
    *inner.pairing.lock().unwrap() = None;
    let s = inner.store.lock().unwrap().host.clone();
    if !s.enabled {
        return;
    }
    let cfg = match host_identity().and_then(|(c, k)| {
        *inner.fingerprint.lock().unwrap() = sha256(&c);
        server_config(&c, &k)
    }) {
        Ok(c) => c,
        Err(e) => {
            *inner.error.lock().unwrap() = Some(format!("Zertifikat: {e}"));
            return;
        }
    };
    let mut tries = 0;
    let listener = loop {
        match TcpListener::bind(("0.0.0.0", s.port)) {
            Ok(l) => break l,
            Err(_) if tries < 10 => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(60));
            }
            Err(e) => {
                *inner.error.lock().unwrap() = Some(format!("Port {} nicht verfügbar: {e}", s.port));
                return;
            }
        }
    };
    let _ = listener.set_nonblocking(true);
    let inner = inner.clone();
    std::thread::spawn(move || loop {
        if inner.generation.load(Ordering::SeqCst) != gen {
            return;
        }
        match listener.accept() {
            Ok((sock, _)) => {
                let inner = inner.clone();
                let cfg = cfg.clone();
                std::thread::spawn(move || serve(inner, sock, cfg, gen));
            }
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => std::thread::sleep(Duration::from_millis(200)),
        }
    });
}

fn error_msg(code: &str, msg: &str) -> Value {
    json!({ "t": "error", "code": code, "msg": msg })
}

/// One client connection on the host
fn serve(inner: Arc<Inner>, mut sock: TcpStream, cfg: Arc<ServerConfig>, gen: u64) {
    let addr = sock.peer_addr().map(|a| a.ip().to_string()).unwrap_or_default();
    let _ = sock.set_nonblocking(false);
    let _ = sock.set_nodelay(true);
    let _ = sock.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = sock.set_write_timeout(Some(Duration::from_secs(30)));
    let Ok(mut conn) = ServerConnection::new(cfg) else { return };
    while conn.is_handshaking() {
        if conn.complete_io(&mut sock).is_err() {
            return;
        }
    }
    if sock.set_read_timeout(Some(TICK)).is_err() {
        return;
    }
    let mut io: ServerIo = Lines::new(StreamOwned::new(conn, sock));
    let Ok(hello) = io.wait(Duration::from_secs(15)) else { return };
    if kind(&hello) != "hello" {
        return;
    }
    let proto = hello.get("proto").and_then(Value::as_u64).unwrap_or(0);
    if proto != PROTO {
        let _ = io.send(&error_msg(
            "proto",
            &format!("Host und dieser Rechner verwenden verschiedene Protokollversionen ({proto} statt {PROTO}). Bitte beide KizamuBeam auf dieselbe Version bringen."),
        ));
        return;
    }
    let name: String = hello.get("name").and_then(Value::as_str).unwrap_or("").chars().take(80).collect();
    let conn_id = inner.next_conn.fetch_add(1, Ordering::SeqCst) + 1;
    let client = if hello.get("pair").and_then(Value::as_bool).unwrap_or(false) {
        match host_pair(&inner, &mut io, conn_id, &name) {
            Some(c) => c,
            None => return,
        }
    } else {
        let id = hello.get("id").and_then(Value::as_str).unwrap_or("");
        let key = hello.get("key").and_then(Value::as_str).unwrap_or("");
        let hash = hex(&sha256(key.as_bytes()));
        let found = inner.store.lock().unwrap().host.clients.iter().find(|c| c.id == id && same(&c.key_hash, &hash)).cloned();
        match found {
            Some(c) => c,
            None => {
                let _ = io.send(&error_msg("auth", "Dieser Rechner ist beim Host nicht (mehr) gekoppelt. Bitte neu koppeln."));
                return;
            }
        }
    };
    let (tx, rx) = channel::<Value>();
    let kill = Arc::new(AtomicBool::new(false));
    inner.peers.lock().unwrap().insert(
        conn_id,
        Peer { client: client.id.clone(), name: client.name.clone(), role: client.role.clone(), addr, tx: tx.clone(), kill: kill.clone() },
    );
    inner.clients_changed();
    let host = host_name(&inner.store.lock().unwrap().host);
    let state = inner.state.lock().unwrap().clone();
    let welcome = json!({ "t": "welcome", "proto": PROTO, "role": client.role, "host": host, "app": env!("CARGO_PKG_VERSION"), "state": state });
    if io.send(&welcome).is_ok() {
        host_loop(&inner, &mut io, conn_id, &tx, &rx, &kill, gen);
    }
    inner.peers.lock().unwrap().remove(&conn_id);
    inner.clients_changed();
}

fn host_loop(inner: &Arc<Inner>, io: &mut ServerIo, conn_id: u64, tx: &Sender<Value>, rx: &Receiver<Value>, kill: &AtomicBool, gen: u64) {
    loop {
        if kill.load(Ordering::SeqCst) || inner.generation.load(Ordering::SeqCst) != gen {
            return;
        }
        match io.next() {
            Ok(Some(msg)) if kind(&msg) == "req" => host_request(inner, conn_id, msg, tx),
            Ok(Some(msg)) if kind(&msg) == "bye" => return,
            Ok(_) => {}
            Err(_) => return,
        }
        while let Ok(out) = rx.try_recv() {
            if io.send(&out).is_err() {
                return;
            }
        }
    }
}

/// Methods a viewer may call; everything else needs the operator role
fn viewer_may(method: &str, params: &Value) -> bool {
    match method {
        // watching: status, job list, camera images and the settings to take over
        "state" | "jobs" | "cameras" | "camera_frame" | "sync" => true,
        // status query only
        "realtime" => params.get("byte").and_then(Value::as_u64) == Some(b'?' as u64),
        _ => false,
    }
}

fn host_request(inner: &Arc<Inner>, conn_id: u64, msg: Value, tx: &Sender<Value>) {
    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let method = msg.get("m").and_then(Value::as_str).unwrap_or("").to_string();
    let params = msg.get("p").cloned().unwrap_or(json!({}));
    let Some((client, name, role)) = inner.peers.lock().unwrap().get(&conn_id).map(|p| (p.client.clone(), p.name.clone(), p.role.clone())) else {
        return;
    };
    if role != OPERATOR && !viewer_may(&method, &params) {
        let _ = tx.send(json!({ "t": "res", "id": id, "ok": false, "err": "Nur Bediener dürfen den Laser steuern. Die Rolle stellt der Host ein." }));
        return;
    }
    if method == "state" {
        let state = inner.state.lock().unwrap().clone();
        let _ = tx.send(json!({ "t": "res", "id": id, "ok": true, "r": state }));
        return;
    }
    // Ask the window without blocking this connection (status keeps flowing while a job is computed)
    let inner = inner.clone();
    let tx = tx.clone();
    std::thread::spawn(move || {
        let req = inner.next_req.fetch_add(1, Ordering::SeqCst) + 1;
        let (rtx, rrx) = channel();
        inner.pending.lock().unwrap().insert(req, rtx);
        inner.emit(
            "remote-request",
            json!({ "id": req, "client": { "id": client, "name": name, "role": role }, "method": method, "params": params }),
        );
        let answer = rrx.recv_timeout(CALL_TIMEOUT);
        inner.pending.lock().unwrap().remove(&req);
        let msg = match answer {
            Ok(a) => match a.get("error").and_then(Value::as_str) {
                Some(e) => json!({ "t": "res", "id": id, "ok": false, "err": e }),
                None => json!({ "t": "res", "id": id, "ok": true, "r": a.get("result").cloned().unwrap_or(Value::Null) }),
            },
            Err(_) => json!({ "t": "res", "id": id, "ok": false, "err": "Der Host hat nicht rechtzeitig geantwortet." }),
        };
        let _ = tx.send(msg);
    });
}

/// Pairing on the host: show a code, check the client's proof, hand out a key
fn host_pair(inner: &Arc<Inner>, io: &mut ServerIo, conn_id: u64, name: &str) -> Option<PairedClient> {
    {
        let mut p = inner.pairing.lock().unwrap();
        if p.as_ref().is_some_and(|p| p.started.elapsed() < PAIR_TIMEOUT) {
            let _ = io.send(&error_msg("busy", "Am Host läuft gerade eine andere Kopplung."));
            return None;
        }
        *p = Some(Pairing { conn: conn_id, code: pair_code(), role: OPERATOR.into(), started: Instant::now() });
    }
    let code = inner.pairing.lock().unwrap().as_ref().map(|p| p.code.clone()).unwrap_or_default();
    inner.emit("remote-pairing", json!({ "name": name, "code": code }));
    let end = |ok: bool| {
        let mut p = inner.pairing.lock().unwrap();
        if p.as_ref().is_some_and(|p| p.conn == conn_id) {
            *p = None;
        }
        drop(p);
        inner.emit("remote-pairing-end", json!({ "ok": ok, "name": name }));
    };
    if io.send(&json!({ "t": "pair_wait" })).is_err() {
        end(false);
        return None;
    }
    let fp = inner.fingerprint.lock().unwrap().clone();
    let mut tries = 0;
    loop {
        let (active, expired) = match inner.pairing.lock().unwrap().as_ref() {
            Some(p) if p.conn == conn_id => (true, p.started.elapsed() > PAIR_TIMEOUT),
            _ => (false, false),
        };
        if !active || expired {
            let _ = io.send(&error_msg("pair", "Kopplung am Host abgebrochen oder abgelaufen."));
            end(false);
            return None;
        }
        let msg = match io.next() {
            Ok(Some(m)) => m,
            Ok(None) => continue,
            Err(_) => {
                end(false);
                return None;
            }
        };
        if kind(&msg) != "pair" {
            continue;
        }
        let proof = msg.get("proof").and_then(Value::as_str).unwrap_or("");
        if proof_ok(&code, &fp, proof) {
            let role = inner.pairing.lock().unwrap().as_ref().map(|p| p.role.clone()).unwrap_or_else(|| OPERATOR.into());
            let key = hex(&random_bytes(32));
            let c = PairedClient { id: hex(&random_bytes(8)), name: name.to_string(), role, key_hash: hex(&sha256(key.as_bytes())), paired_at: now_secs() };
            let host = {
                let mut st = inner.store.lock().unwrap();
                st.host.clients.push(c.clone());
                let _ = save_store(&st);
                host_name(&st.host)
            };
            let sent = io.send(&json!({ "t": "paired", "id": c.id, "key": key, "host": host }));
            end(sent.is_ok());
            return sent.ok().map(|_| c);
        }
        tries += 1;
        if tries >= PAIR_TRIES {
            let _ = io.send(&error_msg("pair", "Dreimal ein falscher Code. Die Kopplung wurde abgebrochen."));
            end(false);
            return None;
        }
        if io.send(&json!({ "t": "pair_wrong", "left": PAIR_TRIES - tries })).is_err() {
            end(false);
            return None;
        }
    }
}

// ---------- Host commands for the window ----------

#[tauri::command]
pub fn remote_host_info(state: State<'_, Remote>) -> HostInfo {
    host_info(&state.0)
}

#[tauri::command]
pub fn remote_host_configure(state: State<'_, Remote>, enabled: bool, port: u16, name: String, confirm: bool) -> Result<HostInfo, String> {
    {
        let mut st = state.0.store.lock().unwrap();
        let restart_needed = st.host.enabled != enabled || st.host.port != port;
        st.host.enabled = enabled;
        st.host.port = if port < 1024 { DEFAULT_PORT } else { port };
        st.host.name = name.chars().take(80).collect();
        st.host.confirm = confirm;
        save_store(&st)?;
        if !restart_needed {
            drop(st);
            return Ok(host_info(&state.0));
        }
    }
    restart(&state.0);
    Ok(host_info(&state.0))
}

#[tauri::command]
pub fn remote_host_clients(state: State<'_, Remote>) -> Vec<ClientInfo> {
    clients(&state.0)
}

#[tauri::command]
pub fn remote_host_client_role(state: State<'_, Remote>, id: String, role: String) -> Result<Vec<ClientInfo>, String> {
    let role = if role == VIEWER { VIEWER } else { OPERATOR }.to_string();
    {
        let mut st = state.0.store.lock().unwrap();
        let c = st.host.clients.iter_mut().find(|c| c.id == id).ok_or("Unbekannter Rechner")?;
        c.role = role.clone();
        save_store(&st)?;
    }
    for p in state.0.peers.lock().unwrap().values_mut().filter(|p| p.client == id) {
        p.role = role.clone();
        let _ = p.tx.send(json!({ "t": "ev", "e": "role", "d": role }));
    }
    state.0.clients_changed();
    Ok(clients(&state.0))
}

/// Forget a paired computer; open connections end immediately
#[tauri::command]
pub fn remote_host_client_remove(state: State<'_, Remote>, id: String) -> Result<Vec<ClientInfo>, String> {
    {
        let mut st = state.0.store.lock().unwrap();
        st.host.clients.retain(|c| c.id != id);
        save_store(&st)?;
    }
    for p in state.0.peers.lock().unwrap().values().filter(|p| p.client == id) {
        let _ = p.tx.send(error_msg("auth", "Der Host hat die Kopplung mit diesem Rechner aufgehoben."));
        p.kill.store(true, Ordering::SeqCst);
    }
    state.0.clients_changed();
    Ok(clients(&state.0))
}

/// Role for the computer that is pairing right now
#[tauri::command]
pub fn remote_pairing_role(state: State<'_, Remote>, role: String) {
    if let Some(p) = state.0.pairing.lock().unwrap().as_mut() {
        p.role = if role == VIEWER { VIEWER } else { OPERATOR }.into();
    }
}

#[tauri::command]
pub fn remote_pairing_cancel(state: State<'_, Remote>) {
    *state.0.pairing.lock().unwrap() = None;
}

/// Answer of the window to a "remote-request": { result } or { error }
#[tauri::command]
pub fn remote_respond(state: State<'_, Remote>, id: u64, response: Value) {
    if let Some(tx) = state.0.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(response);
    }
}

/// Current state of the host (machine, jobs); kept for new clients and sent to all connected ones
#[tauri::command]
pub fn remote_host_state(state: State<'_, Remote>, value: Value) {
    *state.0.state.lock().unwrap() = value.clone();
    state.0.broadcast(json!({ "t": "ev", "e": "state", "d": value }));
}

/// Any other event for all clients (e.g. a new job in the list)
#[tauri::command]
pub fn remote_host_broadcast(state: State<'_, Remote>, event: String, data: Value) {
    state.0.broadcast(json!({ "t": "ev", "e": event, "d": data }));
}

/// At program start: remember the window and start the server if host mode is on
pub fn start(app: &AppHandle, state: &Remote) {
    let _ = state.0.app.set(app.clone());
    restart(&state.0);
}

// ---------- Client ----------

fn find_credential(inner: &Inner, fingerprint: &str) -> Option<Credential> {
    let want = unhex(fingerprint)?;
    inner.store.lock().unwrap().credentials.iter().find(|c| unhex(&c.fingerprint).as_deref() == Some(&want[..])).cloned()
}

fn client_dispatch(inner: &Inner, msg: Value) {
    match kind(&msg) {
        "ev" => {
            let e = msg.get("e").and_then(Value::as_str).unwrap_or("");
            let d = msg.get("d").cloned().unwrap_or(Value::Null);
            match e {
                "line" => inner.emit("machine-line", d),
                "progress" => inner.emit("machine-progress", d),
                "done" => inner.emit("machine-done", d),
                _ => inner.emit("remote-event", json!({ "e": e, "d": d })),
            }
        }
        "res" => {
            let id = msg.get("id").and_then(Value::as_u64).unwrap_or(0);
            if let Some(tx) = inner.link_pending.lock().unwrap().remove(&id) {
                let _ = tx.send(msg);
            }
        }
        "error" => inner.emit("remote-event", json!({ "e": "error", "d": error_text(&msg) })),
        _ => {}
    }
}

fn close_link(inner: &Inner) {
    if let Some(l) = inner.link.lock().unwrap().take() {
        let _ = l.tx.send(json!({ "t": "bye" }));
        l.kill.store(true, Ordering::SeqCst);
    }
}

fn client_connect(inner: Arc<Inner>, host: String, port: u16, fingerprint: String, name: String) -> Result<Value, String> {
    let cred = find_credential(&inner, &fingerprint).ok_or("Dieser Rechner ist mit dem Host noch nicht gekoppelt. Erst in den Geräteeinstellungen koppeln.")?;
    close_link(&inner);
    let (mut io, _) = open_client(&host, port, unhex(&cred.fingerprint))?;
    io.send(&json!({ "t": "hello", "proto": PROTO, "app": env!("CARGO_PKG_VERSION"), "name": name, "id": cred.id, "key": cred.key }))
        .map_err(|e| format!("Senden fehlgeschlagen: {e}"))?;
    let w = io.wait(Duration::from_secs(10)).map_err(|_| "Der Host antwortet nicht.".to_string())?;
    match kind(&w) {
        "welcome" => {}
        "error" => return Err(error_text(&w)),
        _ => return Err("Unerwartete Antwort vom Host".into()),
    }
    let (tx, rx) = channel::<Value>();
    let kill = Arc::new(AtomicBool::new(false));
    *inner.link.lock().unwrap() = Some(Link { tx, kill: kill.clone() });
    let th = inner.clone();
    std::thread::spawn(move || {
        let reason = client_loop(&th, &mut io, &rx, &kill);
        // Only clear the link if it is still this one (a new connection may have replaced it)
        {
            let mut l = th.link.lock().unwrap();
            if l.as_ref().is_some_and(|l| Arc::ptr_eq(&l.kill, &kill)) {
                *l = None;
            }
        }
        for (_, tx) in th.link_pending.lock().unwrap().drain() {
            let _ = tx.send(json!({ "t": "res", "ok": false, "err": "Verbindung zum Host getrennt" }));
        }
        th.emit("machine-closed", json!(reason.unwrap_or_default()));
    });
    Ok(w)
}

/// Runs until the connection ends; Some(reason) if it ended unexpectedly
fn client_loop(inner: &Inner, io: &mut ClientIo, rx: &Receiver<Value>, kill: &AtomicBool) -> Option<String> {
    loop {
        while let Ok(out) = rx.try_recv() {
            if io.send(&out).is_err() {
                return Some("Verbindung zum Host verloren".into());
            }
        }
        if kill.load(Ordering::SeqCst) {
            return None;
        }
        match io.next() {
            Ok(Some(msg)) => {
                if kind(&msg) == "error" && msg.get("code").and_then(Value::as_str) == Some("auth") {
                    return Some(error_text(&msg));
                }
                client_dispatch(inner, msg);
            }
            Ok(None) => {}
            Err(_) => return Some("Verbindung zum Host verloren".into()),
        }
    }
}

fn client_request(inner: &Inner, method: &str, params: Value) -> Result<Value, String> {
    let tx = inner.link.lock().unwrap().as_ref().map(|l| l.tx.clone()).ok_or("Nicht verbunden")?;
    let id = inner.next_req.fetch_add(1, Ordering::SeqCst) + 1;
    let (rtx, rrx) = channel();
    inner.link_pending.lock().unwrap().insert(id, rtx);
    if tx.send(json!({ "t": "req", "id": id, "m": method, "p": params })).is_err() {
        inner.link_pending.lock().unwrap().remove(&id);
        return Err("Verbindung getrennt".into());
    }
    let answer = rrx.recv_timeout(CALL_TIMEOUT + Duration::from_secs(10));
    inner.link_pending.lock().unwrap().remove(&id);
    let a = answer.map_err(|_| "Der Host hat nicht rechtzeitig geantwortet.".to_string())?;
    if a.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(a.get("r").cloned().unwrap_or(Value::Null))
    } else {
        Err(a.get("err").and_then(Value::as_str).unwrap_or("Fehler").to_string())
    }
}

#[tauri::command]
pub async fn remote_connect(state: State<'_, Remote>, host: String, port: u16, fingerprint: String, name: String) -> Result<Value, String> {
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || client_connect(inner, host, port, fingerprint, name)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn remote_disconnect(state: State<'_, Remote>) {
    close_link(&state.0);
}

/// Request to the host (line, realtime, pause, resume, stop, job_submit, job_start, frame, jobs, state …)
#[tauri::command]
pub async fn remote_request(state: State<'_, Remote>, method: String, params: Value) -> Result<Value, String> {
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || client_request(&inner, &method, params)).await.map_err(|e| e.to_string())?
}

/// Start pairing: connect without a pinned certificate and ask the host for a code
#[tauri::command]
pub async fn remote_pair_begin(state: State<'_, Remote>, host: String, port: u16, name: String) -> Result<Value, String> {
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        *inner.pair_session.lock().unwrap() = None;
        let (mut io, fp) = open_client(&host, port, None)?;
        io.send(&json!({ "t": "hello", "proto": PROTO, "app": env!("CARGO_PKG_VERSION"), "name": name, "pair": true }))
            .map_err(|e| format!("Senden fehlgeschlagen: {e}"))?;
        let r = io.wait(Duration::from_secs(10)).map_err(|_| "Der Host antwortet nicht. Ist dort der Host-Modus eingeschaltet?".to_string())?;
        match kind(&r) {
            "pair_wait" => {}
            "error" => return Err(error_text(&r)),
            _ => return Err("Unerwartete Antwort vom Host".into()),
        }
        let shown = show_fingerprint(&fp);
        *inner.pair_session.lock().unwrap() = Some(PairSession { io, fp });
        Ok(json!({ "fingerprint": shown }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Finish pairing with the code shown on the host; stores the key on success
#[tauri::command]
pub async fn remote_pair_finish(state: State<'_, Remote>, code: String) -> Result<Value, String> {
    let inner = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = inner.pair_session.lock().unwrap().take().ok_or("Keine Kopplung begonnen")?;
        s.io.send(&json!({ "t": "pair", "proof": pair_proof(&code, &s.fp) })).map_err(|e| format!("Senden fehlgeschlagen: {e}"))?;
        let r = s.io.wait(Duration::from_secs(30)).map_err(|_| "Der Host antwortet nicht.".to_string())?;
        match kind(&r) {
            "paired" => {
                let c = Credential {
                    fingerprint: hex(&s.fp),
                    id: r.get("id").and_then(Value::as_str).unwrap_or("").into(),
                    key: r.get("key").and_then(Value::as_str).unwrap_or("").into(),
                    host_name: r.get("host").and_then(Value::as_str).unwrap_or("").into(),
                };
                let mut st = inner.store.lock().unwrap();
                st.credentials.retain(|x| unhex(&x.fingerprint) != Some(s.fp.clone()));
                st.credentials.push(c.clone());
                save_store(&st)?;
                Ok(json!({ "fingerprint": c.fingerprint, "host": c.host_name }))
            }
            "pair_wrong" => {
                let left = r.get("left").and_then(Value::as_u64).unwrap_or(0);
                *inner.pair_session.lock().unwrap() = Some(s);
                Err(if left == 1 { "Falscher Code, noch 1 Versuch.".to_string() } else { format!("Falscher Code, noch {left} Versuche.") })
            }
            "error" => Err(error_text(&r)),
            _ => Err("Unerwartete Antwort vom Host".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn remote_pair_cancel(state: State<'_, Remote>) {
    *state.0.pair_session.lock().unwrap() = None;
}

/// Name of the paired host for a fingerprint, or null if not paired
#[tauri::command]
pub fn remote_paired(state: State<'_, Remote>, fingerprint: String) -> Option<String> {
    find_credential(&state.0, &fingerprint).map(|c| c.host_name)
}

/// Forget the key for a host on this computer
#[tauri::command]
pub fn remote_forget(state: State<'_, Remote>, fingerprint: String) -> Result<(), String> {
    let want = unhex(&fingerprint);
    let mut st = state.0.store.lock().unwrap();
    st.credentials.retain(|c| unhex(&c.fingerprint) != want);
    save_store(&st)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proof_binds_code_and_fingerprint() {
        let fp = sha256(b"cert");
        let p = pair_proof("123456", &fp);
        assert!(proof_ok("123456", &fp, &p));
        assert!(!proof_ok("123457", &fp, &p));
        assert!(!proof_ok("123456", &sha256(b"other cert"), &p));
        assert!(!proof_ok("123456", &fp, "zz"));
        // spaces around the typed code do not matter
        assert!(proof_ok("123456", &fp, &pair_proof(" 123456 ", &fp)));
    }

    #[test]
    fn codes_have_six_digits() {
        for _ in 0..50 {
            let c = pair_code();
            assert_eq!(c.len(), 6);
            assert!(c.chars().all(|x| x.is_ascii_digit()));
        }
    }

    #[test]
    fn hex_roundtrip_and_fingerprint_format() {
        let b = vec![0u8, 1, 0xab, 0xff];
        assert_eq!(unhex(&hex(&b)), Some(b));
        assert_eq!(unhex("00 01 AB FF"), Some(vec![0, 1, 0xab, 0xff]));
        assert_eq!(show_fingerprint(&[0xab, 0xcd, 0x01, 0x02, 0x03]), "ABCD 0102 03");
    }

    #[test]
    fn viewers_may_only_watch() {
        assert!(viewer_may("state", &json!({})));
        assert!(viewer_may("jobs", &json!({})));
        assert!(viewer_may("realtime", &json!({ "byte": 63 })));
        assert!(viewer_may("camera_frame", &json!({ "cam": "a" })));
        assert!(viewer_may("sync", &json!({})));
        assert!(!viewer_may("realtime", &json!({ "byte": 0x18 })));
        assert!(!viewer_may("line", &json!({ "line": "$H" })));
        assert!(!viewer_may("stop", &json!({})));
        assert!(!viewer_may("job_start", &json!({})));
    }

    /// In-memory duplex stream for the framing tests
    struct Pipe {
        input: io::Cursor<Vec<u8>>,
        output: Vec<u8>,
    }
    impl Read for Pipe {
        fn read(&mut self, b: &mut [u8]) -> io::Result<usize> {
            let n = self.input.read(b)?;
            if n == 0 {
                return Err(io::ErrorKind::WouldBlock.into());
            }
            Ok(n)
        }
    }
    impl Write for Pipe {
        fn write(&mut self, b: &[u8]) -> io::Result<usize> {
            self.output.extend_from_slice(b);
            Ok(b.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn lines_split_messages() {
        let big = "x".repeat(200_000);
        let data = format!("{{\"t\":\"a\"}}\n\n{{\"t\":\"b\",\"d\":\"{big}\"}}\n{{\"t\":");
        let mut l = Lines::new(Pipe { input: io::Cursor::new(data.into_bytes()), output: Vec::new() });
        assert_eq!(kind(&l.next().unwrap().unwrap()), "a");
        let b = l.next().unwrap().unwrap();
        assert_eq!(b["d"].as_str().unwrap().len(), 200_000);
        // incomplete message: nothing yet
        assert!(l.next().unwrap().is_none());
        l.send(&json!({ "t": "c" })).unwrap();
        assert_eq!(l.s.output, b"{\"t\":\"c\"}\n");
    }

    /// Pairing with a wrong and a right code, then a normal connection with the new key and role checks
    #[test]
    fn pair_then_connect() {
        let (cert, key) = new_identity().unwrap();
        let cfg = server_config(&cert, &key).unwrap();
        let inner = Arc::new(Inner::default());
        *inner.fingerprint.lock().unwrap() = sha256(&cert);
        *inner.state.lock().unwrap() = json!({ "machine": { "connected": true } });
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let srv = inner.clone();
        std::thread::spawn(move || {
            for sock in listener.incoming() {
                let (srv, cfg) = (srv.clone(), cfg.clone());
                std::thread::spawn(move || serve(srv, sock.unwrap(), cfg, 0));
            }
        });
        let w = Duration::from_secs(5);

        let (mut io, fp) = open_client("127.0.0.1", port, None).unwrap();
        io.send(&json!({ "t": "hello", "proto": PROTO, "name": "Laptop", "pair": true })).unwrap();
        assert_eq!(kind(&io.wait(w).unwrap()), "pair_wait");
        let code = inner.pairing.lock().unwrap().as_ref().unwrap().code.clone();
        let wrong = if code == "000000" { "000001" } else { "000000" };
        io.send(&json!({ "t": "pair", "proof": pair_proof(wrong, &fp) })).unwrap();
        let r = io.wait(w).unwrap();
        assert_eq!((kind(&r), r["left"].as_u64()), ("pair_wrong", Some(2)));
        io.send(&json!({ "t": "pair", "proof": pair_proof(&code, &fp) })).unwrap();
        let paired = io.wait(w).unwrap();
        assert_eq!(kind(&paired), "paired");
        assert_eq!(kind(&io.wait(w).unwrap()), "welcome");
        drop(io);
        let id = paired["id"].as_str().unwrap().to_string();
        let key = paired["key"].as_str().unwrap().to_string();
        // the host keeps only a hash of the key
        assert!(inner.store.lock().unwrap().host.clients.iter().all(|c| c.key_hash != key));

        // wrong key is refused
        let (mut io, _) = open_client("127.0.0.1", port, Some(fp.clone())).unwrap();
        io.send(&json!({ "t": "hello", "proto": PROTO, "id": id, "key": "nope" })).unwrap();
        let r = io.wait(w).unwrap();
        assert_eq!((kind(&r), r["code"].as_str()), ("error", Some("auth")));

        // other protocol version is refused
        let (mut io, _) = open_client("127.0.0.1", port, Some(fp.clone())).unwrap();
        io.send(&json!({ "t": "hello", "proto": PROTO + 1, "id": id, "key": key })).unwrap();
        assert_eq!(io.wait(w).unwrap()["code"], "proto");

        let (mut io, _) = open_client("127.0.0.1", port, Some(fp.clone())).unwrap();
        io.send(&json!({ "t": "hello", "proto": PROTO, "id": id, "key": key })).unwrap();
        let wel = io.wait(w).unwrap();
        assert_eq!((kind(&wel), wel["role"].as_str()), ("welcome", Some(OPERATOR)));
        assert_eq!(wel["state"]["machine"]["connected"], true);
        io.send(&json!({ "t": "req", "id": 1, "m": "state" })).unwrap();
        let r = io.wait(w).unwrap();
        assert_eq!((r["id"].as_u64(), r["ok"].as_bool()), (Some(1), Some(true)));
        // machine output reaches the client
        inner.broadcast(json!({ "t": "ev", "e": "line", "d": "<Idle|MPos:0,0,0>" }));
        assert_eq!(io.wait(w).unwrap()["d"], "<Idle|MPos:0,0,0>");
        // as viewer, moving the laser is refused
        for p in inner.peers.lock().unwrap().values_mut() {
            p.role = VIEWER.into();
        }
        io.send(&json!({ "t": "req", "id": 2, "m": "line", "p": { "line": "$H" } })).unwrap();
        let r = io.wait(w).unwrap();
        assert_eq!((r["id"].as_u64(), r["ok"].as_bool()), (Some(2), Some(false)));
    }

    /// Full TLS round trip over loopback: pinned certificate accepted, a different one refused
    #[test]
    fn tls_pinning() {
        let (cert, key) = new_identity().unwrap();
        let cfg = server_config(&cert, &key).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut sock, _) = listener.accept().unwrap();
                sock.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut conn = ServerConnection::new(cfg.clone()).unwrap();
                let mut ok = true;
                while conn.is_handshaking() {
                    if conn.complete_io(&mut sock).is_err() {
                        ok = false;
                        break;
                    }
                }
                if ok {
                    sock.set_read_timeout(Some(TICK)).unwrap();
                    let mut io = Lines::new(StreamOwned::new(conn, sock));
                    let m = io.wait(Duration::from_secs(5)).unwrap();
                    io.send(&json!({ "t": "echo", "d": m })).unwrap();
                }
            }
        });
        let fp = sha256(&cert);
        let (mut io, seen) = open_client("127.0.0.1", port, Some(fp.clone())).unwrap();
        assert_eq!(seen, fp);
        io.send(&json!({ "t": "hello" })).unwrap();
        let r = io.wait(Duration::from_secs(5)).unwrap();
        assert_eq!(r["d"]["t"], "hello");
        let wrong = open_client("127.0.0.1", port, Some(sha256(b"other")));
        assert!(wrong.is_err_and(|e| e.contains("anderen Zertifikat")));
        server.join().unwrap();
    }
}
