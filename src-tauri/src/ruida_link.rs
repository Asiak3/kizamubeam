//! Direkte Anbindung von Ruida-DSP-Steuerungen über UDP (Datenport 50200, Tastenport 50207)
//! oder USB-Seriell (FT245R).
//!
//! Nimmt dieselben `stream::Cmd`-Befehle entgegen wie `stream.rs` und meldet Status, Position,
//! Fortschritt und Job-Ende über `stream::Events` an die Oberfläche.

use crate::stream::{Cmd, Events};
use kizamubeam_core::ruida::{
    self, card_name, checked_payload, encode_i35, from_ruida_abs, lines_to_ruida, mem,
    mem_read_cmd, packet, parse_jog_or_move, parse_mem_reply, split_plain_chunks, swizzle,
    swizzle_byte, to_ruida_abs, to_ruida_rel, u35, unswizzle, unswizzle_byte, validate_target_ip,
    ACK, NAK, STATUS_JOB_RUNNING, STATUS_MOVING, STATUS_PAUSED,
};
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::sync::Arc;
use std::time::{Duration, Instant};

const MAX_UDP_PAYLOAD: usize = 1000;
const MAX_RETRIES: usize = 3;
const PACKET_TIMEOUT: Duration = Duration::from_millis(1200);
const QUERY_TIMEOUT: Duration = Duration::from_millis(500);
const POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Clone, Debug)]
pub struct RuidaConfig {
    pub bed_w: f64,
    pub bed_h: f64,
    pub origin: String,
    pub magic: Option<u8>,
}

impl Default for RuidaConfig {
    fn default() -> Self {
        Self {
            bed_w: 600.0,
            bed_h: 400.0,
            origin: "top-right".into(),
            magic: None,
        }
    }
}

pub trait RuidaTransport: Send {
    /// Sendet ein unverwürfeltes Befehlspaket und wartet auf ACK (mit Wiederholung bei NAK/Timeout).
    fn send_cmd(&mut self, plain: &[u8], magic: u8, timeout: Duration) -> Result<(), String>;

    /// Liest eine 14-Bit-Speicheradresse (`DA 00 hi lo`) und gibt die unverwürfelten Antwort-Nutzdaten zurück.
    fn read_mem(&mut self, addr: u32, magic: u8, timeout: Duration) -> Result<Vec<u8>, String>;

    /// Sendet einen unverwürfelten Tastenbefehl (`A5 50/51 ...`) über den Tastenport (oder als `A7` über den Datenport).
    fn send_key(&mut self, key_cmd: &[u8], magic: u8) -> Result<(), String>;
}

pub struct UdpTransport {
    data: UdpSocket,
    keys: Option<UdpSocket>,
}

impl UdpTransport {
    pub fn connect(host: &str, data_port: u16, jog_port: u16) -> Result<Self, String> {
        let host = host.trim();
        if host.is_empty() {
            return Err("Keine IP-Adresse für die Ruida-Steuerung angegeben.".into());
        }
        let target: SocketAddr = (host, data_port)
            .to_socket_addrs()
            .map_err(|e| format!("{host}:{data_port}: {e}"))?
            .next()
            .ok_or_else(|| format!("{host}:{data_port}: Adresse nicht gefunden"))?;
        validate_target_ip(target.ip())?;

        let bind_addr = match target.ip() {
            IpAddr::V4(v4) if v4.is_loopback() => "127.0.0.1:0",
            IpAddr::V4(_) => "0.0.0.0:0",
            IpAddr::V6(v6) if v6.is_loopback() => "[::1]:0",
            IpAddr::V6(_) => "[::]:0",
        };
        let data = UdpSocket::bind(bind_addr).map_err(|e| format!("UDP-Socket: {e}"))?;
        data.connect(target).map_err(|e| format!("{target}: {e}"))?;

        let keys = if jog_port > 0 {
            let mut key_target = target;
            key_target.set_port(jog_port);
            UdpSocket::bind(bind_addr).ok().and_then(|s| {
                s.connect(key_target).ok()?;
                s.set_read_timeout(Some(Duration::from_millis(250))).ok();
                Some(s)
            })
        } else {
            None
        };

        Ok(Self { data, keys })
    }

    fn drain_stale(&self) {
        let _ = self.data.set_nonblocking(true);
        let mut buf = [0u8; 512];
        while self.data.recv(&mut buf).is_ok() {}
        let _ = self.data.set_nonblocking(false);
    }
}

impl RuidaTransport for UdpTransport {
    fn send_cmd(&mut self, plain: &[u8], magic: u8, timeout: Duration) -> Result<(), String> {
        self.drain_stale();
        let pkt = packet(plain, magic);
        let want_ack = swizzle_byte(ACK, magic);
        let want_nak = swizzle_byte(NAK, magic);
        let _ = self.data.set_read_timeout(Some(timeout));
        let mut buf = [0u8; 512];

        for attempt in 0..MAX_RETRIES {
            self.data
                .send(&pkt)
                .map_err(|e| format!("UDP-Senden fehlgeschlagen: {e}"))?;
            let deadline = Instant::now() + timeout;
            while Instant::now() < deadline {
                match self.data.recv(&mut buf) {
                    Ok(1) if buf[0] == want_ack => return Ok(()),
                    Ok(1) if buf[0] == want_nak => break, // Sofort wiederholen
                    Ok(_) => continue,
                    Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                        break;
                    }
                    Err(e) => return Err(format!("UDP-Empfang fehlgeschlagen: {e}")),
                }
            }
            if attempt + 1 == MAX_RETRIES {
                return Err("Keine Bestätigung (ACK) von der Ruida-Steuerung.".into());
            }
        }
        Err("Keine Bestätigung (ACK) von der Ruida-Steuerung.".into())
    }

    fn read_mem(&mut self, addr: u32, magic: u8, timeout: Duration) -> Result<Vec<u8>, String> {
        self.drain_stale();
        let cmd = mem_read_cmd(addr);
        let pkt = packet(&cmd, magic);
        let want_ack = swizzle_byte(ACK, magic);
        let want_nak = swizzle_byte(NAK, magic);
        let _ = self.data.set_read_timeout(Some(timeout));
        let mut buf = [0u8; 512];

        for _ in 0..2 {
            self.data
                .send(&pkt)
                .map_err(|e| format!("UDP-Abfrage fehlgeschlagen: {e}"))?;
            let deadline = Instant::now() + timeout;
            while Instant::now() < deadline {
                match self.data.recv(&mut buf) {
                    Ok(1) if buf[0] == want_ack => continue,
                    Ok(1) if buf[0] == want_nak => break,
                    Ok(n) if n >= 4 => {
                        let raw = checked_payload(&buf[..n]).unwrap_or(&buf[..n]);
                        let plain = unswizzle(raw, magic);
                        if let Some((rep_addr, payload)) = parse_mem_reply(&plain) {
                            if rep_addr == addr {
                                return Ok(payload.to_vec());
                            }
                        }
                    }
                    Ok(_) => continue,
                    Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                        break;
                    }
                    Err(e) => return Err(format!("UDP-Empfang fehlgeschlagen: {e}")),
                }
            }
        }
        Err("Keine Antwort auf Speicherabfrage.".into())
    }

    fn send_key(&mut self, key_cmd: &[u8], magic: u8) -> Result<(), String> {
        if let Some(keys) = &self.keys {
            let _ = keys.send(key_cmd);
            let mut buf = [0u8; 16];
            let _ = keys.recv(&mut buf);
            Ok(())
        } else {
            let mut cmd = key_cmd.to_vec();
            if cmd.first() == Some(&0xA5) {
                cmd[0] = 0xA7;
            }
            self.send_cmd(&cmd, magic, QUERY_TIMEOUT)
        }
    }
}

pub struct SerialRuidaTransport<P: Read + Write + Send> {
    port: P,
}

impl<P: Read + Write + Send> SerialRuidaTransport<P> {
    pub fn new(port: P) -> Self {
        Self { port }
    }
}

impl<P: Read + Write + Send> RuidaTransport for SerialRuidaTransport<P> {
    fn send_cmd(&mut self, plain: &[u8], magic: u8, timeout: Duration) -> Result<(), String> {
        let data = swizzle(plain, magic);
        let want_ack = swizzle_byte(ACK, magic);
        let want_nak = swizzle_byte(NAK, magic);
        let mut buf = [0u8; 1];

        for _ in 0..MAX_RETRIES {
            self.port
                .write_all(&data)
                .and_then(|_| self.port.flush())
                .map_err(|e| format!("USB-Senden fehlgeschlagen: {e}"))?;
            let deadline = Instant::now() + timeout;
            while Instant::now() < deadline {
                match self.port.read(&mut buf) {
                    Ok(1) if buf[0] == want_ack => return Ok(()),
                    Ok(1) if buf[0] == want_nak => break,
                    Ok(_) => continue,
                    Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Err(e) => return Err(format!("USB-Lesen fehlgeschlagen: {e}")),
                }
            }
        }
        Err("Keine Bestätigung (ACK) über USB von der Ruida-Steuerung.".into())
    }

    fn read_mem(&mut self, addr: u32, magic: u8, timeout: Duration) -> Result<Vec<u8>, String> {
        let cmd = swizzle(&mem_read_cmd(addr), magic);
        let want_ack = swizzle_byte(ACK, magic);
        self.port
            .write_all(&cmd)
            .and_then(|_| self.port.flush())
            .map_err(|e| format!("USB-Abfrage fehlgeschlagen: {e}"))?;
        let deadline = Instant::now() + timeout;
        let mut acc = Vec::with_capacity(16);
        let mut buf = [0u8; 32];
        while Instant::now() < deadline {
            match self.port.read(&mut buf) {
                Ok(n) if n > 0 => {
                    for &b in &buf[..n] {
                        if acc.is_empty() && b == want_ack {
                            continue;
                        }
                        acc.push(unswizzle_byte(b, magic));
                    }
                    if acc.len() >= 9 {
                        if let Some((rep_addr, payload)) = parse_mem_reply(&acc) {
                            if rep_addr == addr {
                                return Ok(payload.to_vec());
                            }
                        }
                    }
                }
                Ok(_) => std::thread::sleep(Duration::from_millis(5)),
                Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(e) => return Err(format!("USB-Lesen fehlgeschlagen: {e}")),
            }
        }
        Err("Keine Antwort auf USB-Speicherabfrage.".into())
    }

    fn send_key(&mut self, key_cmd: &[u8], magic: u8) -> Result<(), String> {
        let mut cmd = key_cmd.to_vec();
        if cmd.first() == Some(&0xA5) {
            cmd[0] = 0xA7;
        }
        self.send_cmd(&cmd, magic, QUERY_TIMEOUT)
    }
}

pub struct RuidaStreamer<T: RuidaTransport, E: Events> {
    transport: T,
    events: E,
    busy: Arc<AtomicBool>,
    cfg: RuidaConfig,
    magic: u8,
    card_id: Option<u32>,
    /// Letzte bekannte Maschinenposition in KizamuBeam-Bettkoordinaten (mm, vorne links = 0,0)
    mpos: [f64; 3],
    /// Benutzer-Ursprung (Work Coordinate Offset) in Bettkoordinaten
    wco: [f64; 3],
    state_name: &'static str,
}

impl<T: RuidaTransport, E: Events> RuidaStreamer<T, E> {
    /// Verbindet mit der Steuerung, erkennt ggf. das Magic-Byte anhand der Karten-ID-Abfrage
    /// und liest die Bettgröße aus.
    pub fn connect(
        mut transport: T,
        events: E,
        busy: Arc<AtomicBool>,
        cfg: RuidaConfig,
    ) -> Result<Self, String> {
        let candidates: Vec<u8> = match cfg.magic {
            Some(m) => vec![m],
            None => vec![0x88, 0x11, 0x38],
        };
        let mut detected_magic = candidates[0];
        let mut detected_card = None;
        for &m in &candidates {
            if let Ok(payload) = transport.read_mem(mem::CARD_ID, m, Duration::from_millis(600)) {
                if let Some(id) = u35(&payload) {
                    detected_magic = m;
                    detected_card = Some(id as u32);
                    break;
                }
            }
        }
        if detected_card.is_none() {
            return Err(
                "Keine Antwort von der Ruida-Steuerung (Port 50200). Bitte IP-Adresse und Verbindung prüfen."
                    .into(),
            );
        }
        Ok(Self {
            transport,
            events,
            busy,
            cfg,
            magic: detected_magic,
            card_id: detected_card,
            mpos: [0.0, 0.0, 0.0],
            wco: [0.0, 0.0, 0.0],
            state_name: "Idle",
        })
    }

    pub fn run(mut self, rx: Receiver<Cmd>) {
        if let Some(id) = self.card_id {
            self.events.line(&format!(
                "[Ruida] {} verbunden (Magic 0x{:02X})",
                card_name(id),
                self.magic
            ));
        }
        self.poll_status();
        let mut last_poll = Instant::now();

        loop {
            let wait = POLL_INTERVAL.saturating_sub(last_poll.elapsed());
            match rx.recv_timeout(wait) {
                Ok(Cmd::Close) | Err(RecvTimeoutError::Disconnected) => {
                    self.busy.store(false, Ordering::SeqCst);
                    self.events.closed(None);
                    return;
                }
                Ok(cmd) => {
                    if !self.handle_cmd(cmd, &rx) {
                        self.busy.store(false, Ordering::SeqCst);
                        self.events.closed(None);
                        return;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
            if last_poll.elapsed() >= POLL_INTERVAL {
                self.poll_status();
                last_poll = Instant::now();
            }
        }
    }

    fn poll_status(&mut self) {
        if let Ok(st_bytes) = self.transport.read_mem(mem::STATUS, self.magic, QUERY_TIMEOUT) {
            if let Some(bits) = u35(&st_bytes) {
                let bits = bits as u32;
                self.state_name = if (bits & STATUS_PAUSED) != 0 {
                    "Hold"
                } else if (bits & (STATUS_JOB_RUNNING | STATUS_MOVING)) != 0 {
                    "Run"
                } else {
                    "Idle"
                };
            }
        }
        let rx_mm = self
            .transport
            .read_mem(mem::POS_X, self.magic, QUERY_TIMEOUT)
            .ok()
            .and_then(|b| ruida::mm(&b));
        let ry_mm = self
            .transport
            .read_mem(mem::POS_Y, self.magic, QUERY_TIMEOUT)
            .ok()
            .and_then(|b| ruida::mm(&b));
        if let (Some(rx), Some(ry)) = (rx_mm, ry_mm) {
            let [bx, by] = from_ruida_abs(&self.cfg.origin, self.cfg.bed_w, self.cfg.bed_h, rx, ry);
            self.mpos[0] = bx;
            self.mpos[1] = by;
        }
        self.emit_status();
    }

    fn emit_status(&self) {
        let wx = self.mpos[0] - self.wco[0];
        let wy = self.mpos[1] - self.wco[1];
        let wz = self.mpos[2] - self.wco[2];
        self.events.line(&format!(
            "<{}|MPos:{:.3},{:.3},{:.3}|WPos:{:.3},{:.3},{:.3}>",
            self.state_name, self.mpos[0], self.mpos[1], self.mpos[2], wx, wy, wz
        ));
    }

    fn handle_cmd(&mut self, cmd: Cmd, rx: &Receiver<Cmd>) -> bool {
        match cmd {
            Cmd::Close => return false,
            Cmd::Pause => {
                let _ = self.transport.send_cmd(&[0xD8, 0x02], self.magic, QUERY_TIMEOUT);
                self.state_name = "Hold";
                self.emit_status();
            }
            Cmd::Resume => {
                let _ = self.transport.send_cmd(&[0xD8, 0x03], self.magic, QUERY_TIMEOUT);
                self.state_name = "Run";
                self.emit_status();
            }
            Cmd::Stop => {
                let _ = self.transport.send_cmd(&[0xD8, 0x01], self.magic, QUERY_TIMEOUT);
                self.busy.store(false, Ordering::SeqCst);
                self.state_name = "Idle";
                self.emit_status();
            }
            Cmd::Realtime(b) => match b {
                b'!' => {
                    let _ = self.transport.send_cmd(&[0xD8, 0x02], self.magic, QUERY_TIMEOUT);
                }
                b'~' => {
                    let _ = self.transport.send_cmd(&[0xD8, 0x03], self.magic, QUERY_TIMEOUT);
                }
                0x18 => {
                    let _ = self.transport.send_cmd(&[0xD8, 0x01], self.magic, QUERY_TIMEOUT);
                }
                0x85 => {
                    let _ = self.transport.send_cmd(&[0xD8, 0x30], self.magic, QUERY_TIMEOUT);
                }
                b'?' => self.poll_status(),
                _ => {}
            },
            Cmd::Line(line) => self.handle_line(line.trim()),
            Cmd::Job(lines) => {
                let plain = self.lines_to_ruida(&lines);
                self.execute_ruida_plain(&plain, rx);
            }
            Cmd::RuidaJob(raw) => {
                let file_magic = ruida::magic_for_file(&raw);
                let plain = unswizzle(&raw, file_magic);
                self.execute_ruida_plain(&plain, rx);
            }
        }
        true
    }

    fn handle_line(&mut self, line: &str) {
        if line.is_empty() {
            return;
        }
        if line == "$$" {
            if let Ok(bx) = self.transport.read_mem(mem::BED_X, self.magic, QUERY_TIMEOUT) {
                if let Some(w) = ruida::mm(&bx) {
                    self.cfg.bed_w = w;
                    self.events.line(&format!("$130={w:.3}"));
                }
            }
            if let Ok(by) = self.transport.read_mem(mem::BED_Y, self.magic, QUERY_TIMEOUT) {
                if let Some(h) = ruida::mm(&by) {
                    self.cfg.bed_h = h;
                    self.events.line(&format!("$131={h:.3}"));
                }
            }
            self.events.line("ok");
            return;
        }
        if line == "$H" {
            let _ = self.transport.send_cmd(&[0xD8, 0x2A], self.magic, PACKET_TIMEOUT);
            self.poll_status();
            self.events.line("ok");
            return;
        }
        if line == "G92 X0 Y0" || line == "G10 L20 P1 X0 Y0" {
            self.wco[0] = self.mpos[0];
            self.wco[1] = self.mpos[1];
            let _ = self.transport.send_cmd(&[0xD8, 0x12], self.magic, QUERY_TIMEOUT);
            self.emit_status();
            self.events.line("ok");
            return;
        }
        if line == "G92.1" || line.starts_with("G10 L20 P1 X") {
            self.wco = [0.0, 0.0, 0.0];
            self.emit_status();
            self.events.line("ok");
            return;
        }
        if let Some(rest) = line.strip_prefix("RUIDA_KEY ") {
            let bytes: Vec<u8> = rest
                .split_whitespace()
                .filter_map(|s| u8::from_str_radix(s.trim_start_matches("0x"), 16).ok())
                .collect();
            if !bytes.is_empty() {
                let _ = self.transport.send_key(&bytes, self.magic);
            }
            self.events.line("ok");
            return;
        }
        if let Some((rel, x, y)) = parse_jog_or_move(line) {
            if rel {
                let [rdx, rdy] = to_ruida_rel(&self.cfg.origin, x.unwrap_or(0.0), y.unwrap_or(0.0));
                let mut cmd = vec![0xD9, 0x10, 0x02];
                cmd.extend(encode_i35((rdx * 1000.0).round() as i64));
                cmd.extend(encode_i35((rdy * 1000.0).round() as i64));
                let _ = self.transport.send_cmd(&cmd, self.magic, PACKET_TIMEOUT);
            } else {
                let tx = x.map(|v| v + self.wco[0]).unwrap_or(self.mpos[0]);
                let ty = y.map(|v| v + self.wco[1]).unwrap_or(self.mpos[1]);
                let [rx, ry] = to_ruida_abs(&self.cfg.origin, self.cfg.bed_w, self.cfg.bed_h, tx, ty);
                let mut cmd = vec![0xD9, 0x10, 0x00];
                cmd.extend(encode_i35((rx * 1000.0).round() as i64));
                cmd.extend(encode_i35((ry * 1000.0).round() as i64));
                let _ = self.transport.send_cmd(&cmd, self.magic, PACKET_TIMEOUT);
            }
            self.poll_status();
            self.events.line("ok");
            return;
        }
        self.events.line("ok");
    }

    /// Übersetzt einfache G0/G1-Zeilen (z. B. aus `frameGCode`) in unverwürfelte Ruida-Befehle.
    fn lines_to_ruida(&self, lines: &[String]) -> Vec<u8> {
        lines_to_ruida(
            lines,
            &self.cfg.origin,
            self.cfg.bed_w,
            self.cfg.bed_h,
            self.mpos,
            self.wco,
        )
    }

    fn execute_ruida_plain(&mut self, plain: &[u8], rx: &Receiver<Cmd>) {
        let chunks = split_plain_chunks(plain, MAX_UDP_PAYLOAD);
        let total = chunks.len().max(1);
        self.busy.store(true, Ordering::SeqCst);
        self.state_name = "Run";
        self.emit_status();
        self.events.progress(0, 0, total, 0);

        for (i, chunk) in chunks.iter().enumerate() {
            while let Ok(cmd) = rx.try_recv() {
                match cmd {
                    Cmd::Stop => {
                        let _ = self.transport.send_cmd(&[0xD8, 0x01], self.magic, QUERY_TIMEOUT);
                        self.busy.store(false, Ordering::SeqCst);
                        self.state_name = "Idle";
                        self.emit_status();
                        self.events.done(false, "Abgebrochen");
                        return;
                    }
                    Cmd::Close => {
                        self.busy.store(false, Ordering::SeqCst);
                        return;
                    }
                    Cmd::Pause => {
                        let _ = self.transport.send_cmd(&[0xD8, 0x02], self.magic, QUERY_TIMEOUT);
                    }
                    Cmd::Resume => {
                        let _ = self.transport.send_cmd(&[0xD8, 0x03], self.magic, QUERY_TIMEOUT);
                    }
                    _ => {}
                }
            }
            if let Err(err) = self.transport.send_cmd(chunk, self.magic, PACKET_TIMEOUT) {
                self.busy.store(false, Ordering::SeqCst);
                self.state_name = "Idle";
                self.emit_status();
                self.events.done(false, &err);
                return;
            }
            self.events.progress(i + 1, i + 1, total, 0);
        }

        // Warten, bis die Steuerung den Auftrag abgearbeitet hat
        let started = Instant::now();
        loop {
            match rx.recv_timeout(Duration::from_millis(120)) {
                Ok(Cmd::Stop) => {
                    let _ = self.transport.send_cmd(&[0xD8, 0x01], self.magic, QUERY_TIMEOUT);
                    self.busy.store(false, Ordering::SeqCst);
                    self.state_name = "Idle";
                    self.emit_status();
                    self.events.done(false, "Abgebrochen");
                    return;
                }
                Ok(Cmd::Pause) => {
                    let _ = self.transport.send_cmd(&[0xD8, 0x02], self.magic, QUERY_TIMEOUT);
                    self.state_name = "Hold";
                    self.emit_status();
                }
                Ok(Cmd::Resume) => {
                    let _ = self.transport.send_cmd(&[0xD8, 0x03], self.magic, QUERY_TIMEOUT);
                    self.state_name = "Run";
                    self.emit_status();
                }
                Ok(Cmd::Close) | Err(RecvTimeoutError::Disconnected) => {
                    self.busy.store(false, Ordering::SeqCst);
                    return;
                }
                _ => {}
            }
            self.poll_status();
            if self.state_name == "Idle" && started.elapsed() >= Duration::from_millis(80) {
                break;
            }
        }

        self.busy.store(false, Ordering::SeqCst);
        self.state_name = "Idle";
        self.emit_status();
        self.events.done(true, "");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_broadcast_and_unspecified_ips() {
        assert!(validate_target_ip("0.0.0.0".parse().unwrap()).is_err());
        assert!(validate_target_ip("255.255.255.255".parse().unwrap()).is_err());
        assert!(validate_target_ip("192.168.1.255".parse().unwrap()).is_err());
        assert!(validate_target_ip("127.0.0.1".parse().unwrap()).is_ok());
        assert!(validate_target_ip("192.168.1.100".parse().unwrap()).is_ok());
    }

    #[test]
    fn parses_jog_and_move_commands() {
        assert_eq!(
            parse_jog_or_move("$J=G91 G21 X10 Y-5 F3000"),
            Some((true, Some(10.0), Some(-5.0)))
        );
        assert_eq!(
            parse_jog_or_move("$J=G90 G21 X120 Y80 F3000"),
            Some((false, Some(120.0), Some(80.0)))
        );
        assert_eq!(
            parse_jog_or_move("G0 X0 Y0"),
            Some((false, Some(0.0), Some(0.0)))
        );
    }
}
