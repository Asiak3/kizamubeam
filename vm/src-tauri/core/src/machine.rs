//! The controller of the virtual machine: line and character buffers per connection, real-time commands,
//! G-code and $ commands like GRBL 1.1 or FluidNC, a motion planner with acceleration and
//! junction deviation, and execution in real time. `tick(dt)` advances time; what the machine
//! sends is fetched with `take_out`, the travelled segments with `take_segments`.
//!
//! Coordinates: machine coordinates 0 … travel, origin at the homing position (front left), Y towards
//! the back. Separately there is the physical head position: it differs until the machine is homed
//! (MPos 0 is then where the head stood at power-on) or after the head ran into the frame.

use crate::config::{Config, Flavor};
use crate::gcode::{self, err, Block, Motion, NonModal, ProgramFlow, Spindle};
use serde::Serialize;
use std::collections::{BTreeMap, VecDeque};

pub type ClientId = u32;
/// Console in the virtual machine's own window
pub const LOCAL: ClientId = 0;

pub const FLUIDNC_VERSION: &str = "3.7.12";
const GRBL_LINE_MAX: usize = 80;
const FLUID_LINE_MAX: usize = 255;
/// How many segments/events may wait to be fetched
const SEGMENT_CAP: usize = 400_000;
const EVENT_CAP: usize = 20_000;
/// Special value: target outside the travel with soft limits → ALARM:2
const SOFT_LIMIT_ALARM: u8 = 255;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Out {
    /// None = to all connections
    pub to: Option<ClientId>,
    pub text: String,
}

/// A segment travelled by the physical head (mm), with laser power 0 … 1 and duration in s.
/// Length 0 = the laser stood still (e.g. G4 with the laser on outside laser mode).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Segment {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
    pub power: f32,
    pub dur: f32,
    pub rapid: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    /// Console traffic: dir = "in" (received), "out" (sent), "rt" (real-time command)
    #[serde(rename_all = "camelCase")]
    Console {
        client: ClientId,
        dir: &'static str,
        text: String,
        status: bool,
    },
    /// Anomalies a real machine does not report but a tester wants to know about
    #[serde(rename_all = "camelCase")]
    Warning {
        code: &'static str,
        client: Option<ClientId>,
        x: f64,
        y: f64,
    },
    Alarm {
        code: u8,
    },
    /// Settings were changed through the controller ($130=…), please save
    ConfigChanged,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub state: String,
    pub mpos: [f64; 3],
    pub wpos: [f64; 3],
    pub wco: [f64; 3],
    /// Physical head position
    pub head: [f64; 2],
    /// Current speed in mm/min
    pub feed: f64,
    /// Active S value
    pub s: f64,
    /// M3, M4 or M5
    pub spindle: String,
    pub laser_on: bool,
    pub power: f64,
    pub ovr: [u32; 3],
    pub flood: bool,
    pub mist: bool,
    pub outputs: u64,
    pub planner_used: usize,
    pub planner_size: usize,
    pub homed: bool,
    pub alarm: Option<u8>,
    /// Run time of the current or last job in s
    pub job_time: f64,
    pub running: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    Idle,
    Run,
    Hold,
    Jog,
    Home,
    Alarm(u8),
    Sleep,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Applied {
    spindle: Spindle,
    s: f64,
    flood: bool,
    mist: bool,
    outputs: u64,
}

impl Default for Applied {
    fn default() -> Self {
        Applied {
            spindle: Spindle::Off,
            s: 0.0,
            flood: false,
            mist: false,
            outputs: 0,
        }
    }
}

#[derive(Clone, Debug)]
struct Move {
    start: [f64; 3],
    unit: [f64; 3],
    len: f64,
    done: f64,
    /// programmed feed in mm/s (rapid: 0)
    feed: f64,
    rapid: bool,
    jog: bool,
    homing: bool,
    /// max. entry speed from the geometry (junction deviation), mm/s
    junction: f64,
}

#[derive(Clone, Debug)]
enum Item {
    Move(Move),
    Dwell(f64),
    /// switch laser, coolant and output state; stop = motion stops for it
    Apply(Applied, bool),
    /// M0/M1: stop like a feed hold
    Pause,
    /// end of homing
    Homed,
}

#[derive(Clone, Debug)]
struct Modal {
    motion: Motion,
    absolute: bool,
    inches: bool,
    wcs: usize,
    /// mm/min
    feed: f64,
    spindle: Spindle,
    s: f64,
    flood: bool,
    mist: bool,
    outputs: u64,
}

impl Default for Modal {
    fn default() -> Self {
        Modal {
            motion: Motion::Rapid,
            absolute: true,
            inches: false,
            wcs: 0,
            feed: 0.0,
            spindle: Spindle::Off,
            s: 0.0,
            flood: false,
            mist: false,
            outputs: 0,
        }
    }
}

#[derive(Default)]
struct Client {
    lines: VecDeque<String>,
    partial: Vec<u8>,
    /// bytes in the receive buffer (received, not processed yet)
    rx_used: usize,
    overflow_warned: bool,
    /// send ok only once the machine stands still (homing)
    wait_idle: bool,
    /// counters for WCO/Ov in the status report
    wco_count: u32,
    ov_count: u32,
    last_wco: [f64; 3],
    last_ov: [u32; 3],
}

enum Reply {
    Ok(Vec<String>),
    /// ok only after standstill
    Deferred,
    Err(u8),
}

pub struct Machine {
    pub cfg: Config,
    state: State,
    check_mode: bool,
    homed: bool,
    modal: Modal,
    g5x: [[f64; 3]; 6],
    g92: [f64; 3],
    predef: [[f64; 3]; 2],
    /// executed position (machine coordinates)
    pos: [f64; 3],
    /// position at the end of what is planned
    plan_pos: [f64; 3],
    /// physical = pos + off
    off: [f64; 3],
    queue: VecDeque<Item>,
    /// result of a line that did not fit into the planner yet (arcs)
    pending: VecDeque<Item>,
    pending_client: Option<ClientId>,
    /// mm/s
    speed: f64,
    hold: bool,
    jog_cancel: bool,
    ovr: [u32; 3],
    active: Applied,
    clients: BTreeMap<ClientId, Client>,
    out: Vec<Out>,
    events: Vec<Event>,
    segments: Vec<Segment>,
    crashed: bool,
    time: f64,
    job_start: Option<f64>,
    job_time: f64,
    last_power: f64,
    rr: ClientId,
}

fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn f3(v: f64) -> String {
    let s = format!("{v:.3}");
    if s == "-0.000" {
        "0.000".into()
    } else {
        s
    }
}
fn vec3(v: [f64; 3]) -> String {
    format!("{},{},{}", f3(v[0]), f3(v[1]), f3(v[2]))
}

/// Real-time commands (handled at once, even in the middle of a line)
pub fn is_realtime(b: u8) -> bool {
    matches!(
        b,
        b'?' | b'!' | b'~' | 0x18 | 0x84 | 0x85 | 0x87 | 0x90..=0x9E | 0xA0 | 0xA1
    )
}

impl Machine {
    pub fn new(cfg: Config) -> Self {
        let mut m = Machine {
            cfg,
            state: State::Idle,
            check_mode: false,
            homed: false,
            modal: Modal::default(),
            g5x: [[0.0; 3]; 6],
            g92: [0.0; 3],
            predef: [[0.0; 3]; 2],
            pos: [0.0; 3],
            plan_pos: [0.0; 3],
            off: [0.0; 3],
            queue: VecDeque::new(),
            pending: VecDeque::new(),
            pending_client: None,
            speed: 0.0,
            hold: false,
            jog_cancel: false,
            ovr: [100, 100, 100],
            active: Applied::default(),
            clients: BTreeMap::new(),
            out: Vec::new(),
            events: Vec::new(),
            segments: Vec::new(),
            crashed: false,
            time: 0.0,
            job_start: None,
            job_time: 0.0,
            last_power: 0.0,
            rr: 0,
        };
        m.cfg.sanitize();
        m.clients.insert(LOCAL, Client::default());
        if m.homing_lock() {
            m.state = State::Alarm(0);
        }
        m
    }

    fn homing_lock(&self) -> bool {
        self.cfg.homing && self.cfg.must_home && !self.homed
    }

    // ---------- connections ----------

    pub fn connect(&mut self, id: ClientId) {
        self.clients.insert(id, Client::default());
    }

    pub fn disconnect(&mut self, id: ClientId) {
        self.clients.remove(&id);
        if self.pending_client == Some(id) {
            self.pending_client = None;
        }
    }

    pub fn welcome(&self) -> String {
        match self.cfg.flavor {
            Flavor::Grbl => "Grbl 1.1h ['$' for help]".into(),
            Flavor::Fluidnc => {
                format!("Grbl 3.7 [FluidNC v{FLUIDNC_VERSION} (KizamuBeam VM) '$' for help]")
            }
        }
    }

    fn send(&mut self, to: Option<ClientId>, text: impl Into<String>) {
        let text = text.into();
        self.events.push(Event::Console {
            client: to.unwrap_or(u32::MAX),
            dir: "out",
            text: text.clone(),
            status: false,
        });
        self.out.push(Out { to, text });
    }

    fn warn(&mut self, code: &'static str, client: Option<ClientId>) {
        let h = self.head();
        self.events.push(Event::Warning {
            code,
            client,
            x: h[0],
            y: h[1],
        });
    }

    /// Bytes received on a connection: real-time commands at once, the rest into the line buffer
    pub fn input(&mut self, id: ClientId, bytes: &[u8]) {
        if !self.clients.contains_key(&id) {
            self.connect(id);
        }
        for &b in bytes {
            if is_realtime(b) {
                self.realtime(id, b);
                continue;
            }
            let rx_max = self.cfg.rx_buffer;
            let c = self.clients.get_mut(&id).unwrap();
            match b {
                b'\n' => {
                    let raw = std::mem::take(&mut c.partial);
                    // GRBL drops non-ASCII (umlauts in comments); so do we
                    let line: String = raw
                        .iter()
                        .filter(|b| b.is_ascii())
                        .map(|&b| b as char)
                        .collect();
                    c.lines.push_back(line);
                }
                b'\r' => {}
                _ => {
                    c.partial.push(b);
                }
            }
            if b != b'\r' {
                c.rx_used += 1;
                if c.rx_used > rx_max && !c.overflow_warned && id != LOCAL {
                    c.overflow_warned = true;
                    self.warn("rxOverflow", Some(id));
                }
            }
        }
    }

    fn realtime(&mut self, id: ClientId, b: u8) {
        match b {
            b'?' => {
                let st = self.status_report(id);
                self.events.push(Event::Console {
                    client: id,
                    dir: "out",
                    text: st.clone(),
                    status: true,
                });
                self.out.push(Out {
                    to: Some(id),
                    text: st,
                });
                return;
            }
            b'!' => {
                if matches!(self.state, State::Run | State::Jog) {
                    self.hold = true;
                    if self.state == State::Jog {
                        self.jog_cancel = true;
                    } else {
                        self.state = State::Hold;
                    }
                }
            }
            b'~' => {
                if self.state == State::Hold {
                    self.hold = false;
                    self.state = if self.queue.is_empty() {
                        State::Idle
                    } else {
                        State::Run
                    };
                } else if self.state == State::Sleep {
                } else if self.hold && !self.jog_cancel {
                    self.hold = false;
                }
            }
            0x18 => self.soft_reset(),
            0x85 => {
                if self.state == State::Jog {
                    self.jog_cancel = true;
                    self.hold = true;
                }
            }
            0x90 => self.ovr[0] = 100,
            0x91 => self.ovr[0] = (self.ovr[0] + 10).min(200),
            0x92 => self.ovr[0] = self.ovr[0].saturating_sub(10).max(10),
            0x93 => self.ovr[0] = (self.ovr[0] + 1).min(200),
            0x94 => self.ovr[0] = self.ovr[0].saturating_sub(1).max(10),
            0x95 => self.ovr[1] = 100,
            0x96 => self.ovr[1] = 50,
            0x97 => self.ovr[1] = 25,
            0x99 => self.ovr[2] = 100,
            0x9A => self.ovr[2] = (self.ovr[2] + 10).min(200),
            0x9B => self.ovr[2] = self.ovr[2].saturating_sub(10).max(10),
            0x9C => self.ovr[2] = (self.ovr[2] + 1).min(200),
            0x9D => self.ovr[2] = self.ovr[2].saturating_sub(1).max(10),
            0xA0 => {
                self.active.flood = !self.active.flood;
                self.modal.flood = self.active.flood;
            }
            0xA1 => {
                self.active.mist = !self.active.mist;
                self.modal.mist = self.active.mist;
            }
            _ => {}
        }
        let name = match b {
            b'!' => "!".to_string(),
            b'~' => "~".to_string(),
            0x18 => "Ctrl-X".to_string(),
            b => format!("0x{b:02X}"),
        };
        self.events.push(Event::Console {
            client: id,
            dir: "rt",
            text: name,
            status: false,
        });
    }

    // ---------- state ----------

    fn wco(&self) -> [f64; 3] {
        add(self.g5x[self.modal.wcs], self.g92)
    }

    pub fn head(&self) -> [f64; 3] {
        add(self.pos, self.off)
    }

    fn state_name(&self) -> String {
        match self.state {
            State::Idle if self.check_mode => "Check".into(),
            State::Idle => "Idle".into(),
            State::Run => "Run".into(),
            State::Hold => format!("Hold:{}", if self.speed > 0.0 { 1 } else { 0 }),
            State::Jog => "Jog".into(),
            State::Home => "Home".into(),
            State::Alarm(_) => "Alarm".into(),
            State::Sleep => "Sleep".into(),
        }
    }

    pub fn status_report(&mut self, id: ClientId) -> String {
        let wco = self.wco();
        let busy = !matches!(self.state, State::Idle | State::Alarm(_));
        let free_blocks = self.cfg.planner_blocks.saturating_sub(self.queue.len());
        let mask = self.cfg.status_mask;
        let ovr = self.ovr;
        let acc = {
            let mut a = String::new();
            match self.active.spindle {
                Spindle::Cw => a.push('S'),
                Spindle::Ccw => a.push('C'),
                Spindle::Off => {}
            }
            if self.active.flood {
                a.push('F');
            }
            if self.active.mist {
                a.push('M');
            }
            a
        };
        let feed = (self.speed * 60.0).round();
        let s = if self.active.spindle == Spindle::Off {
            0.0
        } else {
            self.active.s
        };
        let mut r = format!("<{}", self.state_name());
        if mask & 1 == 1 {
            r += &format!("|MPos:{}", vec3(self.pos));
        } else {
            r += &format!("|WPos:{}", vec3(sub(self.pos, wco)));
        }
        let c = self.clients.entry(id).or_default();
        if mask & 2 == 2 {
            r += &format!(
                "|Bf:{},{}",
                free_blocks,
                self.cfg.rx_buffer.saturating_sub(c.rx_used)
            );
        }
        r += &format!("|FS:{},{}", feed, s.round());
        let refresh = if busy { 30 } else { 10 };
        if c.wco_count == 0 || c.last_wco != wco {
            c.wco_count = refresh;
            c.last_wco = wco;
            r += &format!("|WCO:{}", vec3(wco));
            if c.ov_count == 0 {
                c.ov_count = 1;
            }
        } else {
            c.wco_count -= 1;
            if c.ov_count == 0 || c.last_ov != ovr {
                c.ov_count = refresh;
                c.last_ov = ovr;
                r += &format!("|Ov:{},{},{}", ovr[0], ovr[1], ovr[2]);
                if !acc.is_empty() {
                    r += &format!("|A:{acc}");
                }
            } else {
                c.ov_count -= 1;
            }
        }
        r.push('>');
        r
    }

    pub fn snapshot(&self) -> Snapshot {
        let wco = self.wco();
        let h = self.head();
        Snapshot {
            state: self.state_name(),
            mpos: self.pos,
            wpos: sub(self.pos, wco),
            wco,
            head: [h[0], h[1]],
            feed: self.speed * 60.0,
            s: self.active.s,
            spindle: match self.active.spindle {
                Spindle::Off => "M5",
                Spindle::Cw => "M3",
                Spindle::Ccw => "M4",
            }
            .into(),
            laser_on: self.last_power > 0.0,
            power: self.last_power,
            ovr: self.ovr,
            flood: self.active.flood,
            mist: self.active.mist,
            outputs: self.active.outputs,
            planner_used: self.queue.len(),
            planner_size: self.cfg.planner_blocks,
            homed: self.homed,
            alarm: match self.state {
                State::Alarm(c) => Some(c),
                _ => None,
            },
            job_time: match self.job_start {
                Some(t) => self.time - t,
                None => self.job_time,
            },
            running: self.job_start.is_some(),
        }
    }

    pub fn take_out(&mut self) -> Vec<Out> {
        std::mem::take(&mut self.out)
    }
    pub fn take_events(&mut self) -> Vec<Event> {
        std::mem::take(&mut self.events)
    }
    pub fn take_segments(&mut self) -> Vec<Segment> {
        std::mem::take(&mut self.segments)
    }
    pub fn is_idle(&self) -> bool {
        self.state == State::Idle
            && self.queue.is_empty()
            && self.pending.is_empty()
            && self.clients.values().all(|c| c.lines.is_empty())
    }
    pub fn time(&self) -> f64 {
        self.time
    }

    /// Change settings from outside (window); travel and limits apply at once
    pub fn set_config(&mut self, mut cfg: Config) {
        cfg.sanitize();
        self.cfg = cfg;
        if self.homing_lock() && self.state == State::Idle {
            self.state = State::Alarm(0);
        }
        if (!self.cfg.homing || !self.cfg.must_home) && self.state == State::Alarm(0) {
            self.state = State::Idle;
        }
    }

    /// Ctrl-X: stop, clear buffers, default state. During motion: ALARM:3.
    pub fn soft_reset(&mut self) {
        let moving = self.speed > 0.0
            || matches!(
                self.state,
                State::Run | State::Jog | State::Home | State::Hold
            ) && !self.queue.is_empty();
        self.queue.clear();
        self.pending.clear();
        self.pending_client = None;
        for c in self.clients.values_mut() {
            c.lines.clear();
            c.partial.clear();
            c.rx_used = 0;
            c.wait_idle = false;
            c.overflow_warned = false;
            c.wco_count = 0;
            c.ov_count = 0;
        }
        self.speed = 0.0;
        self.hold = false;
        self.jog_cancel = false;
        self.ovr = [100, 100, 100];
        self.active = Applied::default();
        self.last_power = 0.0;
        self.modal = Modal {
            wcs: 0,
            ..Modal::default()
        };
        self.g92 = [0.0; 3];
        self.plan_pos = self.pos;
        self.check_mode = false;
        self.end_job();
        let was_alarm = matches!(self.state, State::Alarm(_));
        if moving {
            if self.cfg.homing {
                self.homed = false;
            }
            self.state = State::Alarm(3);
            self.send(None, "ALARM:3");
            self.events.push(Event::Alarm { code: 3 });
        } else if !was_alarm {
            self.state = State::Idle;
        }
        if self.state == State::Idle && self.homing_lock() {
            self.state = State::Alarm(0);
        }
        let w = self.welcome();
        self.send(None, "");
        self.send(None, w);
        if matches!(self.state, State::Alarm(_)) {
            self.send(None, "[MSG:'$H'|'$X' to unlock]");
        }
    }

    /// Power cycle: the head stays where it is; MPos starts at 0 there.
    pub fn power_cycle(&mut self) {
        let head = self.head();
        self.state = State::Idle;
        self.homed = false;
        self.pos = [0.0; 3];
        self.off = head;
        self.plan_pos = self.pos;
        self.crashed = false;
        self.soft_reset();
    }

    fn alarm(&mut self, code: u8) {
        self.queue.clear();
        self.pending.clear();
        self.pending_client = None;
        for c in self.clients.values_mut() {
            c.lines.clear();
            c.rx_used = 0;
            c.wait_idle = false;
        }
        self.speed = 0.0;
        self.hold = false;
        self.active = Applied {
            outputs: self.active.outputs,
            ..Applied::default()
        };
        self.last_power = 0.0;
        self.plan_pos = self.pos;
        if code == 1 || code == 2 {
            self.homed = false;
        }
        self.state = State::Alarm(code);
        self.end_job();
        self.send(None, format!("ALARM:{code}"));
        self.events.push(Event::Alarm { code });
        if code == 1 || code == 2 {
            self.send(None, "[MSG:Reset to continue]");
        }
    }

    fn end_job(&mut self) {
        if let Some(t) = self.job_start.take() {
            self.job_time = self.time - t;
        }
    }

    // ---------- processing lines ----------

    fn process_lines(&mut self) {
        // one line per connection in turn, while the planner has room
        loop {
            if !self.pending.is_empty() {
                return;
            }
            let ids: Vec<ClientId> = self.clients.keys().copied().collect();
            if ids.is_empty() {
                return;
            }
            let start = ids.iter().position(|&i| i > self.rr).unwrap_or(0);
            let mut progressed = false;
            for k in 0..ids.len() {
                let id = ids[(start + k) % ids.len()];
                let Some(c) = self.clients.get(&id) else {
                    continue;
                };
                if c.wait_idle || c.lines.is_empty() {
                    continue;
                }
                if self.queue.len() >= self.cfg.planner_blocks {
                    return;
                }
                let c = self.clients.get_mut(&id).unwrap();
                let line = c.lines.pop_front().unwrap();
                c.rx_used = c.rx_used.saturating_sub(line.len() + 1);
                if c.rx_used <= self.cfg.rx_buffer / 2 {
                    c.overflow_warned = false;
                }
                self.rr = id;
                self.events.push(Event::Console {
                    client: id,
                    dir: "in",
                    text: line.clone(),
                    status: false,
                });
                self.line(id, &line);
                progressed = true;
                if !self.pending.is_empty() {
                    return;
                }
            }
            if !progressed {
                return;
            }
        }
    }

    fn line(&mut self, id: ClientId, raw: &str) {
        let trimmed = raw.trim();
        let max = if self.cfg.flavor == Flavor::Grbl {
            GRBL_LINE_MAX
        } else {
            FLUID_LINE_MAX
        };
        let reply = if raw.len() > max {
            Reply::Err(err::OVERFLOW)
        } else if trimmed.starts_with('$') {
            self.system(id, trimmed)
        } else if trimmed.starts_with("[ESP") {
            self.esp(trimmed)
        } else {
            let cleaned = gcode::clean(trimmed);
            if cleaned.is_empty() {
                Reply::Ok(vec![])
            } else {
                self.gcode_line(id, &cleaned)
            }
        };
        match reply {
            Reply::Ok(lines) => {
                for l in lines {
                    self.send(Some(id), l);
                }
                if self.pending.is_empty() {
                    self.send(Some(id), "ok");
                } else {
                    self.pending_client = Some(id);
                }
            }
            Reply::Deferred => {
                if let Some(c) = self.clients.get_mut(&id) {
                    c.wait_idle = true;
                }
            }
            Reply::Err(SOFT_LIMIT_ALARM) => {
                self.alarm(2);
            }
            Reply::Err(code) => self.send(Some(id), format!("error:{code}")),
        }
    }

    fn gcode_line(&mut self, _id: ClientId, cleaned: &str) -> Reply {
        match self.state {
            State::Alarm(_) | State::Jog => return Reply::Err(err::SYSTEM_GC_LOCK),
            State::Sleep => return Reply::Err(err::SYSTEM_GC_LOCK),
            State::Home => return Reply::Err(err::IDLE_ERROR),
            _ => {}
        }
        let words = match gcode::words(cleaned) {
            Ok(w) => w,
            Err(e) => return Reply::Err(e),
        };
        let block = match gcode::parse_block(&words) {
            Ok(b) => b,
            Err(e) => return Reply::Err(e),
        };
        match self.plan_block(&block) {
            Ok(items) => {
                if !self.check_mode {
                    self.pending.extend(items);
                    self.fill_queue();
                }
                Reply::Ok(vec![])
            }
            Err(e) => Reply::Err(e),
        }
    }

    fn in_bed(&self, p: [f64; 3]) -> bool {
        let e = 1e-6;
        p[0] >= -e && p[1] >= -e && p[0] <= self.cfg.bed_w + e && p[1] <= self.cfg.bed_h + e
    }

    fn make_move(
        &self,
        from: [f64; 3],
        to: [f64; 3],
        feed_mm_min: f64,
        rapid: bool,
    ) -> Option<Item> {
        let d = sub(to, from);
        let len = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
        if len < 1e-9 {
            return None;
        }
        Some(Item::Move(Move {
            start: from,
            unit: [d[0] / len, d[1] / len, d[2] / len],
            len,
            done: 0.0,
            feed: feed_mm_min / 60.0,
            rapid,
            jog: false,
            homing: false,
            junction: 0.0,
        }))
    }

    /// Turn a checked line into planner entries. Changes the modal state only on success.
    fn plan_block(&mut self, b: &Block) -> Result<Vec<Item>, u8> {
        let mut m = self.modal.clone();
        let mut g5x = self.g5x;
        let mut g92 = self.g92;
        let mut predef = self.predef;
        let mut items = Vec::new();
        let mut pos = self.plan_pos;
        if let Some(i) = b.inches {
            m.inches = i;
        }
        let unit = if m.inches { 25.4 } else { 1.0 };
        if let Some(f) = b.f {
            m.feed = f * unit;
        }
        if let Some(s) = b.s {
            m.s = s;
        }
        if let Some(sp) = b.spindle {
            m.spindle = sp;
        }
        if b.coolant_off {
            m.flood = false;
            m.mist = false;
        }
        if b.flood == Some(true) {
            m.flood = true;
        }
        if b.mist == Some(true) {
            m.mist = true;
        }
        let mut immediate_outputs = None;
        if let Some((n, on, sync)) = b.output {
            if n > 63 {
                return Err(err::MAX_VALUE_EXCEEDED);
            }
            if on {
                m.outputs |= 1 << n;
            } else {
                m.outputs &= !(1 << n);
            }
            if !sync {
                immediate_outputs = Some(m.outputs);
            }
        }
        let new_state = Applied {
            spindle: m.spindle,
            s: m.s,
            flood: m.flood,
            mist: m.mist,
            outputs: m.outputs,
        };
        let old = &self.modal;
        let spindle_changed = old.spindle != m.spindle || old.s != m.s;
        let coolant_changed = old.flood != m.flood || old.mist != m.mist;
        let outputs_changed = old.outputs != m.outputs && immediate_outputs.is_none();
        if spindle_changed || coolant_changed || outputs_changed {
            // in laser mode the machine keeps moving on new S values, otherwise it stops
            let stop = coolant_changed || outputs_changed || !self.cfg.laser_mode;
            items.push(Item::Apply(new_state, stop));
        }
        if b.non_modal == Some(NonModal::Dwell) {
            let p = b.p.ok_or(err::VALUE_WORD_MISSING)?;
            if p < 0.0 {
                return Err(err::NEGATIVE_VALUE);
            }
            items.push(Item::Dwell(p));
        }
        if let Some(w) = b.wcs {
            m.wcs = w;
        }
        if let Some(a) = b.absolute {
            m.absolute = a;
        }
        let wco = add(g5x[m.wcs], g92);
        // target of a move from the axis words
        let target = |base: [f64; 3], wco: [f64; 3], absolute: bool| -> [f64; 3] {
            let mut t = base;
            for i in 0..3 {
                if let Some(v) = b.axes[i] {
                    let v = v * unit;
                    t[i] = if b.g53 {
                        v
                    } else if absolute {
                        v + wco[i]
                    } else {
                        base[i] + v
                    };
                }
            }
            t
        };
        let mut axes_used = false;
        match b.non_modal {
            Some(NonModal::SetOffset) => {
                axes_used = true;
                let l = b.l.ok_or(err::VALUE_WORD_MISSING)?;
                let p = b.p.ok_or(err::VALUE_WORD_MISSING)?;
                if !(0.0..=6.0).contains(&p) || p.fract() != 0.0 {
                    return Err(err::UNSUPPORTED_COMMAND);
                }
                let idx = if p == 0.0 { m.wcs } else { p as usize - 1 };
                if !b.has_axes() {
                    return Err(err::NO_AXIS_WORDS);
                }
                for i in 0..3 {
                    if let Some(v) = b.axes[i] {
                        let v = v * unit;
                        match l as i64 {
                            2 => g5x[idx][i] = v,
                            20 => g5x[idx][i] = pos[i] - v - g92[i],
                            _ => return Err(err::UNSUPPORTED_COMMAND),
                        }
                    }
                }
            }
            Some(NonModal::SetG92) => {
                axes_used = true;
                if !b.has_axes() {
                    return Err(err::NO_AXIS_WORDS);
                }
                for i in 0..3 {
                    if let Some(v) = b.axes[i] {
                        g92[i] = pos[i] - g5x[m.wcs][i] - v * unit;
                    }
                }
            }
            Some(NonModal::ResetG92) => g92 = [0.0; 3],
            Some(NonModal::SetPredef(i)) => predef[i] = pos,
            Some(NonModal::GoPredef(i)) => {
                axes_used = true;
                let mid = target(pos, wco, m.absolute);
                if b.has_axes() {
                    if self.cfg.soft_limits && !self.in_bed(mid) {
                        return Err(SOFT_LIMIT_ALARM);
                    }
                    items.extend(self.make_move(pos, mid, 0.0, true));
                    pos = mid;
                }
                let dest = predef[i];
                if self.cfg.soft_limits && !self.in_bed(dest) {
                    return Err(SOFT_LIMIT_ALARM);
                }
                items.extend(self.make_move(pos, dest, 0.0, true));
                pos = dest;
            }
            _ => {}
        }
        if let Some(mo) = b.motion {
            m.motion = mo;
        }
        if b.g53 && !matches!(m.motion, Motion::Rapid | Motion::Linear) {
            return Err(30);
        }
        if !axes_used && b.has_axes() {
            let wco = add(g5x[m.wcs], g92);
            let to = target(pos, wco, m.absolute);
            match m.motion {
                Motion::None => return Err(31),
                Motion::Rapid | Motion::Linear => {
                    if m.motion == Motion::Linear && m.feed <= 0.0 {
                        return Err(err::UNDEFINED_FEED_RATE);
                    }
                    if self.cfg.soft_limits && !self.in_bed(to) {
                        return Err(SOFT_LIMIT_ALARM);
                    }
                    items.extend(self.make_move(
                        pos,
                        to,
                        if m.motion == Motion::Rapid {
                            0.0
                        } else {
                            m.feed
                        },
                        m.motion == Motion::Rapid,
                    ));
                }
                Motion::ArcCw | Motion::ArcCcw => {
                    if m.feed <= 0.0 {
                        return Err(err::UNDEFINED_FEED_RATE);
                    }
                    let cw = m.motion == Motion::ArcCw;
                    let center = if let Some(r) = b.r {
                        gcode::center_from_radius(pos, to, r * unit, cw)?
                    } else {
                        if b.ijk[0].is_none() && b.ijk[1].is_none() {
                            return Err(err::NO_OFFSETS_IN_PLANE);
                        }
                        let c = [
                            pos[0] + b.ijk[0].unwrap_or(0.0) * unit,
                            pos[1] + b.ijk[1].unwrap_or(0.0) * unit,
                        ];
                        let r0 = (pos[0] - c[0]).hypot(pos[1] - c[1]);
                        let r1 = (to[0] - c[0]).hypot(to[1] - c[1]);
                        let delta = (r1 - r0).abs();
                        if delta > 0.005 && (delta > 0.5 || delta > 0.001 * r0) {
                            return Err(err::INVALID_TARGET);
                        }
                        c
                    };
                    let mut from = pos;
                    for p in gcode::arc_points(pos, to, center, cw, self.cfg.arc_tolerance) {
                        if self.cfg.soft_limits && !self.in_bed(p) {
                            return Err(SOFT_LIMIT_ALARM);
                        }
                        items.extend(self.make_move(from, p, m.feed, false));
                        from = p;
                    }
                }
            }
            pos = to;
        } else if !axes_used
            && matches!(b.motion, Some(Motion::ArcCw | Motion::ArcCcw))
            && (b.ijk.iter().any(|v| v.is_some()) || b.r.is_some())
        {
            return Err(err::NO_AXIS_WORDS);
        }
        match b.flow {
            Some(ProgramFlow::Pause) => items.push(Item::Pause),
            Some(ProgramFlow::End) => {
                m.motion = Motion::Linear;
                m.absolute = true;
                m.wcs = 0;
                m.spindle = Spindle::Off;
                m.flood = false;
                m.mist = false;
                items.push(Item::Apply(
                    Applied {
                        spindle: Spindle::Off,
                        s: m.s,
                        flood: false,
                        mist: false,
                        outputs: m.outputs,
                    },
                    true,
                ));
            }
            None => {}
        }
        // commit
        self.modal = m;
        self.g5x = g5x;
        self.g92 = g92;
        self.predef = predef;
        self.plan_pos = pos;
        if let Some(o) = immediate_outputs {
            self.active.outputs = o;
        }
        Ok(items)
    }

    fn fill_queue(&mut self) {
        while self.queue.len() < self.cfg.planner_blocks {
            let Some(mut item) = self.pending.pop_front() else {
                break;
            };
            if let Item::Move(mv) = &mut item {
                mv.junction = self.junction_with_tail(mv);
                if self.job_start.is_none() && !mv.jog && !mv.homing {
                    self.job_start = Some(self.time);
                }
                if matches!(self.state, State::Idle) {
                    self.state = if mv.jog {
                        State::Jog
                    } else if mv.homing {
                        State::Home
                    } else {
                        State::Run
                    };
                }
            } else if self.state == State::Idle && !matches!(item, Item::Apply(_, false)) {
                self.state = State::Run;
            }
            self.queue.push_back(item);
        }
        if self.pending.is_empty() {
            if let Some(id) = self.pending_client.take() {
                self.send(Some(id), "ok");
            }
        }
    }

    /// Max. speed at which a new move can follow the last one in the planner
    fn junction_with_tail(&self, mv: &Move) -> f64 {
        let mut prev = None;
        for it in self.queue.iter().rev() {
            match it {
                Item::Apply(_, false) => continue,
                Item::Move(p) => {
                    prev = Some(p);
                    break;
                }
                _ => break,
            }
        }
        let Some(p) = prev else { return 0.0 };
        let cos = -(p.unit[0] * mv.unit[0] + p.unit[1] * mv.unit[1] + p.unit[2] * mv.unit[2]);
        if cos > 0.999999 {
            0.0
        } else if cos < -0.999999 {
            f64::INFINITY
        } else {
            let s = (0.5 * (1.0 - cos)).sqrt();
            (self.cfg.accel * self.cfg.junction_dev * s / (1.0 - s)).sqrt()
        }
    }

    fn vmax(&self, mv: &Move) -> f64 {
        let max = self.cfg.max_rate / 60.0;
        if mv.homing {
            (self.cfg.homing_rate / 60.0).min(max)
        } else if mv.jog {
            mv.feed.min(max)
        } else if mv.rapid {
            max * self.ovr[1] as f64 / 100.0
        } else {
            (mv.feed * self.ovr[0] as f64 / 100.0).min(max)
        }
    }

    /// Max. speed at the current point that still allows slowing down in time for all following
    /// junctions (at the end of the planner: standstill)
    fn brake_limit(&self) -> f64 {
        let a = self.cfg.accel;
        let Some(Item::Move(first)) = self.queue.front() else {
            return 0.0;
        };
        let mut dist = first.len - first.done;
        let mut cur = first;
        let mut limit = f64::INFINITY;
        let top = self.cfg.max_rate / 60.0 * 2.0;
        let mut i = 1;
        loop {
            // find the next entry, skipping pass-through state changes
            let mut next = None;
            while let Some(it) = self.queue.get(i) {
                i += 1;
                match it {
                    Item::Apply(_, false) => continue,
                    Item::Move(m) => {
                        next = Some(m);
                        break;
                    }
                    _ => break,
                }
            }
            let vj = match next {
                Some(n) => n.junction.min(self.vmax(cur)).min(self.vmax(n)),
                None => 0.0,
            };
            limit = limit.min((vj * vj + 2.0 * a * dist).sqrt());
            let Some(n) = next else { break };
            if vj <= 0.0 || (2.0 * a * dist).sqrt() > top {
                break;
            }
            dist += n.len;
            cur = n;
        }
        limit
    }

    fn power(&self, mv: &Move, v_avg: f64) -> f64 {
        let a = self.active;
        if a.spindle == Spindle::Off || a.s <= 0.0 {
            return 0.0;
        }
        let base = (a.s / self.cfg.s_max).min(1.0) * self.ovr[2] as f64 / 100.0;
        let base = base.min(1.0);
        if !self.cfg.laser_mode {
            return base;
        }
        if mv.rapid || mv.jog || mv.homing {
            return 0.0;
        }
        if a.spindle == Spindle::Ccw {
            let v = self.vmax(mv);
            if v > 0.0 {
                return base * (v_avg / v).min(1.0);
            }
        }
        base
    }

    /// Laser power at standstill (only outside laser mode does the laser burn without motion)
    fn idle_power(&self) -> f64 {
        if self.cfg.laser_mode || self.active.spindle == Spindle::Off || self.active.s <= 0.0 {
            0.0
        } else {
            ((self.active.s / self.cfg.s_max).min(1.0) * self.ovr[2] as f64 / 100.0).min(1.0)
        }
    }

    fn emit(&mut self, from: [f64; 3], to: [f64; 3], power: f64, dur: f64, rapid: bool) {
        self.last_power = power;
        let s = Segment {
            x0: from[0] as f32,
            y0: from[1] as f32,
            x1: to[0] as f32,
            y1: to[1] as f32,
            power: power as f32,
            dur: dur as f32,
            rapid,
        };
        // merge a straight continuation with the same power
        if let Some(l) = self.segments.last_mut() {
            if l.rapid == rapid && (l.power - s.power).abs() < 1e-4 && l.x1 == s.x0 && l.y1 == s.y0
            {
                let (ax, ay) = (l.x1 - l.x0, l.y1 - l.y0);
                let (bx, by) = (s.x1 - s.x0, s.y1 - s.y0);
                let cross = ax * by - ay * bx;
                let la = ax.hypot(ay);
                let lb = bx.hypot(by);
                let same_dir = (la == 0.0 && lb == 0.0)
                    || (la > 0.0
                        && lb > 0.0
                        && (cross / (la * lb)).abs() < 1e-4
                        && ax * bx + ay * by > 0.0);
                if same_dir {
                    l.x1 = s.x1;
                    l.y1 = s.y1;
                    l.dur += s.dur;
                    return;
                }
            }
        }
        if self.segments.len() >= SEGMENT_CAP {
            self.segments.drain(..SEGMENT_CAP / 2);
        }
        self.segments.push(s);
    }

    /// Execute a new position: track the physical head, check frame and limit switches
    fn set_pos(&mut self, p: [f64; 3]) -> bool {
        self.pos = p;
        let raw = add(p, self.off);
        let mut h = raw;
        h[0] = h[0].clamp(0.0, self.cfg.bed_w);
        h[1] = h[1].clamp(0.0, self.cfg.bed_h);
        if h != raw {
            if self.cfg.hard_limits && self.cfg.homing {
                self.off = sub(h, p);
                self.alarm(1);
                return false;
            }
            // without limit switches the head runs into the frame and the motors lose steps
            self.off = sub(h, p);
            if !self.crashed {
                self.crashed = true;
                self.warn("frameHit", None);
            }
        } else {
            self.crashed = false;
        }
        true
    }

    // ---------- time ----------

    /// Advance time by `dt` seconds
    pub fn tick(&mut self, dt: f64) {
        let mut left = dt.max(0.0);
        self.process_lines();
        while left > 1e-12 {
            let h = left.min(0.001);
            self.step(h);
            left -= h;
            self.time += h;
            self.fill_queue();
            self.process_lines();
        }
        self.after_motion();
        if self.events.len() > EVENT_CAP {
            self.events.drain(..EVENT_CAP / 2);
        }
    }

    fn after_motion(&mut self) {
        if self.queue.is_empty() && self.pending.is_empty() && self.speed == 0.0 {
            match self.state {
                State::Run | State::Jog | State::Home => {
                    self.state = State::Idle;
                    self.end_job();
                }
                _ => {}
            }
            if self.state == State::Hold && self.jog_cancel {
                self.state = State::Idle;
            }
            if matches!(self.state, State::Idle | State::Alarm(_)) {
                let waiting: Vec<ClientId> = self
                    .clients
                    .iter()
                    .filter(|(_, c)| c.wait_idle)
                    .map(|(&i, _)| i)
                    .collect();
                for id in waiting {
                    self.clients.get_mut(&id).unwrap().wait_idle = false;
                    self.send(Some(id), "ok");
                }
            }
        }
    }

    fn step(&mut self, h: f64) {
        let mut t = h;
        while t > 1e-12 {
            let Some(front) = self.queue.front_mut() else {
                self.speed = 0.0;
                let p = self.idle_power();
                if p > 0.0 && !matches!(self.state, State::Alarm(_)) {
                    let hd = self.head();
                    self.emit(hd, hd, p, t, false);
                } else {
                    self.last_power = 0.0;
                }
                self.after_motion();
                return;
            };
            match front {
                Item::Apply(a, _) => {
                    self.active = *a;
                    self.queue.pop_front();
                }
                Item::Pause => {
                    self.queue.pop_front();
                    self.hold = true;
                    self.state = State::Hold;
                }
                Item::Homed => {
                    self.queue.pop_front();
                    let z = self.pos[2];
                    self.pos = [0.0, 0.0, z];
                    self.off = [0.0, 0.0, self.off[2]];
                    self.plan_pos = self.pos;
                    self.homed = true;
                    self.crashed = false;
                    self.state = State::Idle;
                }
                Item::Dwell(rest) => {
                    if self.hold {
                        return;
                    }
                    let used = rest.min(t);
                    *rest -= used;
                    let done = *rest <= 1e-12;
                    t -= used;
                    let p = self.idle_power();
                    if p > 0.0 {
                        let hd = self.head();
                        self.emit(hd, hd, p, used, false);
                    }
                    if done {
                        self.queue.pop_front();
                    }
                }
                Item::Move(_) => {
                    let Some(Item::Move(mv)) = self.queue.front() else {
                        unreachable!()
                    };
                    let mv = mv.clone();
                    let a = self.cfg.accel;
                    let v0 = self.speed;
                    let vmax = self.vmax(&mv);
                    let v1 = if self.hold {
                        (v0 - a * t).max(0.0)
                    } else {
                        (v0 + a * t).min(vmax).min(self.brake_limit())
                    };
                    if self.hold && v0 == 0.0 {
                        self.speed = 0.0;
                        self.last_power = 0.0;
                        if self.jog_cancel {
                            self.finish_jog_cancel();
                        }
                        return;
                    }
                    let rest = mv.len - mv.done;
                    let ds = 0.5 * (v0 + v1) * t;
                    let from = self.head();
                    let (used, new_done, finished) = if ds >= rest {
                        let avg = 0.5 * (v0 + v1);
                        let used = if avg > 0.0 { (rest / avg).min(t) } else { t };
                        (used, mv.len, true)
                    } else {
                        (t, mv.done + ds, false)
                    };
                    let p = [
                        mv.start[0] + mv.unit[0] * new_done,
                        mv.start[1] + mv.unit[1] * new_done,
                        mv.start[2] + mv.unit[2] * new_done,
                    ];
                    let power = self.power(&mv, 0.5 * (v0 + v1));
                    self.speed = v1;
                    if !self.set_pos(p) {
                        return;
                    }
                    let to = self.head();
                    self.emit(from, to, power, used, mv.rapid || mv.jog || mv.homing);
                    if let Some(Item::Move(m)) = self.queue.front_mut() {
                        m.done = new_done;
                    }
                    if finished {
                        self.queue.pop_front();
                        if self.queue.is_empty() && self.pending.is_empty() {
                            self.speed = 0.0;
                        }
                    }
                    t -= used;
                    if !finished && self.hold && self.speed == 0.0 && self.jog_cancel {
                        self.finish_jog_cancel();
                        return;
                    }
                }
            }
        }
    }

    fn finish_jog_cancel(&mut self) {
        self.queue
            .retain(|it| !matches!(it, Item::Move(m) if m.jog));
        self.pending.clear();
        self.jog_cancel = false;
        self.hold = false;
        self.plan_pos = self.pos;
        if self.queue.is_empty() {
            self.state = State::Idle;
        }
    }

    // ---------- $ commands ----------

    fn system(&mut self, id: ClientId, line: &str) -> Reply {
        let fluid = self.cfg.flavor == Flavor::Fluidnc;
        let busy = !matches!(self.state, State::Idle | State::Alarm(_));
        let upper = line.to_ascii_uppercase();
        if let Some(j) = upper.strip_prefix("$J=") {
            return self.jog(j);
        }
        match upper.as_str() {
            "$" => {
                return Reply::Ok(vec![
                    "[HLP:$$ $# $G $I $N $x=val $Nx=line $J=line $SLP $C $X $H ~ ! ? ctrl-x]"
                        .into(),
                ])
            }
            "$$" => {
                if busy {
                    return Reply::Err(err::IDLE_ERROR);
                }
                return Reply::Ok(self.settings_list());
            }
            "$#" => {
                let mut l = Vec::new();
                for (i, o) in self.g5x.iter().enumerate() {
                    l.push(format!("[G{}:{}]", 54 + i, vec3(*o)));
                }
                l.push(format!("[G28:{}]", vec3(self.predef[0])));
                l.push(format!("[G30:{}]", vec3(self.predef[1])));
                l.push(format!("[G92:{}]", vec3(self.g92)));
                l.push("[TLO:0.000]".into());
                l.push("[PRB:0.000,0.000,0.000:0]".into());
                return Reply::Ok(l);
            }
            "$G" => {
                let m = &self.modal;
                let motion = match m.motion {
                    Motion::Rapid => "G0",
                    Motion::Linear => "G1",
                    Motion::ArcCw => "G2",
                    Motion::ArcCcw => "G3",
                    Motion::None => "G80",
                };
                let sp = match m.spindle {
                    Spindle::Off => "M5",
                    Spindle::Cw => "M3",
                    Spindle::Ccw => "M4",
                };
                let cool = match (m.mist, m.flood) {
                    (false, false) => "M9".to_string(),
                    (true, false) => "M7".into(),
                    (false, true) => "M8".into(),
                    (true, true) => "M7 M8".into(),
                };
                let f = if m.inches { m.feed / 25.4 } else { m.feed };
                return Reply::Ok(vec![format!(
                    "[GC:{} G{} G17 {} {} G94 {} {} T0 F{} S{}]",
                    motion,
                    54 + m.wcs,
                    if m.inches { "G20" } else { "G21" },
                    if m.absolute { "G90" } else { "G91" },
                    sp,
                    cool,
                    f,
                    m.s
                )]);
            }
            "$I" => {
                return Reply::Ok(match self.cfg.flavor {
                    Flavor::Grbl => vec!["[VER:1.1h.20190825:KizamuBeam Virtual Machine]".into(), format!("[OPT:VL,{},{}]", self.cfg.planner_blocks, self.cfg.rx_buffer + 1)],
                    Flavor::Fluidnc => vec![
                        format!("[VER:3.7 FluidNC v{FLUIDNC_VERSION}:]"),
                        "[OPT:PHW]".into(),
                        "[MSG: Machine: KizamuBeam Virtual Machine]".into(),
                        "[MSG: Mode=STA:SSID=virtual:Status=Connected:IP=127.0.0.1:MAC=00-00-00-00-00-00]".into(),
                    ],
                });
            }
            "$N" => return Reply::Ok(vec!["$N0=".into(), "$N1=".into()]),
            "$C" => {
                if busy {
                    return Reply::Err(err::IDLE_ERROR);
                }
                if matches!(self.state, State::Alarm(_)) {
                    return Reply::Err(err::SYSTEM_GC_LOCK);
                }
                if self.check_mode {
                    self.check_mode = false;
                    self.soft_reset();
                    return Reply::Ok(vec!["[MSG:Disabled]".into()]);
                }
                self.check_mode = true;
                return Reply::Ok(vec!["[MSG:Enabled]".into()]);
            }
            "$X" | "$ALARM/DISABLE" => {
                if let State::Alarm(_) = self.state {
                    self.state = State::Idle;
                    return Reply::Ok(vec!["[MSG:Caution: Unlocked]".into()]);
                }
                return Reply::Ok(vec![]);
            }
            "$H" | "$HOME" => return self.home(),
            "$SLP" | "$SLEEP" => {
                self.state = State::Sleep;
                return Reply::Ok(vec!["[MSG:Sleeping]".into()]);
            }
            "$RST=$" | "$RST=#" | "$RST=*" => {
                if busy {
                    return Reply::Err(err::IDLE_ERROR);
                }
                if upper != "$RST=#" {
                    let d = Config::default();
                    let keep = self.cfg.clone();
                    self.cfg = Config {
                        flavor: keep.flavor,
                        telnet_enabled: keep.telnet_enabled,
                        telnet_port: keep.telnet_port,
                        ws_enabled: keep.ws_enabled,
                        ws_port: keep.ws_port,
                        lan: keep.lan,
                        ..d
                    };
                    self.events.push(Event::ConfigChanged);
                }
                if upper != "$RST=$" {
                    self.g5x = [[0.0; 3]; 6];
                    self.g92 = [0.0; 3];
                    self.predef = [[0.0; 3]; 2];
                }
                return Reply::Ok(vec![]);
            }
            _ => {}
        }
        if fluid {
            match upper.as_str() {
                "$CD" | "$CONFIG/DUMP" => return Reply::Ok(self.config_yaml()),
                "$CONFIG/FILENAME" => {
                    return Reply::Ok(vec!["$Config/Filename=config.yaml".into()])
                }
                "$SS" | "$STARTUP/SHOW" => {
                    return Reply::Ok(vec![
                        format!(
                            "[MSG:INFO: FluidNC v{FLUIDNC_VERSION} (KizamuBeam Virtual Machine)]"
                        ),
                        "[MSG:INFO: Machine KizamuBeam Virtual Machine]".into(),
                    ])
                }
                "$BYE" => {
                    self.power_cycle();
                    return Reply::Ok(vec![]);
                }
                "$SD/LIST" | "$LOCALFS/LIST" | "$FILES/LISTGCODE" | "$SD/STATUS" => {
                    self.send(Some(id), "[MSG:ERR: No SD card]");
                    return Reply::Err(60);
                }
                _ => {}
            }
            if let Some(path) = line.strip_prefix("$/") {
                return self.fluid_setting(path);
            }
        }
        // $n=value
        if let Some((k, v)) = line[1..].split_once('=') {
            if let Ok(n) = k.parse::<u32>() {
                if busy {
                    return Reply::Err(err::IDLE_ERROR);
                }
                let Ok(v) = v.trim().parse::<f64>() else {
                    return Reply::Err(err::BAD_NUMBER_FORMAT);
                };
                if v < 0.0 {
                    return Reply::Err(err::NEGATIVE_VALUE);
                }
                return match self.set_setting(n, v) {
                    Ok(()) => Reply::Ok(vec![]),
                    Err(e) => Reply::Err(e),
                };
            }
        }
        Reply::Err(err::INVALID_STATEMENT)
    }

    fn esp(&mut self, line: &str) -> Reply {
        if self.cfg.flavor != Flavor::Fluidnc {
            return Reply::Err(err::EXPECTED_COMMAND_LETTER);
        }
        if line.to_ascii_uppercase().starts_with("[ESP800]") {
            return Reply::Ok(vec![format!(
                "FW version: FluidNC v{FLUIDNC_VERSION} # FW target:grbl-embedded # FW HW:Direct SD # primary sd:none # secondary sd:none # authentication:no # webcommunication: Sync: {} # hostname:kizamubeam-vm # axis:3",
                self.cfg.ws_port
            )]);
        }
        Reply::Ok(vec![])
    }

    fn home(&mut self) -> Reply {
        if !self.cfg.homing {
            return Reply::Err(err::SETTING_DISABLED);
        }
        if !matches!(self.state, State::Idle | State::Alarm(_)) || !self.queue.is_empty() {
            return Reply::Err(err::IDLE_ERROR);
        }
        // homing physically drives to the stop; the position until then does not count
        let head = self.head();
        self.pos = head;
        self.off = [0.0, 0.0, 0.0];
        self.plan_pos = head;
        self.state = State::Home;
        if let Some(Item::Move(mut mv)) =
            self.make_move(head, [0.0, 0.0, head[2]], self.cfg.homing_rate, true)
        {
            mv.homing = true;
            self.queue.push_back(Item::Move(mv));
        }
        self.queue.push_back(Item::Homed);
        Reply::Deferred
    }

    fn jog(&mut self, rest: &str) -> Reply {
        if matches!(self.state, State::Alarm(_)) {
            return Reply::Err(err::SYSTEM_GC_LOCK);
        }
        if !matches!(self.state, State::Idle | State::Jog) {
            return Reply::Err(err::IDLE_ERROR);
        }
        let cleaned = gcode::clean(rest);
        let Ok(words) = gcode::words(&cleaned) else {
            return Reply::Err(err::INVALID_JOG_COMMAND);
        };
        let mut absolute = self.modal.absolute;
        let mut inches = self.modal.inches;
        let mut g53 = false;
        let mut axes = [None; 3];
        let mut f = None;
        for w in &words {
            let code = (w.value * 10.0).round() as i64;
            match (w.letter, w.value) {
                ('G', _) if code == 900 => absolute = true,
                ('G', _) if code == 910 => absolute = false,
                ('G', _) if code == 200 => inches = true,
                ('G', _) if code == 210 => inches = false,
                ('G', _) if code == 530 => g53 = true,
                ('X', v) => axes[0] = Some(v),
                ('Y', v) => axes[1] = Some(v),
                ('Z', v) => axes[2] = Some(v),
                ('F', v) => f = Some(v),
                _ => return Reply::Err(err::INVALID_JOG_COMMAND),
            }
        }
        let Some(f) = f else {
            return Reply::Err(err::UNDEFINED_FEED_RATE);
        };
        let unit = if inches { 25.4 } else { 1.0 };
        let wco = self.wco();
        let base = self.plan_pos;
        let mut to = base;
        for i in 0..3 {
            if let Some(v) = axes[i] {
                let v = v * unit;
                to[i] = if g53 {
                    v
                } else if absolute {
                    v + wco[i]
                } else {
                    base[i] + v
                };
            }
        }
        if self.cfg.soft_limits && !self.in_bed(to) {
            return Reply::Err(err::TRAVEL_EXCEEDED);
        }
        if let Some(Item::Move(mut mv)) = self.make_move(base, to, f * unit, false) {
            mv.jog = true;
            self.pending.push_back(Item::Move(mv));
            self.plan_pos = to;
            self.fill_queue();
        }
        Reply::Ok(vec![])
    }

    fn settings_list(&self) -> Vec<String> {
        let c = &self.cfg;
        let b = |v: bool| if v { 1 } else { 0 };
        let mut l = vec![
            "$0=10".to_string(),
            "$1=25".into(),
            "$2=0".into(),
            "$3=0".into(),
            "$4=0".into(),
            "$5=0".into(),
            "$6=0".into(),
            format!("$10={}", c.status_mask),
            format!("$11={}", f3(c.junction_dev)),
            format!("$12={}", f3(c.arc_tolerance)),
            "$13=0".into(),
            format!("$20={}", b(c.soft_limits)),
            format!("$21={}", b(c.hard_limits)),
            format!("$22={}", b(c.homing)),
            "$23=0".into(),
            "$24=25.000".into(),
            format!("$25={}", f3(c.homing_rate)),
            "$26=250".into(),
            "$27=1.000".into(),
            format!("$30={}", c.s_max),
            "$31=0".into(),
            format!("$32={}", b(c.laser_mode)),
            "$100=80.000".into(),
            "$101=80.000".into(),
            "$102=80.000".into(),
        ];
        l.push(format!("$110={}", f3(c.max_rate)));
        l.push(format!("$111={}", f3(c.max_rate)));
        l.push(format!("$112={}", f3(c.max_rate)));
        l.push(format!("$120={}", f3(c.accel)));
        l.push(format!("$121={}", f3(c.accel)));
        l.push(format!("$122={}", f3(c.accel)));
        l.push(format!("$130={}", f3(c.bed_w)));
        l.push(format!("$131={}", f3(c.bed_h)));
        l.push("$132=50.000".into());
        l
    }

    fn set_setting(&mut self, n: u32, v: f64) -> Result<(), u8> {
        let on = v != 0.0;
        let c = &mut self.cfg;
        match n {
            0..=6 | 13 | 23 | 24 | 26 | 27 | 31 | 100..=102 | 112 | 122 | 132 => {}
            10 => c.status_mask = v as u32 & 3,
            11 => c.junction_dev = v,
            12 => c.arc_tolerance = v,
            20 => {
                if on && !c.homing {
                    return Err(err::SOFT_LIMIT_ERROR);
                }
                c.soft_limits = on
            }
            21 => c.hard_limits = on,
            22 => c.homing = on,
            25 => c.homing_rate = v,
            30 => c.s_max = v,
            32 => c.laser_mode = on,
            110 | 111 => c.max_rate = v,
            120 | 121 => c.accel = v,
            130 => c.bed_w = v,
            131 => c.bed_h = v,
            _ => return Err(err::INVALID_STATEMENT),
        }
        c.sanitize();
        self.events.push(Event::ConfigChanged);
        Ok(())
    }

    /// FluidNC: read $/path or set $/path=value
    fn fluid_setting(&mut self, path: &str) -> Reply {
        let (key, val) = match path.split_once('=') {
            Some((k, v)) => (k.trim().to_ascii_lowercase(), Some(v.trim().to_string())),
            None => (path.trim().to_ascii_lowercase(), None),
        };
        let c = &self.cfg;
        let axis = |k: &str| -> Option<(usize, String)> {
            let rest = k.strip_prefix("axes/")?;
            let (ax, r) = rest.split_once('/')?;
            let i = ["x", "y", "z"].iter().position(|a| *a == ax)?;
            Some((i, r.to_string()))
        };
        let b = |v: bool| if v { "true" } else { "false" }.to_string();
        let cur: Option<String> = match key.as_str() {
            "name" => Some("KizamuBeam Virtual Machine".into()),
            "start/must_home" => Some(b(c.must_home)),
            "laser/speed_map" => Some(format!("0=0.000% {}=100.000%", c.s_max)),
            k => axis(k).and_then(|(i, r)| match r.as_str() {
                "max_travel_mm" => Some(f3([c.bed_w, c.bed_h, 50.0][i])),
                "max_rate_mm_per_min" => Some(f3(c.max_rate)),
                "acceleration_mm_per_sec2" => Some(f3(c.accel)),
                "soft_limits" => Some(b(c.soft_limits)),
                "homing/seek_mm_per_min" => Some(f3(c.homing_rate)),
                "motor0/hard_limits" => Some(b(c.hard_limits)),
                "steps_per_mm" => Some("80.000".into()),
                _ => None,
            }),
        };
        let Some(cur) = cur else {
            return Reply::Err(err::INVALID_STATEMENT);
        };
        let Some(val) = val else {
            return Reply::Ok(vec![format!("$/{}={}", key, cur)]);
        };
        if !matches!(self.state, State::Idle | State::Alarm(_)) {
            return Reply::Err(err::IDLE_ERROR);
        }
        let num = val.parse::<f64>().ok();
        let flag = matches!(
            val.to_ascii_lowercase().as_str(),
            "true" | "1" | "yes" | "on"
        );
        let c = &mut self.cfg;
        match key.as_str() {
            "start/must_home" => c.must_home = flag,
            k => {
                if let Some((i, r)) = axis(k) {
                    match (r.as_str(), num) {
                        ("max_travel_mm", Some(v)) if i == 0 => c.bed_w = v,
                        ("max_travel_mm", Some(v)) if i == 1 => c.bed_h = v,
                        ("max_rate_mm_per_min", Some(v)) => c.max_rate = v,
                        ("acceleration_mm_per_sec2", Some(v)) => c.accel = v,
                        ("homing/seek_mm_per_min", Some(v)) => c.homing_rate = v,
                        ("soft_limits", _) => c.soft_limits = flag,
                        ("motor0/hard_limits", _) => c.hard_limits = flag,
                        (_, None)
                            if !matches!(r.as_str(), "soft_limits" | "motor0/hard_limits") =>
                        {
                            return Reply::Err(err::BAD_NUMBER_FORMAT)
                        }
                        _ => {}
                    }
                }
            }
        }
        c.sanitize();
        self.events.push(Event::ConfigChanged);
        Reply::Ok(vec![])
    }

    /// FluidNC $CD: configuration as YAML (as KizamuBeam parses it)
    fn config_yaml(&self) -> Vec<String> {
        let c = &self.cfg;
        let b = |v: bool| if v { "true" } else { "false" };
        let limit = if c.homing { "gpio.35:low" } else { "NO_PIN" };
        let mut y = vec![
            "name: KizamuBeam Virtual Machine".to_string(),
            "board: Virtual".into(),
            "stepping:".into(),
            "  engine: Timed".into(),
            "axes:".into(),
            "  shared_stepper_disable_pin: NO_PIN".into(),
        ];
        for (ax, travel) in [("x", c.bed_w), ("y", c.bed_h)] {
            y.push(format!("  {ax}:"));
            y.push("    steps_per_mm: 80.000".into());
            y.push(format!("    max_rate_mm_per_min: {}", f3(c.max_rate)));
            y.push(format!("    acceleration_mm_per_sec2: {}", f3(c.accel)));
            y.push(format!("    max_travel_mm: {}", f3(travel)));
            y.push(format!("    soft_limits: {}", b(c.soft_limits)));
            y.push("    homing:".into());
            y.push("      cycle: 1".into());
            y.push("      positive_direction: false".into());
            y.push("      mpos_mm: 0.000".into());
            y.push(format!("      seek_mm_per_min: {}", f3(c.homing_rate)));
            y.push("    motor0:".into());
            y.push(format!("      limit_neg_pin: {limit}"));
            y.push(format!("      hard_limits: {}", b(c.hard_limits)));
        }
        y.extend([
            "start:".to_string(),
            format!("  must_home: {}", b(c.must_home)),
            "coolant:".into(),
            "  flood_pin: gpio.2".into(),
            "  mist_pin: NO_PIN".into(),
            "Laser:".into(),
            "  pwm_hz: 5000".into(),
            "  output_pin: gpio.16".into(),
            "  enable_pin: NO_PIN".into(),
            format!("  speed_map: 0=0.000% {}=100.000%", c.s_max),
            "  tool_num: 0".into(),
            "  off_on_alarm: true".into(),
        ]);
        y
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const C: ClientId = 7;

    fn machine() -> Machine {
        let mut m = Machine::new(Config::default());
        m.connect(C);
        m
    }

    fn send(m: &mut Machine, s: &str) {
        m.input(C, s.as_bytes());
    }

    fn texts(m: &mut Machine) -> Vec<String> {
        m.take_out()
            .into_iter()
            .filter(|o| o.to.is_none() || o.to == Some(C))
            .map(|o| o.text)
            .collect()
    }

    fn run_until_idle(m: &mut Machine, max_s: f64) -> f64 {
        let t0 = m.time();
        while m.time() - t0 < max_s {
            m.tick(0.01);
            if m.is_idle() {
                break;
            }
        }
        m.time() - t0
    }

    #[test]
    fn answers_ok_and_errors() {
        let mut m = machine();
        send(&mut m, "G21 G90\nG1 X10\nG5 X1\nfoo\n1X\n");
        m.tick(0.001);
        assert_eq!(
            texts(&mut m),
            vec!["ok", "error:22", "error:20", "error:2", "error:1"]
        );
    }

    #[test]
    fn status_report_shape() {
        let mut m = machine();
        send(&mut m, "?");
        let o = texts(&mut m);
        assert_eq!(o.len(), 1);
        assert!(
            o[0].starts_with("<Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:0.000,0.000,0.000"),
            "{}",
            o[0]
        );
    }

    #[test]
    fn line_takes_realistic_time() {
        let mut m = machine();
        // 100 mm at 3000 mm/min = 2 s, plus accelerating and braking (1500 mm/s²): +0.033 s
        send(&mut m, "G1 X100 F3000\n");
        let t = run_until_idle(&mut m, 10.0);
        assert!((t - 2.033).abs() < 0.03, "{t}");
        assert!((m.snapshot().mpos[0] - 100.0).abs() < 1e-6);
    }

    #[test]
    fn laser_mode_burns_only_on_feed_moves() {
        let mut m = machine();
        send(&mut m, "M3 S500\nG0 X10\nG1 X20 F1200\nM5\n");
        run_until_idle(&mut m, 10.0);
        let segs = m.take_segments();
        let burn: f32 = segs
            .iter()
            .filter(|s| s.power > 0.0)
            .map(|s| (s.x1 - s.x0).abs())
            .sum();
        assert!((burn - 10.0).abs() < 1e-3, "{burn}");
        assert!(segs
            .iter()
            .filter(|s| s.power > 0.0)
            .all(|s| (s.power - 0.5).abs() < 1e-6 && !s.rapid));
    }

    #[test]
    fn m4_scales_power_with_speed() {
        let mut m = machine();
        send(&mut m, "M4 S1000\nG1 X50 F3000\n");
        run_until_idle(&mut m, 10.0);
        let segs = m.take_segments();
        let lowest = segs
            .iter()
            .filter(|s| s.power > 0.0)
            .map(|s| s.power)
            .fold(1.0, f32::min);
        assert!(lowest < 0.5, "less power while accelerating: {lowest}");
        assert!(segs.iter().any(|s| s.power > 0.99));
    }

    #[test]
    fn without_laser_mode_dwell_burns_a_dot() {
        let mut m = machine();
        send(&mut m, "$32=0\nM3 S1000\nG4 P0.5\nM5\n");
        run_until_idle(&mut m, 5.0);
        let dot: f32 = m
            .take_segments()
            .iter()
            .filter(|s| s.power > 0.0 && s.x0 == s.x1)
            .map(|s| s.dur)
            .sum();
        assert!(dot >= 0.49, "{dot}");
    }

    #[test]
    fn planner_flow_control_holds_ok_back() {
        let mut m = machine();
        let mut prog = String::new();
        for i in 0..40 {
            prog += &format!("G1 X{} Y{} F6000\n", i % 2 * 10, i + 1);
        }
        send(&mut m, &prog);
        m.tick(0.001);
        let oks = texts(&mut m).iter().filter(|t| *t == "ok").count();
        assert_eq!(oks, 16, "only as many ok as planner slots");
        run_until_idle(&mut m, 60.0);
        assert_eq!(texts(&mut m).iter().filter(|t| *t == "ok").count(), 24);
    }

    #[test]
    fn rx_overflow_is_reported() {
        let mut m = machine();
        let line = "G1 X1 Y1 F1000 (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)\n";
        send(&mut m, &line.repeat(3));
        assert!(m.take_events().iter().any(|e| matches!(
            e,
            Event::Warning {
                code: "rxOverflow",
                ..
            }
        )));
    }

    #[test]
    fn feed_hold_and_resume() {
        let mut m = machine();
        send(&mut m, "G1 X100 F6000\n");
        m.tick(0.3);
        send(&mut m, "!");
        m.tick(0.5);
        let x = m.snapshot().mpos[0];
        send(&mut m, "?");
        assert!(texts(&mut m).last().unwrap().starts_with("<Hold:0"));
        m.tick(0.5);
        assert_eq!(m.snapshot().mpos[0], x, "stands still in hold");
        send(&mut m, "~");
        run_until_idle(&mut m, 5.0);
        assert!((m.snapshot().mpos[0] - 100.0).abs() < 1e-6);
    }

    #[test]
    fn soft_reset_during_motion_alarms() {
        let mut m = machine();
        send(&mut m, "G1 X100 F6000\n");
        m.tick(0.2);
        m.input(C, &[0x18]);
        let o = texts(&mut m);
        assert!(o.contains(&"ALARM:3".to_string()), "{o:?}");
        send(&mut m, "G1 X0\n");
        m.tick(0.001);
        assert_eq!(texts(&mut m), vec!["error:9"]);
        send(&mut m, "$X\n");
        m.tick(0.001);
        assert_eq!(texts(&mut m), vec!["[MSG:Caution: Unlocked]", "ok"]);
    }

    #[test]
    fn work_offsets_and_wpos() {
        let mut m = machine();
        send(&mut m, "G0 X50 Y40\nG10 L20 P1 X0 Y0\nG0 X10\n");
        run_until_idle(&mut m, 5.0);
        let s = m.snapshot();
        assert!((s.mpos[0] - 60.0).abs() < 1e-9 && (s.wpos[0] - 10.0).abs() < 1e-9);
        assert_eq!(s.wco[1], 40.0);
    }

    #[test]
    fn homing_moves_head_and_answers_ok_when_done() {
        let mut m = machine();
        send(&mut m, "G0 X30 Y20\n");
        run_until_idle(&mut m, 5.0);
        m.power_cycle();
        texts(&mut m);
        // after power-on: MPos 0 where the head stands
        assert_eq!(m.snapshot().mpos, [0.0; 3]);
        assert_eq!(m.snapshot().head, [30.0, 20.0]);
        send(&mut m, "$H\n");
        m.tick(0.1);
        assert!(texts(&mut m).is_empty(), "ok only after homing");
        run_until_idle(&mut m, 10.0);
        assert_eq!(texts(&mut m), vec!["ok"]);
        assert_eq!(m.snapshot().head, [0.0, 0.0]);
        assert!(m.snapshot().homed);
    }

    #[test]
    fn frame_hit_without_switches_loses_position() {
        let mut m = machine();
        send(&mut m, "G0 X-20\nG0 X10\n");
        run_until_idle(&mut m, 5.0);
        assert!(m.take_events().iter().any(|e| matches!(
            e,
            Event::Warning {
                code: "frameHit",
                ..
            }
        )));
        // the controller believes X=10, but the head is at 30
        assert!((m.snapshot().head[0] - 30.0).abs() < 1e-6);
    }

    #[test]
    fn soft_limits_alarm() {
        let mut m = machine();
        send(&mut m, "$20=1\nG0 X500\n");
        m.tick(0.01);
        assert!(texts(&mut m).contains(&"ALARM:2".to_string()));
    }

    #[test]
    fn jog_and_cancel() {
        let mut m = machine();
        send(&mut m, "$J=G91 X100 F3000\n");
        m.tick(0.3);
        send(&mut m, "?");
        assert!(texts(&mut m).last().unwrap().starts_with("<Jog"));
        m.input(C, &[0x85]);
        run_until_idle(&mut m, 5.0);
        let x = m.snapshot().mpos[0];
        assert!(x > 1.0 && x < 30.0, "{x}");
        assert_eq!(m.snapshot().state, "Idle");
    }

    #[test]
    fn fluidnc_reads_and_writes_paths() {
        let mut m = machine();
        send(&mut m, "$/axes/x/max_travel_mm\n$/axes/y/max_travel_mm=300\n$/axes/y/max_travel_mm\n$Config/Filename\n");
        m.tick(0.001);
        assert_eq!(
            texts(&mut m),
            vec![
                "$/axes/x/max_travel_mm=400.000",
                "ok",
                "ok",
                "$/axes/y/max_travel_mm=300.000",
                "ok",
                "$Config/Filename=config.yaml",
                "ok"
            ]
        );
        assert_eq!(m.cfg.bed_h, 300.0);
    }

    #[test]
    fn grbl_settings_list() {
        let mut m = Machine::new(Config {
            flavor: Flavor::Grbl,
            ..Config::default()
        });
        m.connect(C);
        send(&mut m, "$$\n$130=350\n");
        m.tick(0.001);
        let o = texts(&mut m);
        assert!(o.contains(&"$130=400.000".to_string()));
        assert!(o.contains(&"$32=1".to_string()));
        assert_eq!(m.cfg.bed_w, 350.0);
    }

    #[test]
    fn arc_runs_and_ends_on_target() {
        let mut m = machine();
        send(&mut m, "G0 X50 Y50\nM3 S1000\nG2 X50 Y50 I10 J0 F3000\n");
        run_until_idle(&mut m, 10.0);
        let s = m.snapshot();
        assert!((s.mpos[0] - 50.0).abs() < 1e-6 && (s.mpos[1] - 50.0).abs() < 1e-6);
        let burned: f32 = m
            .take_segments()
            .iter()
            .filter(|s| s.power > 0.0)
            .map(|s| (s.x1 - s.x0).hypot(s.y1 - s.y0))
            .sum();
        assert!((burned - 62.83).abs() < 0.1, "{burned}");
    }

    #[test]
    fn overrides_change_speed_and_report() {
        let mut m = machine();
        m.input(C, &[0x91, 0x91]);
        send(&mut m, "G1 X100 F3000\n");
        let t = run_until_idle(&mut m, 10.0);
        assert!(t < 1.8, "120 % feed: {t}");
        send(&mut m, "??");
        let o = texts(&mut m);
        assert!(o.iter().any(|l| l.contains("Ov:120,100,100")), "{o:?}");
    }
}
