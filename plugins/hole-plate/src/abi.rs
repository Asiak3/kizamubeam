// KizamuBeam plugin ABI version 1 (see src/plugins/engine.ts): the host writes the function name and the JSON
// input into buffers from kzb_alloc and calls kzb_call, which returns (ptr << 32) | len of a JSON envelope
// {"ok": …} or {"error": "code"}. No imports: the module only computes.
use std::cell::RefCell;

thread_local! {
    static OUT: RefCell<Vec<u8>> = RefCell::new(Vec::new());
    static BUFS: RefCell<Vec<Vec<u8>>> = RefCell::new(Vec::new());
}

#[no_mangle]
pub extern "C" fn kzb_api() -> i32 {
    1
}

/// Buffer for the host; buffers live until the next kzb_call returns
#[no_mangle]
pub extern "C" fn kzb_alloc(len: u32) -> u32 {
    let mut v = vec![0u8; len as usize];
    let ptr = v.as_mut_ptr() as u32;
    BUFS.with(|b| b.borrow_mut().push(v));
    ptr
}

/// Read a host buffer.
///
/// # Safety
/// ptr/len come from kzb_alloc in the same call.
unsafe fn slice<'a>(ptr: u32, len: u32) -> &'a [u8] {
    std::slice::from_raw_parts(ptr as *const u8, len as usize)
}

pub fn respond(result: Result<serde_json::Value, String>) -> u64 {
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

/// Entry point: dispatch to the plugin's functions by name
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
