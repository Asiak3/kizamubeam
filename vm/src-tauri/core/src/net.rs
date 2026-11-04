//! Runtime of the virtual machine: a tick thread runs the controller in real time, plus a
//! Telnet server (raw TCP like FluidNC port 23) and a WebSocket server (like FluidNC port 81). Each
//! connection gets its own number; replies go to the sender, alarms and the welcome to everyone.

use crate::camera::{self, FrameStore};
use crate::config::Config;
use crate::machine::{ClientId, Event, Machine, Segment, Snapshot, LOCAL};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tungstenite::handshake::server::{Request, Response};
use tungstenite::{Message, WebSocket};

/// Simulation tick
const TICK: Duration = Duration::from_millis(2);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub id: ClientId,
    /// "telnet" or "ws"
    pub kind: &'static str,
    pub addr: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    /// address or error message (e.g. port in use); None = off
    pub telnet: Option<Result<String, String>>,
    pub ws: Option<Result<String, String>>,
    pub camera: Option<Result<String, String>>,
}

struct Listener {
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Connection: info, channel for replies, flag to disconnect
type ClientSlot = (ClientInfo, Sender<String>, Arc<AtomicBool>);

struct Shared {
    machine: Mutex<Machine>,
    clients: Mutex<HashMap<ClientId, ClientSlot>>,
    next_id: AtomicU32,
    stop: AtomicBool,
    /// events and segments for the UI (or the headless output)
    events: Mutex<Vec<Event>>,
    segments: Mutex<Vec<Segment>>,
}

pub struct Runner {
    shared: Arc<Shared>,
    tick: Option<thread::JoinHandle<()>>,
    listeners: Vec<Listener>,
    info: ServerInfo,
    camera: Arc<FrameStore>,
}

impl Runner {
    pub fn start(cfg: Config) -> Runner {
        let shared = Arc::new(Shared {
            machine: Mutex::new(Machine::new(cfg)),
            clients: Mutex::new(HashMap::new()),
            next_id: AtomicU32::new(1),
            stop: AtomicBool::new(false),
            events: Mutex::new(Vec::new()),
            segments: Mutex::new(Vec::new()),
        });
        let s = shared.clone();
        let tick = thread::spawn(move || tick_loop(s));
        let mut r = Runner {
            shared,
            tick: Some(tick),
            listeners: Vec::new(),
            info: ServerInfo::default(),
            camera: Arc::new(FrameStore::default()),
        };
        r.restart_servers();
        r
    }

    /// (Re)start the servers on the current ports; existing connections are closed
    pub fn restart_servers(&mut self) {
        self.listeners.clear();
        for (_, _, closed) in self.shared.clients.lock().unwrap().values() {
            closed.store(true, Ordering::SeqCst);
        }
        let cfg = self.config();
        let host = if cfg.lan { "0.0.0.0" } else { "127.0.0.1" };
        let mut info = ServerInfo::default();
        for ws in [false, true] {
            let (enabled, port) = if ws {
                (cfg.ws_enabled, cfg.ws_port)
            } else {
                (cfg.telnet_enabled, cfg.telnet_port)
            };
            if !enabled {
                continue;
            }
            let res = match TcpListener::bind((host, port)) {
                Ok(l) => {
                    let addr = l.local_addr().map(|a| a.to_string()).unwrap_or_default();
                    let _ = l.set_nonblocking(true);
                    let stop = Arc::new(AtomicBool::new(false));
                    let (s, st) = (self.shared.clone(), stop.clone());
                    let handle = thread::spawn(move || accept_loop(l, s, st, ws));
                    self.listeners.push(Listener {
                        stop,
                        handle: Some(handle),
                    });
                    Ok(addr)
                }
                Err(e) => Err(format!("{host}:{port}: {e}")),
            };
            if ws {
                info.ws = Some(res);
            } else {
                info.telnet = Some(res);
            }
        }
        if cfg.camera_enabled {
            let stop = Arc::new(AtomicBool::new(false));
            info.camera = Some(
                match camera::start(host, cfg.camera_port, self.camera.clone(), stop.clone()) {
                    Ok((addr, handle)) => {
                        self.listeners.push(Listener {
                            stop,
                            handle: Some(handle),
                        });
                        Ok(addr)
                    }
                    Err(e) => Err(e),
                },
            );
        }
        self.info = info;
    }

    /// Latest camera image and who wants images
    pub fn camera(&self) -> Arc<FrameStore> {
        self.camera.clone()
    }

    pub fn info(&self) -> ServerInfo {
        self.info.clone()
    }

    pub fn config(&self) -> Config {
        self.shared.machine.lock().unwrap().cfg.clone()
    }

    /// New settings; changed ports restart the servers
    pub fn set_config(&mut self, cfg: Config) {
        let old = self.config();
        self.shared.machine.lock().unwrap().set_config(cfg);
        let new = self.config();
        if (
            old.telnet_enabled,
            old.telnet_port,
            old.ws_enabled,
            old.ws_port,
            old.lan,
            old.camera_enabled,
            old.camera_port,
        ) != (
            new.telnet_enabled,
            new.telnet_port,
            new.ws_enabled,
            new.ws_port,
            new.lan,
            new.camera_enabled,
            new.camera_port,
        ) {
            self.restart_servers();
        }
    }

    pub fn clients(&self) -> Vec<ClientInfo> {
        let mut v: Vec<ClientInfo> = self
            .shared
            .clients
            .lock()
            .unwrap()
            .values()
            .map(|c| c.0.clone())
            .collect();
        v.sort_by_key(|c| c.id);
        v
    }

    pub fn snapshot(&self) -> Snapshot {
        self.shared.machine.lock().unwrap().snapshot()
    }

    pub fn take_events(&self) -> Vec<Event> {
        std::mem::take(&mut *self.shared.events.lock().unwrap())
    }

    pub fn take_segments(&self) -> Vec<Segment> {
        std::mem::take(&mut *self.shared.segments.lock().unwrap())
    }

    /// Line from the own console
    pub fn send_local(&self, bytes: &[u8]) {
        self.shared.machine.lock().unwrap().input(LOCAL, bytes);
        flush(&self.shared);
    }

    pub fn power_cycle(&self) {
        self.shared.machine.lock().unwrap().power_cycle();
        flush(&self.shared);
    }

    pub fn with_machine<T>(&self, f: impl FnOnce(&mut Machine) -> T) -> T {
        f(&mut self.shared.machine.lock().unwrap())
    }
}

impl Drop for Runner {
    fn drop(&mut self) {
        self.shared.stop.store(true, Ordering::SeqCst);
        self.listeners.clear();
        if let Some(h) = self.tick.take() {
            let _ = h.join();
        }
    }
}

/// Distribute controller output to the connections, collect events
fn flush(s: &Shared) {
    let (out, events, segs) = {
        let mut m = s.machine.lock().unwrap();
        (m.take_out(), m.take_events(), m.take_segments())
    };
    if !out.is_empty() {
        let clients = s.clients.lock().unwrap();
        for o in out {
            for (id, (_, tx, _)) in clients.iter() {
                if o.to.is_none() || o.to == Some(*id) {
                    let _ = tx.send(o.text.clone());
                }
            }
        }
    }
    if !events.is_empty() {
        let mut e = s.events.lock().unwrap();
        e.extend(events);
        if e.len() > 50_000 {
            e.drain(..25_000);
        }
    }
    if !segs.is_empty() {
        let mut v = s.segments.lock().unwrap();
        v.extend(segs);
        if v.len() > 2_000_000 {
            v.drain(..1_000_000);
        }
    }
}

fn tick_loop(s: Arc<Shared>) {
    let mut last = Instant::now();
    while !s.stop.load(Ordering::SeqCst) {
        thread::sleep(TICK);
        let now = Instant::now();
        // after a stall (computer asleep) do not catch up for minutes
        let dt = now.duration_since(last).as_secs_f64().min(0.1);
        last = now;
        s.machine.lock().unwrap().tick(dt);
        flush(&s);
    }
}

fn accept_loop(l: TcpListener, s: Arc<Shared>, stop: Arc<AtomicBool>, ws: bool) {
    while !stop.load(Ordering::SeqCst) && !s.stop.load(Ordering::SeqCst) {
        match l.accept() {
            Ok((stream, addr)) => {
                let s2 = s.clone();
                let st = stop.clone();
                thread::spawn(move || {
                    let _ = stream.set_nonblocking(false);
                    if ws {
                        serve_ws(stream, addr, s2, st);
                    } else {
                        serve_telnet(stream, addr, s2, st);
                    }
                });
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(50)),
            Err(_) => thread::sleep(Duration::from_millis(200)),
        }
    }
}

fn register(
    s: &Shared,
    kind: &'static str,
    addr: SocketAddr,
) -> (ClientId, Receiver<String>, Arc<AtomicBool>) {
    let id = s.next_id.fetch_add(1, Ordering::SeqCst);
    let (tx, rx) = channel();
    let closed = Arc::new(AtomicBool::new(false));
    s.clients.lock().unwrap().insert(
        id,
        (
            ClientInfo {
                id,
                kind,
                addr: addr.to_string(),
            },
            tx,
            closed.clone(),
        ),
    );
    s.machine.lock().unwrap().connect(id);
    (id, rx, closed)
}

fn unregister(s: &Shared, id: ClientId) {
    s.clients.lock().unwrap().remove(&id);
    s.machine.lock().unwrap().disconnect(id);
}

/// Remove Telnet control sequences (IAC …) some programs send when connecting
fn strip_telnet(buf: &[u8], state: &mut u8) -> Vec<u8> {
    let mut out = Vec::with_capacity(buf.len());
    for &b in buf {
        match *state {
            0 if b == 0xFF => *state = 1,
            0 => out.push(b),
            1 if b == 0xFF => {
                out.push(0xFF);
                *state = 0
            }
            1 if (0xFB..=0xFE).contains(&b) => *state = 2,
            1 => *state = 0,
            _ => *state = 0,
        }
    }
    out
}

fn serve_telnet(mut stream: TcpStream, addr: SocketAddr, s: Arc<Shared>, stop: Arc<AtomicBool>) {
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_millis(5)));
    let (id, rx, closed) = register(&s, "telnet", addr);
    let mut buf = [0u8; 4096];
    let mut iac = 0u8;
    'outer: while !stop.load(Ordering::SeqCst)
        && !s.stop.load(Ordering::SeqCst)
        && !closed.load(Ordering::SeqCst)
    {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let data = strip_telnet(&buf[..n], &mut iac);
                s.machine.lock().unwrap().input(id, &data);
                flush(&s);
            }
            Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => break,
        }
        while let Ok(line) = rx.try_recv() {
            if stream.write_all(format!("{line}\r\n").as_bytes()).is_err() {
                break 'outer;
            }
        }
    }
    unregister(&s, id);
}

#[allow(clippy::result_large_err)]
fn serve_ws(stream: TcpStream, addr: SocketAddr, s: Arc<Shared>, stop: Arc<AtomicBool>) {
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    // FluidNC's web UI and KizamuBeam announce the subprotocol "arduino"
    let cb = |req: &Request, mut resp: Response| {
        if let Some(p) = req.headers().get("Sec-WebSocket-Protocol") {
            if p.to_str()
                .map(|v| v.split(',').any(|x| x.trim() == "arduino"))
                .unwrap_or(false)
            {
                resp.headers_mut()
                    .insert("Sec-WebSocket-Protocol", "arduino".parse().unwrap());
            }
        }
        Ok(resp)
    };
    let Ok(mut ws): Result<WebSocket<TcpStream>, _> = tungstenite::accept_hdr(stream, cb) else {
        return;
    };
    let _ = ws
        .get_ref()
        .set_read_timeout(Some(Duration::from_millis(5)));
    let (id, rx, closed) = register(&s, "ws", addr);
    let _ = ws.send(Message::text(format!("CURRENT_ID:{id}")));
    let _ = ws.send(Message::text(format!("ACTIVE_ID:{id}")));
    'outer: while !stop.load(Ordering::SeqCst)
        && !s.stop.load(Ordering::SeqCst)
        && !closed.load(Ordering::SeqCst)
    {
        match ws.read() {
            Ok(Message::Text(t)) => {
                s.machine.lock().unwrap().input(id, t.as_bytes());
                flush(&s);
            }
            Ok(Message::Binary(b)) => {
                s.machine.lock().unwrap().input(id, &b);
                flush(&s);
            }
            Ok(Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(e))
                if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(_) => break,
        }
        let mut sent = false;
        while let Ok(line) = rx.try_recv() {
            // FluidNC sends controller output as binary messages
            if ws
                .write(Message::binary(format!("{line}\r\n").into_bytes()))
                .is_err()
            {
                break 'outer;
            }
            sent = true;
        }
        if sent && ws.flush().is_err() {
            break;
        }
    }
    let _ = ws.close(None);
    unregister(&s, id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;

    fn free_port() -> u16 {
        TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    fn read_until(r: &mut impl BufRead, want: &str) -> Vec<String> {
        let mut lines = Vec::new();
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(5) {
            let mut l = String::new();
            match r.read_line(&mut l) {
                Ok(0) => break,
                Ok(_) => {
                    let l = l.trim_end().to_string();
                    let done = l.starts_with(want);
                    lines.push(l);
                    if done {
                        return lines;
                    }
                }
                Err(_) => {}
            }
        }
        panic!("{want} nicht erhalten: {lines:?}");
    }

    #[test]
    fn telnet_roundtrip_and_ports_configurable() {
        let port = free_port();
        let r = Runner::start(Config {
            telnet_port: port,
            ws_enabled: false,
            ..Config::default()
        });
        assert_eq!(r.info().telnet, Some(Ok(format!("127.0.0.1:{port}"))));
        let s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_millis(100)))
            .unwrap();
        let mut w = s.try_clone().unwrap();
        let mut rd = std::io::BufReader::new(s);
        w.write_all(b"$I\n").unwrap();
        let l = read_until(&mut rd, "ok");
        assert!(l[0].contains("FluidNC"), "{l:?}");
        w.write_all(b"G1 X5 F3000\n").unwrap();
        read_until(&mut rd, "ok");
        thread::sleep(Duration::from_millis(400));
        w.write_all(b"?").unwrap();
        let l = read_until(&mut rd, "<");
        assert!(l.last().unwrap().contains("MPos:5.000"), "{l:?}");
        assert_eq!(r.clients().len(), 1);
    }

    #[test]
    fn websocket_roundtrip() {
        let port = free_port();
        let _r = Runner::start(Config {
            ws_port: port,
            telnet_enabled: false,
            ..Config::default()
        });
        let (mut ws, _) = tungstenite::connect(format!("ws://127.0.0.1:{port}/")).unwrap();
        let mut got = String::new();
        ws.send(Message::text("$G\n")).unwrap();
        let start = Instant::now();
        while !got.contains("ok") && start.elapsed() < Duration::from_secs(5) {
            match ws.read().unwrap() {
                Message::Binary(b) => got += &String::from_utf8_lossy(&b),
                Message::Text(t) => {
                    assert!(t.starts_with("CURRENT_ID") || t.starts_with("ACTIVE_ID"))
                }
                _ => {}
            }
        }
        assert!(got.contains("[GC:G0 G54 G17 G21 G90 G94 M5 M9"), "{got}");
    }

    #[test]
    fn busy_port_is_reported() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let r = Runner::start(Config {
            telnet_port: port,
            ws_enabled: false,
            ..Config::default()
        });
        assert!(matches!(r.info().telnet, Some(Err(_))));
    }
}
