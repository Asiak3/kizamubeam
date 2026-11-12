// Read-only reference inventory for a supplied local project; no editor/hardware.
import './core-fixtures-env';
import { readFileSync } from 'node:fs';
const { loadDoc } = await import('../src/model');
const { shapeSubs } = await import('../src/geom');
const { segments } = await import('../src/curves');
const { straightGeometry } = await import('../src/straightSlots');
const doc = loadDoc(JSON.parse(readFileSync(process.argv[3], 'utf8')));
const angle = Number(process.argv[4] ?? 90);
const report = doc.objs.filter(o => o.shape.kind === 'path').map(o => {
  const base = shapeSubs(o.shape), geometry = straightGeometry(base, angle);
  return { id: o.id, layer: o.layer, nodes: base.map(sp => sp.nodes.length),
    offeredReferences: geometry.references.map(r => ({ origin: r.origin, transition: r.transition, turn: Number(r.turn.toFixed(1)), point: [Number(r.point.x.toFixed(2)), Number(r.point.y.toFixed(2))] })),
    legacyVertices: geometry.vertices.length,
    shortCurves: base.flatMap((sp, sub) => segments(sp).flatMap(s => {
      if (!s.curve) return [];
      const chord = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
      if (chord > 2) return [];
      const before = sp.nodes[(s.ia + sp.nodes.length - 1) % sp.nodes.length], after = sp.nodes[(s.ib + 1) % sp.nodes.length];
      const u = { x: s.a.x - before.x, y: s.a.y - before.y }, v = { x: after.x - s.b.x, y: after.y - s.b.y };
      const turn = Math.acos(Math.max(-1, Math.min(1, (u.x*v.x+u.y*v.y)/Math.hypot(u.x,u.y)/Math.hypot(v.x,v.y))))*180/Math.PI;
      return [{ sub, from: s.ia, to: s.ib, chord, adjoiningStraightTurn: Number.isFinite(turn) ? Number(turn.toFixed(1)) : null }];
    })) };
});
console.log(JSON.stringify(report, null, 2));
