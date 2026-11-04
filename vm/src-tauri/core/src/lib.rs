//! Core of the KizamuBeam Virtual Machine: a virtual laser machine that behaves like a controller running
//! GRBL 1.1 or FluidNC. It accepts G-code over Telnet or WebSocket, answers with ok/error,
//! status reports and alarms, plans moves with acceleration in real time and reports where the laser
//! travelled with which power. Without UI, so the same core runs in the program, headless and in
//! tests.

pub mod camera;
pub mod config;
pub mod gcode;
pub mod machine;
pub mod net;

pub use config::{CameraMount, Config, Flavor};
pub use machine::{ClientId, Event, Machine, Out, Segment, Snapshot};
pub use net::Runner;
