// Editor: Bilder und Import.
import { allObjs, DEFAULT_ADJUST, IDENT, ImageAdjust, ImageLayer, ImageShape, inv, leaves, Mat, mul, newId, Obj, Pt, SubPath, translate } from '../model';
import { addAsset, adjustedGray, assetImage, registerAsset, sourceSize } from '../images';
import type { LbrnResult } from '../lbrn';
import { ImportResult, transformSubs } from '../importers';
import { traceGray, TraceOptions } from '../trace';
import { backgroundAlpha, BgOptions, opaqueBounds } from '../bgremove';
import { centerlineGray } from '../centerline';
import { bezierPt, boundsOf, segments, shapeSubs, subsToPath2D, textOutline } from '../geom';
import { dec, t, tn } from '../i18n';
import type { Editor } from '../editor';

export class EditorImages {
  selImages(this: Editor): Obj[] {
    return this.sel.filter((o) => o.shape.kind === 'image');
  }
  /** Bild-Einstellungen eines Layers ändern (live ohne Undo-Schritt, wenn snapshot = false) */
  updateImgLayer(this: Editor, i: number, patch: Partial<ImageLayer>, snapshot = true) {
    if (snapshot) this.snapshot(t('Bild-Einstellungen'));
    Object.assign(this.imgLayer(i), patch);
    this.emit('doc');
  }
  /** Bildanpassungen setzen (live ohne Undo-Schritt, wenn snapshot = false) */
  setImageAdjust(this: Editor, objs: Obj[], patch: Partial<ImageAdjust>, snapshot = true) {
    if (!objs.length) return;
    if (snapshot) this.snapshot(t('Bild anpassen'));
    for (const o of objs) if (o.shape.kind === 'image') o.shape.adjust = { ...o.shape.adjust, ...patch };
    this.emit('doc');
  }

  /**
   * Bild mit den übrigen gewählten Formen zuschneiden (auf deren Rahmen) oder maskieren (nur das Innere der
   * geschlossenen Formen bleibt, der Rest wird transparent und damit nicht gelasert), wie in LightBurn.
   * Das Bild bekommt neue Bilddaten in Originalauflösung und bleibt an seiner Stelle; die Formen werden entfernt,
   * damit sie nicht versehentlich mitgeschnitten werden. Ein Undo-Schritt.
   */
  async cropImageSel(this: Editor, mask: boolean) {
    const imgs = this.selImages();
    const shapes = this.sel.filter((o) => o.shape.kind !== 'image');
    const say = (msg: string) => {
      this.hint = msg;
      this.emit('tool');
    };
    if (imgs.length !== 1 || !shapes.length)
      return say(mask ? t('Für die Maske ein Bild und eine oder mehrere geschlossene Formen auswählen.') : t('Zum Zuschneiden ein Bild und eine Form darüber auswählen.'));
    const o = imgs[0],
      s = o.shape as ImageShape;
    const img = assetImage(s.asset),
      src = sourceSize(s.asset);
    if (!img || !src) return say(t('Das Bild ist noch nicht geladen.'));
    // Welt → Bildpunkte des Originals
    const toPx = mul([src.w / s.w, 0, 0, src.h / s.h, 0, 0], inv(o.m));
    const subs: SubPath[] = [];
    for (const sh of shapes)
      for (const [leaf, m] of leaves([sh])) {
        const local = leaf.shape.kind === 'text' ? textOutline(leaf.shape)?.subs ?? [] : leaf.shape.kind === 'image' ? [] : shapeSubs(leaf.shape);
        subs.push(...transformSubs(local.filter((sp) => sp.nodes.length > 1 && (sp.closed || !mask)), mul(toPx, m)));
      }
    if (!subs.length) return say(mask ? t('Die gewählten Formen sind nicht geschlossen.') : t('Die gewählten Formen haben keine Kontur.'));
    // Rahmen der Formen (Kurven abgetastet), begrenzt auf das Bild
    let bx0 = Infinity,
      by0 = Infinity,
      bx1 = -Infinity,
      by1 = -Infinity;
    const add = (p: Pt) => {
      bx0 = Math.min(bx0, p.x);
      by0 = Math.min(by0, p.y);
      bx1 = Math.max(bx1, p.x);
      by1 = Math.max(by1, p.y);
    };
    for (const sp of subs) {
      add(sp.nodes[0]);
      for (const g of segments(sp)) {
        if (!g.curve) add(g.b);
        else for (let i = 1; i <= 32; i++) add(bezierPt(g.a, g.c1, g.c2, g.b, i / 32));
      }
    }
    const x0 = Math.max(0, Math.floor(bx0 + 1e-6)),
      y0 = Math.max(0, Math.floor(by0 + 1e-6)),
      x1 = Math.min(src.w, Math.ceil(bx1 - 1e-6)),
      y1 = Math.min(src.h, Math.ceil(by1 - 1e-6));
    if (x1 - x0 < 1 || y1 - y0 < 1) return say(t('Die Formen liegen nicht über dem Bild.'));
    const c = document.createElement('canvas');
    c.width = x1 - x0;
    c.height = y1 - y0;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, -x0, -y0);
    if (mask) {
      ctx.globalCompositeOperation = 'destination-in';
      ctx.translate(-x0, -y0);
      ctx.fill(subsToPath2D(subs), 'evenodd');
    }
    const a = await addAsset(c.toDataURL('image/png'));
    this.snapshot(t('Bild zuschneiden'));
    const kx = s.w / src.w,
      ky = s.h / src.h;
    o.m = mul(o.m, translate(x0 * kx, y0 * ky));
    o.shape = { ...s, asset: a.id, w: c.width * kx, h: c.height * ky, pxW: a.w, pxH: a.h };
    this.doc.objs = this.doc.objs.filter((x) => !shapes.includes(x));
    this.setSel([o]);
    this.hint = mask
      ? t('Maske angewendet: {w} × {h} Pixel bleiben, die Masken-Formen wurden entfernt (Ctrl+Z macht es rückgängig).', { w: c.width, h: c.height })
      : t('Bild zugeschnitten auf {w} × {h} Pixel, die Form wurde entfernt (Ctrl+Z macht es rückgängig).', { w: c.width, h: c.height });
    this.emit('doc');
  }

  /** RGBA-Daten eines Bildes, höchstens maxPx Bildpunkte (sonst verkleinert); null = noch nicht geladen */
  imagePixels(this: Editor, o: Obj, maxPx = Infinity): { rgba: Uint8ClampedArray<ArrayBuffer>; w: number; h: number; scale: number } | null {
    if (o.shape.kind !== 'image') return null;
    const img = assetImage(o.shape.asset),
      src = sourceSize(o.shape.asset);
    if (!img || !src) return null;
    const scale = Math.min(1, Math.sqrt(maxPx / (src.w * src.h)));
    const w = Math.max(1, Math.round(src.w * scale)),
      h = Math.max(1, Math.round(src.h * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    return { rgba: ctx.getImageData(0, 0, w, h).data, w, h, scale };
  }

  /**
   * Hintergrund eines Bildes entfernen (lokal, ohne Cloud): passende Bildpunkte werden transparent und damit nicht
   * gelasert. Das Bild bekommt neue Bilddaten in Originalauflösung; mit trim wird es auf das Motiv zugeschnitten.
   * Ein Undo-Schritt.
   */
  async removeBackground(this: Editor, o: Obj, opt: BgOptions, trim: boolean) {
    const px = this.imagePixels(o);
    if (!px || o.shape.kind !== 'image') {
      this.hint = t('Das Bild ist noch nicht geladen.');
      this.emit('tool');
      return;
    }
    const s = o.shape;
    const { rgba, w, h } = px;
    const alpha = backgroundAlpha(rgba, w, h, opt);
    const box = trim ? opaqueBounds(alpha, w, h) : { x: 0, y: 0, w, h };
    if (!box) {
      this.hint = t('Mit diesen Einstellungen bliebe vom Bild nichts übrig. Toleranz verringern.');
      this.emit('tool');
      return;
    }
    let removed = 0;
    for (let p = 0; p < alpha.length; p++) {
      if (alpha[p] < 128) removed++;
      rgba[p * 4 + 3] = Math.min(rgba[p * 4 + 3], alpha[p]);
    }
    const c = document.createElement('canvas');
    c.width = box.w;
    c.height = box.h;
    c.getContext('2d')!.putImageData(new ImageData(rgba, w, h), -box.x, -box.y);
    const a = await addAsset(c.toDataURL('image/png'));
    this.snapshot(t('Hintergrund entfernen'));
    const kx = s.w / w,
      ky = s.h / h;
    o.m = mul(o.m, translate(box.x * kx, box.y * ky));
    o.shape = { ...s, asset: a.id, w: box.w * kx, h: box.h * ky, pxW: a.w, pxH: a.h };
    this.setSel([o]);
    this.hint = t('Hintergrund entfernt: {pct} % des Bildes sind jetzt transparent und werden nicht gelasert (Ctrl+Z macht es rückgängig).', { pct: Math.round((removed / alpha.length) * 100) });
    this.emit('doc');
  }

  /** Objekte einfügen: liegen sie außerhalb des Betts, werden sie mittig platziert. Mehrere werden gruppiert. */
  /** Objekte als ein Element einfügen (rückgängig machbar); before läuft nach dem Undo-Zwischenstand, z. B. für Layer */
  placeNew(this: Editor, objs: Obj[], label: string, before?: () => void) {
    if (!objs.length) return;
    let o: Obj = objs[0];
    if (objs.length > 1) o = { id: newId(), m: IDENT, layer: objs[0].layer, shape: { kind: 'group', children: objs } };
    const b = boundsOf([o]);
    const bed = this.doc.bed;
    if (b && (b.x < -1e-6 || b.y < -1e-6 || b.x + b.w > bed.w + 1e-6 || b.y + b.h > bed.h + 1e-6))
      o.m = mul(translate(bed.w / 2 - (b.x + b.w / 2), bed.h / 2 - (b.y + b.h / 2)), o.m);
    this.snapshot(t('Objekt hinzufügen'));
    before?.();
    this.doc.objs.push(o);
    this.setTool('select');
    this.setSel([o]);
    this.hint = label;
    this.emit('doc');
  }

  /**
   * Rasterbild einfügen. Größe aus der Auflösung der Datei (sonst 254 DPI = ein Bildpunkt je 0,1-mm-Zeile);
   * zu große Bilder werden auf das Bett verkleinert. Das Bild kommt auf den aktuellen Layer.
   */
  async importImage(this: Editor, dataUrl: string, dpi: number | null, name?: string) {
    const o = await this.imageObj(dataUrl, dpi, name);
    const s = o.shape as ImageShape;
    const shrunk = s.w < (s.pxW / (dpi && dpi > 10 && dpi < 5000 ? dpi : 254)) * 25.4 - 1e-9;
    this.placeNew([o], t(shrunk ? 'Bild importiert: {pxW} × {pxH} Pixel, {w} × {h} mm (auf das Bett verkleinert).' : 'Bild importiert: {pxW} × {pxH} Pixel, {w} × {h} mm.', { pxW: s.pxW, pxH: s.pxH, w: dec(s.w.toFixed(1)), h: dec(s.h.toFixed(1)) }));
  }
  /** Bild-Objekt mittig auf dem Bett auf dem aktuellen Layer, ohne es einzufügen (Größe wie bei importImage) */
  async imageObj(this: Editor, dataUrl: string, dpi: number | null, name?: string): Promise<Obj> {
    const a = await addAsset(dataUrl);
    const res = dpi && dpi > 10 && dpi < 5000 ? dpi : 254;
    let w = (a.w / res) * 25.4,
      h = (a.h / res) * 25.4;
    const bed = this.doc.bed;
    const f = Math.min(1, (bed.w * 0.9) / w, (bed.h * 0.9) / h);
    w *= f;
    h *= f;
    const shape: ImageShape = { kind: 'image', asset: a.id, w, h, pxW: a.w, pxH: a.h, name, adjust: { ...DEFAULT_ADJUST } };
    this.prepareImageLayer(this.currentLayer);
    return { id: newId(), m: translate((bed.w - w) / 2, (bed.h - h) / 2), layer: this.currentLayer, shape };
  }

  /** Rasterbild an fester Stelle einfügen (Weltkoordinaten), z. B. das entzerrte Kamerabild */
  async importImageAt(this: Editor, dataUrl: string, x: number, y: number, w: number, h: number, name: string, hint: string, layer = this.currentLayer) {
    const a = await addAsset(dataUrl);
    const shape: ImageShape = { kind: 'image', asset: a.id, w, h, pxW: a.w, pxH: a.h, name, adjust: { ...DEFAULT_ADJUST } };
    const o: Obj = { id: newId(), m: translate(x, y), layer, shape };
    this.prepareImageLayer(layer);
    this.placeNew([o], hint);
  }

  /** Ergebnis eines Vektor-Imports (SVG/DXF) einfügen */
  async importVectors(this: Editor, res: ImportResult, name: string) {
    const objs = await this.vectorObjs(res, name);
    if (!objs.length) {
      this.hint = t('{name}: keine verwertbaren Formen gefunden. {notes}', { name, notes: res.notes.join(' ') });
      this.emit('tool');
      return;
    }
    const layers = new Set(objs.map((o) => o.layer));
    this.placeNew(objs, `${tn('{name}: {n} Objekt', '{name}: {n} Objekte', objs.length, { name })} ${tn('auf {n} Layer.', 'auf {n} Layern.', layers.size)} ${res.notes.join(' ')}`.trim());
  }

  /**
   * Mehrseitige PDF/AI-Datei einfügen: Seite 1 kommt auf die aktuelle Projektseite, jede weitere Seite auf eine
   * neue Projektseite dahinter. Ein einziger Undo-Schritt.
   */
  async importPdfPages(this: Editor, pages: ImportResult[], name: string) {
    if (pages.length <= 1) return this.importVectors(pages[0] ?? { items: [], notes: [] }, name);
    const groups: (Obj | null)[] = [];
    for (const res of pages) {
      const objs = await this.vectorObjs(res, name);
      if (!objs.length) {
        groups.push(null);
        continue;
      }
      const o: Obj = objs.length > 1 ? { id: newId(), m: IDENT, layer: objs[0].layer, shape: { kind: 'group', children: objs } } : objs[0];
      const b = boundsOf([o]);
      const bed = this.doc.bed;
      if (b && (b.x < -1e-6 || b.y < -1e-6 || b.x + b.w > bed.w + 1e-6 || b.y + b.h > bed.h + 1e-6))
        o.m = mul(translate(bed.w / 2 - (b.x + b.w / 2), bed.h / 2 - (b.y + b.h / 2)), o.m);
      groups.push(o);
    }
    if (!groups.some(Boolean)) {
      this.hint = t('{name}: keine verwertbaren Formen gefunden. {notes}', { name, notes: [...new Set(pages.flatMap((p) => p.notes))].join(' ') });
      this.emit('tool');
      return;
    }
    this.snapshot(t('PDF importieren'));
    const start = this.doc.page;
    const base = name.replace(/\.[a-z0-9]+$/i, '');
    groups.forEach((o, i) => {
      if (i === 0) {
        if (o) this.doc.objs.push(o);
        return;
      }
      this.doc.pages.splice(start + i, 0, { name: `${base} ${i + 1}`, objs: o ? [o] : [] });
    });
    this.clearPageState();
    this.doc.page = start;
    this.setTool('select');
    this.setSel(groups[0] ? [groups[0]] : []);
    const notes = [...new Set(pages.flatMap((p) => p.notes))];
    this.hint = [tn('{name}: {n} Seite importiert.', '{name}: {n} Seiten importiert, ab Seite 2 auf neuen Projektseiten.', pages.length, { name }), ...notes].join(' ');
    this.emit('doc');
    this.emit('sel');
  }

  /**
   * LightBurn-Projekt (.lbrn2) einfügen. Layer-Einstellungen aus der Datei gelten nur für Layer, auf denen im
   * Projekt noch nichts liegt; belegte Layer behalten ihre Einstellungen.
   */
  importLbrn(this: Editor, r: LbrnResult, name: string) {
    if (!r.objs.length) {
      this.hint = t('{name}: keine verwertbaren Formen gefunden. {notes}', { name, notes: r.notes.join(' ') });
      this.emit('tool');
      return;
    }
    for (const [id, url] of Object.entries(r.assets)) registerAsset(id, url);
    if (r.notes.length) for (const o of r.objs) o.importNote = `${name}: ${r.notes.join(' ')}`;
    const used = new Set<number>();
    for (const [o] of leaves(allObjs(this.doc))) used.add(o.layer);
    const take = Object.values(r.layers).filter((L) => !used.has(L.index));
    const kept = Object.keys(r.layers).length - take.length;
    const layers = new Set([...leaves(r.objs)].map(([o]) => o.layer));
    const msg = [
      `${tn('{name}: {n} Objekt', '{name}: {n} Objekte', r.objs.length, { name })} ${tn('auf {n} Layer.', 'auf {n} Layern.', layers.size)}`,
      kept ? tn('{n} schon belegter Layer behält seine Einstellungen.', '{n} schon belegte Layer behalten ihre Einstellungen.', kept) : '',
      ...r.notes,
    ];
    this.placeNew(r.objs, msg.filter(Boolean).join(' '), () => {
      for (const L of take) this.doc.layers[L.index] = L;
    });
  }

  /** Objekte aus einem Vektor-Import (SVG/DXF), ohne sie einzufügen; Hinweise landen in res.notes */
  async vectorObjs(this: Editor, res: ImportResult, name: string): Promise<Obj[]> {
    const objs: Obj[] = [];
    const flip: Mat = res.yUp ? [1, 0, 0, -1, 0, this.doc.bed.h] : IDENT;
    for (const it of res.items) {
      if (it.kind === 'path') {
        objs.push({ id: newId(), m: IDENT, layer: it.layer, shape: { kind: 'path', subs: transformSubs(it.subs, flip) } });
        continue;
      }
      try {
        const a = await addAsset(it.href);
        const shape: ImageShape = { kind: 'image', asset: a.id, w: 1, h: 1, pxW: a.w, pxH: a.h, adjust: { ...DEFAULT_ADJUST } };
        objs.push({ id: newId(), m: mul(flip, it.m), layer: it.layer, shape });
      } catch {
        res.notes.push(t('Ein eingebettetes Bild ließ sich nicht lesen.'));
      }
    }
    // Übersprungene Elemente bleiben am Objekt vermerkt und erscheinen in „Konstruktion prüfen“
    if (res.notes.length) for (const o of objs) o.importNote = `${name}: ${res.notes.join(' ')}`;
    return objs;
  }
  /** Konturen eines Bildes in Weltkoordinaten (für Vorschau und Übernahme) */
  traceImage(this: Editor, o: Obj, opt: TraceOptions): SubPath[] {
    if (o.shape.kind !== 'image') return [];
    const s = o.shape;
    const src = sourceSize(s.asset);
    if (!src) return [];
    // Auflösung des Originals, höchstens etwa 4 Megapixel
    const f = Math.min(1, Math.sqrt(4e6 / (src.w * src.h)));
    const cols = Math.max(2, Math.round(src.w * f)),
      rows = Math.max(2, Math.round(src.h * f));
    const g = adjustedGray(s, cols, rows);
    if (!g) return [];
    // Bildpunkte → lokale mm → Welt
    const subs = (opt.centerline ? centerlineGray : traceGray)(g, cols, rows, opt);
    return transformSubs(subs, mul(o.m, [s.w / cols, 0, 0, s.h / rows, 0, 0]));
  }
  /** Vorschau-Konturen (orange gestrichelt) setzen oder entfernen */
  setPreview(this: Editor, subs: SubPath[] | null) {
    this.offsetPreview = subs;
    this.redraw();
  }
  /** Nachgezeichnete Konturen als neues Objekt über dem Bild einfügen */
  commitTrace(this: Editor, o: Obj, subs: SubPath[], deleteImage: boolean, centerline = false) {
    if (!subs.length) return;
    this.snapshot(centerline ? t('Mittellinien nachzeichnen') : t('Bild nachzeichnen'));
    const res: Obj = { id: newId(), m: IDENT, layer: o.layer, shape: { kind: 'path', subs } };
    if (deleteImage) this.doc.objs = this.doc.objs.filter((x) => x !== o);
    this.doc.objs.push(res);
    this.setSel([res]);
    this.hint = centerline
      ? tn('{n} Mittellinie nachgezeichnet.', '{n} Mittellinien nachgezeichnet.', subs.length)
      : tn('{n} Kontur nachgezeichnet.', '{n} Konturen nachgezeichnet.', subs.length);
    this.emit('doc');
  }
}
