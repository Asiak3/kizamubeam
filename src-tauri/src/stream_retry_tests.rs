use super::*;
use std::sync::Mutex;

#[derive(Default)]
struct Log(Mutex<Vec<String>>);
impl Events for Log {
    fn line(&self, _: &str) {}
    fn progress(&self, _: usize, _: usize, _: usize, _: usize) {}
    fn done(&self, ok: bool, message: &str) { self.0.lock().unwrap().push(format!("done {ok} {message}")); }
    fn closed(&self, _: Option<String>) { self.0.lock().unwrap().push("closed".into()); }
}

enum Step { Accept(usize), Error(ErrorKind), SlowByte }
#[derive(Default)]
struct Port {
    steps: VecDeque<Step>,
    attempts: Vec<Vec<u8>>,
    written: Vec<u8>,
    flushes: usize,
    stall: bool,
}
impl Read for Port {
    fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> { Err(ErrorKind::TimedOut.into()) }
}
impl Write for Port {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.attempts.push(b.to_vec());
        let n = match self.steps.pop_front() {
            Some(Step::Error(e)) => return Err(e.into()),
            Some(Step::Accept(n)) => n,
            Some(Step::SlowByte) => { std::thread::sleep(Duration::from_millis(4)); 1 }
            None => if self.stall { 0 } else { b.len() },
        };
        if n <= b.len() { self.written.extend_from_slice(&b[..n]); }
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> { self.flushes += 1; Ok(()) }
}
fn serial(steps: Vec<Step>) -> Streamer<Port, Log> {
    let port = Port { steps: steps.into(), ..Port::default() };
    Streamer::new(port, Log::default(), Arc::new(AtomicBool::new(false)), Protocol::grbl(false)).with_serial_retries()
}

#[test]
fn partial_zero_and_transient_errors_retry_only_the_unaccepted_suffix() {
    let mut s = serial(vec![Step::Accept(2), Step::Accept(0), Step::Error(ErrorKind::TimedOut),
        Step::Error(ErrorKind::WouldBlock), Step::Error(ErrorKind::Interrupted), Step::Accept(1)]);
    s.send_line("G21", Kind::Job).unwrap();
    assert_eq!(s.port.written, b"G21\n");
    assert_eq!(s.port.attempts, [b"G21\n".to_vec(), b"1\n".to_vec(), b"1\n".to_vec(),
        b"1\n".to_vec(), b"1\n".to_vec(), b"1\n".to_vec(), b"\n".to_vec()]);
    assert_eq!(s.inflight.front(), Some(&(4, Kind::Job)));
    assert_eq!(s.port.flushes, 0);
}

#[test]
fn missing_final_lf_does_not_advance_job_or_register_an_inflight_line() {
    let mut s = serial(vec![Step::Accept(3), Step::Error(ErrorKind::BrokenPipe)]);
    s.handle(Cmd::Job(vec!["G21".into()])).unwrap();
    assert!(s.fill().unwrap_err().starts_with("Senden fehlgeschlagen: "));
    assert_eq!(s.port.written, b"G21");
    assert_eq!(s.job.as_ref().unwrap().next, 0);
    assert_eq!(s.job.as_ref().unwrap().acked, 0);
    assert!(s.inflight.is_empty());
    assert_eq!(s.inflight_bytes, 0);
}

#[test]
fn complete_lines_before_a_failed_line_keep_correct_ack_and_progress_counts() {
    let mut s = serial(vec![Step::Accept(4), Step::Accept(1), Step::Error(ErrorKind::BrokenPipe)]);
    s.handle(Cmd::Job(vec!["G21".into(), "G90".into()])).unwrap();
    assert!(s.fill().is_err());
    assert_eq!(s.port.written, b"G21\nG");
    assert_eq!(s.job.as_ref().unwrap().next, 1);
    assert_eq!(s.inflight_bytes, 4);
    s.on_bytes(b"ok\n");
    assert_eq!(s.job.as_ref().unwrap().acked, 1);
    assert_eq!(s.job.as_ref().unwrap().next, 1);
    assert_eq!(s.inflight_bytes, 0);
}

#[test]
fn expired_deadline_never_attempts_another_write() {
    let mut s = serial(vec![]);
    assert_eq!(s.write_serial(b"G21\n", Instant::now() - Duration::from_secs(1)).unwrap_err().kind(), ErrorKind::TimedOut);
    assert!(s.port.attempts.is_empty());
}

#[test]
fn partial_success_does_not_restart_the_aggregate_deadline() {
    let mut s = serial(vec![Step::SlowByte, Step::SlowByte]);
    let deadline = Instant::now() + Duration::from_millis(2);
    assert_eq!(s.write_serial(b"G21\n", deadline).unwrap_err().kind(), ErrorKind::TimedOut);
    assert!(s.port.written.len() <= 1);
    assert!(s.port.attempts.len() <= 1);
}

#[test]
fn repeated_zero_writes_stop_at_deadline_without_busy_spinning() {
    let mut s = serial(vec![]); s.port.stall = true;
    let start = Instant::now();
    assert_eq!(s.write_serial(b"G21\n", start + Duration::from_millis(8)).unwrap_err().kind(), ErrorKind::TimedOut);
    assert!(s.port.written.is_empty());
    assert!(s.port.attempts.len() <= 16);
}

#[test]
fn invalid_transport_write_length_is_rejected() {
    let mut s = serial(vec![Step::Accept(100)]);
    assert_eq!(s.write_serial(b"G21\n", Instant::now() + WRITE_DEADLINE).unwrap_err().kind(), ErrorKind::InvalidData);
    assert_eq!(s.port.attempts.len(), 1);
}

#[test]
fn immediate_serial_writes_fill_the_whole_receive_window_in_one_pump() {
    let mut s = serial(vec![]); s.proto.rx_buffer = 1024;
    let lines = vec!["G1 X1".to_string(); 300];
    s.handle(Cmd::Job(lines)).unwrap(); s.pump().unwrap();
    assert_eq!(s.inflight.len(), 1024 / 6);
    assert_eq!(s.job.as_ref().unwrap().next, 1024 / 6);
    assert_eq!(s.inflight_bytes, (1024 / 6) * 6);
    assert_eq!(s.port.flushes, 0);
}

#[test]
fn immediate_console_writes_also_fill_the_window_in_one_pump() {
    let mut s = serial(vec![]); s.proto.rx_buffer = 1024;
    for _ in 0..300 { s.handle(Cmd::Line("G21".into())).unwrap(); }
    s.pump().unwrap();
    assert_eq!(s.inflight.len(), 256);
    assert_eq!(s.inflight_bytes, 1024);
}

#[test]
fn oversized_console_and_job_lines_keep_the_previous_send_when_empty_behavior() {
    let line = "G".repeat(RX_BUFFER + 10);
    for job in [false, true] {
        let mut s = serial(vec![]);
        s.handle(if job { Cmd::Job(vec![line.clone()]) } else { Cmd::Line(line.clone()) }).unwrap();
        s.fill().unwrap();
        assert_eq!(s.port.written, format!("{line}\n").as_bytes());
        assert_eq!(s.inflight_bytes, line.len() + 1);
    }
}

#[test]
fn realtime_pause_does_not_add_a_host_streaming_gate() {
    let mut s = serial(vec![]);
    s.handle(Cmd::Job(vec!["G21".into(), "G90".into()])).unwrap();
    s.handle(Cmd::Pause).unwrap(); assert!(!s.paused);
    s.fill().unwrap();
    assert_eq!(s.port.written, b"!G21\nG90\n");
    s.handle(Cmd::Resume).unwrap(); assert!(s.port.written.ends_with(b"~"));
}

#[test]
fn successful_stop_keeps_command_channel_and_connection_usable() {
    for realtime in [true, false] {
        let mut s = serial(vec![]); s.proto.realtime = realtime; s.proto.sync = !realtime;
        let (tx, rx) = std::sync::mpsc::channel();
        s.handle(Cmd::Job(vec!["G21".into()])).unwrap(); s.fill().unwrap();
        s.port.written.clear(); tx.send(Cmd::Stop).unwrap();
        assert!(!s.commands(&rx).unwrap());
        assert_eq!(s.port.written, if realtime { b"!\x18".as_slice() } else { b"M410\nM5\nM9\n".as_slice() });
        assert!(!s.paused); assert!(s.job.is_none()); assert_eq!(s.inflight_bytes, 0);
        assert!(s.events.0.lock().unwrap().contains(&"done false Abgebrochen".to_string()));
        tx.send(Cmd::Job(vec!["G90".into()])).unwrap();
        assert!(!s.commands(&rx).unwrap()); s.fill().unwrap();
        assert!(s.port.written.ends_with(b"G90\n"));
        assert!(!s.events.0.lock().unwrap().iter().any(|m| m.starts_with("closed")));
    }
}

#[test]
fn nonserial_transient_errors_and_zero_writes_are_not_replayed() {
    for step in [Step::Error(ErrorKind::TimedOut), Step::Error(ErrorKind::WouldBlock), Step::Accept(0)] {
        let mut s = serial(vec![step]); s.serial_retry = false;
        assert!(s.write(b"G21\n").is_err()); assert_eq!(s.port.attempts.len(), 1);
    }
    let mut s = serial(vec![]); s.serial_retry = false;
    s.write(b"G21\n").unwrap(); assert_eq!(s.port.flushes, 1);
}

#[test]
fn long_generated_job_preserves_utf8_bytes_across_partial_writes_and_acks() {
    let mut s = serial(vec![Step::Accept(1), Step::Accept(0), Step::Accept(2)]);
    let lines: Vec<String> = (0..2000).map(|i| format!("G1 X{} Y{} ; ä", i % 31, i % 17)).collect();
    s.handle(Cmd::Job(lines.clone())).unwrap();
    while !s.job.as_ref().unwrap().finishing {
        s.fill().unwrap();
        let pending = s.inflight.len();
        for _ in 0..pending { s.on_bytes(b"ok\n"); }
    }
    assert_eq!(s.port.written, format!("{}\n", lines.join("\n")).as_bytes());
    assert_eq!(s.job.as_ref().unwrap().acked, 2000);
    s.on_bytes(b"<Idle>\n"); assert!(s.job.is_none());
}
