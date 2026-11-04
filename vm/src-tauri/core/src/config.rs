//! Einstellungen der virtuellen Maschine. Sie werden als JSON gespeichert und lassen sich auch über die
//! Steuerung ändern ($130=…, $/axes/x/max_travel_mm=…), so wie bei einer echten Maschine.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Flavor {
    /// GRBL 1.1h
    Grbl,
    /// FluidNC 3.x (GRBL-kompatibel, dazu $/Pfad, $CD, [ESP800])
    Fluidnc,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub flavor: Flavor,
    /// Fahrweg in mm (GRBL $130/$131, FluidNC axes/x/max_travel_mm)
    pub bed_w: f64,
    pub bed_h: f64,
    /// Höchstgeschwindigkeit in mm/min ($110/$111)
    pub max_rate: f64,
    /// Beschleunigung in mm/s² ($120/$121)
    pub accel: f64,
    /// Junction Deviation in mm ($11)
    pub junction_dev: f64,
    /// Toleranz beim Zerlegen von Bögen in mm ($12)
    pub arc_tolerance: f64,
    /// S-Wert für 100 % ($30)
    pub s_max: f64,
    /// Laser-Modus ($32): Laser nur während G1/G2/G3 an, M4 passt die Leistung der Geschwindigkeit an
    pub laser_mode: bool,
    /// Referenzfahrt möglich ($22), also Endschalter vorhanden
    pub homing: bool,
    /// Nach dem Einschalten gesperrt bis zur Referenzfahrt (FluidNC start/must_home)
    pub must_home: bool,
    /// Geschwindigkeit der Referenzfahrt in mm/min ($25)
    pub homing_rate: f64,
    /// Weiche Grenzen ($20): Ziele außerhalb des Fahrwegs lösen ALARM:2 aus (nur mit Referenzfahrt)
    pub soft_limits: bool,
    /// Harte Grenzen ($21): Endschalter während der Fahrt lösen ALARM:1 aus
    pub hard_limits: bool,
    /// Empfangspuffer in Bytes; überschreitet ein Programm ihn, gibt es eine Warnung
    pub rx_buffer: usize,
    /// Plätze im Bewegungsplaner
    pub planner_blocks: usize,
    /// $10: Bit 0 = MPos statt WPos, Bit 1 = Pufferstand (Bf)
    pub status_mask: u32,
    pub telnet_enabled: bool,
    pub telnet_port: u16,
    pub ws_enabled: bool,
    pub ws_port: u16,
    /// Auch von anderen Rechnern im Netz erreichbar (sonst nur 127.0.0.1)
    pub lan: bool,
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
        }
    }
}

impl Config {
    /// Werte in sinnvolle Grenzen bringen (aus Datei oder Oberfläche)
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
        if !self.homing {
            self.soft_limits = false;
            self.must_home = false;
        }
    }
}
