//! FluidNC über die Weboberfläche (HTTP, Port 80): G-Code auf SD-Karte oder Flash hochladen und
//! Steuerungen im Netzwerk finden. Ein kleines HTTP/1.1 ohne zusätzliche Bibliothek; FluidNC schließt
//! die Verbindung nach jeder Antwort.

use serde::Serialize;
use std::io::{ErrorKind, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs, UdpSocket};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

pub struct Response {
    pub status: u16,
    pub body: String,
}

fn resolve(host: &str, port: u16) -> Result<SocketAddr, String> {
    (host.trim(), port)
        .to_socket_addrs()
        .map_err(|e| format!("{}: {e}", host.trim()))?
        .next()
        .ok_or_else(|| format!("{}: Adresse nicht gefunden", host.trim()))
}

/// Eine Anfrage senden und die Antwort lesen. `progress(gesendet, gesamt)` nach jedem Stück des Inhalts.
#[allow(clippy::too_many_arguments)]
pub fn request(
    addr: SocketAddr,
    host: &str,
    method: &str,
    path: &str,
    content_type: Option<&str>,
    body: &[u8],
    timeout: Duration,
    progress: &mut dyn FnMut(usize, usize),
) -> Result<Response, String> {
    let mut s = TcpStream::connect_timeout(&addr, timeout.min(Duration::from_secs(5))).map_err(|e| format!("{addr}: {e}"))?;
    s.set_read_timeout(Some(timeout)).map_err(|e| e.to_string())?;
    s.set_write_timeout(Some(timeout)).map_err(|e| e.to_string())?;
    let mut head = format!("{method} {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nUser-Agent: KizamuBeam\r\n");
    if let Some(ct) = content_type {
        head.push_str(&format!("Content-Type: {ct}\r\n"));
    }
    if method != "GET" || !body.is_empty() {
        head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    head.push_str("\r\n");
    let werr = |e: std::io::Error| format!("Senden fehlgeschlagen: {e}");
    s.write_all(head.as_bytes()).map_err(werr)?;
    // In Stücken senden, damit die Oberfläche den Fortschritt zeigen kann
    let mut sent = 0;
    for chunk in body.chunks(8192) {
        s.write_all(chunk).map_err(werr)?;
        sent += chunk.len();
        progress(sent, body.len());
    }
    s.flush().map_err(werr)?;
    read_response(&mut s)
}

fn read_response(s: &mut impl Read) -> Result<Response, String> {
    let mut raw = Vec::new();
    let mut buf = [0u8; 4096];
    let mut want: Option<usize> = None;
    loop {
        match s.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => raw.extend_from_slice(&buf[..n]),
            Err(e) if e.kind() == ErrorKind::Interrupted => continue,
            // Antwort vollständig, aber die Gegenstelle hält die Verbindung offen
            Err(e) if matches!(e.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) && want.is_some_and(|w| raw.len() >= w) => break,
            Err(e) if matches!(e.kind(), ErrorKind::TimedOut | ErrorKind::WouldBlock) => return Err("Zeitüberschreitung beim Warten auf die Antwort".into()),
            Err(e) => return Err(format!("Lesen fehlgeschlagen: {e}")),
        }
        if want.is_none() {
            if let Some(end) = find(&raw, b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&raw[..end]).to_ascii_lowercase();
                if let Some(len) = head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse::<usize>().ok()) {
                    want = Some(end + 4 + len);
                }
            }
        }
        if want.is_some_and(|w| raw.len() >= w) {
            break;
        }
    }
    let end = find(&raw, b"\r\n\r\n").ok_or("Ungültige Antwort der Steuerung")?;
    let head = String::from_utf8_lossy(&raw[..end]).to_string();
    let status = head
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse::<u16>().ok())
        .ok_or("Ungültige Antwort der Steuerung")?;
    let mut body = raw[end + 4..].to_vec();
    if let Some(w) = want {
        body.truncate(w - end - 4);
    }
    if head.to_ascii_lowercase().contains("transfer-encoding: chunked") {
        body = unchunk(&body);
    }
    Ok(Response { status, body: String::from_utf8_lossy(&body).into_owned() })
}

fn find(h: &[u8], n: &[u8]) -> Option<usize> {
    h.windows(n.len()).position(|w| w == n)
}

/// Transfer-Encoding: chunked auflösen
fn unchunk(mut b: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    while let Some(eol) = find(b, b"\r\n") {
        let size = String::from_utf8_lossy(&b[..eol]);
        let Ok(n) = usize::from_str_radix(size.split(';').next().unwrap_or("").trim(), 16) else { break };
        if n == 0 || b.len() < eol + 2 + n {
            break;
        }
        out.extend_from_slice(&b[eol + 2..eol + 2 + n]);
        b = &b[(eol + 4 + n).min(b.len())..];
    }
    out
}

/// Inhalt für ein Formular mit Datei, wie ihn die Weboberfläche von FluidNC schickt:
/// Feld „path“ (Ordner), Feld „/<name>S“ (Größe zur Prüfung) und die Datei unter „myfile[]“.
pub fn multipart(boundary: &str, name: &str, data: &[u8]) -> Vec<u8> {
    let file = format!("/{}", name.trim_start_matches('/'));
    let mut b = Vec::with_capacity(data.len() + 512);
    let field = |b: &mut Vec<u8>, k: &str, v: &str| {
        b.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n").as_bytes());
    };
    field(&mut b, "path", "/");
    field(&mut b, &format!("{file}S"), &data.len().to_string());
    b.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"myfile[]\"; filename=\"{file}\"\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes(),
    );
    b.extend_from_slice(data);
    b.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    b
}

/// Datei hochladen: SD-Karte über /upload, Flash (LocalFS) über /files
pub fn upload(host: &str, port: u16, fs: &str, name: &str, data: &[u8], progress: &mut dyn FnMut(usize, usize)) -> Result<(), String> {
    let path = match fs {
        "sd" => "/upload",
        "localfs" => "/files",
        _ => return Err(format!("Unbekannter Speicher „{fs}“")),
    };
    let mut rnd = [0u8; 8];
    let _ = getrandom::fill(&mut rnd);
    let boundary = format!("----KizamuBeam{}", rnd.iter().map(|b| format!("{b:02x}")).collect::<String>());
    let body = multipart(&boundary, name, data);
    let addr = resolve(host, port)?;
    let ct = format!("multipart/form-data; boundary={boundary}");
    let total = body.len();
    let r = request(addr, host.trim(), "POST", path, Some(&ct), &body, Duration::from_secs(60), &mut |s, _| progress(s.min(total), total))?;
    if !(200..300).contains(&r.status) {
        let msg = r.body.trim();
        return Err(format!("Hochladen fehlgeschlagen (HTTP {}){}", r.status, if msg.is_empty() { String::new() } else { format!(": {}", &msg[..msg.len().min(200)]) }));
    }
    Ok(())
}

#[derive(Serialize, Clone)]
struct UploadProgress {
    sent: usize,
    total: usize,
}

/// G-Code auf die Steuerung hochladen: fertige Zeilen oder G-Code, den der Rust-Kern vorbereitet hat (native::gcode_prepare)
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn fluid_upload(
    app: AppHandle,
    native: State<'_, Arc<crate::native::Native>>,
    host: String,
    port: u16,
    fs: String,
    name: String,
    id: Option<u32>,
    lines: Option<Vec<String>>,
) -> Result<usize, String> {
    let lines = match (id, lines) {
        (Some(id), _) => native.gcode(id)?.as_ref().clone(),
        (None, Some(l)) => l,
        _ => return Err("Kein G-Code".into()),
    };
    let mut data = lines.join("\n").into_bytes();
    data.push(b'\n');
    let size = data.len();
    tauri::async_runtime::spawn_blocking(move || {
        let mut last = Instant::now();
        upload(&host, port, &fs, &name, &data, &mut |sent, total| {
            if sent == total || last.elapsed() >= Duration::from_millis(200) {
                last = Instant::now();
                let _ = app.emit("fluid-upload-progress", UploadProgress { sent, total });
            }
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(size)
}

#[derive(Serialize)]
pub struct Found {
    host: String,
    /// Antwort auf [ESP800], wird in der Oberfläche ausgewertet (fluidnc.ts parseEsp800)
    info: String,
}

/// Eigene IPv4-Adresse im lokalen Netz (ohne Pakete zu senden: UDP „verbinden“ legt nur die Route fest)
pub(crate) fn local_ipv4() -> Option<Ipv4Addr> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("192.0.2.1:80").ok()?;
    match s.local_addr().ok()?.ip() {
        IpAddr::V4(ip) if ip.is_private() => Some(ip),
        _ => None,
    }
}

/// Fragt die Weboberfläche nach [ESP800]; liefert die Antwort, wenn sie von FluidNC kommt
fn probe(addr: SocketAddr, host: &str) -> Option<String> {
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).ok()?;
    let r = request(addr, host, "GET", "/command?plain=%5BESP800%5D", None, &[], Duration::from_millis(2500), &mut |_, _| {}).ok()?;
    (r.status == 200 && r.body.contains("FluidNC")).then(|| r.body.chars().take(1000).collect())
}

/// Steuerungen mit FluidNC im lokalen Netz: fluidnc.local und alle Adressen des eigenen /24-Netzes
#[tauri::command]
pub async fn fluid_discover(port: u16) -> Vec<Found> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cands: Vec<(SocketAddr, String)> = Vec::new();
        if let Some(a) = ("fluidnc.local", port).to_socket_addrs().ok().and_then(|mut i| i.next()) {
            cands.push((a, "fluidnc.local".into()));
        }
        if let Some(ip) = local_ipv4() {
            let [a, b, c, _] = ip.octets();
            for d in 1..=254u8 {
                let other = Ipv4Addr::new(a, b, c, d);
                if other != ip {
                    cands.push((SocketAddr::new(IpAddr::V4(other), port), other.to_string()));
                }
            }
        }
        let mut found: Vec<Found> = Vec::new();
        // Je 64 Adressen gleichzeitig
        for chunk in cands.chunks(64) {
            let hits: Vec<Found> = std::thread::scope(|sc| {
                let hs: Vec<_> = chunk.iter().map(|(a, h)| sc.spawn(move || probe(*a, h).map(|info| Found { host: h.clone(), info }))).collect();
                hs.into_iter().filter_map(|h| h.join().ok().flatten()).collect()
            });
            found.extend(hits);
        }
        // fluidnc.local und dieselbe Steuerung unter ihrer IP: nur einmal zeigen
        let mut seen = Vec::new();
        found.retain(|f| {
            let key = f.info.clone();
            if seen.contains(&key) {
                false
            } else {
                seen.push(key);
                true
            }
        });
        found
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    /// Nachgebildete Weboberfläche: liest eine Anfrage, antwortet fest und gibt die Anfrage zurück
    fn fake_http(reply: &'static str) -> (u16, std::thread::JoinHandle<Vec<u8>>) {
        let srv = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = srv.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let (mut c, _) = srv.accept().unwrap();
            c.set_read_timeout(Some(Duration::from_millis(300))).unwrap();
            let mut got = Vec::new();
            let mut buf = [0u8; 65536];
            loop {
                match c.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => got.extend_from_slice(&buf[..n]),
                    Err(_) => break,
                }
                // Kopf gelesen und Inhalt vollständig?
                if let Some(end) = find(&got, b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&got[..end]).to_ascii_lowercase();
                    let len = head.lines().find_map(|l| l.strip_prefix("content-length:")).map(|v| v.trim().parse::<usize>().unwrap()).unwrap_or(0);
                    if got.len() >= end + 4 + len {
                        break;
                    }
                }
            }
            c.write_all(reply.as_bytes()).unwrap();
            got
        });
        (port, h)
    }

    #[test]
    fn upload_sends_form_like_webui() {
        let (port, srv) = fake_http("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 15\r\n\r\n{\"status\":\"Ok\"}");
        let data = b"G21\nG90\nG0 X10\n".repeat(2000);
        let mut last = (0, 0);
        upload("127.0.0.1", port, "sd", "test.gcode", &data, &mut |s, t| last = (s, t)).unwrap();
        let req = srv.join().unwrap();
        let text = String::from_utf8_lossy(&req);
        assert!(text.starts_with("POST /upload HTTP/1.1\r\n"));
        assert!(text.contains("name=\"/test.gcodeS\"\r\n\r\n30000\r\n"));
        assert!(text.contains("filename=\"/test.gcode\""));
        assert_eq!(last.0, last.1);
        // Inhalt der Datei unverändert im Formular
        let start = find(&req, b"application/octet-stream\r\n\r\n").unwrap() + 28;
        assert_eq!(&req[start..start + data.len()], &data[..]);
    }

    #[test]
    fn upload_reports_http_error() {
        let (port, srv) = fake_http("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 11\r\n\r\nUpload fail");
        let e = upload("127.0.0.1", port, "localfs", "a.gcode", b"G0\n", &mut |_, _| {}).unwrap_err();
        let req = srv.join().unwrap();
        assert!(String::from_utf8_lossy(&req).starts_with("POST /files "));
        assert!(e.contains("HTTP 500") && e.contains("Upload fail"), "{e}");
    }

    #[test]
    fn chunked_response() {
        let mut raw: &[u8] = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nFW ve\r\nE\r\nrsion: FluidNC\r\n0\r\n\r\n";
        let r = read_response(&mut raw).unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(r.body, "FW version: FluidNC");
    }

    #[test]
    fn probe_recognizes_fluidnc() {
        let (port, srv) = fake_http("HTTP/1.1 200 OK\r\nContent-Length: 44\r\n\r\nFW version: FluidNC v3.7.8 # hostname:laser");
        let addr: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
        // probe öffnet zuerst eine Verbindung zur Prüfung; die nachgebildete Oberfläche bedient nur eine, darum direkt fragen
        let r = request(addr, "127.0.0.1", "GET", "/command?plain=%5BESP800%5D", None, &[], Duration::from_secs(2), &mut |_, _| {}).unwrap();
        let req = srv.join().unwrap();
        assert!(String::from_utf8_lossy(&req).starts_with("GET /command?plain=%5BESP800%5D HTTP/1.1"));
        assert!(r.body.contains("FluidNC v3.7.8"));
    }
}
