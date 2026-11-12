// Editor: Pfad-Werkzeuge: Schließen, Verbinden, Zerlegen, Startpunkt, Trimmen, Ecken.
import { apply, IDENT, inv, isOff, leaves, Mat, newId, Obj, Pt, SubPath, visibleLeaves } from '../model';
import { transformSubs } from '../importers';
import { loadFont, textToSubs } from '../fonts';
import { MAX_COPIES } from '../arrays';
import { bezierPt, Box, segments, shapeSubs, textOutline } from '../geom';
import { dec, t, tn } from '../i18n';
import {
  breakApart, breakAtNode, CLOSE_TOL, copySub, CloseStats, closeSubs, cutParams, extract, JOIN_TOL, joinSubs, nearestParam, pointAt,
  reverseSub, setStart, splitAt, trimSpan, trimSub,
} from '../pathtools';
import { cornerSub, CornerMode, isCorner } from '../corners';
import { shapeCenters, shownMark } from '../arcs';
import type { Editor } from '../editor';
import { SNAP_COLOR, TOOL_HINTS } from './shared';
import { pathIslandPlan, IslandOptions } from '../pathIslands';

/** Formen, die Pfad-Werkzeuge bearbeiten (Grundformen werden dabei zu Pfaden) */
const VECTOR = ['path', 'rect', 'ellipse', 'polygon'];

/** Trimmen: Reste werden mit offenen Pfaden verbunden, deren Enden so nah am Schnittpunkt liegen (mm) */
const TRIM_JOIN = 0.01;

/** Rahmen über alle Knoten und Anfasser (schnelle Vorauswahl, etwas größer als die Kurve selbst) */
function subsBox(subs: SubPath[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of subs)
    for (const n of sp.nodes)
      for (const p of [n, n.cin, n.cout]) {
        if (!p) continue;
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export class EditorPaths {
  separatePathIslands(this: Editor, options:IslandOptions={}): number {
    if (this.drag || this.draft || this.pickHandler) return 0;
    const plans = new Map<Obj, Obj[]>();
    try {
      if (!this.sel.length || this.sel.some(o=>!this.doc.objs.includes(o) || !this.selectable(o) ||
          this.layer(o.layer).locked || !this.layer(o.layer).show || o.shape.kind!=='path' || !!o.shape.mark))
        throw Error(t('Pfadinseln: bearbeitbare Pfade auswählen; Gruppen auflösen und parametrische Formen ausdrücklich umwandeln.'));
      for(const o of this.sel) {
        if(o.shape.kind!=='path') continue;
        const islands=pathIslandPlan(o.shape.subs,{...options,matrix:o.m}).groups;
        if(islands.length<2 && JSON.stringify(islands[0])===JSON.stringify(o.shape.subs)) continue;
        plans.set(o,islands.map((subs,i)=>({...o,id:i?newId():o.id,m:[...o.m],shape:{...o.shape,kind:'path',subs:structuredClone(subs)}} as Obj)));
      }
    } catch(error) { this.hint=error instanceof Error?error.message:String(error); this.emit('tool'); return 0; }
    if(!plans.size) { this.hint=t('Keine getrennten Pfadinseln gefunden.'); this.emit('tool'); return 0; }
    this.snapshot(t('Pfadinseln trennen'));
    this.doc.objs=this.doc.objs.flatMap(o=>plans.get(o)??[o]);
    this.setSel(this.sel.flatMap(o=>plans.get(o)??[o]));
    this.emit('doc');
    return [...plans.values()].reduce((n,p)=>n+p.length,0);
  }

  /** Pfad-Blätter der Auswahl samt Weltmatrix (Gruppen werden durchsucht, Texte und Bilder ausgelassen) */
  selPathLeaves(this: Editor): [Obj, Mat][] {
    return [...leaves(this.sel)].filter(([l]) => VECTOR.includes(l.shape.kind));
  }

  /** Pfade der Auswahl schließen (Close Path bzw. Close Selected Paths with Tolerance) */
  closeSel(this: Editor, tol = CLOSE_TOL, mode: 'line' | 'move' = 'line'): CloseStats {
    const st = this.closeStats(tol);
    if (!st.closed) {
      this.hint = st.open
        ? tn('{n} offener Pfad, Anfang und Ende liegen weiter als {tol} mm auseinander.', '{n} offene Pfade, Anfang und Ende liegen weiter als {tol} mm auseinander.', st.open, { tol: dec(String(tol)) })
        : t('Keine offenen Pfade in der Auswahl.');
      this.emit('tool');
      return st;
    }
    this.snapshot(t('Pfad schließen'));
    for (const [l, m] of this.selPathLeaves()) {
      if (l.shape.kind !== 'path') continue;
      // Abstand in Welt-mm prüfen, geschlossen wird in lokalen Koordinaten
      const subs = l.shape.subs;
      const world = transformSubs(subs, m);
      const hit = subs.filter((_, i) => closeSubs([copySub(world[i])], tol, mode).closed);
      if (hit.length && closeSubs(hit, Infinity, mode).closed) this.touch(l.shape);
    }
    this.hint = tn('{n} Pfad geschlossen', '{n} Pfade geschlossen', st.closed) + (st.open > st.closed ? tn(', {n} offen geblieben.|one', ', {n} offen geblieben.', st.open - st.closed) : '.');
    this.emit('doc');
    return st;
  }

  /** Wie viele offene Pfade der Auswahl sich mit dieser Toleranz schließen ließen (für den Dialog) */
  closeStats(this: Editor, tol: number): CloseStats {
    const st: CloseStats = { open: 0, closed: 0 };
    for (const [l, m] of this.selPathLeaves()) {
      if (l.shape.kind !== 'path') continue;
      // Abstände in Welt-mm messen
      const r = closeSubs(transformSubs(l.shape.subs, m), tol, 'line', false);
      st.open += r.open;
      st.closed += r.closed;
    }
    return st;
  }

  /** Offene Pfade der Auswahl verbinden, deren Enden höchstens tol auseinanderliegen (Auto-Join, Alt+J) */
  joinSel(this: Editor, tol = JOIN_TOL): number {
    const objs = this.sel.filter((o) => o.shape.kind === 'path');
    if (!objs.length) {
      this.hint = this.sel.some((o) => o.shape.kind === 'group') ? t('Gruppen erst auflösen (Ctrl+U), dann verbinden.') : t('Keine Pfade in der Auswahl.');
      this.emit('tool');
      return 0;
    }
    const all: SubPath[] = [],
      owner: number[] = [];
    objs.forEach((o, k) => {
      for (const sp of transformSubs(shapeSubs(o.shape), o.m)) {
        all.push(sp);
        owner.push(k);
      }
    });
    const r = joinSubs(all, tol);
    if (!r.joins) {
      this.hint = t('Keine Enden gefunden, die höchstens {tol} mm auseinanderliegen.', { tol: dec(String(tol)) });
      this.emit('tool');
      return 0;
    }
    this.snapshot(t('Pfade verbinden'));
    const res = this.mergeJoined(objs, r, owner);
    this.setSel([...new Set([...this.sel.filter((o) => this.doc.objs.includes(o)), ...res])]);
    this.hint = tn('{n} Verbindung hergestellt.', '{n} Verbindungen hergestellt.', r.joins);
    this.emit('doc');
    return r.joins;
  }

  /**
   * Ergebnis von joinSubs ins Dokument übernehmen: Objekte, deren Pfade verbunden wurden, werden zu einem
   * Pfadobjekt (in Weltkoordinaten) am Platz des hintersten; unbeteiligte bleiben unverändert.
   */
  mergeJoined(this: Editor, objs: Obj[], r: ReturnType<typeof joinSubs>, owner: number[]): Obj[] {
    // Objekte zusammenfassen, deren Teile in einem Ergebnis aufgehen (Union-Find)
    const parent = objs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const from of r.origin) for (const i of from.slice(1)) parent[find(owner[i])] = find(owner[from[0]]);
    const changed = new Set<number>();
    r.origin.forEach((from) => from.length > 1 && changed.add(find(owner[from[0]])));
    const out: Obj[] = [];
    for (const root of changed) {
      const members = objs.filter((_, i) => find(i) === root);
      const keep = members.reduce((a, b) => (this.doc.objs.indexOf(a) <= this.doc.objs.indexOf(b) ? a : b));
      const subs = r.subs.filter((_, k) => find(owner[r.origin[k][0]]) === root);
      keep.shape = { kind: 'path', subs };
      keep.m = IDENT;
      this.touch(keep.shape);
      this.doc.objs = this.doc.objs.filter((o) => o === keep || !members.includes(o));
      out.push(keep);
    }
    return out;
  }

  /** Auswahl in einzelne Geraden und Kurven zerlegen (Break Apart, Alt+B); Texte über ihre Konturen */
  async breakApartSel(this: Editor): Promise<number> {
    const tops = this.sel.filter((o) => o.shape.kind !== 'image');
    const outlines = new Map<Obj, SubPath[]>();
    for (const [leaf] of leaves(tops)) {
      if (leaf.shape.kind !== 'text') continue;
      const tx = leaf.shape;
      outlines.set(leaf, textToSubs(tx, (await loadFont(tx.font, tx.bold, tx.italic)).font));
    }
    const parts = new Map<Obj, Obj[]>();
    let count = 0;
    for (const top of tops) {
      const list: Obj[] = [];
      for (const [leaf, m] of leaves([top])) {
        if (leaf.shape.kind === 'image') continue;
        const subs = outlines.get(leaf) ?? shapeSubs(leaf.shape);
        for (const sp of subs)
          for (const p of breakApart(sp)) list.push({ id: newId(), m, layer: leaf.layer, shape: { kind: 'path', subs: [p] } });
      }
      count += list.length;
      parts.set(top, list);
    }
    if (count > MAX_COPIES) {
      this.hint = t('Zerlegen: zu viele Teile ({n}, höchstens {max}).', { n: count, max: MAX_COPIES });
      this.emit('tool');
      return 0;
    }
    if (![...parts.values()].some((l) => l.length > 1)) {
      this.hint = t('Nichts zu zerlegen: Pfade, Formen oder Texte auswählen.');
      this.emit('tool');
      return 0;
    }
    this.snapshot(t('Zerlegen'));
    const next: Obj[] = [];
    for (const o of this.doc.objs) next.push(...(parts.get(o) ?? [o]));
    this.doc.objs = next;
    const all = [...parts.values()].flat();
    this.setSel(all);
    this.hint = tn('In {n} Teil zerlegt.', 'In {n} Teile zerlegt.', count);
    this.emit('doc');
    return count;
  }

  /**
   * Ziele des Eckenwerkzeugs: im Knotenmodus die ausgewählten Knoten (bzw. der Knoten unter dem Mauszeiger),
   * sonst alle Knoten der ausgewählten Formen. Je Blatt: Weltmatrix und Knotenindizes je Unterpfad.
   */
  cornerTargets(this: Editor): { obj: Obj; m: Mat; idx: Map<number, number[]> }[] {
    if (this.tool === 'node') {
      return this.nodeTargets().flatMap((o) => {
        const idx = new Map<number, number[]>();
        for (const n of this.nodesToEdit(o)) idx.set(n.sub, [...(idx.get(n.sub) ?? []), n.idx]);
        return idx.size ? [{ obj: o, m: o.m, idx }] : [];
      });
    }
    return this.selPathLeaves().map(([obj, m]) => ({ obj, m, idx: new Map(shapeSubs(obj.shape).map((sp, i) => [i, sp.nodes.map((_, k) => k)])) }));
  }

  /** Wie viele Ecken das Eckenwerkzeug bearbeiten würde (für den Dialog) */
  cornerCount(this: Editor): number {
    let n = 0;
    for (const { obj, m, idx } of this.cornerTargets()) {
      const world = transformSubs(shapeSubs(obj.shape), m);
      for (const [i, ks] of idx) n += ks.filter((k) => isCorner(world[i], k)).length;
    }
    return n;
  }

  /**
   * Ecken runden ('round', Radius r), nach innen runden ('inverse', Bogen um die Ecke) oder fasen ('chamfer', Abstand r).
   * Wirkt auf die Ziele von cornerTargets(); r in Welt-mm. Liefert die Zahl der bearbeiteten Ecken.
   */
  cornerSel(this: Editor, mode: CornerMode, r: number): number {
    const targets = this.cornerTargets();
    if (!this.cornerCount()) {
      this.hint = this.tool === 'node' && this.nodeTarget()
        ? t('Erst Eckknoten auswählen (Klick, Shift+Klick oder Rahmen).')
        : t('Keine Ecken in der Auswahl: Pfade oder Formen mit Ecken auswählen.');
      this.emit('tool');
      return 0;
    }
    this.snapshot(mode === 'round' ? t('Ecken runden') : mode === 'inverse' ? t('Ecken innen runden') : t('Ecken fasen'));
    let done = 0,
      limited = 0;
    for (const { obj, m, idx } of targets) {
      this.convertObjToPath(obj);
      const subs = (obj.shape as { subs: SubPath[] }).subs;
      // In Welt-mm rechnen (Radius unabhängig von Skalierung), dann zurück in lokale Koordinaten
      const world = transformSubs(subs, m);
      let changed = false;
      for (const [i, ks] of idx) {
        const res = cornerSub(world[i], ks, mode, r);
        if (!res.done) continue;
        subs[i] = transformSubs([res.sub], inv(m))[0];
        done += res.done;
        limited += res.limited;
        changed = true;
      }
      if (changed) this.touch(obj.shape);
    }
    // Knotenindizes haben sich verschoben
    this.clearNodeSel();
    this.nodeHover = this.segHover = null;
    this.hint =
      (mode === 'round'
        ? tn('{n} Ecke gerundet', '{n} Ecken gerundet', done)
        : mode === 'inverse'
          ? tn('{n} Ecke innen gerundet', '{n} Ecken innen gerundet', done)
          : tn('{n} Ecke gefast', '{n} Ecken gefast', done)) +
      (limited ? tn(', {n} davon kleiner (Kanten zu kurz).|one', ', {n} davon kleiner (Kanten zu kurz).', limited) : '.');
    this.emit('doc');
    this.emit('sel');
    return done;
  }

  /** Laufrichtung der Auswahl umkehren (Startpunkt bleibt) */
  reverseSel(this: Editor) {
    const ls = this.selPathLeaves();
    if (!ls.length) return;
    this.snapshot(t('Richtung umkehren'));
    for (const [l] of ls) {
      this.convertObjToPath(l);
      for (const sp of (l.shape as { subs: SubPath[] }).subs) reverseSub(sp);
      this.touch(l.shape);
    }
    this.hint = t('Richtung umgekehrt.');
    this.emit('doc');
  }

  /** Objekte, deren Knoten das Startpunkt- und Trimm-Werkzeug anbieten (sichtbar, nicht gesperrt, oberste Ebene) */
  toolTargets(this: Editor): Obj[] {
    return this.doc.objs.filter((o) => !isOff(o) && this.selectable(o) && VECTOR.includes(o.shape.kind) && this.layer(o.layer).show);
  }

  updateStartHover(this: Editor, sx: number, sy: number) {
    const prev = this.startHover;
    this.startHover = null;
    let best = 8;
    // Ausgewählte Objekte haben Vorrang
    const cands = [...this.sel.filter((o) => VECTOR.includes(o.shape.kind)), ...this.toolTargets()];
    for (const o of cands) {
      shapeSubs(o.shape).forEach((sp, si) =>
        sp.nodes.forEach((n, ni) => {
          const q = this.toScreen(apply(o.m, n.x, n.y));
          const d = Math.hypot(q.x - sx, q.y - sy);
          if (d < best) {
            best = d;
            this.startHover = { obj: o, m: o.m, sub: si, idx: ni };
          }
        }),
      );
      if (this.startHover && this.sel.includes(o)) break;
    }
    // No node nearby: a point on an edge of a closed contour (open contours can only start at an end)
    if (!this.startHover) {
      const wp = this.toWorld(sx, sy);
      const tol = 7 / this.view.zoom;
      let edge: { o: Obj; sub: number; u: number; d: number } | null = null;
      for (const o of cands) {
        this.worldSubs(o).forEach((sp, si) => {
          if (!sp.closed || sp.nodes.length < 2) return;
          const b = subsBox([sp]);
          if (wp.x < b.x - tol || wp.x > b.x + b.w + tol || wp.y < b.y - tol || wp.y > b.y + b.h + tol) return;
          const r = nearestParam(sp, wp);
          if (r.d < tol && (!edge || r.d < edge.d)) edge = { o, sub: si, u: r.u, d: r.d };
        });
        if (edge && this.sel.includes(o)) break;
      }
      const e = edge as { o: Obj; sub: number; u: number } | null;
      if (e) this.startHover = { obj: e.o, m: e.o.m, sub: e.sub, idx: -1, u: e.u, pt: pointAt(this.worldSubs(e.o)[e.sub], e.u) };
    }
    const h = this.startHover as Editor['startHover'];
    this.canvas.style.cursor = h ? 'pointer' : 'crosshair';
    const moved = (a: NonNullable<Editor['startHover']>, b: NonNullable<Editor['startHover']>) =>
      a.obj !== b.obj || a.sub !== b.sub || a.idx !== b.idx || a.pt?.x !== b.pt?.x || a.pt?.y !== b.pt?.y;
    if (!h !== !prev || (h && prev && moved(h, prev))) this.redraw();
  }

  /**
   * Startpunkt auf einen Knoten legen. mode 'reverse' kehrt dabei die Richtung um, 'reset' gibt Startpunkt
   * und Richtung wieder der Optimierung frei. Grundformen werden zu Pfaden.
   * With u (path parameter of an edge) a new node is inserted there first and becomes the start point;
   * this only works on closed contours.
   */
  setStartPoint(this: Editor, o: Obj, sub: number, idx: number, mode: 'set' | 'reverse' | 'reset' = 'set', u?: number): boolean {
    const sp0 = shapeSubs(o.shape)[sub];
    if (!sp0) return false;
    const onEdge = u !== undefined && mode !== 'reset';
    if (mode !== 'reset' && !sp0.closed && (onEdge || (idx !== 0 && idx !== sp0.nodes.length - 1))) {
      this.hint = t('Offene Pfade beginnen an einem ihrer Enden.');
      this.emit('tool');
      return false;
    }
    this.snapshot(t('Startpunkt setzen'));
    this.convertObjToPath(o);
    const sp = (o.shape as { subs: SubPath[] }).subs[sub];
    if (onEdge) idx = splitAt(sp, u);
    if (mode === 'reset') {
      delete sp.start;
      this.hint = t('Startpunkt und Richtung wählt wieder die Optimierung.');
    } else {
      // offene Pfade: Shift beginnt am anderen Ende
      const target = !sp.closed && mode === 'reverse' ? (idx === 0 ? sp.nodes.length - 1 : 0) : idx;
      setStart(sp, target, sp.closed && mode === 'reverse');
      this.hint = mode === 'reverse' ? t('Startpunkt gesetzt, Richtung umgekehrt.') : t('Startpunkt gesetzt.');
    }
    this.touch(o.shape);
    if (!this.sel.includes(o)) this.setSel([o]);
    this.startHover = null;
    this.emit('doc');
    return true;
  }

  trimData(this: Editor) {
    if (!this.trimCache || this.trimCache.ver !== this.snapVer) this.trimCache = { ver: this.snapVer, world: new Map(), cuts: new Map() };
    return this.trimCache;
  }

  /** Weltkurven eines Objekts (zwischengespeichert, bis sich das Dokument ändert) */
  worldSubs(this: Editor, o: Obj): SubPath[] {
    const c = this.trimData();
    let w = c.world.get(o);
    if (!w) c.world.set(o, (w = transformSubs(shapeSubs(o.shape), o.m)));
    return w;
  }

  /** Schnittstellen von Unterpfad sub des Objekts o mit allen sichtbaren Kurven der Seite und mit sich selbst */
  trimCuts(this: Editor, o: Obj, sub: number): number[] {
    const c = this.trimData();
    const key = `${o.id}:${sub}`;
    const hit = c.cuts.get(key);
    if (hit) return hit;
    const target = this.worldSubs(o)[sub];
    const tb = subsBox([target]);
    const others: SubPath[] = [];
    this.worldSubs(o).forEach((sp, i) => i !== sub && others.push(sp));
    for (const [leaf, m] of visibleLeaves(this.doc.objs)) {
      if (leaf === o || leaf.shape.kind === 'image' || !this.layer(leaf.layer).show) continue;
      const subs = leaf.shape.kind === 'text' ? textOutline(leaf.shape)?.subs ?? [] : shapeSubs(leaf.shape);
      for (const sp of transformSubs(subs, m)) {
        const b = subsBox([sp]);
        if (b.x > tb.x + tb.w || tb.x > b.x + b.w || b.y > tb.y + tb.h || tb.y > b.y + b.h) continue;
        others.push(sp);
      }
    }
    const cuts = cutParams(target, others);
    c.cuts.set(key, cuts);
    return cuts;
  }

  /** Trimm-Abschnitt an Pfadparameter u von Unterpfad sub */
  trimAt(this: Editor, o: Obj, sub: number, u: number) {
    const sp = this.worldSubs(o)[sub];
    const span = trimSpan(sp, this.trimCuts(o, sub), u);
    return { obj: o, sub, span, piece: span ? extract(sp, span[0], span[1]) : sp };
  }

  updateTrimHover(this: Editor, sx: number, sy: number) {
    const prev = this.trimHover;
    const wp = this.toWorld(sx, sy);
    const tol = 7 / this.view.zoom;
    let best: { o: Obj; sub: number; u: number; d: number } | null = null;
    for (const o of this.toolTargets()) {
      this.worldSubs(o).forEach((sp, si) => {
        const b = subsBox([sp]);
        if (wp.x < b.x - tol || wp.x > b.x + b.w + tol || wp.y < b.y - tol || wp.y > b.y + b.h + tol) return;
        const r = nearestParam(sp, wp);
        if (r.d < tol && (!best || r.d < best.d)) best = { o, sub: si, u: r.u, d: r.d };
      });
    }
    const bb = best as { o: Obj; sub: number; u: number } | null;
    this.trimHover = bb ? this.trimAt(bb.o, bb.sub, bb.u) : null;
    this.canvas.style.cursor = this.trimHover ? 'pointer' : 'crosshair';
    const same = (a: Editor['trimHover'], b: Editor['trimHover']) =>
      a === b || (!!a && !!b && a.obj === b.obj && a.sub === b.sub && JSON.stringify(a.span) === JSON.stringify(b.span));
    if (!same(prev, this.trimHover)) this.redraw();
  }

  /**
   * Abschnitt entfernen (Trim). keepCopy: das entfernte Stück bleibt als eigenes Objekt auf dem aktuellen Layer (Shift).
   * Ohne noJoin werden die Reste an den Schnittpunkten mit anliegenden offenen Pfaden verbunden (wie LightBurn).
   */
  applyTrim(this: Editor, h: NonNullable<Editor['trimHover']>, opt: { keepCopy?: boolean; noJoin?: boolean } = {}) {
    const o = h.obj;
    if (!this.doc.objs.includes(o)) return;
    const world = transformSubs(shapeSubs(o.shape), o.m);
    const sp = world[h.sub];
    if (!sp) return;
    this.snapshot(t('Trimmen'));
    const r = trimSub(sp, h.span);
    const subs = [...world.slice(0, h.sub), ...r.kept, ...world.slice(h.sub + 1)];
    const extra: Obj[] = [];
    if (opt.keepCopy) extra.push({ id: newId(), m: IDENT, layer: this.currentLayer, shape: { kind: 'path', subs: [r.removed] } });
    let result: Obj | null = null;
    if (!subs.length) this.doc.objs = this.doc.objs.filter((x) => x !== o);
    else {
      o.shape = { kind: 'path', subs };
      o.m = IDENT;
      this.touch(o.shape);
      result = o;
      if (h.span && !opt.noJoin) {
        // Reste an den Schnittpunkten mit anliegenden offenen Pfaden verbinden
        const ends = [pointAt(sp, h.span[0]), pointAt(sp, h.span[1])];
        const near = (sp2: SubPath) =>
          !sp2.closed && sp2.nodes.length > 1 && [sp2.nodes[0], sp2.nodes[sp2.nodes.length - 1]].some((n) => ends.some((e) => Math.hypot(n.x - e.x, n.y - e.y) < TRIM_JOIN));
        const group = [o, ...this.doc.objs.filter((x) => x !== o && x.shape.kind === 'path' && this.selectable(x) && transformSubs(shapeSubs(x.shape), x.m).some(near))];
        const all: SubPath[] = [],
          owner: number[] = [];
        group.forEach((g, k) => transformSubs(shapeSubs(g.shape), g.m).forEach((s) => (all.push(s), owner.push(k))));
        const j = joinSubs(all, TRIM_JOIN);
        if (j.joins) result = this.mergeJoined(group, j, owner)[0] ?? o;
      }
    }
    if (extra.length) {
      this.doc.objs.push(...extra);
      this.hint = extra[0].layer === o.layer ? t('Entferntes Stück liegt auf demselben Layer wie die Form (anderen Layer wählen, damit es nicht mitgeschnitten wird).') : t('Entferntes Stück auf Layer {n} behalten.', { n: extra[0].layer + 1 });
    } else this.hint = TOOL_HINTS.trim;
    this.setSel(result && this.doc.objs.includes(result) ? [result] : this.sel.filter((x) => this.doc.objs.includes(x)));
    this.trimHover = null;
    this.emit('doc');
  }

  /** Für Agenten: Abschnitt an Weltpunkt p trimmen wie mit einem Klick im Trimm-Werkzeug. false = keine Kurve im Umkreis tol */
  trimAtPoint(this: Editor, p: Pt, tol: number, opt: { keepCopy?: boolean; noJoin?: boolean } = {}): boolean {
    let best: { o: Obj; sub: number; u: number; d: number } | null = null;
    for (const o of this.toolTargets())
      this.worldSubs(o).forEach((sp, si) => {
        const r = nearestParam(sp, p);
        if (r.d <= tol && (!best || r.d < best.d)) best = { o, sub: si, u: r.u, d: r.d };
      });
    const b = best as { o: Obj; sub: number; u: number } | null;
    if (!b) return false;
    this.applyTrim(this.trimAt(b.o, b.sub, b.u), opt);
    return true;
  }

  /**
   * Für Agenten: Startpunkt auf den Knoten von o legen, der Weltpunkt p am nächsten liegt.
   * onEdge: use the nearest point on an edge of a closed contour instead and insert a node there.
   */
  startAtPoint(this: Editor, o: Obj, p: Pt, mode: 'set' | 'reverse' | 'reset', onEdge = false): boolean {
    if (onEdge && mode !== 'reset') {
      let e = { sub: -1, u: 0, d: Infinity };
      transformSubs(shapeSubs(o.shape), o.m).forEach((sp, si) => {
        if (!sp.closed || sp.nodes.length < 2) return;
        const r = nearestParam(sp, p);
        if (r.d < e.d) e = { sub: si, u: r.u, d: r.d };
      });
      if (e.sub < 0) {
        this.hint = t('Offene Pfade beginnen an einem ihrer Enden.');
        return false;
      }
      return this.setStartPoint(o, e.sub, -1, mode, e.u);
    }
    let best = { sub: -1, idx: -1, d: Infinity };
    shapeSubs(o.shape).forEach((sp, si) =>
      sp.nodes.forEach((n, ni) => {
        const q = apply(o.m, n.x, n.y);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < best.d) best = { sub: si, idx: ni, d };
      }),
    );
    return best.sub >= 0 && this.setStartPoint(o, best.sub, best.idx, mode);
  }

  /** Knoteneditor, Taste T: Abschnitt der Kante unter dem Mauszeiger bis zu den nächsten Schnittpunkten entfernen */
  trimNodeSegment(this: Editor) {
    const o = this.nodeTarget();
    if (!o || !this.segHover || !this.doc.objs.includes(o)) {
      this.hint = t('Auf eine Kante zeigen, dann T zum Trimmen.');
      this.emit('tool');
      return;
    }
    const { sub, seg, t: tt } = this.segHover;
    this.applyTrim(this.trimAt(o, sub, seg + tt));
    this.nodeSel.clear();
    this.segHover = this.nodeHover = null;
  }

  /** Knoteneditor, Taste B: Pfad am Knoten unter dem Mauszeiger (oder am einzigen gewählten) aufbrechen */
  breakAtNodeKey(this: Editor) {
    if (this.nodeBatch(() => this.breakAtNodeKey())) return;
    const o = this.nodeTarget();
    if (!o) return;
    const targets = this.nodesToEdit(o);
    if (targets.length !== 1) {
      this.hint = t('Auf einen Knoten zeigen (oder genau einen wählen), dann B zum Aufbrechen.');
      this.emit('tool');
      return;
    }
    const { sub, idx } = targets[0];
    const parts = breakAtNode(shapeSubs(o.shape)[sub], idx);
    if (!parts) {
      this.hint = t('Am Ende eines offenen Pfads gibt es nichts aufzubrechen.');
      this.emit('tool');
      return;
    }
    this.snapshot(t('Pfad aufbrechen'));
    const subs = this.pathTarget()!;
    subs.splice(sub, 1, ...parts);
    this.nodeSel.clear();
    this.nodeHover = this.segHover = null;
    this.hint = t('Pfad am Knoten aufgebrochen.');
    this.touch(o.shape);
    this.emit('doc');
    this.emit('sel');
  }

  /** Startpfeile: blau = gesetzter Startpunkt, grau = Standard (Optimierung darf ihn verlegen) */
  drawStartPoints(this: Editor, ctx: CanvasRenderingContext2D, px: number) {
    const objs = new Set(this.sel.filter((o) => VECTOR.includes(o.shape.kind)));
    if (this.startHover) objs.add(this.startHover.obj);
    ctx.save();
    for (const o of objs) {
      shapeSubs(o.shape).forEach((sp, si) => {
        if (!sp.nodes.length) return;
        for (const [ni, n] of sp.nodes.entries()) {
          const q = apply(o.m, n.x, n.y);
          const hot = this.startHover?.obj === o && this.startHover.sub === si && this.startHover.idx === ni;
          const r = (hot ? 4.5 : 3) * px;
          ctx.fillStyle = hot ? SNAP_COLOR : this.dark ? '#24272d' : '#ffffff';
          ctx.strokeStyle = hot ? SNAP_COLOR : '#5a6470';
          ctx.lineWidth = px;
          ctx.fillRect(q.x - r, q.y - r, 2 * r, 2 * r);
          ctx.strokeRect(q.x - r, q.y - r, 2 * r, 2 * r);
        }
        // Edge under the pointer: a new start node would be inserted here
        const hv = this.startHover;
        if (hv?.obj === o && hv.sub === si && hv.pt) {
          const r = 4.5 * px;
          ctx.fillStyle = ctx.strokeStyle = SNAP_COLOR;
          ctx.lineWidth = px;
          ctx.beginPath();
          ctx.arc(hv.pt.x, hv.pt.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(hv.pt.x - r * 1.8, hv.pt.y);
          ctx.lineTo(hv.pt.x + r * 1.8, hv.pt.y);
          ctx.moveTo(hv.pt.x, hv.pt.y - r * 1.8);
          ctx.lineTo(hv.pt.x, hv.pt.y + r * 1.8);
          ctx.stroke();
        }
        // Richtung: erstes Stück des ersten Segments
        const sg = segments(sp)[0];
        if (!sg) return;
        const a = apply(o.m, sg.a.x, sg.a.y);
        const b0 = sg.curve ? bezierPt(sg.a, sg.c1, sg.c2, sg.b, 0.05) : sg.b;
        const b = apply(o.m, b0.x, b0.y);
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ux = (b.x - a.x) / l,
          uy = (b.y - a.y) / l;
        const len = 18 * px,
          w = 6 * px;
        const tip = { x: a.x + ux * len, y: a.y + uy * len };
        ctx.strokeStyle = ctx.fillStyle = sp.start ? '#2070ff' : '#8a9099';
        ctx.lineWidth = 2.5 * px;
        ctx.beginPath();
        ctx.arc(a.x, a.y, 5 * px, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(tip.x - ux * w, tip.y - uy * w);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - ux * w * 1.6 - uy * w, tip.y - uy * w * 1.6 + ux * w);
        ctx.lineTo(tip.x - ux * w * 1.6 + uy * w, tip.y - uy * w * 1.6 - ux * w);
        ctx.closePath();
        ctx.fill();
      });
    }
    ctx.restore();
  }

  /**
   * Mittelpunkte markieren: ein kleines Kreuz je Kreis, Ellipse, Vieleck und großem Bogen der Auswahl
   * (z. B. zum Ankörnen oder Bohren). Die Kreuze kommen als ein Pfad auf den aktuellen Layer.
   */
  markCentersSel(this: Editor): number {
    const subs: SubPath[] = [];
    const seen: Pt[] = [];
    for (const [l, m] of visibleLeaves(this.sel)) {
      if (l.shape.kind === 'text' || isOff(l)) continue;
      const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      for (const c of shapeCenters(l.shape, () => shapeSubs(l.shape))) {
        if (!shownMark(c)) continue;
        const q = apply(m, c.x, c.y);
        if (seen.some((p) => Math.hypot(p.x - q.x, p.y - q.y) < 0.01)) continue;
        seen.push(q);
        const r = Math.min(c.r ?? 5, c.ry ?? Infinity) * k;
        const a = Math.max(0.5, Math.min(3, r * 0.4));
        subs.push({ closed: false, nodes: [{ x: q.x - a, y: q.y }, { x: q.x + a, y: q.y }] });
        subs.push({ closed: false, nodes: [{ x: q.x, y: q.y - a }, { x: q.x, y: q.y + a }] });
      }
    }
    if (!subs.length) {
      this.hint = t('Keine Kreise, Ellipsen, Vielecke oder Bögen in der Auswahl.');
      this.emit('tool');
      return 0;
    }
    this.snapshot(t('Mittelpunkte markieren'));
    const o: Obj = { id: newId(), m: IDENT, layer: this.currentLayer, shape: { kind: 'path', subs } };
    this.doc.objs.push(o);
    this.setSel([o]);
    this.hint = tn('{n} Mittelpunkt markiert.', '{n} Mittelpunkte markiert.', subs.length / 2);
    this.emit('doc');
    return subs.length / 2;
  }
}
