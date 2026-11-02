// Jig benutzen (Etappe J3): Jigs im Dokument finden, Lage ihrer Fächer und Passermarken in Weltkoordinaten,
// Design auf Fächer verteilen. Ohne DOM, damit es sich testen lässt.
import { flattenSub, SCALE } from './clip';
import { boundsOf } from './geom';
import { decodeShapes, JigLayout, jigLayout, JigParams, JigShape } from './generators/jig';
import { apply, cloneObjs, IDENT, inv, Mat, mul, newId, Obj, Pt, rotate, translate } from './model';

export interface JigRef {
  /** Objekt der obersten Ebene (das Bauteil selbst oder die Gruppe aus Bauteil und Gravur) */
  top: Obj;
  /** Das Generator-Bauteil */
  part: Obj;
  /** Welt-Matrix des Bauteils */
  world: Mat;
  params: JigParams;
  shapes: JigShape[];
  layout: JigLayout;
}

function* walk(objs: Obj[], parent: Mat, top: Obj | null): Generator<[Obj, Mat, Obj]> {
  for (const o of objs) {
    const m = mul(parent, o.m);
    const tp = top ?? o;
    if (o.shape.kind === 'group') yield* walk(o.shape.children, m, tp);
    else yield [o, m, tp];
  }
}

/** Alle Jigs einer Seite (auch ausgeblendete: ein schon gelaserter Jig bleibt oft nur als Vorlage liegen) */
export function findJigs(objs: Obj[]): JigRef[] {
  const out: JigRef[] = [];
  for (const [o, world, top] of walk(objs, IDENT, null)) {
    if (o.shape.kind !== 'gen' || o.shape.gen !== 'jig') continue;
    const params = o.shape.params as unknown as JigParams;
    const shapes = decodeShapes(String(params.shapes ?? '[]'));
    out.push({ top, part: o, world, params, shapes, layout: jigLayout(params, shapes) });
  }
  return out;
}

/** Lage eines Fachs: lokale Matrix im Jig (Verschiebung zur Fachmitte, Drehung des Werkstücks) */
export const slotMatrix = (j: JigRef, i: number): Mat => {
  const s = j.layout.slots[i];
  return mul(translate(s.c.x, s.c.y), rotate((s.rot * Math.PI) / 180));
};

/** Mitte eines Fachs in Weltkoordinaten */
export const slotCenter = (j: JigRef, i: number): Pt => apply(j.world, j.layout.slots[i].c.x, j.layout.slots[i].c.y);

/** Passermarken des Jigs in Weltkoordinaten (Reihenfolge: oben links, oben rechts, unten links) */
export const jigMarkCenters = (j: JigRef): Pt[] => j.layout.markCenters.map((c) => apply(j.world, c.x, c.y));

/** Halbe kleinste Ausdehnung einer Werkstückart: so nah muss eine Designmitte an der Fachmitte liegen */
function reach(sh: JigShape): number {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const sp of sh.s)
    for (const q of flattenSub(sp, IDENT)) ((x0 = Math.min(x0, q.X)), (x1 = Math.max(x1, q.X)), (y0 = Math.min(y0, q.Y)), (y1 = Math.max(y1, q.Y)));
  return isFinite(x0) ? Math.min(x1 - x0, y1 - y0) / SCALE / 2 : 0;
}

/** Fach, auf dem ein Punkt (z. B. die Mitte des Designs) liegt, sonst -1 */
export function slotAt(j: JigRef, p: Pt): number {
  let best = -1, bestD = Infinity;
  j.layout.slots.forEach((s, i) => {
    const c = slotCenter(j, i);
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < reach(j.shapes[s.shape]) && d < bestD) ((best = i), (bestD = d));
  });
  return best;
}

/** Größte Ausdehnung einer Werkstückart */
function extent(sh: JigShape): number {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const sp of sh.s)
    for (const q of flattenSub(sp, IDENT)) ((x0 = Math.min(x0, q.X)), (x1 = Math.max(x1, q.X)), (y0 = Math.min(y0, q.Y)), (y1 = Math.max(y1, q.Y)));
  return isFinite(x0) ? Math.max(x1 - x0, y1 - y0) / SCALE : 0;
}

/**
 * Bezugsfach eines Designs mit dem Rahmen box: das Fach unter seiner Mitte, aber nur wenn das Design nicht viel
 * größer als das Werkstück ist (sonst liegt es nur zufällig mit der Mitte dort). -1 = keins.
 */
export function refSlot(j: JigRef, box: { x: number; y: number; w: number; h: number }): number {
  const i = slotAt(j, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
  if (i < 0) return -1;
  return Math.max(box.w, box.h) <= extent(j.shapes[j.layout.slots[i].shape]) * 1.5 + 5 ? i : -1;
}

/**
 * Matrix, die ein Design in Fach i legt. Liegt das Design schon auf Fach ref, behält jede Kopie dieselbe Lage
 * relativ zu ihrem Fach (auch Drehung). Sonst kommt die Mitte d des Designs auf die Fachmitte, ausgerichtet wie der Jig.
 */
export function placeMatrix(j: JigRef, i: number, ref: number, d: Pt): Mat {
  const S = mul(j.world, slotMatrix(j, i));
  if (ref >= 0) return mul(S, inv(mul(j.world, slotMatrix(j, ref))));
  const L: Mat = [j.world[0], j.world[1], j.world[2], j.world[3], 0, 0];
  return mul(S, mul(inv(L), translate(-d.x, -d.y)));
}

/**
 * Fächer aus einer Eingabe wie „1-5, 8, 10-12“ (Fachnummern ab 1); leer oder „alle“ = alle.
 * Liefert die Indizes (ab 0) sortiert und ohne Doppelte; null bei unlesbarer Eingabe.
 */
export function parseSlotRange(src: string, n: number): number[] | null {
  const s = src.trim().toLowerCase();
  if (!s || s === 'alle' || s === 'all' || s === '*') return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part);
    if (!m) return null;
    let a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    for (let k = a; k <= b; k++) if (k >= 1 && k <= n) out.add(k - 1);
  }
  return [...out].sort((x, y) => x - y);
}

/** Variablen Text in einer Kopie auf eine Nummer setzen (Versatz zur aktuellen Nummer) */
export function setVtOffset(o: Obj, offset: number): number {
  let n = 0;
  const visit = (x: Obj) => {
    const s = x.shape;
    if ((s.kind === 'text' || s.kind === 'barcode') && s.vt) ((s.vt = { ...s.vt, offset }), n++);
    if (s.kind === 'group') s.children.forEach(visit);
  };
  visit(o);
  return n;
}

export interface FillOptions {
  /** Variablen Text je Fach weiterzählen */
  series: boolean;
  group: boolean;
  hideJig: boolean;
  /** Liegt das Design auf keinem Fach: Vorlage danach ausblenden */
  hideTemplate: boolean;
  /** Name einer Gruppe je Fach ({n} = Fachnummer) */
  groupName?: (nr: number) => string;
}

/**
 * Design (Objekte der obersten Ebene) auf die Fächer picks (Indizes, in Reihenfolge) des Jigs legen. Liegt das Design
 * auf einem der Fächer, bleibt es das Design dieses Fachs. Fügt die Kopien in objs ein und liefert sie.
 */
export function fillJig(objs: Obj[], design: Obj[], jig: JigRef, picks: number[], o: FillOptions): Obj[] {
  const box = boundsOf(design);
  if (!box || !picks.length) return [];
  const d = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  const ref = refSlot(jig, box);
  const made: Obj[] = [];
  picks.forEach((slot, k) => {
    if (slot === ref) {
      if (o.series) design.forEach((x) => setVtOffset(x, k));
      return;
    }
    const M = placeMatrix(jig, slot, ref, d);
    const copies = cloneObjs(design);
    copies.forEach((c, i) => {
      c.m = mul(M, design[i].m);
      delete c.hidden;
      if (o.series) setVtOffset(c, k);
    });
    if (o.group && copies.length > 1)
      made.push({ id: newId(), m: IDENT, layer: copies[0].layer, shape: { kind: 'group', children: copies }, ...(o.groupName ? { name: o.groupName(slot + 1) } : {}) });
    else made.push(...copies);
  });
  objs.push(...made);
  if (ref < 0 && o.hideTemplate) design.forEach((x) => (x.hidden = true));
  if (o.hideJig) jig.top.hidden = true;
  return made;
}
