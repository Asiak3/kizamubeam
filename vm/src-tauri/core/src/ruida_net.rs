//! UDP side of the Ruida emulation: the data port (50200, scrambled packets with checksum, ACK per
//! packet, replies in their own packet to the sender) and the keypad port (50207, plain bytes).
//! Received commands go through `ruida::Ruida`; the G-code it produces waits in a queue and is fed
//! to the machine a few lines at a time, like a sender that respects the receive buffer.

use crate::machine::ClientId;
use crate::net::{flush, register_client, Shared};
use crate::ruida::{self, Action, Ruida, View};
use std::collections::VecDeque;
use std::io::ErrorKind;
use std::net::{SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

struct Session {
    ruida: Ruida,
    queue: VecDeque<String>,
    client: Option<(ClientId, Receiver<String>, Arc<AtomicBool>)>,
}

/// Bind both ports and start one thread that serves them
pub(crate) fn start(
    host: &str,
    port: u16,
    jog_port: u16,
    shared: Arc<Shared>,
    stop: Arc<AtomicBool>,
) -> Result<(String, thread::JoinHandle<()>), String> {
    let data = UdpSocket::bind((host, port)).map_err(|e| format!("{host}:{port}: {e}"))?;
    let keys = UdpSocket::bind((host, jog_port)).map_err(|e| format!("{host}:{jog_port}: {e}"))?;
    data.set_read_timeout(Some(Duration::from_millis(3))).ok();
    keys.set_nonblocking(true).ok();
    let addr = data.local_addr().map(|a| a.to_string()).unwrap_or_default();
    let magic = shared.machine.lock().unwrap().cfg.ruida_magic;
    let session = Mutex::new(Session {
        ruida: Ruida::new(magic),
        queue: VecDeque::new(),
        client: None,
    });
    let handle = thread::spawn(move || {
        let mut buf = [0u8; 2048];
        while !stop.load(Ordering::SeqCst) && !shared.stop.load(Ordering::SeqCst) {
            match data.recv_from(&mut buf) {
                Ok((n, from)) => on_data(&data, &buf[..n], from, &shared, &session),
                Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                Err(_) => thread::sleep(Duration::from_millis(20)),
            }
            while let Ok((n, from)) = keys.recv_from(&mut buf) {
                on_keys(&keys, &buf[..n], from, &shared, &session);
            }
            feed(&shared, &session);
        }
        let mut s = session.lock().unwrap();
        if let Some((id, _, _)) = s.client.take() {
            crate::net::unregister_client(&shared, id);
        }
    });
    Ok((addr, handle))
}

fn ensure_client(s: &mut Session, shared: &Shared, from: SocketAddr) -> ClientId {
    if let Some((id, _, closed)) = &s.client {
        if !closed.load(Ordering::SeqCst) {
            return *id;
        }
        let id = *id;
        crate::net::unregister_client(shared, id);
    }
    let c = register_client(shared, "ruida", from);
    let id = c.0;
    s.client = Some(c);
    id
}

fn on_data(
    sock: &UdpSocket,
    packet: &[u8],
    from: SocketAddr,
    shared: &Shared,
    session: &Mutex<Session>,
) {
    let mut s = session.lock().unwrap();
    if let Some(data) = ruida::checked_payload(packet) {
        if let Some(m) = ruida::magic_from_card_query(data) {
            s.ruida.magic = m;
        }
        let magic = s.ruida.magic;
        let _ = sock.send_to(&[ruida::swizzle_byte(ruida::ACK, magic)], from);
        let plain = ruida::unswizzle(data, magic);
        let id = ensure_client(&mut s, shared, from);
        handle(&mut s, id, &plain, shared, |reply| {
            let _ = sock.send_to(&ruida::swizzle(reply, magic), from);
        });
    } else {
        let _ = sock.send_to(&[ruida::swizzle_byte(ruida::NAK, s.ruida.magic)], from);
    }
}

fn on_keys(
    sock: &UdpSocket,
    data: &[u8],
    from: SocketAddr,
    shared: &Shared,
    session: &Mutex<Session>,
) {
    let mut s = session.lock().unwrap();
    let _ = sock.send_to(&[ruida::ACK], from);
    let id = ensure_client(&mut s, shared, from);
    handle(&mut s, id, data, shared, |reply| {
        let _ = sock.send_to(reply, from);
    });
}

/// Run the commands of one packet and carry out what they ask for
fn handle(
    s: &mut Session,
    id: ClientId,
    plain: &[u8],
    shared: &Shared,
    mut reply: impl FnMut(&[u8]),
) {
    let mut m = shared.machine.lock().unwrap();
    let cfg = m.cfg.clone();
    for cmd in ruida::split_commands(plain) {
        let snap = m.snapshot();
        let idle = s.queue.is_empty() && m.is_idle();
        let acts = s.ruida.command(
            cmd,
            &View {
                cfg: &cfg,
                snap: &snap,
                idle,
            },
        );
        for a in acts {
            match a {
                Action::Line(l) => s.queue.push_back(l),
                Action::Realtime(b) => m.input(id, &[b]),
                Action::Stop => {
                    s.queue.clear();
                    m.stop_quiet();
                }
                Action::Reply(r) => reply(&r),
            }
        }
    }
    drop(m);
    flush(shared);
}

/// Hand waiting lines to the machine and drop its replies (the Ruida client does not read them)
fn feed(shared: &Shared, session: &Mutex<Session>) {
    let mut s = session.lock().unwrap();
    let Some((id, rx, _)) = &s.client else {
        return;
    };
    let id = *id;
    while rx.try_recv().is_ok() {}
    if s.queue.is_empty() {
        return;
    }
    {
        let mut m = shared.machine.lock().unwrap();
        // like a GRBL sender: only as much as fits into the receive buffer
        while let Some(l) = s.queue.front() {
            if l.len() + 1 > m.rx_free(id) {
                break;
            }
            let l = s.queue.pop_front().unwrap();
            m.input(id, format!("{l}\n").as_bytes());
        }
    }
    flush(shared);
}

#[cfg(test)]
mod tests {
    use crate::ruida::{self, encode_i35, encode_power, packet, swizzle_byte, unswizzle, ACK};
    use crate::{Config, Runner};
    use std::net::UdpSocket;
    use std::time::{Duration, Instant};

    fn free_udp() -> u16 {
        UdpSocket::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port()
    }

    fn xy(cmd: u8, x: f64, y: f64) -> Vec<u8> {
        let mut v = vec![cmd];
        v.extend(encode_i35((x * 1000.0) as i64));
        v.extend(encode_i35((y * 1000.0) as i64));
        v
    }

    #[test]
    fn udp_job_runs_on_the_machine() {
        let (port, jog) = (free_udp(), free_udp());
        let r = Runner::start(Config {
            telnet_enabled: false,
            ws_enabled: false,
            camera_enabled: false,
            ruida_port: port,
            ruida_jog_port: jog,
            bed_w: 400.0,
            bed_h: 300.0,
            ..Config::default()
        });
        assert_eq!(r.info().ruida, Some(Ok(format!("127.0.0.1:{port}"))));
        let c = UdpSocket::bind("127.0.0.1:0").unwrap();
        c.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        c.connect(("127.0.0.1", port)).unwrap();
        let mut buf = [0u8; 256];

        // card ID with magic 0x11: the VM switches to it
        let m = 0x11;
        c.send(&packet(&[0xDA, 0x00, 0x05, 0x7E], m)).unwrap();
        let n = c.recv(&mut buf).unwrap();
        assert_eq!(&buf[..n], &[swizzle_byte(ACK, m)]);
        let n = c.recv(&mut buf).unwrap();
        assert_eq!(&unswizzle(&buf[..n], m)[..4], &[0xDA, 0x01, 0x05, 0x7E]);

        // broken checksum → NAK
        let mut bad = packet(&[0xD8, 0x00], m);
        bad[1] ^= 1;
        c.send(&bad).unwrap();
        let n = c.recv(&mut buf).unwrap();
        assert_eq!(&buf[..n], &[swizzle_byte(ruida::NAK, m)]);

        // job: square 20 × 20 mm at 100 mm/s, origin back right
        let mut job = vec![0xD8, 0x10, 0xC9, 0x02];
        job.extend(encode_i35(100_000));
        job.extend([0xC6, 0x02]);
        job.extend(encode_power(30.0));
        job.extend(xy(0x88, 10.0, 10.0));
        job.extend(xy(0xA8, 30.0, 10.0));
        job.extend(xy(0xA8, 30.0, 30.0));
        job.extend(xy(0xA8, 10.0, 30.0));
        job.extend(xy(0xA8, 10.0, 10.0));
        job.push(0xD7);
        c.send(&packet(&job, m)).unwrap();
        let n = c.recv(&mut buf).unwrap();
        assert_eq!(&buf[..n], &[swizzle_byte(ACK, m)]);

        let start = Instant::now();
        let mut burnt = 0.0f32;
        loop {
            for s in r.take_segments() {
                if s.power > 0.0 {
                    burnt += ((s.x1 - s.x0).powi(2) + (s.y1 - s.y0).powi(2)).sqrt();
                }
            }
            let snap = r.snapshot();
            if burnt > 79.0 && snap.state == "Idle" {
                // back right origin: Ruida (10, 10) is VM (390, 290)
                assert!(
                    (snap.mpos[0] - 390.0).abs() < 0.01 && (snap.mpos[1] - 290.0).abs() < 0.01,
                    "{snap:?}"
                );
                break;
            }
            assert!(
                start.elapsed() < Duration::from_secs(10),
                "burnt {burnt} {snap:?}"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(r.clients().iter().any(|c| c.kind == "ruida"));

        // position read-back in Ruida coordinates
        c.send(&packet(&[0xDA, 0x00, 0x04, 0x21], m)).unwrap();
        c.recv(&mut buf).unwrap();
        let n = c.recv(&mut buf).unwrap();
        let rep = unswizzle(&buf[..n], m);
        assert_eq!(&rep[4..9], &encode_i35(10_000));

        // keypad port: plain bytes, jog right then release
        let k = UdpSocket::bind("127.0.0.1:0").unwrap();
        k.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        k.connect(("127.0.0.1", jog)).unwrap();
        k.send(&[0xA5, 0x50, 0x01]).unwrap(); // left
        let n = k.recv(&mut buf).unwrap();
        assert_eq!(&buf[..n], &[ACK]);
        std::thread::sleep(Duration::from_millis(300));
        k.send(&[0xA5, 0x51, 0x01]).unwrap();
        k.recv(&mut buf).unwrap();
        let start = Instant::now();
        while r.snapshot().state != "Idle" && start.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(20));
        }
        let x = r.snapshot().mpos[0];
        assert!(x < 389.0 && x > 300.0, "{x}");
    }
}
