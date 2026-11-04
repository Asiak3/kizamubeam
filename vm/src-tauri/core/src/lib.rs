//! Kern der KizamuBeam Virtual Machine: eine virtuelle Lasermaschine, die sich wie eine Steuerung mit
//! GRBL 1.1 oder FluidNC verhält. Sie nimmt G-Code über Telnet oder WebSocket an, antwortet mit ok/error,
//! Statusberichten und Alarmen, plant Bewegungen mit Beschleunigung in Echtzeit und meldet, wo der Laser
//! mit welcher Leistung gefahren ist. Ohne Oberfläche, damit derselbe Kern im Programm, kopflos und in
//! Tests läuft.

pub mod config;
pub mod gcode;
pub mod machine;
pub mod net;

pub use config::{Config, Flavor};
pub use machine::{ClientId, Event, Machine, Out, Segment, Snapshot};
pub use net::Runner;
