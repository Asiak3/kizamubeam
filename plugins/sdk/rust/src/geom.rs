//! Outline helpers in mm, centred on the origin, y pointing down. Curves are cubic Béziers.
use crate::{Node, SubPath};
use std::f64::consts::PI;

/// Handle length for a quarter circle
pub const K: f64 = 0.552_284_749_830_793_4;

/// Closed polygon through the points
pub fn polygon(pts: &[(f64, f64)]) -> SubPath {
    SubPath { nodes: pts.iter().map(|&(x, y)| Node::new(x, y)).collect(), closed: true }
}

/// Rectangle of width × height
pub fn rect(w: f64, h: f64) -> SubPath {
    let (x, y) = (w / 2.0, h / 2.0);
    polygon(&[(-x, -y), (x, -y), (x, y), (-x, y)])
}

/// Circle around (cx, cy)
pub fn circle(cx: f64, cy: f64, r: f64) -> SubPath {
    let k = r * K;
    SubPath {
        closed: true,
        nodes: vec![
            Node::curve(cx + r, cy, (cx + r, cy - k), (cx + r, cy + k)),
            Node::curve(cx, cy + r, (cx + k, cy + r), (cx - k, cy + r)),
            Node::curve(cx - r, cy, (cx - r, cy + k), (cx - r, cy - k)),
            Node::curve(cx, cy - r, (cx - k, cy - r), (cx + k, cy - r)),
        ],
    }
}

/// Regular polygon with n corners on a circle of radius r around (cx, cy), first corner at angle `start` (radians)
pub fn regular(cx: f64, cy: f64, r: f64, n: usize, start: f64) -> SubPath {
    let pts: Vec<(f64, f64)> = (0..n).map(|i| {
        let a = start + 2.0 * PI * i as f64 / n as f64;
        (cx + r * a.cos(), cy + r * a.sin())
    }).collect();
    polygon(&pts)
}

/// Rectangle with rounded corners (radius 0 = sharp)
pub fn rounded_rect(w: f64, h: f64, r: f64) -> SubPath {
    let r = r.min(w / 2.0).min(h / 2.0).max(0.0);
    if r <= 0.0 {
        return rect(w, h);
    }
    let (x0, y0, x1, y1) = (-w / 2.0, -h / 2.0, w / 2.0, h / 2.0);
    let k = r * K;
    SubPath {
        closed: true,
        nodes: vec![
            Node::curve(x0 + r, y0, (x0 + r - k, y0), (x0 + r, y0)),
            Node::curve(x1 - r, y0, (x1 - r, y0), (x1 - r + k, y0)),
            Node::curve(x1, y0 + r, (x1, y0 + r - k), (x1, y0 + r)),
            Node::curve(x1, y1 - r, (x1, y1 - r), (x1, y1 - r + k)),
            Node::curve(x1 - r, y1, (x1 - r + k, y1), (x1 - r, y1)),
            Node::curve(x0 + r, y1, (x0 + r, y1), (x0 + r - k, y1)),
            Node::curve(x0, y1 - r, (x0, y1 - r + k), (x0, y1 - r)),
            Node::curve(x0, y0 + r, (x0, y0 + r), (x0, y0 + r - k)),
        ],
    }
}
