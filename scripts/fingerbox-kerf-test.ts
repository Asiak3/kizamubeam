import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { FINGERBOX } from '../src/generators/fingerbox';

const base = { jointLayout: 'current', width: 100, depth: 80, height: 50, thickness: 3, finger: 10, compartmentsX: 2, ratiosX: '', compartmentsY: 1, ratiosY: '', dividerDrop: 10, kerf: 0, clearance: 0 };
const bbox = (nodes: { x: number; y: number }[]) => ({
  x0: Math.min(...nodes.map((q) => q.x)), x1: Math.max(...nodes.map((q) => q.x)),
  y0: Math.min(...nodes.map((q) => q.y)), y1: Math.max(...nodes.map((q) => q.y)),
});
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

for (const top of ['open', 'closed']) for (const clearance of [0, 0.1, -0.1]) {
  const ref = FINGERBOX.generate({ ...base, top, clearance } as never).parts;
  const k = 0.2;
  const cut = FINGERBOX.generate({ ...base, top, clearance, kerf: k } as never).parts;
  assert.equal(cut.length, ref.length);
  for (const part of cut) {
    const r = ref.find((x) => x.key === part.key)!;
    part.subs.forEach((sub, si) => {
      const n = sub.nodes;
      for (let i = 0; i < n.length; i++) {
        const a = n[i], b = n[(i + 1) % n.length];
        assert.ok(near(a.x, b.x) || near(a.y, b.y), `${top}/${clearance}: ${part.key}#${si}[${i}] hat eine schiefe Kante`);
      }
      const bb = bbox(sub.nodes), rb = bbox(r.subs[si].nodes), d = si === 0 ? k / 2 : -k / 2;
      assert.ok(near(bb.x0, rb.x0 - d) && near(bb.x1, rb.x1 + d) && near(bb.y0, rb.y0 - d) && near(bb.y1, rb.y1 + d),
        `${top}/${clearance}: ${part.key}#${si} Kerf-Versatz ist nicht ${d} mm`);
    });
  }
}
console.log('ok   Fingerbox: Kerf-Versatz außen +kerf/2, Schlitze −kerf/2, keine schiefen Kanten; Steckspiel ±');
