// Editor: In Pfad umwandeln, Boolesche Operationen, Offset und Arrays.
import { clone, cloneObjs, homeLayer, IDENT, leaves, Mat, mul, newId, Obj, Pt, SubPath } from '../model';
import { BoolBase, BoolOp, booleanOp, closedCount, OffsetOptions, offsetOp, openSubs, orderForBoolean } from '../ops';
import { loadFont, textGlyphSubs, textToSubs } from '../fonts';
import { MAX_COPIES } from '../arrays';
import { shapeSubs } from '../geom';
import { t, tn } from '../i18n';
import type { Editor } from '../editor';

const BOOL_KEY = 'kizamubeam.boolean';

export class EditorShapeOps {
  convertObjToPath(this: Editor, o: Obj) {
    if (o.shape.kind === 'text' || o.shape.kind === 'group' || o.shape.kind === 'path' || o.shape.kind === 'image') return;
    o.shape = { kind: 'path', subs: clone(shapeSubs(o.shape)) };
  }

  /** Formen und Texte der Auswahl in Pfade umwandeln (Texte über die Schriftkonturen). */
  async convertSelToPath(this: Editor) {
    const objs = this.sel.filter((o) => ['rect', 'ellipse', 'polygon', 'text', 'barcode', 'gen', 'group'].includes(o.shape.kind));
    if (!objs.length) return;
    const fallbacks = new Set<string>();
    const outlines = new Map<Obj, SubPath[]>();
    for (const [leaf] of leaves(objs)) {
      if (leaf.shape.kind !== 'text') continue;
      const t = leaf.shape;
      const f = await loadFont(t.font, t.bold, t.italic);
      if (f.fallback) fallbacks.add(t.font);
      outlines.set(leaf, textToSubs(t, f.font));
    }
    this.snapshot(t('In Pfad umwandeln'));
    for (const [leaf] of leaves(objs)) {
      const subs = outlines.get(leaf);
      if (subs) {
        leaf.shape = { kind: 'path', subs };
        this.touch(leaf.shape);
      } else this.convertObjToPath(leaf);
    }
    this.hint = fallbacks.size
      ? tn('Schrift {fonts} nicht gefunden, Roboto verwendet.', 'Schriften {fonts} nicht gefunden, Roboto verwendet.', fallbacks.size, { fonts: [...fallbacks].join(', ') })
      : t('In Pfad umgewandelt.');
    this.emit('doc');
    this.emit('sel');
  }

  /**
   * Kopien der Objekte, in denen Texte schon als Konturen vorliegen (für Boolesche Operationen und Offset).
   * Jede Glyphe wird ein eigener Pfad in einer Gruppe, damit sich überlappende Buchstaben vereinen statt Löcher zu bilden.
   */
  async withTextOutlines(this: Editor, objs: Obj[]): Promise<Obj[]> {
    const out: Obj[] = [];
    for (const o of objs) {
      const c = clone(o);
      for (const [leaf] of leaves([c])) {
        if (leaf.shape.kind !== 'text') continue;
        const t = leaf.shape;
        const f = await loadFont(t.font, t.bold, t.italic);
        const children: Obj[] = textGlyphSubs(t, f.font).map((subs) => ({ id: newId(), m: IDENT, layer: leaf.layer, shape: { kind: 'path', subs } }));
        leaf.shape = { kind: 'group', children };
      }
      out.push(c);
    }
    return out;
  }

  setBoolOptions(this: Editor, patch: { base?: BoolBase; keep?: boolean }) {
    if (patch.base) this.boolBase = patch.base;
    if (patch.keep !== undefined) this.boolKeep = patch.keep;
    try {
      localStorage.setItem(BOOL_KEY, JSON.stringify({ base: this.boolBase, keep: this.boolKeep }));
    } catch {
      /* Speicher nicht verfügbar */
    }
    this.emit('tool');
  }
  loadBoolSettings(this: Editor) {
    try {
      const st = JSON.parse(localStorage.getItem(BOOL_KEY) ?? '{}');
      if (st.base === 'selection' || st.base === 'back' || st.base === 'front') this.boolBase = st.base;
      if (typeof st.keep === 'boolean') this.boolKeep = st.keep;
    } catch {
      /* Standardwerte */
    }
  }

  /**
   * Boolesche Operation auf die Auswahl. Welches Objekt die Basis ist, bestimmt `base`
   * (sonst die Einstellung boolBase): beim Abziehen werden alle anderen von der Basis abgezogen.
   */
  async booleanSel(this: Editor, op: BoolOp, base: BoolBase = this.boolBase) {
    // Bilder nehmen nicht teil (sie haben keine Kontur). Reine Linien-Objekte (z. B. Biegeschnitte) haben keine Fläche:
    // beim Abziehen und beim Schnitt werden sie an den Flächen gekürzt, beim Vereinen bleiben sie unberührt.
    const cands = this.sel.filter((o) => o.shape.kind !== 'image');
    const outlined = await this.withTextOutlines(cands);
    const calc = new Map(cands.map((o, i) => [o, outlined[i]]));
    const areas = orderForBoolean(cands.filter((o) => closedCount(calc.get(o)!) > 0), this.doc.objs, base);
    const lines = op === 'subtract' || op === 'intersect' ? cands.filter((o) => !areas.includes(o) && openSubs(calc.get(o)!).length > 0) : [];
    const inputs = [...areas, ...lines];
    const skipped = cands.length - inputs.length;
    // Vereinen geht auch mit einem einzelnen Objekt aus mehreren Konturen (Gruppe, Text): es wird mit sich selbst verschweißt
    const weld = op === 'union' && areas.length === 1 && ['group', 'text'].includes(areas[0].shape.kind) && closedCount(calc.get(areas[0])!) > 1;
    if (areas.length < 2 && !weld && !(areas.length && lines.length)) {
      this.hint = skipped
        ? t('Für Boolesche Operationen mindestens zwei geschlossene Formen auswählen (offene Linien haben keine Fläche).')
        : t('Für Boolesche Operationen mindestens zwei Formen auswählen.');
      this.emit('tool');
      return;
    }
    const keep = this.boolKeep;
    // Ohne „Originale behalten“ gehen parametrische Bauteile im Ergebnis auf: vorher fragen
    if (!keep && !(await this.guardGen(inputs, t('Boolesche Operation')))) return;
    const subs = booleanOp(op, areas.map((o) => calc.get(o)!), lines.map((o) => calc.get(o)!));
    if (!subs.length && keep) {
      this.hint = t('Ergebnis ist leer (keine gemeinsame Fläche).');
      this.emit('tool');
      return;
    }
    this.snapshot(t('Boolesche Operation'));
    const z = inputs.map((o) => this.doc.objs.indexOf(o));
    // Ohne Originale nimmt das Ergebnis den Platz des hintersten Objekts ein, sonst liegt es direkt vor dem vordersten
    let idx = keep ? Math.max(...z) + 1 : Math.min(...z);
    if (!keep) this.doc.objs = this.doc.objs.filter((o) => !inputs.includes(o));
    const note = skipped ? t('Offene Linien und Bilder wurden nicht verrechnet.') : '';
    if (!subs.length) {
      this.hint = t('Ergebnis ist leer (keine gemeinsame Fläche).');
      this.setSel([]);
    } else {
      const res: Obj = { id: newId(), m: IDENT, layer: homeLayer(lines.length && areas.length === 1 ? lines[0] : areas[0]), shape: { kind: 'path', subs } };
      idx = Math.min(idx, this.doc.objs.length);
      this.doc.objs.splice(idx, 0, res);
      this.setSel([res]);
      this.hint = [keep ? t('Originale behalten, Ergebnis liegt davor.') : '', note].filter(Boolean).join(' ');
    }
    this.emit('doc');
  }

  /** Offset: neue Konturen im Abstand zur Auswahl. */
  async offsetSel(this: Editor, opt: OffsetOptions, keepOriginal: boolean) {
    const inputs = this.sel.filter((o) => o.shape.kind !== 'image');
    if (!inputs.length) return;
    if (!keepOriginal && !(await this.guardGen(inputs, t('Offset')))) return;
    const subs = offsetOp(await this.withTextOutlines(inputs), opt);
    this.snapshot(t('Offset'));
    if (!keepOriginal) this.doc.objs = this.doc.objs.filter((o) => !inputs.includes(o));
    if (!subs.length) {
      this.hint = t('Offset ergibt keine Kontur (Abstand zu groß für Innen-Offset?).');
      this.setSel(keepOriginal ? inputs : []);
    } else {
      const res: Obj = { id: newId(), m: IDENT, layer: homeLayer(inputs[0]), shape: { kind: 'path', subs } };
      this.doc.objs.push(res);
      this.setSel([res]);
      this.hint = '';
    }
    this.emit('doc');
  }

  setArrayPreview(this: Editor, mats: Mat[] | null, center: Pt | null = null) {
    this.arrayPreview = mats;
    this.arrayCenter = mats ? center : null;
    this.redraw();
  }
  /** Array anlegen: Auswahl je Matrix kopieren (erste Matrix = Original), optional alles gruppieren. */
  applyArray(this: Editor, mats: Mat[], asGroup: boolean, what: string) {
    if (!this.sel.length || mats.length < 2) return;
    if (mats.length * this.sel.length > MAX_COPIES) {
      this.hint = t('{what}: zu viele Kopien (höchstens {MAX_COPIES}).', { what, MAX_COPIES });
      this.emit('tool');
      return;
    }
    this.snapshot(t('Array'));
    const originals = this.doc.objs.filter((o) => this.sel.includes(o));
    const copies: Obj[] = [];
    for (const M of mats.slice(1)) {
      cloneObjs(originals).forEach((c, i) => {
        c.m = mul(M, originals[i].m);
        copies.push(c);
      });
    }
    const all = [...originals, ...copies];
    if (asGroup) {
      const idx = this.doc.objs.indexOf(originals[originals.length - 1]);
      const g: Obj = { id: newId(), m: IDENT, layer: originals[0].layer, shape: { kind: 'group', children: all } };
      this.doc.objs.splice(idx + 1, 0, g);
      this.doc.objs = this.doc.objs.filter((o) => !originals.includes(o));
      this.setSel([g]);
    } else {
      this.doc.objs.push(...copies);
      this.setSel(all);
    }
    this.hint = tn('{what}: {n} Kopie angelegt.', '{what}: {n} Kopien angelegt.', mats.length - 1, { what });
    this.emit('doc');
  }
  async previewOffset(this: Editor, opt: OffsetOptions | null) {
    this.offsetPreview = opt && this.sel.length ? offsetOp(await this.withTextOutlines(this.sel), opt) : null;
    this.redraw();
  }
}
