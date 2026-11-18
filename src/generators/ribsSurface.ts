// Drawing surface of the rib model (#335 stage 4): the model seen from the front, the side or the top, the parts
// as outlines and the axes of the sections (body, legs, tail …) to draw and drag. Only describes what to draw and
// answers pointer events; the dialog draws. Changes only the parameter „sections“ (JSON). No DOM: the same code
// runs in the app and in the plugin.
//
// Coordinates on the surface: x = first axis of the view (e1), y = −second axis (e2 points up, the surface down).
import { t } from '../i18n';
import type { Mesh } from '../model3d/mesh';
import type { V3 } from '../model3d/slice';
import { getMesh } from '../model3d/store';
import { suggestSections } from '../model3d/suggest';
import { layoutKey, materialAlong, parseSections, ribsLayout, sectionName, type Section, type View, VIEWS, worldMesh } from './ribs';
import type { GenDrawing, GenDrawRequest, GenEvent, GenEventResult, GenItem, GenLayer, GenPointer, GenSurface, GenSurfaceResult, GenSurfaceState, Params } from './types';

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const r1 = (v: number) => Math.round(v * 10) / 10;
const LIST = 'sections';

export const ribsSurface = (): GenSurface => ({
  views: [
    { id: 'xz', label: t('von vorne (X–Z)') },
    { id: 'yz', label: t('von der Seite (Y–Z)') },
    { id: 'xy', label: t('von oben (X–Y)') },
  ],
  height: 300,
  help: t('Punkte ziehen verschiebt die Achse, die Linie ziehen verschiebt den ganzen Abschnitt; in einer anderen Ansicht verschiebt Ziehen die Ebene. Rechtsklick auf einen Punkt löscht ihn.'),
});

/** What the surface keeps between events: sections while dragging, a line being drawn */
interface RibsState {
  secs?: Section[];
  drag?: { kind: 'point' | 'move' | 'offset'; s: number; k: number; orig: Section };
  drawing?: Section;
  mouse?: [number, number];
}

const stateOf = (s: GenSurfaceState): RibsState => (s.state && typeof s.state === 'object' ? (s.state as RibsState) : {});
const sectionsOf = (p: Params) => parseSections(String(p.sections ?? '')) ?? [];
const asView = (v: string): View => (v === 'yz' || v === 'xy' ? v : 'xz');
const copySec = (s: Section): Section => ({ ...s, pts: s.pts.map((q) => [q[0], q[1]] as [number, number]) });
const json = (secs: Section[]) => (secs.length ? JSON.stringify(secs) : '');

// ---- The model in world coordinates (as the generator slices it) ----
let worldKey = '';
let world: { mesh: Mesh; lo: V3; hi: V3 } | null = null;
function worldOf(p: Params) {
  const key = [p.model, p.up, p.size].join('|');
  if (key !== worldKey || !world) {
    const m = getMesh(String(p.model ?? ''));
    world = null;
    if (m) {
      const wm = worldMesh(m, String(p.up), Number(p.size));
      const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < wm.mesh.pos.length; i += 3)
        for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], wm.mesh.pos[i + k])), (hi[k] = Math.max(hi[k], wm.mesh.pos[i + k]));
      world = { mesh: wm.mesh, lo, hi };
    }
    worldKey = key;
  }
  return world;
}

/** A point of a section in the world */
const secPoint3 = (s: Section, q: [number, number]): V3 => {
  const V = VIEWS[s.view];
  return [0, 1, 2].map((k) => V.e1[k] * q[0] + V.e2[k] * q[1] + V.n[k] * s.offset) as V3;
};
/** A world point on the surface of a view */
const onView = (view: View, q: V3): [number, number] => [r1(dot(q, VIEWS[view].e1)), r1(-dot(q, VIEWS[view].e2))];

/** Middle of the material along the normal at the middle of the axis, nearest to the current plane */
function centerOffset(p: Params, s: Section): number {
  const w = worldOf(p);
  if (!w || !s.pts.length) return s.offset;
  const V = VIEWS[s.view];
  const i = Math.floor((s.pts.length - 1) / 2);
  const mid = s.pts[i], nxt = s.pts[Math.min(s.pts.length - 1, i + 1)];
  const a = (mid[0] + nxt[0]) / 2, b = (mid[1] + nxt[1]) / 2;
  const far = dot(w.lo, V.n) - 10;
  const o = [0, 1, 2].map((k) => V.e1[k] * a + V.e2[k] * b + V.n[k] * far) as V3;
  const iv = materialAlong(w.mesh, o, V.n);
  let best = s.offset, bd = Infinity;
  for (const [t0, t1] of iv) {
    const c = far + (t0 + t1) / 2;
    if (Math.abs(c - s.offset) < bd) (bd = Math.abs(c - s.offset)), (best = c);
  }
  return r1(best);
}

/** A copy: a leg or an end becomes the next one, a named section gets the next number, others „Section n“ */
function copyName(secs: Section[], s: Section): Pick<Section, 'name' | 'role' | 'n'> {
  if (s.name) {
    const m = /^(.*?)(\d+)$/.exec(s.name);
    let n = m ? Number(m[2]) + 1 : 2;
    const stem = m ? m[1] : s.name + ' ';
    while (secs.some((x) => x.name === stem + n)) n++;
    return { name: stem + n };
  }
  if (s.role === 'leg' || s.role === 'end') return { name: '', role: s.role, n: Math.max(0, ...secs.filter((x) => x.role === s.role).map((x) => x.n ?? 1)) + 1 };
  return { name: '' };
}

// ---- Drawing ----

export function ribsDraw(req: GenDrawRequest, p: Params): GenDrawing {
  const view = asView(req.view);
  const st = stateOf(req);
  const secs = st.secs ?? sectionsOf(p);
  const w = worldOf(p);
  if (!w) return { frame: { x0: -50, y0: -50, x1: 50, y1: 50 }, items: [] };
  const V = VIEWS[view];
  const range = (e: V3) => [Math.min(dot(w.lo, e), dot(w.hi, e)), Math.max(dot(w.lo, e), dot(w.hi, e))];
  const [a0, a1] = range(V.e1), [b0, b1] = range(V.e2);
  const frame = { x0: a0, y0: -b1, x1: a1, y1: -b0 };
  const layers: GenLayer[] = [];

  // Silhouette: all triangles projected into the view
  const meshKey = `ribs-mesh|${worldKey}|${view}`;
  if (req.have.includes(meshKey)) layers.push({ key: meshKey });
  else {
    const P = w.mesh.pos, T = w.mesh.tri;
    const tris: number[] = [];
    for (let i = 0; i < T.length; i++) {
      const j = T[i] * 3;
      const q: V3 = [P[j], P[j + 1], P[j + 2]];
      tris.push(r1(dot(q, V.e1)), r1(-dot(q, V.e2)));
    }
    layers.push({ key: meshKey, tris, alpha: 0.14 });
  }

  // Parts as outlines (spine darker); they change only with the parameters
  const L = ribsLayout(p);
  if (L) {
    const partsKey = `ribs-parts|${layoutKey(p)}|${view}`;
    if (req.have.includes(partsKey)) layers.push({ key: partsKey });
    else {
      const th = Number(p.thickness) || 3;
      const items: GenItem[] = [];
      for (const part of [...L.ribs, ...L.spine]) {
        const spine = part.key.startsWith('S');
        const { o, u, v, n } = part.pose;
        for (const poly of part.polys)
          items.push({
            type: 'line', closed: true, style: spine ? 'normal' : 'accent', alpha: spine ? 0.55 : 0.45, width: spine ? 1.2 : 0.8,
            pts: poly.map((q) => onView(view, [0, 1, 2].map((k) => o[k] + u[k] * q.x + v[k] * q.y + n[k] * th / 2) as V3)),
          });
      }
      layers.push({ key: partsKey, items });
    }
  }

  const items: GenItem[] = [];
  // Simple axis: dashed
  if (!secs.length && !st.drawing && L?.sections[0]) items.push({ type: 'line', dash: true, style: 'accent', width: 1.5, pts: L.sections[0].axis.map((q) => onView(view, q)) });
  const sel = req.selected[LIST] ?? -1;
  // The selected section last, so it is on top and hit first
  const order = secs.map((_, i) => i).filter((i) => i !== sel);
  if (sel >= 0 && sel < secs.length) order.push(sel);
  const axis = (s: Section, active: boolean, i: number | null, name: string) => {
    const native = s.view === view;
    const pts = s.pts.map((q) => onView(view, secPoint3(s, q)));
    if (i === null && st.mouse) pts.push(st.mouse);
    const style = active ? 'accent' : 'normal';
    items.push({ type: 'line', pts, ...(native ? {} : { dash: true }), style, width: active ? 2.5 : 1.5, ...(i !== null ? { id: `l${i}` } : {}) });
    if (native) s.pts.forEach((_, k) => items.push({ type: 'handle', x: pts[k][0], y: pts[k][1], id: i !== null ? `p${i}.${k}` : `d${k}`, style, size: active ? 4 : 3 }));
    if (pts.length) items.push({ type: 'text', x: pts[0][0], y: pts[0][1], text: name, style });
  };
  for (const i of order) axis(secs[i], i === sel, i, sectionName(secs[i], i));
  if (st.drawing) axis(st.drawing, true, null, sectionName(st.drawing, secs.length));
  return { frame, layers, items, ...(st.drawing ? { track: true, cursor: 'crosshair' } : {}) };
}

// ---- Pointer ----

function finish(p: Params, secs: Section[], d: Section): GenSurfaceResult {
  if (d.pts.length < 2) return { state: null, message: '' };
  const done = { ...d, offset: centerOffset(p, { ...d, offset: 0 }) };
  return { state: null, message: '', patch: { sections: json([...secs, done]) }, select: { [LIST]: secs.length } };
}

export function ribsPointer(ev: GenPointer, s: GenSurfaceState, p: Params): GenSurfaceResult | void {
  const view = asView(s.view);
  const st = stateOf(s);
  const secs = st.secs ?? sectionsOf(p);
  const m: [number, number] = [r1(ev.x), r1(-ev.y)];
  if (ev.type === 'select') {
    const sec = secs[ev.row ?? -1];
    return sec ? { view: sec.view } : undefined;
  }
  if (ev.type === 'key') {
    if (!st.drawing) return;
    if (ev.key === 'Enter') return finish(p, secs, st.drawing);
    if (ev.key === 'Escape') return { state: null, message: '' };
    return;
  }
  if (ev.type === 'down') {
    if (st.drawing) return { state: { ...st, drawing: { ...st.drawing, pts: [...st.drawing.pts, m] } } };
    const hit = /^([pl])(\d+)(?:\.(\d+))?$/.exec(ev.hit ?? '');
    if (!hit) return;
    const i = Number(hit[2]);
    if (!secs[i]) return;
    const kind = hit[1] === 'p' ? 'point' : secs[i].view === view ? 'move' : 'offset';
    return { state: { secs: secs.map(copySec), drag: { kind, s: i, k: Number(hit[3] ?? 0), orig: copySec(secs[i]) } }, select: { [LIST]: i } };
  }
  if (ev.type === 'move') {
    if (st.drawing) return { state: { ...st, mouse: [r1(ev.x), r1(ev.y)] } };
    if (!st.drag || !ev.from) return;
    const d = st.drag;
    const next = secs.map(copySec);
    const sec = next[d.s];
    if (!sec) return;
    const from: [number, number] = [ev.from.x, -ev.from.y];
    if (d.kind === 'point') sec.pts[d.k] = m;
    else if (d.kind === 'move') sec.pts = d.orig.pts.map((q) => [r1(q[0] + m[0] - from[0]), r1(q[1] + m[1] - from[1])]);
    else {
      // Another view: dragging moves the plane along its normal
      const V = VIEWS[view], N = VIEWS[sec.view].n;
      sec.offset = r1(d.orig.offset + (m[0] - from[0]) * dot(V.e1, N) + (m[1] - from[1]) * dot(V.e2, N));
    }
    return { state: { ...st, secs: next } };
  }
  if (ev.type === 'up') {
    if (!st.drag) return;
    return { state: null, patch: { sections: json(secs) } };
  }
  if (ev.type === 'dblclick') {
    if (!st.drawing) return;
    // The double click set two points at the same place
    const pts = [...st.drawing.pts];
    while (pts.length > 1 && Math.hypot(pts[pts.length - 1][0] - pts[pts.length - 2][0], pts[pts.length - 1][1] - pts[pts.length - 2][1]) < 0.5) pts.pop();
    return finish(p, secs, { ...st.drawing, pts });
  }
  if (ev.type === 'context') {
    const hit = /^p(\d+)\.(\d+)$/.exec(ev.hit ?? '');
    if (!hit) return;
    const i = Number(hit[1]), k = Number(hit[2]);
    if (!secs[i] || secs[i].pts.length <= 2) return;
    return { patch: { sections: json(secs.map((x, n) => (n === i ? { ...x, pts: x.pts.filter((_, j) => j !== k) } : x))) } };
  }
}

// ---- Buttons ----

export function ribsEvent(ev: GenEvent, p: Params): GenEventResult | void {
  const secs = sectionsOf(p);
  const view = asView(ev.surface?.view ?? 'xz');
  switch (ev.action) {
    case 'suggest': {
      const m = getMesh(String(p.model ?? ''));
      if (!m) return;
      const res = suggestSections(m, p);
      if (!res.sections.length) return { message: res.found };
      return {
        patch: { sections: json(res.sections) }, view: res.sections[0].view, select: { [LIST]: 0 }, state: null,
        message: t('Vorschlag: {found}. Achsen prüfen und bei Bedarf ziehen.', { found: res.found }),
      };
    }
    case 'manual': {
      // From the simple axis to sections: the axis becomes the body
      const s0 = ribsLayout(p)?.sections[0];
      if (!s0) return startDrawing(view);
      const V = VIEWS[s0.view];
      const body: Section = { name: '', role: 'body', view: s0.view, pts: s0.axis.map((q) => [r1(dot(q, V.e1)), r1(dot(q, V.e2))]), offset: r1(s0.offset), spacing: 0, radius: 0, extend: 0 };
      return { patch: { sections: json([body]) }, view: s0.view, select: { [LIST]: 0 }, state: null };
    }
    case 'draw':
      return startDrawing(view);
    case 'simple':
      return { patch: { sections: '' }, select: { [LIST]: -1 }, state: null };
    case 'copy': {
      const s = secs[ev.row ?? -1];
      if (!s) return;
      // Mirrored when off the middle, e.g. for the second leg
      const { role: _r, n: _n, ...plain } = copySec(s);
      const c: Section = { ...plain, ...copyName(secs, s), offset: Math.abs(s.offset) > 0.5 ? -s.offset : s.offset };
      return { patch: { sections: json([...secs, c]) }, select: { [LIST]: secs.length } };
    }
    case 'center': {
      const i = ev.row ?? -1;
      if (!secs[i]) return;
      return { patch: { sections: json(secs.map((x, k) => (k === i ? { ...x, offset: centerOffset(p, x) } : x))) } };
    }
  }
}

function startDrawing(view: View): GenEventResult {
  return {
    state: { drawing: { name: '', view, pts: [], offset: 0, spacing: 0, radius: 0, extend: 0 } },
    message: t('Klicken setzt Punkte der Achse, Doppelklick oder Enter beendet, Esc bricht ab.'),
  };
}
