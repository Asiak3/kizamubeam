// Passung von Steckverbindungen: wie viel Luft (oder Pressung) Zinken, Zapfen und Schlitze nach dem Lasern haben,
// berechnet aus Spiel, Schnittfuge im Generator, Kerf-Versatz des Layers und der Schnittbreite des Lasers. Mit einer
// Kalibrierung des Materials (Kalibrierassistent) wird gegen den dort gefundenen besten Wert verglichen.
// Genutzt von „Konstruktion prüfen“ (check.ts), den Generator- und Verbindungsdialogen (Vorschläge) und dem Assistenten.
import { apply, isOff, Layer, Mat, mul, IDENT, Obj, Pt } from './model';
import { boundsOf } from './geom';
import { library, MaterialEntry, MaterialFit } from './materials';
import { dec, t } from './i18n';
import type { Params } from './generators/types';
import { getGenerator } from './generators/index';

/**
 * Art der Passung. pair: zwei gelaserte Teile ineinander (Fingerzinken: Zinke in Lücke), Spiel je Seite.
 * slot: ein Schlitz nimmt eine Platte in voller Materialdicke auf; extra = wie viel breiter als die Dicke gezeichnet.
 */
export type FitKind = 'pair' | 'slot';

/** Generatoren mit Steckverbindungen: Art und Parameter für das Spiel */
export const GEN_FITS: Record<string, { kind: FitKind; play: string }> = {
  box: { kind: 'pair', play: 'clearance' },
  drawer: { kind: 'pair', play: 'clearance' },
  insert: { kind: 'slot', play: 'play' },
  shelf: { kind: 'slot', play: 'play' },
  discsphere: { kind: 'slot', play: 'play' },
  ribs: { kind: 'slot', play: 'play' },
};

/** Verbindungsarten des Verbindungs-Werkzeugs: Zinken und Haken sind Teil-in-Teil, die übrigen stecken in Schlitzen */
export const jointFitKind = (kind: string): FitKind => (kind === 'finger' || kind === 'snap' || kind === 'hook' ? 'pair' : 'slot');

/** Gezeichnete Passung: pair = Spiel je Seite, slot = Schlitzbreite über der Nenndicke (beides ohne Laserfuge) */
export function drawnFit(kind: FitKind, play: number, kerf: number, layerKerf: number): number {
  // Schnittfuge im Generator und Kerf-Versatz des Layers machen Material breiter und Lücken schmaler; bei pair
  // wirkt beides je Seite einmal, bei slot verengt es den Schlitz insgesamt um dasselbe Maß
  void kind;
  return play - kerf - 2 * layerKerf;
}

/**
 * Spiel/Pressung je Seite nach dem Lasern (mm, negativ = Pressung).
 * pair: gezeichnetes Spiel + Schnittbreite (beide Teile verlieren die halbe Fuge).
 * slot: (Dicke + Schlitzzugabe + Schnittbreite − tatsächliche Dicke) / 2.
 */
export function realGap(kind: FitKind, drawn: number, beam: number, th: number, thReal: number): number {
  return kind === 'pair' ? drawn + beam : (th + drawn + beam - thReal) / 2;
}

/** Grenzen für „sehr eng“ und „locker“ je Seite, abhängig von der Materialdicke */
export function fitLimits(th: number) {
  const tight = Math.max(0.05, 0.02 * th);
  return { tight, veryTight: 2 * tight, loose: Math.max(0.15, 0.05 * th) };
}

/** Abweichung von der Kalibrierung je Seite (negativ = enger als kalibriert) */
export function calibratedDev(kind: FitKind, drawn: number, th: number, fit: MaterialFit): number {
  return kind === 'pair' ? drawn - fit.pair : (th + drawn - (fit.th + fit.slot)) / 2;
}

/**
 * Werte, die ein Generator mit dieser Kalibrierung bekommen soll: Materialdicke, Schnittfuge (falls gemessen) und
 * Spiel so, dass die gezeichnete Passung der kalibrierten entspricht. Layer-Kerf wird eingerechnet.
 */
export function suggestFit(kind: FitKind, e: MaterialEntry, kerfNow: number, layerKerf: number): { th: number; kerf: number; play: number } | null {
  const f = e.fit;
  if (!f) return null;
  const th = e.thickness ?? f.th;
  // Hat der Layer einen Kerf-Versatz, gleicht der schon die Fuge aus: im Bauteil dann keine zweite Fuge
  const kerf = layerKerf ? 0 : (f.kerf ?? kerfNow);
  // pair: play − kerf − 2·kl = f.pair; slot: th + play − kerf − 2·kl = f.th + f.slot
  const play = kind === 'pair' ? f.pair + kerf + 2 * layerKerf : f.slot + f.th - th + kerf + 2 * layerKerf;
  return { th, kerf, play: Math.round(play * 1000) / 1000 };
}

/** Generator-Parameter für die Kalibrierung des Materials (nur Felder, die der Generator hat) */
export function genFitPatch(gen: string, e: MaterialEntry, p: Params, layerKerf: number): Partial<Params> | null {
  const spec = GEN_FITS[gen];
  if (!spec) return null;
  const s = suggestFit(spec.kind, e, Number(p.kerf ?? 0), layerKerf);
  if (!s) return null;
  return { thickness: s.th, kerf: s.kerf, [spec.play]: s.play };
}

export interface FitFinding {
  key: string;
  level: 'error' | 'warn' | 'info';
  kind: 'fit' | 'thickness';
  msg: string;
  objs: Obj[];
  lines: Pt[][];
  /** Generator-Bauteil und Parameter für die Korrektur */
  gen?: { obj: Obj; patch: Partial<Params> };
  /** Die Korrektur übernimmt die Werte der Kalibrierung */
  calibrated: boolean;
}

const f2 = (v: number) => dec((Math.round(v * 100) / 100).toFixed(2));

function boxLine(objs: Obj[], pad = 1.5): Pt[] {
  const b = boundsOf(objs);
  if (!b) return [];
  const x0 = b.x - pad, y0 = b.y - pad, x1 = b.x + b.w + pad, y1 = b.y + b.h + pad;
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
}

interface FitCase {
  key: string;
  name: string;
  kind: FitKind;
  th: number;
  play: number;
  kerf: number;
  layer: Layer;
  objs: Obj[];
  lines: Pt[][];
  gen?: { obj: Obj; gen: string; params: Params; bound: Set<string> };
}

/** Befunde zur Passung: Materialdicke passt nicht zum Material des Layers, Passung zu eng/locker oder anders als kalibriert */
export function checkFits(objs: Obj[], layerOf: (i: number) => Layer, beam: number, out: FitFinding[]) {
  const cases: FitCase[] = [];
  // Bauteile aus Generatoren: je Baugruppe ein Fall
  const asms = new Map<string, Obj[]>();
  const tops = new Map<Obj, Obj>();
  const world = new Map<number, [Obj, Mat]>();
  const walk = (top: Obj, o: Obj, parent: Mat) => {
    if (isOff(o)) return;
    const m = mul(parent, o.m);
    tops.set(o, top);
    world.set(o.id, [o, m]);
    if (o.shape.kind === 'group') o.shape.children.forEach((c) => walk(top, c, m));
  };
  for (const o of objs) walk(o, o, IDENT);
  for (const [o] of world.values()) {
    const s = o.shape;
    if (s.kind !== 'gen' || !GEN_FITS[s.gen] || !layerOf(o.layer).output) continue;
    const k = s.asm ?? `obj${o.id}`;
    (asms.get(k) ?? asms.set(k, []).get(k)!).push(o);
  }
  for (const [k, parts] of asms) {
    const o = parts[0];
    const s = o.shape as Extract<Obj['shape'], { kind: 'gen' }>;
    const spec = GEN_FITS[s.gen];
    const p = s.params as Params;
    const allTops = [...new Set(parts.map((x) => tops.get(x)!))];
    cases.push({
      key: `gen:${k}`, name: genName(s.gen), kind: spec.kind, th: Number(p.thickness), play: Number(p[spec.play] ?? 0), kerf: Number(p.kerf ?? 0),
      layer: layerOf(o.layer), objs: allTops, lines: [boxLine(allTops)],
      gen: { obj: o, gen: s.gen, params: p, bound: new Set(Object.keys(s.bind ?? {})) },
    });
  }
  // Verbindungen aus dem Verbindungs-Werkzeug
  for (const [o, m] of world.values()) {
    for (const [i, mt] of (o.mates ?? []).entries()) {
      if (!layerOf(o.layer).output) continue;
      const other = world.get(mt.to);
      const ln: Pt[][] = [[apply(m, mt.a[0].x, mt.a[0].y), apply(m, mt.a[1].x, mt.a[1].y)]];
      if (other) ln.push([apply(other[1], mt.b[0].x, mt.b[0].y), apply(other[1], mt.b[1].x, mt.b[1].y)]);
      const objsOf = [tops.get(o)!, ...(other ? [tops.get(other[0])!] : [])];
      cases.push({
        key: `mate:${o.id}:${i}`, name: jointName(mt.kind), kind: jointFitKind(mt.kind), th: mt.th,
        play: mt.fit?.c ?? NaN, kerf: mt.fit?.k ?? NaN, layer: layerOf(o.layer), objs: [...new Set(objsOf)], lines: ln,
      });
    }
  }

  for (const c of cases) {
    const entry = library.get(c.layer.material);
    const thMat = entry?.thickness ?? null;
    const kl = c.layer.kerf;
    // Materialdicke der Konstruktion gegen die des Materials am Layer
    if (thMat !== null && Math.abs(thMat - c.th) > 0.05) {
      const f: FitFinding = {
        key: `${c.key}:th`, kind: 'thickness', level: 'warn',
        msg: t('{name} rechnet mit {a} mm Materialdicke, das Material des Layers ist {b} mm dick.', { name: c.name, a: f2(c.th), b: f2(thMat) }),
        objs: c.objs, lines: c.lines, calibrated: false,
      };
      if (c.gen && !c.gen.bound.has('thickness')) {
        const sug = entry ? genFitPatch(c.gen.gen, entry, c.gen.params, kl) : null;
        f.gen = { obj: c.gen.obj, patch: sug ? withoutBound(sug, c.gen.bound) : { thickness: thMat } };
        f.calibrated = !!sug;
      }
      out.push(f);
    }
    if (!isFinite(c.play) || !isFinite(c.kerf)) continue;
    const drawn = drawnFit(c.kind, c.play, c.kerf, kl);
    const detail = t(' (Spiel {c}, Schnittfuge im Generator {k}, Kerf-Versatz am Layer {kl} mm)', { c: f2(c.play), k: f2(c.kerf), kl: f2(kl) });
    const fix = () => {
      if (!c.gen || !entry?.fit) return undefined;
      const patch = genFitPatch(c.gen.gen, entry, c.gen.params, kl);
      return patch ? { obj: c.gen.obj, patch: withoutBound(patch, c.gen.bound) } : undefined;
    };
    if (entry?.fit) {
      const d = calibratedDev(c.kind, drawn, c.th, entry.fit);
      if (Math.abs(d) <= 0.03) continue;
      out.push({
        key: `${c.key}:fit`, kind: 'fit', level: 'warn',
        msg: (d < 0
          ? t('{name}: {d} mm je Seite enger als die Kalibrierung für {material}.', { name: c.name, d: f2(-d), material: entry.material })
          : t('{name}: {d} mm je Seite lockerer als die Kalibrierung für {material}.', { name: c.name, d: f2(d), material: entry.material })) + detail,
        objs: c.objs, lines: c.lines, gen: fix(), calibrated: true,
      });
      continue;
    }
    const g = realGap(c.kind, drawn, beam, c.th, thMat ?? c.th);
    const lim = fitLimits(c.th);
    let msg = '';
    let level: FitFinding['level'] = 'warn';
    if (g < -lim.veryTight) {
      level = 'error';
      msg = t('{name}: Die Passung ist für {th} mm Material zu eng ({g} mm Pressung je Seite). Die Teile passen kaum zusammen oder das Material reißt.', { name: c.name, th: f2(c.th), g: f2(-g) });
    } else if (g < -lim.tight)
      msg = t('{name}: Die Passung ist für {th} mm Material sehr eng ({g} mm Pressung je Seite).', { name: c.name, th: f2(c.th), g: f2(-g) });
    else if (g > lim.loose) msg = t('{name}: Die Passung ist sehr locker ({g} mm Luft je Seite), die Verbindung wackelt.', { name: c.name, g: f2(g) });
    if (!msg) continue;
    const f: FitFinding = { key: `${c.key}:fit`, kind: 'fit', level, msg: msg + detail, objs: c.objs, lines: c.lines, calibrated: false };
    // Ohne Kalibrierung: Spiel so setzen, dass nach dem Lasern nichts übrig bleibt (satt)
    if (c.gen && !c.gen.bound.has(GEN_FITS[c.gen.gen].play)) {
      const target = c.kind === 'pair' ? c.kerf + 2 * kl - beam : c.kerf + 2 * kl - beam + (thMat ?? c.th) - c.th;
      f.gen = { obj: c.gen.obj, patch: { [GEN_FITS[c.gen.gen].play]: Math.round(target * 100) / 100 } };
    }
    out.push(f);
  }
}

function withoutBound(p: Partial<Params>, bound: Set<string>): Partial<Params> {
  return Object.fromEntries(Object.entries(p).filter(([k]) => !bound.has(k)));
}

function genName(id: string): string {
  return getGenerator(id)?.name ?? id;
}

function jointName(kind: string): string {
  return (
    ({
      finger: t('Fingerzinken'), tenon: t('Schlitz und Zapfen'), lap: t('Überblattung'), snap: t('Schnappverbindung'), hook: t('Hakenverbindung'),
      wedge: t('Keilzapfen'), tslot: t('T-Slot'), lidhinge: t('Deckelscharnier'),
    } as Record<string, string>)[kind] ?? t('Verbindung')
  );
}
