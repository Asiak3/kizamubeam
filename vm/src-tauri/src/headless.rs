//! Without a window: `kizamubeam-vm --headless [options]` starts only the servers and prints the traffic
//! to standard output. For automated tests (CI) and computers without a screen.

use kizamubeam_vm_core::{Config, Event, Flavor, Runner};
use std::time::Duration;

const HELP: &str = "KizamuBeam Virtual Machine

  kizamubeam-vm                 mit Fenster starten
  kizamubeam-vm --headless      ohne Fenster, Verkehr auf der Standardausgabe

Optionen für --headless (sonst gelten die gespeicherten Einstellungen):
  --telnet-port N   Telnet-Port (Standard 2323, 0 = aus)
  --ws-port N       WebSocket-Port (Standard 8181, 0 = aus)
  --camera-port N   Kamera-Port (Standard 8282, 0 = aus; ohne Fenster gibt es kein Bild)
  --lan             auch aus dem Netzwerk erreichbar (sonst nur 127.0.0.1)
  --grbl            als GRBL 1.1 statt FluidNC melden
  --bed BxH         Fahrweg in mm, z. B. 400x400
  --quiet           Statusabfragen (?) nicht ausgeben
  --defaults        gespeicherte Einstellungen nicht laden
";

pub fn run(args: &[String]) -> i32 {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        print!("{HELP}");
        return 0;
    }
    let mut cfg = if args.iter().any(|a| a == "--defaults") { Config::default() } else { kizamubeam_vm_lib::load_config() };
    let mut quiet = false;
    let mut it = args.iter();
    while let Some(a) = it.next() {
        let mut num = |name: &str| -> Option<u16> {
            let v = it.next().and_then(|v| v.parse().ok());
            if v.is_none() {
                eprintln!("{name}: Zahl erwartet");
            }
            v
        };
        match a.as_str() {
            "--headless" | "--defaults" => {}
            "--quiet" => quiet = true,
            "--lan" => cfg.lan = true,
            "--grbl" => cfg.flavor = Flavor::Grbl,
            "--telnet-port" => match num("--telnet-port") {
                Some(0) => cfg.telnet_enabled = false,
                Some(p) => (cfg.telnet_enabled, cfg.telnet_port) = (true, p),
                None => return 2,
            },
            "--ws-port" => match num("--ws-port") {
                Some(0) => cfg.ws_enabled = false,
                Some(p) => (cfg.ws_enabled, cfg.ws_port) = (true, p),
                None => return 2,
            },
            "--camera-port" => match num("--camera-port") {
                Some(0) => cfg.camera_enabled = false,
                Some(p) => (cfg.camera_enabled, cfg.camera_port) = (true, p),
                None => return 2,
            },
            "--bed" => {
                let Some((w, h)) = it.next().and_then(|v| v.split_once(['x', 'X'])) else {
                    eprintln!("--bed: z. B. 400x400");
                    return 2;
                };
                match (w.parse(), h.parse()) {
                    (Ok(w), Ok(h)) => (cfg.bed_w, cfg.bed_h) = (w, h),
                    _ => {
                        eprintln!("--bed: z. B. 400x400");
                        return 2;
                    }
                }
            }
            other => {
                eprintln!("Unbekannte Option: {other}\n\n{HELP}");
                return 2;
            }
        }
    }
    cfg.sanitize();
    let runner = Runner::start(cfg);
    let info = runner.info();
    let mut ok = false;
    for (name, r) in [("Telnet", info.telnet), ("WebSocket", info.ws), ("Kamera", info.camera)] {
        match r {
            Some(Ok(a)) => {
                ok = true;
                println!("{name}: {a}");
            }
            Some(Err(e)) => eprintln!("{name}: {e}"),
            None => {}
        }
    }
    if !ok {
        eprintln!("Kein Server läuft.");
        return 1;
    }
    loop {
        std::thread::sleep(Duration::from_millis(20));
        runner.take_segments();
        for e in runner.take_events() {
            match e {
                Event::Console { status: true, .. } if quiet => {}
                Event::Console { client, dir, text, .. } => {
                    let who = if client == u32::MAX { "*".to_string() } else { client.to_string() };
                    let arrow = match dir {
                        "in" => "→",
                        "rt" => "⇢",
                        _ => "←",
                    };
                    println!("[{who}] {arrow} {text}");
                }
                Event::Warning { code, client, x, y } => println!("WARNUNG {code} (Verbindung {client:?}, Kopf {x:.1}/{y:.1})"),
                Event::Alarm { code } => println!("ALARM {code}"),
                Event::ConfigChanged => {}
            }
        }
    }
}
