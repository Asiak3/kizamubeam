// Editor: Zustand, Ansicht, Auswahl und Werkzeugwahl. Die übrigen Bereiche liegen in src/editor/
// und werden unten in die Klasse eingehängt.
import { Doc, Mat, newDoc, Obj, Pt, Shape, SubPath, TextShape, visibleLeaves, VarText } from './model';
import { defaultVarText, setVarTextSource } from './vartext';
import { setParamSource } from './params';
import type { Issue } from './generators';
import type { CheckIssue } from './check';
import { onImageReady } from './images';
import { BoolBase } from './ops';
import { onFontLoaded } from './fonts';
import { EdgePick } from './joints';
import { Box, boundsOf, hitLeaf } from './geom';
import { AlignGuide, SnapHit, SnapSet } from './snap';
import { History } from './history';
import { Tool, RULER, CANVAS_THEMES, HANDLE_OFF, Drag, NodeHover, SegHover, TOOL_HINTS } from './editor/shared';
import { EditorCommands } from './editor/commands';
import { EditorDocument } from './editor/document';
import { EditorHinges } from './editor/hinges';
import { EditorImages } from './editor/imageops';
import { EditorJoints } from './editor/joints';
import { EditorKeyboard } from './editor/keyboard';
import { EditorNodes } from './editor/nodes';
import { EditorObjects } from './editor/objects';
import { EditorPaths } from './editor/paths';
import { EditorPointer } from './editor/pointer';
import { EditorRender } from './editor/render';
import { EditorShapeOps } from './editor/shapeops';
import { EditorSnapping } from './editor/snapping';
import { EditorGuides } from './editor/guides';
import { EditorText } from './editor/text';
import { EditorGenerators } from './editor/generators';
import { EditorParams } from './editor/params';
import { EditorNest } from './editor/nest';
import { EditorSeries } from './editor/series';
import { EditorCheck } from './editor/check';
import { EditorLibrary } from './editor/library';
import { EditorWarp } from './editor/warp';
import { EditorNotes } from './editor/notes';
import { EditorTabs, ProjectTab } from './editor/tabs';
import { EditorRelations, RelPick } from './editor/relations';
import { EditorSketch, SketchSession } from './editor/sketch';
import type { RelMode } from './relations';
import { t } from './i18n';

export type { Tool } from './editor/shared';
export { RULER, TOOL_HINTS } from './editor/shared';

export class Editor {
  doc: Doc = newDoc();
  sel: Obj[] = [];
  tool: Tool = 'select';
  rotateMode = false;
  /** Frei gesetzter Drehpunkt im Drehmodus */
  pivot: Pt | null = null;
  view = { zoom: 2, ox: 60, oy: 40 };
  filled = true;
  /** Dunkles Design der Arbeitsfläche */
  dark = false;
  snapGrid = false;
  gridStep = 1;
  /** An Objekten fangen (Knoten, Mittelpunkte, Zentren, Schnittpunkte, Linien) */
  snapObjects = true;
  /** Aktueller Fangpunkt zur Anzeige */
  snapHit: SnapHit | null = null;
  /** Ausrichtungshilfen (Alt) zur Anzeige */
  alignGuides: AlignGuide[] = [];
  /** Mittelpunktkreuze: aus, bei Auswahl/unter dem Mauszeiger, immer */
  centerMarks: 'off' | 'auto' | 'all' = 'auto';
  /** Objekt unter dem Mauszeiger, dessen Mittelpunkte gezeigt werden */
  centerHover: Obj | null = null;

  // Beziehungen (einmal angewendet) und Messen
  relMode: RelMode = 'concentric';
  relPicks: RelPick[] = [];
  relHover: RelPick | null = null;
  /** Abstand für die Beziehung „Abstand“ erfragen (ui.ts); null = abgebrochen */
  onRelDistance: ((current: number) => Promise<number | null>) | null = null;
  /** Messung: Anfang und (wenn fertig) Ende in Welt-mm */
  measure: { a: Pt; b: Pt | null } | null = null;
  /** Kreis unter dem Mauszeiger im Werkzeug „Messen“ */
  measureCircle: { c: Pt; r: number } | null = null;

  // Skizzenmodus (Skizzen mit Beziehungen und Bemaßungen)
  sketchEdit: SketchSession | null = null;
  /** Wert einer Bemaßung erfragen (ui.ts): Zahl oder Formel; null = abgebrochen */
  onSketchValue: ((title: string, current: number, unit: string, expr?: string) => Promise<{ v: number; expr?: string } | null>) | null = null;
  snapCache: { ver: number; set: SnapSet } | null = null;
  snapVer = 0;
  currentLayer = 0;
  activeLayer: number | null = null;
  polySides = 6;
  polyStar = false;
  rectRadius = 0;
  textDefaults: Omit<TextShape, 'kind' | 'text'> = {
    font: 'Arial', size: 10, bold: false, italic: false, upper: false, align: 'left', hSpace: 0, vSpace: 0,
  };
  cursor: Pt = { x: 0, y: 0 };
  /** Linienwerkzeug: Pfad im Entstehen (Weltkoordinaten) */
  draft: SubPath | null = null;
  nodeHover: NodeHover | null = null;
  segHover: SegHover | null = null;
  /** Ausgewählte Knoten des Knotenziels als "Unterpfad:Index" */
  nodeSel = new Set<string>();
  nodeSelObj: Obj | null = null;
  hint = '';

  /** Rückgängig-Verlauf mit benannten Schritten (Verlaufsfenster, höchstens 200) */
  history = new History();

  // Mehrere Projekte als Tabs (src/editor/tabs.ts); der aktive Tab liegt in doc, history und view
  tabs: ProjectTab[] = [];
  tabIndex = 0;
  /** Tabs haben sich geändert (Liste, aktiver Tab, Name, ungespeichert); von der Oberfläche gesetzt */
  onTabsChange: (() => void) | null = null;
  get tab(): ProjectTab {
    return this.tabs[this.tabIndex];
  }
  clipboard: Obj[] = [];
  drag: Drag | null = null;
  space = false;
  dirty = true;
  ctx: CanvasRenderingContext2D;
  dpr = 1;
  private listeners = new Set<(what: 'doc' | 'sel' | 'view' | 'tool') => void>();
  saveTimer = 0;
  textEditor: ((o: Obj, isNew: boolean) => void) | null = null;
  /** Einfügen aus der System-Zwischenablage (Bilder, SVG); true = verarbeitet */
  externalPaste: ((data: DataTransfer) => Promise<boolean>) | null = null;
  pasteTimer = 0;
  /** Hintergrund auf dem Bett unter dem Raster (Kamerabild), in Weltkoordinaten gezeichnet */
  background: ((ctx: CanvasRenderingContext2D) => void) | null = null;

  // Dokument, Rückgängig/Wiederholen, Autosave und Seiten
  /** Während batch(): alle Änderungen zählen als ein Undo-Schritt */
  batching = false;

  // Fangen an Raster, Objekten und Hilfslinien
  /** Ist der Werkzeug-Modus einer, bei dem der Mauszeiger schon ohne Ziehen fängt? */
  get drawTool() {
    return this.tool === 'line' || this.tool === 'rect' || this.tool === 'ellipse' || this.tool === 'polygon' || this.tool === 'text' || this.tool === 'measure';
  }

  // Pfad-Werkzeuge: Schließen, Verbinden, Zerlegen, Startpunkt, Trimmen
  // Startpunkt setzen
  /** Knoten unter dem Mauszeiger im Startpunkt-Werkzeug */
  startHover: { obj: Obj; m: Mat; sub: number; idx: number } | null = null;
  // Trimmen
  /** Abschnitt unter dem Mauszeiger im Trimm-Werkzeug (Welt) */
  trimHover: { obj: Obj; sub: number; span: [number, number] | null; piece: SubPath } | null = null;
  trimCache: { ver: number; world: Map<Obj, SubPath[]>; cuts: Map<string, number[]> } | null = null;

  // Verbindungen (Fingerzinken, Schlitz und Zapfen)
  /** Gewählte Kanten für eine Verbindung (höchstens zwei) und Kante unter dem Mauszeiger */
  jointPicks: EdgePick[] = [];
  jointHover: EdgePick | null = null;
  /** Öffnet den Verbindungs-Dialog (ui.ts) */
  onJointDialog: (() => void) | null = null;
  /** Vorschau der Verbindung: neue Konturen der betroffenen Objekte (Welt) */
  jointPreview: SubPath[] | null = null;
  /** Werkzeug „Verbindung“ wurde als Scharnier-Generator gestartet (Dialog öffnet mit „Scharnier für Deckel“) */
  jointHingeMode = false;

  // Biegeschnitte (Living Hinges)
  /** Vorschau der Biegeschnitte (Welt) */
  hingePreview: SubPath[] | null = null;

  // In Pfad umwandeln, Boolesche Operationen, Offset und Arrays
  /** Basis bei Booleschen Operationen: zuerst gewähltes, hinterstes oder vorderstes Objekt */
  boolBase: BoolBase = 'selection';
  /** Originalobjekte nach Booleschen Operationen behalten */
  boolKeep = false;
  /** Vorschau für den Offset-Dialog (ohne das Dokument zu ändern) */
  offsetPreview: SubPath[] | null = null;
  /** Vorschau für die Array-Dialoge: Weltmatrix je Kopie (die erste ist das Original) */
  arrayPreview: Mat[] | null = null;
  /** Mittelpunkt des Kreisarrays (Welt), wird als Kreuz gezeigt */
  arrayCenter: Pt | null = null;
  /** Position des Laserkopfs (Werkstückkoordinaten, y nach oben), solange verbunden */
  laserPos: Pt | null = null;

  // Knotenbearbeitung
  /** Anzahl ausgewählter Knoten für die Oberfläche */
  get nodeSelCount() {
    return this.tool === 'node' ? this.selectedNodes().length : 0;
  }

  // Befehle: Löschen, Kopieren, Einfügen, Transformieren, Formparameter
  /** Rasterarray-Dialog öffnen (Ctrl+Shift+A, von der Oberfläche gesetzt) */
  onGridArray: (() => void) | null = null;
  /** Datei > Importieren (von der Oberfläche gesetzt) */
  onImport: (() => void) | null = null;

  // QR-Codes, variabler Text, Text und Text auf Pfad
  /** Doppelklick auf einen QR-Code: Dialog zum Bearbeiten öffnen */
  onBarcodeEdit: ((o: Obj) => void) | null = null;
  /** Projektweite Einstellungen (werden beim ersten Zugriff angelegt) */
  get varText(): VarText {
    return (this.doc.vt ??= defaultVarText());
  }
  shownVt = new WeakMap<Shape, string>();

  // Parametrische Bauteile (Generatoren)
  /** Doppelklick auf ein Bauteil: Generator-Dialog mit seinen Parametern öffnen */
  onGenEdit: ((o: Obj) => void) | null = null;
  /** Rückfrage, bevor eine Aktion Bauteile in Pfade umwandelt (von der Oberfläche gesetzt) */
  onGenGuard: ((objs: Obj[], action: string) => Promise<'convert' | 'edit' | 'cancel'>) | null = null;
  /** Läuft gerade ein Aufruf eines KI-Agenten? Dann gibt es keine Rückfragen, sondern Fehlermeldungen. */
  agentCall = false;

  // Projekt-Parameter
  /** Formeln, die sich bei der letzten Neuberechnung nicht auswerten ließen (für das Parameter-Fenster) */
  paramProblems: { obj: Obj; issues: Issue[] }[] = [];

  // Konstruktion prüfen
  /** Befunde der letzten Prüfung (aktuelle Seite) */
  checkIssues: CheckIssue[] = [];
  /** Angeklickter Befund (stärker hervorgehoben) */
  checkActive: CheckIssue | null = null;
  /** Befunde auf der Arbeitsfläche markieren (solange das Fenster Prüfung zu sehen ist) */
  checkMarks = false;
  /** In dieser Sitzung ausgeblendete Befunde */
  checkIgnored = new Set<string>();
  /** Lage auf dem Bett prüfen? (von laser.ts gesetzt: nicht bei Start ab Benutzer-Ursprung/Position oder mit Drehachse) */
  checkBedApplies: () => boolean = () => true;

  // Zeichnen der Arbeitsfläche
  get colors() {
    return this.dark ? CANVAS_THEMES.dark : CANVAS_THEMES.light;
  }

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.restore();
    setVarTextSource(() => this.doc.vt);
    setParamSource(() => this.doc.params);
    // Datum und Uhrzeit in variablem Text aktuell halten
    window.setInterval(() => this.refreshVarText(), 15000);
    this.loadSnapSettings();
    this.loadBoolSettings();
    // Texte werden mit den Schriftkonturen gezeichnet; nach dem Laden einer Schrift neu zeichnen
    onFontLoaded(() => this.emit('sel'));
    onImageReady(() => this.redraw());
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => {
      if (this.drag || (!this.nodeHover && !this.segHover && !this.snapHit && !this.alignGuides.length)) return;
      this.nodeHover = this.segHover = null;
      this.clearSnap();
      this.redraw();
    });
    canvas.addEventListener('dblclick', (e) => this.onDouble(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('paste', (e) => this.onPaste(e));
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.space = false;
    });
    const loop = () => {
      if (this.dirty) {
        this.dirty = false;
        this.syncTextLinks();
        this.render();
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  on(fn: (what: 'doc' | 'sel' | 'view' | 'tool') => void) {
    this.listeners.add(fn);
  }
  off(fn: (what: 'doc' | 'sel' | 'view' | 'tool') => void) {
    this.listeners.delete(fn);
  }
  emit(what: 'doc' | 'sel' | 'view' | 'tool') {
    this.dirty = true;
    if (what !== 'view') this.snapVer++;
    if (what === 'doc') this.syncTextLinks();
    this.listeners.forEach((f) => f(what));
    if (what === 'doc') this.scheduleSave();
  }
  redraw() {
    this.dirty = true;
  }

  // ---------- Ansicht ----------

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    if (!this.sized) {
      this.sized = true;
      this.zoomPage();
    }
    this.dirty = true;
  }
  private sized = false;
  get w() {
    return this.canvas.width / this.dpr;
  }
  get h() {
    return this.canvas.height / this.dpr;
  }
  toWorld(sx: number, sy: number): Pt {
    return { x: (sx - this.view.ox) / this.view.zoom, y: (sy - this.view.oy) / this.view.zoom };
  }
  toScreen(p: Pt): Pt {
    return { x: p.x * this.view.zoom + this.view.ox, y: p.y * this.view.zoom + this.view.oy };
  }
  zoomBox(b: Box, pad = 30) {
    const W = this.w - RULER - pad * 2,
      H = this.h - RULER - pad * 2;
    if (W <= 0 || H <= 0) return;
    const z = Math.min(W / Math.max(b.w, 1), H / Math.max(b.h, 1));
    this.view.zoom = Math.min(200, z);
    this.view.ox = RULER + pad + (W - b.w * this.view.zoom) / 2 - b.x * this.view.zoom;
    this.view.oy = RULER + pad + (H - b.h * this.view.zoom) / 2 - b.y * this.view.zoom;
    this.emit('view');
  }
  zoomPage() {
    this.zoomBox({ x: 0, y: 0, w: this.doc.bed.w, h: this.doc.bed.h });
  }
  zoomSelection() {
    const b = this.selBounds();
    if (b) this.zoomBox(b, 60);
  }
  zoomAt(f: number, sx = this.w / 2, sy = this.h / 2) {
    const z = Math.max(0.05, Math.min(500, this.view.zoom * f));
    const wpt = this.toWorld(sx, sy);
    this.view.zoom = z;
    this.view.ox = sx - wpt.x * z;
    this.view.oy = sy - wpt.y * z;
    this.emit('view');
  }
  /** Maschinenkoordinaten (Ursprung unten links) */
  toMachine(p: Pt): Pt {
    return { x: p.x, y: this.doc.bed.h - p.y };
  }

  // ---------- Auswahl ----------

  selBounds(): Box | null {
    return boundsOf(this.sel);
  }
  setSel(objs: Obj[]) {
    if (objs.length !== this.sel.length || objs.some((o, i) => o !== this.sel[i])) {
      this.pivot = null;
      this.rotateMode = false;
    }
    this.sel = objs;
    if (!objs.length) this.rotateMode = false;
    this.emit('sel');
  }
  /** Oberstes Objekt der Ebene 0 unter dem Weltpunkt. */
  hitTest(p: Pt): Obj | null {
    const tol = 4 / this.view.zoom;
    for (let i = this.doc.objs.length - 1; i >= 0; i--) {
      const top = this.doc.objs[i];
      if (this.isLocked(top)) continue;
      for (const [leaf, m] of visibleLeaves([top])) {
        const ly = this.layer(leaf.layer);
        if (!ly.show) continue;
        if (hitLeaf(leaf, m, p, tol, this.filled && ly.mode === 'fill')) return top;
      }
    }
    return null;
  }

  handlePoints(b: Box): Pt[] {
    const a = this.toScreen({ x: b.x, y: b.y }),
      c = this.toScreen({ x: b.x + b.w, y: b.y + b.h });
    const x0 = a.x - HANDLE_OFF,
      y0 = a.y - HANDLE_OFF,
      x1 = c.x + HANDLE_OFF,
      y1 = c.y + HANDLE_OFF,
      xm = (x0 + x1) / 2,
      ym = (y0 + y1) / 2;
    return [
      { x: x0, y: y0 }, { x: xm, y: y0 }, { x: x1, y: y0 }, { x: x1, y: ym },
      { x: x1, y: y1 }, { x: xm, y: y1 }, { x: x0, y: y1 }, { x: x0, y: ym },
    ];
  }
  hitHandle(sx: number, sy: number): number {
    const b = this.selBounds();
    if (!b) return -1;
    const hs = this.handlePoints(b);
    for (let i = 0; i < 8; i++) {
      if (this.rotateMode && i % 2 === 1) continue;
      if (Math.abs(hs[i].x - sx) <= 5 && Math.abs(hs[i].y - sy) <= 5) return i;
    }
    return -1;
  }
  /** Bereich knapp außerhalb der Eckgriffe: dort dreht Ziehen die Auswahl auch im Skaliermodus. */
  hitRotateZone(sx: number, sy: number): boolean {
    const b = this.selBounds();
    if (!b) return false;
    const hs = this.handlePoints(b);
    const inside = sx > hs[0].x && sx < hs[4].x && sy > hs[0].y && sy < hs[4].y;
    if (inside) return false;
    return [0, 2, 4, 6].some((i) => {
      const d = Math.hypot(hs[i].x - sx, hs[i].y - sy);
      return d > 6 && d < 24;
    });
  }
  /** Drehpunkt: frei gesetzter Punkt oder Mitte der Auswahl */
  rotationCenter(): Pt | null {
    const b = this.selBounds();
    if (!b) return null;
    return this.pivot ?? { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  hitPivot(sx: number, sy: number): boolean {
    if (!this.rotateMode) return false;
    const c = this.rotationCenter();
    if (!c) return false;
    const q = this.toScreen(c);
    return Math.hypot(q.x - sx, q.y - sy) < 8;
  }
  startRotate(wp: Pt) {
    this.snapshot(t('Drehen'));
    const c = this.rotationCenter()!;
    this.drag = { type: 'rotate', center: c, a0: Math.atan2(wp.y - c.y, wp.x - c.x), orig: this.sel.map((o) => o.m), angle: 0 };
  }

  // ---------- Werkzeuge ----------

  setTool(t: Tool) {
    if (this.draft) this.finishLine();
    this.tool = t;
    this.nodeHover = this.segHover = null;
    this.jointPicks = [];
    this.jointHover = null;
    this.jointHingeMode = false;
    this.trimHover = null;
    this.startHover = null;
    this.relPicks = [];
    this.relHover = null;
    this.measure = null;
    this.measureCircle = null;
    if (t !== 'sketch') this.sketchEdit = null;
    this.clearSnap();
    this.hint = TOOL_HINTS[t];
    this.canvas.style.cursor = t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair';
    this.emit('tool');
  }
}

// Die Teile in src/editor/ sind Klassen ohne eigene Felder; ihre Methoden haben `this: Editor` und werden hier
// in Editor.prototype kopiert. Neue Methoden kommen in den passenden Teil, neue Felder in die Klasse Editor oben.
export interface Editor
  extends EditorDocument,
    EditorPointer,
    EditorKeyboard,
    EditorSnapping,
    EditorGuides,
    EditorNodes,
    EditorPaths,
    EditorShapeOps,
    EditorJoints,
    EditorHinges,
    EditorCommands,
    EditorObjects,
    EditorText,
    EditorGenerators,
    EditorParams,
    EditorNest,
    EditorSeries,
    EditorCheck,
    EditorLibrary,
    EditorWarp,
    EditorNotes,
    EditorImages,
    EditorTabs,
    EditorRelations,
    EditorSketch,
    EditorRender {}

const PARTS = [
  EditorDocument,
  EditorPointer,
  EditorKeyboard,
  EditorSnapping,
  EditorGuides,
  EditorNodes,
  EditorPaths,
  EditorShapeOps,
  EditorJoints,
  EditorHinges,
  EditorCommands,
  EditorObjects,
  EditorText,
  EditorGenerators,
  EditorParams,
  EditorNest,
  EditorSeries,
  EditorCheck,
  EditorLibrary,
  EditorWarp,
  EditorNotes,
  EditorImages,
  EditorTabs,
  EditorRelations,
  EditorSketch,
  EditorRender,
];
for (const part of PARTS) {
  for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(part.prototype))) {
    if (key !== 'constructor') Object.defineProperty(Editor.prototype, key, desc);
  }
}
