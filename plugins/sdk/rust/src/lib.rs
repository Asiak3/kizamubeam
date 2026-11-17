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

/// RGBA bytes of an image input (`{ "width", "height", "data": base64 }`), 4 per pixel, row by row
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

/// A generator plugin. `validate` runs first; `generate` only when it reported no error.
pub trait Plugin {
    type Params: serde::de::DeserializeOwned;
    fn validate(p: &Self::Params) -> Vec<Issue>;
    /// An `Err(code)` is shown as an error with the text of that code
    fn generate(p: &Self::Params) -> Result<GenResult, String>;
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
        "onEvent" => {
            let action = input.get("action").and_then(Value::as_str).ok_or("bad-input")?.to_string();
            let inputs = input.get("inputs").cloned().unwrap_or(Value::Null);
            let p = params(input.get("params").cloned().unwrap_or(Value::Null))?;
            P::on_event(&action, &inputs, &p).ok_or_else(missing)
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
mod pixel_tests {
    #[test]
    fn decodes_base64() {
        for (b64, bytes) in [("", vec![]), ("AQ==", vec![1]), ("AQI=", vec![1, 2]), ("AQID", vec![1, 2, 3]), ("/wD/AA==", vec![255, 0, 255, 0])] {
            assert_eq!(super::pixels(&serde_json::json!({ "data": b64 })), Some(bytes));
        }
        assert_eq!(super::pixels(&serde_json::json!({ "data": "A*" })), None);
    }
}
