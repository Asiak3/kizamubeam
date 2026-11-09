// Regression for the recessed corners of base/lid with fit clearance:
//  - negative clearance (press fit): no |clearance|/2 step in the corners (it overlapped the neighbouring wall);
//  - zero/positive clearance: base and lid exactly as before (the step is floor material inside the box that no wall covers);
//  - wall panels (front/back/left/right) always exactly as before.
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { panelPolys } from '../src/generators/box';

type P = { x: number; y: number };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const canon = (pts: P[]) => JSON.stringify(pts.map((q) => q.x.toFixed(4) + ',' + q.y.toFixed(4)).sort());
const polys = (c: number, top: 'open' | 'closed', w = 120, d = 100, h = 60, th = 3.6, finger = 10) =>
  panelPolys({ sizeMode: 'outer', width: w, depth: d, height: h, thickness: th, finger, top, clearance: c, kerf: 0 });

// Wall panels frozen from the outlines produced before the corner fix (120 x 100 x 60, th 3.6, finger 10).
const WALLS: Record<string, string> = {"-1|open":"4c7f135dd04bc50e","-1|closed":"71d36d9f03069968","-0.5|open":"4ff8319f0f084f90","-0.5|closed":"ba9fce60eadad9f0","0|open":"c8f434758f0fb2d4","0|closed":"39c812bfc02e4d57","0.2|open":"257d1d271b70313b","0.2|closed":"461b686e652c89ff","0.5|open":"b71f9586e5052001","0.5|closed":"87c92ea6e43386e4","1|open":"0ebd51b5d1b41e33","1|closed":"40f2506fd4316122"};
for (const [key, expected] of Object.entries(WALLS)) {
  const [c, top] = key.split('|');
  const walls = polys(Number(c), top as 'open' | 'closed').filter((x) => ['front', 'back', 'left', 'right'].includes(x.key));
  assert.equal(walls.length, 4);
  const got = createHash('sha1').update(['front', 'back', 'left', 'right'].map((k) => canon(walls.find((x) => x.key === k)!.pts)).join('#')).digest('hex').slice(0, 16);
  assert.equal(got, expected, `Wandplatten bei Steckspiel ${c} (${top}) haben sich verändert`);
}

// Base/lid frozen from the outlines produced before the corner fix, for zero and positive clearance.
const PLATES: Record<string, string> = {"0|open|120":"f5ff94eb472b4756","0|open|80":"3a9581dcf10f8ea3","0|closed|120":"84a2331f34a31567","0|closed|80":"46d428e6f6f477a0","0.2|open|120":"cce0089cd4e1808c","0.2|open|80":"60f19e07dd05208a","0.2|closed|120":"8a89af617fd0859f","0.2|closed|80":"d83fefee9b0af8fb","0.5|open|120":"d6e8dadddcc48ccd","0.5|open|80":"d3728e80a91b8a82","0.5|closed|120":"d471c708952b9cd1","0.5|closed|80":"af7b72a93e2b3336","1|open|120":"aafcdfd24dfeae43","1|open|80":"4985f33687f6f0cc","1|closed|120":"341e4b36d8a4a2f3","1|closed|80":"8a513e19063360eb"};
for (const [key, expected] of Object.entries(PLATES)) {
  const [c, top, w] = key.split('|');
  const [d, h, th, f] = w === '120' ? [100, 60, 3.6, 10] : [60, 40, 3, 8];
  const plates = polys(Number(c), top as 'open' | 'closed', Number(w), d, h, th, f).filter((x) => x.key === 'bottom' || x.key === 'top');
  const got = createHash('sha1').update(plates.map((x) => x.key + canon(x.pts)).join('#')).digest('hex').slice(0, 16);
  assert.equal(got, expected, `Boden/Deckel bei Steckspiel ${c} (${top}, ${w}) haben sich verändert`);
}

for (const top of ['open', 'closed'] as const) for (const c of [-1, -0.5, -0.2]) {
  for (const [w, d, h, th, f] of [[120, 100, 60, 3.6, 10], [80, 60, 40, 3, 8], [200, 150, 90, 6, 20]]) {
    for (const plate of polys(c, top, w, d, h, th, f).filter((x) => x.key === 'bottom' || x.key === 'top')) {
      const n = plate.pts, tag = `${plate.key} ${top} c=${c} ${w}x${d}x${h}`;
      // no step of |clearance|/2 left anywhere on the outline
      for (let i = 0; i < n.length; i++) {
        const a = n[i], b = n[(i + 1) % n.length], len = Math.hypot(a.x - b.x, a.y - b.y);
        assert.ok(len > Math.abs(c) / 2 + 1e-6, `${tag}: Stufe an Punkt ${i}`);
        assert.ok(near(a.x, b.x) || near(a.y, b.y), `${tag}: schiefe Kante an Punkt ${i}`);
      }
      // every corner is a clean square recess of th: its inner point exists
      const hw = plate.a / 2, hh = plate.b / 2;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
        assert.ok(n.some((q) => near(q.x, sx * (hw - th)) && near(q.y, sy * (hh - th))), `${tag}: Eckquadrat fehlt (${sx},${sy})`);
    }
  }
}
console.log('ok   Box: negatives Steckspiel ohne Eckstufe, Spiel >= 0 und Wandplatten unverändert');
