//! Serielle Leseabfragen kurz halten, ohne denselben kurzen Schreibtimeout zu verwenden.
use std::time::Duration;

pub const READ_TIMEOUT_MS: u64 = 10;
pub const WRITE_ATTEMPT_MS: u64 = 50;

pub fn open(name: &str, baud: u32) -> Result<Box<dyn serialport::SerialPort>, String> {
    let builder = serialport::new(name, baud).timeout(Duration::from_millis(READ_TIMEOUT_MS));
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        let port = builder.open_native().map_err(|e| e.to_string())?;
        windows_timeouts(port.as_raw_handle())?;
        Ok(Box::new(port))
    }
    #[cfg(not(windows))]
    {
        // POSIX behält den kurzen Timeout; der Streamer begrenzt serielle
        // Schreibwiederholungen insgesamt auf zwei Sekunden.
        builder.open().map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
fn windows_timeouts(handle: std::os::windows::io::RawHandle) -> Result<(), String> {
    use std::ffi::c_void;
    #[repr(C)]
    #[derive(Default)]
    struct CommTimeouts {
        read_interval: u32,
        read_multiplier: u32,
        read_constant: u32,
        write_multiplier: u32,
        write_constant: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCommTimeouts(handle: *mut c_void, timeouts: *mut CommTimeouts) -> i32;
        fn SetCommTimeouts(handle: *mut c_void, timeouts: *const CommTimeouts) -> i32;
    }
    let mut timeouts = CommTimeouts::default();
    // SAFETY: COMPort owns a live Windows handle; the repr(C) structure matches
    // the five DWORD fields of COMMTIMEOUTS. Neither API retains this pointer.
    if unsafe { GetCommTimeouts(handle, &mut timeouts) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    timeouts.write_multiplier = 0;
    timeouts.write_constant = WRITE_ATTEMPT_MS as u32;
    // Preserve the serialport library's read-interval/multiplier convention.
    if unsafe { SetCommTimeouts(handle, &timeouts) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}
