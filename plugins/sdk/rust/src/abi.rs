//! KizamuBeam plugin ABI version 1 (see src/plugins/engine.ts in the app): the host writes the function name and
//! the JSON input into buffers from `kzb_alloc` and calls `kzb_call`, which returns `(ptr << 32) | len` of a JSON
//! envelope `{"ok": …}` or `{"error": "code"}`. The only import is `kzb.host_call` (see [`crate::host`]), and only
//! when the plugin uses host functions.
use std::cell::RefCell;

thread_local! {
    static OUT: RefCell<Vec<u8>> = RefCell::new(Vec::new());
    static BUFS: RefCell<Vec<Vec<u8>>> = RefCell::new(Vec::new());
}

/// Buffer for the host; buffers live until the next call returns
pub fn alloc(len: u32) -> u32 {
    let mut v = vec![0u8; len as usize];
    let ptr = v.as_mut_ptr() as u32;
    BUFS.with(|b| b.borrow_mut().push(v));
    ptr
}

/// # Safety
/// ptr/len come from `alloc` in the same call.
unsafe fn slice<'a>(ptr: u32, len: u32) -> &'a [u8] {
    std::slice::from_raw_parts(ptr as *const u8, len as usize)
}

fn respond(result: Result<serde_json::Value, String>) -> u64 {
    let env = match result {
        Ok(v) => serde_json::json!({ "ok": v }),
        Err(code) => serde_json::json!({ "error": code }),
    };
    OUT.with(|o| {
        let mut o = o.borrow_mut();
        *o = serde_json::to_vec(&env).unwrap_or_default();
        ((o.as_ptr() as u64) << 32) | o.len() as u64
    })
}

/// Read the function name and input, call `f`, write the answer envelope
pub fn call(fn_ptr: u32, fn_len: u32, in_ptr: u32, in_len: u32, f: impl Fn(&str, serde_json::Value) -> Result<serde_json::Value, String>) -> u64 {
    let (name, input) = unsafe { (slice(fn_ptr, fn_len).to_vec(), slice(in_ptr, in_len).to_vec()) };
    BUFS.with(|b| b.borrow_mut().clear());
    let name = String::from_utf8(name).unwrap_or_default();
    let r = match serde_json::from_slice::<serde_json::Value>(&input) {
        Ok(v) => f(&name, v),
        Err(_) => Err("bad-input".into()),
    };
    respond(r)
}

/// Copy and free a buffer the host filled during this call (the answer of a host function)
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) fn take(ptr: u32, len: u32) -> Vec<u8> {
    let out = unsafe { slice(ptr, len).to_vec() };
    BUFS.with(|b| b.borrow_mut().retain(|v| v.as_ptr() as u32 != ptr));
    out
}

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "kzb")]
extern "C" {
    fn host_call(name_ptr: *const u8, name_len: u32, in_ptr: *const u8, in_len: u32) -> u64;
}

/// Call a host function by name with JSON input; the answer envelope as bytes
#[cfg(target_arch = "wasm32")]
pub(crate) fn host_raw(name: &str, input: &[u8]) -> Vec<u8> {
    let packed = unsafe { host_call(name.as_ptr(), name.len() as u32, input.as_ptr(), input.len() as u32) };
    take((packed >> 32) as u32, packed as u32)
}

/// Outside WebAssembly (native tests) there is no host: every call fails with host-unavailable
#[cfg(not(target_arch = "wasm32"))]
pub(crate) fn host_raw(_name: &str, _input: &[u8]) -> Vec<u8> {
    br#"{"error":"host-unavailable"}"#.to_vec()
}
