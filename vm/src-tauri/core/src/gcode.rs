//! Split G-code lines and check them by the rules of GRBL 1.1 (modal groups, repeated words,
//! unsupported commands). The error numbers are GRBL's, so programs get the same
//! messages as from a real controller.

/// GRBL error numbers (selection)
pub mod err {
    pub const EXPECTED_COMMAND_LETTER: u8 = 1;
    pub const BAD_NUMBER_FORMAT: u8 = 2;
    pub const INVALID_STATEMENT: u8 = 3;
    pub const NEGATIVE_VALUE: u8 = 4;
    pub const SETTING_DISABLED: u8 = 5;
    pub const IDLE_ERROR: u8 = 8;
    pub const SYSTEM_GC_LOCK: u8 = 9;
    pub const SOFT_LIMIT_ERROR: u8 = 10;
    pub const OVERFLOW: u8 = 11;
    pub const TRAVEL_EXCEEDED: u8 = 15;
    pub const INVALID_JOG_COMMAND: u8 = 16;
    pub const UNSUPPORTED_COMMAND: u8 = 20;
    pub const MODAL_GROUP_VIOLATION: u8 = 21;
    pub const UNDEFINED_FEED_RATE: u8 = 22;
    pub const COMMAND_VALUE_NOT_INTEGER: u8 = 23;
    pub const AXIS_COMMAND_CONFLICT: u8 = 24;
    pub const WORD_REPEATED: u8 = 25;
    pub const NO_AXIS_WORDS: u8 = 26;
    pub const INVALID_TARGET: u8 = 33;
    pub const ARC_RADIUS_ERROR: u8 = 34;
    pub const NO_OFFSETS_IN_PLANE: u8 = 35;
    pub const UNUSED_WORDS: u8 = 36;
    pub const VALUE_WORD_MISSING: u8 = 28;
    pub const MAX_VALUE_EXCEEDED: u8 = 38;
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Word {
    pub letter: char,
    pub value: f64,
}

/// Remove comments ( … ) and ;, strip spaces, upper case.
pub fn clean(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut paren = false;
    for c in line.chars() {
        match c {
            '(' => paren = true,
            ')' if paren => paren = false,
            ';' if !paren => break,
            _ if paren => {}
            c if c.is_whitespace() => {}
            '%' => {}
            c => out.push(c.to_ascii_uppercase()),
        }
    }
    out
}

/// Split a line (without comments) into words
pub fn words(line: &str) -> Result<Vec<Word>, u8> {
    let b = line.as_bytes();
    let mut i = 0;
    let mut out = Vec::new();
    while i < b.len() {
        let letter = b[i] as char;
        if !letter.is_ascii_uppercase() {
            return Err(err::EXPECTED_COMMAND_LETTER);
        }
        i += 1;
        let start = i;
        if i < b.len() && (b[i] == b'-' || b[i] == b'+') {
            i += 1;
        }
        let mut digits = 0;
        let mut dot = false;
        while i < b.len() && (b[i].is_ascii_digit() || (b[i] == b'.' && !dot)) {
            if b[i] == b'.' {
                dot = true;
            } else {
                digits += 1;
            }
            i += 1;
        }
        if digits == 0 {
            return Err(err::BAD_NUMBER_FORMAT);
        }
        let value: f64 = line[start..i].parse().map_err(|_| err::BAD_NUMBER_FORMAT)?;
        out.push(Word { letter, value });
    }
    Ok(out)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Motion {
    Rapid,
    Linear,
    ArcCw,
    ArcCcw,
    /// G80: no motion
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NonModal {
    Dwell,
    /// G10 L2 / L20
    SetOffset,
    /// G28 / G30
    GoPredef(usize),
    /// G28.1 / G30.1
    SetPredef(usize),
    /// G92
    SetG92,
    /// G92.1
    ResetG92,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Spindle {
    Off,
    /// M3: constant power
    Cw,
    /// M4: in laser mode, power follows the speed
    Ccw,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProgramFlow {
    Pause,
    End,
}

/// A checked line
#[derive(Clone, Debug, Default)]
pub struct Block {
    pub motion: Option<Motion>,
    pub non_modal: Option<NonModal>,
    pub g53: bool,
    /// Some(true) = G90 absolute, Some(false) = G91 relative
    pub absolute: Option<bool>,
    /// Some(true) = G20 inches
    pub inches: Option<bool>,
    /// G54 … G59 → 0 … 5
    pub wcs: Option<usize>,
    pub spindle: Option<Spindle>,
    /// M7 / M8 / M9
    pub mist: Option<bool>,
    pub flood: Option<bool>,
    pub coolant_off: bool,
    pub flow: Option<ProgramFlow>,
    /// M62–M65: (number, on, synchronized)
    pub output: Option<(u32, bool, bool)>,
    pub axes: [Option<f64>; 3],
    pub ijk: [Option<f64>; 3],
    pub r: Option<f64>,
    pub f: Option<f64>,
    pub s: Option<f64>,
    pub p: Option<f64>,
    pub l: Option<f64>,
    pub inverse_time: bool,
}

fn int_code(v: f64) -> Result<(u32, u32), u8> {
    // integer and one decimal (G28.1, G92.1, G38.2)
    let x = (v * 10.0).round();
    if (v * 10.0 - x).abs() > 1e-6 {
        return Err(err::COMMAND_VALUE_NOT_INTEGER);
    }
    let x = x as i64;
    if x < 0 {
        return Err(err::NEGATIVE_VALUE);
    }
    Ok(((x / 10) as u32, (x % 10) as u32))
}

impl Block {
    pub fn has_axes(&self) -> bool {
        self.axes.iter().any(|a| a.is_some())
    }
}

/// Sort a line's words into modal groups and check them. A/B/C (rotary) count as
/// unsupported, as on a three-axis machine.
pub fn parse_block(words: &[Word]) -> Result<Block, u8> {
    let mut b = Block::default();
    let mut groups: u32 = 0;
    let mut seen: u32 = 0;
    let mut group = |n: u32| -> Result<(), u8> {
        if groups & (1 << n) != 0 {
            return Err(err::MODAL_GROUP_VIOLATION);
        }
        groups |= 1 << n;
        Ok(())
    };
    for w in words {
        match w.letter {
            'G' => {
                let (n, frac) = int_code(w.value)?;
                match (n, frac) {
                    (0, 0) | (1, 0) | (2, 0) | (3, 0) | (80, 0) => {
                        group(1)?;
                        b.motion = Some(match n {
                            0 => Motion::Rapid,
                            1 => Motion::Linear,
                            2 => Motion::ArcCw,
                            3 => Motion::ArcCcw,
                            _ => Motion::None,
                        });
                    }
                    (4, 0)
                    | (10, 0)
                    | (28, 0)
                    | (30, 0)
                    | (28, 1)
                    | (30, 1)
                    | (92, 0)
                    | (92, 1)
                    | (53, 0) => {
                        group(0)?;
                        if n == 53 {
                            b.g53 = true;
                        } else {
                            b.non_modal = Some(match (n, frac) {
                                (4, _) => NonModal::Dwell,
                                (10, _) => NonModal::SetOffset,
                                (28, 0) => NonModal::GoPredef(0),
                                (30, 0) => NonModal::GoPredef(1),
                                (28, 1) => NonModal::SetPredef(0),
                                (30, 1) => NonModal::SetPredef(1),
                                (92, 0) => NonModal::SetG92,
                                _ => NonModal::ResetG92,
                            });
                        }
                    }
                    (17, 0) => group(2)?,
                    (18, 0) | (19, 0) => return Err(err::UNSUPPORTED_COMMAND),
                    (90, 0) | (91, 0) => {
                        group(3)?;
                        b.absolute = Some(n == 90);
                    }
                    (91, 1) => group(4)?,
                    (93, 0) | (94, 0) => {
                        group(5)?;
                        b.inverse_time = n == 93;
                    }
                    (20, 0) | (21, 0) => {
                        group(6)?;
                        b.inches = Some(n == 20);
                    }
                    (40, 0) => group(7)?,
                    (49, 0) => group(8)?,
                    (54..=59, 0) => {
                        group(9)?;
                        b.wcs = Some((n - 54) as usize);
                    }
                    (61, 0) => group(10)?,
                    _ => return Err(err::UNSUPPORTED_COMMAND),
                }
            }
            'M' => {
                let (n, frac) = int_code(w.value)?;
                if frac != 0 {
                    return Err(err::UNSUPPORTED_COMMAND);
                }
                match n {
                    0 | 1 => {
                        group(11)?;
                        b.flow = Some(ProgramFlow::Pause);
                    }
                    2 | 30 => {
                        group(11)?;
                        b.flow = Some(ProgramFlow::End);
                    }
                    3..=5 => {
                        group(12)?;
                        b.spindle = Some(match n {
                            3 => Spindle::Cw,
                            4 => Spindle::Ccw,
                            _ => Spindle::Off,
                        });
                    }
                    // M7 and M8 may appear together
                    7 => b.mist = Some(true),
                    8 => b.flood = Some(true),
                    9 => {
                        group(13)?;
                        b.coolant_off = true;
                    }
                    62..=65 => {
                        group(14)?;
                        b.output = Some((0, n == 62 || n == 64, n >= 64));
                    }
                    56 => {}
                    _ => return Err(err::UNSUPPORTED_COMMAND),
                }
            }
            c => {
                let bit = match c {
                    'X' => 0,
                    'Y' => 1,
                    'Z' => 2,
                    'I' => 3,
                    'J' => 4,
                    'K' => 5,
                    'R' => 6,
                    'F' => 7,
                    'S' => 8,
                    'P' => 9,
                    'L' => 10,
                    'N' => 11,
                    'T' => 12,
                    _ => return Err(err::UNSUPPORTED_COMMAND),
                };
                if seen & (1 << bit) != 0 {
                    return Err(err::WORD_REPEATED);
                }
                seen |= 1 << bit;
                let v = w.value;
                match c {
                    'X' => b.axes[0] = Some(v),
                    'Y' => b.axes[1] = Some(v),
                    'Z' => b.axes[2] = Some(v),
                    'I' => b.ijk[0] = Some(v),
                    'J' => b.ijk[1] = Some(v),
                    'K' => b.ijk[2] = Some(v),
                    'R' => b.r = Some(v),
                    'F' => {
                        if v < 0.0 {
                            return Err(err::NEGATIVE_VALUE);
                        }
                        b.f = Some(v)
                    }
                    'S' => {
                        if v < 0.0 {
                            return Err(err::NEGATIVE_VALUE);
                        }
                        b.s = Some(v)
                    }
                    'P' => b.p = Some(v),
                    'L' => b.l = Some(v),
                    _ => {}
                }
            }
        }
    }
    // M62–M65 need P (output number)
    if let Some((_, on, sync)) = b.output {
        let p = b.p.ok_or(err::VALUE_WORD_MISSING)?;
        if p < 0.0 || p.fract() != 0.0 {
            return Err(err::COMMAND_VALUE_NOT_INTEGER);
        }
        b.output = Some((p as u32, on, sync));
    }
    if b.inverse_time {
        return Err(err::UNSUPPORTED_COMMAND);
    }
    // axes with G10/G28/G30/G92 belong to the non-modal command; together with G0–G3 → conflict
    if matches!(
        b.non_modal,
        Some(NonModal::SetOffset | NonModal::GoPredef(_) | NonModal::SetG92)
    ) && matches!(
        b.motion,
        Some(Motion::Rapid | Motion::Linear | Motion::ArcCw | Motion::ArcCcw)
    ) && b.has_axes()
    {
        return Err(err::AXIS_COMMAND_CONFLICT);
    }
    Ok(b)
}

/// Split an arc into short lines like GRBL (mc_arc): chord error at most `tol`.
/// Returns the intermediate points and the end point in the XY plane (Z interpolated linearly).
pub fn arc_points(
    start: [f64; 3],
    end: [f64; 3],
    center: [f64; 2],
    cw: bool,
    tol: f64,
) -> Vec<[f64; 3]> {
    let r0 = [start[0] - center[0], start[1] - center[1]];
    let r1 = [end[0] - center[0], end[1] - center[1]];
    let radius = r0[0].hypot(r0[1]);
    let mut angle = (r0[0] * r1[1] - r0[1] * r1[0]).atan2(r0[0] * r1[0] + r0[1] * r1[1]);
    const EPS: f64 = 5e-7;
    if cw {
        if angle >= -EPS {
            angle -= 2.0 * std::f64::consts::PI;
        }
    } else if angle <= EPS {
        angle += 2.0 * std::f64::consts::PI;
    }
    let mm = (angle * radius).abs();
    let seg_len = (tol * (2.0 * radius - tol)).max(0.0).sqrt() * 2.0;
    let n = if seg_len > 0.0 {
        ((mm / seg_len).floor() as usize).max(1)
    } else {
        1
    };
    let n = n.min(100_000);
    let a0 = r0[1].atan2(r0[0]);
    let mut out = Vec::with_capacity(n);
    for i in 1..n {
        let a = a0 + angle * i as f64 / n as f64;
        let z = start[2] + (end[2] - start[2]) * i as f64 / n as f64;
        out.push([
            center[0] + radius * a.cos(),
            center[1] + radius * a.sin(),
            z,
        ]);
    }
    out.push(end);
    out
}

/// Center from the R form (GRBL: negative R = large arc)
pub fn center_from_radius(
    start: [f64; 3],
    end: [f64; 3],
    r: f64,
    cw: bool,
) -> Result<[f64; 2], u8> {
    let x = end[0] - start[0];
    let y = end[1] - start[1];
    let d2 = x * x + y * y;
    if d2 == 0.0 {
        return Err(err::INVALID_TARGET);
    }
    let mut h = 4.0 * r * r - d2;
    if h < 0.0 {
        // GRBL tolerates small rounding errors
        if h < -0.5e-3 * 4.0 * r * r {
            return Err(err::ARC_RADIUS_ERROR);
        }
        h = 0.0;
    }
    let mut h_x2_div_d = -h.sqrt() / d2.sqrt();
    if !cw {
        h_x2_div_d = -h_x2_div_d;
    }
    if r < 0.0 {
        h_x2_div_d = -h_x2_div_d;
    }
    let i = 0.5 * (x - y * h_x2_div_d);
    let j = 0.5 * (y + x * h_x2_div_d);
    Ok([start[0] + i, start[1] + j])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_comments_and_spaces() {
        assert_eq!(clean("g1 x10 (Rand) y5 ; Kommentar"), "G1X10Y5");
        assert_eq!(clean("%"), "");
    }

    #[test]
    fn parses_words_and_errors() {
        let w = words("G1X-1.5Y.5F3000").unwrap();
        assert_eq!(w.len(), 4);
        assert_eq!(
            w[1],
            Word {
                letter: 'X',
                value: -1.5
            }
        );
        assert_eq!(w[2].value, 0.5);
        assert_eq!(words("G1X"), Err(err::BAD_NUMBER_FORMAT));
        assert_eq!(words("1X"), Err(err::EXPECTED_COMMAND_LETTER));
    }

    #[test]
    fn modal_groups() {
        assert_eq!(
            parse_block(&words("G0G1X1").unwrap()).unwrap_err(),
            err::MODAL_GROUP_VIOLATION
        );
        assert_eq!(
            parse_block(&words("G1X1X2").unwrap()).unwrap_err(),
            err::WORD_REPEATED
        );
        assert_eq!(
            parse_block(&words("G38.2X1").unwrap()).unwrap_err(),
            err::UNSUPPORTED_COMMAND
        );
        assert_eq!(
            parse_block(&words("G1A5").unwrap()).unwrap_err(),
            err::UNSUPPORTED_COMMAND
        );
        let b = parse_block(&words("G90G21M4S500G1X10F1000").unwrap()).unwrap();
        assert_eq!(b.motion, Some(Motion::Linear));
        assert_eq!(b.spindle, Some(Spindle::Ccw));
        assert_eq!(b.s, Some(500.0));
        let b = parse_block(&words("M64P2").unwrap()).unwrap();
        assert_eq!(b.output, Some((2, true, true)));
        assert!(
            parse_block(&words("G28.1").unwrap()).unwrap().non_modal
                == Some(NonModal::SetPredef(0))
        );
    }

    #[test]
    fn arc_ends_exactly_and_respects_tolerance() {
        let pts = arc_points([10.0, 0.0, 0.0], [0.0, 10.0, 0.0], [0.0, 0.0], false, 0.002);
        assert_eq!(*pts.last().unwrap(), [0.0, 10.0, 0.0]);
        for p in &pts {
            assert!((p[0].hypot(p[1]) - 10.0).abs() < 1e-9);
        }
        // quarter circle r=10: length 15.7 mm, chords ≈ 0.4 mm
        assert!(pts.len() > 30 && pts.len() < 50, "{}", pts.len());
        // full circle when start = end
        let full = arc_points([10.0, 0.0, 0.0], [10.0, 0.0, 0.0], [0.0, 0.0], true, 0.002);
        assert!(full.len() > 120);
    }

    #[test]
    fn radius_form() {
        let c = center_from_radius([0.0, 0.0, 0.0], [10.0, 0.0, 0.0], 5.0, true).unwrap();
        assert!((c[0] - 5.0).abs() < 1e-9 && c[1].abs() < 1e-9);
        assert_eq!(
            center_from_radius([0.0, 0.0, 0.0], [10.0, 0.0, 0.0], 2.0, true),
            Err(err::ARC_RADIUS_ERROR)
        );
    }
}
