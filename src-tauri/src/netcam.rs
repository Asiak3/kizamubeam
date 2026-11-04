//! Network cameras: reads an MJPEG stream (multipart/x-mixed-replace, e.g. ESP32-CAM `:81/stream` or the
//! KizamuBeam Virtual Machine `:8282/stream`) or polls a single-image URL (`/capture`, `/snapshot.jpg`) over
//! plain HTTP and keeps the latest JPEG. The window fetches it with `netcam_frame`.
//!
//! Done in Rust instead of the web view: no CORS or mixed-content rules, the same on every platform.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Largest accepted image
const MAX_IMAGE: usize = 20 * 1024 * 1024;
/// Pause between single images when the URL delivers one image per request
const POLL_PAUSE: Duration = Duration::from_millis(150);

#[derive(Default)]
struct Cam {
    seq: u64,
    jpeg: Arc<Vec<u8>>,
    /// last error text (cleared by the next image)
    error: Option<String>,
}

struct Handle {
    cam: Arc<Mutex<Cam>>,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct NetCams {
    next: AtomicU32,
    cams: Mutex<HashMap<u32, Handle>>,
}

struct Url {
    host: String,
    port: u16,
    path: String,
    /// "user:password" for basic auth
    auth: Option<String>,
}

fn parse_url(url: &str) -> Result<Url, String> {
    let rest = url.trim().strip_prefix("http://").ok_or("Nur http://-Adressen werden unterstützt")?;
    let (hostport, path) = match rest.find('/') {
        Some(i) => (&rest[..i], rest[i..].to_string()),
        None => (rest, "/".to_string()),
    };
    let (auth, hostport) = match hostport.rsplit_once('@') {
        Some((a, h)) => (Some(a.to_string()), h),
        None => (None, hostport),
    };
    let (host, port) = match hostport.rsplit_once(':') {
        Some((h, p)) if !h.ends_with(']') || p.parse::<u16>().is_ok() => {
            (h.to_string(), p.parse::<u16>().map_err(|_| format!("Ungültiger Port: {p}"))?)
        }
        _ => (hostport.to_string(), 80),
    };
    if host.is_empty() {
        return Err("Adresse ohne Rechnername".into());
    }
    Ok(Url { host: host.trim_matches(['[', ']']).to_string(), port, path, auth })
}

fn base64(s: &str) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let b = s.as_bytes();
    let mut out = String::new();
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                out.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Open the connection and read the response headers; returns the reader, status and headers (lower case)
fn request(u: &Url) -> Result<(BufReader<TcpStream>, u16, HashMap<String, String>), String> {
    let addr = (u.host.as_str(), u.port)
        .to_socket_addrs()
        .map_err(|e| format!("{}: {e}", u.host))?
        .next()
        .ok_or_else(|| format!("{}: nicht gefunden", u.host))?;
    let mut s = TcpStream::connect_timeout(&addr, Duration::from_secs(4)).map_err(|e| format!("{}:{}: {e}", u.host, u.port))?;
    s.set_read_timeout(Some(Duration::from_secs(10))).ok();
    s.set_write_timeout(Some(Duration::from_secs(4))).ok();
    let auth = u.auth.as_deref().map(|a| format!("Authorization: Basic {}\r\n", base64(a))).unwrap_or_default();
    write!(
        s,
        "GET {} HTTP/1.1\r\nHost: {}:{}\r\nUser-Agent: KizamuBeam\r\nAccept: */*\r\n{auth}Connection: close\r\n\r\n",
        u.path, u.host, u.port
    )
    .map_err(|e| e.to_string())?;
    let mut r = BufReader::new(s);
    let mut line = String::new();
    r.read_line(&mut line).map_err(|e| e.to_string())?;
    let status = line.split_whitespace().nth(1).and_then(|c| c.parse().ok()).ok_or("Keine HTTP-Antwort")?;
    let headers = read_headers(&mut r)?;
    Ok((r, status, headers))
}

fn read_headers(r: &mut impl BufRead) -> Result<HashMap<String, String>, String> {
    let mut h = HashMap::new();
    loop {
        let mut line = String::new();
        if r.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            h.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    Ok(h)
}

/// Read one image after its part headers: by Content-Length, else up to the JPEG end marker
fn read_part(r: &mut impl BufRead, headers: &HashMap<String, String>) -> Result<Vec<u8>, String> {
    if let Some(n) = headers.get("content-length").and_then(|v| v.parse::<usize>().ok()) {
        if n > MAX_IMAGE {
            return Err("Bild zu groß".into());
        }
        let mut buf = vec![0; n];
        r.read_exact(&mut buf).map_err(|e| e.to_string())?;
        return Ok(buf);
    }
    let mut buf = Vec::new();
    loop {
        let mut chunk = Vec::new();
        if r.read_until(0xd9, &mut chunk).map_err(|e| e.to_string())? == 0 {
            return Err("Stream beendet".into());
        }
        buf.extend_from_slice(&chunk);
        if buf.len() >= 2 && buf[buf.len() - 2] == 0xff && buf[buf.len() - 1] == 0xd9 {
            return Ok(buf);
        }
        if buf.len() > MAX_IMAGE {
            return Err("Bild zu groß".into());
        }
    }
}

/// Read images until stopped or the connection fails
fn run(u: &Url, cam: &Mutex<Cam>, stop: &AtomicBool) -> Result<(), String> {
    let (mut r, status, headers) = request(u)?;
    if status == 401 {
        return Err("Anmeldung erforderlich (http://name:passwort@…)".into());
    }
    if status != 200 {
        return Err(format!("HTTP {status}"));
    }
    let ty = headers.get("content-type").cloned().unwrap_or_default().to_ascii_lowercase();
    let push = |jpeg: Vec<u8>| {
        let mut c = cam.lock().unwrap();
        c.seq += 1;
        c.jpeg = Arc::new(jpeg);
        c.error = None;
    };
    if ty.starts_with("multipart/") {
        // parts are separated by "--boundary"; skip lines up to each part's headers
        while !stop.load(Ordering::SeqCst) {
            let mut line = String::new();
            if r.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
                return Err("Stream beendet".into());
            }
            if !line.starts_with("--") {
                continue;
            }
            let h = read_headers(&mut r)?;
            push(read_part(&mut r, &h)?);
        }
        Ok(())
    } else if ty.starts_with("image/") {
        // one image per request: poll
        push(read_part(&mut r, &headers)?);
        while !stop.load(Ordering::SeqCst) {
            thread::sleep(POLL_PAUSE);
            let (mut r, status, headers) = request(u)?;
            if status != 200 {
                return Err(format!("HTTP {status}"));
            }
            push(read_part(&mut r, &headers)?);
        }
        Ok(())
    } else {
        Err(format!("Kein Kamerabild an dieser Adresse ({})", if ty.is_empty() { "ohne Typ" } else { &ty }))
    }
}

/// Start reading a camera; returns its number. Reconnects on its own after errors.
#[tauri::command]
pub fn netcam_open(state: tauri::State<'_, NetCams>, url: String) -> Result<u32, String> {
    let u = parse_url(&url)?;
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    let cam = Arc::new(Mutex::new(Cam::default()));
    let stop = Arc::new(AtomicBool::new(false));
    let (c, s) = (cam.clone(), stop.clone());
    thread::spawn(move || {
        while !s.load(Ordering::SeqCst) {
            if let Err(e) = run(&u, &c, &s) {
                c.lock().unwrap().error = Some(e);
                thread::sleep(Duration::from_secs(1));
            }
        }
    });
    state.cams.lock().unwrap().insert(id, Handle { cam, stop });
    Ok(id)
}

/// Latest image when newer than `since`: 8 bytes image number (little endian) + JPEG; empty when nothing new.
/// An error text is returned only while no image arrives.
#[tauri::command]
pub fn netcam_frame(state: tauri::State<'_, NetCams>, id: u32, since: u64) -> Result<tauri::ipc::Response, String> {
    let cams = state.cams.lock().unwrap();
    let h = cams.get(&id).ok_or("Kamera nicht geöffnet")?;
    let c = h.cam.lock().unwrap();
    if c.seq > since && !c.jpeg.is_empty() {
        let mut out = Vec::with_capacity(8 + c.jpeg.len());
        out.extend_from_slice(&c.seq.to_le_bytes());
        out.extend_from_slice(&c.jpeg);
        return Ok(tauri::ipc::Response::new(out));
    }
    if let Some(e) = &c.error {
        return Err(e.clone());
    }
    Ok(tauri::ipc::Response::new(Vec::new()))
}

#[tauri::command]
pub fn netcam_close(state: tauri::State<'_, NetCams>, id: u32) {
    if let Some(h) = state.cams.lock().unwrap().remove(&id) {
        h.stop.store(true, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;

    #[test]
    fn parses_urls() {
        let u = parse_url("http://192.168.1.5:81/stream").unwrap();
        assert_eq!((u.host.as_str(), u.port, u.path.as_str()), ("192.168.1.5", 81, "/stream"));
        let u = parse_url("http://cam.local").unwrap();
        assert_eq!((u.host.as_str(), u.port, u.path.as_str()), ("cam.local", 80, "/"));
        let u = parse_url("http://admin:pw@10.0.0.2:8080/video?x=1").unwrap();
        assert_eq!((u.auth.as_deref(), u.port, u.path.as_str()), (Some("admin:pw"), 8080, "/video?x=1"));
        assert!(parse_url("https://x").is_err());
        assert_eq!(base64("admin:pw"), "YWRtaW46cHc=");
    }

    fn serve_once(body: Vec<u8>) -> String {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap().to_string();
        thread::spawn(move || {
            let (mut s, _) = l.accept().unwrap();
            let mut buf = [0u8; 1024];
            let _ = s.read(&mut buf);
            s.write_all(&body).unwrap();
            thread::sleep(Duration::from_millis(300));
        });
        addr
    }

    #[test]
    fn reads_mjpeg_parts() {
        let mut body = b"HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n".to_vec();
        // one part with length, one without (ends at FF D9)
        body.extend_from_slice(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 5\r\n\r\n");
        body.extend_from_slice(&[0xff, 0xd8, 1, 0xff, 0xd9]);
        body.extend_from_slice(b"\r\n--frame\r\nContent-Type: image/jpeg\r\n\r\n");
        body.extend_from_slice(&[0xff, 0xd8, 0xd9, 2, 0xff, 0xd9]);
        body.extend_from_slice(b"\r\n");
        let addr = serve_once(body);
        let cam = Mutex::new(Cam::default());
        let stop = AtomicBool::new(false);
        let e = run(&parse_url(&format!("http://{addr}/stream")).unwrap(), &cam, &stop).unwrap_err();
        assert_eq!(e, "Stream beendet");
        let c = cam.lock().unwrap();
        assert_eq!(c.seq, 2);
        assert_eq!(*c.jpeg, vec![0xff, 0xd8, 0xd9, 2, 0xff, 0xd9]);
    }

    #[test]
    fn rejects_non_images() {
        let addr = serve_once(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 2\r\n\r\nhi".to_vec());
        let cam = Mutex::new(Cam::default());
        let e = run(&parse_url(&format!("http://{addr}/")).unwrap(), &cam, &AtomicBool::new(false)).unwrap_err();
        assert!(e.contains("text/html"), "{e}");
    }
}
