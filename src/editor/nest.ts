// Editor: Auswahl automatisch verschachteln (Nesting) – Teile bestimmen, Platte wählen, Ergebnis anwenden.
import ClipperLib from 'clipper-lib';
import type { Editor } from '../editor';
import { cloneObj, isCutLayer, leaves, mul, Obj } from '../model';
import { shapeSubs, textLayout, textOutline } from '../geom';
import { execute, flattenSub, Paths, SCALE } from '../clip';
import { autoCell, DEFAULT_NEST, nestSteps, NestResult, Poly } from '../nest';
import { t, tn } from '../i18n';

/** Einstellungen des Dialogs „Verschachteln“ (Koordinaten wie angezeigt: Ursprung unten links) */
export interface NestSettings {
  /** Fläche: Arbeitsbereich, Materialgröße (Rechteck) oder die größte gewählte Form (z. B. ein Reststück) */
  sheet: 'bed' | 'material' | 'shape';
  /** Materialgröße und Lage der linken unteren Ecke in mm */
  w: number;
  h: number;
  x: number;
  y: number;
  gap: number;
  margin: number;
  /** Drehschritt in Grad; 0 = nicht drehen */
  rotStep: number;
  /** Ecke, an der sich die Teile sammeln (wie angezeigt) */
  corner: 'bl' | 'br' | 'tl' | 'tr';
  /** Kleine Teile dürfen in Löcher größerer Teile */
  holes: boolean;
  /** Nicht gewählte Objekte auf der Seite umgehen */
  avoid: boolean;
  /** Was nicht passt, auf neue Seiten legen */
  newPages: boolean;
  quality: 'fast' | 'normal' | 'fine';
  /** Nur mit sheet = 'shape': ID der Form, die als Platte dient (sonst die größte gewählte) */
  container?: number;
}

export const DEFAULT_NEST_SETTINGS: NestSettings = {
  sheet: 'bed', w: 300, h: 200, x: 0, y: 0, gap: 2, margin: 3, rotStep: 90, corner: 'bl',
  holes: true, avoid: true, newPages: true, quality: 'normal',
};

const QUALITY = { fast: { cell: 1, time: 0 }, normal: { cell: 0.5, time: 1500 }, fine: { cell: 0.25, time: 5000 } };

/** Zusammengehörige Objekte, die gemeinsam bewegt werden (Teil samt Gravuren, Löchern, verknüpftem Text) */
export interface NestUnit {
  objs: Obj[];
  region: Poly[];
}

export interface NestOutcome {
  placed: Obj[][];
  unplaced: Obj[][];
  newPages: number;
  usage: number[];
}

const { ClipType, PolyFillType, ClipperOffset, JoinType, EndType, Clipper, PolyType, PolyTree } = ClipperLib;
const toPolys = (paths: Paths): Poly[] => paths.map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));

/** Nur die äußeren Umrisse einer Fläche (Löcher gefüllt) */
function outersOnly(paths: Paths): Paths {
  const c = new Clipper();
  c.AddPaths(paths, PolyType.ptSubject, true);
  const tree = new PolyTree();
  c.Execute(ClipType.ctUnion, tree, PolyFillType.pftEvenOdd, PolyFillType.pftEvenOdd);
  return tree.Childs().map((n) => n.Contour());
}

function areaOf(paths: Paths): number {
  return paths.reduce((s, p) => s + ClipperLib.Clipper.Area(p), 0) / (SCALE * SCALE);
}

function boxOf(paths: Paths) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of paths)
    for (const q of p) {
      x0 = Math.min(x0, q.X);
      y0 = Math.min(y0, q.Y);
      x1 = Math.max(x1, q.X);
      y1 = Math.max(y1, q.Y);
    }
  return { x0, y0, x1, y1 };
}

export class EditorNest {
  /**
   * Fläche von Objekten in Weltkoordinaten (µm): Schnittkonturen aller Objekte zusammen nach Gerade-Ungerade
   * (eine Form auf einer Platte wird so zum Loch), Gravuren, Bilder und offene Linien als volle Fläche darüber.
   */
  nestPaths(this: Editor, objs: Obj[], holes: boolean): Paths {
    const cut: Paths = [];
    let solid: Paths = [];
    for (const [leaf, m] of leaves(objs)) {
      const s = leaf.shape;
      let subs = s.kind === 'text' ? textOutline(s)?.subs : s.kind === 'image' ? null : shapeSubs(s);
      if (s.kind === 'text' && !subs) {
        const b = textLayout(s).box;
        subs = [{ closed: true, nodes: [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }] }];
      }
      if (s.kind === 'image') subs = [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: s.w, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }] }];
      const closed: Paths = [],
        open: Paths = [];
      for (const sp of subs ?? []) {
        if (sp.nodes.length < 2) continue;
        const p = flattenSub(sp, m);
        if (sp.closed && p.length >= 3) closed.push(p);
        else if (p.length >= 2) open.push(p);
      }
      const isCut = isCutLayer(this.layer(leaf.layer)) && s.kind !== 'image';
      if (isCut) cut.push(...closed);
      else if (closed.length) solid.push(...execute(ClipType.ctUnion, closed, [], PolyFillType.pftEvenOdd));
      if (open.length) {
        const co = new ClipperOffset(2, 0.01 * SCALE);
        co.AddPaths(open, JoinType.jtRound, EndType.etOpenRound);
        const out: Paths = [];
        co.Execute(out, 0.05 * SCALE);
        solid.push(...out);
      }
    }
    let region = cut.length ? execute(ClipType.ctUnion, cut, [], PolyFillType.pftEvenOdd) : [];
    if (solid.length) {
      solid = execute(ClipType.ctUnion, solid, [], PolyFillType.pftNonZero);
      region = region.length ? execute(ClipType.ctUnion, region, solid, PolyFillType.pftNonZero) : solid;
    }
    return holes ? region : outersOnly(region);
  }

  /**
   * Gewählte Objekte zu Einheiten zusammenfassen, die gemeinsam bewegt werden:
   * - Eine Schnittkontur, die ganz in einer anderen liegt, gehört zu deren Teil, wenn sie dort im Material liegt
   *   (z. B. ein Loch als eigene Form). Liegt sie in einem Loch, ist sie ein eigenes Teil. Wie beim Lasern zählt
   *   dafür die Gerade-Ungerade-Regel über alle ineinanderliegenden Konturen.
   * - Teile, die sich nur teilweise überdecken, bleiben getrennt (z. B. übereinander eingefügte Teile).
   * - Gravuren, Bilder und Text gehören zum kleinsten Teil, das sie berühren. Text auf Pfad bleibt bei seiner Form.
   */
  nestUnits(this: Editor, objs: Obj[], holes: boolean): NestUnit[] {
    const n = objs.length;
    const own = objs.map((o) => this.nestPaths([o], true));
    const foot = own.map((p) => outersOnly(p));
    const area = foot.map(areaOf);
    const box = foot.map(boxOf);
    const isCut = objs.map((o) => [...leaves([o])].some(([l]) => isCutLayer(this.layer(l.layer)) && l.shape.kind !== 'image' && l.shape.kind !== 'text'));
    const touches = (i: number, j: number) => !(box[i].x1 < box[j].x0 || box[j].x1 < box[i].x0 || box[i].y1 < box[j].y0 || box[j].y1 < box[i].y0);
    const inter = (i: number, j: number) => (touches(i, j) ? areaOf(execute(ClipType.ctIntersection, foot[i], foot[j], PolyFillType.pftNonZero)) : 0);
    const parent = objs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const join = (i: number, j: number) => (parent[find(i)] = find(j));

    // Genau übereinanderliegende Kopien (z. B. mehrfach eingefügt) durchzählen: Die k-te Kopie einer Platte gehört
    // zur k-ten Kopie ihres Lochs, sonst würden gestapelte Teile zu einem verschmelzen
    const copyOf = new Map<string, number>();
    const copy = own.map((p) => {
      const key = JSON.stringify(p);
      const k = copyOf.get(key) ?? 0;
      copyOf.set(key, k + 1);
      return k;
    });
    const single = own.map((p) => copyOf.get(JSON.stringify(p)) === 1);
    // Schnittkonturen: kleinste umschließende Kontur als Elternteil (bei gleicher Fläche das frühere Objekt)
    const up = new Array<number>(n).fill(-1);
    for (let j = 0; j < n; j++) {
      if (!isCut[j] || !area[j]) continue;
      for (let i = 0; i < n; i++) {
        if (i === j || !isCut[i] || area[i] < area[j] || (area[i] === area[j] && i > j)) continue;
        if (copy[i] !== copy[j] && !single[i]) continue;
        if (up[j] >= 0 && area[i] >= area[up[j]]) continue;
        if (inter(i, j) >= area[j] * 0.999 - 0.01) up[j] = i;
      }
    }
    const root = (i: number) => {
      while (up[i] >= 0) i = up[i];
      return i;
    };
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < n; i++) if (isCut[i]) clusters.set(root(i), [...(clusters.get(root(i)) ?? []), i]);
    const probe = 0.02 * SCALE;
    for (const members of clusters.values()) {
      if (members.length < 2) continue;
      // Inseln der Gruppe: äußere Kontur mit ihren direkten Löchern
      const c = new Clipper();
      for (const i of members) c.AddPaths(own[i], PolyType.ptSubject, true);
      const tree = new PolyTree();
      c.Execute(ClipType.ctUnion, tree, PolyFillType.pftEvenOdd, PolyFillType.pftEvenOdd);
      const islands: { outer: ClipperLib.Path; holes: ClipperLib.Path[] }[] = [];
      const walk = (node: ClipperLib.PolyNode) => {
        for (const ch of node.Childs()) {
          if (ch.IsHole()) continue;
          islands.push({ outer: ch.Contour(), holes: ch.Childs().map((x) => x.Contour()) });
          for (const hole of ch.Childs()) walk(hole);
        }
      };
      walk(tree);
      const owner = new Map<number, number>();
      for (const i of members) {
        // Jede Kontur trennt Material von Nicht-Material: knapp innen und knapp außen nachsehen, welche Insel dort ist
        for (const path of own[i]) {
          let best = -1,
            bestLen = 0;
          for (let k = 0; k < path.length; k++) {
            const a = path[k],
              b = path[(k + 1) % path.length];
            const len = Math.hypot(b.X - a.X, b.Y - a.Y);
            if (len > bestLen) [best, bestLen] = [k, len];
          }
          if (best < 0 || bestLen < 1) continue;
          const a = path[best],
            b = path[(best + 1) % path.length];
          const nx = (-(b.Y - a.Y) / bestLen) * probe,
            ny = ((b.X - a.X) / bestLen) * probe;
          for (const sgn of [1, -1]) {
            const p = { X: Math.round((a.X + b.X) / 2 + sgn * nx), Y: Math.round((a.Y + b.Y) / 2 + sgn * ny) };
            islands.forEach((isl, k) => {
              if (Clipper.PointInPolygon(p, isl.outer) !== 1 || isl.holes.some((h) => Clipper.PointInPolygon(p, h) !== 0)) return;
              if (owner.has(k)) join(i, owner.get(k)!);
              else owner.set(k, i);
            });
          }
        }
      }
    }
    // Gravuren, Bilder, Text: zum kleinsten Teil, das sie berühren
    for (let j = 0; j < n; j++) {
      if (isCut[j]) continue;
      let best = -1;
      for (let i = 0; i < n; i++) if (isCut[i] && (best < 0 || area[i] < area[best]) && inter(i, j) > 0.01) best = i;
      if (best >= 0) join(j, best);
    }
    // Text auf Pfad und seine Form
    const idx = new Map<number, number>();
    objs.forEach((o, i) => {
      for (const [l] of leaves([o])) idx.set(l.id, i);
    });
    objs.forEach((o, i) => {
      for (const [l] of leaves([o])) {
        const link = l.shape.kind === 'text' ? l.shape.path?.link : undefined;
        if (link !== undefined && idx.has(link)) join(i, idx.get(link)!);
      }
    });
    const groups = new Map<number, Obj[]>();
    objs.forEach((o, i) => {
      const r = find(i);
      groups.set(r, [...(groups.get(r) ?? []), o]);
    });
    return [...groups.values()]
      .map((g) => ({ objs: g, region: toPolys(this.nestPaths(g, holes)) }))
      .filter((u) => u.region.length);
  }

  /** Form, die als Platte dient: die angegebene oder die gewählte mit der größten Fläche */
  nestContainer(this: Editor, objs: Obj[], id?: number): Obj | null {
    if (id !== undefined) return objs.find((o) => o.id === id) ?? null;
    let best: Obj | null = null,
      bestA = 0;
    for (const o of objs) {
      if (o.shape.kind === 'text' || o.shape.kind === 'image' || o.shape.kind === 'group') continue;
      const a = areaOf(this.nestPaths([o], true));
      if (a > bestA) [best, bestA] = [o, a];
    }
    return best;
  }

  /**
   * Gewählte Objekte verschachteln. onProgress bekommt den Fortschritt (0 … 1); gibt er false zurück, wird
   * abgebrochen (dann ändert sich nichts und das Ergebnis ist null).
   */
  async nestSel(this: Editor, s: NestSettings, onProgress?: (f: number) => boolean | void): Promise<NestOutcome | null> {
    const sel = this.doc.objs.filter((o) => this.sel.includes(o));
    const fail = (msg: string) => {
      this.hint = msg;
      this.emit('tool');
      return null;
    };
    if (!sel.length) return fail(t('Verschachteln: erst Objekte auswählen.'));
    const bed = this.doc.bed;
    let container: Obj | null = null;
    let area: Poly[];
    if (s.sheet === 'shape') {
      container = this.nestContainer(sel, s.container);
      if (!container) return fail(t('Verschachteln: keine geschlossene Form als Platte in der Auswahl.'));
      area = toPolys(this.nestPaths([container], true));
    } else if (s.sheet === 'material') {
      const y1 = bed.h - s.y;
      area = [[{ x: s.x, y: y1 - s.h }, { x: s.x + s.w, y: y1 - s.h }, { x: s.x + s.w, y: y1 }, { x: s.x, y: y1 }]];
    } else area = [[{ x: 0, y: 0 }, { x: bed.w, y: 0 }, { x: bed.w, y: bed.h }, { x: 0, y: bed.h }]];
    const partsObjs = sel.filter((o) => o !== container);
    if (!partsObjs.length) return fail(t('Verschachteln: außer der Platte sind keine Teile gewählt.'));
    const units = this.nestUnits(partsObjs, s.holes);
    if (!units.length) return fail(t('Verschachteln: die Auswahl hat keine Fläche.'));
    const obstacles = s.avoid
      ? this.doc.objs.filter((o) => !o.hidden && !sel.includes(o)).map((o) => toPolys(this.nestPaths([o], s.holes))).filter((r) => r.length)
      : [];
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of area)
      for (const q of p) [x0, y0, x1, y1] = [Math.min(x0, q.x), Math.min(y0, q.y), Math.max(x1, q.x), Math.max(y1, q.y)];
    const q = QUALITY[s.quality] ?? QUALITY.normal;
    const step = s.rotStep > 0 ? s.rotStep : 360;
    const rotations: number[] = [];
    for (let a = 0; a < 360 - 1e-6; a += step) rotations.push(a);
    const steps = nestSteps(
      units.map((u, i) => ({ key: i, region: u.region })),
      { area, obstacles },
      {
        ...DEFAULT_NEST,
        gap: Math.max(0, s.gap),
        margin: Math.max(0, s.margin),
        rotations,
        // Angezeigt wird mit y nach oben: „unten“ sind die großen internen y-Werte
        flipX: s.corner === 'br' || s.corner === 'tr',
        flipY: s.corner === 'bl' || s.corner === 'br',
        cell: autoCell(x1 - x0, y1 - y0, q.cell),
        newSheets: s.newPages,
        timeLimit: q.time,
      },
    );
    let r: NestResult;
    let tick = Date.now();
    for (;;) {
      const it = steps.next();
      if (it.done) {
        r = it.value;
        break;
      }
      if (onProgress && onProgress(it.value.done) === false) return null;
      // Der Oberfläche zwischendurch Luft lassen
      if (onProgress && Date.now() - tick > 40) {
        await new Promise((res) => setTimeout(res, 0));
        tick = Date.now();
      }
    }
    if (onProgress && onProgress(1) === false) return null;
    const out = this.applyNest(units, r, container);
    // Unselected objects take up room: say so, an unselected stock outline is easily mistaken for the sheet
    if (obstacles.length && (out.unplaced.length || out.newPages)) {
      this.hint += ' ' + t('Nicht gewählte Objekte auf der Seite wurden umgangen. Soll eine gezeichnete Form das Material sein, sie mit auswählen und „Gewählte Form (Reststück)“ nehmen, oder „Andere Objekte auf der Seite umgehen“ ausschalten.');
      this.emit('tool');
    }
    return out;
  }

  /** Ergebnis übernehmen: Teile bewegen, Teile für weitere Platten auf neue Seiten hinter der aktuellen */
  applyNest(this: Editor, units: NestUnit[], r: NestResult, container: Obj | null): NestOutcome {
    const placed = r.placed.filter((p) => units[p.key]);
    const out: NestOutcome = {
      placed: placed.map((p) => units[p.key].objs),
      unplaced: r.unplaced.map((k) => units[k].objs),
      newPages: 0,
      usage: r.usage,
    };
    if (!placed.length) {
      this.hint = t('Verschachteln: kein Teil passt auf die Fläche.');
      this.emit('tool');
      return out;
    }
    this.snapshot(t('Verschachteln'));
    const sheets = Math.max(0, ...placed.map((p) => p.sheet));
    const cur = this.doc.page;
    const pages = [this.doc.pages[cur]];
    for (let k = 1; k <= sheets; k++) {
      const page = { name: this.freePageName(), objs: container ? [cloneObj(container)] : [] };
      this.doc.pages.splice(cur + k, 0, page);
      pages.push(page);
    }
    out.newPages = sheets;
    const target = new Map<Obj, number>();
    for (const p of placed)
      for (const o of units[p.key].objs) {
        o.m = mul(p.m, o.m);
        if (p.sheet > 0) target.set(o, p.sheet);
      }
    // Teile für weitere Platten in ihrer bisherigen Reihenfolge umziehen
    const here = pages[0];
    for (const o of here.objs.filter((x) => target.has(x))) pages[target.get(o)!].objs.push(o);
    here.objs = here.objs.filter((x) => !target.has(x));
    this.setSel(this.sel.filter((o) => here.objs.includes(o)));
    const n = placed.length;
    let msg = tn('Verschachteln: {n} Teil platziert', 'Verschachteln: {n} Teile platziert', n);
    if (sheets) msg += ', ' + tn('{n} neue Seite', '{n} neue Seiten', sheets);
    if (out.unplaced.length) msg += ', ' + tn('{n} Teil passt nicht', '{n} Teile passen nicht', out.unplaced.length);
    this.hint = `${msg}. ${t('Ausnutzung {pct} %', { pct: Math.round((r.usage[0] ?? 0) * 100) })}`;
    this.emit('doc');
    this.emit('sel');
    return out;
  }
}
