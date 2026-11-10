// Holzverbindungen für gelaserte Bauteile: Fingerzinken, Schlitz und Zapfen, Überblattung, Schnapp- und Hakenverbindung,
// Keilzapfen, T-Slot mit Mutter und Deckelscharnier mit Stift.
// Eine Verbindung wird auf gerade Kanten vorhandener Formen angewendet. Die Kante wird durch das Zinken- bzw.
// Zapfenprofil ersetzt, Schlitze kommen als geschlossene Unterpfade hinzu. Alles bleibt ein normaler Pfad mit
// geraden Segmenten (exakte Ecken, keine Näherung) und lässt sich danach im Knoteneditor weiter bearbeiten.
// Gerechnet wird in Weltkoordinaten (mm), damit Materialdicke und Breiten auch bei gedrehten oder skalierten
// Objekten stimmen; das Ergebnis wird in die lokalen Koordinaten des Objekts zurückgerechnet.
import { Mat, Node, Obj, Pt, SubPath } from './model';
import { bezierPt, segments, shapeSubs } from './geom';
import { transformSubs } from './importers';
import { dec, t, tn } from './i18n';

export type JointKind = 'finger' | 'tenon' | 'lap' | 'snap' | 'hook' | 'wedge' | 'tslot' | 'lidhinge';

export interface JointOptions {
  kind: JointKind;
  /** Materialdicke in mm: Tiefe der Zinken und Zapfen, Breite der Schlitze */
  thickness: number;
  /** Fingerzinken: ungefähre Breite eines Zinkens (die Anzahl wird ungerade gerundet) */
  fingerWidth: number;
  /** Fingerzinken: 'in' schneidet in die Kante ein (Teile im Außenmaß gezeichnet), 'out' lässt Zinken herausstehen (Innenmaß) */
  direction: 'in' | 'out';
  /** Fingerzinken: Zinken und Lücken zwischen den beiden Kanten tauschen */
  swap: boolean;
  /** Schlitz und Zapfen: Anzahl und Breite der Zapfen */
  tenonCount: number;
  tenonWidth: number;
  /** Schlitz und Zapfen: Abstand der Schlitzmitte von der gewählten Linie (bei Kanten geschlossener Formen nach innen) */
  slotOffset: number;
  /** Überblattung: Anzahl der Schlitze je Kante (gleichmäßig verteilt, wie bei Rastereinsätzen) */
  lapCount: number;
  /** Überblattung: Schlitztiefe der ersten Kante in % der Plattenbreite; die zweite Kante bekommt den Rest */
  lapDepth: number;
  /** Schnappverbindung: seitlicher Überstand der Rasthaken und Länge der Einführschräge (mm) */
  snapLip: number;
  snapLength: number;
  /** Schnappverbindung: wie tief der Federschlitz zwischen den Zungen in die Platte reicht (mm); längere Zungen federn leichter */
  snapRelief: number;
  /** Hakenverbindung: wie weit der Haken seitlich übersteht (= Schiebeweg) und Haken in die andere Richtung */
  hookLength: number;
  hookFlip: boolean;
  /** Keilzapfen: Breite des Keillochs im Zapfen (mm) und wie weit das Loch in die Gegenplatte reicht, damit der Keil anzieht */
  wedgeWidth: number;
  wedgePull: number;
  /** T-Slot: Schraubendurchmesser, Schlüsselweite und Höhe der Mutter, Schraubenlänge (mm) */
  boltDia: number;
  nutWidth: number;
  nutHeight: number;
  boltLength: number;
  /** Deckelscharnier: Anzahl der Knöchel (ungerade, die äußeren gehören zum Kasten) */
  hingeCount: number;
  /** Deckelscharnier: Durchmesser des Stifts bzw. Drahts, Spiel im Stiftloch und Wandstärke um das Loch (mm) */
  pinDia: number;
  pinPlay: number;
  hingeWall: number;
  /** Schnittbreite des Lasers in mm: Zinken/Zapfen werden um so viel breiter, Lücken/Schlitze schmaler gezeichnet */
  kerf: number;
  /** Spiel in mm: positiv = lockerer, negativ = strammer (Press-Fit) */
  clearance: number;
}

export const DEFAULT_JOINT: JointOptions = {
  kind: 'finger', thickness: 3, fingerWidth: 10, direction: 'in', swap: false,
  tenonCount: 2, tenonWidth: 15, slotOffset: 0, lapCount: 1, lapDepth: 50, snapLip: 0.6, snapLength: 3, snapRelief: 8, hookLength: 6, hookFlip: false,
  wedgeWidth: 6, wedgePull: 0.5, boltDia: 3.2, nutWidth: 5.6, nutHeight: 2.6, boltLength: 16, hingeCount: 5, pinDia: 3, pinPlay: 0.2, hingeWall: 2, kerf: 0, clearance: 0,
};

/** Gewählte gerade Kante: Blatt-Objekt, seine Weltmatrix und das Segment in shapeSubs(obj.shape) */
export interface EdgePick {
  obj: Obj;
  m: Mat;
  sub: number;
  seg: number;
}

interface EdgeGeom {
  a: Pt;
  b: Pt;
  len: number;
  /** Einheitsvektor von a nach b */
  dir: Pt;
  /** Einheitsnormale weg vom Material (bei offenen Linien: links der Laufrichtung in Bildschirmsicht) */
  out: Pt;
  closed: boolean;
}

export interface JointResult {
  /** Neue Unterpfade je geändertem Objekt, in Weltkoordinaten */
  changes: Map<Obj, { m: Mat; subs: SubPath[] }>;
  /** Neue Teile (z. B. Keile), in Weltkoordinaten */
  added: SubPath[];
  info: string;
  error?: string;
}

const sameEdge = (p: EdgePick, q: EdgePick) => p.obj === q.obj && p.sub === q.sub && p.seg === q.seg;

/** Unterpfade eines Objekts in Weltkoordinaten (Kopie) */
export const worldSubs = (o: Obj, m: Mat): SubPath[] => transformSubs(shapeSubs(o.shape), m);

/** Ist das Segment eine gerade Kante (keine Kurve, nicht entartet)? */
export function isStraight(o: Obj, sub: number, seg: number): boolean {
  const sp = shapeSubs(o.shape)[sub];
  const s = sp && segments(sp)[seg];
  return !!s && !s.curve && Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 1e-6;
}

/** Geschlossene Unterpfade als Polygone (Kurven fein abgetastet) */
function polygons(subs: SubPath[]): Pt[][] {
  return subs
    .filter((sp) => sp.closed)
    .map((sp) => {
      const pts: Pt[] = [];
      for (const s of segments(sp)) {
        if (!s.curve) pts.push(s.a);
        else for (let i = 0; i < 16; i++) pts.push(bezierPt(s.a, s.c1, s.c2, s.b, i / 16));
      }
      return pts;
    });
}

/** Punkt in der Fläche der geschlossenen Unterpfade (Gerade-Ungerade-Regel)? */
function insideSubs(subs: SubPath[], p: Pt): boolean {
  let inside = false;
  for (const pts of polygons(subs)) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i],
        b = pts[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

function edgeGeom(pick: EdgePick, subs: SubPath[]): EdgeGeom {
  const sp = subs[pick.sub];
  const s = segments(sp)[pick.seg];
  const a = { x: s.a.x, y: s.a.y },
    b = { x: s.b.x, y: s.b.y };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  let out = { x: dir.y, y: -dir.x };
  if (sp.closed) {
    const eps = Math.min(0.05, len * 0.01);
    const probe = { x: (a.x + b.x) / 2 + out.x * eps, y: (a.y + b.y) / 2 + out.y * eps };
    if (insideSubs(subs, probe)) out = { x: -out.x, y: -out.y };
  }
  return { a, b, len, dir, out, closed: sp.closed };
}

/** Abstand von p in Richtung d bis zur nächsten Kontur (Infinity, wenn keine getroffen wird) */
function rayDistance(subs: SubPath[], p: Pt, d: Pt): number {
  let best = Infinity;
  for (const pts of polygons(subs)) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[j],
        e = { x: pts[i].x - a.x, y: pts[i].y - a.y };
      const den = d.x * e.y - d.y * e.x;
      if (Math.abs(den) < 1e-12) continue;
      const wx = a.x - p.x,
        wy = a.y - p.y;
      const t = (wx * e.y - wy * e.x) / den,
        u = (wx * d.y - wy * d.x) / den;
      if (t > 1e-6 && u >= 0 && u <= 1) best = Math.min(best, t);
    }
  }
  return best;
}

/** Punkt im Kantensystem (u entlang der Kante ab a, v nach außen) in Weltkoordinaten */
const at = (g: EdgeGeom, u: number, v: number): Pt => ({ x: g.a.x + g.dir.x * u + g.out.x * v, y: g.a.y + g.dir.y * u + g.out.y * v });

/** Ungerade Zinkenanzahl (mindestens 3) möglichst nahe an Länge / Zielbreite */
export function fingerCount(len: number, width: number): number {
  const q = len / Math.max(0.1, width);
  let n = Math.round(q);
  if (n % 2 === 0) n += q >= n ? 1 : -1;
  return Math.max(3, n);
}

/**
 * Profil einer Fingerzinken-Kante im Kantensystem (ohne die Endpunkte a und b).
 * Das Muster (n gleiche Felder) liegt mittig auf der Kante; ist die Kante länger als pattern, verlängern sich die Endfelder.
 * Feld i ist Material, wenn (i + phase) gerade ist. adj verbreitert jedes Materialfeld insgesamt um adj (Kerf − Spiel).
 */
export function fingerProfile(len: number, pattern: number, n: number, phase: 0 | 1, vMat: number, vGap: number, adj: number): Pt[] {
  const w = pattern / n;
  const margin = (len - pattern) / 2;
  const mat = (i: number) => (i + phase) % 2 === 0;
  const level = (i: number) => (mat(i) ? vMat : vGap);
  const pts: Pt[] = [];
  if (level(0) !== 0) pts.push({ x: 0, y: level(0) });
  for (let i = 1; i < n; i++) {
    // Grenze rückt um adj/2 in das Lückenfeld hinein
    const u = margin + i * w + (mat(i - 1) ? adj / 2 : -adj / 2);
    pts.push({ x: u, y: level(i - 1) }, { x: u, y: level(i) });
  }
  if (level(n - 1) !== 0) pts.push({ x: len, y: level(n - 1) });
  return pts;
}

/** Mitten von n Überblattungs-Schlitzen: teilen die Kante in n + 1 gleiche Abschnitte (Fächer eines Rastereinsatzes) */
export const lapCenters = (len: number, n: number) => Array.from({ length: n }, (_, i) => (len * (i + 1)) / (n + 1));

/** Mitten von n gleichmäßig verteilten Zapfen auf einer Kante der Länge len */
export const tenonCenters = (len: number, n: number) => Array.from({ length: n }, (_, i) => (len * (2 * i + 1)) / (2 * n));

const fmt = (v: number) => dec(String(Math.round(v * 100) / 100));

/** Unterpfad aus Geraden und Kreisbögen (Bézier, je Stück höchstens 90°) */
class PathBuilder {
  nodes: Node[] = [];
  line(x: number, y: number) {
    this.nodes.push({ x, y });
    return this;
  }
  /** Bogen um (cx, cy) vom Winkel a0 bis a1 (Bogenmaß, Vorzeichen = Richtung); der letzte Knoten liegt bei a0 */
  arc(cx: number, cy: number, r: number, a0: number, a1: number) {
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
    const da = (a1 - a0) / n;
    const k = (4 / 3) * Math.tan(da / 4) * r;
    for (let i = 0; i < n; i++) {
      const p = a0 + i * da,
        q = p + da;
      const last = this.nodes[this.nodes.length - 1];
      last.cout = { x: last.x - Math.sin(p) * k, y: last.y + Math.cos(p) * k };
      const x = cx + Math.cos(q) * r,
        y = cy + Math.sin(q) * r;
      this.nodes.push({ x, y, cin: { x: x + Math.sin(q) * k, y: y - Math.cos(q) * k } });
    }
    return this;
  }
  /** Geschlossener Unterpfad; fällt der letzte Knoten auf den ersten, werden beide verschmolzen */
  close(): SubPath {
    const a = this.nodes[0],
      b = this.nodes[this.nodes.length - 1];
    if (this.nodes.length > 1 && Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) {
      if (b.cin) a.cin = b.cin;
      this.nodes.pop();
    }
    for (const nd of this.nodes) if (nd.cin && nd.cout) nd.smooth = true;
    return { closed: true, nodes: this.nodes };
  }
}

const circleSub = (cx: number, cy: number, r: number) => new PathBuilder().line(cx + r, cy).arc(cx, cy, r, 0, 2 * Math.PI).close();

/**
 * Maße des Deckelscharniers im Profil (Blick entlang der Stiftachse, mm).
 * x zeigt von der Außenseite der Rückwand nach hinten, y von der Oberkante der Rückwand nach oben.
 * Die Rückwand liegt bei x ∈ [−t, 0], y ≤ 0, der geschlossene Deckel bei x ≤ 0, y ∈ [0, t] (hinten bündig).
 * Die Achse sitzt hinter der Rückwand auf halber Deckeldicke: so bewegt sich die Deckelkante beim Öffnen erst
 * nach vorn und oben und streift die Kasten-Knöchel nicht.
 */
export function lidHingeDims(o: JointOptions) {
  const th = o.thickness;
  const adj = o.kerf - o.clearance;
  /** Radius des Auges um den Stift */
  const R = o.pinDia / 2 + o.pinPlay / 2 + o.hingeWall;
  /** Luft zwischen Auge und Rückwand bzw. Deckelkante */
  const gap = 0.5;
  const ax = R + gap,
    ay = th / 2;
  /** Zapfenlänge (Schlitzlänge) und Abstand des Schlitzes von der Kante */
  const T = Math.max(6, 2 * R);
  const s0 = Math.max(2, th);
  /** Mitte von Zapfen und Schlitz, von der Kante nach innen gemessen */
  const mid = s0 + T / 2;
  return {
    th, adj, R, gap, ax, ay, T, s0, mid,
    /** Halbe Zapfenlänge am Knöchel (Kerf − Spiel macht ihn länger) bzw. am Schlitz */
    tenonHalf: (T + adj) / 2,
    slotHalf: (T - adj) / 2,
    /** Durchmesser des Stiftlochs (der Kerf weitet es beim Schneiden auf) */
    hole: o.pinDia + o.pinPlay - o.kerf,
  };
}

/** Profile der beiden Knöchel-Arten im Profilsystem von lidHingeDims, jeweils Umriss + Stiftloch */
export function lidHingeProfiles(o: JointOptions): { box: SubPath[]; lid: SubPath[] } {
  const d = lidHingeDims(o);
  const { th, R, gap, ax, ay, mid, tenonHalf } = d;
  const PI = Math.PI;
  const yTop = -mid + tenonHalf,
    yBot = -mid - tenonHalf;
  // Kasten-Knöchel: Fuß hinter der Rückwand, Zapfen durch den Schlitz bis zur Innenseite, oben das halbe Auge
  const box = new PathBuilder()
    .line(0, ay)
    .line(gap, ay)
    .arc(ax, ay, R, PI, 0)
    .line(ax + R, yBot)
    .line(-th, yBot)
    .line(-th, yTop)
    .line(0, yTop)
    .line(0, ay)
    .close();
  // Deckel-Knöchel: liegt auf dem Deckel, Zapfen nach unten durch den Deckel, hinten das Auge (drei Viertel)
  const xF = -mid - tenonHalf,
    xB = -mid + tenonHalf;
  const lid = new PathBuilder()
    .line(xF, ay + R)
    .line(ax, ay + R)
    .arc(ax, ay, R, PI / 2, -PI)
    .line(0, ay)
    .line(0, th)
    .line(xB, th)
    .line(xB, 0)
    .line(xF, 0)
    .line(xF, ay + R)
    .close();
  const hole = () => circleSub(ax, ay, d.hole / 2);
  return { box: [box, hole()], lid: [lid, hole()] };
}

/** Lage einer Verbindung in Weltkoordinaten, für die 3D-Ansicht (siehe Mate in model.ts) */
export interface MateWorld {
  a: [Pt, Pt, Pt];
  b: [Pt, Pt, Pt];
  out?: boolean;
  lap?: { ua: number; ub: number; da: number; db: number };
}

/**
 * Welche Linie an welche gehört, vor dem Anwenden der Verbindung berechnet: Kante 1 mit einem Punkt im Material,
 * am Gegenstück die Kante bzw. (Zapfen-Familie) die Mittellinie der Schlitze. null bei nur einer Kante.
 */
export function jointMate(picks: EdgePick[], o: JointOptions): MateWorld | null {
  if (picks.length < 2 || picks[0].obj === picks[1].obj) return null;
  const subs = picks.map((p) => worldSubs(p.obj, p.m));
  const [g, s] = picks.map((p, i) => edgeGeom(p, subs[i]));
  const side = (e: EdgeGeom): [Pt, Pt, Pt] => [e.a, e.b, at(e, e.len / 2, -1)];
  if (o.kind === 'finger' || o.kind === 'lidhinge') return { a: side(g), b: side(s), out: o.kind === 'finger' && o.direction === 'out' };
  if (o.kind === 'lap') {
    if (!g.closed || !s.closed) return null;
    // Zwei ebene Platten kreuzen sich nur einmal: der mittlere Schlitz (bei gerader Anzahl der erste der Mitte)
    const n = Math.max(1, Math.round(o.lapCount));
    const k = Math.floor((n - 1) / 2);
    const frac = Math.max(1, Math.min(99, o.lapDepth)) / 100;
    const depth = (e: EdgeGeom, sub: SubPath[], f: number) => {
      const c = lapCenters(e.len, n)[k];
      return { u: c / e.len, d: rayDistance(sub, at(e, c, -1e-4), { x: -e.out.x, y: -e.out.y }) * f };
    };
    const da = depth(g, subs[0], frac),
      db = depth(s, subs[1], 1 - frac);
    if (!isFinite(da.d) || !isFinite(db.d)) return null;
    return { a: side(g), b: side(s), lap: { ua: da.u, ub: db.u, da: da.d, db: db.d } };
  }
  // Zapfen-Familie: Schlitzmitten liegen um slotOffset neben der Linie (bei geschlossenen Formen nach innen)
  const v = (s.closed ? -1 : 1) * o.slotOffset;
  return { a: side(g), b: [at(s, 0, v), at(s, s.len, v), at(s, s.len / 2, v - 1)] };
}

/**
 * Verbindung berechnen. Fingerzinken: eine oder zwei Kanten (die zweite bekommt das Gegenstück).
 * Schlitz und Zapfen: erste Kante bekommt die Zapfen, die zweite Linie (Kante oder einzelne Hilfslinie) die Schlitze.
 */
export function computeJoint(picks: EdgePick[], o: JointOptions): JointResult {
  const changes = new Map<Obj, { m: Mat; subs: SubPath[] }>();
  const fail = (error: string): JointResult => ({ changes: new Map(), added: [], info: '', error });
  if (!picks.length) return fail(t('Keine Kante gewählt.'));
  if (picks.length > 1 && sameEdge(picks[0], picks[1])) return fail(t('Zweimal dieselbe Kante gewählt.'));
  const th = o.thickness;
  if (!(th > 0)) return fail(t('Materialdicke muss größer als 0 sein.'));
  const adj = o.kerf - o.clearance;

  const subsOf = (p: EdgePick) => {
    let c = changes.get(p.obj);
    if (!c) changes.set(p.obj, (c = { m: p.m, subs: worldSubs(p.obj, p.m) }));
    return c.subs;
  };
  // Geometrie aller Kanten vor jeder Änderung bestimmen
  const geoms = picks.map((p) => edgeGeom(p, subsOf(p)));
  /** Ersetzungen je Objekt; am Ende von hinten nach vorn einfügen, damit die Indizes stimmen */
  const edits: { pick: EdgePick; pts: Pt[] }[] = [];
  const extra = new Map<Obj, SubPath[]>();
  const added: SubPath[] = [];
  let info: string;

  if (o.kind === 'finger') {
    const pattern = Math.min(...geoms.map((g) => g.len));
    const n = fingerCount(pattern, o.fingerWidth);
    const w = pattern / n;
    if (w - Math.abs(adj) <= 0.05) return fail(t('Zinken zu schmal für Kerf und Spiel.'));
    const [vMat, vGap] = o.direction === 'in' ? [0, -th] : [th, 0];
    geoms.forEach((g, i) => {
      const phase = ((i + (o.swap ? 1 : 0)) % 2) as 0 | 1;
      edits.push({ pick: picks[i], pts: fingerProfile(g.len, pattern, n, phase, vMat, vGap, adj).map((q) => at(g, q.x, q.y)) });
    });
    info = tn('{n} Feld à {width} mm', '{n} Felder à {width} mm', n, { width: fmt(w) });
    if (geoms.length > 1 && Math.abs(geoms[0].len - geoms[1].len) > 0.01)
      info += t('. Kanten unterschiedlich lang ({len} / {len2} mm): Muster liegt mittig auf {pattern} mm', { len: fmt(geoms[0].len), len2: fmt(geoms[1].len), pattern: fmt(pattern) });
  } else if (o.kind === 'lap') {
    const n = Math.max(1, Math.round(o.lapCount));
    const sw = th - adj;
    if (sw <= 0) return fail(t('Schlitze zu schmal für Kerf und Spiel.'));
    const frac = Math.max(1, Math.min(99, o.lapDepth)) / 100;
    const depths: number[] = [];
    for (let i = 0; i < geoms.length; i++) {
      const g = geoms[i];
      if (!g.closed) return fail(t('Überblattung braucht Kanten geschlossener Formen.'));
      const centers = lapCenters(g.len, n);
      if (g.len / (n + 1) <= sw) return fail(t('Zu viele Schlitze für die Kantenlänge.'));
      const inward = { x: -g.out.x, y: -g.out.y };
      const subs = changes.get(picks[i].obj)!.subs;
      const pts: Pt[] = [];
      let minDepth = Infinity;
      for (const c of centers) {
        // Plattenbreite an dieser Stelle: von der Kante bis zur gegenüberliegenden Kontur
        const width = rayDistance(subs, at(g, c, -1e-4), inward);
        if (!isFinite(width)) return fail(t('Gegenüberliegende Kante nicht gefunden.'));
        const d = width * (i === 0 ? frac : 1 - frac);
        minDepth = Math.min(minDepth, d);
        pts.push(at(g, c - sw / 2, 0), at(g, c - sw / 2, -d), at(g, c + sw / 2, -d), at(g, c + sw / 2, 0));
      }
      depths.push(minDepth);
      edits.push({ pick: picks[i], pts });
    }
    info = tn('{n} Schlitz je Kante, {width} mm breit, {depth} tief', '{n} Schlitze je Kante, {width} mm breit, {depth} tief', n, { width: fmt(sw), depth: depths.map((d) => `${fmt(d)} mm`).join(' / ') });
  } else if (o.kind === 'lidhinge') {
    // Deckelscharnier: Kante 1 = Oberkante der Rückwand, Kante 2 = Hinterkante des Deckels.
    // Beide Platten bekommen Schlitze für die Knöchel, die Knöchel selbst kommen als neue Teile dazu.
    if (picks.length < 2) return fail(t('Scharnier braucht zwei Kanten: erst die Oberkante der Rückwand, dann die Hinterkante des Deckels.'));
    if (!geoms[0].closed || !geoms[1].closed) return fail(t('Scharnier braucht Kanten geschlossener Formen (Rückwand und Deckel).'));
    if (picks[0].obj === picks[1].obj) return fail(t('Rückwand und Deckel müssen zwei verschiedene Teile sein.'));
    if (!(o.pinDia > 0)) return fail(t('Stiftdurchmesser muss größer als 0 sein.'));
    if (!(o.hingeWall > 0)) return fail(t('Wandstärke um den Stift muss größer als 0 sein.'));
    const d = lidHingeDims(o);
    if (d.hole <= 0) return fail(t('Stiftloch zu klein für den Kerf.'));
    if (d.slotHalf <= 0 || th - adj <= 0) return fail(t('Schlitze zu klein für Kerf und Spiel.'));
    if (d.R - th / 2 < 1) return fail(t('Auge zu schwach: Stift oder Wandstärke größer wählen (Auge muss mindestens 1 mm über den Deckel ragen).'));
    let n = Math.max(3, Math.round(o.hingeCount));
    if (n % 2 === 0) n++;
    const L = Math.min(geoms[0].len, geoms[1].len);
    const pitch = L / n;
    if (pitch - th < 0.5) return fail(t('Zu viele Knöchel für die Kantenlänge (zwischen zwei Knöcheln muss mindestens 0,5 mm Luft bleiben).'));
    const centers = tenonCenters(L, n);
    const sw = th - adj;
    // Schlitze: Kasten-Knöchel an geraden, Deckel-Knöchel an ungeraden Stellen (ungerade Anzahl: symmetrisch,
    // die Laufrichtung der Kanten spielt keine Rolle)
    for (const [i, g] of geoms.entries()) {
      const slots: SubPath[] = [];
      const off = (g.len - L) / 2;
      centers.forEach((c, k) => {
        if (k % 2 !== i) return;
        const u = off + c;
        slots.push({
          closed: true,
          nodes: [at(g, u - sw / 2, -d.mid - d.slotHalf), at(g, u + sw / 2, -d.mid - d.slotHalf), at(g, u + sw / 2, -d.mid + d.slotHalf), at(g, u - sw / 2, -d.mid + d.slotHalf)],
        });
      });
      extra.set(picks[i].obj, slots);
    }
    // Knöchel rechts neben Rückwand und Deckel legen, in einer Reihe (erst die für den Kasten, dann die für den Deckel),
    // „oben“ im Profil zeigt auf der Arbeitsfläche nach oben
    const prof = lidHingeProfiles(o);
    const plates = [...changes.values()].flatMap((c) => c.subs).flatMap((sp) => sp.nodes);
    let px = Math.max(...plates.map((p) => p.x)) + 5;
    const py = Math.min(...plates.map((p) => p.y));
    const place = (subs: SubPath[]) => {
      const pts = subs.flatMap((sp) => sp.nodes);
      const x0 = Math.min(...pts.map((p) => p.x)),
        x1 = Math.max(...pts.map((p) => p.x)),
        y1 = Math.max(...pts.map((p) => p.y));
      const map = (p: Pt): Pt => ({ x: px + p.x - x0, y: py + y1 - p.y });
      for (const sp of subs)
        added.push({
          closed: true,
          nodes: sp.nodes.map((nd) => ({ ...map(nd), ...(nd.cin ? { cin: map(nd.cin) } : {}), ...(nd.cout ? { cout: map(nd.cout) } : {}), ...(nd.smooth ? { smooth: true } : {}) })),
        });
      px += x1 - x0 + 3;
    };
    const nBox = (n + 1) / 2,
      nLid = (n - 1) / 2;
    for (let k = 0; k < nBox; k++) place(prof.box);
    for (let k = 0; k < nLid; k++) place(prof.lid);
    const pinLen = L - pitch + th + 4;
    info = t('{nBox} Knöchel für den Kasten, {nLid} für den Deckel; Stift Ø {dia} mm, etwa {len} mm lang', { nBox, nLid, dia: fmt(o.pinDia), len: fmt(Math.ceil(pinLen)) });
    if (Math.abs(geoms[0].len - geoms[1].len) > 0.01)
      info += t('. Kanten unterschiedlich lang ({len} / {len2} mm): Knöchel liegen mittig auf {pattern} mm', { len: fmt(geoms[0].len), len2: fmt(geoms[1].len), pattern: fmt(L) });
    if (pitch / 2 - th / 2 < th) info += t('. Achtung: die äußeren Knöchel sitzen sehr nah an den Ecken (Seitenwände!)');
  } else {
    // Zapfen-Familie: einfacher Zapfen, Schnappzapfen mit Rasthaken, L-förmiger Haken, Keilzapfen, Zapfen mit T-Slots dazwischen
    const g = geoms[0];
    const n = Math.max(1, Math.round(o.tenonCount));
    const tw = o.tenonWidth + adj;
    const hw = tw / 2;
    const centers = tenonCenters(g.len, n);
    /** Seitlicher Platzbedarf je Zapfen über die Zapfenbreite hinaus */
    const side = o.kind === 'snap' ? 2 * o.snapLip : o.kind === 'hook' ? o.hookLength : 0;
    if (!(o.tenonWidth > 0) || (tw + side) * n >= g.len - 0.1) return fail(t('Zapfen passen nicht auf die Kante (Anzahl × Breite zu groß).'));
    // Unterkante von Rast- bzw. Hakennase: knapp hinter der Gegenplatte
    const shoulder = th + Math.max(0, o.clearance);
    /** Hakenrichtung entlang der Kante */
    const dir = o.hookFlip ? -1 : 1;
    // Keilzapfen: Loch für den Keil im überstehenden Teil des Zapfens
    const wHole = { u: th - adj, v0: th - o.wedgePull, v1: th - o.wedgePull + o.wedgeWidth };
    const wedgeTop = wHole.v1 + Math.max(3, th);
    if (o.kind === 'wedge') {
      if (!(o.wedgeWidth > 0)) return fail(t('Keilbreite muss größer als 0 sein.'));
      if (wHole.u + 4 > tw) return fail(t('Zapfen zu schmal für das Keilloch (mindestens Materialdicke + 4 mm).'));
    }
    // T-Slot: Schraubenschlitz mit Mutternfenster zwischen je zwei Zapfen
    const ts = {
      d: o.boltDia - adj, s: o.nutWidth - adj, m: o.nutHeight - adj,
      depth: o.boltLength - th + 1, top: Math.max(2, o.boltLength - th - o.nutHeight - 2),
    };
    const mids = o.kind === 'tslot' ? centers.slice(1).map((c, i) => (centers[i] + c) / 2) : [];
    if (o.kind === 'tslot') {
      if (n < 2) return fail(t('T-Slot braucht mindestens 2 Zapfen; die Schrauben sitzen zwischen den Zapfen.'));
      if (!(ts.d > 0) || ts.s <= ts.d || !(ts.m > 0)) return fail(t('Schraube und Mutter: Schlüsselweite muss größer als der Schraubendurchmesser sein.'));
      if (o.boltLength <= th + 1) return fail(t('Schraube zu kurz für die Materialdicke.'));
      if (centers[1] - centers[0] - tw < ts.s + 2) return fail(t('Kein Platz für die Mutter zwischen den Zapfen (weniger oder schmalere Zapfen).'));
    }
    const pts: Pt[] = [];
    for (const [i, c] of centers.entries()) {
      const P = (u: number, v: number) => pts.push(at(g, c + u, v));
      if (o.kind === 'snap') {
        const lip = o.snapLip,
          len = o.snapLength;
        if (!(lip > 0) || !(len > 0)) return fail(t('Rasthaken: Überstand und Länge müssen größer als 0 sein.'));
        // Mittelschlitz, damit die beiden Zungen beim Durchstecken einfedern können (mindestens 2 × Überstand breit)
        const gap = 2 * lip + 0.3;
        if (gap >= tw - 1) return fail(t('Schnappzapfen zu schmal für den Rasthaken-Überstand.'));
        const tip = shoulder + len;
        P(-hw, 0); P(-hw, shoulder); P(-hw - lip, shoulder); P(-hw + lip * 0.5, tip);
        P(-gap / 2, tip); P(-gap / 2, -o.snapRelief); P(gap / 2, -o.snapRelief); P(gap / 2, tip);
        P(hw - lip * 0.5, tip); P(hw + lip, shoulder); P(hw, shoulder); P(hw, 0);
      } else if (o.kind === 'hook') {
        if (!(o.hookLength > 0)) return fail(t('Hakenlänge muss größer als 0 sein.'));
        const top = shoulder + th;
        const hl = o.hookLength;
        if (dir > 0) {
          P(-hw, 0); P(-hw, top); P(hw + hl, top); P(hw + hl, shoulder); P(hw, shoulder); P(hw, 0);
        } else {
          P(-hw, 0); P(-hw, shoulder); P(-hw - hl, shoulder); P(-hw - hl, top); P(hw, top); P(hw, 0);
        }
      } else if (o.kind === 'wedge') {
        P(-hw, 0); P(-hw, wedgeTop); P(hw, wedgeTop); P(hw, 0);
      } else {
        P(-hw, 0); P(-hw, th); P(hw, th); P(hw, 0);
      }
      if (i < mids.length) {
        const m = mids[i];
        const Q = (u: number, v: number) => pts.push(at(g, m + u, v));
        const dh = ts.d / 2,
          sh = ts.s / 2,
          a = -ts.top,
          b = -ts.top - ts.m,
          e = -ts.depth;
        Q(-dh, 0); Q(-dh, a); Q(-sh, a); Q(-sh, b); Q(-dh, b); Q(-dh, e);
        Q(dh, e); Q(dh, b); Q(sh, b); Q(sh, a); Q(dh, a); Q(dh, 0);
      }
    }
    edits.push({ pick: picks[0], pts });
    if (o.kind === 'wedge') {
      // Löcher im Zapfen und die Keile selbst (leicht keilförmig, liegen neben der Kante)
      const holes: SubPath[] = centers.map((c) => ({
        closed: true,
        nodes: [at(g, c - wHole.u / 2, wHole.v0), at(g, c + wHole.u / 2, wHole.v0), at(g, c + wHole.u / 2, wHole.v1), at(g, c - wHole.u / 2, wHole.v1)],
      }));
      extra.set(picks[0].obj, [...(extra.get(picks[0].obj) ?? []), ...holes]);
      const len = tw + 2 * Math.max(8, 2 * th);
      const w0 = o.wedgeWidth - 1.5 + o.kerf,
        w1 = o.wedgeWidth + 1.5 + o.kerf;
      centers.forEach((_, i) => {
        const v = wedgeTop + 4 + i * (w1 + 3);
        const u0 = g.len / 2 - len / 2,
          u1 = g.len / 2 + len / 2;
        added.push({ closed: true, nodes: [at(g, u0, v), at(g, u1, v), at(g, u1, v + w1), at(g, u0, v + w0)] });
      });
    }
    const name = { snap: t('Schnappzapfen'), hook: t('Hakenzapfen'), wedge: t('Keilzapfen') }[o.kind as string] ?? t('Zapfen');
    info = t('{n} {name} à {width} × {thickness} mm', { n, name, width: fmt(o.tenonWidth), thickness: fmt(th) });
    if (o.kind === 'wedge') info += tn(' mit {n} Keil', ' mit {n} Keilen', n);
    if (o.kind === 'tslot')
      info += tn(', {n} T-Slot für Schraube Ø {dia} × {length} mm, Mutter {nutWidth} × {nutHeight} mm', ', {n} T-Slots für Schraube Ø {dia} × {length} mm, Mutter {nutWidth} × {nutHeight} mm', mids.length, {
        dia: fmt(o.boltDia), length: fmt(o.boltLength), nutWidth: fmt(o.nutWidth), nutHeight: fmt(o.nutHeight),
      });
    if (picks.length > 1) {
      const s = geoms[1];
      // Schlitzmitte: um slotOffset von der Linie versetzt, bei Kanten geschlossener Formen ins Material hinein
      const sideIn = s.closed ? -1 : 1;
      const sl = o.tenonWidth - adj,
        sw = th - adj;
      if (sl <= 0 || sw <= 0) return fail(t('Schlitze zu klein für Kerf und Spiel.'));
      const mid = s.len / 2;
      // Hakenzapfen: Schlitz um die Hakenlänge verlängert, auf der dem Haken abgewandten Seite (einstecken, dann schieben)
      const extraLen = o.kind === 'hook' ? o.hookLength : 0;
      const slots: SubPath[] = centers.map((c) => {
        const u = mid + c - g.len / 2,
          v = sideIn * o.slotOffset;
        const u0 = u - sl / 2 - (dir > 0 ? extraLen : 0),
          u1 = u + sl / 2 + (dir < 0 ? extraLen : 0);
        return {
          closed: true,
          nodes: [at(s, u0, v - sw / 2), at(s, u1, v - sw / 2), at(s, u1, v + sw / 2), at(s, u0, v + sw / 2)],
        };
      });
      const target = picks[1].obj;
      const tsubs = subsOf(picks[1]);
      // Eine einzelne Hilfslinie wird durch die Schlitze ersetzt
      const guide = tsubs.length === 1 && !tsubs[0].closed && tsubs[0].nodes.length === 2;
      if (guide) tsubs.length = 0;
      // T-Slot: Bohrung für die Schraube in der Gegenplatte
      const r = ts.d / 2,
        k = r * 0.5522847498;
      for (const m of mids) {
        const ctr = at(s, mid + m - g.len / 2, sideIn * o.slotOffset);
        slots.push({
          closed: true,
          nodes: [
            { x: ctr.x + r, y: ctr.y, cin: { x: ctr.x + r, y: ctr.y - k }, cout: { x: ctr.x + r, y: ctr.y + k }, smooth: true },
            { x: ctr.x, y: ctr.y + r, cin: { x: ctr.x + k, y: ctr.y + r }, cout: { x: ctr.x - k, y: ctr.y + r }, smooth: true },
            { x: ctr.x - r, y: ctr.y, cin: { x: ctr.x - r, y: ctr.y + k }, cout: { x: ctr.x - r, y: ctr.y - k }, smooth: true },
            { x: ctr.x, y: ctr.y - r, cin: { x: ctr.x - k, y: ctr.y - r }, cout: { x: ctr.x + k, y: ctr.y - r }, smooth: true },
          ],
        });
      }
      extra.set(target, [...(extra.get(target) ?? []), ...slots]);
      info += tn(', {n} Schlitz', ', {n} Schlitze', n);
      if (s.len < g.len - 0.01) info += t('. Achtung: Schlitzlinie ({len} mm) kürzer als die Zapfenkante ({len2} mm)', { len: fmt(s.len), len2: fmt(g.len) });
      if (s.closed && o.slotOffset < th / 2 + 0.01) info += t('. Achtung: Schlitze reichen bis an die Kante');
      if (mids.length) info += tn(', {n} Bohrung', ', {n} Bohrungen', mids.length);
      if (o.kind === 'hook') info += t('. Einstecken, dann {hookLength} mm in Hakenrichtung schieben', { hookLength: fmt(o.hookLength) });
    }
  }

  // Kanten ersetzen: je Unterpfad von hinten nach vorn
  edits.sort((p, q) => (p.pick.obj === q.pick.obj && p.pick.sub === q.pick.sub ? q.pick.seg - p.pick.seg : 0));
  for (const e of edits) {
    const subs = changes.get(e.pick.obj)!.subs;
    const sp = subs[e.pick.sub];
    if (!sp) continue; // Hilfslinie wurde durch Schlitze ersetzt
    sp.nodes.splice(segments(sp)[e.pick.seg].ia + 1, 0, ...e.pts.map((p) => ({ x: p.x, y: p.y })));
  }
  for (const [obj, slots] of extra) changes.get(obj)!.subs.push(...slots);
  return { changes, added, info };
}
