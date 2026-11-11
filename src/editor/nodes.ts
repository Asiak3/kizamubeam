// Editor: Knotenbearbeitung.
import { apply, defaultLayer, inv, isOff, Node, Obj, Pt, SubPath } from '../model';
import { segments, shapeSubs } from '../geom';
import { t, tn } from '../i18n';
import type { Editor } from '../editor';
import { transformSubs } from '../importers';
import { nearestParam } from '../pathtools';

export class EditorNodes {
  nodeTargets(this: Editor): Obj[] {
    return this.sel.filter((o) => this.doc.objs.includes(o) && this.selectable(o) && !o.locked && !isOff(o) &&
      !(this.doc.layers[o.layer] ?? defaultLayer(o.layer)).locked && (this.doc.layers[o.layer] ?? defaultLayer(o.layer)).show &&
      ['path', 'rect', 'ellipse', 'polygon'].includes(o.shape.kind) && o.m.every(Number.isFinite) &&
      Math.abs(o.m[0] * o.m[3] - o.m[1] * o.m[2]) > 1e-12);
  }

  nodeTarget(this: Editor): Obj | null {
    const targets = this.nodeTargets();
    if (this.nodeEditObj) return targets.includes(this.nodeEditObj) ? this.nodeEditObj : null;
    const hover = this.nodeHover?.obj ?? this.segHover?.obj;
    return hover && targets.includes(hover) ? hover : targets[0] ?? null;
  }

  nodeBatch(this: Editor, action: () => void): boolean {
    if (this.nodeEditObj) return false;
    const targets = this.nodeTargets();
    if (!targets.length) return true;
    const chosen = targets.filter((o) => this.selectedNodes(o).length || this.segmentSelection(o).size || this.selectedHandles(o).length);
    if (!chosen.length) { const o = this.nodeTarget(); if (o) chosen.push(o); }
    const before = this.state(), redo = this.history.saveRedo(), batching = this.batching;
    this.snapshot(t('Pfadkomponenten bearbeiten')); this.batching = true;
    try { for (const o of chosen) { this.nodeEditObj = o; action(); } }
    finally {
      this.nodeEditObj = null; this.batching = batching;
      if (!batching && this.state() === before) { this.history.drop(); this.history.restoreRedo(redo); }
    }
    return true;
  }

  segmentSelection(this: Editor, o: Obj): Set<string> {
    let set = this.segmentSets.get(o);
    if (!set) this.segmentSets.set(o, set = new Set());
    return set;
  }

  updateNodeHover(this: Editor, sx: number, sy: number) {
    const prevN = JSON.stringify(this.nodeHover),
      prevS = JSON.stringify(this.segHover);
    this.nodeHover = this.segHover = null;
    let best = 7;
    for (const o of this.nodeTargets()) {
      const subs = shapeSubs(o.shape);
      const scr = (p: Pt) => this.toScreen(apply(o.m, p.x, p.y));
      subs.forEach((sp, si) =>
        sp.nodes.forEach((n, ni) => {
          for (const which of ['p', 'cin', 'cout'] as const) {
            const p = which === 'p' ? n : n[which];
            if (!p) continue;
            const q = scr(p);
            const dd = Math.hypot(q.x - sx, q.y - sy) - (which === 'p' ? 1 : 0);
            if (dd < best) {
              best = dd;
              this.nodeHover = { obj: o, sub: si, idx: ni, which };
            }
          }
        }),
      );
    }
    if (!this.nodeHover) {
      let bestS = 6;
      for (const o of this.nodeTargets()) {
        const z = this.view.zoom, m = o.m;
        const subs = transformSubs(shapeSubs(o.shape), [m[0] * z, m[1] * z, m[2] * z, m[3] * z,
          m[4] * z + this.view.ox, m[5] * z + this.view.oy]);
        subs.forEach((sp, sub) => {
          const n = segments(sp).length;
          if (!n) return;
          const hit = nearestParam(sp, { x: sx, y: sy });
          if (hit.d < bestS) {
            bestS = hit.d;
            const seg = Math.min(n - 1, Math.floor(hit.u));
            this.segHover = { obj: o, sub, seg, t: hit.u - seg };
          }
        });
      }
    }
    this.canvas.style.cursor = this.nodeHover ? 'move' : this.segHover ? 'pointer' : 'crosshair';
    if (prevN !== JSON.stringify(this.nodeHover) || prevS !== JSON.stringify(this.segHover)) this.redraw();
  }

  pathTarget(this: Editor): SubPath[] | null {
    const o = this.nodeTarget();
    if (!o) return null;
    this.convertObjToPath(o);
    return (o.shape as { subs: SubPath[] }).subs;
  }

  /** Knotenauswahl des Ziels; wechselt das Ziel, beginnt sie leer. */
  nodeSelection(this: Editor, o: Obj | null): Set<string> {
    if (!o) return new Set();
    let set = this.nodeSets.get(o);
    if (!set) this.nodeSets.set(o, set = new Set());
    this.nodeSel = set; this.nodeSelObj = o;
    return this.nodeSel;
  }

  /** Ausgewählte Knoten (nur gültige Indizes) */
  selectedNodes(this: Editor, o?: Obj | null): { obj: Obj; sub: number; idx: number }[] {
    if (o === undefined) return this.nodeTargets().flatMap((target) => this.selectedNodes(target));
    if (!o) return [];
    const subs = shapeSubs(o.shape);
    return [...this.nodeSelection(o)]
      .map((k) => k.split(':').map(Number))
      .filter(([s, i]) => Number.isInteger(s) && Number.isInteger(i) && subs[s] && i >= 0 && i < subs[s].nodes.length)
      .map(([sub, idx]) => ({ obj: o, sub, idx }));
  }

  selectAllNodes(this: Editor) {
    this.segmentSets.clear();
    for (const o of this.nodeTargets()) {
      const sel = this.nodeSelection(o);
      shapeSubs(o.shape).forEach((sp, si) => sp.nodes.forEach((_, ni) => sel.add(`${si}:${ni}`)));
    }
    this.emit('sel');
  }

  clearNodeSel(this: Editor) {
    this.nodeSets.clear(); this.segmentSets.clear(); this.handleSets.clear(); this.nodeSel.clear(); this.nodeSelObj = null;
    this.emit('sel');
  }

  /** Knoten, auf die ein Knotenbefehl wirkt: Auswahl, sonst der Knoten unter dem Mauszeiger */
  nodesToEdit(this: Editor, o: Obj): { sub: number; idx: number }[] {
    const sel = this.selectedNodes(o);
    if (sel.length) return sel;
    return this.nodeHover && (!this.nodeHover.obj || this.nodeHover.obj === o) && this.nodeHover.which === 'p' ? [{ sub: this.nodeHover.sub, idx: this.nodeHover.idx }] : [];
  }

  /** Segmente, auf die ein Segmentbefehl wirkt: zwischen zwei ausgewählten Knoten, sonst die Kante unter dem Mauszeiger */
  segmentsToEdit(this: Editor, o: Obj) {
    const subs = shapeSubs(o.shape);
    const sel = this.nodeSelection(o);
    const out: { sub: number; seg: number; curve: boolean }[] = [];
    const picked = this.segmentSelection(o);
    if (picked.size) {
      subs.forEach((sp, sub) => segments(sp).forEach((sg, seg) => {
        if (picked.has(`${sub}:${seg}`)) out.push({ sub, seg, curve: sg.curve });
      }));
      return out;
    }
    if (sel.size >= 2)
      subs.forEach((sp, si) =>
        segments(sp).forEach((sg, gi) => {
          if (sel.has(`${si}:${sg.ia}`) && sel.has(`${si}:${sg.ib}`)) out.push({ sub: si, seg: gi, curve: sg.curve });
        }),
      );
    if (!out.length && this.segHover && (!this.segHover.obj || this.segHover.obj === o)) {
      const { sub, seg } = this.segHover;
      out.push({ sub, seg, curve: segments(subs[sub])[seg].curve });
    }
    return out;
  }

  /** Ausgewählte Knoten löschen (oder den Knoten/Anfasser unter dem Mauszeiger) */
  deleteNodes(this: Editor) {
    if (this.nodeBatch(() => this.deleteNodes())) return;
    const o = this.nodeTarget();
    if (!o) return;
    if (this.segmentSelection(o).size) { this.deleteSelectedSegments(o); return; }
    const h = this.nodeHover;
    const pickedHandles=this.selectedHandles(o);
    const handle = !this.selectedNodes(o).length && !pickedHandles.length && h && (!h.obj || h.obj === o) && h.which !== 'p' ? h : null;
    const targets = handle ? [] : this.nodesToEdit(o);
    if (!handle && !targets.length && !pickedHandles.length) {
      this.hint = t('Erst Knoten auswählen (Klick, Shift+Klick oder Rahmen).');
      this.emit('tool');
      return;
    }
    this.snapshot(t('Knoten löschen'));
    const subs = this.pathTarget()!;
    for(const picked of pickedHandles){const node=subs[picked.sub].nodes[picked.idx];delete node[picked.which];node.smooth=false}
    this.handleSets.delete(o);
    if (handle) {
      const n = subs[handle.sub].nodes[handle.idx];
      delete n[handle.which as 'cin' | 'cout'];
      n.smooth = false;
    } else {
      // von hinten nach vorn entfernen, damit die Indizes gültig bleiben
      targets.sort((a, b) => b.sub - a.sub || b.idx - a.idx);
      for (const t of targets) subs[t.sub].nodes.splice(t.idx, 1);
      for (let i = subs.length - 1; i >= 0; i--) {
        const sp = subs[i];
        if (sp.nodes.length < 2) subs.splice(i, 1);
        else if (sp.closed && sp.nodes.length < 3) sp.closed = false;
      }
    }
    this.nodeSel.clear();
    this.nodeHover = this.segHover = null;
    if (!subs.length) {
      this.doc.objs = this.doc.objs.filter((x) => x !== o);
      this.setSel(this.sel.filter((x) => x !== o));
    }
    this.touch(o.shape);
    this.emit('doc');
    this.emit('sel');
  }

  insertNode(this: Editor) {
    const o = this.nodeTarget();
    const h = this.segHover;
    if (!o || !h) return;
    this.snapshot(t('Knoten einfügen'));
    const sp = this.pathTarget()![h.sub];
    const sg = segments(sp)[h.seg];
    const u = h.t;
    const lerp = (p: Pt, q: Pt) => ({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u });
    let n: Node;
    if (sg.curve) {
      const p01 = lerp(sg.a, sg.c1), p12 = lerp(sg.c1, sg.c2), p23 = lerp(sg.c2, sg.b);
      const p012 = lerp(p01, p12), p123 = lerp(p12, p23), p = lerp(p012, p123);
      sg.a.cout = p01;
      sg.b.cin = p23;
      n = { x: p.x, y: p.y, cin: p012, cout: p123, smooth: true };
    } else n = lerp(sg.a, sg.b);
    sp.nodes.splice(sg.ia + 1, 0, n);
    this.segHover = null;
    // Indizes haben sich verschoben: der neue Knoten ist ausgewählt
    const sel = this.nodeSelection(o);
    sel.clear();
    sel.add(`${h.sub}:${sg.ia + 1}`);
    this.segmentSets.delete(o);
    this.touch(o.shape);
    this.emit('doc');
    this.emit('sel');
  }

  /** Segmente in Geraden (curve = false) oder Kurven umwandeln */
  setSegmentType(this: Editor, curve: boolean) {
    if (this.nodeBatch(() => this.setSegmentType(curve))) return;
    const o = this.nodeTarget();
    if (!o) return;
    const segs = this.segmentsToEdit(o).filter((sg) => sg.curve !== curve);
    if (!segs.length) {
      this.hint = this.segmentsToEdit(o).length
        ? curve ? t('Segment ist schon eine Kurve.') : t('Segment ist schon eine Gerade.')
        : t('Zwei benachbarte Knoten auswählen oder auf eine Kante zeigen.');
      this.emit('tool');
      return;
    }
    this.snapshot(t('Segmenttyp ändern'));
    // Umwandeln in einen Pfad erhält die Reihenfolge der Knoten, die Indizes bleiben gültig
    const subs = this.pathTarget()!;
    for (const s of segs) {
      const sg = segments(subs[s.sub])[s.seg];
      if (curve) {
        const dx = (sg.b.x - sg.a.x) / 3,
          dy = (sg.b.y - sg.a.y) / 3;
        sg.a.cout = { x: sg.a.x + dx, y: sg.a.y + dy };
        sg.b.cin = { x: sg.b.x - dx, y: sg.b.y - dy };
      } else {
        delete sg.a.cout;
        delete sg.b.cin;
      }
      sg.a.smooth = false;
      sg.b.smooth = false;
    }
    this.hint = curve
      ? tn('{n} Segment in Kurve umgewandelt.', '{n} Segmente in Kurven umgewandelt.', segs.length)
      : tn('{n} Segment in Gerade umgewandelt.', '{n} Segmente in Geraden umgewandelt.', segs.length);
    this.touch(o.shape);
    this.emit('doc');
    this.emit('tool');
  }

  /** Knoten zu Ecke (ohne Anfasser) oder glattem Knoten machen */
  setNodeType(this: Editor, smooth: boolean) {
    if (this.nodeBatch(() => this.setNodeType(smooth))) return;
    const o = this.nodeTarget();
    if (!o) return;
    const targets = this.nodesToEdit(o);
    if (!targets.length) {
      this.hint = t('Erst Knoten auswählen (Klick, Shift+Klick oder Rahmen).');
      this.emit('tool');
      return;
    }
    this.snapshot(t('Knotentyp ändern'));
    const subs = this.pathTarget()!;
    for (const h of targets) {
      const sp = subs[h.sub];
      const n = sp.nodes[h.idx];
      if (!smooth) {
        delete n.cin;
        delete n.cout;
        n.smooth = false;
        continue;
      }
      const N = sp.nodes.length;
      const prev = h.idx > 0 ? sp.nodes[h.idx - 1] : sp.closed ? sp.nodes[N - 1] : null;
      const next = h.idx < N - 1 ? sp.nodes[h.idx + 1] : sp.closed ? sp.nodes[0] : null;
      const a = prev ?? n,
        b = next ?? n;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        l = Math.hypot(dx, dy) || 1;
      const ux = dx / l,
        uy = dy / l;
      if (prev) {
        const lp = Math.hypot(n.x - prev.x, n.y - prev.y) / 3;
        n.cin = { x: n.x - ux * lp, y: n.y - uy * lp };
      }
      if (next) {
        const ln = Math.hypot(next.x - n.x, next.y - n.y) / 3;
        n.cout = { x: n.x + ux * ln, y: n.y + uy * ln };
      }
      n.smooth = true;
    }
    this.touch(o.shape);
    this.emit('doc');
  }

  /** Ausgewählte Knoten mit den Pfeiltasten verschieben (Weltabstand in mm) */
  nudgeNodes(this: Editor, dx: number, dy: number) {
    if (!this.nodeEditObj) {
      if (!this.selectedNodes().length && !this.selectedHandles().length && !this.nodeTargets().some((o) => this.segmentSelection(o).size)) return false;
      this.nodeBatch(() => { this.nudgeNodes(dx, dy); }); return true;
    }
    const o = this.nodeTarget();
    const targets = o ? this.movingNodes(o) : [];
    if (!o || (!targets.length && !this.selectedHandles(o).length)) return false;
    this.snapshot(t('Knoten verschieben'));
    const subs = this.pathTarget()!;
    const im = inv(o.m);
    const p0 = apply(im, 0, 0),
      p1 = apply(im, dx, dy);
    const lx = p1.x - p0.x,
      ly = p1.y - p0.y;
    const sh = (p?: Pt) => p && ((p.x += lx), (p.y += ly));
    for(const h of this.selectedHandles(o))if(!targets.some(n=>n.sub===h.sub&&n.idx===h.idx)){
      const node=subs[h.sub].nodes[h.idx];sh(node[h.which]);node.smooth=false;
    }
    for (const t of targets) {
      const n = subs[t.sub].nodes[t.idx];
      n.x += lx;
      n.y += ly;
      sh(n.cin);
      sh(n.cout);
    }
    this.touch(o.shape);
    this.emit('doc');
    return true;
  }

  movingNodes(this: Editor, o: Obj): { obj: Obj; sub: number; idx: number }[] {
    const set = new Set(this.selectedNodes(o).map((n) => `${n.sub}:${n.idx}`));
    const subs = shapeSubs(o.shape);
    for (const key of this.segmentSelection(o)) {
      const [s, i] = key.split(':').map(Number), sg = subs[s] && segments(subs[s])[i];
      if (sg) { set.add(`${s}:${sg.ia}`); set.add(`${s}:${sg.ib}`); }
    }
    return [...set].map((key) => { const [sub, idx] = key.split(':').map(Number); return { obj: o, sub, idx }; });
  }

  /** Delete edges, splitting surviving runs rather than bridging the gap. */
  deleteSelectedSegments(this: Editor, o: Obj) {
    const picked = this.segmentSelection(o), output: SubPath[] = [];
    const nodes = this.nodeSelection(o);
    const sources = shapeSubs(o.shape);
    for (let si = 0; si < sources.length; si++) {
      const sp = sources[si], edges = segments(sp);
      const removed = edges.map((_, i) => picked.has(`${si}:${i}`));
      if (!removed.some(Boolean)) {
        const keep = sp.nodes.filter((_, i) => !nodes.has(`${si}:${i}`));
        if (keep.length >= 2) output.push({ ...structuredClone(sp), nodes: structuredClone(keep), closed: sp.closed && keep.length >= 3 });
        continue;
      }
      let run: Node[] = [];
      const indices = new Map(sp.nodes.map((n, i) => [n, i]));
      const flush = () => {
        const kept = structuredClone(run.filter((n) => !nodes.has(`${si}:${indices.get(n)}`)));
        if (kept.length >= 2) { delete kept[0].cin; delete kept[kept.length - 1].cout; output.push({ nodes: kept, closed: false }); }
        run = [];
      };
      const start = sp.closed ? (removed.findIndex(Boolean) + 1) % edges.length : 0;
      for (let k = 0; k < edges.length; k++) {
        const i = (start + k) % edges.length, sg = edges[i];
        if (removed[i]) { flush(); continue; }
        if (!run.length) run.push(sg.a);
        run.push(sg.b);
      }
      flush();
    }
    this.snapshot(t('Ausgewählte Segmente löschen'));
    if (output.length) { o.shape = o.shape.kind === 'path' ? { ...o.shape, subs: output } : { kind: 'path', subs: output }; this.touch(o.shape); }
    else { this.doc.objs = this.doc.objs.filter((x) => x !== o); this.setSel(this.sel.filter((x) => x !== o)); }
    this.nodeSets.delete(o); this.segmentSets.delete(o); this.nodeHover = this.segHover = null;
    this.emit('doc'); this.emit('sel');
  }
}
