//! Ruida DSP emulation: the virtual machine can pretend to be a Ruida controller (RDC644x and
//! relatives, found in many CO2 lasers). Programs such as LightBurn, RDWorks, MeerK40t or
//! Rayforge send their job over UDP as scrambled Ruida binary data; this module unscrambles it,
//! splits it into commands and turns them into actions for the GRBL-style machine: G-code lines
//! (`G53 G0/G1 … F… S…` in machine coordinates), real-time bytes, stop, home and replies to
//! memory reads (status, position, card ID).
//!
//! Protocol knowledge comes from the MeerK40t project (MIT, `meerk40t/ruida/`) and the Ruida
//! Protocol Analyzer by Steve Isaacs (MIT, `ruida_pa/protocols/ruida/ruida_protocol.py`); this is
//! an independent implementation.
//!
//! Format summary:
//! - every byte is scrambled: swap bit 7 and bit 0, XOR with a "magic" value (0x88 on most
//!   cards, 0x11 on 634XG, 0x38 on RDL9635), add 1;
//! - UDP packets to the data port start with a 16-bit sum of the scrambled payload; the controller
//!   answers each packet with a scrambled ACK (0xCC) or NAK (0xCF), replies follow in their own packet;
//! - bytes ≥ 0x80 start a command, data bytes carry 7 bits each; coordinates are µm (5 bytes,
//!   or 2 bytes for short relative moves), power is 14 bits for 100 %, speed µm/s.
//!
//! Coordinates: Ruida counts from its machine origin (usually back right, X grows to the left,
//! Y to the front). `Config::ruida_origin` says which bed corner that is.

use crate::config::{Config, RuidaOrigin};
use crate::machine::Snapshot;
use std::collections::HashMap;

pub const ACK: u8 = 0xCC;
pub const NAK: u8 = 0xCF;
/// Card ID we report: RDC6442S, the best-documented card
pub const CARD_ID: u32 = 0x6510_6510;
pub const MAINBOARD: &str = "RDC6442S-KZBVM";

pub fn swizzle_byte(b: u8, magic: u8) -> u8 {
    let swapped = (b & 0x7E) | ((b >> 7) & 1) | ((b & 1) << 7);
    (swapped ^ magic).wrapping_add(1)
}

pub fn unswizzle_byte(b: u8, magic: u8) -> u8 {
    let b = b.wrapping_sub(1) ^ magic;
    (b & 0x7E) | ((b >> 7) & 1) | ((b & 1) << 7)
}

pub fn swizzle(data: &[u8], magic: u8) -> Vec<u8> {
    data.iter().map(|&b| swizzle_byte(b, magic)).collect()
}

pub fn unswizzle(data: &[u8], magic: u8) -> Vec<u8> {
    data.iter().map(|&b| unswizzle_byte(b, magic)).collect()
}

/// Clients usually ask for the card ID first (`DA 00 05 7E`); from its scrambled form the magic
/// value can be read back.
pub fn magic_from_card_query(raw: &[u8]) -> Option<u8> {
    if raw.len() != 4 {
        return None;
    }
    (0..=255u8).find(|&m| unswizzle(raw, m) == [0xDA, 0x00, 0x05, 0x7E])
}

/// Guess the magic value of a whole .rd file: unscrambled data is mostly zero bytes, so the most
/// frequent byte is the scrambled zero.
pub fn magic_from_histogram(data: &[u8]) -> u8 {
    let mut hist = [0usize; 256];
    let mut prev = None;
    for &b in data {
        hist[b as usize] += if prev == Some(b) { 5 } else { 1 };
        prev = Some(b);
    }
    let top = (0..256).max_by_key(|&i| hist[i]).unwrap_or(0) as u8;
    // swizzle(0, m) = m + 1 (bit swap of 0 is 0)
    top.wrapping_sub(1)
}

/// Magic value of a whole .rd file: the histogram guess, unless one of the known values turns the
/// file into something that starts with a command and ends with EOF (0xD7)
pub fn magic_for_file(data: &[u8]) -> u8 {
    let guess = magic_from_histogram(data);
    let fits = |m: u8| {
        data.first().is_some_and(|&b| unswizzle_byte(b, m) >= 0x80)
            && data.last().is_some_and(|&b| unswizzle_byte(b, m) == 0xD7)
    };
    [guess, 0x88, 0x11, 0x38]
        .into_iter()
        .find(|&m| fits(m))
        .unwrap_or(guess)
}

/// Check the checksum of a data-port packet; returns the scrambled payload
pub fn checked_payload(packet: &[u8]) -> Option<&[u8]> {
    if packet.len() < 3 {
        return None;
    }
    let want = u16::from_be_bytes([packet[0], packet[1]]);
    let data = &packet[2..];
    let sum = data.iter().fold(0u16, |a, &b| a.wrapping_add(b as u16));
    (sum == want).then_some(data)
}

/// Build a data-port packet (checksum + scrambled payload), as a client sends it
pub fn packet(cmds: &[u8], magic: u8) -> Vec<u8> {
    let data = swizzle(cmds, magic);
    let sum = data.iter().fold(0u16, |a, &b| a.wrapping_add(b as u16));
    let mut p = sum.to_be_bytes().to_vec();
    p.extend(data);
    p
}

/// Split unscrambled data into commands: each starts with a byte ≥ 0x80
pub fn split_commands(data: &[u8]) -> Vec<&[u8]> {
    let mut out = Vec::new();
    let mut start = None;
    for (i, &b) in data.iter().enumerate() {
        if b >= 0x80 {
            if let Some(s) = start {
                out.push(&data[s..i]);
            }
            start = Some(i);
        }
    }
    if let Some(s) = start {
        out.push(&data[s..]);
    }
    out
}

fn u14(d: &[u8]) -> Option<u32> {
    (d.len() >= 2).then(|| ((d[0] as u32 & 0x7F) << 7) | (d[1] as u32 & 0x7F))
}

fn i14(d: &[u8]) -> Option<i32> {
    u14(d).map(|v| {
        if v > 0x1FFF {
            v as i32 - 0x4000
        } else {
            v as i32
        }
    })
}

fn u35(d: &[u8]) -> Option<u64> {
    (d.len() >= 5).then(|| {
        d[..5]
            .iter()
            .fold(0u64, |a, &b| (a << 7) | (b as u64 & 0x7F))
    })
}

/// 35 bits on the wire, the controller uses the low 32 bits as a signed number
fn i35(d: &[u8]) -> Option<i64> {
    u35(d).map(|v| (v as u32) as i32 as i64)
}

pub fn encode_u35(v: u32) -> [u8; 5] {
    let v = v as u64;
    [
        ((v >> 28) & 0x7F) as u8,
        ((v >> 21) & 0x7F) as u8,
        ((v >> 14) & 0x7F) as u8,
        ((v >> 7) & 0x7F) as u8,
        (v & 0x7F) as u8,
    ]
}

pub fn encode_i35(v: i64) -> [u8; 5] {
    encode_u35(v as i32 as u32)
}

pub fn encode_i14(v: i32) -> [u8; 2] {
    let v = (v & 0x3FFF) as u32;
    [((v >> 7) & 0x7F) as u8, (v & 0x7F) as u8]
}

pub fn encode_power(percent: f64) -> [u8; 2] {
    let v = (percent.clamp(0.0, 100.0) * 16383.0 / 100.0).round() as i32;
    encode_i14(v)
}

fn mm(d: &[u8]) -> Option<f64> {
    i35(d).map(|v| v as f64 / 1000.0)
}
fn mm_short(d: &[u8]) -> Option<f64> {
    i14(d).map(|v| v as f64 / 1000.0)
}
fn power(d: &[u8]) -> Option<f64> {
    u14(d).map(|v| v as f64 * 100.0 / 16384.0)
}
/// µm/s → mm/s
fn speed(d: &[u8]) -> Option<f64> {
    i35(d).map(|v| v as f64 / 1000.0)
}

/// Memory addresses (`DA 00 hi lo`, address = hi << 7 | lo)
pub mod mem {
    pub const BED_X: u32 = 0x0026;
    pub const BED_Y: u32 = 0x0036;
    pub const STATUS: u32 = 0x0200;
    pub const POS_X: u32 = 0x0221;
    pub const POS_Y: u32 = 0x0231;
    pub const POS_Z: u32 = 0x0241;
    pub const POS_U: u32 = 0x0251;
    pub const CARD_ID: u32 = 0x02FE;
    pub const MAINBOARD: u32 = 0x02FF;
}

/// Bits of the machine status word
pub const STATUS_JOB_RUNNING: u32 = 0x0000_0001;
pub const STATUS_PAUSED: u32 = 0x0000_0002;
pub const STATUS_MOVING: u32 = 0x0100_0000;

/// Ruida machine coordinates (mm from the Ruida origin) → machine coordinates of the VM (origin front left, Y back)
pub fn to_vm(cfg: &Config, r: [f64; 2]) -> [f64; 2] {
    let (w, h) = (cfg.bed_w, cfg.bed_h);
    match cfg.ruida_origin {
        RuidaOrigin::TopRight => [w - r[0], h - r[1]],
        RuidaOrigin::TopLeft => [r[0], h - r[1]],
        RuidaOrigin::BottomLeft => [r[0], r[1]],
        RuidaOrigin::BottomRight => [w - r[0], r[1]],
    }
}

/// Inverse of `to_vm` (the mapping is its own inverse per axis)
pub fn from_vm(cfg: &Config, v: [f64; 2]) -> [f64; 2] {
    to_vm(cfg, v)
}

#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    /// G-code line for the machine
    Line(String),
    /// Real-time byte (pause !, resume ~, jog cancel 0x85)
    Realtime(u8),
    /// Stop key / stop command: drop everything, laser off
    Stop,
    /// Reply packet (unscrambled)
    Reply(Vec<u8>),
}

/// Where coordinates of a job count from
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RefPoint {
    Machine,
    /// the origin set on the panel (we keep it at the machine origin)
    Origin,
    /// the head position when the job starts
    Current,
}

#[derive(Clone, Copy, Debug, Default)]
struct LayerSettings {
    speed: Option<f64>,
    min_power: Option<f64>,
    max_power: Option<f64>,
}

/// State of the emulated controller while it reads a job
pub struct Ruida {
    pub magic: u8,
    ref_point: RefPoint,
    /// Ruida coordinates (mm) of the job's zero point; set when the job's first move arrives
    base: Option<[f64; 2]>,
    /// current position in job coordinates (mm)
    pos: [f64; 2],
    /// Ruida machine position at the end of what was sent to the machine; None = ask the machine
    planned: Option<[f64; 2]>,
    in_job: bool,
    /// mm/s
    speed: f64,
    /// %
    power: f64,
    layers: HashMap<u8, LayerSettings>,
    air: bool,
    /// a document arrived that we did not understand fully (for the console)
    pub unknown: usize,
}

/// What the interpreter needs to know about the machine
pub struct View<'a> {
    pub cfg: &'a Config,
    pub snap: &'a Snapshot,
    /// nothing waits in our queue or in the machine
    pub idle: bool,
}

impl Ruida {
    pub fn new(magic: u8) -> Ruida {
        Ruida {
            magic,
            ref_point: RefPoint::Machine,
            base: None,
            pos: [0.0; 2],
            planned: None,
            in_job: false,
            speed: 100.0,
            power: 0.0,
            layers: HashMap::new(),
            air: false,
            unknown: 0,
        }
    }

    pub fn in_job(&self) -> bool {
        self.in_job
    }

    /// Everything stopped: forget what was planned
    pub fn reset(&mut self) {
        let magic = self.magic;
        *self = Ruida::new(magic);
    }

    /// Ruida machine position of the head as far as planned
    fn head(&self, v: &View) -> [f64; 2] {
        match self.planned {
            Some(p) if !v.idle => p,
            _ => from_vm(v.cfg, [v.snap.mpos[0], v.snap.mpos[1]]),
        }
    }

    fn begin_job(&mut self, v: &View, out: &mut Vec<Action>) {
        if self.in_job {
            return;
        }
        self.in_job = true;
        self.base = None;
        self.pos = [0.0; 2];
        self.air = false;
        out.push(Action::Line("G90 G21 M5 M9".into()));
        if v.idle {
            self.planned = None;
        }
    }

    fn end_job(&mut self, out: &mut Vec<Action>) {
        if !self.in_job {
            return;
        }
        self.in_job = false;
        self.base = None;
        out.push(Action::Line("M5 M9".into()));
    }

    fn base(&mut self, v: &View) -> [f64; 2] {
        if let Some(b) = self.base {
            return b;
        }
        let b = match self.ref_point {
            RefPoint::Machine | RefPoint::Origin => [0.0, 0.0],
            RefPoint::Current => self.head(v),
        };
        self.base = Some(b);
        b
    }

    /// Move to job coordinates `to` (mm), cutting or not
    fn motion(&mut self, v: &View, to: [f64; 2], cut: bool, out: &mut Vec<Action>) {
        if !self.in_job {
            self.begin_job(v, out);
        }
        let b = self.base(v);
        let abs = [b[0] + to[0], b[1] + to[1]];
        self.pos = to;
        self.planned = Some(abs);
        out.push(Action::Line(move_line(
            v.cfg, abs, cut, self.speed, self.power,
        )));
    }

    /// Move outside a job (framing, "move to"): rapid in Ruida machine coordinates
    fn rapid_abs(&mut self, v: &View, abs: [f64; 2], out: &mut Vec<Action>) {
        self.planned = Some(abs);
        out.push(Action::Line(move_line(v.cfg, abs, false, 0.0, 0.0)));
    }

    fn apply_layer(&mut self, n: u8) {
        if let Some(l) = self.layers.get(&n).copied() {
            if let Some(s) = l.speed {
                self.speed = s;
            }
            if let Some(p) = l.max_power.or(l.min_power) {
                self.power = p;
            }
        }
    }

    /// Read one command (unscrambled, from the data port or the keypad port)
    pub fn command(&mut self, c: &[u8], v: &View) -> Vec<Action> {
        let mut out = Vec::new();
        if c.is_empty() {
            return out;
        }
        let a = |i: usize| c.get(i).copied().unwrap_or(0);
        let d = |i: usize| c.get(i..).unwrap_or(&[]);
        match a(0) {
            // ----- moves and cuts -----
            0x88 | 0xA8 => {
                if let (Some(x), Some(y)) = (mm(d(1)), mm(d(6))) {
                    self.motion(v, [x, y], a(0) == 0xA8, &mut out);
                }
            }
            0x89 | 0xA9 => {
                if let (Some(dx), Some(dy)) = (mm_short(d(1)), mm_short(d(3))) {
                    let to = [self.pos[0] + dx, self.pos[1] + dy];
                    self.motion(v, to, a(0) == 0xA9, &mut out);
                }
            }
            0x8A | 0xAA => {
                if let Some(dx) = mm_short(d(1)) {
                    let to = [self.pos[0] + dx, self.pos[1]];
                    self.motion(v, to, a(0) == 0xAA, &mut out);
                }
            }
            0x8B | 0xAB => {
                if let Some(dy) = mm_short(d(1)) {
                    let to = [self.pos[0], self.pos[1] + dy];
                    self.motion(v, to, a(0) == 0xAB, &mut out);
                }
            }
            // single axis moves: 80 00 X, 80 01 Y (80 02 U, 80 03 Z are ignored)
            0x80 => {
                if let Some(p) = mm(d(2)) {
                    match a(1) {
                        0x00 => self.motion(v, [p, self.pos[1]], false, &mut out),
                        0x01 => self.motion(v, [self.pos[0], p], false, &mut out),
                        _ => {}
                    }
                }
            }
            0xA0 => {} // A and U axes
            // ----- power -----
            0xC7 => {
                if let Some(p) = power(d(1)) {
                    self.power = p;
                }
            }
            0xC0..=0xC5 | 0xC8 => {} // laser 2–4 and end power
            0xC6 => match a(1) {
                0x01 | 0x02 => {
                    if let Some(p) = power(d(2)) {
                        // the controller ramps between min (corners) and max; M4 does that in the VM
                        if a(1) == 0x02 || self.power == 0.0 {
                            self.power = p;
                        }
                    }
                }
                0x31 | 0x32 => {
                    if let Some(p) = power(d(3)) {
                        let l = self.layers.entry(a(2)).or_default();
                        if a(1) == 0x31 {
                            l.min_power = Some(p);
                        } else {
                            l.max_power = Some(p);
                        }
                    }
                }
                _ => {}
            },
            // ----- speed -----
            0xC9 => match a(1) {
                0x02 => {
                    if let Some(s) = speed(d(2)) {
                        self.speed = s;
                    }
                }
                0x04 => {
                    if let Some(s) = speed(d(3)) {
                        self.layers.entry(a(2)).or_default().speed = Some(s);
                    }
                }
                _ => {}
            },
            // ----- layer and job settings -----
            0xCA => match a(1) {
                0x01 => match a(2) {
                    0x12 if self.air => {
                        self.air = false;
                        out.push(Action::Line("M9".into()));
                    }
                    0x13 if !self.air => {
                        self.air = true;
                        out.push(Action::Line("M8".into()));
                    }
                    _ => {}
                },
                0x02 => {
                    self.begin_job(v, &mut out);
                    self.apply_layer(a(2));
                }
                _ => {}
            },
            // ----- job control -----
            0xD7 => self.end_job(&mut out),
            0xD8 => match a(1) {
                0x00 => self.begin_job(v, &mut out),
                0x01 => {
                    self.reset();
                    out.push(Action::Stop);
                }
                0x02 => out.push(Action::Realtime(b'!')),
                0x03 => out.push(Action::Realtime(b'~')),
                0x10..=0x12 => {
                    self.begin_job(v, &mut out);
                    self.ref_point = match a(1) {
                        0x10 => RefPoint::Machine,
                        0x11 => RefPoint::Origin,
                        _ => RefPoint::Current,
                    };
                    self.base = None;
                }
                0x2A => {
                    if v.cfg.homing {
                        out.push(Action::Line("$H".into()));
                    }
                    self.rapid_abs(v, [0.0, 0.0], &mut out);
                }
                k @ 0x20..=0x23 => out.push(Action::Line(jog_line(v.cfg, k - 0x20))),
                0x30..=0x33 => out.push(Action::Realtime(0x85)),
                _ => {}
            },
            // ----- moves outside a job (framing, move to position) -----
            0xD9 => {
                let rel = a(2);
                let cur = self.head(v);
                // 0 machine, 1 anchor, 2 current position, 3 set point; anchor/set point = machine origin here
                let resolve = |p: f64, axis: usize| if rel == 2 { cur[axis] + p } else { p };
                match a(1) {
                    0x00 => {
                        if let Some(x) = mm(d(3)) {
                            self.rapid_abs(v, [resolve(x, 0), cur[1]], &mut out);
                        }
                    }
                    0x01 => {
                        if let Some(y) = mm(d(3)) {
                            self.rapid_abs(v, [cur[0], resolve(y, 1)], &mut out);
                        }
                    }
                    0x10 | 0x30 => {
                        if let (Some(x), Some(y)) = (mm(d(3)), mm(d(8))) {
                            self.rapid_abs(v, [resolve(x, 0), resolve(y, 1)], &mut out);
                        }
                    }
                    _ => {}
                }
            }
            // ----- memory -----
            0xDA if a(1) == 0x00 => {
                if let Some(addr) = u14(d(2)) {
                    let mut r = vec![0xDA, 0x01, a(2), a(3)];
                    match self.read_mem(addr, v) {
                        Mem::Value(x) => r.extend(encode_u35(x)),
                        Mem::Text(t) => {
                            r.extend(t.bytes().filter(|b| *b < 0x80));
                            r.push(0);
                        }
                    }
                    out.push(Action::Reply(r));
                }
            }
            // keypad (A5 on the keypad port, A7 on the data port): 50 = press, 51 = release
            0xA5 | 0xA7 => match (a(1), a(2)) {
                (0x50, k @ 0x01..=0x04) => {
                    // 01 X−/left, 02 X+/right, 03 Y+/back, 04 Y−/front
                    out.push(Action::Line(jog_line(v.cfg, k - 1)));
                }
                (0x51, 0x01..=0x04) => out.push(Action::Realtime(0x85)),
                (0x50, 0x06) => {
                    // start/pause key
                    out.push(Action::Realtime(if v.snap.state.starts_with("Hold") {
                        b'~'
                    } else {
                        b'!'
                    }));
                }
                (0x50, 0x09) | (0x50, 0x07) => {
                    self.reset();
                    out.push(Action::Stop);
                }
                (0x50, 0x08) => {
                    self.planned = None;
                    self.rapid_abs(v, [0.0, 0.0], &mut out);
                }
                _ => {}
            },
            // file sums, bounding boxes, file names, element tables, upload bookkeeping, keep-alive:
            // nothing to do for the simulation
            0xCC..=0xCF | 0xD0 | 0xE5..=0xE8 | 0xEA | 0xEB | 0xF0..=0xF2 | 0xDA => {}
            _ => self.unknown += 1,
        }
        out
    }

    fn read_mem(&self, addr: u32, v: &View) -> Mem {
        let pos = from_vm(v.cfg, [v.snap.mpos[0], v.snap.mpos[1]]);
        let um = |mm: f64| (mm * 1000.0).round() as i64 as i32 as u32;
        Mem::Value(match addr {
            mem::CARD_ID => CARD_ID,
            mem::MAINBOARD => return Mem::Text(MAINBOARD),
            mem::BED_X => um(v.cfg.bed_w),
            mem::BED_Y => um(v.cfg.bed_h),
            mem::POS_X => um(pos[0]),
            mem::POS_Y => um(pos[1]),
            mem::POS_Z => um(v.snap.mpos[2]),
            mem::POS_U => 0,
            mem::STATUS => {
                let s = &v.snap.state;
                let mut bits = 0;
                if self.in_job || !v.idle || s == "Run" || s.starts_with("Hold") {
                    bits |= STATUS_JOB_RUNNING;
                }
                if s.starts_with("Hold") {
                    bits |= STATUS_PAUSED;
                }
                if v.snap.feed > 0.0 {
                    bits |= STATUS_MOVING;
                }
                bits
            }
            _ => 0,
        })
    }
}

enum Mem {
    Value(u32),
    Text(&'static str),
}

fn f3(v: f64) -> String {
    let s = format!("{v:.3}");
    if s == "-0.000" {
        "0.000".into()
    } else {
        s
    }
}

/// G-code for one move in Ruida machine coordinates
fn move_line(cfg: &Config, abs: [f64; 2], cut: bool, speed: f64, power: f64) -> String {
    let p = to_vm(cfg, abs);
    if cut {
        let s = (power.clamp(0.0, 100.0) / 100.0 * cfg.s_max).round();
        format!(
            "G53 G1 X{} Y{} F{} S{} M4",
            f3(p[0]),
            f3(p[1]),
            (speed * 60.0).max(1.0).round(),
            s
        )
    } else {
        format!("G53 G0 X{} Y{}", f3(p[0]), f3(p[1]))
    }
}

/// Jog towards the bed edge: 0 left, 1 right, 2 back, 3 front (released key cancels it)
fn jog_line(cfg: &Config, dir: u8) -> String {
    let f = cfg.max_rate.min(6000.0).round();
    match dir {
        0 => format!("$J=G90 G53 X0 F{f}"),
        1 => format!("$J=G90 G53 X{} F{f}", f3(cfg.bed_w)),
        2 => format!("$J=G90 G53 Y{} F{f}", f3(cfg.bed_h)),
        _ => format!("$J=G90 G53 Y0 F{f}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view<'a>(cfg: &'a Config, snap: &'a Snapshot) -> View<'a> {
        View {
            cfg,
            snap,
            idle: true,
        }
    }

    fn lines(acts: &[Action]) -> Vec<String> {
        acts.iter()
            .filter_map(|a| match a {
                Action::Line(l) => Some(l.clone()),
                _ => None,
            })
            .collect()
    }

    fn run(r: &mut Ruida, data: &[u8], v: &View) -> Vec<Action> {
        split_commands(data)
            .into_iter()
            .flat_map(|c| r.command(c, v))
            .collect()
    }

    fn xy(cmd: u8, x: f64, y: f64) -> Vec<u8> {
        let mut v = vec![cmd];
        v.extend(encode_i35((x * 1000.0) as i64));
        v.extend(encode_i35((y * 1000.0) as i64));
        v
    }

    #[test]
    fn swizzle_matches_capture() {
        // a real RDWorks packet "D8 00" (start) with magic 0x88 and its checksum
        let raw = [0x01, 0x5b, 0xd2, 0x89];
        let data = checked_payload(&raw).unwrap();
        assert_eq!(unswizzle(data, 0x88), [0xD8, 0x00]);
        // the controller's scrambled ACK
        assert_eq!(swizzle_byte(ACK, 0x88), 0xC6);
        for m in [0x88u8, 0x11, 0x38] {
            for b in 0..=255u8 {
                assert_eq!(unswizzle_byte(swizzle_byte(b, m), m), b);
            }
        }
        assert_eq!(packet(&[0xD8, 0x00], 0x88), raw);
        assert!(checked_payload(&[0x01, 0x5c, 0xd2, 0x89]).is_none());
    }

    #[test]
    fn magic_is_detected() {
        for m in [0x88u8, 0x11, 0x38] {
            let raw = swizzle(&[0xDA, 0x00, 0x05, 0x7E], m);
            assert_eq!(magic_from_card_query(&raw), Some(m));
            let file = swizzle(&[0x88, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xD7], m);
            assert_eq!(magic_from_histogram(&file), m);
        }
    }

    #[test]
    fn numbers_round_trip() {
        for v in [0i64, 1, 1234, 400_000, -5, -123_456] {
            assert_eq!(i35(&encode_i35(v)), Some(v));
        }
        for v in [0i32, 1, 8191, -1, -8192] {
            assert_eq!(i14(&encode_i14(v)), Some(v));
        }
        assert!((power(&encode_power(50.0)).unwrap() - 50.0).abs() < 0.01);
    }

    #[test]
    fn job_becomes_gcode_in_machine_coordinates() {
        let cfg = Config {
            bed_w: 400.0,
            bed_h: 300.0,
            s_max: 1000.0,
            ..Config::default()
        };
        let snap = Snapshot::default();
        let v = view(&cfg, &snap);
        let mut r = Ruida::new(0x88);
        let mut job = vec![0xD8, 0x10]; // reference: machine origin
        job.extend([0xCA, 0x01, 0x13]); // air on
        job.extend([0xC9, 0x02]);
        job.extend(encode_i35(20_000)); // 20 mm/s
        job.extend([0xC6, 0x02]);
        job.extend(encode_power(40.0));
        job.extend(xy(0x88, 10.0, 20.0));
        job.extend(xy(0xA8, 30.0, 20.0));
        job.push(0xAB);
        job.extend(encode_i14(5000)); // 5 mm to the front
        job.push(0xD7);
        let l = lines(&run(&mut r, &job, &v));
        assert_eq!(
            l,
            [
                "G90 G21 M5 M9",
                "M8",
                // back right origin: X = 400 − 10, Y = 300 − 20
                "G53 G0 X390.000 Y280.000",
                "G53 G1 X370.000 Y280.000 F1200 S400 M4",
                "G53 G1 X370.000 Y275.000 F1200 S400 M4",
                "M5 M9",
            ]
        );
        assert!(!r.in_job());
        assert_eq!(r.unknown, 0);
    }

    #[test]
    fn current_position_reference_and_origin_corner() {
        let cfg = Config {
            bed_w: 400.0,
            bed_h: 300.0,
            ruida_origin: RuidaOrigin::BottomLeft,
            ..Config::default()
        };
        let snap = Snapshot {
            mpos: [100.0, 50.0, 0.0],
            ..Snapshot::default()
        };
        let v = view(&cfg, &snap);
        let mut r = Ruida::new(0x88);
        let mut job = vec![0xD8, 0x12];
        job.extend(xy(0x88, 0.0, 0.0));
        job.extend(xy(0xA8, 10.0, 5.0));
        let l = lines(&run(&mut r, &job, &v));
        assert_eq!(l[1], "G53 G0 X100.000 Y50.000");
        assert!(l[2].starts_with("G53 G1 X110.000 Y55.000"), "{l:?}");
    }

    #[test]
    fn layer_table_sets_speed_and_power() {
        let cfg = Config::default();
        let snap = Snapshot::default();
        let v = view(&cfg, &snap);
        let mut r = Ruida::new(0x88);
        let mut job = vec![0xC9, 0x04, 0x01];
        job.extend(encode_i35(50_000));
        job.extend([0xC6, 0x32, 0x01]);
        job.extend(encode_power(75.0));
        job.extend([0xCA, 0x02, 0x01]);
        job.extend(xy(0xA8, 1.0, 1.0));
        let l = lines(&run(&mut r, &job, &v));
        assert!(l.last().unwrap().ends_with("F3000 S750 M4"), "{l:?}");
    }

    #[test]
    fn status_and_position_replies() {
        let cfg = Config {
            bed_w: 400.0,
            bed_h: 300.0,
            ..Config::default()
        };
        let snap = Snapshot {
            mpos: [390.0, 280.0, 0.0],
            state: "Run".into(),
            feed: 600.0,
            ..Snapshot::default()
        };
        let v = View {
            cfg: &cfg,
            snap: &snap,
            idle: false,
        };
        let mut r = Ruida::new(0x88);
        let ask = |r: &mut Ruida, hi: u8, lo: u8| match r.command(&[0xDA, 0x00, hi, lo], &v).pop() {
            Some(Action::Reply(b)) => b,
            o => panic!("{o:?}"),
        };
        let id = ask(&mut r, 0x05, 0x7E);
        assert_eq!(&id[..4], &[0xDA, 0x01, 0x05, 0x7E]);
        assert_eq!(u35(&id[4..]), Some(CARD_ID as u64));
        let x = ask(&mut r, 0x04, 0x21);
        assert_eq!(i35(&x[4..]), Some(10_000));
        let y = ask(&mut r, 0x04, 0x31);
        assert_eq!(i35(&y[4..]), Some(20_000));
        let st = u35(&ask(&mut r, 0x04, 0x00)[4..]).unwrap() as u32;
        assert_eq!(st, STATUS_JOB_RUNNING | STATUS_MOVING);
        let bed = ask(&mut r, 0x00, 0x26);
        assert_eq!(i35(&bed[4..]), Some(400_000));
    }

    #[test]
    fn keys_jog_and_stop() {
        let cfg = Config::default();
        let snap = Snapshot::default();
        let v = view(&cfg, &snap);
        let mut r = Ruida::new(0x88);
        assert_eq!(
            lines(&r.command(&[0xA5, 0x50, 0x02], &v)),
            ["$J=G90 G53 X400.000 F6000"]
        );
        assert_eq!(r.command(&[0xA5, 0x51, 0x02], &v), [Action::Realtime(0x85)]);
        assert_eq!(
            lines(&r.command(&[0xD8, 0x22], &v)),
            ["$J=G90 G53 Y400.000 F6000"]
        );
        assert_eq!(r.command(&[0xD8, 0x01], &v), [Action::Stop]);
        assert_eq!(r.command(&[0xD8, 0x02], &v), [Action::Realtime(b'!')]);
    }

    /// Check real .rd files without committing them: `RUIDA_RD_FILES=a.rd:b.rd cargo test -- --ignored rd_files`.
    /// Prints a summary per file and fails on commands we do not know or G-code the machine rejects.
    #[test]
    #[ignore]
    fn rd_files_from_env() {
        let files = std::env::var("RUIDA_RD_FILES").unwrap_or_default();
        for f in files.split(':').filter(|f| !f.is_empty()) {
            let raw = std::fs::read(f).unwrap();
            let magic = magic_for_file(&raw);
            let data = unswizzle(&raw, magic);
            let cfg = Config {
                bed_w: 1000.0,
                bed_h: 1000.0,
                max_rate: 60_000.0,
                accel: 10_000.0,
                ..Config::default()
            };
            let mut m = crate::Machine::new(cfg.clone());
            let mut r = Ruida::new(magic);
            let (mut cuts, mut moves) = (0, 0);
            let mut bb = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
            let mut errors = Vec::new();
            let mut dump = String::new();
            for c in split_commands(&data) {
                let snap = m.snapshot();
                let v = View {
                    cfg: &cfg,
                    snap: &snap,
                    idle: m.is_idle(),
                };
                for a in r.command(c, &v) {
                    if let Action::Line(l) = a {
                        dump += &l;
                        dump.push('\n');
                        if l.starts_with("G53 G1") {
                            cuts += 1;
                            let w: Vec<f64> = l
                                .split(' ')
                                .filter_map(|t| t.get(1..)?.parse().ok())
                                .collect();
                            bb = [
                                bb[0].min(w[2]),
                                bb[1].min(w[3]),
                                bb[2].max(w[2]),
                                bb[3].max(w[3]),
                            ];
                        } else if l.starts_with("G53 G0") {
                            moves += 1;
                        }
                        m.input(1, format!("{l}\n").as_bytes());
                        while m.queued_lines(1) > 4 {
                            m.tick(0.01);
                        }
                        for o in m.take_out() {
                            if o.text.starts_with("error") || o.text.starts_with("ALARM") {
                                errors.push(format!("{l} → {}", o.text));
                            }
                        }
                        m.take_segments();
                        m.take_events();
                    }
                }
            }
            println!(
                "{f}: magic 0x{magic:02X}, {} commands, {moves} moves, {cuts} cuts, unknown {}, cut box VM x {:.1}…{:.1} y {:.1}…{:.1}, in job at end: {}",
                split_commands(&data).len(),
                r.unknown,
                bb[0], bb[2], bb[1], bb[3],
                r.in_job()
            );
            if let Ok(dir) = std::env::var("RUIDA_DUMP_DIR") {
                let name = std::path::Path::new(f)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string();
                std::fs::write(format!("{dir}/{name}.gcode"), &dump).unwrap();
            }
            assert!(
                errors.is_empty(),
                "{f}: {:?}",
                &errors[..errors.len().min(5)]
            );
            assert_eq!(r.unknown, 0, "{f}");
        }
    }
}
