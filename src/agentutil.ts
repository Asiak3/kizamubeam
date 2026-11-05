// Gemeinsame Typen und Hilfen der Werkzeuge für KI-Agenten (siehe agent.ts).
// Nach außen gelten Maschinenkoordinaten: Ursprung unten links, y nach oben, mm.
import { shownText } from './vartext';
import { hasPlaceholders } from './params';
import { barcodeData } from './barcode';
import type { Editor } from './editor';
import { boundsOf, Box, shapeSubs, subsToD, textOutline } from './geom';
import { apply, CutSettings, IDENT, isOff, layerLabel, Mat, mul, Obj } from './model';
import { shapeCenters } from './arcs';
import { library } from './materials';
import { genLabel } from './generators';

/** Stufen, wie im Rust-Teil: 1 Lesen, 2 Entwerfen, 3 G-Code, 4 Maschine */
export enum Tier {
  Read = 1,
  Edit = 2,
  GCode = 3,
  Machine = 4,
}

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export type Args = Record<string, unknown>;

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  tier: Tier;
  inputSchema: Record<string, unknown>;
  /** Verwaltet Undo selbst (undo, redo, Dokument öffnen) */
  ownUndo?: boolean;
  run: (ed: Editor, args: Args) => Promise<Content[] | object> | Content[] | object;
}

/** Fehler, die der Agent als Werkzeugergebnis sieht (statt als Protokollfehler) */
export class ToolError extends Error {}

// ---------- Protokoll der Aufrufe ----------

export interface LogEntry {
  time: Date;
  tool: string;
  summary: string;
  ok: boolean;
}
export const agentLog: LogEntry[] = [];
const logListeners = new Set<() => void>();
export const onAgentLog = (f: () => void) => (logListeners.add(f), () => logListeners.delete(f));
export function log(e: LogEntry) {
  agentLog.push(e);
  if (agentLog.length > 200) agentLog.shift();
  logListeners.forEach((f) => f());
}


// ---------- Hilfen ----------

export const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Rahmen in Maschinenkoordinaten (x, y = linke untere Ecke) */
export function machineBox(ed: Editor, b: Box | null) {
  if (!b) return null;
  return { x: r3(b.x), y: r3(ed.doc.bed.h - b.y - b.h), w: r3(b.w), h: r3(b.h) };
}

/** Welt (y nach unten) → Maschine (y nach oben) */
export const flip = (ed: Editor): Mat => [1, 0, 0, -1, 0, ed.doc.bed.h];

/** Drehung in Grad gegen den Uhrzeigersinn, wie sie in der Oberfläche erscheint */
export const rotationOf = (m: Mat) => r3((-Math.atan2(m[1], m[0]) * 180) / Math.PI);

export function describe(ed: Editor, o: Obj, parent: Mat, detail: boolean): Record<string, unknown> {
  const m = mul(parent, o.m);
  const s = o.shape;
  const out: Record<string, unknown> = {
    id: o.id,
    type: s.kind,
    layer: o.layer,
    bounds: machineBox(ed, boundsOf([o], parent)),
  };
  if (o.name) out.name = o.name;
  if (o.hidden) out.hidden = true;
  if (o.showIf) out.showIf = { condition: o.showIf, shown: !isOff(o) };
  if (o.bind) out.formulas = o.bind;
  if (o.locked) out.locked = true;
  if (o.noLaser) out.noLaser = true;
  const rot = rotationOf(m);
  if (rot) out.rotation = rot;
  // Maße werden nach der Skalierung angegeben, also so groß, wie das Objekt auf dem Bett ist
  const sx = Math.hypot(m[0], m[1]),
    sy = Math.hypot(m[2], m[3]);
  if (Math.abs(sx - 1) > 1e-6 || Math.abs(sy - 1) > 1e-6) out.scale = { x: r3(sx), y: r3(sy) };
  switch (s.kind) {
    case 'rect':
      Object.assign(out, { width: r3(s.w * sx), height: r3(s.h * sy), cornerRadius: r3(s.r * Math.min(sx, sy)) });
      break;
    case 'ellipse':
      Object.assign(out, { rx: r3(s.rx * sx), ry: r3(s.ry * sy) });
      break;
    case 'polygon':
      // Bei ungleichmäßiger Skalierung gilt der Radius vor der Skalierung (siehe scale)
      Object.assign(out, { sides: s.sides, radius: r3(Math.abs(sx - sy) < 1e-6 ? s.r * sx : s.r), star: s.star, ...(s.star ? { innerRatio: s.inner } : {}) });
      break;
    case 'path':
      Object.assign(out, { subpaths: s.subs.length, nodes: s.subs.reduce((n, sp) => n + sp.nodes.length, 0), closed: s.subs.every((sp) => sp.closed) });
      break;
    case 'text':
      Object.assign(out, { text: s.text, font: s.font, size: r3(s.size * sy), bold: s.bold, italic: s.italic, align: s.align });
      if (s.weld) out.weld = true;
      if (s.path) out.onPath = { offset: r3(s.path.offset), distance: r3(s.path.dist), flip: s.path.flip, shape: s.path.link ?? null };
      if (s.vt) out.variable = { offset: s.vt.offset, shown: shownText(s) };
      else if (hasPlaceholders(s.text)) out.shown = shownText(s);
      if (s.maxW) out.maxWidth = r3(s.maxW * sx);
      if (s.maxH) out.maxHeight = r3(s.maxH * sy);
      if (s.fit === 'shrink') out.fitShrink = true;
      if (s.fit === 'wrap') out.wrap = true;
      break;
    case 'barcode':
      if (s.type === 'qr') Object.assign(out, { type: s.type, data: s.data, errorCorrection: s.ec, size: r3(s.size * sx), invert: s.invert, quietZone: s.quiet });
      else
        Object.assign(out, {
          type: s.type, data: s.data, barcodeWidth: r3(s.size * sx), barcodeHeight: r3((s.height ?? 15) * sy), showText: !!s.text,
          checkDigit: !!s.check, barWidthReduction: s.bwr ?? 0, invert: s.invert, quietZone: s.quiet,
        });
      if (s.vt) out.variable = { offset: s.vt.offset, shown: barcodeData(s) };
      else if (hasPlaceholders(s.data)) out.shown = barcodeData(s);
      break;
    case 'gen':
      Object.assign(out, { generator: s.gen, label: genLabel(s), params: s.params }, s.part ? { part: s.part } : {}, s.bind ? { bind: s.bind } : {});
      break;
    case 'image':
      Object.assign(out, { file: s.name ?? null, pixels: `${s.pxW}×${s.pxH}` });
      break;
    case 'group':
      out.children = s.children.map((c) => describe(ed, c, m, detail));
      break;
  }
  // Kreise und Bögen (auch Löcher in Pfaden) mit Mittelpunkt in Maschinenkoordinaten
  if (s.kind === 'path' || s.kind === 'gen' || s.kind === 'rect') {
    const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const fm = mul(flip(ed), m);
    const cs = listedCircles(s);
    if (cs.length)
      out.circles = cs.slice(0, 50).map((c) => {
        const p = apply(fm, c.x, c.y);
        return { center: { x: r3(p.x), y: r3(p.y) }, radius: r3((c.r ?? 0) * k), ...(c.kind === 'arc' ? { arcDegrees: r3(((c.sweep ?? 0) * 180) / Math.PI) } : {}) };
      });
  }
  if (detail && s.kind !== 'group' && s.kind !== 'image') {
    const subs = s.kind === 'text' ? textOutline(s)?.subs ?? null : shapeSubs(s);
    // Umriss als SVG-Pfad in Maschinenkoordinaten
    if (subs) out.svgPath = subsToD(subs, mul(flip(ed), m));
  }
  return out;
}

/** Kreise und Bögen eines Pfads, wie get_document sie unter circles meldet (Bögen über 90°) */
export function listedCircles(s: Obj['shape']) {
  return shapeCenters(s, () => shapeSubs(s)).filter((c) => c.kind === 'circle' || (c.sweep ?? 0) >= Math.PI / 2 + 0.01);
}

export function findObj(objs: Obj[], id: number, parent: Mat = IDENT): [Obj, Mat] | null {
  for (const o of objs) {
    if (o.id === id) return [o, parent];
    if (o.shape.kind === 'group') {
      const r = findObj(o.shape.children, id, mul(parent, o.m));
      if (r) return r;
    }
  }
  return null;
}

/** Modusabhängige Bearbeitungsfelder eines Layers oder Sub-Layers für Agenten (nur eingeschaltete Extras) */
function cutInfo(L: Omit<CutSettings, 'air' | 'look' | 'sub'>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (L.mode === 'line') {
    out.kerf = L.kerf;
    out.tabs = L.tabs.enabled ? L.tabs : false;
    if (L.perf.enabled) Object.assign(out, { perforate: true, perfLength: L.perf.on, perfGap: L.perf.off });
    if (L.lead.leadIn || L.lead.leadOut) Object.assign(out, { leadIn: L.lead.leadIn, leadOut: L.lead.leadOut, leadLength: L.lead.length, leadAngle: L.lead.angle, leadArc: L.lead.arc });
    if (L.lead.overcut > 0) out.overcut = L.lead.overcut;
    if (L.ramp.enabled) Object.assign(out, { powerRamp: true, rampLength: L.ramp.length, rampAngle: L.ramp.angle, rampEnds: L.ramp.ends });
  } else {
    Object.assign(out, { fillStyle: L.fillStyle, interval: L.interval, angle: L.angle, crossHatch: L.crossHatch, bidirectional: L.bidirectional, overscan: L.overscan });
  }
  if (L.zOffset || L.zStep) Object.assign(out, { zOffset: L.zOffset, zStep: L.zStep });
  return out;
}

export function layerInfo(ed: Editor, i: number) {
  const L = ed.layer(i);
  const parts = ed.layerParts(i);
  const out: Record<string, unknown> = {
    index: i,
    label: layerLabel(i),
    name: L.name,
    color: ed.layerDrawColor(i),
    output: L.output,
    visible: L.show,
    locked: L.locked === true,
    contains: [parts.vec && 'vectors', parts.img && 'images'].filter(Boolean),
    mode: L.mode,
    speed: L.speed,
    power: L.power,
    minPower: L.minPower,
    passes: L.passes,
    airAssist: L.air,
  };
  Object.assign(out, cutInfo(L));
  if (L.sub?.length) out.subLayers = L.sub.map((s) => ({ output: s.output, mode: s.mode, speed: s.speed, power: s.power, minPower: s.minPower, passes: s.passes, ...cutInfo(s) }));
  if (parts.img) out.image = ed.imgLayer(i);
  if (L.material) {
    const e = library.get(L.material);
    if (e) out.material = { id: e.id, material: e.material, thickness: e.thickness, title: e.title };
  }
  return out;
}

export const json = (v: unknown): Content[] => [{ type: 'text', text: JSON.stringify(v, null, 1) }];

/** Seiten des Projekts für Agenten (Nummern ab 1 wie in der Oberfläche) */
export const pageList = (ed: Editor) =>
  ed.doc.pages.map((p, i) => ({ page: i + 1, name: p.name, objectCount: p.objs.length, ...(i === ed.doc.page ? { current: true } : {}) }));
