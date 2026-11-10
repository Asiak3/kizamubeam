// Editor: Serien aus einer Tabelle. Für jede Zeile bekommen die Projekt-Parameter die Werte der Zeile, die
// aktuelle Seite wird als feste Kopie (Platzhalter ersetzt, Formeln gelöst) auf neue Seiten oder in ein Raster
// gelegt. Die Vorlage selbst bleibt unverändert.
import { cloneObjs, IDENT, mul, newId, Obj, translate } from '../model';
import { boundsOf } from '../geom';
import { coerce, conditionHolds, fillTemplate, ProjectParam, Scope, scopeOf, Value } from '../params';
import { t, tn } from '../i18n';
import type { Editor } from '../editor';
import { SeriesTable, squareTable } from '../templates';

export interface SeriesOptions {
  /** pages: eine Seite je Zeile; grid: Raster, das bei Bedarf auf weitere Seiten weiterläuft */
  layout: 'pages' | 'grid';
  /** Abstand im Raster und zum Rand (mm) */
  gap?: number;
}

export const SERIES_MAX = 500;

/** Klammern nach dem Einsetzen wieder als Text kennzeichnen, damit sie kein neuer Platzhalter werden */
const escapeBraces = (s: string) => s.replace(/[{}]/g, (c) => c + c);

/**
 * Feste Kopie: Platzhalter durch Werte ersetzen, Formeln und Bedingungen entfernen, Objekte, deren Bedingung
 * nicht gilt, weglassen. Variabler Text (%…) bleibt.
 */
export function bakeObjs(objs: Obj[], scope: Scope): Obj[] {
  const out: Obj[] = [];
  for (const o of cloneObjs(objs)) {
    if (o.showIf && !conditionHolds(o.showIf, scope)) continue;
    delete o.showIf;
    delete o.bind;
    const s = o.shape;
    if (s.kind === 'group') s.children = bakeObjs(s.children, scope);
    else if (s.kind === 'text') s.text = escapeBraces(fillTemplate(s.text, scope));
    else if (s.kind === 'barcode') s.data = escapeBraces(fillTemplate(s.data, scope, true));
    else if (s.kind === 'gen') delete s.bind;
    out.push(o);
  }
  return out;
}

export class EditorSeries {
  /** Tabelle für Serien im Projekt speichern (leer = entfernen); ein Undo-Schritt, wenn sich etwas ändert */
  setSeriesTable(this: Editor, tb: SeriesTable | null) {
    const next = tb && (tb.header.some((c) => c.trim()) || tb.rows.some((r) => r.some((c) => c.trim()))) ? squareTable(tb) : undefined;
    if (JSON.stringify(next) === JSON.stringify(this.doc.seriesTable)) return;
    this.snapshot(t('Tabelle ändern'));
    if (next) this.doc.seriesTable = next;
    else delete this.doc.seriesTable;
    this.emit('doc');
  }
  /**
   * Serie anlegen: rows enthält je Zeile Werte nach Parametername (fehlende behalten ihren Wert). Die Kopien
   * kommen hinter die aktuelle Seite; danach ist die erste neue Seite aktiv. Ein Undo-Schritt. Gibt die Zahl
   * der neuen Seiten zurück.
   */
  makeSeries(this: Editor, rows: Record<string, unknown>[], opts: SeriesOptions): number {
    if (!rows.length) throw new Error(t('Die Tabelle hat keine Zeilen.'));
    if (rows.length > SERIES_MAX) throw new Error(t('Höchstens {n} Zeilen auf einmal.', { n: SERIES_MAX }));
    const params = this.paramList();
    const byName = new Map(params.map((p) => [p.name.toLowerCase(), p]));
    const values = rows.map((r) =>
      Object.entries(r).map(([k, v]) => {
        const p = byName.get(k.toLowerCase());
        if (!p) throw new Error(t('Unbekannter Parameter „{name}“', { name: k }));
        return [p, coerce(p, v)] as [ProjectParam, Value];
      }),
    );
    const template = this.doc.objs;
    if (!template.length) throw new Error(t('Die aktuelle Seite ist leer.'));
    const before = new Map(params.map((p) => [p, p.value]));
    const gap = Math.max(0, opts.gap ?? 3);
    this.snapshot(t('Serie aus Tabelle'));
    this.clearPageState();

    // Je Zeile: Werte setzen, neu berechnen, feste Kopie
    const sets: { objs: Obj[]; label: string }[] = [];
    try {
      for (const [i, vals] of values.entries()) {
        for (const [p, v] of vals) p.value = v;
        this.applyParams();
        const label = String(vals.find(([p]) => p.type === 'text')?.[1] ?? '').trim();
        sets.push({ objs: bakeObjs(template, scopeOf(params)), label: label ? `${i + 1}: ${label}` : String(i + 1) });
      }
    } finally {
      for (const [p, v] of before) p.value = v;
      this.applyParams();
    }

    const pages: { name: string; objs: Obj[] }[] = [];
    if (opts.layout === 'pages') {
      for (const s of sets) pages.push({ name: t('Zeile {name}', { name: s.label }), objs: s.objs });
    } else {
      // Raster: Zellen so groß wie die größte Kopie, Kopien in der Zelle mittig, ab dem Maschinen-Nullpunkt (unten links)
      const boxes = sets.map((s) => boundsOf(s.objs));
      const cw = Math.max(1, ...boxes.map((b) => b?.w ?? 0));
      const ch = Math.max(1, ...boxes.map((b) => b?.h ?? 0));
      const { w: bw, h: bh } = this.doc.bed;
      const cols = Math.max(1, Math.floor((bw - gap) / (cw + gap)));
      const perPage = cols * Math.max(1, Math.floor((bh - gap) / (ch + gap)));
      sets.forEach((s, i) => {
        const k = i % perPage;
        if (!k) pages.push({ name: t('Serie {n}', { n: pages.length + 1 }), objs: [] });
        const b = boxes[i];
        const cx = gap + (k % cols) * (cw + gap) + cw / 2;
        const cy = bh - gap - Math.floor(k / cols) * (ch + gap) - ch / 2;
        const m = b ? translate(cx - (b.x + b.w / 2), cy - (b.y + b.h / 2)) : IDENT;
        const objs = s.objs.map((o) => ({ ...o, m: mul(m, o.m) }));
        // Jede Kopie als Gruppe, damit sie sich als Ganzes verschieben lässt
        pages[pages.length - 1].objs.push(objs.length > 1 ? { id: newId(), m: IDENT, layer: objs[0].layer, name: s.label, shape: { kind: 'group', children: objs } } : objs[0]);
      });
    }
    const at = this.doc.page + 1;
    this.doc.pages.splice(at, 0, ...pages);
    this.doc.page = at;
    this.hint = `${tn('Serie mit {n} Zeile angelegt', 'Serie mit {n} Zeilen angelegt', sets.length)} ${tn('({n} Seite).', '({n} Seiten).', pages.length)}`;
    this.emit('doc');
    this.emit('sel');
    return pages.length;
  }
}
