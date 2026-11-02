// Werkzeuge der Stufe „Entwerfen“ für KI-Agenten: Formen und Text anlegen, ändern, anordnen, Boolesche
// Operationen, Offset, Arrays, Biegeschnitte, Verbindungen, Layer, Import und Dateien. Jeder Aufruf ist ein
// Undo-Schritt (siehe Editor.batch in agent.ts). Koordinaten: Maschine, Ursprung unten links, y nach oben, mm.
import type { Editor } from './editor';
import { boundsOf, Box, segments, shapeSubs, textLayout } from './geom';
import { fillJig, findJigs, parseSlotRange, refSlot } from './jigUse';
import { about, apply, BarcodeShape, CutSettings, defaultSubLayer, SubLayer, LinearType, IDENT, NOTE_KEYS, ObjBindKey, leaves, Mat, mul, newId, Obj, QrLevel, rotate, scale, Shape, SubPath, TextShape, translate } from './model';
import { barcodeData, qrMatrix } from './barcode';
import { encodeLinear, LINEAR_TYPES } from './barcode1d';
import { advanceVarText } from './vartext';
import { BoolOp, OffsetOptions } from './ops';
import { WARP_KINDS } from './warp';
import { circularMatrices, DEFAULT_GRID, gridMatrices, GridOptions } from './arrays';
import { DEFAULT_HINGE, HingeKind, HingeOptions, suggestHinge } from './hinges';
import { DEFAULT_JOINT, EdgePick, isStraight, JointKind, JointOptions } from './joints';
import { importSvg, parsePathData, transformSubs } from './importers';
import { buildDxfText, buildPdfBytes, buildSvg, bytesToBase64, importBytesOrThrow } from './files';
import { t } from './i18n';
import { library, layerPatch } from './materials';
import { isTauri } from './machine';
import { buildGen, checkInput, GENERATORS, getGenerator, normalizeParams, resolveBinds } from './generators';
import type { Generator, Params } from './generators';
import { coerce, ParamType, ProjectParam } from './params';
import { genLeaves } from './editor/generators';
import { builtinTemplates } from './builtinTemplates';
import { packTemplates } from './packs';
import { addToLibrary, loadLibraryAsset } from './assetLibrary';
import { ASSET_CATEGORIES, AssetCategory, parseTags } from './assetFormat';
import { defaultTemplate, guessColumns, tableRows, listTemplates, readTemplate, templateFields, templateFileName, templateJson, writeTemplate } from './templates';
import { DEFAULT_NEST_SETTINGS, NestSettings } from './editor/nest';
import { tabNameFromPath } from './editor/tabs';
import { Args, describe, findObj, flip, machineBox, pageList, r3, Tier, ToolDef, ToolError } from './agentutil';
import { CheckIssue, fixLabel, loadCheckSettings } from './check';

// ---------- Eingaben prüfen ----------

function num(a: Args, key: string, opt: { def?: number; min?: number; max?: number; int?: boolean } = {}): number {
  const v = a[key];
  if (v === undefined || v === null) {
    if (opt.def !== undefined) return opt.def;
    throw new ToolError(`„${key}“ fehlt`);
  }
  const n = Number(v);
  if (!isFinite(n)) throw new ToolError(`„${key}“ ist keine Zahl`);
  if (opt.min !== undefined && n < opt.min) throw new ToolError(`„${key}“ muss mindestens ${opt.min} sein`);
  if (opt.max !== undefined && n > opt.max) throw new ToolError(`„${key}“ darf höchstens ${opt.max} sein`);
  return opt.int ? Math.round(n) : n;
}
const optNum = (a: Args, key: string, opt: { min?: number; max?: number; int?: boolean } = {}) =>
  a[key] === undefined || a[key] === null ? undefined : num(a, key, opt);
const bool = (a: Args, key: string, def: boolean) => (a[key] === undefined ? def : a[key] === true);
function oneOf<T extends string>(a: Args, key: string, values: readonly T[], def?: T): T {
  const v = a[key] ?? def;
  if (v === undefined) throw new ToolError(`„${key}“ fehlt`);
  if (!values.includes(v as T)) throw new ToolError(`„${key}“ muss einer von ${values.join(', ')} sein`);
  return v as T;
}
function ids(a: Args, key = 'ids'): number[] {
  const v = a[key];
  if (!Array.isArray(v) || !v.length) throw new ToolError(`„${key}“ braucht mindestens eine Objekt-id`);
  return v.map((x) => Number(x));
}
/** Seitennummer (ab 1) → Index */
function pageIndex(ed: Editor, a: Args, key: string): number {
  const n = num(a, key, { min: 1, int: true });
  if (n > ed.doc.pages.length) throw new ToolError(`Keine Seite ${n} (das Projekt hat ${ed.doc.pages.length})`);
  return n - 1;
}
const layerOf = (ed: Editor, a: Args) => num(a, 'layer', { def: ed.currentLayer, min: 0, max: 31, int: true });

/** Objekte der obersten Ebene zu ids (Objekte in Gruppen erst mit ungroup herauslösen) */
function topObjs(ed: Editor, list: number[]): Obj[] {
  return list.map((id) => {
    const o = ed.doc.objs.find((x) => x.id === id);
    if (o) return o;
    if (findObj(ed.doc.objs, id)) throw new ToolError(`Objekt ${id} liegt in einer Gruppe; erst die Gruppe auflösen (ungroup) oder die Gruppe verwenden`);
    throw new ToolError(`Kein Objekt mit id ${id}`);
  });
}

// ---------- Koordinaten ----------

/** Maschine → Welt (y nach unten) */
const W = (ed: Editor, x: number, y: number) => ({ x, y: ed.doc.bed.h - y });

/** Ergebnis eines ändernden Aufrufs: neue und entfernte Objekte, Hinweis des Editors */
function result(ed: Editor, before: Set<number>, extra: Record<string, unknown> = {}) {
  const now = new Set(ed.doc.objs.map((o) => o.id));
  const created = ed.doc.objs.filter((o) => !before.has(o.id)).map((o) => describe(ed, o, IDENT, false));
  const removed = [...before].filter((id) => !now.has(id));
  return {
    ...(created.length ? { created } : {}),
    ...(removed.length ? { removed } : {}),
    ...extra,
    ...(ed.hint ? { message: ed.hint } : {}),
  };
}
const snapshotIds = (ed: Editor) => new Set(ed.doc.objs.map((o) => o.id));

/** Befund aus „Konstruktion prüfen“ für Agenten */
function issueInfo(ed: Editor, x: CheckIssue, index: number) {
  const pts = [...x.lines.flat(), ...x.pts];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const box = pts.length ? machineBox(ed, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }) : null;
  return { index, kind: x.kind, level: x.level, message: x.msg, ids: x.objs.map((o) => o.id), area: box, ...(x.fix ? { fix: fixLabel(x.fix) } : {}) };
}

/** Neues Objekt anlegen, optional gedreht (Grad gegen den Uhrzeigersinn um die Mitte) */
function addObj(ed: Editor, shape: Shape, m: Mat, layer: number, rotation = 0): Obj {
  const o: Obj = { id: newId(), m, layer, shape };
  if (rotation) {
    const b = boundsOf([o])!;
    o.m = mul(about(rotate((-rotation * Math.PI) / 180), b.x + b.w / 2, b.y + b.h / 2), o.m);
  }
  ed.layer(layer);
  ed.doc.objs.push(o);
  ed.setSel([o]);
  ed.emit('doc');
  return o;
}

/** variable / variableOffset aus edit_object übernehmen */
function setVar(s: TextShape | BarcodeShape, a: Args) {
  if (a.variable === false) delete s.vt;
  else if (a.variable === true) s.vt ??= { offset: 0 };
  const off = optNum(a, 'variableOffset', { int: true });
  if (off !== undefined) {
    if (!s.vt) throw new ToolError('variableOffset braucht variable=true');
    s.vt.offset = off;
  }
}

const describeAll = (ed: Editor, objs: Obj[]) => objs.map((o) => describe(ed, o, IDENT, false));

// ---------- Schemas ----------

const IDS = { type: 'array', items: { type: 'integer' }, minItems: 1, description: 'Objekt-ids (oberste Ebene, aus get_document)' };
const LAYER = { type: 'integer', minimum: 0, maximum: 31, description: 'Layer 0–29 (Standard: aktueller Layer der Oberfläche)' };
const ROT = { type: 'number', description: 'Drehung in Grad gegen den Uhrzeigersinn um die Mitte' };
const BIND = { type: 'object', description: 'Formeln für Felder nach Schlüssel, mit Projekt-Parametern (siehe project_parameters), z. B. {"thickness": "Dicke", "width": "Breite + 2 * Dicke"}' };
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });

const LAYER_KEYS: Record<string, string> = {
  name: 'string', output: 'boolean', visible: 'boolean', mode: 'line|fill', speed: 'number', power: 'number', minPower: 'number',
  passes: 'integer', airAssist: 'boolean', kerf: 'number', fillStyle: 'scan|offset', interval: 'number', angle: 'number', crossHatch: 'boolean',
  bidirectional: 'boolean', overscan: 'number', locked: 'boolean',
  perforate: 'boolean', perfLength: 'number', perfGap: 'number',
  leadIn: 'boolean', leadOut: 'boolean', leadLength: 'number', leadAngle: 'number', leadArc: 'boolean', overcut: 'number',
  powerRamp: 'boolean', rampLength: 'number', rampAngle: 'number', rampEnds: 'boolean',
  zOffset: 'number', zStep: 'number',
};

/** Felder, die auch Sub-Layer haben (alles außer Name, Sichtbarkeit, Sperre und Air Assist) */
const SUB_FIELDS = Object.keys(LAYER_KEYS).filter((k) => !['name', 'visible', 'locked', 'airAssist'].includes(k));

/**
 * Bearbeitungsfelder aus den Argumenten eines Agenten; verschachtelte Einstellungen (Perforation, Anschnitt,
 * Rampe, Haltestege) werden mit den bisherigen Werten in base zusammengeführt.
 */
function cutPatch(a: Args, base: Pick<CutSettings, 'perf' | 'lead' | 'ramp'>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (a.mode !== undefined) p.mode = oneOf(a, 'mode', ['line', 'fill'] as const);
  if (a.fillStyle !== undefined) p.fillStyle = oneOf(a, 'fillStyle', ['scan', 'offset'] as const);
  const n = (k: string, opt: { min?: number; max?: number; int?: boolean }, as = k) => {
    const v = optNum(a, k, opt);
    if (v !== undefined) p[as] = v;
  };
  n('speed', { min: 1, max: 100000 });
  n('power', { min: 0, max: 100 });
  n('minPower', { min: 0, max: 100 });
  n('passes', { min: 1, max: 100, int: true });
  n('kerf', { min: -5, max: 5 });
  n('interval', { min: 0.01, max: 10 });
  n('angle', { min: -360, max: 360 });
  n('overscan', { min: 0, max: 50 });
  n('zOffset', { min: -50, max: 50 });
  n('zStep', { min: -20, max: 20 });
  if (a.crossHatch !== undefined) p.crossHatch = a.crossHatch === true;
  if (a.bidirectional !== undefined) p.bidirectional = a.bidirectional === true;
  if (a.output !== undefined) p.output = a.output === true;
  const nested = <T extends object>(key: string, cur: T, map: Record<string, [keyof T, 'bool' | { min: number; max: number }]>) => {
    const out = { ...cur };
    let hit = false;
    for (const [arg, [field, kind]] of Object.entries(map)) {
      if (a[arg] === undefined) continue;
      hit = true;
      (out as Record<string, unknown>)[field as string] = kind === 'bool' ? a[arg] === true : optNum(a, arg, kind);
    }
    if (hit) p[key] = out;
  };
  nested('perf', base.perf, { perforate: ['enabled', 'bool'], perfLength: ['on', { min: 0.01, max: 1000 }], perfGap: ['off', { min: 0, max: 1000 }] });
  nested('lead', base.lead, {
    leadIn: ['leadIn', 'bool'], leadOut: ['leadOut', 'bool'], leadLength: ['length', { min: 0, max: 100 }], leadAngle: ['angle', { min: 0, max: 180 }],
    leadArc: ['arc', 'bool'], overcut: ['overcut', { min: 0, max: 100 }],
  });
  nested('ramp', base.ramp, { powerRamp: ['enabled', 'bool'], rampLength: ['length', { min: 0.05, max: 50 }], rampAngle: ['angle', { min: 1, max: 179 }], rampEnds: ['ends', 'bool'] });
  return p;
}

const HINGE_KEYS = ['thickness', 'cutLength', 'bridge', 'spacing', 'margin', 'angle', 'waveAmp', 'waveLength', 'diamondAngle'] as const;
const JOINT_NUM_KEYS = [
  'thickness', 'fingerWidth', 'tenonCount', 'tenonWidth', 'slotOffset', 'lapCount', 'lapDepth', 'snapLip', 'snapLength', 'snapRelief',
  'hookLength', 'wedgeWidth', 'wedgePull', 'boltDia', 'nutWidth', 'nutHeight', 'boltLength', 'hingeCount', 'pinDia', 'pinPlay', 'hingeWall',
  'kerf', 'clearance',
] as const;

/** Parameter eines Generator-Aufrufs (Objekt params) */
/** Formeln für Felder (bind): Schlüssel → Formel mit Projekt-Parametern, leer = Feld wieder fest */
function bindArg(g: Generator, a: Args): Record<string, string> {
  const b = a.bind ?? {};
  if (typeof b !== 'object' || Array.isArray(b) || b === null) throw new ToolError('„bind“ muss ein Objekt sein');
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(b)) {
    if (!g.schema.some((s) => s.key === k)) throw new ToolError(`Unbekannter Parameter „${k}“`);
    if (typeof v !== 'string') throw new ToolError(`bind.${k} muss eine Formel (Text) sein`);
    out[k] = v.trim();
  }
  return out;
}

/** Formeln auswerten und Teile erzeugen; Fehler in Formeln sind Fehler des Aufrufs */
function buildBound(g: Generator, params: Params, bind: Record<string, string>) {
  const rb = resolveBinds(g, params, bind);
  const bad = rb.issues.filter((i) => i.level === 'error');
  if (bad.length) throw new ToolError(bad.map((i) => i.msg).join('; '));
  const r = buildGen(g, rb.params);
  r.issues.unshift(...rb.issues);
  if (Object.keys(bind).length) for (const p of r.parts) p.shape.bind = { ...bind };
  return r;
}

function paramArg(a: Args): Record<string, unknown> {
  const p = a.params ?? {};
  if (typeof p !== 'object' || Array.isArray(p) || p === null) throw new ToolError('„params“ muss ein Objekt sein');
  return p as Record<string, unknown>;
}

/** Beschreibung aller Generatoren und ihrer Parameter für KI-Agenten */
function genDocs(): string {
  return GENERATORS.map((g) => {
    const ps = g.schema.filter((s) => s.type !== 'data').map((s) => {
      const range = s.type === 'enum' ? s.options.map(([k]) => k).join('|') : s.type === 'bool' ? 'true|false' : `${s.type === 'int' ? 'ganzzahlig ' : ''}${s.min}–${s.max}`;
      return `  ${s.key} (${s.label}; ${range}; Standard ${s.def})${s.title ? `: ${s.title}` : ''}`;
    });
    const kind = g.kind === 'assembly' ? ' (Baugruppe: legt mehrere Teile an, nebeneinander zum Ausschneiden)' : '';
    return `${g.id}: ${g.name}${kind}\n${ps.join('\n')}`;
  }).join('\n');
}

// ---------- Werkzeuge ----------

export const EDIT_TOOLS: ToolDef[] = [
  {
    name: 'create_shape',
    title: 'Form anlegen',
    description:
      'Legt eine Form an. rect: x/y = linke untere Ecke, width/height, cornerRadius. ellipse: cx/cy = Mitte, rx/ry. polygon: cx/cy, radius (Umkreis), sides, star, innerRatio. polyline: points [[x,y],…], closed. path: d = SVG-Pfad in Maschinenkoordinaten (mm, y nach oben). Gibt die neue id zurück.',
    tier: Tier.Edit,
    inputSchema: obj({
      type: { type: 'string', enum: ['rect', 'ellipse', 'polygon', 'polyline', 'path'] },
      x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, cornerRadius: { type: 'number' },
      cx: { type: 'number' }, cy: { type: 'number' }, rx: { type: 'number' }, ry: { type: 'number' },
      radius: { type: 'number' }, sides: { type: 'integer', minimum: 3, maximum: 200 }, star: { type: 'boolean' }, innerRatio: { type: 'number' },
      points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } }, closed: { type: 'boolean' },
      d: { type: 'string' }, layer: LAYER, rotation: ROT,
    }, ['type']),
    run: (ed, a) => {
      const type = oneOf(a, 'type', ['rect', 'ellipse', 'polygon', 'polyline', 'path'] as const);
      const layer = layerOf(ed, a);
      const rot = num(a, 'rotation', { def: 0 });
      let o: Obj;
      if (type === 'rect') {
        const w = num(a, 'width', { min: 0.001 }), h = num(a, 'height', { min: 0.001 });
        const r = num(a, 'cornerRadius', { def: 0, min: 0, max: Math.min(w, h) / 2 });
        const p = W(ed, num(a, 'x'), num(a, 'y') + h);
        o = addObj(ed, { kind: 'rect', w, h, r }, translate(p.x, p.y), layer, rot);
      } else if (type === 'ellipse') {
        const rx = num(a, 'rx', { min: 0.001 });
        const ry = num(a, 'ry', { def: rx, min: 0.001 });
        const c = W(ed, num(a, 'cx'), num(a, 'cy'));
        o = addObj(ed, { kind: 'ellipse', rx, ry }, translate(c.x, c.y), layer, rot);
      } else if (type === 'polygon') {
        const c = W(ed, num(a, 'cx'), num(a, 'cy'));
        const shape: Shape = {
          kind: 'polygon', sides: num(a, 'sides', { def: 6, min: 3, max: 200, int: true }), r: num(a, 'radius', { min: 0.001 }),
          star: bool(a, 'star', false), inner: num(a, 'innerRatio', { def: 0.5, min: 0.05, max: 0.95 }),
        };
        o = addObj(ed, shape, translate(c.x, c.y), layer, rot);
      } else if (type === 'polyline') {
        const pts = a.points;
        if (!Array.isArray(pts) || pts.length < 2) throw new ToolError('„points“ braucht mindestens zwei Punkte [x, y]');
        const nodes = pts.map((p, i) => {
          if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => isFinite(Number(v)))) throw new ToolError(`Punkt ${i} ist kein [x, y]`);
          return W(ed, Number(p[0]), Number(p[1]));
        });
        o = addObj(ed, { kind: 'path', subs: [{ nodes, closed: bool(a, 'closed', false) }] }, IDENT, layer, rot);
      } else {
        if (typeof a.d !== 'string' || !a.d.trim()) throw new ToolError('„d“ (SVG-Pfad) fehlt');
        const subs = transformSubs(parsePathData(a.d), flip(ed));
        if (!subs.some((sp) => sp.nodes.length > 1)) throw new ToolError('Der Pfad enthält keine Linien');
        o = addObj(ed, { kind: 'path', subs }, IDENT, layer, rot);
      }
      return { id: o.id, object: describe(ed, o, IDENT, false) };
    },
  },
  {
    name: 'create_text',
    title: 'Text anlegen',
    description:
      'Legt einen Text an. x/y = Anfang der Grundlinie der ersten Zeile (bei align center/right die Mitte bzw. das Ende). size = Schrifthöhe (Em) in mm. Zeilenumbrüche mit \\n. frameWidth > 0 macht einen Textrahmen: Zeilen brechen an dieser Breite (mm) an Wortgrenzen um, die Höhe wächst mit. Schriften: list_fonts.',
    tier: Tier.Edit,
    inputSchema: obj({
      text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, font: { type: 'string' }, size: { type: 'number' },
      bold: { type: 'boolean' }, italic: { type: 'boolean' }, upper: { type: 'boolean', description: 'In Großbuchstaben' },
      align: { type: 'string', enum: ['left', 'center', 'right'] }, letterSpacing: { type: 'number', description: 'Zusätzlicher Zeichenabstand (mm)' },
      lineSpacing: { type: 'number', description: 'Zusätzlicher Zeilenabstand (mm)' },
      weld: { type: 'boolean', description: 'Buchstaben schweißen: überlappende Zeichen zu einer Kontur verschmelzen' },
      frameWidth: { type: 'number', description: 'Breite des Textrahmens in mm (automatischer Zeilenumbruch, 0 = aus)' }, layer: LAYER, rotation: ROT,
    }, ['text', 'x', 'y']),
    run: (ed, a) => {
      if (typeof a.text !== 'string' || !a.text.trim()) throw new ToolError('„text“ ist leer');
      const d = ed.textDefaults;
      const shape: TextShape = {
        kind: 'text', text: a.text,
        font: typeof a.font === 'string' && a.font.trim() ? a.font.trim() : d.font,
        size: num(a, 'size', { def: d.size, min: 0.1, max: 2000 }),
        bold: bool(a, 'bold', false), italic: bool(a, 'italic', false), upper: bool(a, 'upper', false),
        align: oneOf(a, 'align', ['left', 'center', 'right'] as const, 'left'),
        hSpace: num(a, 'letterSpacing', { def: 0 }), vSpace: num(a, 'lineSpacing', { def: 0 }),
      };
      if (bool(a, 'weld', false)) shape.weld = true;
      const fw = num(a, 'frameWidth', { def: 0, min: 0 });
      if (fw > 0) Object.assign(shape, { fit: 'wrap', maxW: fw });
      const p = W(ed, num(a, 'x'), num(a, 'y'));
      const o = addObj(ed, shape, translate(p.x, p.y), layerOf(ed, a));
      const rot = num(a, 'rotation', { def: 0 });
      if (rot) o.m = mul(about(rotate((-rot * Math.PI) / 180), p.x, p.y), o.m);
      return { id: o.id, object: describe(ed, o, IDENT, false), note: 'Rahmen und Umriss stimmen erst, wenn die Schrift geladen ist; render_preview zeigt das Ergebnis.' };
    },
  },
  {
    name: 'create_qr_code',
    title: 'QR-Code anlegen',
    description:
      'Legt einen QR-Code an (Module als geschlossene Umrisse; auf einem Füll-Layer wird er graviert). x/y = Mitte, size = Kantenlänge in mm. errorCorrection L/M/Q/H (Standard M). invert: Hintergrund samt Ruhezone lasern statt der Module (für dunkle Materialien). variable: Platzhalter wie im variablen Text (%# Seriennummer, %0 CSV-Spalte, %Y Jahr …), variableOffset wird zur aktuellen Nummer addiert. WLAN: data "WIFI:T:WPA;S:<Name>;P:<Passwort>;;".',
    tier: Tier.Edit,
    inputSchema: obj({
      data: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, size: { type: 'number', description: 'Kantenlänge in mm (Standard 30)' },
      errorCorrection: { type: 'string', enum: ['L', 'M', 'Q', 'H'] }, invert: { type: 'boolean' },
      quietZone: { type: 'integer', minimum: 0, maximum: 10, description: 'Ruhezone in Modulen (nur bei invert gelasert, Standard 2)' },
      variable: { type: 'boolean' }, variableOffset: { type: 'integer' }, layer: LAYER, rotation: ROT,
    }, ['data', 'x', 'y']),
    run: (ed, a) => {
      if (typeof a.data !== 'string' || !a.data) throw new ToolError('„data“ ist leer');
      const size = num(a, 'size', { def: 30, min: 1, max: 2000 });
      const shape: BarcodeShape = {
        kind: 'barcode', type: 'qr', data: a.data, size,
        ec: oneOf(a, 'errorCorrection', ['L', 'M', 'Q', 'H'] as const, 'M'),
        invert: bool(a, 'invert', false), quiet: num(a, 'quietZone', { def: 2, min: 0, max: 10, int: true }),
      };
      if (bool(a, 'variable', false)) shape.vt = { offset: num(a, 'variableOffset', { def: 0, int: true }) };
      if (!shape.vt && !qrMatrix(shape.data, shape.ec)) throw new ToolError('Der Inhalt ist zu lang für einen QR-Code');
      const p = W(ed, num(a, 'x'), num(a, 'y'));
      const o = addObj(ed, shape, translate(p.x - size / 2, p.y - size / 2), layerOf(ed, a), num(a, 'rotation', { def: 0 }));
      return { id: o.id, object: describe(ed, o, IDENT, false) };
    },
  },
  {
    name: 'create_barcode',
    title: 'Strichcode anlegen',
    description:
      'Legt einen Strichcode (1D-Barcode) an: Striche als geschlossene Rechtecke, Klartext darunter als Schriftumrisse (auf einem Füll-Layer graviert). type: code128 (ASCII, Standard), ean13 (12 Ziffern, Prüfziffer wird angehängt; 13 werden geprüft), ean8 (7 Ziffern), upca (11 Ziffern), code39 (A–Z 0–9 - . $ / + % Leerzeichen), itf (Ziffern, Interleaved 2 of 5). x/y = Mitte der Striche, width = Breite der Striche ohne Ruhezone in mm, height = Strichhöhe in mm. showText: Klartext unter den Strichen (Standard ja). checkDigit: Prüfziffer anhängen (nur code39/itf). barWidthReduction: gelaserte Elemente um so viele mm schmaler machen (Strahlbreite, z. B. 0.08). invert: Lücken, Ruhezone und Hintergrund lasern (für dunkle Materialien). variable: Platzhalter wie im variablen Text (%# Seriennummer, %0 CSV-Spalte …), variableOffset wird zur aktuellen Nummer addiert. Module unter 0,2 mm lassen sich gelasert schwer lesen.',
    tier: Tier.Edit,
    inputSchema: obj({
      type: { type: 'string', enum: [...LINEAR_TYPES] }, data: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
      width: { type: 'number', description: 'Breite der Striche in mm (Standard 40)' }, height: { type: 'number', description: 'Strichhöhe in mm (Standard 15)' },
      showText: { type: 'boolean' }, checkDigit: { type: 'boolean' }, barWidthReduction: { type: 'number' }, invert: { type: 'boolean' },
      quietZone: { type: 'integer', minimum: 0, maximum: 30, description: 'Ruhezone in Modulen (nur bei invert gelasert, Standard 10)' },
      variable: { type: 'boolean' }, variableOffset: { type: 'integer' }, layer: LAYER, rotation: ROT,
    }, ['data', 'x', 'y']),
    run: (ed, a) => {
      if (typeof a.data !== 'string' || !a.data) throw new ToolError('„data“ ist leer');
      const shape: BarcodeShape = {
        kind: 'barcode', type: oneOf(a, 'type', LINEAR_TYPES, 'code128'), data: a.data, ec: 'M',
        size: num(a, 'width', { def: 40, min: 1, max: 2000 }), height: num(a, 'height', { def: 15, min: 1, max: 2000 }),
        text: bool(a, 'showText', true), check: bool(a, 'checkDigit', false), bwr: num(a, 'barWidthReduction', { def: 0, min: 0, max: 5 }),
        invert: bool(a, 'invert', false), quiet: num(a, 'quietZone', { def: 10, min: 0, max: 30, int: true }),
      };
      if (bool(a, 'variable', false)) shape.vt = { offset: num(a, 'variableOffset', { def: 0, int: true }) };
      else {
        const r = encodeLinear(shape.type as LinearType, barcodeData(shape), shape.check);
        if (!r.ok) throw new ToolError(r.error);
      }
      const p = W(ed, num(a, 'x'), num(a, 'y'));
      const o = addObj(ed, shape, translate(p.x - shape.size / 2, p.y - (shape.height ?? 15) / 2), layerOf(ed, a), num(a, 'rotation', { def: 0 }));
      return { id: o.id, object: describe(ed, o, IDENT, false) };
    },
  },
  {
    name: 'generate_part',
    title: 'Parametrisches Bauteil erzeugen',
    description:
      `Erzeugt ein parametrisches Bauteil aus einem Generator. Die Parameter bleiben im Dokument erhalten: edit_generator ändert sie später, die Kontur wird neu berechnet (der Nutzer öffnet sie per Doppelklick). Baugruppen (z. B. box) ergeben mehrere Objekte; edit_generator an einem Teil berechnet alle Teile der Baugruppe neu. Skalieren, Knoten bearbeiten oder Boolesche Operationen ohne keep_originals gehen erst nach convert_to_path. x/y = Mitte (bei Baugruppen Mitte der ganzen Anordnung). Fehlende Parameter bekommen Standardwerte. Generatoren und Parameter (Längen in mm, Winkel in Grad):\n${genDocs()}`,
    tier: Tier.Edit,
    inputSchema: obj({
      generator: { type: 'string', enum: GENERATORS.map((g) => g.id) }, params: { type: 'object', description: 'Parameter nach Schlüssel, siehe Beschreibung' },
      bind: BIND,
      x: { type: 'number' }, y: { type: 'number' }, layer: LAYER, rotation: ROT,
    }, ['generator', 'x', 'y']),
    run: (ed, a) => {
      const g = getGenerator(String(a.generator));
      if (!g) throw new ToolError(`Unbekannter Generator „${a.generator}“ (${GENERATORS.map((x) => x.id).join(', ')})`);
      const raw = paramArg(a);
      const bad = checkInput(g, raw);
      if (bad.length) throw new ToolError(bad.map((i) => i.msg).join('; '));
      const bind = Object.fromEntries(Object.entries(bindArg(g, a)).filter(([, v]) => v));
      const r = buildBound(g, normalizeParams(g, raw), bind);
      if (!r.parts.length) throw new ToolError(r.issues.map((i) => i.msg).join('; '));
      const p = W(ed, num(a, 'x'), num(a, 'y'));
      const layer = layerOf(ed, a);
      const objs = ed.addGen(r, layer, p);
      const rot = num(a, 'rotation', { def: 0 });
      if (rot) for (const o of objs) o.m = mul(about(rotate((-rot * Math.PI) / 180), p.x, p.y), o.m);
      const info = Object.fromEntries(r.info),
        warnings = r.issues.map((i) => i.msg);
      if (objs.length === 1) return { id: objs[0].id, object: describe(ed, objs[0], IDENT, false), info, warnings };
      return { ids: objs.map((o) => o.id), objects: objs.map((o) => describe(ed, o, IDENT, false)), info, warnings };
    },
  },
  {
    name: 'model_to_parts',
    title: '3D-Modell in Steckteile umwandeln',
    description:
      'Liest ein 3D-Modell (STL oder OBJ, absoluter Pfad) und macht daraus eine Baugruppe zum Lasern: kind "stack" = Schichtmodell (dichte Scheiben zum Verleimen), "ribs" = Rippenmodell (Rippen mit Halbschlitzen auf Rückgrat-Platten). Bei ribs schlägt suggest=true (Standard) Abschnitte für Rumpf, Beine und Schwanz vor; ohne Vorschlag gibt es eine gerade Achse (params axis, spineDir). params wie bei generate_part (z. B. size = längste Seite in mm, thickness, spacing, maxPlate). Das Rippenmodell legt zusätzlich eine Bauplan-Seite an (params plan=false: ohne). x/y = Mitte der Anordnung. Später ändern mit edit_generator.',
    tier: Tier.Edit,
    inputSchema: obj({
      path: { type: 'string' },
      kind: { type: 'string', enum: ['stack', 'ribs'] },
      suggest: { type: 'boolean' },
      params: { type: 'object' },
      x: { type: 'number' }, y: { type: 'number' }, layer: LAYER,
    }, ['path', 'kind']),
    run: async (ed, a) => {
      const path = String(a.path ?? '');
      if (!isTauri()) throw new ToolError('Nur in der Desktop-App');
      const { invoke } = await import('@tauri-apps/api/core');
      let buf: ArrayBuffer;
      try {
        buf = await invoke<ArrayBuffer>('read_file', { path });
      } catch (e) {
        throw new ToolError(`${path}: ${e}`);
      }
      const file = path.split(/[\\/]/).pop() ?? path;
      const { parseMeshFile } = await import('./model3d/mesh');
      const { addMesh } = await import('./model3d/store');
      let mesh;
      try {
        mesh = parseMeshFile(file, buf);
      } catch (e) {
        throw new ToolError(`${file}: ${(e as Error).message}`);
      }
      const kind = a.kind === 'stack' ? 'stack' : 'ribs';
      const g = getGenerator(kind)!;
      const raw = { ...paramArg(a), model: addMesh(mesh), name: file.replace(/\.[^.]*$/, '') };
      const bad = checkInput(g, raw);
      if (bad.length) throw new ToolError(bad.map((i) => i.msg).join('; '));
      let params = normalizeParams(g, raw);
      let found = '';
      if (kind === 'ribs' && a.suggest !== false && !params.sections) {
        const { suggestSections } = await import('./model3d/suggest');
        const sg = suggestSections(mesh, params);
        found = sg.found;
        if (sg.sections.length) params = normalizeParams(g, { ...params, sections: JSON.stringify(sg.sections) });
      }
      const r = buildGen(g, params);
      if (!r.parts.length) throw new ToolError(r.issues.map((i) => i.msg).join('; '));
      const p = W(ed, num(a, 'x', { def: ed.doc.bed.w / 2 }), num(a, 'y', { def: ed.doc.bed.h / 2 }));
      const objs = ed.addGen(r, layerOf(ed, a), p);
      return {
        ids: objs.map((o) => o.id), parts: objs.length, info: Object.fromEntries(r.info), warnings: r.issues.map((i) => i.msg),
        ...(found ? { suggestion: found } : {}), ...(r.plan ? { planPage: ed.doc.page + 2 } : {}),
      };
    },
  },
  {
    name: 'edit_generator',
    title: 'Parameter eines Bauteils ändern',
    description:
      'Ändert Parameter eines parametrischen Bauteils (aus generate_part). Nur die angegebenen Parameter ändern sich, die übrigen bleiben. Ein fester Wert in params löst eine Formel dieses Feldes; bind setzt Formeln mit Projekt-Parametern (leer = wieder fest). Lage und Drehung bleiben erhalten, die Kontur wird neu berechnet. Bei einem Teil einer Baugruppe gilt die Änderung für alle Teile; entfallende Teile werden entfernt, neue neben das Teil gelegt.',
    tier: Tier.Edit,
    inputSchema: obj({ id: { type: 'integer' }, params: { type: 'object' }, bind: BIND }, ['id']),
    run: (ed, a) => {
      const hit = findObj(ed.doc.objs, num(a, 'id', { int: true }));
      if (!hit) throw new ToolError(`Kein Objekt mit id ${a.id}`);
      const [o, parent] = hit;
      if (o.shape.kind !== 'gen') throw new ToolError(`Objekt ${o.id} ist kein parametrisches Bauteil`);
      const g = getGenerator(o.shape.gen);
      if (!g) throw new ToolError(`Generator „${o.shape.gen}“ ist in dieser Programmversion nicht vorhanden`);
      const raw = paramArg(a);
      const bad = checkInput(g, raw);
      if (bad.length) throw new ToolError(bad.map((i) => i.msg).join('; '));
      // Feste Werte lösen Formeln, bind setzt oder entfernt sie
      const bind: Record<string, string> = { ...o.shape.bind };
      for (const k of Object.keys(raw)) delete bind[k];
      for (const [k, v] of Object.entries(bindArg(g, a))) {
        if (v) bind[k] = v;
        else delete bind[k];
      }
      const r = buildBound(g, normalizeParams(g, raw, normalizeParams(g, o.shape.params)), bind);
      if (!r.parts.length) throw new ToolError(r.issues.map((i) => i.msg).join('; '));
      const asm = o.shape.asm;
      // Ohne Formeln: auch eine alte Formel an den übrigen Teilen der Baugruppe entfernen
      if (!Object.keys(bind).length && asm) for (const m of ed.asmMembers(asm)) delete (m.o.shape as { bind?: unknown }).bind;
      ed.updateGen(o, r);
      const info = Object.fromEntries(r.info),
        warnings = r.issues.map((i) => i.msg);
      if (!asm) return { object: describe(ed, o, parent, false), info, warnings };
      // Baugruppe: alle Teile auf dieser Seite melden
      const parts = ed.asmMembers(asm).filter((m) => [...leaves(ed.doc.objs)].some(([l]) => l === m.o));
      return { objects: parts.map((m) => describe(ed, m.o, IDENT, false)), info, warnings };
    },
  },
  {
    name: 'variable_text',
    title: 'Variabler Text: Nummer und Einstellungen',
    description:
      'Liest und ändert die projektweiten Einstellungen für variablen Text: current (aktuelle Nummer = Seriennummer und CSV-Zeile ab 1), start, end (danach wieder start), advance (Schrittweite), autoAdvance (nach jedem Job/G-Code weiterzählen). step zählt um so viele Schritte weiter (negativ = zurück). Ohne Angaben nur lesen. Texte werden mit edit_object variable=true variabel.',
    tier: Tier.Edit,
    inputSchema: obj({
      current: { type: 'integer' }, start: { type: 'integer' }, end: { type: 'integer' }, advance: { type: 'integer' },
      autoAdvance: { type: 'boolean' }, step: { type: 'integer' },
    }),
    run: (ed, a) => {
      const vt = ed.varText;
      const patch: Record<string, number | boolean> = {};
      for (const k of ['current', 'start', 'end', 'advance'] as const) {
        const v = optNum(a, k, { int: true });
        if (v !== undefined) patch[k] = v;
      }
      if (a.autoAdvance !== undefined) patch.autoAdvance = a.autoAdvance === true;
      if (Object.keys(patch).length) ed.setVarText(patch);
      const step = optNum(a, 'step', { int: true });
      if (step) {
        advanceVarText(vt, step);
        ed.setVarText({});
      }
      return {
        current: vt.current, start: vt.start, end: vt.end, advance: vt.advance, autoAdvance: vt.autoAdvance,
        csv: vt.csv ? { file: vt.csv.name, rows: vt.csv.rows.length, columns: vt.csv.header ?? null } : null,
        objects: ed.varTextObjs(false).map((o) => describe(ed, o, IDENT, false)),
      };
    },
  },
  {
    name: 'project_parameters',
    title: 'Projekt-Parameter (Vorlagen)',
    description:
      'Liest und ändert die Parameter des Projekts: benannte Werte (type number, text oder bool), die überall benutzt werden. In Texten und QR-Codes setzt {Name} den Wert ein, auch Formeln wie {Breite / 2}, {round(Länge; 1)} oder {Name + " GmbH"} ({{ und }} = Klammern als Text). Felder parametrischer Bauteile bekommen Formeln über bind in generate_part/edit_generator (z. B. bind {"thickness": "Dicke"}). Ändert sich ein Wert, wird alles neu berechnet. Formeln: + - * / % ^, Vergleiche, && || !, a ? b : c, min max abs sqrt floor ceil round(x; Stellen) sin cos tan (Grad) len upper lower if(c; a; b), Argumente mit ; trennen, Zahlen mit Punkt. Reihenfolge der Änderungen: add, edit, set, remove. Ohne Angaben nur lesen.',
    tier: Tier.Edit,
    inputSchema: obj({
      add: {
        type: 'array',
        description: 'Neue Parameter',
        items: obj({
          name: { type: 'string' }, type: { type: 'string', enum: ['number', 'text', 'bool'] }, value: {},
          min: { type: 'number' }, max: { type: 'number' }, step: { type: 'number' }, unit: { type: 'string' }, note: { type: 'string' },
        }, ['name', 'type']),
      },
      edit: {
        type: 'array',
        description: 'Eigenschaften ändern; newName benennt auch alle Verwendungen um',
        items: obj({
          name: { type: 'string' }, newName: { type: 'string' }, type: { type: 'string', enum: ['number', 'text', 'bool'] },
          min: { type: ['number', 'null'] }, max: { type: ['number', 'null'] }, step: { type: ['number', 'null'] }, unit: { type: 'string' }, note: { type: 'string' },
        }, ['name']),
      },
      set: { type: 'object', description: 'Neue Werte nach Name, z. B. {"Name": "Anna", "Breite": 80}' },
      remove: { type: 'array', items: { type: 'string' }, description: 'Namen der zu löschenden Parameter (Platzhalter bleiben als Text, Formeln werden zu festen Werten)' },
    }),
    run: (ed, a) => {
      const types = ['number', 'text', 'bool'];
      for (const x of (Array.isArray(a.add) ? a.add : []) as Record<string, unknown>[]) {
        if (!types.includes(String(x.type))) throw new ToolError(`type muss number, text oder bool sein`);
        try {
          ed.addParam(x.type as ParamType, {
            name: String(x.name ?? ''), value: x.value as never,
            ...(typeof x.min === 'number' ? { min: x.min } : {}), ...(typeof x.max === 'number' ? { max: x.max } : {}),
            ...(typeof x.step === 'number' ? { step: x.step } : {}), ...(typeof x.unit === 'string' && x.unit ? { unit: x.unit } : {}),
            ...(typeof x.note === 'string' && x.note ? { note: x.note } : {}),
          });
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : String(e));
        }
      }
      for (const x of (Array.isArray(a.edit) ? a.edit : []) as Record<string, unknown>[]) {
        const p = ed.findParam(String(x.name));
        if (!p) throw new ToolError(`Unbekannter Parameter „${x.name}“`);
        const patch: Partial<ProjectParam> = {};
        if (typeof x.newName === 'string') patch.name = x.newName;
        if (x.type !== undefined) {
          if (!types.includes(String(x.type))) throw new ToolError(`type muss number, text oder bool sein`);
          patch.type = x.type as ParamType;
          if (patch.type !== p.type) patch.value = coerce({ ...p, type: patch.type, min: undefined, max: undefined }, p.value);
        }
        for (const k of ['min', 'max', 'step'] as const) if (k in x) patch[k] = typeof x[k] === 'number' ? (x[k] as number) : undefined;
        if (typeof x.unit === 'string') patch.unit = x.unit;
        if (typeof x.note === 'string') patch.note = x.note;
        try {
          ed.editParam(p, patch);
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : String(e));
        }
      }
      if (a.set !== undefined) {
        if (typeof a.set !== 'object' || a.set === null || Array.isArray(a.set)) throw new ToolError('„set“ muss ein Objekt sein');
        for (const [k, v] of Object.entries(a.set as Record<string, unknown>)) {
          const p = ed.findParam(k);
          if (!p) throw new ToolError(`Unbekannter Parameter „${k}“`);
          if (p.type === 'number' && (typeof v !== 'number' || !isFinite(v))) throw new ToolError(`„${k}“ erwartet eine Zahl`);
          if (p.type === 'bool' && typeof v !== 'boolean') throw new ToolError(`„${k}“ erwartet true oder false`);
        }
        ed.setParamValues(a.set as Record<string, unknown>);
      }
      for (const n of (Array.isArray(a.remove) ? a.remove : []) as unknown[]) {
        const p = ed.findParam(String(n));
        if (!p) throw new ToolError(`Unbekannter Parameter „${n}“`);
        ed.removeParam(p);
      }
      const problems = ed.applyParams();
      return {
        parameters: ed.paramList().map((p) => ({ ...p, usedBy: ed.paramUsers(p).map((o) => o.id) })),
        problems: problems.map(({ obj, issues }) => ({ id: obj.id, issues: issues.map((i) => `${i.level}: ${i.msg}`) })),
      };
    },
  },
  {
    name: 'project_notes',
    title: 'Projekt-Notizen',
    description:
      'Liest und ändert die Projekt-Notizen (Fenster „Notizen“, in der Projektdatei gespeichert): material (Material, Dicke, Bezugsquelle), setup (Aufbau: Fokus, Auflage, Ursprung, Fixierung) und process (Bearbeitung: Reihenfolge, Durchgänge, Nachbearbeitung, Erfahrungen). Übergebene Abschnitte ersetzen den bisherigen Text, ein leerer Text löscht den Abschnitt. Ohne Angaben nur lesen. Auch in get_document als notes.',
    tier: Tier.Edit,
    inputSchema: obj({
      material: { type: 'string' },
      setup: { type: 'string' },
      process: { type: 'string' },
    }),
    run: (ed, a) => {
      for (const k of NOTE_KEYS) {
        if (a[k] === undefined) continue;
        if (typeof a[k] !== 'string') throw new ToolError(`„${k}“ muss ein Text sein`);
        ed.setNote(k, a[k] as string);
      }
      return { notes: ed.doc.notes ?? {} };
    },
  },
  {
    name: 'template',
    title: 'Vorlage einrichten',
    description:
      'Macht das Projekt zur Vorlage: Titel, Beschreibung und welche Projekt-Parameter beim Ausfüllen gefragt werden (fields, in dieser Reihenfolge; label = Beschriftung, slider = Schieberegler bei Zahlen mit min/max). setup null entfernt die Vorlagen-Angaben. saveToLibrary speichert das Projekt in den Vorlagen-Ordner (Datei aus dem Titel, .kzt); vorhandene nur mit overwrite. list zeigt die Vorlagen im Ordner. Ohne Angaben nur lesen. Neue Projekte daraus: new_from_template.',
    tier: Tier.Edit,
    inputSchema: obj({
      setup: {
        type: ['object', 'null'],
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          fields: { type: 'array', items: obj({ name: { type: 'string' }, label: { type: 'string' }, slider: { type: 'boolean' } }, ['name']) },
        },
      },
      saveToLibrary: { type: 'boolean' },
      overwrite: { type: 'boolean' },
      list: { type: 'boolean' },
    }),
    run: async (ed, a) => {
      if (a.setup === null) ed.setTemplate(null);
      else if (a.setup !== undefined) {
        const st = a.setup as Record<string, unknown>;
        const fields = Array.isArray(st.fields) ? (st.fields as Record<string, unknown>[]) : undefined;
        for (const f of fields ?? []) if (!ed.findParam(String(f.name))) throw new ToolError(`Unbekannter Parameter „${f.name}“`);
        const cur = ed.doc.template ?? defaultTemplate(ed.doc);
        ed.setTemplate({
          title: typeof st.title === 'string' ? st.title : cur.title,
          description: typeof st.description === 'string' ? st.description : cur.description,
          fields: fields ? fields.map((f) => ({ name: String(f.name), label: typeof f.label === 'string' ? f.label : undefined, slider: f.slider === true })) : cur.fields,
        });
      }
      let saved: string | undefined;
      if (bool(a, 'saveToLibrary', false)) {
        const info = ed.doc.template ?? defaultTemplate(ed.doc);
        if (!ed.doc.template) ed.setTemplate(info);
        saved = templateFileName(info.title);
        try {
          await writeTemplate(saved, templateJson(ed.serialize(), info, buildSvg(ed, { preview: true })), bool(a, 'overwrite', false));
        } catch (e) {
          throw new ToolError(e instanceof Error ? e.message : String(e));
        }
      }
      const info = ed.doc.template;
      return {
        template: info
          ? { title: info.title, description: info.description, fields: templateFields(ed.doc).map(([p, f]) => ({ ...f, type: p.type, value: p.value })) }
          : null,
        ...(saved ? { saved } : {}),
        ...(bool(a, 'list', false)
          ? {
              library: [
                ...(await listTemplates()).map((e) => ({ file: e.file, title: e.info.title, description: e.info.description })),
                ...builtinTemplates().map((b) => ({ file: `builtin:${b.id}`, title: b.info.title, description: b.info.description, builtin: true })),
                ...packTemplates().map((p) => ({ file: `pack:${p.key}`, title: p.info.title, description: p.info.description, extension: p.pack })),
              ],
            }
          : {}),
      };
    },
  },
  {
    name: 'new_from_template',
    title: 'Neu aus Vorlage',
    description:
      'Legt aus einer Vorlage im Vorlagen-Ordner, einer mitgelieferten (file, z. B. „builtin:keyfob“) oder einer aus einer Erweiterung („pack:…“, siehe template mit list) ein neues Projekt an und ersetzt das aktuelle (rückgängig machbar mit undo). values setzt Parameter nach Name, z. B. {"Name": "Anna", "Breite": 80}.',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({ file: { type: 'string' }, values: { type: 'object' } }, ['file']),
    run: async (ed, a) => {
      if (a.values !== undefined && (typeof a.values !== 'object' || a.values === null || Array.isArray(a.values))) throw new ToolError('„values“ muss ein Objekt sein');
      let json: string;
      const file = String(a.file ?? '');
      try {
        const b = file.startsWith('builtin:') ? builtinTemplates().find((x) => `builtin:${x.id}` === file) : undefined;
        if (file.startsWith('builtin:') && !b) throw new Error(`Keine mitgelieferte Vorlage „${file}“`);
        const pk = file.startsWith('pack:') ? packTemplates().find((x) => `pack:${x.key}` === file) : undefined;
        if (file.startsWith('pack:') && !pk) throw new Error(`Keine Vorlage „${file}“ in den installierten Erweiterungen`);
        json = b ? b.json() : pk ? pk.json : await readTemplate(file);
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : String(e));
      }
      try {
        ed.openTemplate(json, (a.values as Record<string, unknown>) ?? {});
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : String(e));
      }
      return {
        title: ed.doc.template?.title,
        fields: templateFields(ed.doc).map(([p, f]) => ({ ...f, type: p.type, value: p.value })),
        problems: ed.paramProblems.map(({ obj, issues }) => ({ id: obj.id, issues: issues.map((i) => `${i.level}: ${i.msg}`) })),
        pages: pageList(ed),
      };
    },
  },
  {
    name: 'insert_asset',
    title: 'Aus Bibliothek einfügen',
    description:
      'Fügt einen Eintrag der Bibliothek (Motiv, Bild, Designelement; asset = Kennung aus list_assets) als Gruppe ein, mit der Mitte bei x, y (Maschinenkoordinaten, mm; ohne Angabe Mitte der Ansicht). Liegt der Eintrag auf einem einzigen Layer, kommt er auf layer (Standard: aktueller Layer); sonst behalten die Teile ihre Layer.',
    tier: Tier.Edit,
    inputSchema: obj({ asset: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, layer: { type: 'integer', minimum: 0, maximum: 31 } }, ['asset']),
    run: async (ed, a) => {
      let data;
      try {
        data = await loadLibraryAsset(String(a.asset ?? ''));
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : String(e));
      }
      const x = optNum(a, 'x'),
        y = optNum(a, 'y');
      if ((x === undefined) !== (y === undefined)) throw new ToolError('x und y nur zusammen angeben');
      const keep = ed.currentLayer;
      ed.currentLayer = layerOf(ed, a);
      try {
        const o = ed.insertAsset(data, x === undefined ? undefined : { x, y: ed.doc.bed.h - y! });
        if (!o) throw new ToolError('Der Eintrag ist leer');
        return { id: o.id, object: describe(ed, o, IDENT, false) };
      } finally {
        ed.currentLayer = keep;
      }
    },
  },
  {
    name: 'save_asset',
    title: 'In Bibliothek speichern',
    description:
      'Speichert Objekte (ids, oberste Ebene; ohne ids die Auswahl) als neuen Eintrag in der Bibliothek: name, category (motif = Motiv, image = Bild, element = Designelement; ohne Angabe geraten), tags (Stichwörter für die Suche). Formeln, Bedingungen und ausgeblendete Teile werden nicht mitgespeichert. Liefert die Kennung für insert_asset.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: { ...IDS, description: 'Objekt-ids (oberste Ebene); ohne Angabe die Auswahl' },
      name: { type: 'string' },
      category: { type: 'string', enum: ASSET_CATEGORIES },
      tags: { type: 'array', items: { type: 'string' } },
    }, ['name']),
    run: async (ed, a) => {
      const objs = a.ids === undefined ? ed.sel : topObjs(ed, ids(a));
      if (!objs.length) throw new ToolError('Nichts ausgewählt; ids angeben');
      const name = String(a.name ?? '').trim();
      if (!name) throw new ToolError('„name“ fehlt');
      const category = a.category === undefined ? undefined : oneOf<AssetCategory>(a, 'category', ASSET_CATEGORIES);
      const data = ed.assetFromObjs(objs, name, category, parseTags(a.tags));
      if (!data) throw new ToolError('Die Objekte enthalten nichts Sichtbares');
      try {
        const key = await addToLibrary(data);
        return { asset: key, name: data.name, category: data.category, tags: data.tags, size: { w: r3(data.w), h: r3(data.h) } };
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: 'make_series',
    title: 'Serie aus Tabelle',
    description:
      'Serie: Für jede Zeile in rows (Werte nach Parametername, z. B. [{"Name": "Anna"}, {"Name": "Bernd"}]) entsteht eine feste Kopie der aktuellen Seite (Platzhalter ersetzt, Formeln gelöst). layout grid (Standard): Raster ab unten links (Maschinen-Nullpunkt) mit gap mm Abstand, weitere Seiten bei Bedarf; pages: eine Seite je Zeile an derselben Stelle. Die Kopien kommen auf neue Seiten hinter der aktuellen; die Vorlage bleibt unverändert. Höchstens 500 Zeilen. Statt rows geht auch table (header = Spaltennamen wie die Parameter, rows = Zeilen als Texte, Zahlen auch mit Dezimalkomma, Ja/Nein als ja/nein); table wird im Projekt gespeichert. Ohne rows und table wird die gespeicherte Tabelle benutzt.',
    tier: Tier.Edit,
    inputSchema: obj({
      rows: { type: 'array', items: { type: 'object' } },
      table: obj({ header: { type: 'array', items: { type: 'string' } }, rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } } }, ['header', 'rows']),
      layout: { type: 'string', enum: ['grid', 'pages'] },
      gap: { type: 'number' },
    }),
    run: (ed, a) => {
      let rows = a.rows as Record<string, unknown>[] | undefined;
      if (a.table !== undefined) {
        const tb = a.table as { header?: unknown; rows?: unknown };
        if (!Array.isArray(tb.header) || !Array.isArray(tb.rows) || tb.rows.some((r) => !Array.isArray(r))) throw new ToolError('„table“ braucht header und rows (Listen von Texten)');
        ed.setSeriesTable({ header: tb.header.map(String), rows: (tb.rows as unknown[][]).map((r) => r.map((c) => String(c ?? ''))) });
      }
      if (rows === undefined) {
        const tb = ed.doc.seriesTable;
        if (!tb) throw new ToolError('Weder rows noch eine Tabelle im Projekt');
        const params = ed.paramList();
        rows = tableRows(tb.rows, guessColumns(tb.header, params, templateFields(ed.doc).map(([, f]) => f)), params);
      }
      if (!Array.isArray(rows) || rows.some((r) => typeof r !== 'object' || r === null || Array.isArray(r))) throw new ToolError('„rows“ muss eine Liste von Objekten sein');
      try {
        const n = ed.makeSeries(rows, { layout: a.layout === 'pages' ? 'pages' : 'grid', gap: typeof a.gap === 'number' ? a.gap : undefined });
        return { newPages: n, pages: pageList(ed) };
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: 'bind_object',
    title: 'Formeln und Sichtbarkeit eines Objekts',
    description:
      'Verknüpft Lage, Größe, Drehung und Formmaße eines Objekts der obersten Ebene mit Projekt-Parametern (siehe project_parameters), wie Formeln in den Feldern der Zahlenleiste. formulas: x, y (Maschinenkoordinaten in mm am Bezugspunkt anchor), width, height (Rahmen in mm; keepRatio: Seitenverhältnis halten, wenn nur eines gesetzt ist), rotation (Grad gegen den Uhrzeigersinn), cornerRadius (Rechteck), sides (Vieleck), size, maxWidth, maxHeight (Text, mm im Objekt). Leere Formel = wieder fester Wert. Ändert sich ein Parameter, werden die Formeln neu angewendet (Formmaße, Drehung, Größe, Lage). showIf: Objekt nur zeigen und lasern, wenn die Bedingung gilt (z. B. "Deckel" oder "Breite > 100"; leer = immer). Bei parametrischen Bauteilen kommt die Größe aus edit_generator.',
    tier: Tier.Edit,
    inputSchema: obj({
      id: { type: 'integer' },
      formulas: obj({
        x: { type: 'string' }, y: { type: 'string' }, width: { type: 'string' }, height: { type: 'string' }, rotation: { type: 'string' },
        cornerRadius: { type: 'string' }, sides: { type: 'string' }, size: { type: 'string' }, maxWidth: { type: 'string' }, maxHeight: { type: 'string' },
      }),
      anchor: { type: 'string', enum: ['center', 'bottom-left', 'bottom', 'bottom-right', 'left', 'right', 'top-left', 'top', 'top-right'], description: 'Bezugspunkt für x/y, Größe und Drehung (Standard center)' },
      keepRatio: { type: 'boolean' },
      showIf: { type: 'string' },
    }, ['id']),
    run: (ed, a) => {
      const o = ed.doc.objs.find((x) => x.id === num(a, 'id', { int: true }));
      if (!o) throw new ToolError(`Kein Objekt mit id ${a.id} auf der obersten Ebene dieser Seite`);
      const f = (a.formulas ?? {}) as Record<string, unknown>;
      const KEYS: Record<string, ObjBindKey> = {
        x: 'x', y: 'y', width: 'w', height: 'h', rotation: 'rot', cornerRadius: 'r', sides: 'sides', size: 'size', maxWidth: 'maxW', maxHeight: 'maxH',
      };
      const AN: Record<string, [number, number]> = {
        center: [0.5, 0.5], 'bottom-left': [0, 1], bottom: [0.5, 1], 'bottom-right': [1, 1], left: [0, 0.5], right: [1, 0.5], 'top-left': [0, 0], top: [0.5, 0], 'top-right': [1, 0],
      };
      const anchor = a.anchor === undefined ? undefined : AN[String(a.anchor)];
      if (a.anchor !== undefined && !anchor) throw new ToolError('Unbekannter Bezugspunkt');
      const issues: string[] = [];
      for (const [k, v] of Object.entries(f)) {
        const key = KEYS[k];
        if (!key) throw new ToolError(`Unbekanntes Feld „${k}“`);
        if (typeof v !== 'string') throw new ToolError(`formulas.${k} muss eine Formel (Text) sein`);
        if ((key === 'w' || key === 'h') && o.shape.kind === 'gen') throw new ToolError(ed.genChangeError([o]));
        issues.push(...ed.setObjBind(o, key, v, { anchor: anchor ?? o.bind?.anchor ?? [0.5, 0.5], lock: a.keepRatio === undefined ? o.bind?.lock ?? true : a.keepRatio === true }).map((i) => i.msg));
      }
      if (typeof a.showIf === 'string') ed.setShowIf([o], a.showIf);
      return { object: describe(ed, o, IDENT, false), problems: [...new Set(issues)] };
    },
  },
  {
    name: 'edit_object',
    title: 'Objekt ändern',
    description:
      'Ändert Eigenschaften eines Objekts (auch in Gruppen). Alle Typen: name (leer = Standardname), hidden (ausgeblendet: nicht gezeichnet und nicht gelasert), locked (auf der Arbeitsfläche nicht auswählbar; nur oberste Ebene). Text: text, font, size (mm auf dem Bett), bold, italic, upper, align, letterSpacing, lineSpacing, weld (Buchstaben schweißen); bei Text auf Pfad (apply_path_to_text) pathOffset (Verschiebung entlang der Kurve, mm), pathDistance (Abstand der Grundlinie, mm, positiv nach oben), pathFlip (andere Seite), removePath (wieder gerade), variable (variabler Text mit Platzhaltern, siehe variable_text), variableOffset, maxWidth (mm, breitere Zeilen werden gestaucht, 0 = aus), maxHeight (mm, ein höherer Block wird verkleinert, 0 = aus), fitShrink (zu breiten Text verkleinern statt stauchen), wrap (Textrahmen: Zeilen an maxWidth an Wortgrenzen umbrechen, Höhe wächst mit; ohne maxWidth gilt die jetzige Breite). QR-Code: data, errorCorrection, qrSize (Kantenlänge mm), invert, quietZone, variable, variableOffset. Strichcode: data, barcodeType, barcodeWidth (Breite der Striche mm), barcodeHeight (mm), showText, checkDigit, barWidthReduction (mm), invert, quietZone, variable, variableOffset. Rechteck: cornerRadius. Vieleck: sides, star, innerRatio. Lage und Größe ändert transform.',
    tier: Tier.Edit,
    inputSchema: obj({
      id: { type: 'integer' }, name: { type: 'string' }, hidden: { type: 'boolean' }, locked: { type: 'boolean' }, text: { type: 'string' }, font: { type: 'string' }, size: { type: 'number' }, bold: { type: 'boolean' },
      italic: { type: 'boolean' }, upper: { type: 'boolean' }, align: { type: 'string', enum: ['left', 'center', 'right'] },
      letterSpacing: { type: 'number' }, lineSpacing: { type: 'number' }, weld: { type: 'boolean' }, pathOffset: { type: 'number' },
      pathDistance: { type: 'number' }, pathFlip: { type: 'boolean' }, removePath: { type: 'boolean' }, cornerRadius: { type: 'number' },
      sides: { type: 'integer', minimum: 3, maximum: 200 }, star: { type: 'boolean' }, innerRatio: { type: 'number' },
      variable: { type: 'boolean' }, variableOffset: { type: 'integer' }, maxWidth: { type: 'number' }, maxHeight: { type: 'number' }, fitShrink: { type: 'boolean' }, wrap: { type: 'boolean' }, data: { type: 'string' },
      errorCorrection: { type: 'string', enum: ['L', 'M', 'Q', 'H'] }, qrSize: { type: 'number' }, invert: { type: 'boolean' }, quietZone: { type: 'integer' },
      barcodeType: { type: 'string', enum: [...LINEAR_TYPES] }, barcodeWidth: { type: 'number' }, barcodeHeight: { type: 'number' }, showText: { type: 'boolean' }, checkDigit: { type: 'boolean' }, barWidthReduction: { type: 'number' },
    }, ['id']),
    run: (ed, a) => {
      const hit = findObj(ed.doc.objs, num(a, 'id', { int: true }));
      if (!hit) throw new ToolError(`Kein Objekt mit id ${a.id}`);
      const [o, parent] = hit;
      const m = mul(parent, o.m);
      const s = o.shape;
      const props: { name?: string; hidden?: boolean; locked?: boolean } = {};
      if (typeof a.name === 'string') props.name = a.name;
      if (a.hidden !== undefined) props.hidden = a.hidden === true;
      if (a.locked !== undefined) {
        if (!ed.doc.objs.includes(o)) throw new ToolError('Sperren geht nur bei Objekten der obersten Ebene (nicht in Gruppen)');
        props.locked = a.locked === true;
      }
      const SHAPE_KEYS = [
        'text', 'font', 'size', 'bold', 'italic', 'upper', 'align', 'letterSpacing', 'lineSpacing', 'weld', 'pathOffset', 'pathDistance', 'pathFlip', 'removePath',
        'cornerRadius', 'sides', 'star', 'innerRatio', 'variable', 'variableOffset', 'maxWidth', 'maxHeight', 'fitShrink', 'wrap', 'data', 'errorCorrection', 'qrSize', 'invert', 'quietZone',
        'barcodeType', 'barcodeWidth', 'barcodeHeight', 'showText', 'checkDigit', 'barWidthReduction',
      ];
      const shapeChange = SHAPE_KEYS.some((k) => a[k] !== undefined);
      if (Object.keys(props).length) ed.setObjProps([o], props);
      if (!shapeChange) {
        if (!Object.keys(props).length) throw new ToolError('Keine Eigenschaft angegeben');
        return { object: describe(ed, o, parent, false) };
      }
      if (s.kind === 'text') {
        if (a.text !== undefined) {
          if (typeof a.text !== 'string' || !a.text.trim()) throw new ToolError('„text“ ist leer');
          s.text = a.text;
        }
        if (typeof a.font === 'string' && a.font.trim()) s.font = a.font.trim();
        const size = optNum(a, 'size', { min: 0.1 });
        if (size !== undefined) s.size = size / (Math.hypot(m[2], m[3]) || 1);
        if (a.bold !== undefined) s.bold = a.bold === true;
        if (a.italic !== undefined) s.italic = a.italic === true;
        if (a.upper !== undefined) s.upper = a.upper === true;
        if (a.align !== undefined) s.align = oneOf(a, 'align', ['left', 'center', 'right'] as const);
        s.hSpace = optNum(a, 'letterSpacing') ?? s.hSpace;
        s.vSpace = optNum(a, 'lineSpacing') ?? s.vSpace;
        if (a.weld !== undefined) s.weld = a.weld === true;
        if (a.removePath === true) delete s.path;
        const pathKeys = ['pathOffset', 'pathDistance', 'pathFlip'].filter((k) => a[k] !== undefined);
        if (pathKeys.length) {
          if (!s.path) throw new ToolError('Der Text liegt auf keinem Pfad; erst apply_path_to_text');
          s.path.offset = optNum(a, 'pathOffset') ?? s.path.offset;
          s.path.dist = optNum(a, 'pathDistance') ?? s.path.dist;
          if (a.pathFlip !== undefined) s.path.flip = a.pathFlip === true;
        }
        const mw = optNum(a, 'maxWidth', { min: 0 });
        if (mw !== undefined) s.maxW = mw / (Math.hypot(m[0], m[1]) || 1);
        const mh = optNum(a, 'maxHeight', { min: 0 });
        if (mh !== undefined) s.maxH = mh / (Math.hypot(m[2], m[3]) || 1);
        if (a.fitShrink !== undefined) {
          if (a.fitShrink === true) s.fit = 'shrink';
          else if (s.fit === 'shrink') delete s.fit;
        }
        if (a.wrap !== undefined) {
          if (a.wrap === true) {
            if (!s.maxW) s.maxW = Math.max(1, textLayout(s).box.w);
            s.fit = 'wrap';
          } else if (s.fit === 'wrap') delete s.fit;
        }
        setVar(s, a);
      } else if (s.kind === 'barcode') {
        if (a.data !== undefined) {
          if (typeof a.data !== 'string' || !a.data) throw new ToolError('„data“ ist leer');
          s.data = a.data;
          delete s.form;
        }
        if (s.type === 'qr') {
          if (a.errorCorrection !== undefined) s.ec = oneOf(a, 'errorCorrection', ['L', 'M', 'Q', 'H'] as const) as QrLevel;
          const qs = optNum(a, 'qrSize', { min: 1, max: 2000 });
          if (qs !== undefined) s.size = qs / (Math.hypot(m[0], m[1]) || 1);
        } else {
          if (a.barcodeType !== undefined) s.type = oneOf(a, 'barcodeType', LINEAR_TYPES);
          const bw = optNum(a, 'barcodeWidth', { min: 1, max: 2000 });
          if (bw !== undefined) s.size = bw / (Math.hypot(m[0], m[1]) || 1);
          const bh = optNum(a, 'barcodeHeight', { min: 1, max: 2000 });
          if (bh !== undefined) s.height = bh / (Math.hypot(m[2], m[3]) || 1);
          if (a.showText !== undefined) s.text = a.showText === true;
          if (a.checkDigit !== undefined) s.check = a.checkDigit === true;
          s.bwr = optNum(a, 'barWidthReduction', { min: 0, max: 5 }) ?? s.bwr;
        }
        if (a.invert !== undefined) s.invert = a.invert === true;
        s.quiet = optNum(a, 'quietZone', { min: 0, max: s.type === 'qr' ? 10 : 30, int: true }) ?? s.quiet;
        setVar(s, a);
      } else if (s.kind === 'rect') {
        const r = optNum(a, 'cornerRadius', { min: 0 });
        if (r !== undefined) s.r = Math.min(r / (Math.min(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])) || 1), Math.min(s.w, s.h) / 2);
      } else if (s.kind === 'polygon') {
        s.sides = optNum(a, 'sides', { min: 3, max: 200, int: true }) ?? s.sides;
        if (a.star !== undefined) s.star = a.star === true;
        s.inner = optNum(a, 'innerRatio', { min: 0.05, max: 0.95 }) ?? s.inner;
      } else throw new ToolError(`Objekte vom Typ ${s.kind} haben hier nichts zu ändern; Lage und Größe: transform`);
      ed.touch(s);
      ed.emit('doc');
      ed.emit('sel');
      return { object: describe(ed, o, parent, false) };
    },
  },
  {
    name: 'transform',
    title: 'Verschieben, skalieren, drehen',
    description:
      'Transformiert Objekte gemeinsam (wie eine Auswahl), in dieser Reihenfolge: Größe (width/height oder scale), Drehung, Spiegeln, dann Lage (x/y oder dx/dy). x/y setzen die linke untere Ecke des gemeinsamen Rahmens, mit anchor "center" seine Mitte. Bei width/height bleibt die linke untere Ecke stehen; fehlt eines von beiden, bleibt das Seitenverhältnis erhalten.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, dx: { type: 'number' }, dy: { type: 'number' }, x: { type: 'number' }, y: { type: 'number' },
      anchor: { type: 'string', enum: ['bottom-left', 'center'] }, width: { type: 'number' }, height: { type: 'number' },
      scale: { type: 'number', description: 'Faktor um die Mitte' }, rotate: ROT, mirror: { type: 'string', enum: ['horizontal', 'vertical'] },
    }, ['ids']),
    run: (ed, a) => {
      const objs = topObjs(ed, ids(a));
      ed.setSel(objs);
      const w = optNum(a, 'width', { min: 0.001 }), h = optNum(a, 'height', { min: 0.001 });
      // Linke untere Ecke bleibt stehen
      if (w !== undefined || h !== undefined) ed.setSelBox({ w, h }, 0, 1, w === undefined || h === undefined);
      const f = optNum(a, 'scale', { min: 0.0001 });
      if (f !== undefined && f !== 1) {
        if (genLeaves(objs).length) throw new ToolError(ed.genChangeError(objs));
        const b = ed.selBounds()!;
        ed.transformSel(about(scale(f, f), b.x + b.w / 2, b.y + b.h / 2));
      }
      const rot = optNum(a, 'rotate');
      if (rot) ed.rotateBy(rot);
      if (a.mirror !== undefined) ed.mirror(oneOf(a, 'mirror', ['horizontal', 'vertical'] as const) === 'horizontal');
      const x = optNum(a, 'x'), y = optNum(a, 'y');
      if (x !== undefined || y !== undefined) {
        const center = oneOf(a, 'anchor', ['bottom-left', 'center'] as const, 'bottom-left') === 'center';
        ed.setSelBox({ x, y: y === undefined ? undefined : ed.doc.bed.h - y }, center ? 0.5 : 0, center ? 0.5 : 1, false);
      }
      const dx = num(a, 'dx', { def: 0 }), dy = num(a, 'dy', { def: 0 });
      if (dx || dy) ed.transformSel(translate(dx, -dy));
      return { objects: describeAll(ed, objs), bounds: machineBox(ed, ed.selBounds()) };
    },
  },
  {
    name: 'align',
    title: 'Ausrichten und verteilen',
    description:
      'Richtet Objekte aneinander aus (relative_to "selection", gemeinsamer Rahmen) oder am Bett ("bed"). how: left, right, top, bottom, hcenter (senkrechte Mittellinie), vcenter (waagerechte Mittellinie). distribute: horizontal/vertical verteilt die Mitten gleichmäßig (ab 3 Objekten).',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, how: { type: 'string', enum: ['left', 'right', 'top', 'bottom', 'hcenter', 'vcenter'] },
      relative_to: { type: 'string', enum: ['selection', 'bed'] }, distribute: { type: 'string', enum: ['horizontal', 'vertical'] },
    }, ['ids']),
    run: (ed, a) => {
      const objs = topObjs(ed, ids(a));
      ed.setSel(objs);
      if (a.how !== undefined) {
        const how = oneOf(a, 'how', ['left', 'right', 'top', 'bottom', 'hcenter', 'vcenter'] as const);
        // Oben/unten in Maschinensicht = Welt oben/unten (die Welt hat y nach unten, die Anzeige auch)
        if (oneOf(a, 'relative_to', ['selection', 'bed'] as const, 'selection') === 'bed') {
          const B: Box = { x: 0, y: 0, w: ed.doc.bed.w, h: ed.doc.bed.h };
          for (const o of objs) {
            const b = boundsOf([o])!;
            const dx = how === 'left' ? B.x - b.x : how === 'right' ? B.w - (b.x + b.w) : how === 'hcenter' ? B.w / 2 - (b.x + b.w / 2) : 0;
            const dy = how === 'top' ? B.y - b.y : how === 'bottom' ? B.h - (b.y + b.h) : how === 'vcenter' ? B.h / 2 - (b.y + b.h / 2) : 0;
            o.m = mul(translate(dx, dy), o.m);
          }
          ed.emit('doc');
          ed.emit('sel');
        } else {
          if (objs.length < 2) throw new ToolError('Zum Ausrichten aneinander mindestens zwei Objekte angeben (oder relative_to "bed")');
          ed.align(how);
        }
      }
      if (a.distribute !== undefined) {
        if (objs.length < 3) throw new ToolError('Verteilen braucht mindestens drei Objekte');
        ed.distribute(oneOf(a, 'distribute', ['horizontal', 'vertical'] as const) === 'horizontal');
      }
      return { objects: describeAll(ed, objs) };
    },
  },
  {
    name: 'group',
    title: 'Gruppieren',
    description: 'Fasst Objekte zu einer Gruppe zusammen und gibt die id der Gruppe zurück.',
    tier: Tier.Edit,
    inputSchema: obj({ ids: { ...IDS, minItems: 2 } }, ['ids']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      const objs = topObjs(ed, ids(a));
      if (objs.length < 2) throw new ToolError('Mindestens zwei Objekte angeben');
      ed.setSel(objs);
      ed.group();
      return result(ed, before);
    },
  },
  {
    name: 'ungroup',
    title: 'Gruppe auflösen',
    description: 'Löst Gruppen auf; die Teile werden eigenständige Objekte (ids bleiben).',
    tier: Tier.Edit,
    inputSchema: obj({ ids: IDS }, ['ids']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      const objs = topObjs(ed, ids(a));
      if (!objs.some((o) => o.shape.kind === 'group')) throw new ToolError('Keine Gruppe unter den Objekten');
      ed.setSel(objs);
      ed.ungroup();
      return result(ed, before);
    },
  },
  {
    name: 'delete_objects',
    title: 'Löschen',
    description: 'Löscht Objekte (rückgängig machbar mit undo).',
    tier: Tier.Edit,
    inputSchema: obj({ ids: IDS }, ['ids']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      ed.setSel(topObjs(ed, ids(a)));
      ed.deleteSel();
      return result(ed, before);
    },
  },
  {
    name: 'duplicate',
    title: 'Duplizieren',
    description: 'Kopiert Objekte, optional um dx/dy verschoben.',
    tier: Tier.Edit,
    inputSchema: obj({ ids: IDS, dx: { type: 'number' }, dy: { type: 'number' } }, ['ids']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      ed.setSel(topObjs(ed, ids(a)));
      ed.duplicate();
      const dx = num(a, 'dx', { def: 0 }), dy = num(a, 'dy', { def: 0 });
      if (dx || dy) ed.transformSel(translate(dx, -dy));
      return result(ed, before);
    },
  },
  {
    name: 'assign_layer',
    title: 'Layer zuweisen',
    description: 'Legt Objekte (samt Gruppeninhalt) auf einen Layer.',
    tier: Tier.Edit,
    inputSchema: obj({ ids: IDS, layer: { ...LAYER, description: 'Layer 0–29' } }, ['ids', 'layer']),
    run: (ed, a) => {
      const objs = topObjs(ed, ids(a));
      ed.setSel(objs);
      ed.assignLayer(num(a, 'layer', { min: 0, max: 31, int: true }));
      return { objects: describeAll(ed, objs) };
    },
  },
  {
    name: 'select',
    title: 'Auswählen',
    description: 'Wählt Objekte in der Oberfläche aus, damit die Person sieht, worum es geht. Leere Liste hebt die Auswahl auf.',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({ ids: { type: 'array', items: { type: 'integer' } } }, ['ids']),
    run: (ed, a) => {
      const list = Array.isArray(a.ids) ? a.ids.map(Number) : [];
      ed.setSel(list.length ? topObjs(ed, list) : []);
      return { selection: ed.sel.map((o) => o.id) };
    },
  },
  {
    name: 'boolean',
    title: 'Boolesche Operation',
    description:
      'union (vereinen), subtract (von der Basis abziehen), intersect (Schnittmenge), xor. Basis: base "first" = erstes Objekt in ids, "back" = hinterstes, "front" = vorderstes. Texte werden über ihre Konturen verrechnet; offene Linien (z. B. Biegeschnitte) werden bei subtract an den abgezogenen Flächen gekürzt, bei intersect auf die gemeinsame Fläche beschränkt (reine Linien-Objekte plus eine Fläche: die Fläche schneidet die Linien); Bilder nehmen nicht teil. union mit nur einer Gruppe oder einem Text verschweißt deren Teile. Ergebnis: ein Pfad mit Bézierkurven; Originale werden ersetzt, außer keep_originals.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: { ...IDS, minItems: 1 }, op: { type: 'string', enum: ['union', 'subtract', 'intersect', 'xor'] },
      base: { type: 'string', enum: ['first', 'back', 'front'] }, keep_originals: { type: 'boolean' },
    }, ['ids', 'op']),
    run: async (ed, a) => {
      const before = snapshotIds(ed);
      const objs = topObjs(ed, ids(a));
      const op = oneOf(a, 'op', ['union', 'subtract', 'intersect', 'xor'] as const) as BoolOp;
      if (objs.length < (op === 'union' ? 1 : 2)) throw new ToolError('Mindestens zwei Objekte angeben (union: eine Gruppe oder ein Text genügt)');
      const base = oneOf(a, 'base', ['first', 'back', 'front'] as const, 'first');
      ed.setSel(objs);
      const keep = ed.boolKeep;
      ed.boolKeep = bool(a, 'keep_originals', false);
      try {
        await ed.booleanSel(op, base === 'first' ? 'selection' : base);
      } finally {
        ed.boolKeep = keep;
      }
      return result(ed, before);
    },
  },
  {
    name: 'offset',
    title: 'Offset',
    description: 'Neue Kontur im Abstand distance (mm) nach außen, innen oder beidseitig. Ecken: round, miter, square. Originale bleiben, außer keep_originals = false.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, distance: { type: 'number', exclusiveMinimum: 0 }, direction: { type: 'string', enum: ['outward', 'inward', 'both'] },
      join: { type: 'string', enum: ['round', 'miter', 'square'] }, keep_originals: { type: 'boolean' },
    }, ['ids', 'distance']),
    run: async (ed, a) => {
      const before = snapshotIds(ed);
      ed.setSel(topObjs(ed, ids(a)));
      const opt: OffsetOptions = {
        distance: num(a, 'distance', { min: 0.001, max: 1000 }),
        direction: oneOf(a, 'direction', ['outward', 'inward', 'both'] as const, 'outward'),
        join: oneOf(a, 'join', ['round', 'miter', 'square'] as const, 'round'),
      };
      await ed.offsetSel(opt, bool(a, 'keep_originals', true));
      return result(ed, before);
    },
  },
  {
    name: 'warp',
    title: 'Verformen',
    description:
      'Verformt die Objekte gemeinsam über ihren Rahmen: arc (Bogen), arcUpper/arcLower (nur obere/untere Kante), bulge (Wölben), flag (Welle), perspective (Fluchtpunkt). amount -100 … 100 (%), negativ in die andere Richtung; vertical = um 90° gedreht. Formen und Texte werden zu Bézierpfaden (Text ist danach nicht mehr als Text bearbeitbar), Bilder werden neu berechnet.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, kind: { type: 'string', enum: [...WARP_KINDS] }, amount: { type: 'number', minimum: -100, maximum: 100 }, vertical: { type: 'boolean' },
    }, ['ids', 'kind', 'amount']),
    run: async (ed, a) => {
      const before = snapshotIds(ed);
      ed.setSel(topObjs(ed, ids(a)));
      await ed.warpSel({
        kind: oneOf(a, 'kind', WARP_KINDS),
        amount: num(a, 'amount', { min: -100, max: 100 }),
        vertical: bool(a, 'vertical', false),
      });
      return result(ed, before);
    },
  },
  {
    name: 'apply_path_to_text',
    title: 'Text auf Pfad',
    description:
      'Lässt einen Text einer Form folgen (Linie/Pfad, Rechteck, Ellipse, Polygon), wie „Apply Path to Text“ in LightBurn. Text und Form bleiben verknüpft: Wird die Form verschoben oder geändert, folgt der Text; wird nur der Text verschoben, wandert die Form mit. Die Form wird mitgelasert (auf Layer T1/T2 legen oder ausblenden, wenn nicht); wird sie gelöscht, behält der Text die letzte Kurve. Offene Kurven: Anfang/Mitte/Ende je nach align des Texts; geschlossene Formen: oberster Punkt. Feinjustieren mit edit_object (pathOffset, pathDistance, pathFlip).',
    tier: Tier.Edit,
    inputSchema: obj({ textId: { type: 'integer' }, shapeId: { type: 'integer' } }, ['textId', 'shapeId']),
    run: (ed, a) => {
      const [to, so] = topObjs(ed, [num(a, 'textId', { int: true }), num(a, 'shapeId', { int: true })]);
      if (to.shape.kind !== 'text') throw new ToolError(`Objekt ${to.id} ist kein Text`);
      if (!['path', 'rect', 'ellipse', 'polygon'].includes(so.shape.kind)) throw new ToolError(`Objekt ${so.id} (${so.shape.kind}) taugt nicht als Kurve`);
      ed.setSel([to, so]);
      if (!ed.applyPathToText()) throw new ToolError(ed.hint || 'Text auf Pfad nicht möglich');
      return { object: describe(ed, to, IDENT, false), note: 'Die Form ist mit dem Text verknüpft und wird mitgelasert, außer auf Layer T1/T2 oder ausgeblendet.' };
    },
  },
  {
    name: 'convert_to_path',
    title: 'In Pfad umwandeln',
    description: 'Wandelt Formen und Texte (über die Schriftkonturen) in Pfade um.',
    tier: Tier.Edit,
    inputSchema: obj({ ids: IDS }, ['ids']),
    run: async (ed, a) => {
      const objs = topObjs(ed, ids(a));
      ed.setSel(objs);
      await ed.convertSelToPath();
      return { objects: describeAll(ed, objs), message: ed.hint };
    },
  },
  {
    name: 'path_tool',
    title: 'Pfad-Werkzeuge',
    description:
      'Pfad-Werkzeuge wie in LightBurn. op "close": offene Pfade schließen, deren Anfang und Ende höchstens tolerance mm (Standard 0.5) auseinanderliegen; close_mode "line" fügt eine Gerade ein, "move" zieht die Enden zusammen. ' +
      'op "join": offene Pfade verbinden, deren Enden höchstens tolerance mm (Standard 0.05) auseinanderliegen (Auto-Join); beteiligte Objekte werden zu einem. ' +
      'op "break_apart": in einzelne Geraden und Kurven zerlegen (Texte über ihre Konturen). op "reverse": Laufrichtung umkehren. ' +
      'op "set_start": Startpunkt des Schnitts auf den Knoten legen, der x/y am nächsten liegt (ein Objekt in ids); reverse kehrt dabei die Richtung um, reset überlässt Startpunkt und Richtung wieder der Optimierung. Offene Pfade beginnen nur an einem Ende. ' +
      'op "trim": den Abschnitt der Kurve bei x/y bis zu den nächsten Schnittpunkten mit anderen Kurven entfernen (ids nicht nötig); ohne Schnittpunkt wird der ganze Pfad entfernt. Reste werden an den Schnittpunkten verbunden, außer no_join; keep_piece behält das entfernte Stück auf dem aktuellen Layer. ' +
      'op "corners": Ecken der Objekte in ids runden (corner_mode "round", Radius radius mm), nach innen runden ("inverse", Bogen um die Ecke mit Radius radius) oder fasen ("chamfer", radius = Abstand von der Ecke); ' +
      'points beschränkt das auf die Ecken, die diesen Punkten {x, y} am nächsten liegen (ein Objekt in ids), sonst alle Ecken. Zu kurze Kanten verkleinern den Radius. ' +
      'Ergebnisse bleiben Bézierkurven; Grundformen werden dabei zu Pfaden.',
    tier: Tier.Edit,
    inputSchema: obj({
      op: { type: 'string', enum: ['close', 'join', 'break_apart', 'reverse', 'set_start', 'trim', 'corners'] }, ids: IDS,
      corner_mode: { type: 'string', enum: ['round', 'inverse', 'chamfer'] }, radius: { type: 'number', exclusiveMinimum: 0 },
      points: { type: 'array', items: obj({ x: { type: 'number' }, y: { type: 'number' } }, ['x', 'y']) },
      tolerance: { type: 'number', exclusiveMinimum: 0 }, close_mode: { type: 'string', enum: ['line', 'move'] },
      x: { type: 'number' }, y: { type: 'number' }, reverse: { type: 'boolean' }, reset: { type: 'boolean' },
      keep_piece: { type: 'boolean' }, no_join: { type: 'boolean' },
    }, ['op']),
    run: async (ed, a) => {
      const before = snapshotIds(ed);
      const op = oneOf(a, 'op', ['close', 'join', 'break_apart', 'reverse', 'set_start', 'trim', 'corners'] as const);
      ed.hint = '';
      if (op === 'trim') {
        const p = W(ed, num(a, 'x'), num(a, 'y'));
        if (!ed.trimAtPoint(p, num(a, 'tolerance', { def: 1, min: 0.001, max: 100 }), { keepCopy: bool(a, 'keep_piece', false), noJoin: bool(a, 'no_join', false) }))
          throw new ToolError('Keine trimmbare Kurve (Pfad, Rechteck, Ellipse, Polygon auf oberster Ebene) in der Nähe von x/y');
        return result(ed, before, { selection: ed.sel.map((o) => o.id) });
      }
      const objs = topObjs(ed, ids(a));
      ed.setSel(objs);
      if (op === 'close') {
        const st = ed.closeSel(num(a, 'tolerance', { def: 0.5, min: 0.001, max: 1000 }), oneOf(a, 'close_mode', ['line', 'move'] as const, 'line'));
        return result(ed, before, { open: st.open, closed: st.closed, objects: describeAll(ed, objs.filter((o) => ed.doc.objs.includes(o))) });
      }
      if (op === 'join') {
        const joins = ed.joinSel(num(a, 'tolerance', { def: 0.05, min: 0.0001, max: 100 }));
        return result(ed, before, { joins, objects: describeAll(ed, ed.sel) });
      }
      if (op === 'break_apart') {
        const n = await ed.breakApartSel();
        if (!n) throw new ToolError(ed.hint || 'Nichts zu zerlegen');
        return result(ed, before);
      }
      if (op === 'corners') {
        const points = Array.isArray(a.points) ? (a.points as { x: number; y: number }[]) : [];
        const prevTool = ed.tool;
        if (points.length) {
          if (objs.length !== 1) throw new ToolError('points braucht genau ein Objekt in ids');
          const o = objs[0];
          if (!['path', 'rect', 'ellipse', 'polygon'].includes(o.shape.kind)) throw new ToolError(`Objekt ${o.id} (${o.shape.kind}) hat keine Ecken`);
          ed.setTool('node');
          ed.setSel(objs);
          const sel = ed.nodeSelection(o);
          sel.clear();
          const world = transformSubs(shapeSubs(o.shape), o.m);
          for (const pt of points) {
            const p = W(ed, Number(pt.x), Number(pt.y));
            let best = Infinity,
              key = '';
            world.forEach((sp, si) => sp.nodes.forEach((nd, ni) => {
              const d = Math.hypot(nd.x - p.x, nd.y - p.y);
              if (d < best) [best, key] = [d, `${si}:${ni}`];
            }));
            if (key) sel.add(key);
          }
        }
        try {
          const n = ed.cornerSel(oneOf(a, 'corner_mode', ['round', 'inverse', 'chamfer'] as const, 'round'), num(a, 'radius', { min: 0.001, max: 1000 }));
          if (!n) throw new ToolError(ed.hint || 'Keine Ecken bearbeitet');
          return result(ed, before, { corners: n, message: ed.hint, objects: describeAll(ed, objs) });
        } finally {
          if (ed.tool !== prevTool) ed.setTool(prevTool);
        }
      }
      if (op === 'reverse') {
        ed.reverseSel();
        return result(ed, before, { objects: describeAll(ed, objs) });
      }
      if (objs.length !== 1) throw new ToolError('set_start braucht genau ein Objekt in ids');
      const o = objs[0];
      if (!['path', 'rect', 'ellipse', 'polygon'].includes(o.shape.kind)) throw new ToolError(`Objekt ${o.id} (${o.shape.kind}) hat keine Knoten`);
      const mode = bool(a, 'reset', false) ? 'reset' : bool(a, 'reverse', false) ? 'reverse' : 'set';
      if (!ed.startAtPoint(o, W(ed, num(a, 'x'), num(a, 'y')), mode)) throw new ToolError(ed.hint || 'Startpunkt nicht gesetzt');
      return result(ed, before, { object: describe(ed, o, IDENT, false) });
    },
  },
  {
    name: 'array_grid',
    title: 'Rasterarray',
    description:
      'Kopiert Objekte im Raster. dx/dy: Lücke zwischen den Kopien (spacing "gap") oder Mittenabstand ("center"). Richtung: dir_x 1 = nach rechts, dir_y 1 = nach oben. row_shift versetzt jede zweite Zeile waagerecht. group: alles gruppieren.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, columns: { type: 'integer', minimum: 1 }, rows: { type: 'integer', minimum: 1 }, dx: { type: 'number' }, dy: { type: 'number' },
      spacing: { type: 'string', enum: ['gap', 'center'] }, dir_x: { type: 'integer', enum: [1, -1] }, dir_y: { type: 'integer', enum: [1, -1] },
      row_shift: { type: 'number' }, col_shift: { type: 'number' }, mirror_cols: { type: 'boolean' }, mirror_rows: { type: 'boolean' }, group: { type: 'boolean' },
    }, ['ids', 'columns', 'rows']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      ed.setSel(topObjs(ed, ids(a)));
      const o: GridOptions = {
        ...DEFAULT_GRID,
        columns: num(a, 'columns', { min: 1, max: 1000, int: true }), rows: num(a, 'rows', { min: 1, max: 1000, int: true }),
        dx: num(a, 'dx', { def: DEFAULT_GRID.dx }), dy: num(a, 'dy', { def: DEFAULT_GRID.dy }),
        spacing: oneOf(a, 'spacing', ['gap', 'center'] as const, 'gap'),
        dirX: num(a, 'dir_x', { def: 1 }) < 0 ? -1 : 1, dirY: num(a, 'dir_y', { def: -1 }) < 0 ? -1 : 1,
        rowShift: num(a, 'row_shift', { def: 0 }), colShift: num(a, 'col_shift', { def: 0 }),
        mirrorCols: bool(a, 'mirror_cols', false), mirrorRows: bool(a, 'mirror_rows', false),
      };
      if (o.columns * o.rows < 2) throw new ToolError('Mindestens zwei Felder (columns × rows)');
      ed.applyArray(gridMatrices(ed.selBounds()!, o), bool(a, 'group', false), t('Rasterarray'));
      return result(ed, before);
    },
  },
  {
    name: 'array_circular',
    title: 'Kreisarray',
    description:
      'Kopiert Objekte auf einem Kreis um cx/cy (Standard: Mitte des Betts). count = Anzahl einschließlich Original, span = Winkelbereich in Grad (360 = gleichmäßig). rotate: Kopien mitdrehen.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, count: { type: 'integer', minimum: 2 }, cx: { type: 'number' }, cy: { type: 'number' }, span: { type: 'number' },
      ccw: { type: 'boolean' }, rotate: { type: 'boolean' }, group: { type: 'boolean' },
    }, ['ids', 'count']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      ed.setSel(topObjs(ed, ids(a)));
      const c = W(ed, num(a, 'cx', { def: ed.doc.bed.w / 2 }), num(a, 'cy', { def: ed.doc.bed.h / 2 }));
      const mats = circularMatrices(ed.selBounds()!, {
        count: num(a, 'count', { min: 2, max: 5000, int: true }), cx: c.x, cy: c.y, span: num(a, 'span', { def: 360 }),
        ccw: bool(a, 'ccw', true), rotate: bool(a, 'rotate', true),
      });
      ed.applyArray(mats, bool(a, 'group', false), t('Kreisarray'));
      return result(ed, before);
    },
  },
  {
    name: 'jig_fill',
    title: 'Auf Jig-Fächer legen',
    description:
      'Kopiert ein Design (ids, oberste Ebene) in die Fächer eines Jigs (Generator „jig“) der aktuellen Seite. jig: id des Jig-Objekts (ohne: der Jig, auf dem das Design liegt, sonst der erste). slots: Fachnummern wie „1-5, 8“ (Standard alle). kind: nur Fächer dieser Werkstückart (Index ab 0). Liegt das Design auf einem Fach, behalten die Kopien seine Lage im Fach, sonst kommt seine Mitte auf jede Fachmitte. series: variabler Text zählt je Fach weiter (Fach 1 = aktuelle Nummer bzw. CSV-Zeile). hide_jig: Jig danach ausblenden (nicht lasern, Standard true). group: je Fach gruppieren.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, jig: { type: 'integer' }, slots: { type: 'string' }, kind: { type: 'integer', minimum: 0 },
      series: { type: 'boolean' }, hide_jig: { type: 'boolean' }, group: { type: 'boolean' },
    }, ['ids']),
    run: async (ed, a) => {
      const jigs = findJigs(ed.doc.objs);
      if (!jigs.length) throw new ToolError('Auf der aktuellen Seite gibt es keinen Jig');
      const tops = new Set(jigs.map((j) => j.top));
      const design = topObjs(ed, ids(a)).filter((o) => !tops.has(o));
      if (!design.length) throw new ToolError('Kein Design: ids dürfen nicht nur der Jig sein');
      const b = boundsOf(design);
      const jig = a.jig !== undefined ? jigs.find((j) => j.top.id === a.jig || j.part.id === a.jig) : (b ? jigs.find((j) => refSlot(j, b) >= 0) : undefined) ?? jigs[0];
      if (!jig) throw new ToolError('„jig“ ist keine id eines Jigs auf dieser Seite');
      const all = parseSlotRange(typeof a.slots === 'string' ? a.slots : '', jig.layout.slots.length);
      if (!all) throw new ToolError('„slots“ nicht lesbar, Beispiel: 1-5, 8');
      const kind = a.kind === undefined ? -1 : num(a, 'kind', { int: true, min: 0 });
      const picks = all.filter((i) => kind < 0 || jig.layout.slots[i].shape === kind);
      if (!picks.length) throw new ToolError('Keine passenden Fächer');
      ed.snapshot('Auf Jig-Fächer legen');
      const made = fillJig(ed.doc.objs, design, jig, picks, { series: bool(a, 'series', true), group: bool(a, 'group', false), hideJig: bool(a, 'hide_jig', true), hideTemplate: true });
      ed.emit('doc');
      return { slots: picks.map((i) => i + 1), created: made.map((o) => o.id), jig: jig.top.id, jig_hidden: !!jig.top.hidden };
    },
  },
  {
    name: 'nest',
    title: 'Verschachteln',
    description:
      'Verschachtelt (Nesting) Objekte der aktuellen Seite platzsparend mit ihren echten Konturen. sheet: bed (Arbeitsbereich), material (Rechteck width × height, linke untere Ecke x/y) oder shape (Form container aus ids bzw. die größte gewählte als Platte, z. B. ein Reststück; sie bleibt liegen). gap: Abstand zwischen Teilen, margin: zum Rand (mm). rotation_step in Grad (0 = nicht drehen, Standard 90). corner: Ecke, an der begonnen wird (bl, br, tl, tr). holes: kleine Teile in Löcher legen. avoid_others: nicht gewählte Objekte umgehen. new_pages: was nicht passt, auf neue Seiten hinter der aktuellen. Objekte, die sich überschneiden (Gravur auf einem Teil, Loch als eigene Form), und Text auf Pfad bleiben beisammen. quality: fast, normal, fine.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, sheet: { type: 'string', enum: ['bed', 'material', 'shape'] }, width: { type: 'number', exclusiveMinimum: 0 }, height: { type: 'number', exclusiveMinimum: 0 },
      x: { type: 'number' }, y: { type: 'number' }, container: { type: 'integer' }, gap: { type: 'number', minimum: 0 }, margin: { type: 'number', minimum: 0 },
      rotation_step: { type: 'number', minimum: 0, maximum: 180 }, corner: { type: 'string', enum: ['bl', 'br', 'tl', 'tr'] },
      holes: { type: 'boolean' }, avoid_others: { type: 'boolean' }, new_pages: { type: 'boolean' }, quality: { type: 'string', enum: ['fast', 'normal', 'fine'] },
    }, ['ids']),
    run: async (ed, a) => {
      const objs = topObjs(ed, ids(a));
      const sheet = oneOf(a, 'sheet', ['bed', 'material', 'shape'] as const, 'bed');
      const d = DEFAULT_NEST_SETTINGS;
      const s: NestSettings = {
        sheet,
        w: num(a, 'width', { def: sheet === 'material' ? undefined : d.w, min: 1 }),
        h: num(a, 'height', { def: sheet === 'material' ? undefined : d.h, min: 1 }),
        x: num(a, 'x', { def: 0 }), y: num(a, 'y', { def: 0 }),
        gap: num(a, 'gap', { def: d.gap, min: 0 }), margin: num(a, 'margin', { def: d.margin, min: 0 }),
        rotStep: num(a, 'rotation_step', { def: d.rotStep, min: 0, max: 180 }),
        corner: oneOf(a, 'corner', ['bl', 'br', 'tl', 'tr'] as const, d.corner),
        holes: bool(a, 'holes', d.holes), avoid: bool(a, 'avoid_others', d.avoid), newPages: bool(a, 'new_pages', d.newPages),
        quality: oneOf(a, 'quality', ['fast', 'normal', 'fine'] as const, 'normal'),
        container: a.container === undefined ? undefined : num(a, 'container', { int: true }),
      };
      if (s.container !== undefined && !objs.some((o) => o.id === s.container)) throw new ToolError('„container“ muss eine der ids sein');
      ed.setSel(objs);
      const r = await ed.nestSel(s);
      if (!r || !r.placed.length) throw new ToolError(ed.hint || 'Nichts verschachtelt');
      const pageOf = (o: Obj) => ed.doc.pages.findIndex((p) => p.objs.includes(o)) + 1;
      return {
        placed: r.placed.map((u) => ({ ids: u.map((o) => o.id), page: pageOf(u[0]) })),
        ...(r.unplaced.length ? { unplaced: r.unplaced.map((u) => u.map((o) => o.id)) } : {}),
        new_pages: r.newPages,
        usage_percent: r.usage.map((u) => Math.round(u * 100)),
        hint: ed.hint,
        pages: pageList(ed),
      };
    },
  },
  {
    name: 'make_hinge',
    title: 'Biegeschnitte',
    description:
      'Füllt geschlossene Formen mit einem Biegemuster (Living Hinge). kind: straight, wave, diamond, honeycomb, triangle, cross, spiral. Mit thickness (Materialdicke) werden passende Startwerte gewählt; einzelne Werte (cutLength, bridge, spacing, margin, waveAmp, waveLength, diamondAngle in mm bzw. Grad) überschreiben sie. orient: auto, vertical, horizontal, angle (dann angle in Grad). keep_outline: Form behalten.',
    tier: Tier.Edit,
    inputSchema: obj({
      ids: IDS, kind: { type: 'string', enum: ['straight', 'wave', 'diamond', 'honeycomb', 'triangle', 'cross', 'spiral'] },
      orient: { type: 'string', enum: ['auto', 'vertical', 'horizontal', 'angle'] }, keep_outline: { type: 'boolean' },
      ...Object.fromEntries(HINGE_KEYS.map((k) => [k, { type: 'number' }])),
    }, ['ids']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      ed.setSel(topObjs(ed, ids(a)));
      if (!ed.hingeTargets().length) throw new ToolError('Keine geschlossene Form unter den Objekten (Bilder und Texte zählen nicht)');
      const th = optNum(a, 'thickness', { min: 0.1 });
      const opt: HingeOptions = { ...DEFAULT_HINGE, ...(th ? { thickness: th, ...suggestHinge(th) } : {}) };
      opt.kind = oneOf(a, 'kind', ['straight', 'wave', 'diamond', 'honeycomb', 'triangle', 'cross', 'spiral'] as const, 'straight') as HingeKind;
      opt.orient = oneOf(a, 'orient', ['auto', 'vertical', 'horizontal', 'angle'] as const, 'auto');
      opt.keepOutline = bool(a, 'keep_outline', false);
      for (const k of HINGE_KEYS) {
        const v = optNum(a, k, { min: k === 'angle' ? -360 : 0 });
        if (v !== undefined) opt[k] = v;
      }
      if (!ed.applyHinge(opt)) throw new ToolError(ed.hint);
      return result(ed, before);
    },
  },
  {
    name: 'list_edges',
    title: 'Gerade Kanten auflisten',
    description: 'Gerade Kanten eines Objekts (auch in Gruppen) mit sub/seg-Nummer, Anfang, Ende und Länge, für make_joint.',
    tier: Tier.Read,
    inputSchema: obj({ id: { type: 'integer' } }, ['id']),
    run: (ed, a) => {
      const hit = findObj(ed.doc.objs, num(a, 'id', { int: true }));
      if (!hit) throw new ToolError(`Kein Objekt mit id ${a.id}`);
      const [o, parent] = hit;
      if (o.shape.kind === 'group' || o.shape.kind === 'text' || o.shape.kind === 'image') throw new ToolError(`Objekte vom Typ ${o.shape.kind} haben keine Kanten; Gruppen erst auflösen, Text in Pfad umwandeln`);
      const m = mul(flip(ed), mul(parent, o.m));
      const edges: unknown[] = [];
      shapeSubs(o.shape).forEach((sp: SubPath, sub) =>
        segments(sp).forEach((s, seg) => {
          if (!isStraight(o, sub, seg)) return;
          const p = apply(m, s.a.x, s.a.y), q = apply(m, s.b.x, s.b.y);
          edges.push({ sub, seg, from: [r3(p.x), r3(p.y)], to: [r3(q.x), r3(q.y)], length: r3(Math.hypot(q.x - p.x, q.y - p.y)) });
        }),
      );
      return { id: o.id, edges };
    },
  },
  {
    name: 'make_joint',
    title: 'Holzverbindung',
    description:
      'Verbindung an geraden Kanten (Nummern aus list_edges). edges: erste Kante = Zinken/Zapfen, zweite = Gegenstück bzw. Linie für die Schlitze; eine Kante allein geht auch. kind: finger, tenon, lap, snap, hook, wedge, tslot, lidhinge. lidhinge = Deckelscharnier mit Stift: erste Kante = Oberkante der Rückwand, zweite = Hinterkante des Deckels (beide nötig); beide Platten bekommen Schlitze, die Knöchel entstehen als neues Objekt (hingeCount ungerade, pinDia, pinPlay, hingeWall in mm). thickness = Materialdicke (mm). Weitere Werte wie im Dialog: fingerWidth, direction (in/out), swap, tenonCount, tenonWidth, slotOffset, lapCount, lapDepth, snapLip, snapLength, snapRelief, hookLength, hookFlip, wedgeWidth, wedgePull, boltDia, nutWidth, nutHeight, boltLength, hingeCount, pinDia, pinPlay, hingeWall, kerf, clearance. Die Objekte werden zu Pfaden.',
    tier: Tier.Edit,
    inputSchema: obj({
      edges: {
        type: 'array', minItems: 1, maxItems: 2,
        items: obj({ id: { type: 'integer' }, sub: { type: 'integer' }, seg: { type: 'integer' } }, ['id', 'sub', 'seg']),
      },
      kind: { type: 'string', enum: ['finger', 'tenon', 'lap', 'snap', 'hook', 'wedge', 'tslot', 'lidhinge'] },
      direction: { type: 'string', enum: ['in', 'out'] }, swap: { type: 'boolean' }, hookFlip: { type: 'boolean' },
      ...Object.fromEntries(JOINT_NUM_KEYS.map((k) => [k, { type: 'number' }])),
    }, ['edges', 'kind', 'thickness']),
    run: (ed, a) => {
      const before = snapshotIds(ed);
      if (!Array.isArray(a.edges) || !a.edges.length || a.edges.length > 2) throw new ToolError('„edges“ braucht eine oder zwei Kanten');
      const picks: EdgePick[] = a.edges.map((e: Args, i: number) => {
        const hit = findObj(ed.doc.objs, Number(e?.id));
        if (!hit) throw new ToolError(`Kante ${i + 1}: kein Objekt mit id ${e?.id}`);
        const [o, parent] = hit;
        const sub = Number(e.sub), seg = Number(e.seg);
        if (!isStraight(o, sub, seg)) throw new ToolError(`Kante ${i + 1}: sub ${sub}/seg ${seg} ist keine gerade Kante von Objekt ${o.id} (siehe list_edges)`);
        return { obj: o, m: mul(parent, o.m), sub, seg };
      });
      const opt: JointOptions = { ...DEFAULT_JOINT, kind: oneOf(a, 'kind', ['finger', 'tenon', 'lap', 'snap', 'hook', 'wedge', 'tslot', 'lidhinge'] as const) as JointKind };
      for (const k of JOINT_NUM_KEYS) {
        const v = optNum(a, k);
        if (v !== undefined) opt[k] = v;
      }
      if (a.direction !== undefined) opt.direction = oneOf(a, 'direction', ['in', 'out'] as const);
      opt.swap = bool(a, 'swap', false);
      opt.hookFlip = bool(a, 'hookFlip', false);
      ed.jointPicks = picks;
      if (!ed.applyJoint(opt)) {
        ed.jointPicks = [];
        throw new ToolError(ed.hint);
      }
      return result(ed, before, { changed: [...new Set(picks.map((p) => p.obj.id))] });
    },
  },
  {
    name: 'set_layer',
    title: 'Layer einstellen',
    description: `Ändert die Einstellungen eines Layers. Felder: ${Object.entries(LAYER_KEYS).map(([k, v]) => `${k} (${v})`).join(', ')}. speed in mm/min, power/minPower in %, kerf/interval in mm, fillStyle offset = Füllen in Ringen entlang der Kontur, angle in Grad, overscan in %. Nur Linie: perforate/perfLength/perfGap (gestrichelt schneiden, mm), leadIn/leadOut/leadLength/leadAngle/leadArc (Anschnitt und Auslauf auf der Abfallseite geschlossener Formen; Winkel zur Kontur in Grad, bei Bogen Bogenwinkel), overcut (mm über den Start hinaus), powerRamp/rampLength/rampAngle/rampEnds (Leistung in Ecken ab rampAngle Grad Richtungswechsel auf minPower absenken). zOffset/zStep: Fokus in mm tiefer beim ersten bzw. je weiterem Durchgang (nur mit Z-Achse am Gerät). subLayers: Liste weiterer Bearbeitungen derselben Formen nach dem Layer (ersetzt die bisherigen; [] entfernt alle), je Eintrag dieselben Felder außer ${['name', 'visible', 'locked', 'airAssist'].join(', ')}; output false = nicht ausgeben.`,
    tier: Tier.Edit,
    inputSchema: obj({
      layer: { ...LAYER, description: 'Layer 0–29' },
      ...Object.fromEntries(Object.entries(LAYER_KEYS).map(([k, v]) => [k, v.includes('|') ? { type: 'string', enum: v.split('|') } : { type: v }])),
      subLayers: {
        type: 'array',
        items: obj(Object.fromEntries(SUB_FIELDS.map((k) => [k, LAYER_KEYS[k].includes('|') ? { type: 'string', enum: LAYER_KEYS[k].split('|') } : { type: LAYER_KEYS[k] }]))),
      },
    }, ['layer']),
    run: (ed, a) => {
      const i = num(a, 'layer', { min: 0, max: 31, int: true });
      const p: Record<string, unknown> = {};
      if (typeof a.name === 'string') p.name = a.name;
      if (a.output !== undefined) p.output = a.output === true;
      if (a.visible !== undefined) p.show = a.visible === true;
      if (a.locked !== undefined) p.locked = a.locked === true;
      const L = ed.layer(i);
      const { output: _o, ...cut } = cutPatch(a, L);
      Object.assign(p, cut);
      if (a.airAssist !== undefined) p.air = a.airAssist === true;
      if (a.subLayers !== undefined) {
        if (!Array.isArray(a.subLayers)) throw new ToolError('„subLayers“ muss eine Liste sein');
        p.sub = a.subLayers.length
          ? a.subLayers.map((raw, k) => {
              if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ToolError(`subLayers[${k}] muss ein Objekt sein`);
              const r = raw as Args;
              const prev = L.sub?.[k];
              const mode = r.mode === 'fill' ? 'fill' : r.mode === 'line' ? 'line' : (prev?.mode ?? 'line');
              const base = prev && prev.mode === mode ? structuredClone(prev) : defaultSubLayer(mode);
              return { ...base, ...cutPatch(r, base) } as SubLayer;
            })
          : undefined;
      }
      if (!Object.keys(p).length) throw new ToolError('Keine Einstellung angegeben');
      // Eigene Werte lösen den Layer von einem Eintrag der Material-Bibliothek
      if (Object.keys(p).some((k) => !['name', 'output', 'show', 'locked'].includes(k))) p.material = undefined;
      ed.updateLayer(i, p);
      return { layer: i, changed: Object.keys(p).filter((k) => k !== 'material') };
    },
  },
  {
    name: 'apply_material',
    title: 'Material übernehmen',
    description: 'Übernimmt einen Eintrag der Material-Bibliothek (id aus list_materials) auf einen Layer.',
    tier: Tier.Edit,
    inputSchema: obj({ layer: { ...LAYER, description: 'Layer 0–29' }, material_id: { type: 'string' } }, ['layer', 'material_id']),
    run: (ed, a) => {
      const e = library.get(String(a.material_id));
      if (!e) throw new ToolError(`Kein Eintrag mit id ${a.material_id} (siehe list_materials)`);
      const i = num(a, 'layer', { min: 0, max: 31, int: true });
      ed.updateLayer(i, layerPatch(e));
      return { layer: i, material: { id: e.id, material: e.material, thickness: e.thickness, title: e.title } };
    },
  },
  {
    name: 'import_svg',
    title: 'SVG einfügen',
    description:
      'Fügt SVG-Inhalt (Text) ein, z. B. selbst erzeugte Zeichnungen. Einheiten wie im SVG (width/height in mm empfohlen, sonst 96 dpi). Die SVG-Koordinaten zählen von der linken oberen Bettecke; liegt das Ergebnis außerhalb, kommt es in die Bettmitte. Mit x/y wird die linke untere Ecke danach dorthin gesetzt. Farben werden Layern zugeordnet; Text in SVG wird nicht übernommen.',
    tier: Tier.Edit,
    inputSchema: obj({ svg: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, ['svg']),
    run: async (ed, a) => {
      if (typeof a.svg !== 'string' || !a.svg.includes('<svg')) throw new ToolError('„svg“ enthält kein <svg>-Element');
      const before = snapshotIds(ed);
      await ed.importVectors(importSvg(a.svg), 'SVG');
      return placeImported(ed, a, before);
    },
  },
  {
    name: 'import_file',
    title: 'Datei importieren',
    description: 'Importiert eine Datei vom Rechner (SVG, DXF, PDF, AI, PNG, JPG, BMP, GIF, WebP) über ihren absoluten Pfad. Mit x/y wird die linke untere Ecke danach dorthin gesetzt.',
    tier: Tier.Edit,
    inputSchema: obj({ path: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, ['path']),
    run: async (ed, a) => {
      const path = String(a.path ?? '');
      if (!isTauri()) throw new ToolError('Nur in der Desktop-App');
      const { invoke } = await import('@tauri-apps/api/core');
      let buf: ArrayBuffer;
      try {
        buf = await invoke<ArrayBuffer>('read_file', { path });
      } catch (e) {
        throw new ToolError(`${path}: ${e}`);
      }
      const before = snapshotIds(ed);
      await importBytesOrThrow(ed, path.split(/[\\/]/).pop() ?? path, new Uint8Array(buf));
      return placeImported(ed, a, before);
    },
  },
  {
    name: 'switch_page',
    title: 'Seite wechseln',
    description: 'Wechselt zur Seite page (1 … n, siehe get_document). Bearbeitet, gelasert und exportiert wird immer die aktuelle Seite. Kein Undo-Schritt.',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({ page: { type: 'integer', minimum: 1 } }, ['page']),
    run: (ed, a) => {
      ed.setPage(pageIndex(ed, a, 'page'));
      return { pages: pageList(ed) };
    },
  },
  {
    name: 'edit_pages',
    title: 'Seiten bearbeiten',
    description:
      'Seiten des Projekts verwalten. action: "add" (neue leere Seite hinter der aktuellen, optional name; wechselt dorthin), "duplicate" (Seite page samt Objekten kopieren; wechselt zur Kopie), "delete" (Seite page löschen, die letzte Seite bleibt), "rename" (Seite page heißt name), "reorder" (Seite page an die Stelle to schieben). page: Standard aktuelle Seite. Layer-Einstellungen gelten für alle Seiten.',
    tier: Tier.Edit,
    inputSchema: obj(
      {
        action: { type: 'string', enum: ['add', 'duplicate', 'delete', 'rename', 'reorder'] },
        page: { type: 'integer', minimum: 1 },
        name: { type: 'string' },
        to: { type: 'integer', minimum: 1 },
      },
      ['action'],
    ),
    run: (ed, a) => {
      const action = oneOf(a, 'action', ['add', 'duplicate', 'delete', 'rename', 'reorder'] as const);
      const i = a.page === undefined ? ed.doc.page : pageIndex(ed, a, 'page');
      if (action === 'add') ed.addPage(typeof a.name === 'string' ? a.name : undefined);
      else if (action === 'duplicate') ed.duplicatePage(i);
      else if (action === 'delete') {
        if (ed.doc.pages.length < 2) throw new ToolError('Die einzige Seite lässt sich nicht löschen');
        ed.deletePage(i);
      } else if (action === 'rename') {
        const name = typeof a.name === 'string' ? a.name.trim() : '';
        if (!name) throw new ToolError('„name“ fehlt');
        ed.renamePage(i, name);
      } else ed.movePage(i, pageIndex(ed, a, 'to'));
      return { pages: pageList(ed) };
    },
  },
  {
    name: 'move_to_page',
    title: 'Auf andere Seite verschieben',
    description: 'Verschiebt Objekte der aktuellen Seite (oberste Ebene) auf die Seite page. Lage auf dem Bett und Layer bleiben gleich.',
    tier: Tier.Edit,
    inputSchema: obj({ ids: IDS, page: { type: 'integer', minimum: 1 } }, ['ids', 'page']),
    run: (ed, a) => {
      const objs = topObjs(ed, ids(a));
      const i = pageIndex(ed, a, 'page');
      if (i === ed.doc.page) throw new ToolError('Die Objekte liegen schon auf dieser Seite');
      ed.moveToPage(objs, i);
      return { moved: objs.map((o) => o.id), pages: pageList(ed) };
    },
  },
  {
    name: 'new_document',
    title: 'Neues Dokument',
    description: 'Neues leeres Projekt mit einer Seite (rückgängig machbar mit undo). Layer-Einstellungen werden zurückgesetzt.',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({}),
    run: (ed) => {
      ed.newDocument();
      return { ok: true };
    },
  },
  {
    name: 'open_document',
    title: 'Projekt öffnen',
    description: 'Öffnet eine KizamuBeam-Projektdatei (.kzb, ältere .lwk) über ihren absoluten Pfad und ersetzt das Dokument (rückgängig machbar mit undo).',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({ path: { type: 'string' } }, ['path']),
    run: async (ed, a) => {
      const path = String(a.path ?? '');
      if (!/\.(kzb|lwk|json)$/i.test(path)) throw new ToolError('Nur .kzb- oder .lwk-Dateien');
      if (!isTauri()) throw new ToolError('Nur in der Desktop-App');
      const { invoke } = await import('@tauri-apps/api/core');
      let buf: ArrayBuffer;
      try {
        buf = await invoke<ArrayBuffer>('read_file', { path });
      } catch (e) {
        throw new ToolError(`${path}: ${e}`);
      }
      try {
        ed.openDoc(new TextDecoder().decode(buf));
        ed.markSaved(tabNameFromPath(path));
      } catch (e) {
        throw new ToolError((e as Error).message);
      }
      return { objectCount: ed.doc.objs.length, bed: ed.doc.bed, pages: pageList(ed) };
    },
  },
  {
    name: 'save_document',
    title: 'Speichern',
    description:
      'Speichert das Projekt (.kzb, samt Bildern) oder exportiert unter einem absoluten Pfad: .svg und .dxf (aktuelle Seite), .pdf und .ai (PDF-kompatibel, alle Seiten). Texte werden zu Umrissen, DXF enthält keine Bilder. Eine vorhandene Datei wird nur mit overwrite überschrieben.',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({ path: { type: 'string' }, overwrite: { type: 'boolean' } }, ['path']),
    run: async (ed, a) => {
      const path = String(a.path ?? '');
      const ext = (/\.([a-z]+)$/i.exec(path)?.[1] ?? '').toLowerCase();
      if (!['kzb', 'svg', 'dxf', 'pdf', 'ai'].includes(ext)) throw new ToolError('Der Pfad muss auf .kzb, .svg, .dxf, .pdf oder .ai enden');
      if (!isTauri()) throw new ToolError('Nur in der Desktop-App');
      const { invoke } = await import('@tauri-apps/api/core');
      let contents: string,
        base64 = false,
        notes: string[] = [];
      if (ext === 'svg') contents = buildSvg(ed);
      else if (ext === 'dxf') ({ text: contents, notes } = await buildDxfText(ed));
      else if (ext === 'pdf' || ext === 'ai') {
        const r = await buildPdfBytes(ed);
        contents = bytesToBase64(r.bytes);
        notes = r.notes;
        base64 = true;
      } else contents = ed.serialize();
      try {
        await invoke('agent_write_file', { path, contents, overwrite: bool(a, 'overwrite', false), base64 });
        if (ext === 'kzb') ed.markSaved(tabNameFromPath(path));
      } catch (e) {
        throw new ToolError(String(e));
      }
      return notes.length ? { saved: path, notes } : { saved: path };
    },
  },
  {
    name: 'undo',
    title: 'Rückgängig',
    description: 'Macht den letzten Schritt rückgängig (auch Schritte der Person).',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({ steps: { type: 'integer', minimum: 1, maximum: 50 } }),
    run: (ed, a) => {
      const n = num(a, 'steps', { def: 1, min: 1, max: 50, int: true });
      for (let i = 0; i < n; i++) ed.doUndo();
      return { objectCount: ed.doc.objs.length };
    },
  },
  {
    name: 'redo',
    title: 'Wiederholen',
    description: 'Stellt rückgängig gemachte Schritte wieder her.',
    tier: Tier.Edit,
    ownUndo: true,
    inputSchema: obj({ steps: { type: 'integer', minimum: 1, maximum: 50 } }),
    run: (ed, a) => {
      const n = num(a, 'steps', { def: 1, min: 1, max: 50, int: true });
      for (let i = 0; i < n; i++) ed.doRedo();
      return { objectCount: ed.doc.objs.length };
    },
  },
  {
    name: 'check_design',
    title: 'Konstruktion prüfen',
    description:
      'Fertigungsprüfung der aktuellen Seite wie im Fenster „Prüfung“: doppelte Schnittlinien (double), ungewollt offene Umrisse (open), Einzellinien, die einen Umriss bilden, aber nicht verbunden sind (unjoined), schmale Stege zwischen Schnitten (web), zu kleine Innenausschnitte für Schnittbreite/Kerf (hole), Objekte außerhalb des Arbeitsbereichs (bed, nur bei absolutem Start), beim Import übersprungene Elemente (import), zu enge/lockere Steckverbindungen von Generatoren (Box, Schublade, Einsatz, Regal) und Verbindungs-Werkzeug bzw. Abweichung von der Kalibrierung des Materials (fit) sowie Materialdicke, die nicht zum Material des Layers passt (thickness), Teile einer Baugruppe, die nicht am Rest hängen (loose), und Teile, die sich mit steifem Material nicht gerade stecken lassen (insert). ' +
      'Liefert je Befund index, kind, level (error/warn/info), message, die betroffenen Objekt-ids, den Bereich (Maschinenkoordinaten) und, falls es eine gibt, die Korrektur (fix), die fix_design_issue mit diesem index anwendet. Einstellungen (Mindeststeg, Schnittbreite, Gravur-Layer) legt die Person im Fenster fest.',
    tier: Tier.Read,
    inputSchema: obj({}),
    run: (ed) => {
      const xs = ed.runCheck();
      return {
        settings: loadCheckSettings(),
        issues: xs.map((x, index) => issueInfo(ed, x, index)),
      };
    },
  },
  {
    name: 'fix_design_issue',
    title: 'Befund korrigieren',
    description:
      'Wendet die Korrektur eines Befunds aus check_design an (index aus dem letzten check_design-Aufruf): doppeltes Objekt löschen, doppelte Linien aus dem späteren Teil entfernen, Umriss schließen, Linien verbinden, aufs Bett schieben oder Import-Hinweis ausblenden. Rückgängig machbar. Danach wird neu geprüft; die Liste der verbleibenden Befunde kommt zurück.',
    tier: Tier.Edit,
    inputSchema: obj({ index: { type: 'integer', minimum: 0 } }, ['index']),
    run: async (ed, a) => {
      const before = snapshotIds(ed);
      const x = ed.checkIssues[num(a, 'index', { int: true, min: 0 })];
      if (!x) throw new ToolError('Kein Befund mit diesem index; erst check_design aufrufen');
      if (!x.fix) throw new ToolError('Für diesen Befund gibt es keine automatische Korrektur');
      if (!(await ed.applyCheckFix(x))) throw new ToolError(ed.hint || 'Korrektur nicht möglich (Objekt geändert oder entfernt); check_design erneut aufrufen');
      return result(ed, before, { remaining: ed.checkIssues.map((y, index) => issueInfo(ed, y, index)) });
    },
  },
];

/** Nach einem Import: neue Objekte melden und optional an x/y (linke untere Ecke) setzen */
function placeImported(ed: Editor, a: Args, before: Set<number>) {
  const added = ed.doc.objs.filter((o) => !before.has(o.id));
  if (!added.length) throw new ToolError(ed.hint || 'Nichts importiert');
  const x = optNum(a, 'x'), y = optNum(a, 'y');
  if (x !== undefined || y !== undefined) {
    ed.setSel(added);
    ed.setSelBox({ x, y: y === undefined ? undefined : ed.doc.bed.h - y }, 0, 1, false);
  }
  return result(ed, before);
}
