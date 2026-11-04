//! Settings of the virtual machine. They are stored as JSON and can also be changed through the
//! controller ($130=…, $/axes/x/max_travel_mm=…), as on a real machine.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Flavor {
    /// GRBL 1.1h
    Grbl,
    /// FluidNC 3.x (GRBL compatible, plus $/path, $CD, [ESP800])
    Fluidnc,
}

/// Where the virtual camera sits
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CameraMount {
    /// fixed above the bed, sees all of it
    Fixed,
    /// on the laser head, moves along and sees a small field below it
    Head,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub flavor: Flavor,
    /// Travel in mm (GRBL $130/$131, FluidNC axes/x/max_travel_mm)
    pub bed_w: f64,
    pub bed_h: f64,
    /// Max. speed in mm/min ($110/$111)
    pub max_rate: f64,
    /// Acceleration in mm/s² ($120/$121)
    pub accel: f64,
    /// Junction deviation in mm ($11)
    pub junction_dev: f64,
    /// Tolerance for splitting arcs in mm ($12)
    pub arc_tolerance: f64,
    /// S value for 100 % ($30)
    pub s_max: f64,
    /// Laser mode ($32): laser on only during G1/G2/G3, M4 adapts power to speed
    pub laser_mode: bool,
    /// Homing possible ($22), i.e. limit switches present
    pub homing: bool,
    /// Locked after power-on until homed (FluidNC start/must_home)
    pub must_home: bool,
    /// Homing speed in mm/min ($25)
    pub homing_rate: f64,
    /// Soft limits ($20): targets outside the travel trigger ALARM:2 (only with homing)
    pub soft_limits: bool,
    /// Hard limits ($21): limit switches during motion trigger ALARM:1
    pub hard_limits: bool,
    /// Receive buffer in bytes; a program exceeding it gets a warning
    pub rx_buffer: usize,
    /// Slots in the motion planner
    pub planner_blocks: usize,
    /// $10: bit 0 = MPos instead of WPos, bit 1 = buffer state (Bf)
    pub status_mask: u32,
    pub telnet_enabled: bool,
    pub telnet_port: u16,
    pub ws_enabled: bool,
    pub ws_port: u16,
    /// Reachable from other computers on the network too (otherwise only 127.0.0.1)
    pub lan: bool,
    /// Optical laser power at 100 % in W; only used to burn the virtual material
    pub laser_watts: f64,
    /// Virtual camera: HTTP server with MJPEG stream and single images (rendered by the window)
    pub camera_enabled: bool,
    pub camera_port: u16,
    pub camera_mount: CameraMount,
    /// Image size in pixels
    pub camera_width: u32,
    pub camera_height: u32,
    /// Images per second while someone watches
    pub camera_fps: f64,
    /// Barrel distortion of the lens: shift at the image corner in % of the half diagonal (0 = none)
    pub camera_lens: f64,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            flavor: Flavor::Fluidnc,
            bed_w: 400.0,
            bed_h: 400.0,
            max_rate: 6000.0,
            accel: 1500.0,
            junction_dev: 0.01,
            arc_tolerance: 0.002,
            s_max: 1000.0,
            laser_mode: true,
            homing: true,
            must_home: false,
            homing_rate: 2000.0,
            soft_limits: false,
            hard_limits: false,
            rx_buffer: 127,
            planner_blocks: 16,
            status_mask: 1,
            telnet_enabled: true,
            telnet_port: 2323,
            ws_enabled: true,
            ws_port: 8181,
            lan: false,
            laser_watts: 10.0,
            camera_enabled: true,
            camera_port: 8282,
            camera_mount: CameraMount::Fixed,
            camera_width: 1280,
            camera_height: 720,
            camera_fps: 10.0,
            camera_lens: 4.0,
        }
    }
}

impl Config {
    /// Clamp values to sensible ranges (from file or UI)
    pub fn sanitize(&mut self) {
        let clamp =
            |v: f64, lo: f64, hi: f64, def: f64| if v.is_finite() { v.clamp(lo, hi) } else { def };
        let d = Config::default();
        self.bed_w = clamp(self.bed_w, 10.0, 5000.0, d.bed_w);
        self.bed_h = clamp(self.bed_h, 10.0, 5000.0, d.bed_h);
        self.max_rate = clamp(self.max_rate, 60.0, 600_000.0, d.max_rate);
        self.accel = clamp(self.accel, 10.0, 100_000.0, d.accel);
        self.junction_dev = clamp(self.junction_dev, 0.001, 1.0, d.junction_dev);
        self.arc_tolerance = clamp(self.arc_tolerance, 0.0005, 1.0, d.arc_tolerance);
        self.s_max = clamp(self.s_max, 1.0, 100_000.0, d.s_max);
        self.homing_rate = clamp(self.homing_rate, 60.0, 600_000.0, d.homing_rate);
        self.rx_buffer = self.rx_buffer.clamp(64, 65_536);
        self.planner_blocks = self.planner_blocks.clamp(4, 256);
        self.laser_watts = clamp(self.laser_watts, 0.1, 500.0, d.laser_watts);
        self.camera_width = self.camera_width.clamp(160, 3840);
        self.camera_height = self.camera_height.clamp(120, 2160);
        self.camera_fps = clamp(self.camera_fps, 1.0, 30.0, d.camera_fps);
        self.camera_lens = clamp(self.camera_lens, 0.0, 20.0, d.camera_lens);
        if !self.homing {
            self.soft_limits = false;
            self.must_home = false;
        }
    }
}
