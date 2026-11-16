//! Example plugin for KizamuBeam (issue #205): a rectangular plate with a pattern of round or hexagonal holes.
//! Parameters in, parts out, as JSON; see docs/plugins.md.
mod abi;

use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Params {
    pub width: f64,
    pub height: f64,
    pub margin: f64,
    pub hole_dia: f64,
    pub pitch: f64,
    pub pattern: String,
    pub hole_shape: String,
    pub corner: f64,
}

const K: f64 = 0.552_284_749_830_793_4;

fn node(x: f64, y: f64) -> Value {
    json!({ "x": x, "y": y })
}

fn node_c(x: f64, y: f64, cin: (f64, f64), cout: (f64, f64)) -> Value {
    json!({ "x": x, "y": y, "cin": { "x": cin.0, "y": cin.1 }, "cout": { "x": cout.0, "y": cout.1 } })
}

fn circle(cx: f64, cy: f64, r: f64) -> Value {
    let k = r * K;
    json!({ "closed": true, "nodes": [
        node_c(cx + r, cy, (cx + r, cy - k), (cx + r, cy + k)),
        node_c(cx, cy + r, (cx + k, cy + r), (cx - k, cy + r)),
        node_c(cx - r, cy, (cx - r, cy + k), (cx - r, cy - k)),
        node_c(cx, cy - r, (cx - k, cy - r), (cx + k, cy - r)),
    ]})
}

fn hexagon(cx: f64, cy: f64, r: f64) -> Value {
    let nodes: Vec<Value> = (0..6)
        .map(|i| {
            let a = std::f64::consts::PI / 3.0 * i as f64 + std::f64::consts::PI / 6.0;
            node(cx + r * a.cos(), cy + r * a.sin())
        })
        .collect();
    json!({ "closed": true, "nodes": nodes })
}

/// Outline with rounded corners (radius 0 = sharp), centred on the origin
fn outline(w: f64, h: f64, r: f64) -> Value {
    let (x0, y0, x1, y1) = (-w / 2.0, -h / 2.0, w / 2.0, h / 2.0);
    if r <= 0.0 {
        return json!({ "closed": true, "nodes": [node(x0, y0), node(x1, y0), node(x1, y1), node(x0, y1)] });
    }
    let k = r * K;
    json!({ "closed": true, "nodes": [
        node_c(x0 + r, y0, (x0 + r - k, y0), (x0 + r, y0)),
        node_c(x1 - r, y0, (x1 - r, y0), (x1 - r + k, y0)),
        node_c(x1, y0 + r, (x1, y0 + r - k), (x1, y0 + r)),
        node_c(x1, y1 - r, (x1, y1 - r), (x1, y1 - r + k)),
        node_c(x1 - r, y1, (x1 - r + k, y1), (x1 - r, y1)),
        node_c(x0 + r, y1, (x0 + r, y1), (x0 + r - k, y1)),
        node_c(x0, y1 - r, (x0, y1 - r + k), (x0, y1 - r)),
        node_c(x0, y0 + r, (x0, y0 + r), (x0, y0 + r - k)),
    ]})
}

/// Hole centres inside the plate minus the margin
pub fn centres(p: &Params) -> Vec<(f64, f64)> {
    let r = p.hole_dia / 2.0;
    let (ax, ay) = (p.width / 2.0 - p.margin - r, p.height / 2.0 - p.margin - r);
    if ax < 0.0 || ay < 0.0 || p.pitch <= 0.0 {
        return vec![];
    }
    let hex = p.pattern == "hex";
    let dy = if hex { p.pitch * 3f64.sqrt() / 2.0 } else { p.pitch };
    let rows = (2.0 * ay / dy).floor() as i64;
    let mut out = vec![];
    for j in 0..=rows {
        let y = -(rows as f64) * dy / 2.0 + j as f64 * dy;
        let shift = if hex && j % 2 == 1 { p.pitch / 2.0 } else { 0.0 };
        let cols = ((2.0 * ax - shift.abs()) / p.pitch).floor() as i64;
        if cols < 0 {
            continue;
        }
        for i in 0..=cols {
            out.push((-(cols as f64) * p.pitch / 2.0 + i as f64 * p.pitch + shift, y));
        }
    }
    out
}

pub fn validate(p: &Params) -> Vec<Value> {
    let mut out = vec![];
    if p.hole_dia >= p.pitch {
        out.push(json!({ "key": "holeDia", "level": "error", "code": "holes-touch" }));
    }
    if p.corner * 2.0 > p.width.min(p.height) {
        out.push(json!({ "key": "corner", "level": "error", "code": "corner-too-large" }));
    }
    if out.is_empty() && centres(p).is_empty() {
        out.push(json!({ "level": "warn", "code": "no-holes" }));
    }
    let n = centres(p).len();
    if n > 20_000 {
        out.push(json!({ "key": "pitch", "level": "error", "code": "too-many-holes", "values": { "n": n } }));
    }
    out
}

pub fn generate(p: &Params) -> Value {
    let r = p.hole_dia / 2.0;
    let mut subs = vec![outline(p.width, p.height, p.corner)];
    let cs = centres(p);
    for &(x, y) in &cs {
        subs.push(if p.hole_shape == "hex" { hexagon(x, y, r) } else { circle(x, y, r) });
    }
    let open = cs.len() as f64 * if p.hole_shape == "hex" { 3.0 * 3f64.sqrt() / 2.0 * r * r } else { std::f64::consts::PI * r * r };
    let ratio = 100.0 * open / (p.width * p.height);
    json!({
        "parts": [{ "key": "plate", "at": { "x": 0, "y": 0 }, "subs": subs }],
        "info": [["holes", cs.len().to_string()], ["open-area", format!("{ratio:.1} %")]],
    })
}

fn dispatch(name: &str, input: Value) -> Result<Value, String> {
    let p: Params = serde_json::from_value(input).map_err(|_| "bad-input".to_string())?;
    match name {
        "validate" => Ok(Value::Array(validate(&p))),
        "generate" => Ok(generate(&p)),
        _ => Err("plugin-no-function".into()),
    }
}

#[no_mangle]
pub extern "C" fn kzb_call(fn_ptr: u32, fn_len: u32, in_ptr: u32, in_len: u32) -> u64 {
    abi::call(fn_ptr, fn_len, in_ptr, in_len, dispatch)
}
