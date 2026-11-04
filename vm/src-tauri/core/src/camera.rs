//! Camera server of the virtual machine: serves the latest camera image (JPEG, rendered by the window)
//! over plain HTTP like a network camera.
//!
//! - `/stream` (also `/mjpeg`, `/video`): MJPEG stream (multipart/x-mixed-replace), like an ESP32-CAM
//! - `/snapshot.jpg` (also `/capture`, `/jpg`, `/image.jpg`): one image
//! - `/`: small page that shows the stream
//!
//! The window renders images only while someone watches (an open stream or a recent single image), so an
//! unused camera costs nothing.

use std::io::{BufRead, BufReader, ErrorKind, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

/// How long a single image request keeps the camera rendering
const WANT_AFTER_SNAPSHOT: Duration = Duration::from_secs(3);
/// How long a single image request waits for a fresh image
const SNAPSHOT_WAIT: Duration = Duration::from_millis(1500);
/// Images older than this are not handed out as a single image without waiting for a fresh one
const FRESH: Duration = Duration::from_millis(400);

#[derive(Default)]
struct Frame {
    seq: u64,
    jpeg: Arc<Vec<u8>>,
    at: Option<Instant>,
}

/// Latest image and who is waiting for it; shared by the window and the HTTP threads
#[derive(Default)]
pub struct FrameStore {
    frame: Mutex<Frame>,
    cond: Condvar,
    /// open streams
    viewers: AtomicUsize,
    /// last single image request
    snapshot_at: Mutex<Option<Instant>>,
}

impl FrameStore {
    /// New image from the window
    pub fn push(&self, jpeg: Vec<u8>) {
        let mut f = self.frame.lock().unwrap();
        f.seq += 1;
        f.jpeg = Arc::new(jpeg);
        f.at = Some(Instant::now());
        self.cond.notify_all();
    }

    /// true while someone wants images (open stream or a single image just requested)
    pub fn wanted(&self) -> bool {
        self.viewers.load(Ordering::SeqCst) > 0
            || self
                .snapshot_at
                .lock()
                .unwrap()
                .is_some_and(|t| t.elapsed() < WANT_AFTER_SNAPSHOT)
    }

    pub fn viewers(&self) -> usize {
        self.viewers.load(Ordering::SeqCst)
    }

    /// Wait for an image newer than `seq` (or the timeout); returns its number and data
    fn wait_newer(&self, seq: u64, timeout: Duration) -> Option<(u64, Arc<Vec<u8>>)> {
        let f = self.frame.lock().unwrap();
        let (f, _) = self
            .cond
            .wait_timeout_while(f, timeout, |f| f.seq <= seq)
            .unwrap();
        (f.seq > seq && !f.jpeg.is_empty()).then(|| (f.seq, f.jpeg.clone()))
    }

    /// A recent image, or wait for the next one
    fn snapshot(&self) -> Option<Arc<Vec<u8>>> {
        *self.snapshot_at.lock().unwrap() = Some(Instant::now());
        let seq = {
            let f = self.frame.lock().unwrap();
            if f.at.is_some_and(|t| t.elapsed() < FRESH) && !f.jpeg.is_empty() {
                return Some(f.jpeg.clone());
            }
            f.seq
        };
        self.wait_newer(seq, SNAPSHOT_WAIT).map(|(_, j)| j)
    }
}

/// Start the HTTP server; returns the address or an error text (e.g. port in use)
pub fn start(
    host: &str,
    port: u16,
    store: Arc<FrameStore>,
    stop: Arc<AtomicBool>,
) -> Result<(String, thread::JoinHandle<()>), String> {
    let l = TcpListener::bind((host, port)).map_err(|e| format!("{host}:{port}: {e}"))?;
    let addr = l.local_addr().map(|a| a.to_string()).unwrap_or_default();
    let _ = l.set_nonblocking(true);
    let handle = thread::spawn(move || {
        while !stop.load(Ordering::SeqCst) {
            match l.accept() {
                Ok((s, _)) => {
                    let (st, sp) = (store.clone(), stop.clone());
                    thread::spawn(move || {
                        let _ = s.set_nonblocking(false);
                        let _ = serve(s, &st, &sp);
                    });
                }
                Err(e) if e.kind() == ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50))
                }
                Err(_) => thread::sleep(Duration::from_millis(200)),
            }
        }
    });
    Ok((addr, handle))
}

const PAGE: &str = "<!doctype html><html><head><meta charset=utf-8><title>KizamuBeam Virtual Machine – Kamera</title>\
<style>body{margin:0;background:#111;display:grid;place-items:center;height:100vh}img{max-width:100vw;max-height:100vh}</style>\
</head><body><img src=\"/stream\" alt=\"\"></body></html>";

fn serve(s: TcpStream, store: &FrameStore, stop: &AtomicBool) -> std::io::Result<()> {
    s.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut r = BufReader::new(s.try_clone()?);
    let mut line = String::new();
    r.read_line(&mut line)?;
    // skip the headers
    loop {
        let mut h = String::new();
        if r.read_line(&mut h)? == 0 || h.trim().is_empty() {
            break;
        }
    }
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("/").split('?').next().unwrap_or("/");
    let mut w = s;
    w.set_write_timeout(Some(Duration::from_secs(5)))?;
    if method != "GET" && method != "HEAD" {
        return reply(&mut w, "405 Method Not Allowed", "text/plain", b"GET only");
    }
    match path {
        "/" | "/index.html" => reply(
            &mut w,
            "200 OK",
            "text/html; charset=utf-8",
            PAGE.as_bytes(),
        ),
        "/stream" | "/mjpeg" | "/video" | "/stream.mjpg" => stream(&mut w, store, stop),
        "/snapshot.jpg" | "/capture" | "/jpg" | "/image.jpg" | "/snapshot" => {
            match store.snapshot() {
                Some(j) => reply(&mut w, "200 OK", "image/jpeg", &j),
                None => reply(
                    &mut w,
                    "503 Service Unavailable",
                    "text/plain",
                    b"no camera image (is the window open?)",
                ),
            }
        }
        _ => reply(&mut w, "404 Not Found", "text/plain", b"not found"),
    }
}

fn reply(w: &mut TcpStream, status: &str, ty: &str, body: &[u8]) -> std::io::Result<()> {
    write!(
        w,
        "HTTP/1.1 {status}\r\nContent-Type: {ty}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        body.len()
    )?;
    w.write_all(body)?;
    w.flush()
}

struct Viewer<'a>(&'a AtomicUsize);
impl Drop for Viewer<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn stream(w: &mut TcpStream, store: &FrameStore, stop: &AtomicBool) -> std::io::Result<()> {
    store.viewers.fetch_add(1, Ordering::SeqCst);
    let _guard = Viewer(&store.viewers);
    w.write_all(
        b"HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
    )?;
    let mut seq = 0;
    while !stop.load(Ordering::SeqCst) {
        let Some((n, j)) = store.wait_newer(seq, Duration::from_millis(500)) else {
            continue;
        };
        seq = n;
        write!(
            w,
            "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n",
            j.len()
        )?;
        w.write_all(&j)?;
        w.write_all(b"\r\n")?;
        w.flush()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn get(addr: &str, path: &str) -> TcpStream {
        let mut s = TcpStream::connect(addr).unwrap();
        write!(s, "GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
        s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        s
    }

    #[test]
    fn serves_snapshot_and_stream() {
        let store = Arc::new(FrameStore::default());
        let stop = Arc::new(AtomicBool::new(false));
        let (addr, h) = start("127.0.0.1", 0, store.clone(), stop.clone()).unwrap();
        assert!(!store.wanted());

        // a single image asks for a fresh image and waits for it
        let s2 = store.clone();
        let pusher = thread::spawn(move || {
            for _ in 0..100 {
                if s2.wanted() {
                    s2.push(vec![0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
                    return;
                }
                thread::sleep(Duration::from_millis(10));
            }
        });
        let mut s = get(&addr, "/capture");
        let mut buf = Vec::new();
        s.read_to_end(&mut buf).unwrap();
        pusher.join().unwrap();
        let text = String::from_utf8_lossy(&buf);
        assert!(text.starts_with("HTTP/1.1 200"), "{text}");
        assert!(text.contains("image/jpeg"));
        assert!(buf.ends_with(&[0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]));

        // the stream counts as a viewer and delivers new images as parts
        let mut s = get(&addr, "/stream");
        for _ in 0..100 {
            if store.viewers() == 1 {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(store.viewers(), 1);
        store.push(vec![0xff, 0xd8, 9, 0xff, 0xd9]);
        let mut got = Vec::new();
        let mut b = [0u8; 512];
        while !String::from_utf8_lossy(&got).contains("Content-Length: 5") || got.len() < 200 {
            let n = s.read(&mut b).unwrap();
            if n == 0 {
                break;
            }
            got.extend_from_slice(&b[..n]);
            if got.windows(5).any(|w| w == [0xff, 0xd8, 9, 0xff, 0xd9]) {
                break;
            }
        }
        let text = String::from_utf8_lossy(&got);
        assert!(
            text.contains("multipart/x-mixed-replace; boundary=frame"),
            "{text}"
        );
        assert!(got.windows(5).any(|w| w == [0xff, 0xd8, 9, 0xff, 0xd9]));
        drop(s);
        // closing the stream ends the viewer (noticed at the next write)
        for _ in 0..50 {
            store.push(vec![1]);
            if store.viewers() == 0 {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(store.viewers(), 0);

        let mut s = get(&addr, "/nothing");
        let mut buf = String::new();
        s.read_to_string(&mut buf).unwrap();
        assert!(buf.starts_with("HTTP/1.1 404"));
        stop.store(true, Ordering::SeqCst);
        h.join().unwrap();
    }
}
