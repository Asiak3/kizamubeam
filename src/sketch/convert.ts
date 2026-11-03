// Pfade in eine Skizze umwandeln: Geraden → Linien, erkannte Kreise/Bögen → Kreise/Bögen, gemeinsame Knoten →
// gemeinsame Punkte. Freie Bézierkurven werden durch kurze Linien angenähert (Skizzen kennen keine Splines).
import type { SubPath } from '../model';
import { bezierPt, segments } from '../curves';
import { findArcs } from '../arcs';
import { addArc, addCircle, addCon, addLine, addPt, emptySketch, ptOf, Sketch } from './model';

/** Höchstlänge der Linien, die eine freie Kurve annähern (mm) */
const FLAT_STEP = 1.5;

export function subsToSketch(subs: SubPath[]): Sketch {
  const sk = emptySketch();
  const arcs = findArcs(subs);
  subs.forEach((sp, si) => {
    const n = sp.nodes.length;
    if (n < 2) return;
    const mine = arcs.filter((a) => a.sub === si);
    const full = mine.find((a) => a.full);
    if (full) {
      addCircle(sk, addPt(sk, full.c.x, full.c.y).id, full.r);
      return;
    }
    const ids = sp.nodes.map((q) => addPt(sk, q.x, q.y).id);
    const segs = segments(sp);
    // Segment → Bogen, zu dem es gehört (nur das erste Segment eines Bogens legt ihn an)
    const arcAt = new Map<number, (typeof mine)[number]>();
    const inArc = new Set<number>();
    for (const a of mine) {
      arcAt.set(a.seg, a);
      for (let k = 0; k < a.count; k++) inArc.add((a.seg + k) % segs.length);
    }
    const used = new Set<number>(); // tatsächlich benutzte Punkte
    segs.forEach((sg, k) => {
      const a = arcAt.get(k);
      if (a) {
        const startIdx = sg.ia;
        const endIdx = segs[(a.seg + a.count - 1) % segs.length].ib;
        const c = addPt(sk, a.c.x, a.c.y).id;
        // Bögen laufen mit wachsendem Winkel; sonst Anfang und Ende tauschen
        if (a.sweep > 0) addArc(sk, c, ids[startIdx], ids[endIdx]);
        else addArc(sk, c, ids[endIdx], ids[startIdx]);
        used.add(ids[startIdx]).add(ids[endIdx]);
        return;
      }
      if (inArc.has(k)) return;
      if (!sg.curve) {
        addLine(sk, ids[sg.ia], ids[sg.ib]);
        used.add(ids[sg.ia]).add(ids[sg.ib]);
        return;
      }
      // freie Kurve: in Linien zerlegen
      let len = 0;
      let prev = sg.a;
      for (let i = 1; i <= 8; i++) {
        const q = bezierPt(sg.a, sg.c1, sg.c2, sg.b, i / 8);
        len += Math.hypot(q.x - prev.x, q.y - prev.y);
        prev = q;
      }
      const steps = Math.max(2, Math.min(64, Math.ceil(len / FLAT_STEP)));
      let last = ids[sg.ia];
      for (let i = 1; i < steps; i++) {
        const q = bezierPt(sg.a, sg.c1, sg.c2, sg.b, i / steps);
        const p = addPt(sk, q.x, q.y).id;
        addLine(sk, last, p);
        last = p;
      }
      addLine(sk, last, ids[sg.ib]);
      used.add(ids[sg.ia]).add(ids[sg.ib]);
    });
    // Knoten in der Mitte eines Bogens werden nicht gebraucht
    sk.pts = sk.pts.filter((p) => !ids.includes(p.id) || used.has(p.id));
  });
  // Achsparallele Linien bekommen gleich ihre Beziehung (waagrecht/senkrecht), damit Maße die Form nicht verkippen
  for (const e of [...sk.ents]) {
    if (e.t !== 'line') continue;
    const a = ptOf(sk, e.a)!,
      b = ptOf(sk, e.b)!;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-6) continue;
    if (Math.abs(b.y - a.y) < 1e-6 * Math.max(1, L)) addCon(sk, 'horizontal', [e.id]);
    else if (Math.abs(b.x - a.x) < 1e-6 * Math.max(1, L)) addCon(sk, 'vertical', [e.id]);
  }
  return sk;
}
