//! Template for a KizamuBeam generator plugin in Rust: a name tag with a hanging hole.
//! Copy this folder to plugins/<your-name>/, change the ids in plugin.json and Cargo.toml, fix the path to the SDK
//! in Cargo.toml (`../sdk/rust`) and build with `npm run plugin:pack -- --build plugins/<your-name>`.
use kzb_plugin::{export_plugin, geom, GenResult, Issue, Part, Plugin};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Params {
    pub width: f64,
    pub height: f64,
    pub corner: f64,
    pub hole: bool,
    pub hole_dia: f64,
}

pub struct NameTag;

impl Plugin for NameTag {
    type Params = Params;

    fn validate(p: &Params) -> Vec<Issue> {
        let mut out = vec![];
        if p.corner * 2.0 > p.width.min(p.height) {
            out.push(Issue::error("corner-too-large").on("corner"));
        }
        if p.hole && p.hole_dia + 4.0 > p.height {
            out.push(Issue::error("hole-too-large").on("holeDia").value("max", p.height - 4.0));
        }
        out
    }

    fn generate(p: &Params) -> Result<GenResult, String> {
        let mut subs = vec![geom::rounded_rect(p.width, p.height, p.corner)];
        if p.hole {
            subs.push(geom::circle(-p.width / 2.0 + p.hole_dia / 2.0 + 3.0, 0.0, p.hole_dia / 2.0));
        }
        Ok(GenResult::new().part(Part::new("tag", subs)).info("area", format!("{} mm²", (p.width * p.height * 1000.0).round() / 1000.0)))
    }
}

export_plugin!(NameTag);
