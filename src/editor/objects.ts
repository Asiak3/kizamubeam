// Editor: Objekte-Fenster: Name, Sichtbarkeit, Sperre, Reihenfolge, Gruppen, Ausrichten, Layer.
import { IDENT, isOff, Layer, mul, newId, Obj, setLayerDeep, translate, visibleLeaves, homeLayer } from '../model';
import { Box, boundsOf } from '../geom';
import type { Editor } from '../editor';
import { t, tn } from '../i18n';

export class EditorObjects {
  /** Gesperrt: selbst oder alle sichtbaren Teile liegen auf gesperrten Layern */
  isLocked(this: Editor, top: Obj): boolean {
    if (top.locked) return true;
    let any = false;
    for (const [l] of visibleLeaves([top])) {
      if (!this.layer(l.layer).locked) return false;
      any = true;
    }
    return any;
  }
  /** Auf der Arbeitsfläche auswählbar: nicht gesperrt und etwas davon ist zu sehen */
  selectable(this: Editor, top: Obj): boolean {
    if (isOff(top) || this.isLocked(top)) return false;
    for (const [l] of visibleLeaves([top])) if (this.layer(l.layer).show) return true;
    return false;
  }
  /** Name, Sichtbarkeit oder Sperre eines Objekts (auch in Gruppen) ändern */
  setObjProps(this: Editor, objs: Obj[], patch: { name?: string; hidden?: boolean; locked?: boolean; noLaser?: boolean }) {
    if (!objs.length) return;
    this.snapshot(t('Objekt-Eigenschaften'));
    for (const o of objs) {
      if (patch.name !== undefined) {
        const n = patch.name.trim();
        if (n) o.name = n;
        else delete o.name;
      }
      if (patch.hidden !== undefined) {
        if (patch.hidden) o.hidden = true;
        else delete o.hidden;
      }
      if (patch.locked !== undefined) {
        if (patch.locked) o.locked = true;
        else delete o.locked;
      }
      if (patch.noLaser !== undefined) {
        if (patch.noLaser) o.noLaser = true;
        else delete o.noLaser;
      }
    }
    this.emit('doc');
    this.dropUnselectable();
  }
  /** Exclude the selection from lasering, or include it again (if every selected object is already excluded) */
  toggleNoLaser(this: Editor) {
    if (!this.sel.length) {
      this.hint = t('Erst Objekte auswählen.');
      this.emit('tool');
      return;
    }
    const off = !this.sel.every((o) => o.noLaser);
    this.setObjProps(this.sel, { noLaser: off });
    this.hint = off
      ? tn('{n} Objekt wird nicht gelasert.', '{n} Objekte werden nicht gelasert.', this.sel.length)
      : tn('{n} Objekt wird wieder gelasert.', '{n} Objekte werden wieder gelasert.', this.sel.length);
    this.emit('tool');
  }
  /** Ausgeblendete oder gesperrte Objekte aus der Auswahl nehmen */
  dropUnselectable(this: Editor) {
    const keep = this.sel.filter((o) => this.selectable(o));
    if (keep.length !== this.sel.length) this.setSel(keep);
    else this.emit('sel');
  }
  /**
   * Oberste Objekte in der Stapelreihenfolge verschieben: vor (front) oder hinter ein Bezugsobjekt,
   * ohne Bezug ganz nach vorn. Mit layer wechseln sie dabei auf diesen Layer.
   */
  moveObjects(this: Editor, objs: Obj[], ref: Obj | null, front: boolean, layer?: number) {
    const moving = this.doc.objs.filter((o) => objs.includes(o) && o !== ref);
    if (!moving.length) return;
    this.snapshot(t('Reihenfolge ändern'));
    const rest = this.doc.objs.filter((o) => !moving.includes(o));
    let at = rest.length;
    if (ref) {
      const k = rest.indexOf(ref);
      if (k >= 0) at = front ? k + 1 : k;
    }
    rest.splice(at, 0, ...moving);
    this.doc.objs = rest;
    if (layer !== undefined) {
      for (const o of moving) if (homeLayer(o) !== layer) setLayerDeep(o, layer);
      this.layer(layer);
    }
    this.emit('doc');
    this.emit('sel');
  }
  /** Layer i in der Ausgabereihenfolge vor (before) oder hinter ref setzen */
  placeLayer(this: Editor, i: number, ref: number, before: boolean) {
    if (i === ref) return;
    const order = this.layerOrder().filter((l) => l !== i);
    const k = order.indexOf(ref);
    if (k < 0) return;
    order.splice(before ? k : k + 1, 0, i);
    this.snapshot(t('Layer-Reihenfolge'));
    order.forEach((l, n) => (this.layer(l).priority = n));
    this.emit('doc');
  }

  group(this: Editor) {
    if (this.sel.length < 2) return;
    this.snapshot(t('Gruppieren'));
    const members = this.doc.objs.filter((o) => this.sel.includes(o));
    const idx = this.doc.objs.indexOf(members[members.length - 1]);
    const g: Obj = { id: newId(), m: IDENT, layer: members[0].layer, shape: { kind: 'group', children: members } };
    this.doc.objs.splice(idx + 1, 0, g);
    this.doc.objs = this.doc.objs.filter((o) => !members.includes(o));
    this.setSel([g]);
    this.emit('doc');
  }
  ungroup(this: Editor) {
    const groups = this.sel.filter((o) => o.shape.kind === 'group');
    if (!groups.length) return;
    this.snapshot(t('Gruppierung aufheben'));
    const out: Obj[] = [];
    for (const g of groups) {
      const kids = (g.shape as { children: Obj[] }).children;
      kids.forEach((k) => (k.m = mul(g.m, k.m)));
      const i = this.doc.objs.indexOf(g);
      this.doc.objs.splice(i, 1, ...kids);
      out.push(...kids);
    }
    this.setSel([...this.sel.filter((o) => !groups.includes(o)), ...out]);
    this.emit('doc');
  }
  align(this: Editor, how: 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter') {
    if (this.sel.length < 2) return;
    const B = this.selBounds()!;
    this.snapshot(t('Ausrichten'));
    for (const o of this.sel) {
      const b = boundsOf([o])!;
      let dx = 0,
        dy = 0;
      if (how === 'left') dx = B.x - b.x;
      if (how === 'right') dx = B.x + B.w - (b.x + b.w);
      if (how === 'top') dy = B.y - b.y;
      if (how === 'bottom') dy = B.y + B.h - (b.y + b.h);
      if (how === 'hcenter') dx = B.x + B.w / 2 - (b.x + b.w / 2);
      if (how === 'vcenter') dy = B.y + B.h / 2 - (b.y + b.h / 2);
      o.m = mul(translate(dx, dy), o.m);
    }
    this.emit('doc');
    this.emit('sel');
  }
  distribute(this: Editor, horizontal: boolean) {
    if (this.sel.length < 3) return;
    this.snapshot(t('Verteilen'));
    const items = this.sel.map((o) => ({ o, b: boundsOf([o])! }));
    const key = (b: Box) => (horizontal ? b.x + b.w / 2 : b.y + b.h / 2);
    items.sort((p, q) => key(p.b) - key(q.b));
    const first = key(items[0].b),
      last = key(items[items.length - 1].b);
    items.forEach(({ o, b }, i) => {
      const target = first + ((last - first) * i) / (items.length - 1);
      const d = target - key(b);
      o.m = mul(horizontal ? translate(d, 0) : translate(0, d), o.m);
    });
    this.emit('doc');
    this.emit('sel');
  }
  /** Klick auf eine Palettenfarbe */
  assignLayer(this: Editor, i: number) {
    this.currentLayer = i;
    this.activeLayer = i;
    if (this.sel.length) {
      this.snapshot(t('Layer zuweisen'));
      this.sel.forEach((o) => setLayerDeep(o, i));
      this.emit('doc');
    }
    this.layer(i);
    this.emit('sel');
  }
  updateLayer(this: Editor, i: number, patch: Partial<Layer>) {
    this.snapshot(t('Layer-Einstellungen'));
    Object.assign(this.layer(i), patch);
    this.emit('doc');
  }
  moveLayer(this: Editor, i: number, dir: -1 | 1) {
    // Reihenfolge der Layer = Reihenfolge der Ausgabe; im Prototyp über ein Prioritätsfeld
    const used = this.usedLayers();
    const order = used.sort((a, b) => (this.layer(a).priority ?? a) - (this.layer(b).priority ?? b));
    const k = order.indexOf(i);
    const j = k + dir;
    if (k < 0 || j < 0 || j >= order.length) return;
    this.snapshot(t('Layer-Reihenfolge'));
    [order[k], order[j]] = [order[j], order[k]];
    order.forEach((l, n) => (this.layer(l).priority = n));
    this.emit('doc');
  }
  layerOrder(this: Editor): number[] {
    return this.usedLayers().sort((a, b) => (this.layer(a).priority ?? a + 100) - (this.layer(b).priority ?? b + 100));
  }
}
