// Baugruppe „Scheibenkugel“: Kreisscheiben auf den Flächenrichtungen eines Polyeders, die sich mit ihren Nachbarn
// über schräge Schlitze verhaken und so ohne Leim eine Kugel bilden (bekannt als Lampe aus Papier oder Karton).
//
// Aufbau: Jede Scheibe i liegt mit ihrer Mittelebene in der Ebene n_i·x = d (Abstand d vom Kugelmittelpunkt) und
// hat den Radius r. Zwei Scheiben, deren Ebenen den Winkel α einschließen, schneiden sich auf einer Geraden, deren
// Fußpunkt p für beide Scheibenmitten gleich ist; ihr Abstand von der Scheibenmitte ist h = d·tan(α/2). Ist r
// groß genug, liegt auf dieser Geraden in beiden Scheiben dieselbe Sehne (halbe Länge √(r² − h²)). Die Sehne wird
// halbiert: Scheibe i bekommt den Schlitz in Richtung n_i × n_j, Scheibe j in Richtung n_j × n_i, also die andere
// Hälfte. Weil jede Scheibe alle Schlitze im selben Drehsinn hat, sind bei regelmäßigen Polyedern alle gleich.
//
// Schlitzbreite in der Ebene von A für eine Platte B im Winkel α (beide Dicke t, Mittelebenen):
//   W = (t + Spiel)/sin α + t·|cot α|
// Der erste Teil ist die Spur der Platte B (mit dem Spiel senkrecht zu ihren Flächen), der zweite der Versatz, um
// den B über die Dicke von A wandert. Bei 90° ist W = t + Spiel wie beim Steckregal.
//
// Die Überlappung wird nicht als Radius eingegeben, sondern in Prozent zwischen „greifen gerade ineinander“ und
// „so weit wie möglich, ohne dass sich drei Scheiben in einem Punkt treffen“. Beide Grenzen hängen von Dicke,
// Spiel und Durchmesser ab und werden numerisch gesucht.
import type { Pt, SubPath } from '../model';
import { t } from '../i18n';
import { arrangeParts, PathBuilder } from './build';
import type { Generator, Issue, Params } from './types';

export type V3 = [number, number, number];

export interface DiscSphereParams {
  diameter: number;
  shape: string;
  overlap: number;
  thickness: number;
  topHole: number;
  bottomHole: number;
  play: number;
  kerf: number;
}

const P = (p: Params) => p as unknown as DiscSphereParams;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

// ---------- Polyeder ----------

const PHI = (1 + Math.sqrt(5)) / 2;

/** Alle Vorzeichen-Varianten (Nullen bleiben), ohne Doppelte */
function signs(v: V3): V3[] {
  const out: V3[] = [];
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) out.push([v[0] * sx, v[1] * sy, v[2] * sz]);
  return out;
}
/** Zyklische Vertauschungen (x, y, z) → (y, z, x) → (z, x, y) */
const cyc = (v: V3): V3[] => [v, [v[1], v[2], v[0]], [v[2], v[0], v[1]]];
const sc = (v: V3) => cyc(v).flatMap(signs);

function dedupe(vs: V3[]): V3[] {
  const seen = new Set<string>();
  const out: V3[] = [];
  for (const v of vs.map(unit)) {
    const k = v.map((x) => Math.round(x * 1e6)).join(',');
    if (!seen.has(k)) seen.add(k), out.push(v);
  }
  return out;
}

const AXES = () => sc([1, 0, 0]);
const DIAG = () => signs([1, 1, 1]);
const ICO_V = () => sc([0, 1, PHI]);
const DODE_V = () => [...DIAG(), ...sc([0, 1 / PHI, PHI])];

/** Flächenrichtungen (Normalen) je Polyeder */
const SHAPES: Record<string, () => V3[]> = {
  cube: AXES,
  octa: DIAG,
  dodeca: ICO_V,
  cubocta: () => [...AXES(), ...DIAG()],
  icosa: DODE_V,
  rhombi: () => [...AXES(), ...sc([1, 1, 0]), ...DIAG()],
  // Sechsecke = Flächenmitten des Ikosaeders (Dodekaeder in dualer Lage, daher φ und 1/φ vertauscht)
  tico: () => [...ICO_V(), ...DIAG(), ...sc([0, PHI, 1 / PHI])],
};

/** Drehung, die a auf +Z bringt (Rodrigues) */
function toZ(a: V3): (v: V3) => V3 {
  const z: V3 = [0, 0, 1];
  const axis = cross(a, z);
  const s = Math.hypot(...axis),
    c = dot(a, z);
  if (s < 1e-12) return c > 0 ? (v) => v : (v) => [v[0], -v[1], -v[2]];
  const k = scale(axis, 1 / s);
  return (v) => {
    const kv = cross(k, v);
    const kd = dot(k, v) * (1 - c);
    return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
  };
}

/** Normalen des Polyeders, so gedreht, dass eine Fläche genau oben liegt; sortiert von oben nach unten */
export function sphereNormals(shape: string): V3[] {
  const ns = dedupe((SHAPES[shape] ?? SHAPES.dodeca)());
  const top = ns.reduce((a, b) => (b[2] > a[2] + 1e-9 ? b : a));
  const R = toZ(top);
  const out = ns.map((v) => unit(R(v)));
  // Kleine Rundungsfehler glätten, damit oben/unten exakt senkrecht sind
  for (const v of out) for (let i = 0; i < 3; i++) if (Math.abs(v[i]) < 1e-12) v[i] = 0;
  return out.sort((a, b) => b[2] - a[2] || b[1] - a[1] || b[0] - a[0]);
}

// ---------- Aufteilung ----------

/** Schlitz in einer Scheibe, in ihren lokalen Koordinaten (Ursprung = Scheibenmitte) */
export interface DiscSlot {
  /** Index der anderen Scheibe */
  other: number;
  /** Einheitsvektor von der Mitte zur Sehne (Fußpunkt = h·m) */
  m: Pt;
  /** Richtung, in die der Schlitz zum Rand läuft */
  e: Pt;
  h: number;
  /** Schlitzbreite (ohne Schnittfuge) */
  w: number;
  /** Winkel zwischen den Scheiben in Grad (spitz) */
  angle: number;
}

export interface Disc {
  key: string;
  n: V3;
  /** Mitte der Scheibe (auf der Mittelebene) */
  c: V3;
  /** Lokale Achsen in der Scheibenebene: Punkt (x, y) liegt bei c + x·U + y·V */
  U: V3;
  V: V3;
  slots: DiscSlot[];
  /** Durchmesser einer Öffnung in der Mitte (0 = keine) */
  hole: number;
}

export interface SphereLayout {
  discs: Disc[];
  /** Abstand der Scheibenebenen vom Mittelpunkt */
  d: number;
  /** Scheibenradius */
  r: number;
  /** Bereich der möglichen Überlappung (r/d) und gewählter Wert */
  kMin: number;
  kMax: number;
}

interface Pair {
  i: number;
  j: number;
  cos: number;
  /** h/d */
  ht: number;
  w: number;
}

/** Frei, wenn sich die Platten nicht berühren; Abstand, den Scheiben ohne Schlitz zueinander halten */
const AIR = 0.5;

/** Mindestabstand zweier Schlitze in derselben Scheibe (zwischen den Spuren der beiden Platten) */
const webMin = (th: number) => Math.max(1, th);

function pairsOf(ns: V3[], th: number, play: number): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < ns.length; i++)
    for (let j = i + 1; j < ns.length; j++) {
      const c = dot(ns[i], ns[j]);
      if (c < -1 + 1e-9) continue; // gegenüberliegende Scheiben sind parallel
      const a = Math.acos(Math.max(-1, Math.min(1, c)));
      const s = Math.sin(a);
      out.push({ i, j, cos: c, ht: Math.tan(a / 2), w: (th + play) / s + (th * Math.abs(c)) / s });
    }
  return out;
}

function frame(n: V3): [V3, V3] {
  const U = Math.abs(n[2]) > 1 - 1e-9 ? ([1, 0, 0] as V3) : unit(cross([0, 0, 1], n));
  return [U, cross(n, U)];
}

/** Abstand zweier Strecken in der Ebene */
function segDist(a0: Pt, a1: Pt, b0: Pt, b1: Pt): number {
  const crossZ = (o: Pt, p: Pt, q: Pt) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = crossZ(a0, a1, b0),
    d2 = crossZ(a0, a1, b1),
    d3 = crossZ(b0, b1, a0),
    d4 = crossZ(b0, b1, a1);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const pd = (p: Pt, s0: Pt, s1: Pt) => {
    const dx = s1.x - s0.x,
      dy = s1.y - s0.y;
    const l = dx * dx + dy * dy;
    const u = l ? Math.max(0, Math.min(1, ((p.x - s0.x) * dx + (p.y - s0.y) * dy) / l)) : 0;
    return Math.hypot(p.x - s0.x - u * dx, p.y - s0.y - u * dy);
  };
  return Math.min(pd(a0, b0, b1), pd(a1, b0, b1), pd(b0, a0, a1), pd(b1, a0, a1));
}

interface Eval {
  ok: boolean;
  /** Alle Scheiben hängen zusammen und jede hält mindestens drei Nachbarn */
  held: boolean;
  slots: DiscSlot[][];
}

/**
 * Aufteilung für r/d = k prüfen. Jedes Scheibenpaar muss entweder deutlich frei sein oder deutlich ineinander
 * greifen (Schlitz mindestens so tief wie breit), und in keiner Scheibe dürfen sich zwei Schlitzspuren nahekommen.
 */
function evaluate(ns: V3[], frames: [V3, V3][], pairs: Pair[], Ro: number, k: number, th: number): Eval {
  const d = Ro / Math.sqrt(1 + k * k),
    r = k * d;
  const slots: DiscSlot[][] = ns.map(() => []);
  const deg = ns.map(() => 0);
  const parent = ns.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const p of pairs) {
    const h = d * p.ht;
    if (r <= h - p.w / 2 - AIR) continue;
    if (r * r < (h + p.w / 2) ** 2 + p.w * p.w) return { ok: false, held: false, slots };
    const angle = (Math.acos(Math.abs(p.cos)) * 180) / Math.PI;
    for (const [a, b] of [[p.i, p.j], [p.j, p.i]]) {
      const [U, V] = frames[a];
      // Fußpunkt relativ zur Scheibenmitte: d·(n_a + n_b)/(1 + cos) − d·n_a
      const rel = sub(scale([ns[a][0] + ns[b][0], ns[a][1] + ns[b][1], ns[a][2] + ns[b][2]], 1 / (1 + p.cos)), ns[a]);
      const m = unit(rel);
      const e = unit(cross(ns[a], ns[b]));
      slots[a].push({ other: b, m: { x: dot(m, U), y: dot(m, V) }, e: { x: dot(e, U), y: dot(e, V) }, h, w: p.w, angle });
    }
    deg[p.i]++;
    deg[p.j]++;
    parent[find(p.i)] = find(p.j);
  }
  // Schlitzspuren in jeder Scheibe: ganze Sehne (beide Hälften sind von einer der beiden Platten belegt)
  for (const list of slots)
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const seg = (s: DiscSlot): [Pt, Pt] => {
          const L = Math.sqrt(Math.max(0, r * r - Math.max(0, s.h - s.w / 2) ** 2));
          const f = { x: s.m.x * s.h, y: s.m.y * s.h };
          return [
            { x: f.x - s.e.x * L, y: f.y - s.e.y * L },
            { x: f.x + s.e.x * L, y: f.y + s.e.y * L },
          ];
        };
        const [a0, a1] = seg(list[x]),
          [b0, b1] = seg(list[y]);
        if (segDist(a0, a1, b0, b1) < (list[x].w + list[y].w) / 2 + webMin(th)) return { ok: false, held: false, slots };
      }
  const root = find(0);
  const held = ns.every((_, i) => find(i) === root && deg[i] >= 3);
  return { ok: true, held, slots };
}

const cache = new Map<string, SphereLayout | null>();

/**
 * Lage aller Scheiben und ihrer Schlitze (ohne Schnittfuge). null, wenn es für Durchmesser, Dicke und Spiel keine
 * Überlappung gibt, bei der alle Scheiben halten.
 */
export function sphereLayout(raw: Params): SphereLayout | null {
  const p = P(raw);
  const key = [p.diameter, p.shape, p.overlap, p.thickness, p.play, p.topHole, p.bottomHole].join('|');
  if (cache.has(key)) return cache.get(key)!;
  const ns = sphereNormals(p.shape);
  const frames = ns.map(frame);
  const pairs = pairsOf(ns, p.thickness, p.play);
  const Ro = p.diameter / 2;
  // Gültigen Bereich von k = r/d suchen: erster Wert, bei dem alles hält, bis zum letzten gültigen danach
  const step = 0.0025;
  let kMin = -1,
    kMax = -1;
  for (let k = step; k < 4; k += step) {
    const ev = evaluate(ns, frames, pairs, Ro, k, p.thickness);
    if (kMin < 0) {
      if (ev.ok && ev.held) kMin = kMax = k;
    } else if (ev.ok && ev.held) kMax = k;
    else break;
  }
  let out: SphereLayout | null = null;
  if (kMin > 0) {
    const k = kMin + (Math.max(0, Math.min(100, p.overlap)) / 100) * (kMax - kMin);
    const ev = evaluate(ns, frames, pairs, Ro, k, p.thickness);
    const d = Ro / Math.sqrt(1 + k * k);
    const bottom = ns.length - 1;
    out = {
      d,
      r: k * d,
      kMin,
      kMax,
      discs: ns.map((n, i) => ({
        key: `d${i + 1}`,
        n,
        c: scale(n, d),
        U: frames[i][0],
        V: frames[i][1],
        slots: ev.slots[i],
        hole: i === 0 ? p.topHole : i === bottom && n[2] < -1 + 1e-9 ? p.bottomHole : 0,
      })),
    };
  }
  if (cache.size > 32) cache.clear();
  cache.set(key, out);
  return out;
}

// ---------- Kontur ----------

/** Breite der Fase, mit der spitze Ecken am Schlitzeingang gebrochen werden (mm) */
const TIP = 1.2;

/** Kreisbogen, an den Quadrantengrenzen geteilt, damit die Knoten die Ausdehnung des Kreises erfassen */
function arcQ(pb: PathBuilder, R: number, a0: number, a1: number) {
  const q = Math.PI / 2;
  let a = a0;
  for (let k = Math.floor(a0 / q + 1e-9) + 1; k * q < a1 - 1e-9; k++) {
    pb.arc(0, 0, R, a, k * q);
    a = k * q;
  }
  pb.arc(0, 0, R, a, a1);
}

/**
 * Kontur einer Scheibe: Kreis mit Schlitzen, dazu die Öffnung; kerf = Schnittfuge (Kontur um k/2 nach außen).
 * Trifft eine Schlitzwand den Rand unter einem spitzen Winkel, wird die Spitze mit einer kleinen Fase gebrochen
 * (beide Ecken dann über 90°): Spitzen fransen bei Papier aus und würden in „Konstruktion prüfen“ als zu schmaler
 * Steg gemeldet.
 */
export function discOutline(disc: Disc, r: number, kerf: number): SubPath[] {
  const R = r + kerf / 2;
  type Mouth = { enter: number; exit: number; pts: Pt[] };
  const mouths: Mouth[] = [];
  const rim = (a: number): Pt => ({ x: R * Math.cos(a), y: R * Math.sin(a) });
  for (const s of disc.slots) {
    const w = s.w - kerf;
    const at = (q: number, tau: number): Pt => ({ x: s.m.x * q + s.e.x * tau, y: s.m.y * q + s.e.y * tau });
    const q1 = s.h - w / 2,
      q2 = s.h + w / 2;
    const tb = kerf / 2;
    // Seite der Schlitzwand: Punkt am Rand, Winkel, Ecke am Schlitzboden
    const side = (q: number) => {
      const tau = Math.sqrt(R * R - q * q);
      const X = at(q, tau);
      return { tau, X, a: Math.atan2(X.y, X.x), bottom: at(q, tb), q };
    };
    const A = side(q1),
      B = side(q2);
    const diff = (((B.a - A.a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const [en, ex] = diff < Math.PI ? [A, B] : [B, A];
    // Keilwinkel des Materials an der Ecke: zwischen der Wand (nach innen, −e) und dem Rand ins Material
    // (beim Eingang zu kleineren Winkeln, beim Ausgang zu größeren)
    const corner = (S: typeof A, dir: -1 | 1) => {
      const tt = { x: -Math.sin(S.a) * dir, y: Math.cos(S.a) * dir };
      const cos = -(s.e.x * tt.x + s.e.y * tt.y);
      const theta = Math.acos(Math.max(-1, Math.min(1, cos)));
      if (theta >= Math.PI / 2 - 1e-9) return { a: S.a, pts: [S.X] };
      const c = TIP / 2 / Math.sin(theta / 2);
      if (c > S.tau - tb - 0.5) return { a: S.a, pts: [S.X] };
      return { a: S.a + (dir * c) / R, pts: [at(S.q, S.tau - c)] };
    };
    const ce = corner(en, -1),
      cx = corner(ex, 1);
    mouths.push({
      enter: ce.a,
      exit: cx.a,
      pts: [rim(ce.a), ...ce.pts, en.bottom, ex.bottom, ...[...cx.pts].reverse(), rim(cx.a)],
    });
  }
  const out: SubPath[] = [];
  const pb = new PathBuilder();
  if (!mouths.length) arcQ(pb, R, 0, 2 * Math.PI);
  else {
    mouths.sort((a, b) => a.enter - b.enter);
    let prev = mouths[mouths.length - 1].exit;
    for (const m of mouths) {
      let a1 = m.enter;
      while (a1 < prev) a1 += 2 * Math.PI;
      while (prev < 0) (prev += 2 * Math.PI), (a1 += 2 * Math.PI);
      if (a1 - prev > 1e-9) arcQ(pb, R, prev, a1);
      for (const q of m.pts) pb.line(q);
      prev = m.exit;
    }
  }
  out.push(pb.close());
  if (disc.hole > 0) {
    const h = new PathBuilder();
    arcQ(h, disc.hole / 2 - kerf / 2, 0, 2 * Math.PI);
    out.push(h.close());
  }
  return out;
}

/** Größte Öffnung, die in eine Scheibe passt, ohne die Schlitze anzuschneiden */
const maxHole = (disc: Disc, th: number) => 2 * Math.min(...disc.slots.map((s) => s.h - s.w / 2 - webMin(th)));

export const DISCSPHERE: Generator = {
  id: 'discsphere',
  version: 2,
  kind: 'assembly',
  name: t('Scheibenkugel'),
  icon: 'discsphere',
  schema: [
    { key: 'partLayout', type: 'data', label: '', def: 'nest' },
    { key: 'diameter', type: 'length', label: t('Durchmesser'), min: 40, max: 2000, def: 250, title: t('Außendurchmesser der fertigen Kugel') },
    {
      key: 'shape',
      type: 'enum',
      label: t('Anordnung'),
      options: [
        ['cube', t('Würfel (6 Scheiben)')],
        ['octa', t('Oktaeder (8 Scheiben)')],
        ['dodeca', t('Dodekaeder (12 Scheiben)')],
        ['cubocta', t('Kuboktaeder (14 Scheiben)')],
        ['icosa', t('Ikosaeder (20 Scheiben)')],
        ['rhombi', t('Rhombenkuboktaeder (26 Scheiben)')],
        ['tico', t('Fußball (32 Scheiben)')],
      ],
      def: 'icosa',
      title: t('Nach welchem Polyeder die Scheiben verteilt werden: mehr Scheiben = rundere Kugel, mehr Schlitze'),
    },
    { key: 'overlap', type: 'number', label: t('Überlappung (%)'), min: 0, max: 100, def: 60, title: t('0 % = die Scheiben greifen gerade ineinander, 100 % = so weit wie möglich. Mehr Überlappung = größere Scheiben, festerer Halt, mehr Muster') },
    { key: 'thickness', type: 'length', label: t('Materialdicke'), min: 0.1, max: 10, def: 1 },
    { key: 'topHole', type: 'length', label: t('Öffnung oben'), min: 0, max: 500, def: 40, title: t('Loch in der obersten Scheibe, z. B. für die Lampenfassung (E14 etwa 30 mm, E27 etwa 40 mm); 0 = keins') },
    { key: 'bottomHole', type: 'length', label: t('Öffnung unten'), min: 0, max: 500, def: 0, title: t('Loch in der untersten Scheibe, z. B. zum Wechseln der Lampe; 0 = keins'), advanced: true },
    { key: 'play', type: 'length', label: t('Steckspiel'), min: -1, max: 2, def: 0.1, title: t('Die Schlitze werden um so viel breiter als die Materialdicke; negativ = Presspassung') },
    { key: 'kerf', type: 'length', label: t('Schnittfuge (Kerf)'), min: 0, max: 2, def: 0.1, title: t('Breite des Laserschnitts: Die Kontur wird um die Hälfte nach außen versetzt, Schlitze werden schmaler. Der Kerf des Layers wirkt beim Lasern zusätzlich.') },
  ],
  // Saved objects keep their packParts layout; new ones are nested compactly.
  migrate(p, from) { return from < 2 ? { ...p, partLayout: 'packed' } : p; },
  validate(raw) {
    const p = P(raw);
    const out: Issue[] = [];
    if (p.thickness + p.play <= p.kerf) {
      out.push({ key: 'play', level: 'error', msg: t('Die Schlitze werden schmaler als die Schnittfuge.') });
      return out;
    }
    const L = sphereLayout(raw);
    if (!L) {
      out.push({ key: 'thickness', level: 'error', msg: t('Für diese Materialdicke ist die Kugel zu klein: Durchmesser vergrößern, dünneres Material oder weniger Scheiben wählen.') });
      return out;
    }
    for (const disc of L.discs)
      if (disc.hole > 0 && disc.hole > maxHole(disc, p.thickness)) {
        const key = disc === L.discs[0] ? 'topHole' : 'bottomHole';
        out.push({ key, level: 'error', msg: t('Die Öffnung schneidet in die Schlitze: höchstens {d} mm.', { d: fmt(Math.max(0, maxHole(disc, p.thickness))) }) });
      }
    if (p.thickness > 2) out.push({ key: 'thickness', level: 'warn', msg: t('Dickes, starres Material lässt sich meist nicht zur geschlossenen Kugel stecken, weil sich die Scheiben beim Einsetzen etwas biegen müssen. Gut geeignet sind Papier, Karton, Polypropylen oder Furnier.') });
    return out;
  },
  generate(raw) {
    const p = P(raw);
    const L = sphereLayout(raw);
    if (!L) return { parts: [], info: [] };
    const items = L.discs.map((disc) => ({ key: disc.key, subs: discOutline(disc, L.r, p.kerf) }));
    const parts = arrangeParts(items, 3 + p.kerf, raw.partLayout);
    const angles = [...new Set(L.discs.flatMap((d) => d.slots.map((s) => Math.round(s.angle * 10) / 10)))].sort((a, b) => a - b);
    const widths = [...new Set(L.discs.flatMap((d) => d.slots.map((s) => Math.round((s.w - p.kerf) * 100) / 100)))].sort((a, b) => a - b);
    const slots = L.discs.reduce((s, d) => s + d.slots.length, 0) / 2;
    return {
      parts,
      info: [
        [t('Scheiben'), String(L.discs.length)],
        [t('Scheibendurchmesser'), `${fmt(2 * L.r)} mm`],
        [t('Steckverbindungen'), String(slots)],
        [t('Winkel zwischen Scheiben'), angles.map((a) => `${fmt(a)}°`).join(', ')],
        [t('Schlitzbreite (gezeichnet)'), widths.map((w) => `${fmt(w, 2)} mm`).join(', ')],
      ],
    };
  },
  label(raw, part) {
    const p = P(raw);
    const n = sphereNormals(p.shape).length;
    const base = t('Scheibenkugel Ø{d} ({n} Scheiben)', { d: fmt(p.diameter), n });
    if (!part) return base;
    return `${base}: ${t('Scheibe {n}', { n: part.replace(/\D/g, '') })}`;
  },
};
