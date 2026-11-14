// „Konstruktion prüfen“ für Baugruppen aus Generatoren (Box, Einsatz, Regal, Scheibenkugel, Schicht- und
// Rippenmodell): Hängt jedes Stück am Rest, und lässt sich alles gerade stecken? Die Rechnung steht in
// src/view3d/assembly.ts; hier werden die Baugruppen im Dokument gefunden und die Befunde formuliert.
import { IDENT, inv, isOff, Layer, leaves, Mat, mul, Obj, Pt } from './model';
import { boundsOf } from './geom';
import { t } from './i18n';
import type { Params } from './generators/types';
import { getGenerator } from './generators/index';
import { asmSolids, Solid } from './view3d/solids';
import { collectCutters, Cutter, cutPlate } from './view3d/cuts';
import { SCALE } from './clip';
import { analyzeAssembly, AssemblyReport } from './view3d/assembly';
import { genThickness } from './view3d/poses';

/** Generatoren, deren Teile eine zusammenhängende Baugruppe bilden (Zahnradpaar nicht: Räder sitzen auf Achsen) */
const ASSEMBLIES = new Set(['box', 'drawer', 'insert', 'shelf', 'discsphere', 'stack', 'ribs']);

export interface AsmFinding {
  key: string;
  kind: 'loose' | 'insert';
  level: 'error' | 'warn';
  msg: string;
  objs: Obj[];
  lines: Pt[][];
}

const cache = new Map<string, AssemblyReport | null>();

/** Gezeichnete Formen, die Teile einer Baugruppe ausschneiden: sig für den Zwischenspeicher, apply schneidet die Teile */
export interface AsmCuts {
  sig: string;
  apply: (solids: Solid[]) => void;
}

/**
 * Prüfung einer Baugruppe (zwischengespeichert, weil die Prüfung nach jeder Änderung neu läuft). cuts: Löcher und Kerben
 * aus gezeichneten Formen (wie in der 3D-Ansicht, Issue #285); ohne sie wird die Baugruppe geprüft, wie sie erzeugt wird.
 */
export function assemblyReport(gen: string, params: Params, keys: Set<string>, cuts?: AsmCuts): AssemblyReport | null {
  const ck = `${gen}|${JSON.stringify(params)}|${[...keys].sort().join(',')}${cuts ? '|' + cuts.sig : ''}`;
  if (cache.has(ck)) return cache.get(ck)!;
  const solids = asmSolids(gen, params, genThickness(params, 3), keys);
  if (solids && cuts) cuts.apply(solids);
  const r = solids && solids.length > 1 ? analyzeAssembly(solids) : null;
  if (cache.size > 20) cache.clear();
  cache.set(ck, r);
  return r;
}

function boxLine(objs: Obj[], pad = 1.5): Pt[] {
  const b = boundsOf(objs);
  if (!b) return [];
  const x0 = b.x - pad, y0 = b.y - pad, x1 = b.x + b.w + pad, y1 = b.y + b.h + pad;
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }, { x: x0, y: y0 }];
}

/** Kurzer Name eines Stücks: Teil ohne den Namen der Baugruppe, bei mehreren Inseln mit Stücknummer */
function pieceName(r: AssemblyReport, i: number): string {
  const p = r.pieces[i];
  const k = p.label.lastIndexOf(': ');
  const name = k >= 0 ? p.label.slice(k + 2) : p.key;
  return p.island ? t('{part} (Stück {n})', { part: name, n: p.island }) : name;
}

const list = (names: string[], max = 8) => [...new Set(names)].slice(0, max).join(', ') + (new Set(names).size > max ? ' …' : '');

/** Formen, die Teile dieser Baugruppe ausschneiden (nur Formen auf der Seite des Teils, deren Rahmen das Teil berührt) */
function asmCuts(parts: Obj[], mats: Map<Obj, Mat>, pageOf: Map<Obj, number>, cutters: Cutter[]): AsmCuts | undefined {
  const rel: { key: string; page: number; toLocal: Mat; cs: Cutter[] }[] = [];
  for (const o of parts) {
    const page = pageOf.get(o),
      m = mats.get(o);
    if (page === undefined || !m) continue;
    const b = boundsOf([{ ...o, m }]);
    if (!b) continue;
    const box = [b.x * SCALE, b.y * SCALE, (b.x + b.w) * SCALE, (b.y + b.h) * SCALE];
    const cs = cutters.filter((c) => c.page === page && c.box[0] < box[2] && c.box[2] > box[0] && c.box[1] < box[3] && c.box[3] > box[1]);
    if (cs.length) rel.push({ key: (o.shape as Extract<Obj['shape'], { kind: 'gen' }>).part ?? 'main', page, toLocal: inv(m), cs });
  }
  if (!rel.length) return undefined;
  return {
    sig: JSON.stringify(rel.map((r) => [r.key, r.page, r.toLocal, r.cs.map((c) => [c.id, c.paths])])),
    apply: (solids) => {
      for (const s of solids) {
        const r = rel.find((x) => x.key === s.key);
        const cut = r && cutPlate(s.polys, r.page, r.toLocal, r.cs);
        if (cut) s.polys = cut.polys;
      }
    },
  };
}

/**
 * Befunde für alle Baugruppen der Seite. all: Objekte aller Seiten (nach dem Verschachteln liegen Teile verteilt),
 * damit fehlende Teile nur dann als fehlend gelten, wenn sie wirklich gelöscht sind. pages: Objekte je Seite; damit
 * schneiden gezeichnete Formen Löcher und Kerben in die Teile wie beim Lasern (ohne pages wird nichts geschnitten).
 */
export function checkAssemblies(objs: Obj[], all: Obj[], layerOf: (i: number) => Layer, out: AsmFinding[], pages?: Obj[][]) {
  const tops = new Map<Obj, Obj>();
  /** Lage jedes Teils auf der Arbeitsfläche */
  const mats = new Map<Obj, Mat>();
  const here: Obj[] = [];
  const walk = (top: Obj, o: Obj, parent: Mat, mine: boolean) => {
    if (isOff(o)) return;
    const m = mul(parent, o.m);
    if (mine) tops.set(o, top);
    if (o.shape.kind === 'group') o.shape.children.forEach((c) => walk(top, c, m, mine));
    else if (o.shape.kind === 'gen' && o.shape.asm && ASSEMBLIES.has(o.shape.gen) && layerOf(o.layer).output) {
      here.push(o);
      mats.set(o, m);
    }
  };
  const pageSet = new Set(objs);
  for (const o of all) walk(o, o, IDENT, pageSet.has(o));
  if (all !== objs) for (const o of objs) if (!all.includes(o)) walk(o, o, IDENT, true);
  const pageOf = new Map<Obj, number>();
  pages?.forEach((p, i) => {
    for (const [l] of leaves(p)) pageOf.set(l, i);
  });
  const cutters = pages && here.length ? collectCutters(pages, layerOf) : [];
  // Baugruppen, von denen mindestens ein Teil auf dieser Seite liegt
  const asms = new Map<string, Obj[]>();
  for (const o of here) {
    const s = o.shape as Extract<Obj['shape'], { kind: 'gen' }>;
    (asms.get(s.asm!) ?? asms.set(s.asm!, []).get(s.asm!)!).push(o);
  }
  for (const [k, parts] of asms) {
    const onPage = parts.filter((o) => tops.has(o));
    if (!onPage.length) continue;
    const s = onPage[0].shape as Extract<Obj['shape'], { kind: 'gen' }>;
    const g = getGenerator(s.gen);
    if (!g) continue;
    const keys = new Set(parts.map((o) => (o.shape as Extract<Obj['shape'], { kind: 'gen' }>).part ?? 'main'));
    let r: AssemblyReport | null = null;
    try {
      r = assemblyReport(s.gen, s.params as Params, keys, cutters.length ? asmCuts(parts, mats, pageOf, cutters) : undefined);
    } catch {
      r = null;
    }
    if (!r) continue;
    const name = g.name;
    const objsOf = (pieces: number[]) => {
      const ks = new Set(pieces.map((i) => r!.pieces[i].key));
      return [...new Set(onPage.filter((o) => ks.has((o.shape as Extract<Obj['shape'], { kind: 'gen' }>).part ?? 'main')).map((o) => tops.get(o)!))];
    };
    // Lose Stücke und Gruppen, die nicht am Hauptkörper hängen
    const rest = r.groups.slice(1);
    if (rest.length) {
      const single = rest.filter((x) => x.length === 1).flat();
      const multi = rest.filter((x) => x.length > 1);
      const pieces = rest.flat();
      const msgs: string[] = [];
      const sl = list(single.map((i) => pieceName(r!, i)));
      if (single.length === 1) msgs.push(t('{list} berührt kein anderes Teil.', { list: sl }));
      else if (single.length) msgs.push(t('{list} berühren kein anderes Teil.', { list: sl }));
      for (const grp of multi.slice(0, 3)) msgs.push(t('{list} halten nur untereinander, nicht am Rest.', { list: list(grp.map((i) => pieceName(r!, i)), 5) }));
      const os = objsOf(pieces);
      out.push({
        key: `asm:${k}:loose`, kind: 'loose', level: 'error',
        msg: `${t('{name}: Nicht alles hängt zusammen.', { name })} ${msgs.join(' ')}`,
        objs: os, lines: os.length ? [boxLine(os)] : [],
      });
    }
    if (r.conflicts.length) {
      const pieces = r.conflicts.map((c) => c.piece);
      const os = objsOf(pieces);
      const first = r.conflicts[0];
      out.push({
        key: `asm:${k}:insert`, kind: 'insert', level: 'warn',
        msg: `${pieces.length === 1
          ? t('{name}: {list} lässt sich nicht gerade stecken.', { name, list: list(pieces.map((i) => pieceName(r!, i))) })
          : t('{name}: {list} lassen sich nicht gerade stecken.', { name, list: list(pieces.map((i) => pieceName(r!, i))) })} ${t('{part} müsste zum Beispiel gleichzeitig in verschiedenen Richtungen auf {with} geschoben werden. Mit steifem Material geht das nicht; biegsames Material (Pappe, Kunststofffolie) oder eine andere Aufteilung wählen.', {
          part: pieceName(r, first.piece),
          with: list(first.with.map((i) => pieceName(r!, i)), 4),
        })}`,
        objs: os, lines: os.length ? [boxLine(os)] : [],
      });
    }
  }
}
