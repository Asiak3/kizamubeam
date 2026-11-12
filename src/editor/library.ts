// Editor: Bibliothek (Motive, Bilder, Designelemente): Auswahl als Eintrag aufbereiten und Einträge einfügen.
import { clone, cloneObjs, IDENT, isOff, leaves, mul, newId, Obj, Pt, setLayerDeep, translate } from '../model';
import { boundsOf } from '../geom';
import { assetUrl, registerAsset, thumbnailUrl } from '../images';
import { objsPreviewSvg } from '../files';
import { AssetCategory, AssetData, guessCategory } from '../assetFormat';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { RULER } from './shared';

/** Formeln, Bedingungen, Ausblenden und Sperren gehören zum Projekt, nicht zum Eintrag */
function strip(o: Obj) {
  delete o.bind;
  delete o.showIf;
  delete o.hidden;
  delete o.locked;
  if (o.shape.kind === 'gen') delete o.shape.bind;
  if (o.shape.kind === 'group') {
    o.shape.children = o.shape.children.filter((c) => !isOff(c));
    o.shape.children.forEach(strip);
  }
}

export class EditorLibrary {
  /**
   * Objekte (z. B. die Auswahl) als Bibliotheks-Eintrag: Kopie ohne ausgeblendete Teile, Rahmen bei (0, 0),
   * Bilddaten und eine kleine Vorschau dazu. null, wenn nichts Sichtbares übrig bleibt.
   */
  assetFromObjs(this: Editor, objs: Obj[], name: string, category?: AssetCategory, tags: string[] = []): AssetData | null {
    const list = clone(objs.filter((o) => !isOff(o)));
    list.forEach(strip);
    const visible = list.filter((o) => o.shape.kind !== 'group' || o.shape.children.length);
    const b = boundsOf(visible);
    if (!b) return null;
    for (const o of visible) o.m = mul(translate(-b.x, -b.y), o.m);
    const images: Record<string, string> = {};
    const thumbs: Record<string, string> = {};
    const layers = new Set<number>();
    for (const [leaf] of leaves(visible)) {
      layers.add(leaf.layer);
      if (leaf.shape.kind !== 'image') continue;
      const id = leaf.shape.asset;
      const url = assetUrl(id);
      if (!url) continue;
      images[id] = url;
      const th = thumbnailUrl(id);
      if (th) thumbs[id] = th;
    }
    const fill = [...layers].filter((i) => this.layer(i).mode === 'fill');
    const style = (i: number) => ({ show: true, fill: fill.includes(i) });
    return {
      name: name.trim() || t('Eintrag'),
      category: category ?? guessCategory(visible),
      tags,
      w: b.w,
      h: b.h,
      preview: objsPreviewSvg(visible, style, thumbs),
      objs: visible,
      images,
      ...(fill.length ? { fill } : {}),
    };
  }

  /**
   * Eintrag einfügen, mittig an at (Welt) bzw. mitten in der sichtbaren Fläche. Mehrere Objekte werden eine
   * Gruppe. Liegt alles auf einem Layer, kommt es auf den aktuellen Layer; sonst behalten die Teile ihre Layer.
   */
  insertAsset(this: Editor, a: AssetData, at?: Pt): Obj | null {
    for (const [id, url] of Object.entries(a.images)) registerAsset(id, url);
    const objs = cloneObjs(a.objs);
    if (!objs.length) return null;
    const layers = new Set<number>();
    for (const [leaf] of leaves(objs)) layers.add(leaf.layer);
    if (layers.size === 1) {
      objs.forEach((o) => setLayerDeep(o, this.currentLayer));
      layers.clear();
      layers.add(this.currentLayer);
    }
    let o = objs[0];
    if (objs.length > 1) o = { id: newId(), m: IDENT, layer: [...layers][0], shape: { kind: 'group', children: objs } };
    if (a.name && !o.name) o.name = a.name;
    const b = boundsOf([o]);
    if (!b) return null;
    let c = at ?? this.toWorld(RULER + (this.w - RULER) / 2, RULER + (this.h - RULER) / 2);
    const bed = this.doc.bed;
    if (!at && (c.x < 0 || c.y < 0 || c.x > bed.w || c.y > bed.h)) c = { x: bed.w / 2, y: bed.h / 2 };
    o.m = mul(translate(c.x - (b.x + b.w / 2), c.y - (b.y + b.h / 2)), o.m);
    this.snapshot(t('Aus Bibliothek einfügen'));
    for (const [leaf] of leaves([o])) {
      if (leaf.shape.kind === 'image') this.imgLayer(leaf.layer);
      else this.layer(leaf.layer);
    }
    this.doc.objs.push(o);
    if (!this.agentCall) this.setTool('select');
    this.setSel([o]);
    this.hint = t('„{name}“ aus der Bibliothek eingefügt.', { name: a.name });
    this.emit('doc');
    return o;
  }
}
