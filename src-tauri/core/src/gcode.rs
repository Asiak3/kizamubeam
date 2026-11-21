//! G-Code-Zeilen aus der Bewegungsliste schreiben, wie `writeGCode` in `src/gcode.ts`: M4/M3 aus dem Kopf,
//! S je Bewegung, unveränderte Werte (G0/G1, X, Y, S, F) werden weggelassen, Air Assist je Layer.
//! Der Kopf (Kommentare, G21, G90, Laser an) und das Ende kommen fertig aus der Oberfläche.

use crate::raster::js_round;
use serde::Deserialize;

/// Bewegungen als Felder gleicher Länge (wie `Moves` in gcode.ts). f = 0 bedeutet Eilgang.
pub struct Moves<'a> {
    pub x0: f64,
    pub y0: f64,
    pub x: &'a [f64],
    pub y: &'a [f64],
    /// Leistung 0 … 1
    pub s: &'a [f32],
    /// Vorschub mm/min, 0 = Eilgang
    pub f: &'a [f32],
    pub layer: &'a [i16],
    /// Geschätzte Endzeit jeder Bewegung in Sekunden
    pub t: &'a [f64],
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Params {
    pub x0: f64,
    pub y0: f64,
    /// S-Wert für volle Leistung
    pub s_max: f64,
    /// Layer mit Air Assist
    pub air: Vec<i16>,
    pub air_cmd: String,
    pub header: Vec<String>,
    pub footer: Vec<String>,
    /// Geschätzte Gesamtdauer in Sekunden
    pub total: f64,
    /// Buchstabe für die Y-Richtung: Y, bei einer eigenen Drehachse z. B. A (die Bewegungen sind schon umgerechnet)
    #[serde(default = "default_axis")]
    pub y_axis: String,
    /// Zeilen vor einzelnen Bewegungen (Index, Zeilen), z. B. Z-Versatz je Durchgang; aufsteigend nach Index
    #[serde(default)]
    pub inserts: Vec<(usize, Vec<String>)>,
}

fn default_axis() -> String {
    "Y".into()
}

/// Koordinate in 1/1000 mm, gerundet wie `Math.round(v * 1000)`
fn milli(v: f64) -> i64 {
    js_round(v * 1000.0) as i64
}

/// Ganzzahl k / 10^dec als Dezimalzahl ohne Nullen am Ende anhängen; entspricht `String(k / 10^dec)`
/// für Werte, die als k / 10^dec entstanden sind (ohne Umweg über Gleitkomma-Formatierung)
fn push_scaled(out: &mut String, k: i64, dec: u32) {
    if k < 0 {
        out.push('-');
    }
    let p = 10u64.pow(dec);
    let a = k.unsigned_abs();
    push_digits(out, a / p, 1);
    let mut frac = a % p;
    if frac != 0 {
        let mut digits = dec as usize;
        while frac.is_multiple_of(10) {
            frac /= 10;
            digits -= 1;
        }
        out.push('.');
        push_digits(out, frac, digits);
    }
}

/// Ganzzahl mit mindestens `min` Stellen (führende Nullen)
fn push_digits(out: &mut String, mut v: u64, min: usize) {
    let mut buf = [b'0'; 20];
    let mut i = buf.len();
    while v > 0 || buf.len() - i < min {
        i -= 1;
        buf[i] = b'0' + (v % 10) as u8;
        v /= 10;
    }
    out.push_str(std::str::from_utf8(&buf[i..]).unwrap());
}

/// Fertige Zeilen und die geschätzte Zeit (s), zu der jede Zeile fertig ist
pub fn write(mv: &Moves, p: &Params) -> (Vec<String>, Vec<f64>) {
    let n = mv.x.len();
    let mut lines: Vec<String> = Vec::with_capacity(n + p.header.len() + p.footer.len() + 4);
    let mut times: Vec<f64> = Vec::with_capacity(lines.capacity());
    for l in &p.header {
        lines.push(l.clone());
        times.push(0.0);
    }
    // S-Wert: bei kleiner Skala (Smoothieware 0 … 1) mit mehr Nachkommastellen; als Ganzzahl in 10^-s_dec
    let s_dec = if p.s_max > 100.0 { 1 } else { 3 };
    let k = 10f64.powi(s_dec as i32);
    let s_value = |pw: f64| js_round(pw * p.s_max * k) as i64;
    let mut g = -1;
    let (mut cx, mut cy) = (mv.x0, mv.y0);
    let mut cf = -1f32;
    let mut cs = i64::MIN;
    let mut known = false;
    let mut air = false;
    let mut l = String::with_capacity(48);
    let mut zk = 0;
    for i in 0..n {
        let (x, y) = (mv.x[i], mv.y[i]);
        // Eingefügte Zeilen vor der Bewegung; danach G0/G1 wieder ausschreiben.
        // Anstech-Pausen ändern die Spindelleistung (M3 S…): der S-Cache muss
        // verfallen, sonst fehlt das S der folgenden Schnittbewegung.
        while zk < p.inserts.len() && p.inserts[zk].0 == i {
            let mut power_changed = false;
            for z in &p.inserts[zk].1 {
                if z.starts_with("M3 S") || z.starts_with("M3 I S") {
                    power_changed = true;
                }
                lines.push(z.clone());
                times.push(if i > 0 { mv.t[i - 1] } else { 0.0 });
            }
            if power_changed {
                cs = i64::MIN;
            }
            g = -1;
            zk += 1;
        }
        let want_air = p.air.contains(&mv.layer[i]);
        if want_air != air {
            air = want_air;
            lines.push(if air { if p.air_cmd.is_empty() { "M8".into() } else { p.air_cmd.clone() } } else { "M9".into() });
            times.push(if i > 0 { mv.t[i - 1] } else { 0.0 });
        }
        let rapid = mv.f[i] == 0.0;
        let (xs, ys) = (milli(x), milli(y));
        // Bewegungen ohne Ortswechsel (nach Rundung) fallen weg, ohne den modalen Zustand zu verändern
        let (xc, yc) = (milli(cx), milli(cy));
        if known && xs == xc && ys == yc {
            continue;
        }
        l.clear();
        if rapid {
            if g != 0 {
                l.push_str("G0");
            }
            g = 0;
        } else if g != 1 {
            l.push_str("G1");
            g = 1;
        }
        if !known || xs != xc {
            if !l.is_empty() {
                l.push(' ');
            }
            l.push('X');
            push_scaled(&mut l, xs, 3);
        }
        if !known || ys != yc {
            if !l.is_empty() {
                l.push(' ');
            }
            l.push_str(&p.y_axis);
            push_scaled(&mut l, ys, 3);
        }
        known = true;
        if !rapid {
            let s = s_value(mv.s[i] as f64);
            if s != cs {
                l.push_str(" S");
                push_scaled(&mut l, s, s_dec);
            }
            cs = s;
            if mv.f[i] != cf {
                l.push_str(" F");
                push_scaled(&mut l, js_round(mv.f[i] as f64) as i64, 0);
            }
            cf = mv.f[i];
        }
        cx = x;
        cy = y;
        lines.push(l.as_str().into());
        times.push(mv.t[i]);
    }
    if air {
        lines.push("M9".into());
        times.push(p.total);
    }
    for f in &p.footer {
        lines.push(f.clone());
        times.push(p.total);
    }
    (lines, times)
}

/// Bewegungen und Einstellungen aus dem Binärformat der Oberfläche lesen und G-Code schreiben.
///
/// Aufbau (little endian): u32 Anzahl n, u32 Länge der JSON-Einstellungen, JSON, Auffüllung auf 8 Byte,
/// dann x f64[n], y f64[n], t f64[n], f f32[n], s f32[n], layer i16[n].
pub fn write_packed(body: &[u8]) -> Result<(Vec<String>, Vec<f64>), String> {
    let bad = || "Ungültige G-Code-Daten".to_string();
    let u32_at = |i: usize| body.get(i..i + 4).map(|b| u32::from_le_bytes(b.try_into().unwrap()) as usize).ok_or_else(bad);
    let n = u32_at(0)?;
    let jl = u32_at(4)?;
    let p: Params = serde_json::from_slice(body.get(8..8 + jl).ok_or_else(bad)?).map_err(|e| e.to_string())?;
    let mut off = (8 + jl).div_ceil(8) * 8;
    let mut take = |bytes: usize| -> Result<&[u8], String> {
        let s = body.get(off..off + bytes).ok_or_else(bad)?;
        off += bytes;
        Ok(s)
    };
    let f64s = |b: &[u8]| b.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect::<Vec<_>>();
    let f32s = |b: &[u8]| b.chunks_exact(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect::<Vec<_>>();
    let x = f64s(take(8 * n)?);
    let y = f64s(take(8 * n)?);
    let t = f64s(take(8 * n)?);
    let f = f32s(take(4 * n)?);
    let s = f32s(take(4 * n)?);
    let layer: Vec<i16> = take(2 * n)?.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
    Ok(write(&Moves { x0: p.x0, y0: p.y0, x: &x, y: &y, s: &s, f: &f, layer: &layer, t: &t }, &p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spindle_power_reemitted_after_m3_insert() {
        let x = [10.0, 20.0];
        let y = [0.0, 0.0];
        let s = [0.5f32, 0.5];
        let f = [1000.0f32, 1000.0];
        let layer = [1i16, 1];
        let t = [0.1, 0.2];
        let mv = Moves { x0: 0.0, y0: 0.0, x: &x, y: &y, s: &s, f: &f, layer: &layer, t: &t };
        let p = Params {
            x0: 0.0, y0: 0.0, s_max: 1000.0, air: vec![], air_cmd: "M8".into(),
            header: vec![], footer: vec![], total: 0.0, y_axis: "Y".into(),
            inserts: vec![(1, vec!["M3 S800".into(), "G4 P0.2".into()])],
        };
        let (lines, _) = write(&mv, &p);
        let joined = lines.join("\n");
        let pos = joined.find("M3 S800").expect("insert present");
        let after = &joined[pos + "M3 S800".len()..];
        assert!(after.contains("S500"), "S nach M3-Insert erneut emittieren, got:\n{joined}");
    }
}
