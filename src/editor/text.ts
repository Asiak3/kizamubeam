// Editor: QR-Codes, variabler Text, Text und Text auf Pfad.
import { allObjs, clone, inv, leaves, Mat, mul, newId, Obj, Pt, Shape, SubPath, TextPath, TextShape, translate, BarcodeShape, VarText } from '../model';
import { advanceVarText, expand, parseCsv, shownText } from '../vartext';
import { barcodeData, barcodeExtent, isLinear } from '../barcode';
import { ArcLength } from '../textpath';
import { transformSubs } from '../importers';
import { shapeSubs, textLayout } from '../geom';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { RULER } from './shared';

/** Längste Kontur einer Form (z. B. die äußere bei mehreren) als Kurve für Text auf Pfad */
function linkCurve(s: Shape): SubPath | null {
  const subs = shapeSubs(s).filter((sp) => sp.nodes.length > 1);
  if (!subs.length) return null;
  return clone(subs.reduce((a, b) => (new ArcLength(b).length > new ArcLength(a).length ? b : a)));
}

export class EditorText {
  selBarcodes(this: Editor): Obj[] {
    return this.sel.filter((o) => o.shape.kind === 'barcode');
  }
  /** Neuen QR- oder Strichcode mittig in der sichtbaren Fläche auf dem aktuellen Layer einfügen */
  addBarcode(this: Editor, shape: BarcodeShape) {
    let c = this.toWorld(RULER + (this.w - RULER) / 2, RULER + (this.h - RULER) / 2);
    const bed = this.doc.bed;
    if (c.x < 0 || c.y < 0 || c.x > bed.w || c.y > bed.h) c = { x: bed.w / 2, y: bed.h / 2 };
    const e = barcodeExtent(shape);
    const o: Obj = { id: newId(), m: translate(c.x - (e.x0 + e.x1) / 2, c.y - (e.y0 + e.y1) / 2), layer: this.currentLayer, shape };
    this.placeNew([o], isLinear(shape) ? t('Strichcode eingefügt. Doppelklick öffnet ihn zum Bearbeiten.') : t('QR-Code eingefügt. Doppelklick öffnet ihn zum Bearbeiten.'));
  }
  /** Inhalt oder Einstellungen eines QR- oder Strichcodes ändern; die Mitte bleibt, wo sie war */
  updateBarcode(this: Editor, o: Obj, patch: Partial<BarcodeShape>) {
    if (o.shape.kind !== 'barcode') return;
    this.snapshot(isLinear(o.shape) ? t('Strichcode ändern') : t('QR-Code ändern'));
    const before = barcodeExtent(o.shape);
    Object.assign(o.shape, patch);
    if (patch.vt === undefined && 'vt' in patch) delete o.shape.vt;
    this.touch(o.shape);
    const after = barcodeExtent(o.shape);
    const dx = (before.x0 + before.x1 - after.x0 - after.x1) / 2,
      dy = (before.y0 + before.y1 - after.y0 - after.y1) / 2;
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) o.m = mul(o.m, translate(dx, dy));
    this.emit('doc');
    this.emit('sel');
  }

  /** Zähler, Schrittweite usw. ändern (nicht rückgängig zu machen, wie in LightBurn) */
  setVarText(this: Editor, patch: Partial<VarText>) {
    Object.assign(this.varText, patch);
    this.touchVarText();
    this.emit('doc');
  }
  /** Nummer um steps Schritte weiter- (oder zurück-)zählen */
  stepVarText(this: Editor, steps: number) {
    advanceVarText(this.varText, steps);
    this.touchVarText();
    this.emit('doc');
  }
  /** CSV-Datei laden: Zähler läuft danach über alle Datenzeilen */
  loadCsv(this: Editor, name: string, text: string, header: boolean): number {
    const rows = parseCsv(text);
    const head = header && rows.length ? rows.shift()! : null;
    Object.assign(this.varText, { csv: { name, header: head, rows }, start: 1, end: Math.max(1, rows.length), current: 1 });
    this.touchVarText();
    this.emit('doc');
    return rows.length;
  }
  clearCsv(this: Editor) {
    delete this.varText.csv;
    this.touchVarText();
    this.emit('doc');
  }
  /** Objekte mit variablem Text (alle Seiten oder nur die aktuelle) */
  varTextObjs(this: Editor, allPages = true): Obj[] {
    const out: Obj[] = [];
    for (const [o] of leaves(allPages ? allObjs(this.doc) : this.doc.objs))
      if ((o.shape.kind === 'text' || o.shape.kind === 'barcode') && o.shape.vt) out.push(o);
    return out;
  }
  /** Zähler oder CSV haben sich geändert: Zwischenspeicher der betroffenen Objekte leeren */
  touchVarText(this: Editor) {
    for (const o of this.varTextObjs()) this.touch(o.shape);
    this.redraw();
  }
  /** Regelmäßig: Hat sich durch Datum/Uhrzeit ein angezeigter Inhalt geändert? */
  refreshVarText(this: Editor) {
    let changed = false;
    for (const o of this.varTextObjs(false)) {
      const s = o.shape;
      const v = s.kind === 'text' ? shownText(s) : s.kind === 'barcode' ? barcodeData(s) : '';
      if (this.shownVt.get(s) === v) continue;
      if (this.shownVt.has(s)) {
        this.touch(s);
        changed = true;
      }
      this.shownVt.set(s, v);
    }
    if (changed) this.emit('sel');
  }
  /** Nach einem gestarteten Job oder gespeicherten G-Code: bei „Automatisch weiterzählen“ die Nummer erhöhen */
  afterJob(this: Editor) {
    const vt = this.doc.vt;
    const objs = this.varTextObjs(false);
    if (!vt?.autoAdvance || !objs.length) return;
    // Mehrere Kopien mit Versatz (z. B. ein Jig voller Schilder): um so viele Nummern weiter, wie der Job verbraucht hat
    let maxOff = 0;
    for (const o of objs) if ((o.shape.kind === 'text' || o.shape.kind === 'barcode') && o.shape.vt) maxOff = Math.max(maxOff, o.shape.vt.offset || 0);
    this.stepVarText(maxOff + 1);
    this.hint = t('Variabler Text: weiter mit Nummer {n}.', { n: vt.current });
    this.emit('tool');
  }
  /** Variablen Text der Auswahl festschreiben („Bake“): der aktuelle Inhalt wird zu festem Text */
  bakeVarText(this: Editor): number {
    const objs = this.varTextObjs(false).filter((o) => [...leaves(this.sel)].some(([l]) => l === o));
    if (!objs.length) return 0;
    this.snapshot(t('Variablen Text festschreiben'));
    for (const o of objs) {
      const s = o.shape;
      if (s.kind === 'text') s.text = shownText(s);
      else if (s.kind === 'barcode') s.data = barcodeData(s);
      if (s.kind === 'text' || s.kind === 'barcode') delete s.vt;
      this.touch(s);
    }
    this.emit('doc');
    this.emit('sel');
    return objs.length;
  }
  /** Vorschau eines Platzhaltertexts mit der aktuellen Nummer */
  previewVarText(this: Editor, template: string, offset = 0): string {
    return expand(template, this.varText.current + offset, this.varText);
  }

  selTexts(this: Editor): Obj[] {
    return this.sel.filter((o) => o.shape.kind === 'text');
  }
  /**
   * Neuen Text anlegen und zum Tippen öffnen. Mit Rahmenbreite (aufgezogen) als Textrahmen: Zeilen brechen
   * an der Breite um, die Höhe wächst mit dem Text; at ist dann die linke obere Ecke des Rahmens.
   */
  createText(this: Editor, at: Pt, frameW = 0) {
    this.snapshot(frameW ? t('Textrahmen erstellen') : t('Text erstellen'));
    const shape: TextShape = { kind: 'text', text: '', ...this.textDefaults };
    let p = at;
    if (frameW) {
      Object.assign(shape, { fit: 'wrap', maxW: frameW });
      const dx = shape.align === 'left' ? 0 : shape.align === 'center' ? frameW / 2 : frameW;
      p = { x: at.x + dx, y: at.y + shape.size * 0.8 }; // Grundlinie der ersten Zeile unter der Oberkante
    }
    const txt: Obj = { id: newId(), m: translate(p.x, p.y), layer: this.currentLayer, shape };
    this.doc.objs.push(txt);
    this.setSel([txt]);
    this.emit('doc');
    this.textEditor?.(txt, true);
  }
  /** Textrahmen an/aus: an ohne Breite nimmt die jetzige Breite des Texts */
  toggleTextWrap(this: Editor) {
    const ts = this.selTexts();
    if (!ts.length) return;
    const on = (ts[0].shape as TextShape).fit !== 'wrap';
    this.snapshot(t('Text-Eigenschaften'));
    for (const o of ts) {
      const s = o.shape as TextShape;
      if (!on) delete s.fit;
      else {
        if (!s.maxW) s.maxW = Math.max(1, Math.round(textLayout(s).box.w * 10) / 10);
        s.fit = 'wrap';
      }
      this.touch(s);
    }
    this.emit('doc');
    this.emit('sel');
  }
  updateTexts(this: Editor, patch: Partial<TextShape>) {
    Object.assign(this.textDefaults, Object.fromEntries(Object.entries(patch).filter(([k]) => k !== 'text' && k !== 'path' && k !== 'vt' && k !== 'maxW' && k !== 'maxH' && k !== 'fit')));
    const ts = this.selTexts();
    if (!ts.length) return;
    this.snapshot(t('Text-Eigenschaften'));
    ts.forEach((o) => {
      Object.assign(o.shape, patch);
      this.touch(o.shape);
    });
    this.emit('doc');
    this.emit('sel');
  }
  /** Formen, die als Kurve für Text auf Pfad taugen */
  pathCandidates(this: Editor): Obj[] {
    return this.sel.filter((o) => ['path', 'rect', 'ellipse', 'polygon'].includes(o.shape.kind));
  }
  /** Ist „Text auf Pfad“ möglich? Genau ein Text und eine Form ausgewählt. */
  canApplyPathToText(this: Editor) {
    return this.selTexts().length === 1 && this.pathCandidates().length === 1;
  }
  /**
   * Text auf Pfad (wie „Apply Path to Text“ in LightBurn): Der gewählte Text folgt der gewählten Form.
   * Der Text übernimmt eine Kopie der Kurve; die Form bleibt als eigenes Objekt erhalten.
   * Erneut anwenden ersetzt die Kurve und behält Verschiebung, Abstand und Seite.
   */
  applyPathToText(this: Editor): boolean {
    const texts = this.selTexts(),
      shapes = this.pathCandidates();
    if (texts.length !== 1 || shapes.length !== 1) {
      this.hint = t('Für Text auf Pfad genau einen Text und eine Form (Linie, Rechteck, Ellipse, Polygon) auswählen.');
      this.emit('tool');
      return false;
    }
    const to = texts[0],
      po = shapes[0];
    const ts = to.shape as TextShape;
    const det = to.m[0] * to.m[3] - to.m[1] * to.m[2];
    const sub = linkCurve(po.shape);
    if (!sub || Math.abs(det) < 1e-12) return false;
    this.snapshot(t('Text auf Pfad'));
    // Drehung des Texts verwerfen (die Glyphen folgen ohnehin der Kurve), Größe und Spiegelung bleiben.
    // So liegt „oben“ bei geschlossenen Formen auch oben auf der Arbeitsfläche.
    const sx = Math.hypot(to.m[0], to.m[1]),
      sy = Math.sign(det) * Math.hypot(to.m[2], to.m[3]);
    to.m = [sx, 0, 0, sy, to.m[4], to.m[5]];
    const local = transformSubs([sub], mul(inv(to.m), po.m))[0];
    ts.path = {
      sub: local, offset: ts.path?.offset ?? 0, dist: ts.path?.dist ?? 0, flip: ts.path?.flip ?? false,
      link: po.id, textM: [...to.m] as Mat, linkM: [...po.m] as Mat,
    };
    this.touch(ts);
    this.setSel([to]);
    this.hint = t('Text folgt jetzt der Form, auch wenn sie später verschoben oder bearbeitet wird. Die Form wird mitgelasert, außer auf einem Werkzeuglayer (T1/T2) oder ausgeblendet.');
    this.emit('doc');
    return true;
  }
  /**
   * Verknüpfte Texte auf Pfad mit ihrer Form abgleichen (läuft vor jedem Zeichnen und nach Änderungen):
   * Wurde die Form verschoben oder bearbeitet, folgt der Text. Wurde nur der Text verschoben, wandert die Form mit.
   * Ist die Form gelöscht, behält der Text die letzte Kurve.
   */
  syncTextLinks(this: Editor) {
    let texts: [TextShape, Mat][] | null = null;
    const byId = new Map<number, [Obj, Mat]>();
    for (const [leaf, m] of leaves(this.doc.objs)) {
      byId.set(leaf.id, [leaf, m]);
      if (leaf.shape.kind === 'text' && leaf.shape.path?.link !== undefined) (texts ??= []).push([leaf.shape, m]);
    }
    if (!texts) return;
    const same = (a: Mat | undefined, b: Mat) => !!a && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    for (const [ts, tm] of texts) {
      const tp = ts.path!;
      const hit = byId.get(tp.link!);
      if (!hit || !['path', 'rect', 'ellipse', 'polygon'].includes(hit[0].shape.kind)) {
        delete tp.link;
        delete tp.textM;
        delete tp.linkM;
        continue;
      }
      const [lo] = hit;
      let lm = hit[1];
      // Nur der Text wurde bewegt: Form mitnehmen (nur bei Objekten der obersten Ebene)
      if (tp.textM && !same(tp.textM, tm) && same(tp.linkM, lm) && this.doc.objs.includes(lo)) {
        const d = mul(tm, inv(tp.textM));
        lo.m = mul(d, lo.m);
        lm = lo.m;
        this.touch(lo.shape);
      }
      tp.textM = [...tm] as Mat;
      tp.linkM = [...lm] as Mat;
      const sub = linkCurve(lo.shape);
      if (!sub || Math.abs(tm[0] * tm[3] - tm[1] * tm[2]) < 1e-12) continue;
      const local = transformSubs([sub], mul(inv(tm), lm))[0];
      if (JSON.stringify(local) !== JSON.stringify(tp.sub)) {
        tp.sub = local;
        this.touch(ts);
      }
    }
  }
  /** Text wieder gerade setzen */
  removePathFromText(this: Editor) {
    const ts = this.selTexts().filter((o) => (o.shape as TextShape).path);
    if (!ts.length) return;
    this.snapshot(t('Text vom Pfad lösen'));
    for (const o of ts) {
      delete (o.shape as TextShape).path;
      this.touch(o.shape);
    }
    this.emit('doc');
    this.emit('sel');
  }
  /** Verschiebung, Abstand oder Seite bei Text auf Pfad ändern */
  updateTextPath(this: Editor, patch: Partial<Omit<TextPath, 'sub'>>) {
    const ts = this.selTexts().filter((o) => (o.shape as TextShape).path);
    if (!ts.length) return;
    this.snapshot(t('Text auf Pfad ändern'));
    for (const o of ts) {
      Object.assign((o.shape as TextShape).path!, patch);
      this.touch(o.shape);
    }
    this.emit('doc');
    this.emit('sel');
  }
  setText(this: Editor, o: Obj, text: string) {
    if (o.shape.kind !== 'text') return;
    o.shape.text = text;
    this.touch(o.shape);
    this.emit('doc');
  }
  removeIfEmptyText(this: Editor, o: Obj) {
    if (o.shape.kind === 'text' && !o.shape.text.trim()) {
      this.doc.objs = this.doc.objs.filter((x) => x !== o);
      this.setSel(this.sel.filter((x) => x !== o));
      this.emit('doc');
    }
  }
}
