// Editor: Dokument, Rückgängig/Wiederholen, Autosave und Seiten.
import {
  allObjs, bumpIds, cloneObjs, Doc, defaultImageLayer, defaultLayer, IMAGE_LAYER_DEFAULTS, imageOutput, ImageOutput, normalizeLayer, loadDoc, pageName, ImageLayer, Layer, leaves, newDoc, Obj,
  Shape,
} from '../model';
import { assetUrl, registerAsset, restoreAssets } from '../images';
import { meshData, registerMesh, restoreMeshes } from '../model3d/store';
import { invalidate, invalidateText } from '../geom';
import { t } from '../i18n';
import { loadGen } from '../generators';
import type { Editor } from '../editor';
import { bumpShapeVersion } from './shared';
import { docKey, makeTab } from './tabs';

const STORAGE_KEY = 'kizamubeam.autosave';

/** Parameter parametrischer Bauteile aus älteren Generator-Versionen anpassen (Geometrie bleibt) */
const migrateGens = (objs: Obj[]) => {
  for (const [leaf] of leaves(objs)) if (leaf.shape.kind === 'gen') loadGen(leaf.shape);
};

export class EditorDocument {
  layer(this: Editor, i: number): Layer {
    return normalizeLayer((this.doc.layers[i] ??= defaultLayer(i)));
  }
  /** Bild-Einstellungen eines Layers */
  imgLayer(this: Editor, i: number): ImageLayer {
    return (this.layer(i).img ??= defaultImageLayer());
  }
  /** Image settings of a layer together with its speed, power and passes (for the laser and the preview) */
  imgOutput(this: Editor, i: number): ImageOutput {
    return imageOutput(this.layer(i), this.imgLayer(i));
  }
  /**
   * Prepare a layer for a newly placed image: image settings exist, and a layer without any objects
   * gets speed and power suited for engraving images
   */
  prepareImageLayer(this: Editor, i: number) {
    const empty = !allObjs(this.doc).some((o) => [...leaves([o])].some(([l]) => l.layer === i));
    this.imgLayer(i);
    if (empty) Object.assign(this.layer(i), IMAGE_LAYER_DEFAULTS);
  }
  /** Welche Arten von Objekten liegen auf dem Layer? (Vektoren und Bilder sind getrennte Einträge) */
  layerParts(this: Editor, i: number): { vec: boolean; img: boolean } {
    let vec = false,
      img = false;
    for (const [o] of leaves(this.doc.objs)) {
      if (o.layer !== i) continue;
      if (o.shape.kind === 'image') img = true;
      else vec = true;
    }
    return { vec, img };
  }
  usedLayers(this: Editor): number[] {
    const set = new Set<number>();
    for (const [o] of leaves(this.doc.objs)) set.add(o.layer);
    return [...set].sort((a, b) => a - b);
  }

  state(this: Editor) {
    return JSON.stringify({ doc: this.doc, sel: this.sel.map((o) => o.id) });
  }
  load(this: Editor, json: string) {
    this.isolation = null; this.builderSession = null;
    if (this.tool === 'builder') { this.tool = 'select'; this.hint = ''; }
    // Component references cannot survive document replacement (Undo/Redo).
    this.nodeSets.clear(); this.segmentSets.clear(); this.handleSets.clear(); this.nodeSel.clear();
    this.nodeSelObj = this.nodeEditObj = null;
    this.nodeHover = this.segHover = null; this.vectorPreview = null;
    this.drag = null;
    const st = JSON.parse(json);
    this.doc = loadDoc(st.doc);
    bumpIds(allObjs(this.doc));
    const ids = new Set<number>(st.sel ?? []);
    this.sel = this.doc.objs.filter((o) => ids.has(o.id));
    // Gewählte Kanten zeigen auf die alten Objekte
    this.jointPicks = [];
    this.jointHover = null;
  }
  /** Rückgängig/Wiederholen: Zähler und CSV-Daten des variablen Texts gehören nicht zum Verlauf */
  loadKeepVarText(this: Editor, json: string) {
    const vt = this.doc.vt;
    this.load(json);
    if (vt) this.doc.vt = vt;
    else delete this.doc.vt;
    this.touchVarText();
  }
  /**
   * Mehrere Änderungen als einen Undo-Schritt ausführen (z. B. ein Aufruf eines KI-Agenten).
   * Ändert sich nichts, bleibt der Verlauf, wie er war.
   */
  async batch<T>(this: Editor, fn: () => T | Promise<T>, label?: string): Promise<T> {
    if (this.batching) return fn();
    const before = this.state();
    const redo = this.history.saveRedo();
    this.snapshot(label);
    this.batching = true;
    try {
      return await fn();
    } finally {
      this.batching = false;
      if (this.state() === before) {
        this.history.drop();
        this.history.restoreRedo(redo);
      }
    }
  }
  /** Vor jeder Änderung aufrufen; label erscheint im Verlaufsfenster. */
  snapshot(this: Editor, label?: string) {
    if (this.batching) return;
    this.history.push(this.state(), label ?? t('Änderung'));
  }
  dropSnapshot(this: Editor) {
    if (this.batching) return;
    this.history.drop();
  }
  loadHistoryState(this: Editor, s: string | null) {
    if (s === null) return;
    this.loadKeepVarText(s);
    this.emit('doc');
    this.emit('sel');
  }
  doUndo(this: Editor) {
    this.loadHistoryState(this.history.stepBack(this.state()));
  }
  doRedo(this: Editor) {
    this.loadHistoryState(this.history.stepForward(this.state()));
  }
  /** Zu einer Zeile des Verlaufsfensters springen (0 = Ausgangsstand) */
  jumpHistory(this: Editor, row: number) {
    this.loadHistoryState(this.history.jumpTo(row, this.state()));
  }
  scheduleSave(this: Editor) {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 500);
  }
  /** Zwischenstand sofort sichern, z. B. vor dem Neuladen der Oberfläche (alle Tabs) */
  saveNow(this: Editor) {
    clearTimeout(this.saveTimer);
    this.updateChanged();
    const json = JSON.stringify(this.doc);
    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch {
      /* Speicher nicht verfügbar */
    }
    this.saveTabs(json);
  }
  restore(this: Editor) {
    if (this.restoreTabs(migrateGens)) return;
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      if (s) {
        this.doc = loadDoc(JSON.parse(s));
        bumpIds(allObjs(this.doc));
        migrateGens(allObjs(this.doc));
        restoreAssets(this.assetIds());
        restoreMeshes(this.meshIds());
      }
    } catch {
      this.doc = newDoc();
    }
    // Ältere Sicherung ohne Tabs: ein Tab mit ungespeicherten Änderungen (außer er ist leer)
    this.tabs = [makeTab(this.doc, null, allObjs(this.doc).length > 0)];
    this.tabIndex = 0;
  }
  /** IDs aller im Dokument verwendeten Bilder */
  assetIds(this: Editor, objs: Obj[] = allObjs(this.doc)): string[] {
    const ids = new Set<string>();
    for (const [o] of leaves(objs)) if (o.shape.kind === 'image') ids.add(o.shape.asset);
    return [...ids];
  }
  /** Kennungen aller 3D-Modelle, die Generator-Teile benutzen (Parameter „model“) */
  meshIds(this: Editor, objs: Obj[] = allObjs(this.doc)): string[] {
    const ids = new Set<string>();
    for (const [o] of leaves(objs)) if (o.shape.kind === 'gen' && typeof o.shape.params.model === 'string' && o.shape.params.model) ids.add(o.shape.params.model);
    return [...ids];
  }
  /** Projektdatei: Dokument samt Bilddaten und 3D-Modellen */
  serialize(this: Editor) {
    const assets: Record<string, string> = {};
    for (const id of this.assetIds()) {
      const url = assetUrl(id);
      if (url) assets[id] = url;
    }
    const meshes: Record<string, string> = {};
    for (const id of this.meshIds()) {
      const data = meshData(id);
      if (data) meshes[id] = data;
    }
    const extra: Record<string, unknown> = {};
    if (Object.keys(assets).length) extra.assets = assets;
    if (Object.keys(meshes).length) extra.meshes = meshes;
    return JSON.stringify(Object.keys(extra).length ? { ...this.doc, ...extra } : this.doc, null, 1);
  }
  /** Projektdatei lesen: Bilddaten anmelden, IDs und alte Generator-Parameter anpassen */
  parseProject(this: Editor, json: string): Doc {
    const d = loadDoc(JSON.parse(json));
    if (d.assets) for (const [id, url] of Object.entries(d.assets)) registerAsset(id, url);
    delete d.assets;
    if (d.meshes) for (const [id, data] of Object.entries(d.meshes)) if (typeof data === 'string') registerMesh(id, data);
    delete d.meshes;
    // Vorschau nur in Vorlagen-Dateien (wird beim Speichern als Vorlage neu erzeugt)
    delete d.template?.preview;
    restoreAssets(this.assetIds(allObjs(d)));
    restoreMeshes(this.meshIds(allObjs(d)));
    bumpIds(allObjs(d));
    migrateGens(allObjs(d));
    return d;
  }
  /** Projektdatei im aktiven Tab öffnen (ersetzt das Dokument, rückgängig machbar) */
  openDoc(this: Editor, json: string) {
    const d = this.parseProject(json);
    this.snapshot(t('Datei öffnen'));
    this.clearPageState();
    this.doc = d;
    // Name unbekannt: wer die Datei kennt, ruft danach markSaved() auf
    this.tab.name = null;
    this.tab.saved = '';
    this.onTabsChange?.();
    this.zoomPage();
    this.emit('doc');
    this.emit('sel');
  }
  newDocument(this: Editor) {
    this.snapshot(t('Neues Projekt'));
    this.clearPageState();
    const bed = this.doc.bed;
    this.doc = newDoc();
    this.doc.bed = { ...bed };
    this.tab.name = null;
    this.tab.saved = docKey(this.doc);
    this.onTabsChange?.();
    this.emit('doc');
    this.emit('sel');
  }

  // Seiten

  /** Beim Wechsel der Seite: Auswahl und alles, was auf Objekte der alten Seite zeigt, verwerfen */
  clearPageState(this: Editor) {
    this.isolation = null; this.builderSession = null;
    if (this.tool === 'builder') { this.tool = 'select'; this.hint = ''; }
    this.vectorPreview = null;
    if (this.drag) this.cancelDrag();
    if (this.draft) this.finishLine();
    this.sel = [];
    this.pivot = null;
    this.rotateMode = false;
    this.nodeSel.clear();
    this.nodeSelObj = null;
    this.nodeSets.clear(); this.segmentSets.clear(); this.handleSets.clear(); this.nodeEditObj = null; this.vectorPreview = null;
    this.nodeHover = this.segHover = null;
    this.jointPicks = [];
    this.jointHover = null;
    this.clearSnap();
  }
  /** Zur Seite i wechseln (kein eigener Undo-Schritt) */
  setPage(this: Editor, i: number) {
    i = Math.max(0, Math.min(this.doc.pages.length - 1, i));
    if (i === this.doc.page) return;
    this.clearPageState();
    this.doc.page = i;
    this.emit('doc');
    this.emit('sel');
  }
  /** Neue leere Seite hinter der aktuellen (oder an Stelle at) anlegen und zu ihr wechseln */
  addPage(this: Editor, name?: string, at = this.doc.page + 1): number {
    this.snapshot(t('Seite hinzufügen'));
    at = this.insertPage(name, at);
    this.emit('doc');
    this.emit('sel');
    return at;
  }
  /** Wie addPage, aber ohne eigenen Undo-Schritt und ohne Meldung (Teil eines größeren Schritts) */
  insertPage(this: Editor, name?: string, at = this.doc.page + 1): number {
    at = Math.max(0, Math.min(this.doc.pages.length, at));
    this.doc.pages.splice(at, 0, { name: name?.trim() || this.freePageName(), objs: [] });
    this.clearPageState();
    this.doc.page = at;
    return at;
  }
  /** Seite i samt Objekten (mit neuen IDs) dahinter kopieren und zu ihr wechseln */
  duplicatePage(this: Editor, i = this.doc.page): number {
    const src = this.doc.pages[i];
    if (!src) return -1;
    this.snapshot(t('Seite duplizieren'));
    this.doc.pages.splice(i + 1, 0, { name: t('{name} (Kopie)', { name: src.name }), objs: cloneObjs(src.objs) });
    this.clearPageState();
    this.doc.page = i + 1;
    this.emit('doc');
    this.emit('sel');
    return i + 1;
  }
  /** Seite i löschen; die letzte Seite bleibt immer stehen */
  deletePage(this: Editor, i = this.doc.page) {
    if (this.doc.pages.length < 2 || !this.doc.pages[i]) return;
    this.snapshot(t('Seite löschen'));
    this.doc.pages.splice(i, 1);
    const cur = this.doc.page;
    this.clearPageState();
    this.doc.page = Math.min(cur > i ? cur - 1 : cur, this.doc.pages.length - 1);
    this.emit('doc');
    this.emit('sel');
  }
  renamePage(this: Editor, i: number, name: string) {
    const p = this.doc.pages[i];
    name = name.trim();
    if (!p || !name || name === p.name) return;
    this.snapshot(t('Seite umbenennen'));
    p.name = name;
    this.emit('doc');
  }
  /** Seite from an die Stelle to schieben (Index nach dem Herausnehmen) */
  movePage(this: Editor, from: number, to: number) {
    const n = this.doc.pages.length;
    if (from === to || from < 0 || from >= n || to < 0 || to >= n) return;
    this.snapshot(t('Seite verschieben'));
    const cur = this.doc.pages[this.doc.page];
    const [p] = this.doc.pages.splice(from, 1);
    this.doc.pages.splice(to, 0, p);
    this.doc.page = this.doc.pages.indexOf(cur);
    this.emit('doc');
  }
  /** Oberste Objekte der aktuellen Seite auf Seite i verschieben (vor alle Objekte dort) */
  moveToPage(this: Editor, objs: Obj[], i: number) {
    const target = this.doc.pages[i];
    const moving = this.doc.objs.filter((o) => objs.includes(o));
    if (!target || i === this.doc.page || !moving.length) return;
    this.snapshot(t('Auf andere Seite verschieben'));
    this.doc.objs = this.doc.objs.filter((o) => !moving.includes(o));
    target.objs.push(...moving);
    this.setSel(this.sel.filter((o) => !moving.includes(o)));
    this.emit('doc');
  }
  freePageName(this: Editor): string {
    const used = new Set(this.doc.pages.map((p) => p.name));
    for (let n = this.doc.pages.length; ; n++) if (!used.has(pageName(n))) return pageName(n);
  }
  /** Form wurde direkt verändert: Zwischenspeicher leeren. */
  touch(this: Editor, s: Shape) {
    invalidate(s);
    bumpShapeVersion(s);
    if (s.kind === 'text') invalidateText(s);
  }
}
