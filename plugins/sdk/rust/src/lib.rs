//! SDK for KizamuBeam plugins in Rust (issue #205). A plugin is a `cdylib` built for `wasm32-unknown-unknown`
//! with no imports. It gets parameters as JSON and returns issues or geometry as JSON; see docs/plugins.md.
//!
//! ```ignore
//! use kzb_plugin::{export_plugin, geom, Issue, Part, Plugin, GenResult};
//! #[derive(serde::Deserialize)]
//! struct Params { width: f64, height: f64 }
//! struct Plate;
//! impl Plugin for Plate {
//!     type Params = Params;
//!     fn validate(p: &Params) -> Vec<Issue> { vec![] }
//!     fn generate(p: &Params) -> Result<GenResult, String> {
//!         Ok(GenResult::new().part(Part::new("plate", vec![geom::rect(p.width, p.height)])))
//!     }
//! }
//! export_plugin!(Plate);
//! ```
pub mod abi;
pub mod geom;

use serde::Serialize;
use serde_json::Value;

/// Version of the call protocol this SDK implements (PLUGIN_API in the app)
pub const API: i32 = 1;

/// A point in mm, y pointing down
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Pt {
    pub x: f64,
    pub y: f64,
}

/// A path node; `cin`/`cout` are the Bézier handles before and after it (absolute coordinates)
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Node {
    pub x: f64,
    pub y: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cin: Option<Pt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cout: Option<Pt>,
}

impl Node {
    pub fn new(x: f64, y: f64) -> Self {
        Node { x, y, cin: None, cout: None }
    }
    pub fn curve(x: f64, y: f64, cin: (f64, f64), cout: (f64, f64)) -> Self {
        Node { x, y, cin: Some(Pt { x: cin.0, y: cin.1 }), cout: Some(Pt { x: cout.0, y: cout.1 }) }
    }
}

/// One outline: closed for parts and holes
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SubPath {
    pub nodes: Vec<Node>,
    pub closed: bool,
}

/// A generated part: outline and holes in local coordinates (centre at the origin), suggested position `at`
#[derive(Clone, Debug, Serialize)]
pub struct Part {
    pub key: String,
    pub subs: Vec<SubPath>,
    pub at: Pt,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<SubPath>,
}

impl Part {
    pub fn new(key: &str, subs: Vec<SubPath>) -> Self {
        Part { key: key.into(), subs, at: Pt { x: 0.0, y: 0.0 }, marks: vec![] }
    }
    pub fn at(mut self, x: f64, y: f64) -> Self {
        self.at = Pt { x, y };
        self
    }
    /// Engraving on the part (e.g. a part number), same coordinates as `subs`
    pub fn marks(mut self, marks: Vec<SubPath>) -> Self {
        self.marks = marks;
        self
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Error,
    Warn,
}

/// A problem with the parameters. `code` is a text key of the plugin's manifest; `values` fill its placeholders.
#[derive(Clone, Debug, Serialize)]
pub struct Issue {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub level: Level,
    pub code: String,
    #[serde(skip_serializing_if = "serde_json::Map::is_empty")]
    pub values: serde_json::Map<String, Value>,
}

impl Issue {
    pub fn error(code: &str) -> Self {
        Issue { key: None, level: Level::Error, code: code.into(), values: Default::default() }
    }
    pub fn warn(code: &str) -> Self {
        Issue { key: None, level: Level::Warn, code: code.into(), values: Default::default() }
    }
    /// The parameter the problem belongs to (highlighted in the dialog)
    pub fn on(mut self, key: &str) -> Self {
        self.key = Some(key.into());
        self
    }
    pub fn value(mut self, name: &str, v: impl Into<Value>) -> Self {
        self.values.insert(name.into(), v.into());
        self
    }
}

/// Answer of `generate`: parts, rows for the info table (`[text code, value]`) and optionally the name in the
/// Objects window. A text is plain (`json!("…")`) or a code with values (`json!({ "code": "label", "values": { … } })`).
#[derive(Clone, Debug, Default, Serialize)]
pub struct GenResult {
    pub parts: Vec<Part>,
    pub info: Vec<(String, String)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<Value>,
    #[serde(skip_serializing_if = "serde_json::Map::is_empty")]
    pub labels: serde_json::Map<String, Value>,
}

impl GenResult {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn part(mut self, p: Part) -> Self {
        self.parts.push(p);
        self
    }
    pub fn info(mut self, code: &str, value: impl ToString) -> Self {
        self.info.push((code.into(), value.to_string()));
        self
    }
    /// Name in the Objects window for these parameters (instead of the manifest text `label`)
    pub fn label(mut self, text: impl Into<Value>) -> Self {
        self.label = Some(text.into());
        self
    }
    /// Name of one part of an assembly in the Objects window
    pub fn part_label(mut self, key: &str, text: impl Into<Value>) -> Self {
        self.labels.insert(key.into(), text.into());
        self
    }
}

/// Bytes of an image input (`{ "width", "height", "data": base64 }`), row by row: RGBA (4 per pixel) for
/// action inputs, one gray byte per pixel for an image filter
pub fn pixels(image: &Value) -> Option<Vec<u8>> {
    let s = image.get("data")?.as_str()?.trim_end_matches('=');
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    for chunk in s.as_bytes().chunks(4) {
        let mut v = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            v |= val(c)? << (18 - 6 * i);
        }
        out.push((v >> 16) as u8);
        if chunk.len() > 2 {
            out.push((v >> 8) as u8);
        }
        if chunk.len() > 3 {
            out.push(v as u8);
        }
    }
    Some(out)
}

/// A 3D model handed to `resource` (`kzm1:` + base64): positions (x, y, z per vertex, mm) and triangles
pub fn mesh(data: &str) -> Option<(Vec<f32>, Vec<u32>)> {
    let b = pixels(&serde_json::json!({ "data": data.strip_prefix("kzm1:")? }))?;
    let u32_at = |o: usize| u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]);
    if b.len() < 8 {
        return None;
    }
    let (nv, nt) = (u32_at(0) as usize, u32_at(4) as usize);
    if 8 + nv * 12 + nt * 12 != b.len() {
        return None;
    }
    let pos = (0..nv * 3).map(|i| f32::from_bits(u32_at(8 + i * 4))).collect();
    let tri = (0..nt * 3).map(|i| u32_at(8 + nv * 12 + i * 4)).collect();
    Some((pos, tri))
}

/// Call a host function of the app (#211): `"boolean"` (`{ "op": "union" | "difference" | "intersection" | "xor",
/// "a": [sub-paths], "b": [sub-paths] }`), `"offset"` (`{ "subs", "delta", "join"? }`), `"fit"` (`{ "pts": [[x, y], …],
/// "closed"?, "tolerance"? }`) or `"trace"` (`{ "width", "height", "data": gray bytes as base64, "threshold"?,
/// "smooth"?, "ignoreLess"?, "scale"? }`), `"slice"` (`{ "model": resource id, "up"?, "size"?, "frame"?, "heights",
/// "gap"? }`: cross-sections of a 3D model) or `"region"` (`{ "op", … }`: operations on areas). See docs/plugins.md
/// for the details. The manifest must list it under `"host"`. `Err(code)` on failure, e.g.
/// `host-not-allowed` or `host-bad-input`.
pub fn host(name: &str, input: &Value) -> Result<Value, String> {
    let bytes = serde_json::to_vec(input).map_err(|_| "host-bad-input".to_string())?;
    let env: Value = serde_json::from_slice(&abi::host_raw(name, &bytes)).map_err(|_| "host-failed".to_string())?;
    match env.get("error").and_then(Value::as_str) {
        Some(code) => Err(code.to_string()),
        None => Ok(env.get("ok").cloned().unwrap_or(Value::Null)),
    }
}

/// Report progress of a long computation (0 … 1); the dialog shows it next to „being computed“
pub fn progress(done: f64) {
    let _ = host("progress", &serde_json::json!(done));
}

/// Base64 of bytes, e.g. the `data` of the image an image filter returns (one gray byte per pixel)
pub fn base64(b: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(ABC[(n >> 18) as usize] as char);
        out.push(ABC[(n >> 12 & 63) as usize] as char);
        out.push(if c.len() > 1 { ABC[(n >> 6 & 63) as usize] as char } else { '=' });
        out.push(if c.len() > 2 { ABC[(n & 63) as usize] as char } else { '=' });
    }
    out
}

/// A plugin: a generator (`validate` runs first; `generate` only when it reported no error), or a path tool or
/// image filter (`apply`; "type" in plugin.json)
pub trait Plugin {
    type Params: serde::de::DeserializeOwned;
    fn validate(_p: &Self::Params) -> Vec<Issue> {
        vec![]
    }
    /// An `Err(code)` is shown as an error with the text of that code. Tools do not need it.
    fn generate(_p: &Self::Params) -> Result<GenResult, String> {
        Err("plugin-no-function".into())
    }
    /// Path tools and image filters (#205 stage 3): `input` is `{ "objects": [{ "id", "subs" }] }` (the selection
    /// as paths in mm, texts as outlines) or `{ "image": { "width", "height", "data" } }` (grayscale, one byte per
    /// pixel, see [`pixels`]). Answer `json!({ "objects": [{ "from": id, "subs": [ … ] }], "info": [ … ] })` or
    /// `json!({ "image": { "width", "height", "data": base64(&bytes) } })`, with optional `"issues"`. `None` (the
    /// default) means the plugin is no tool.
    fn apply(_input: &Value, _p: &Self::Params) -> Option<Value> {
        None
    }
    /// Optional: suggestions for empty text fields and texts for the rows of a list,
    /// `json!({ "autoText": { "key": "…" }, "rows": { "listParam": ["…", …] } })`
    fn view(_p: &Self::Params) -> Option<Value> {
        None
    }
    /// Optional: the user committed field `key` (previous value `old`); answer `json!({ "patch": { … } })` or
    /// `json!({ "ask": { "question": …, "options": [{ "label": …, "patch": { … } }] } })`, `Some(Value::Null)` for
    /// nothing to do. `None` (the default) tells the app the plugin has no onChange.
    fn on_change(_key: &str, _old: &Value, _p: &Self::Params) -> Option<Value> {
        None
    }
    /// Optional: button `action` of the manifest's `dialog.actions` was pressed; `inputs` holds what it declares
    /// (`{ "selection": [{ "name": …, "polys": [[{ "x": …, "y": … }, …], …] }] }`; `image` and `camera` are
    /// `{ "width", "height", "data" }` with RGBA pixels as base64, see [`pixels`]). Answer
    /// `json!({ "patch": { … }, "message": … })` or `Some(Value::Null)`; `None` (the default) means no onEvent.
    fn on_event(_action: &str, _inputs: &Value, _p: &Self::Params) -> Option<Value> {
        None
    }
    /// Optional: like [`Plugin::on_event`] with the context of the click: `ctx` holds `row` (a button of a list
    /// row) and `surface` (`{ "view", "state", "selected" }` when the dialog has a drawing surface). An answer may
    /// also carry `"state"`, `"view"` and `"select"` for the surface. The default calls `on_event`.
    fn on_event_with(action: &str, inputs: &Value, _ctx: &Value, p: &Self::Params) -> Option<Value> {
        Self::on_event(action, inputs, p)
    }
    /// Optional: what the drawing surface shows (`dialog.surface`, dialog version 3). `req` is
    /// `{ "view", "state", "selected", "have" }`; answer `json!({ "frame": { "x0", "y0", "x1", "y1" }, "items": [ … ],
    /// "layers": [ … ] })`. `None` (the default) means no surface.
    fn draw(_req: &Value, _p: &Self::Params) -> Option<Value> {
        None
    }
    /// Optional: a pointer or key event on the surface (`{ "type", "x", "y", "hit", "from", "drag", "key" }`, or
    /// `"select"` with `list` and `row`); `surface` is `{ "view", "state", "selected" }`. Answer like `on_event`.
    fn on_surface(_event: &Value, _surface: &Value, _p: &Self::Params) -> Option<Value> {
        None
    }
    /// Optional: a dialog with this plugin opened (a session, #211): a place to do expensive work once, e.g.
    /// prepare an input, and keep it for the following calls. Return `Some(Value::Null)`.
    fn open(_p: &Self::Params) -> Option<Value> {
        None
    }
    /// Optional: the dialog closed; drop what `open` kept.
    fn close() -> Option<Value> {
        None
    }
    /// Optional: data a parameter with `"resource"` names (`kind` "model3d": a 3D model, see [`mesh`]). Called
    /// once before the first call that needs it and again after a restart; keep it by `id` (e.g. in a
    /// `thread_local!`). Return `false` for data the plugin cannot read. The default means no resources.
    fn resource(_kind: &str, _id: &str, _data: &str) -> Option<bool> {
        None
    }
}

/// Call a plugin function by name with JSON input (used by `export_plugin!`, also handy in tests)
pub fn dispatch<P: Plugin>(name: &str, input: Value) -> Result<Value, String> {
    let params = |v: Value| serde_json::from_value::<P::Params>(v).map_err(|_| "bad-input".to_string());
    let json = |v: serde_json::Result<Value>| v.map_err(|_| "plugin-bad-output".to_string());
    let missing = || "plugin-no-function".to_string();
    match name {
        "validate" => json(serde_json::to_value(P::validate(&params(input)?))),
        "generate" => P::generate(&params(input)?).and_then(|r| json(serde_json::to_value(r))),
        "view" => P::view(&params(input)?).ok_or_else(missing),
        "onChange" => {
            let key = input.get("key").and_then(Value::as_str).ok_or("bad-input")?.to_string();
            let old = input.get("old").cloned().unwrap_or(Value::Null);
            let p = params(input.get("params").cloned().unwrap_or(Value::Null))?;
            P::on_change(&key, &old, &p).ok_or_else(missing)
        }
        "resource" => {
            let get = |k: &str| input.get(k).and_then(Value::as_str).ok_or("bad-input");
            match P::resource(get("kind")?, get("id")?, get("data")?) {
                None => Err(missing()),
                Some(true) => Ok(Value::Null),
                Some(false) => Err("bad-resource".into()),
            }
        }
        "onEvent" => {
            let action = input.get("action").and_then(Value::as_str).ok_or("bad-input")?.to_string();
            let inputs = input.get("inputs").cloned().unwrap_or(Value::Null);
            let ctx = serde_json::json!({ "row": input.get("row").cloned().unwrap_or(Value::Null), "surface": input.get("surface").cloned().unwrap_or(Value::Null) });
            let p = params(input.get("params").cloned().unwrap_or(Value::Null))?;
            P::on_event_with(&action, &inputs, &ctx, &p).ok_or_else(missing)
        }
        "open" => {
            let p = params(input)?;
            P::open(&p).ok_or_else(missing)
        }
        "close" => P::close().ok_or_else(missing),
        "apply" => {
            let p = params(input.get("params").cloned().unwrap_or(Value::Null))?;
            P::apply(&input, &p).ok_or_else(missing)
        }
        "draw" => {
            let p = params(input.get("params").cloned().unwrap_or(Value::Null))?;
            P::draw(&input, &p).ok_or_else(missing)
        }
        "onSurface" => {
            let event = input.get("event").cloned().unwrap_or(Value::Null);
            let surface = input.get("surface").cloned().unwrap_or(Value::Null);
            let p = params(input.get("params").cloned().unwrap_or(Value::Null))?;
            P::on_surface(&event, &surface, &p).ok_or_else(missing)
        }
        _ => Err(missing()),
    }
}

/// Export the WebAssembly functions the app calls (`kzb_api`, `kzb_alloc`, `kzb_call`) for a `Plugin`
#[macro_export]
macro_rules! export_plugin {
    ($plugin:ty) => {
        #[no_mangle]
        pub extern "C" fn kzb_api() -> i32 {
            $crate::API
        }
        #[no_mangle]
        pub extern "C" fn kzb_alloc(len: u32) -> u32 {
            $crate::abi::alloc(len)
        }
        #[no_mangle]
        pub extern "C" fn kzb_call(fn_ptr: u32, fn_len: u32, in_ptr: u32, in_len: u32) -> u64 {
            $crate::abi::call(fn_ptr, fn_len, in_ptr, in_len, $crate::dispatch::<$plugin>)
        }
    };
}

#[cfg(test)]
mod surface_tests {
    use super::*;
    use serde_json::json;

    #[derive(serde::Deserialize)]
    struct P {
        n: f64,
    }
    struct Dot;
    impl Plugin for Dot {
        type Params = P;
        fn validate(_p: &P) -> Vec<Issue> {
            vec![]
        }
        fn generate(_p: &P) -> Result<GenResult, String> {
            Err("none".into())
        }
        fn on_event_with(action: &str, _inputs: &Value, ctx: &Value, _p: &P) -> Option<Value> {
            Some(json!({ "message": format!("{} {}", action, ctx["row"]) }))
        }
        fn draw(req: &Value, p: &P) -> Option<Value> {
            Some(json!({ "frame": { "x0": 0, "y0": 0, "x1": p.n, "y1": p.n }, "items": [{ "type": "handle", "id": "a", "x": 1, "y": 1 }], "track": req["state"].is_object() }))
        }
        fn on_surface(event: &Value, surface: &Value, _p: &P) -> Option<Value> {
            Some(json!({ "state": { "at": event["x"] }, "view": surface["view"] }))
        }
    }

    #[test]
    fn surface_calls() {
        let d = dispatch::<Dot>("draw", json!({ "view": "top", "state": {}, "selected": {}, "have": [], "params": { "n": 5 } })).unwrap();
        assert_eq!(d["frame"]["x1"], 5.0);
        assert_eq!(d["track"], true);
        let s = dispatch::<Dot>("onSurface", json!({ "event": { "type": "down", "x": 2, "y": 3 }, "surface": { "view": "side" }, "params": { "n": 1 } })).unwrap();
        assert_eq!(s, json!({ "state": { "at": 2 }, "view": "side" }));
        let e = dispatch::<Dot>("onEvent", json!({ "action": "del", "row": 3, "inputs": {}, "params": { "n": 1 } })).unwrap();
        assert_eq!(e["message"], "del 3");
    }
}

#[cfg(test)]
mod pixel_tests {
    #[test]
    fn decodes_base64() {
        for (b64, bytes) in [("", vec![]), ("AQ==", vec![1]), ("AQI=", vec![1, 2]), ("AQID", vec![1, 2, 3]), ("/wD/AA==", vec![255, 0, 255, 0])] {
            assert_eq!(super::pixels(&serde_json::json!({ "data": b64 })), Some(bytes));
        }
        assert_eq!(super::pixels(&serde_json::json!({ "data": "A*" })), None);
    }

    #[test]
    fn decodes_meshes() {
        // One vertex (1, 2, 3), one triangle (0, 0, 0)
        let mut b = vec![1u8, 0, 0, 0, 1, 0, 0, 0];
        for v in [1.0f32, 2.0, 3.0] {
            b.extend(v.to_le_bytes());
        }
        b.extend([0u8; 12]);
        let abc = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut s = String::from("kzm1:");
        for c in b.chunks(3) {
            let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
            for k in 0..4 {
                s.push(if k <= c.len() { abc[(n >> (18 - 6 * k) & 63) as usize] as char } else { '=' });
            }
        }
        assert_eq!(super::mesh(&s), Some((vec![1.0, 2.0, 3.0], vec![0, 0, 0])));
        assert_eq!(super::mesh("stl"), None);
    }
}

#[cfg(test)]
mod tool_tests {
    use super::*;
    use serde_json::json;

    #[derive(serde::Deserialize)]
    struct P {
        level: u8,
    }
    /// Image filter: every pixel darker than `level` becomes black, the rest white
    struct Threshold;
    impl Plugin for Threshold {
        type Params = P;
        fn apply(input: &Value, p: &P) -> Option<Value> {
            let img = &input["image"];
            let px: Vec<u8> = pixels(img)?.into_iter().map(|v| if v < p.level { 0 } else { 255 }).collect();
            Some(json!({ "image": { "width": img["width"], "height": img["height"], "data": base64(&px) } }))
        }
    }

    #[test]
    fn image_filter_through_dispatch() {
        let input = json!({ "params": { "level": 100 }, "image": { "width": 3, "height": 1, "data": base64(&[10, 150, 99]) } });
        let r = dispatch::<Threshold>("apply", input).unwrap();
        assert_eq!(pixels(&r["image"]).unwrap(), vec![0, 255, 0]);
        assert_eq!(dispatch::<Threshold>("generate", json!({ "level": 1 })), Err("plugin-no-function".into()));
        assert_eq!(dispatch::<Threshold>("validate", json!({ "level": 1 })), Ok(json!([])));
    }

    #[test]
    fn base64_round_trip() {
        for n in 0..7u8 {
            let b: Vec<u8> = (0..n).map(|i| i * 37).collect();
            assert_eq!(pixels(&json!({ "data": base64(&b) })).unwrap(), b);
        }
    }
}
