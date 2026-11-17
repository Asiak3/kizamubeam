//! Example plugin for KizamuBeam (issue #205): a rectangular plate with a pattern of round or hexagonal holes.
//! Parameters in, parts out, as JSON; built with the Rust SDK in plugins/sdk/rust, see docs/plugins.md.
use kzb_plugin::{export_plugin, geom, GenResult, Issue, Part, Plugin};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Params {
    pub width: f64,
    pub height: f64,
    pub margin: f64,
    pub hole_dia: f64,
    pub pitch: f64,
    pub pattern: String,
    pub hole_shape: String,
    pub corner: f64,
}

/// Hole centres inside the plate minus the margin
pub fn centres(p: &Params) -> Vec<(f64, f64)> {
    let r = p.hole_dia / 2.0;
    let (ax, ay) = (p.width / 2.0 - p.margin - r, p.height / 2.0 - p.margin - r);
    if ax < 0.0 || ay < 0.0 || p.pitch <= 0.0 {
        return vec![];
    }
    let hex = p.pattern == "hex";
    let dy = if hex { p.pitch * 3f64.sqrt() / 2.0 } else { p.pitch };
    let rows = (2.0 * ay / dy).floor() as i64;
    let mut out = vec![];
    for j in 0..=rows {
        let y = -(rows as f64) * dy / 2.0 + j as f64 * dy;
        let shift = if hex && j % 2 == 1 { p.pitch / 2.0 } else { 0.0 };
        let cols = ((2.0 * ax - shift.abs()) / p.pitch).floor() as i64;
        if cols < 0 {
            continue;
        }
        for i in 0..=cols {
            out.push((-(cols as f64) * p.pitch / 2.0 + i as f64 * p.pitch + shift, y));
        }
    }
    out
}

pub struct HolePlate;

impl Plugin for HolePlate {
    type Params = Params;

    fn validate(p: &Params) -> Vec<Issue> {
        let mut out = vec![];
        if p.hole_dia >= p.pitch {
            out.push(Issue::error("holes-touch").on("holeDia"));
        }
        if p.corner * 2.0 > p.width.min(p.height) {
            out.push(Issue::error("corner-too-large").on("corner"));
        }
        let n = centres(p).len();
        if out.is_empty() && n == 0 {
            out.push(Issue::warn("no-holes"));
        }
        if n > 20_000 {
            out.push(Issue::error("too-many-holes").on("pitch").value("n", n));
        }
        out
    }

    fn generate(p: &Params) -> Result<GenResult, String> {
        let r = p.hole_dia / 2.0;
        let hex = p.hole_shape == "hex";
        let cs = centres(p);
        let mut subs = vec![geom::rounded_rect(p.width, p.height, p.corner)];
        for &(x, y) in &cs {
            subs.push(if hex { geom::regular(x, y, r, 6, std::f64::consts::PI / 6.0) } else { geom::circle(x, y, r) });
        }
        let open = cs.len() as f64 * if hex { 3.0 * 3f64.sqrt() / 2.0 * r * r } else { std::f64::consts::PI * r * r };
        let ratio = 100.0 * open / (p.width * p.height);
        Ok(GenResult::new()
            .part(Part::new("plate", subs))
            .info("holes", cs.len())
            .info("open-area", format!("{ratio:.1} %")))
    }
}

export_plugin!(HolePlate);
