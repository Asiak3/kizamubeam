// Oberfläche: Menü, Leisten, Panels, Palette, Statusleiste.
import { Editor, Tool } from './editor';
import { initSync, openSyncDialog } from './syncDialog';
import type { CornerMode } from './corners';
import { ICONS } from './icons';
import { DITHER_MODES, DitherMode, ImageAdjust, ImageLayer, ImageShape, isCellMode, Layer, layerLabel, Obj, ObjBindKey, pageName, PALETTE, SubPath, TextShape, BarcodeShape, GenShape } from './model';
import { evaluate, formatNumber, namesIn } from './params';
import { deletePreset, loadPresets, presetOutput, savePreset } from './imagePresets';
import { openFillDialog, openSaveTemplateDialog, openSeriesDialog, openTemplateLibrary } from './templateDialogs';
import { exportDxf, exportPdf, exportSvg, importFile, importModel, installDropAndPaste, openProject, saveProcessedBitmap, saveProject } from './files';
import { onMeshReady } from './model3d/store';
import { assetImage, displayCanvas, onImageReady, outputGrid } from './images';
import { onFontListChanged, systemFonts } from './fonts';
import { fontFavorites } from './fontCatalog';
import { openFontManager } from './fontManager';
import { $, evalExpr, f2, h, iconBtn, numInput, sep, setVal } from './dom';
import { openCircularArrayDialog, openGridArrayDialog } from './arrayDialogs';
import { openNestDialog } from './nestDialog';
import { openWorkpieceDialog } from './workpieceDialog';
import { openBackgroundDialog } from './bgDialog';
import { openJointDialog } from './jointDialog';
import { openHingeDialog } from './hingeDialog';
import { openSlotDialog } from './slotDialog';
import { openWarpDialog } from './warpDialog';
import { openQrDialog, openVarTextDialog } from './qrDialog';
import { openBarcodeDialog } from './barcodeDialog';
import { LINEAR_NAMES } from './barcode1d';
import { askGenConvert, openGenDialog } from './generators/dialog';
import { genLabel, getGenerator } from './generators';
import { maybeOfferSetup, openSetupWizard } from './setupWizard';
import { maybeCheckForUpdates, openUpdateDialog } from './updateDialog';
import { openPacksDialog } from './packsDialog';
import { openGridDialog } from './gridDialog';
import { buildLaser, frameJob, openDeviceDialog, openDevicesDialog, openPreview, openRotaryDialog, saveGCode, startJob } from './laser';
import { openLayerDialog } from './layerdialog';
import { openMaterialTestDialog } from './materialtest';
import { openTestPhotoDialog } from './testphotoDialog';
import { BoolBase } from './ops';
import { agentStatus, openAgentDialog } from './agentui';
import { startAgentBridge } from './agent';
import { buildObjectsPanel } from './objectsPanel';
import { buildTabBar, closeTabAsk } from './tabsBar';
import { buildHistoryPanel } from './historyPanel';
import { buildLibraryPanel, openAddSelectionDialog } from './libraryPanel';
import { buildCheckPanel, openCheck } from './checkPanel';
import { openCalibrateDialog } from './calibrateDialog';
import { openFocusTestDialog } from './focustestDialog';
import { openPrintCutDialog } from './printcutDialog';
import { encodeShapes } from './generators/jig';
import { shapesFromSelection } from './generators/jigPanel';
import { openJigFillDialog } from './jigFillDialog';
import { openMultiLayerDialog } from './multilayerDialog';
import { buildParamsPanel, openShowIfDialog } from './paramsPanel';
import { buildNotesPanel } from './notesPanel';
import { buildView3dPanel } from './view3d/panel';
import { buildAppsPanel, openAppsPanel } from './appsPanel';
import { installSketchPanel } from './sketchPanel';
import { isSketchObj } from './editor/sketch';
import { dockWindow, initDock, isHidden, resetLayout, toggleWindow, windowList } from './dock';
import { REL_HINTS, REL_LABELS, REL_MODES, RelMode } from './relations';
import { Action, BarKey, barNames, initToolbars, isBarHidden, openToolbarDialog, refreshBars, SEP, showAllBars, toggleBar } from './toolbars';
import { dec, LangPref, langPref, LANGUAGES, setLangPref, t, tn } from './i18n';
import { version as APP_VERSION } from '../package.json';
import symbolLight from './assets/brand/symbol-64.png';
import symbolDark from './assets/brand/symbol-64-dark.png';
import logoLight from './assets/brand/logo-stacked.png';
import logoDark from './assets/brand/logo-stacked-dark.png';

const FONT_CANDIDATES = [
  'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Calibri', 'Times New Roman', 'Georgia',
  'Garamond', 'Courier New', 'Consolas', 'Impact', 'Comic Sans MS', 'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono',
  'Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'Noto Sans', 'Noto Serif', 'Ubuntu', 'Cantarell',
  'Roboto', 'Open Sans', 'Helvetica Neue', 'Menlo', 'Monaco', 'Avenir', 'Futura', 'Gill Sans',
];

function availableFonts(): string[] {
  const c = document.createElement('canvas').getContext('2d')!;
  const sample = 'abcdefghijklmnopqrstuvwxyzWMI0123456789';
  const widths = (fb: string) => {
    c.font = `40px ${fb}`;
    return c.measureText(sample).width;
  };
  const base = { monospace: widths('monospace'), serif: widths('serif'), 'sans-serif': widths('sans-serif') };
  const found = FONT_CANDIDATES.filter((f) =>
    (Object.keys(base) as (keyof typeof base)[]).some((fb) => {
      c.font = `40px "${f}", ${fb}`;
      return c.measureText(sample).width !== base[fb];
    }),
  );
  return [...found, 'sans-serif', 'serif', 'monospace'];
}

// ======================================================================

// ---------- Design (hell/dunkel) ----------

type ThemeMode = 'system' | 'light' | 'dark';
const THEME_KEY = 'kizamubeam.theme';
let themeMode: ThemeMode = 'system';
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const themeListeners = new Set<() => void>();

/** QR-Code oder Strichcode im passenden Dialog bearbeiten */
function editBarcode(ed: Editor, o: Obj) {
  if (o.shape.kind === 'barcode' && o.shape.type !== 'qr') openBarcodeDialog(ed, o);
  else openQrDialog(ed, o);
}

export function isDark() {
  return themeMode === 'dark' || (themeMode === 'system' && darkQuery.matches);
}

function applyTheme(ed: Editor, mode: ThemeMode) {
  themeMode = mode;
  const root = document.documentElement;
  if (mode === 'system') delete root.dataset.theme;
  else root.dataset.theme = mode;
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* Speicher nicht verfügbar */
  }
  ed.setDark(isDark());
  themeListeners.forEach((f) => f());
}

function initTheme(ed: Editor) {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {
    saved = null;
  }
  applyTheme(ed, saved === 'light' || saved === 'dark' ? saved : 'system');
  darkQuery.addEventListener('change', () => themeMode === 'system' && applyTheme(ed, 'system'));
}

export function buildUI(ed: Editor) {
  translateStatic();
  initTheme(ed);
  dockWindow('cuts', t('Schnitte / Layer'), { bodyId: 'layers' });
  dockWindow('objects', t('Objekte'), { bodyId: 'objects' });
  buildBars(ed);
  buildNumbar(ed);
  buildLayers(ed);
  buildObjectsPanel(ed);
  buildHistoryPanel(ed);
  buildLibraryPanel(ed);
  buildParamsPanel(ed);
  buildNotesPanel(ed);
  buildCheckPanel(ed);
  buildView3dPanel(ed);
  buildAppsPanel(ed);
  buildLaser(ed);
  setTimeout(() => maybeOfferSetup(ed), 300);
  setTimeout(() => maybeCheckForUpdates(), 5000);
  initSync(ed);
  initDock();
  buildMenu(ed);
  buildPalette(ed);
  buildStatus(ed);
  startAgentBridge(ed);
  buildTextEditor(ed);
  ed.onImport = () => importFile(ed);
  // 3D-Modelle aus der automatischen Sicherung kommen etwas später: 3D-Ansicht und Prüfung neu zeichnen
  onMeshReady(() => ed.emit('doc'));
  ed.onGridArray = () => openGridArrayDialog(ed);
  ed.onBarcodeEdit = (o) => editBarcode(ed, o);
  ed.onGenEdit = (o) => (isSketchObj(o) ? void ed.editSketch(o) : openGenDialog(ed, '', o));
  installSketchPanel(ed);
  ed.onGenGuard = askGenConvert;
  ed.onJointDialog = () => openJointDialog(ed);
  ed.onRelDistance = (cur) => askDistance(cur);
  installDropAndPaste(ed, $('#stage'));
  buildTabBar(ed);
  window.addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 't' && ed.selImages().length) {
      e.preventDefault();
      openTraceDialog(ed);
    }
  });
}

// ---------- Sprache ----------

/** Sprachwahl speichern; die Oberfläche wird dafür neu aufgebaut (Neuladen), die Zeichnung bleibt. */
function changeLanguage(ed: Editor, p: LangPref) {
  if (!setLangPref(p)) return;
  if (confirm(t('Für den Sprachwechsel wird die Oberfläche neu geladen. Die Zeichnung bleibt erhalten, der Rückgängig-Verlauf nicht. Jetzt neu laden?'))) {
    ed.saveNow();
    location.reload();
  } else ed.hint = t('Die neue Sprache gilt ab dem nächsten Start.');
  ed.emit('tool');
}

/** Feste Texte aus index.html */
function translateStatic() {
  document.title = 'KizamuBeam';
  ($('#texteditor textarea') as HTMLTextAreaElement).placeholder = t('Text eingeben …');
  $('#texteditor .hint').textContent = t('Enter: neue Zeile · Ctrl+Enter oder Esc: fertig');
}

// ---------- Menü ----------

/** checked: Häkchen vor dem Eintrag (z. B. sichtbare Fenster); sub: Untermenü */
type MenuItem = [label: string, key: string, action: () => void, checked?: () => boolean] | { sub: string; items: MenuItem[] } | 'sep';

function buildMenu(ed: Editor) {
  const menus: [string, MenuItem[]][] = [
    [t('Datei'), [
      [t('Neu'), 'Ctrl+N', () => ed.newTab()],
      [t('Neu aus Vorlage …'), '', () => openTemplateLibrary(ed)],
      [t('Öffnen …'), 'Ctrl+O', () => openProject(ed)],
      [t('Speichern …'), 'Ctrl+S', () => saveProject(ed)],
      [t('Tab schließen'), '', () => closeTabAsk(ed)],
      'sep',
      [t('Als Vorlage speichern …'), '', () => openSaveTemplateDialog(ed)],
      [t('Vorlage ausfüllen …'), '', () => openFillDialog(ed)],
      [t('Serie aus Tabelle (CSV) …'), '', () => openSeriesDialog(ed)],
      'sep',
      [t('Importieren …'), 'Ctrl+I', () => importFile(ed)],
      { sub: t('Exportieren'), items: [
        [t('Als SVG exportieren …'), '', () => exportSvg(ed)],
        [t('Als DXF exportieren …'), '', () => exportDxf(ed)],
        [t('Als PDF exportieren …'), '', () => exportPdf(ed, 'pdf')],
        [t('Als Illustrator-Datei (AI) exportieren …'), '', () => exportPdf(ed, 'ai')],
      ] },
      [t('Bearbeitetes Bild speichern …'), '', () => saveProcessedBitmap(ed)],
      'sep',
      [t('Schriften …'), '', () => openFontManager(ed)],
      [t('Erweiterungen …'), '', () => openPacksDialog()],
      [t('Einstellungen übertragen …'), '', () => openSyncDialog(ed)],
      [t('KI-Agenten (MCP) …'), '', () => openAgentDialog(ed)],
    ]],
    [t('Bearbeiten'), [
      [t('Rückgängig'), 'Ctrl+Z', () => ed.doUndo()],
      [t('Wiederholen'), 'Ctrl+Y', () => ed.doRedo()],
      'sep',
      [t('Ausschneiden'), 'Ctrl+X', () => ed.cut()],
      [t('Kopieren'), 'Ctrl+C', () => ed.copy()],
      [t('Einfügen'), 'Ctrl+V', () => ed.paste()],
      [t('Duplizieren'), 'Ctrl+D', () => ed.duplicate()],
      [t('Löschen'), t('Entf'), () => ed.deleteSel()],
      'sep',
      [t('Alles auswählen'), 'Ctrl+A', () => ed.selectAll()],
      [t('In Pfad umwandeln'), 'Ctrl+Shift+C', () => ed.convertSelToPath()],
      'sep',
      [t('Sichtbar, wenn …'), '', () => openShowIfDialog(ed, ed.sel)],
      [t('Zur Bibliothek hinzufügen …'), '', () => openAddSelectionDialog(ed)],
    ]],
    [t('Werkzeuge'), [
      [t('Werkzeugkasten …'), '', () => openAppsPanel()],
      'sep',
      [t('Auswählen'), 'Esc', () => ed.setTool('select')],
      [t('Knoten bearbeiten'), 'Ctrl+`', () => ed.setTool('node')],
      'sep',
      [t('Linien zeichnen'), 'Ctrl+L', () => ed.setTool('line')],
      [t('Rechteck'), 'Ctrl+R', () => ed.setTool('rect')],
      [t('Ellipse'), 'Ctrl+E', () => ed.setTool('ellipse')],
      [t('Polygon'), '', () => ed.setTool('polygon')],
      [t('Text'), 'Ctrl+T', () => ed.setTool('text')],
      [t('Messen'), '', () => ed.setTool('measure')],
      'sep',
      { sub: t('Boolesche Operationen'), items: [
        [t('Vereinen'), 'Alt++', () => ed.booleanSel('union')],
        [t('Abziehen'), 'Alt+-', () => ed.booleanSel('subtract')],
        [t('Vordere vom hinteren abziehen'), '', () => ed.booleanSel('subtract', 'back')],
        [t('Hintere vom vorderen abziehen'), '', () => ed.booleanSel('subtract', 'front')],
        [t('Schnittmenge'), 'Alt+*', () => ed.booleanSel('intersect')],
        'sep',
        [t('Boolesche Optionen …'), '', () => openBooleanDialog(ed)],
      ] },
      [t('Offset …'), 'Alt+O', () => openOffsetDialog(ed)],
      [t('Verformen …'), '', () => openWarpDialog(ed)],
      { sub: t('Pfad'), items: [
        [t('Pfad schließen'), '', () => ed.closeSel()],
        [t('Pfade mit Toleranz schließen …'), '', () => openCloseDialog(ed)],
        [t('Ausgewählte Formen verbinden'), 'Alt+J', () => ed.joinSel()],
        [t('Zerlegen'), 'Alt+B', () => ed.breakApartSel()],
        [t('Richtung umkehren'), '', () => ed.reverseSel()],
        [t('Ecken runden oder fasen …'), '', () => openCornerDialog(ed)],
        'sep',
        [t('Formen trimmen'), 'Ctrl+K', () => ed.setTool('trim')],
        [t('Startpunkt setzen'), '', () => ed.setTool('start')],
        'sep',
        [t('Mittelpunkte markieren'), '', () => ed.markCentersSel()],
      ] },
      { sub: t('Array'), items: [
        [t('Rasterarray …'), 'Ctrl+Shift+A', () => openGridArrayDialog(ed)],
        [t('Kreisarray …'), '', () => openCircularArrayDialog(ed)],
      ] },
      'sep',
      { sub: t('Textfunktionen'), items: [
        [t('Text auf Pfad'), '', () => ed.applyPathToText()],
        [t('Text vom Pfad lösen'), '', () => ed.removePathFromText()],
        'sep',
        [t('Variabler Text …'), '', () => openVarTextDialog(ed)],
        [t('Variablen Text festschreiben'), '', () => bakeVarText(ed)],
      ] },
      { sub: t('Bild'), items: [
        [t('Bild anpassen …'), '', () => openAdjustDialog(ed)],
        [t('Bild nachzeichnen …'), 'Alt+T', () => openTraceDialog(ed)],
        [t('Hintergrund entfernen …'), '', () => openBackgroundDialog(ed)],
        [t('Bild zuschneiden'), '', () => ed.cropImageSel(false)],
        [t('Maske auf Bild anwenden'), '', () => ed.cropImageSel(true)],
      ] },
    ]],
    [t('Anordnen'), [
      [t('Gruppieren'), 'Ctrl+G', () => ed.group()],
      [t('Gruppierung aufheben'), 'Ctrl+U', () => ed.ungroup()],
      'sep',
      { sub: t('Spiegeln und drehen'), items: [
        [t('Horizontal spiegeln'), 'Ctrl+Shift+H', () => ed.mirror(true)],
        [t('Vertikal spiegeln'), 'Ctrl+Shift+V', () => ed.mirror(false)],
        'sep',
        [t('90° im Uhrzeigersinn'), '.', () => ed.rotateBy(-90)],
        [t('90° gegen Uhrzeigersinn'), ',', () => ed.rotateBy(90)],
      ] },
      { sub: t('Ausrichten und verteilen'), items: [
        [t('Links ausrichten'), 'L', () => ed.align('left')],
        [t('Rechts ausrichten'), 'R', () => ed.align('right')],
        [t('Oben ausrichten'), 'T', () => ed.align('top')],
        [t('Unten ausrichten'), 'B', () => ed.align('bottom')],
        [t('Mitten horizontal'), 'C', () => ed.align('hcenter')],
        [t('Mitten vertikal'), 'E', () => ed.align('vcenter')],
        'sep',
        [t('Horizontal verteilen'), '', () => ed.distribute(true)],
        [t('Vertikal verteilen'), '', () => ed.distribute(false)],
      ] },
      { sub: t('Beziehungen'), items: [
        ...REL_MODES.map((m): MenuItem => [REL_LABELS[m], '', () => ed.startRelation(m), () => ed.tool === 'relate' && ed.relMode === m]),
      ] },
      'sep',
      [t('Verschachteln …'), '', () => openNestDialog(ed)],
      'sep',
      [t('Nicht lasern'), '', () => ed.toggleNoLaser(), () => ed.sel.length > 0 && ed.sel.every((o) => o.noLaser)],
    ]],
    [t('Seiten'), [
      [t('Neue Seite'), '', () => ed.addPage()],
      [t('Seite duplizieren'), '', () => ed.duplicatePage()],
      [t('Seite löschen'), '', () => ed.deletePage()],
      'sep',
      [t('Vorherige Seite'), t('Bild ↑'), () => ed.setPage(ed.doc.page - 1)],
      [t('Nächste Seite'), t('Bild ↓'), () => ed.setPage(ed.doc.page + 1)],
      'sep',
      { sub: t('Auswahl verschieben'), items: [
        [t('Auswahl auf vorherige Seite'), '', () => ed.moveToPage(ed.sel, ed.doc.page - 1)],
        [t('Auswahl auf nächste Seite'), '', () => ed.moveToPage(ed.sel, ed.doc.page + 1)],
      ] },
    ]],
    [t('Laser'), [
      [t('Konstruktion prüfen'), '', () => openCheck()],
      [t('Vorschau …'), 'Alt+P', () => openPreview(ed)],
      [t('G-Code speichern …'), '', () => saveGCode(ed)],
      'sep',
      [t('Start'), '', () => startJob(ed)],
      [t('Rahmen'), '', () => frameJob(ed, false)],
      [t('Kontur-Rahmen'), '', () => frameJob(ed, true)],
      'sep',
      [t('Laser einrichten …'), '', () => openSetupWizard(ed)],
      { sub: t('Test und Kalibrieren'), items: [
        [t('Materialtest …'), '', () => openMaterialTestDialog(ed)],
        [t('Materialtest auswerten …'), '', () => openTestPhotoDialog(ed)],
        [t('Fokustest …'), '', () => openFocusTestDialog(ed)],
        [t('Passung kalibrieren …'), '', () => openCalibrateDialog(ed)],
      ] },
      { sub: t('Gerät'), items: [
        [t('Geräte …'), '', () => openDevicesDialog(ed)],
        [t('Geräteeinstellungen …'), '', () => openDeviceDialog(ed)],
        [t('Drehachse (Rotary) …'), '', () => openRotaryDialog()],
      ] },
      { sub: 'FluidNC', items: [
        [t('Konfiguration …'), '', () => import('./fluidncDialog').then((m) => m.openFluidConfig())],
        [t('Dateien auf der Steuerung …'), '', () => import('./fluidncDialog').then((m) => m.openFluidFiles(ed))],
      ] },
    ]],
    [t('Ansicht'), [
      [t('Ganze Seite'), 'Ctrl+0', () => ed.zoomPage()],
      [t('Auf Auswahl zoomen'), '', () => ed.zoomSelection()],
      [t('Vergrößern'), '+', () => ed.zoomAt(1.25)],
      [t('Verkleinern'), '-', () => ed.zoomAt(0.8)],
      'sep',
      [t('Drahtgitter / Gefüllt'), 'Alt+W', () => ((ed.filled = !ed.filled), ed.emit('view'))],
      { sub: t('Mittelpunkte zeigen'), items: [
        [t('Aus|Mittelpunkte'), '', () => ed.setSnap({ centers: 'off' }), () => ed.centerMarks === 'off'],
        [t('Bei Auswahl und unter dem Mauszeiger'), '', () => ed.setSnap({ centers: 'auto' }), () => ed.centerMarks === 'auto'],
        [t('Immer|Mittelpunkte'), '', () => ed.setSnap({ centers: 'all' }), () => ed.centerMarks === 'all'],
      ] },
      'sep',
      { sub: t('Gitter'), items: [
        [t('Gitter anzeigen'), '', () => ed.setGrid({ show: !ed.grid.show }), () => ed.grid.show],
        [t('Gitter einstellen …'), '', () => openGridDialog(ed)],
      ] },
      { sub: t('Hilfslinien'), items: [
        [t('Hilfslinien anzeigen'), '', () => ed.setGuideLayer({ hidden: ed.guidesShown() }), () => ed.guidesShown()],
        [t('Hilfslinien sperren'), '', () => ed.setGuideLayer({ locked: !ed.doc.guidesLocked }), () => !!ed.doc.guidesLocked],
        [t('Alle Hilfslinien löschen'), '', () => ed.clearGuides()],
      ] },
      'sep',
      { sub: t('Design'), items: [
        [t('Wie System|Design'), '', () => applyTheme(ed, 'system'), () => themeMode === 'system'],
        [t('Hell|Design'), '', () => applyTheme(ed, 'light'), () => themeMode === 'light'],
        [t('Dunkel|Design'), '', () => applyTheme(ed, 'dark'), () => themeMode === 'dark'],
      ] },
      { sub: t('Sprache'), items: [
        [t('Wie System|Sprache'), '', () => changeLanguage(ed, 'system'), () => langPref() === 'system'],
        ...LANGUAGES.map(([code, name]): MenuItem => [name, '', () => changeLanguage(ed, code), () => langPref() === code]),
      ] },
    ]],
    [t('Fenster'), [
      ...windowList().map(({ id, title }): MenuItem => [title, '', () => toggleWindow(id), () => !isHidden(id)]),
      'sep',
      { sub: t('Funktionsleisten'), items: [
        ...(Object.entries(barNames()) as [BarKey, string][]).map(([k, name]): MenuItem => [name, '', () => toggleBar(k), () => !isBarHidden(k)]),
        'sep',
        [t('Funktionsleisten anpassen …'), '', () => openToolbarDialog()],
      ] },
      'sep',
      [t('Fenster und Leisten zurücksetzen'), '', () => (resetLayout(), showAllBars())],
    ]],
    [t('Hilfe'), [[t('Tastenkürzel'), 'F1', () => showHelp()], 'sep', [t('Nach Updates suchen …'), '', () => openUpdateDialog()], [t('Über KizamuBeam …'), '', () => showAbout()]]],
  ];
  const bar = $('#menubar');
  const brand = h('img', { class: 'menubar-brand', alt: 'KizamuBeam', title: 'KizamuBeam', onclick: () => showAbout() }) as HTMLImageElement;
  const brandSrc = () => (brand.src = isDark() ? symbolDark : symbolLight);
  brandSrc();
  themeListeners.add(brandSrc);
  bar.append(brand);
  let openMenu: HTMLElement | null = null;
  const close = () => {
    openMenu?.classList.remove('open');
    openMenu = null;
  };
  // Einträge (auch Untermenüs, die beim Überfahren aufklappen) in eine Liste füllen;
  // Häkchen werden beim Öffnen des Hauptmenüs aktualisiert
  const fill = (list: HTMLElement, items: MenuItem[], checks: (() => void)[]) => {
    let hasChecks = false;
    for (const it of items) {
      if (it === 'sep') list.append(h('hr'));
      else if (!Array.isArray(it)) {
        const subList = h('div', { class: 'menu-items' });
        fill(subList, it.items, checks);
        const sub = h('div', { class: 'submenu' }, h('button', { class: 'submenu-head' }, h('span', {}, it.sub), h('span', { class: 'submenu-arrow' }, '▸')), subList);
        // Untermenü links aufklappen, wenn rechts kein Platz ist
        sub.addEventListener('mouseenter', () => {
          sub.classList.remove('flip');
          if (sub.getBoundingClientRect().right + subList.offsetWidth > window.innerWidth) sub.classList.add('flip');
        });
        list.append(sub);
      } else {
        const b = h('button', { onclick: () => (close(), it[2]()) }, h('span', {}, it[0]), it[1] ? h('kbd', {}, it[1]) : null);
        const checked = it[3];
        if (checked) {
          const mark = h('span', { class: 'check-mark' });
          b.prepend(mark);
          checks.push(() => (mark.textContent = checked() ? '✓' : ''));
          hasChecks = true;
        }
        list.append(b);
      }
    }
    list.classList.toggle('with-checks', hasChecks);
  };
  for (const [title, items] of menus) {
    const box = h('div', { class: 'menu' });
    const btn = h('button', {}, title);
    const list = h('div', { class: 'menu-items' });
    const checks: (() => void)[] = [];
    fill(list, items, checks);
    const open = () => {
      checks.forEach((f) => f());
      box.classList.add('open');
      openMenu = box;
    };
    btn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      if (openMenu === box) return close();
      close();
      open();
    });
    btn.addEventListener('mouseenter', () => {
      if (openMenu && openMenu !== box) {
        close();
        open();
      }
    });
    box.append(btn, list);
    bar.append(box);
  }
  document.addEventListener('mousedown', (e) => {
    if (openMenu && !openMenu.contains(e.target as Node)) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F1') {
      e.preventDefault();
      showHelp();
    }
  });
}

/** Logo, Version, Herkunft des Namens und Lizenz */
function showAbout() {
  const dlg = h(
    'dialog',
    { class: 'about' },
    h('img', { src: isDark() ? logoDark : logoLight, alt: 'KizamuBeam' }),
    h('p', {}, t('Version {version}', { version: APP_VERSION })),
    h('p', {}, t('„Kizamu“ (刻む) ist japanisch und heißt einritzen, gravieren, fein schneiden.')),
    h('p', {}, t('© 2026 Hanjo Winter · github.com/negurvulkan')),
    h('p', { class: 'note' }, t('Entwickelt mit Unterstützung von Claude Code.')),
    h('p', { class: 'note' }, t('Freie Software unter der GNU General Public License, Version 3 oder neuer.')),
    h('p', {}, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen'))),
  );
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

function showHelp() {
  const rows: [string, string][] = [
    ['Esc', t('Auswahlwerkzeug / Auswahl aufheben')],
    ['Ctrl+L / R / E / T', t('Linie / Rechteck / Ellipse / Text')],
    ['Ctrl+`', t('Knoten bearbeiten')],
    [t('Klick auf Auswahl'), t('Zwischen Skalieren und Drehen wechseln')],
    [t('Shift / Ctrl beim Ziehen'), t('Proportional bzw. frei / von der Mitte')],
    [t('Pfeiltasten'), t('1 mm verschieben (Shift 10 mm, Alt 0,1 mm)')],
    [t('. und ,'), t('90° drehen')],
    ['L R T B C E', t('Ausrichten (mehrere Objekte gewählt)')],
    [t('Leertaste + Ziehen, Mitteltaste'), t('Ansicht verschieben')],
    [t('Mausrad'), t('Zoomen')],
    [t('Knoten: D I L C E S'), t('Löschen, Einfügen, Gerade, Kurve, Ecke, Glatt')],
    ['Alt+W', t('Drahtgitter / Gefüllt')],
    [t('Ctrl beim Ziehen'), t('Fangen vorübergehend umkehren (aus, wenn eingeschaltet)')],
    [t('Alt beim Ziehen'), t('Stärker fangen und Ausrichtungshilfen an anderen Objekten')],
    [t('Aus dem Lineal ziehen'), t('Hilfslinie auf eigener Ebene, wird nie gelasert (verschieben durch Ziehen, zurück ins Lineal: löschen)')],
    ['Ctrl+I', t('Importieren (Bilder, SVG, DXF, PDF, AI, 3D-Modelle); Dateien auch auf die Arbeitsfläche ziehen oder mit Ctrl+V einfügen')],
    ['Ctrl+Shift+A', t('Rasterarray')],
    ['Alt++ / Alt+- / Alt+*', t('Vereinen / Abziehen / Schnittmenge')],
    ['Alt+T', t('Bild nachzeichnen')],
    ['Alt+P', t('Vorschau mit Zeitschätzung')],
    [t('Palette'), t('Farbe anklicken = Auswahl diesem Layer zuordnen')],
  ];
  const dlg = h(
    'dialog',
    {},
    h('h3', {}, t('Tastenkürzel')),
    h('table', {}, ...rows.map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, d)))),
    h('p', {}, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen'))),
  );
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- Numerik-, Form- und Textleiste ----------

function buildNumbar(ed: Editor) {
  const bar = $('#numbar');
  let ax = 0.5,
    ay = 0.5,
    lock = true;
  const bed = () => ed.doc.bed;
  // Formeln mit Projekt-Parametern: statt einer Zahl z. B. „Breite + 10“ eintragen (nur bei einem Objekt)
  const single = () => (ed.sel.length === 1 ? ed.sel[0] : null);
  const say = (msg: string) => ((ed.hint = msg), ed.emit('tool'));
  const formula = (key: ObjBindKey) => (src: string): boolean => {
    const o = single();
    if (!src) {
      if (!o?.bind?.[key]) return false;
      ed.setObjBind(o, key, '');
      return true;
    }
    if (!namesIn(src).length) return false;
    if (!o) return say(t('Formeln gehen nur bei einem einzelnen Objekt. Mehrere Objekte vorher gruppieren.')), false;
    if ((key === 'w' || key === 'h') && o.shape.kind === 'gen') return say(t('Die Größe parametrischer Bauteile kommt aus ihren Parametern; dort eine Formel eintragen.')), false;
    const issues = ed.setObjBind(o, key, src, { anchor: [ax, ay], lock });
    say(issues.length ? issues.map((i) => i.msg).join('; ') : t('Formel gesetzt: ändert sich ein Parameter, wird der Wert neu berechnet. Eine Zahl eintragen löst die Formel.'));
    return true;
  };
  /** Feld mit Formel: Eine eingetippte Zahl löst die Formel (nach dem Undo-Schritt der Änderung) */
  const plain = (keys: ObjBindKey[], f: (v: number) => void) => (v: number) => {
    f(v);
    ed.dropObjBind(ed.sel, keys);
    refresh();
  };
  const bindField = (el: HTMLInputElement, key: ObjBindKey, fallback: string, objOk: (o: Obj) => boolean = () => true) => {
    const o = single();
    const src = o && objOk(o) ? o.bind?.[key] : undefined;
    el.classList.toggle('bound', !!src);
    if (!el.dataset.title) el.dataset.title = el.title;
    if (src) {
      setVal(el, src);
      let v = '';
      try {
        const r = evaluate(src);
        v = typeof r === 'number' ? formatNumber(r) : String(r);
      } catch (e) {
        v = e instanceof Error ? e.message : String(e);
      }
      el.title = `${el.dataset.title}\n${t('Formel: {src} = {v}', { src, v })}`;
    } else {
      setVal(el, fallback);
      el.title = el.dataset.title;
    }
  };
  const fx = numInput('num', plain(['x'], (v) => ed.setSelBox({ x: v }, ax, ay, lock)), t('X-Position (mm)'), formula('x'));
  const fy = numInput('num', plain(['y'], (v) => ed.setSelBox({ y: bed().h - v }, ax, ay, lock)), t('Y-Position (mm, Ursprung unten links)'), formula('y'));
  const fw = numInput('num', plain(['w', 'h'], (v) => ed.setSelBox({ w: v }, ax, ay, lock)), t('Breite (mm)'), formula('w'));
  const fh = numInput('num', plain(['w', 'h'], (v) => ed.setSelBox({ h: v }, ax, ay, lock)), t('Höhe (mm)'), formula('h'));
  const fwp = numInput('small', (v) => {
    const b = ed.selBounds();
    if (b) ed.setSelBox({ w: (b.w * v) / 100 }, ax, ay, lock);
  }, t('Breite in %'));
  const fhp = numInput('small', (v) => {
    const b = ed.selBounds();
    if (b) ed.setSelBox({ h: (b.h * v) / 100 }, ax, ay, lock);
  }, t('Höhe in %'));
  const currentRot = () => {
    if (ed.sel.length !== 1) return 0;
    const m = ed.sel[0].m;
    return (-Math.atan2(m[1], m[0]) * 180) / Math.PI;
  };
  const fr = numInput('small', plain(['rot'], (v) => {
    const b = ed.selBounds();
    if (!b) return;
    ed.rotateBy(v - currentRot(), { x: b.x + ax * b.w, y: b.y + ay * b.h });
  }), t('Drehung in Grad (gegen den Uhrzeigersinn)'), formula('rot'));
  const lockBtn = h('button', { class: 'ib on', title: t('Seitenverhältnis sperren'), html: ICONS.lock });
  lockBtn.addEventListener('click', () => {
    lock = !lock;
    lockBtn.classList.toggle('on', lock);
    lockBtn.innerHTML = lock ? ICONS.lock : ICONS.unlock;
  });
  const anchor = h('div', { class: 'anchor', title: t('Bezugspunkt') });
  const anchorBtns: HTMLButtonElement[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const b = h('button', {
        onclick: () => {
          ax = c / 2;
          ay = r / 2;
          anchorBtns.forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          refresh();
        },
      });
      if (r === 1 && c === 1) b.classList.add('on');
      anchorBtns.push(b);
      anchor.append(b);
    }
  const geo = h(
    'div',
    { class: 'field' },
    h('label', {}, 'X', fx), h('label', {}, 'Y', fy), anchor,
    h('label', {}, t('B'), fw), h('label', {}, t('H'), fh), lockBtn,
    h('label', {}, fwp, '%'), h('label', {}, fhp, '%'),
    h('label', {}, '↻', fr, '°'), h('span', { class: 'toggle', title: t('Einheit') }, 'mm'),
  );

  // Formeigenschaften
  const fRad = numInput('small', plain(['r'], (v) => ed.updateShapes('rect', { r: Math.max(0, v) })), t('Eckenradius (mm)'), formula('r'));
  const fSides = numInput('small', plain(['sides'], (v) => ed.updateShapes('polygon', { sides: Math.max(3, Math.min(64, Math.round(v))) })), t('Anzahl Ecken'), formula('sides'));
  const starBtn = h('button', { class: 'toggle', title: t('Stern') }, t('Stern'));
  starBtn.addEventListener('click', () => ed.updateShapes('polygon', { star: !starBtn.classList.contains('on') }));
  const rectProps = h('label', {}, t('Radius'), fRad);
  const polyProps = h('span', { class: 'field' }, h('label', {}, t('Ecken'), fSides), starBtn);

  // Text
  const fontSel = h('select', { title: t('Schriftart') }) as HTMLSelectElement;
  // Favoriten (Font-Manager) oben, darunter alle; ganz unten öffnet „Weitere Schriften …“ den Font-Manager
  const MANAGE = '\u0000manage';
  let fontNames = availableFonts();
  let lastFont = fontNames[0] ?? '';
  const fillFonts = () => {
    const cur = fontSel.value || lastFont;
    const lower = new Set(fontNames.map((f) => f.toLowerCase()));
    const favs = fontFavorites().filter((f) => lower.has(f.toLowerCase()));
    const opts = (l: string[]) => l.map((f) => h('option', { value: f }, f));
    fontSel.replaceChildren(
      ...(favs.length ? [h('optgroup', { label: t('Favoriten') }, ...opts(favs)), h('optgroup', { label: t('Alle Schriften') }, ...opts(fontNames))] : opts(fontNames)),
      h('option', { value: MANAGE }, t('Weitere Schriften …')),
    );
    // Schrift eines Texts, die (noch) fehlt, bleibt sichtbar
    if (cur && !lower.has(cur.toLowerCase())) fontSel.prepend(h('option', { value: cur }, cur));
    fontSel.value = cur;
  };
  fillFonts();
  fontSel.addEventListener('change', () => {
    if (fontSel.value === MANAGE) {
      fontSel.value = lastFont;
      void openFontManager(ed);
      return;
    }
    lastFont = fontSel.value;
    ed.updateTexts({ font: fontSel.value });
  });
  const loadFontList = () =>
    systemFonts().then((list) => {
      if (list?.length) fontNames = list;
      fillFonts();
    });
  void loadFontList();
  onFontListChanged(() => void loadFontList());
  const fSize = numInput('small', plain(['size'], (v) => v > 0 && ed.updateTexts({ size: v })), t('Schriftgröße (mm)'), formula('size'));
  const fHs = numInput('small', (v) => ed.updateTexts({ hSpace: v }), t('Zeichenabstand (mm)'));
  const fVs = numInput('small', (v) => ed.updateTexts({ vSpace: v }), t('Zeilenabstand (mm)'));
  const tog = (label: string, key: 'bold' | 'italic' | 'upper', title: string) => {
    const b = h('button', { class: 'toggle', title }, label);
    b.addEventListener('click', () => ed.updateTexts({ [key]: !b.classList.contains('on') } as Partial<TextShape>));
    return b;
  };
  const bBold = tog(t('F'), 'bold', t('Fett'));
  bBold.style.fontWeight = '700';
  const bItal = tog(t('K'), 'italic', t('Kursiv'));
  bItal.style.fontStyle = 'italic';
  const bUp = tog('AB', 'upper', t('Großbuchstaben'));
  const alignBtns = (['left', 'center', 'right'] as const).map((a) => {
    const b = iconBtn(a === 'left' ? 'alignTextL' : a === 'center' ? 'alignTextC' : 'alignTextR', a === 'left' ? t('Ausrichtung links') : a === 'center' ? t('Ausrichtung mittig') : t('Ausrichtung rechts'), () => ed.updateTexts({ align: a }));
    b.style.width = b.style.height = '24px';
    b.dataset.align = a;
    return b;
  });
  const bWeld = h('button', { class: 'toggle', title: t('Buchstaben schweißen: überlappende Zeichen zu einer Kontur verschmelzen') }, t('Schweißen'));
  bWeld.addEventListener('click', () => ed.updateTexts({ weld: !bWeld.classList.contains('on') }));
  // Text auf Pfad
  const bOnPath = h('button', { class: 'toggle', title: t('Text folgt der gewählten Form (Text und eine Form auswählen)') }, t('Auf Pfad'));
  bOnPath.addEventListener('click', () => ed.applyPathToText());
  const fPOff = numInput('small', (v) => ed.updateTextPath({ offset: v }), t('Verschiebung entlang der Kurve (mm)'));
  const fPDist = numInput('small', (v) => ed.updateTextPath({ dist: v }), t('Abstand der Grundlinie zur Kurve (mm)'));
  const bPFlip = h('button', { class: 'toggle', title: t('Text auf die andere Seite der Kurve legen') }, t('Seite|Text auf Pfad'));
  bPFlip.addEventListener('click', () => ed.updateTextPath({ flip: !bPFlip.classList.contains('on') }));
  const bPOff = h('button', { class: 'toggle', title: t('Text wieder gerade setzen') }, t('Lösen'));
  bPOff.addEventListener('click', () => ed.removePathFromText());
  // Variabler Text und Höchstbreite
  const bVar = h('button', { class: 'toggle', title: t('Variabler Text: Platzhalter wie %# (Seriennummer), %Y (Jahr) oder %0 (CSV-Spalte) ersetzen') }, t('Variabel'));
  bVar.addEventListener('click', () => {
    const on = !bVar.classList.contains('on');
    ed.updateTexts({ vt: on ? { offset: 0 } : undefined });
    if (on && !ed.selTexts().some((o) => /%/.test((o.shape as TextShape).text)))
      (ed.hint = t('Variabler Text an. Platzhalter wie %# in den Text schreiben; Übersicht unter „Variabler Text …“.')), ed.emit('tool');
  });
  const fVtOff = numInput('small', (v) => ed.updateTexts({ vt: { offset: Math.round(v) } }), t('Versatz: wird zur aktuellen Nummer addiert'));
  const bVtDlg = h('button', { class: 'toggle', title: t('Nummer, CSV-Datei und Platzhalter'), onclick: () => openVarTextDialog(ed) }, '…');
  const vtProps = h('span', { class: 'field' }, h('label', {}, t('Versatz|Variabler Text'), fVtOff), bVtDlg);
  const fMaxW = numInput('small', plain(['maxW'], (v) => ed.updateTexts({ maxW: Math.max(0, v) })), t('Höchstbreite (mm): breitere Zeilen werden gestaucht (mit „Verkleinern“ verkleinert, mit „Umbrechen“ umbrochen), 0 = aus'), formula('maxW'));
  const fMaxH = numInput('small', plain(['maxH'], (v) => ed.updateTexts({ maxH: Math.max(0, v) })), t('Höchsthöhe (mm): ein höherer Textblock wird gleichmäßig verkleinert, 0 = aus'), formula('maxH'));
  const bShrink = h('button', { class: 'toggle', title: t('Text in Rahmen einpassen: zu breiten Text gleichmäßig verkleinern statt stauchen') }, t('Verkleinern|Text einpassen'));
  bShrink.addEventListener('click', () => ed.updateTexts({ fit: bShrink.classList.contains('on') ? undefined : 'shrink' }));
  const bWrap = h('button', { class: 'toggle', title: t('Textrahmen: Zeilen an der Max. Breite umbrechen, die Höhe wächst mit (Rahmen auch mit dem Textwerkzeug aufziehen)') }, t('Umbrechen|Textrahmen'));
  bWrap.addEventListener('click', () => ed.toggleTextWrap());
  const pathProps = h('span', { class: 'field' }, h('label', {}, t('Versatz'), fPOff), h('label', {}, t('Abstand|Text auf Pfad'), fPDist), bPFlip, bPOff);
  const textProps = h(
    'div',
    { class: 'field' },
    h('label', {}, t('Schrift'), fontSel), h('label', {}, t('Höhe'), fSize),
    h('label', {}, t('Abst. H'), fHs), h('label', {}, 'V', fVs), h('label', {}, t('Max. Breite'), fMaxW), h('label', {}, t('Max. Höhe'), fMaxH), bShrink, bWrap, ...alignBtns, bBold, bItal, bUp, bWeld, bOnPath, pathProps, bVar, vtProps,
  );

  // Knotenbearbeitung
  const nodeBtn = (label: string, title: string, f: () => void) => h('button', { class: 'toggle', title, onclick: f }, label);
  const nodeInfo = h('span', { class: 'muted' });
  const nodeProps = h(
    'div',
    { class: 'field' },
    nodeInfo,
    nodeBtn(t('Gerade'), t('Segmente zwischen den ausgewählten Knoten in Geraden umwandeln (L)'), () => ed.setSegmentType(false)),
    nodeBtn(t('Kurve'), t('Segmente zwischen den ausgewählten Knoten in Kurven umwandeln (C)'), () => ed.setSegmentType(true)),
    nodeBtn(t('Ecke'), t('Ausgewählte Knoten zu Ecken machen, Anfasser entfernen (E)'), () => ed.setNodeType(false)),
    nodeBtn(t('Glatt'), t('Ausgewählte Knoten glätten (S)'), () => ed.setNodeType(true)),
    nodeBtn(t('Löschen'), t('Ausgewählte Knoten löschen (Entf)'), () => ed.deleteNodes()),
    nodeBtn(t('Ecken …'), t('Ausgewählte Ecken runden, innen runden oder fasen'), () => openCornerDialog(ed)),
  );
  const sepNode = sep();

  // Bilder
  const imgInfo = h('span', { class: 'muted' });
  const imgProps = h(
    'div',
    { class: 'field' },
    h('span', { html: ICONS.image, class: 'muted icon-inline' }), imgInfo,
    h('button', { class: 'toggle', title: t('Helligkeit, Kontrast, Gamma, Schärfen, Bildmodus'), onclick: () => openAdjustDialog(ed) }, t('Anpassen …')),
    h('button', { class: 'toggle', title: t('Bild in Vektoren umwandeln (Alt+T)'), onclick: () => openTraceDialog(ed) }, t('Nachzeichnen …')),
    h('button', { class: 'toggle', title: t('Hintergrund freistellen: ähnliche Farben werden transparent und nicht gelasert'), onclick: () => openBackgroundDialog(ed) }, t('Freistellen …')),
  );
  // Zuschneiden und Maske: nur sichtbar, wenn neben einem Bild auch Formen gewählt sind
  const cropBtns = [
    h('button', { class: 'toggle', title: t('Bild auf den Rahmen der gewählten Form zuschneiden'), onclick: () => ed.cropImageSel(false) }, t('Zuschneiden')),
    h('button', { class: 'toggle', title: t('Nur das Innere der gewählten geschlossenen Formen vom Bild behalten'), onclick: () => ed.cropImageSel(true) }, t('Maske')),
  ];
  imgProps.append(...cropBtns);
  const sepImg = sep();

  // QR-Codes
  const qrInfo = h('span', { class: 'muted' });
  const qrProps = h('div', { class: 'field' },
    h('span', { html: ICONS.qr, class: 'muted icon-inline' }), qrInfo,
    h('button', { class: 'toggle', title: t('Inhalt, Größe und Einstellungen ändern (Doppelklick)'), onclick: () => ed.selBarcodes()[0] && editBarcode(ed, ed.selBarcodes()[0]) }, t('Bearbeiten …')),
  );
  const sepQr = sep();

  // Parametrische Bauteile
  const genInfo = h('span', { class: 'muted' });
  const genIcon = h('span', { html: ICONS.gear, class: 'muted icon-inline' });
  const genProps = h('div', { class: 'field' },
    genIcon, genInfo,
    h('button', { class: 'toggle', title: t('Parameter ändern, die Kontur wird neu berechnet (Doppelklick)'), onclick: () => ed.selGens()[0] && ed.onGenEdit?.(ed.selGens()[0]) }, t('Parameter …')),
    h('button', { class: 'toggle', title: t('In gewöhnliche Pfade umwandeln; die Parameter gehen verloren (Ctrl+Shift+C)'), onclick: () => ed.convertSelToPath() }, t('In Pfade umwandeln')),
  );
  const sepGen = sep();

  const sepShape = sep();
  bar.append(geo, sepNode, nodeProps, sepImg, imgProps, sepQr, qrProps, sepGen, genProps, sepShape, rectProps, polyProps, sep(), textProps);

  const refresh = () => {
    const b = ed.selBounds();
    geo.classList.toggle('group-disabled', !b);
    if (b) {
      bindField(fx, 'x', f2(b.x + ax * b.w));
      bindField(fy, 'y', f2(bed().h - (b.y + ay * b.h)));
      bindField(fw, 'w', f2(b.w));
      bindField(fh, 'h', f2(b.h));
      setVal(fwp, '100');
      setVal(fhp, '100');
      bindField(fr, 'rot', f2(currentRot()));
    } else [fx, fy, fw, fh, fwp, fhp, fr].forEach((f) => setVal(f, ''));

    nodeProps.hidden = sepNode.hidden = ed.tool !== 'node';
    const imgs = ed.selImages();
    imgProps.hidden = sepImg.hidden = !imgs.length;
    const canCrop = imgs.length === 1 && ed.sel.length > 1;
    cropBtns.forEach((b) => (b.hidden = !canCrop));
    if (imgs.length) {
      const o = imgs[0],
        s = o.shape as ImageShape;
      const L = ed.imgLayer(o.layer);
      const g = outputGrid(s, o.m, L.interval);
      imgInfo.textContent = imgs.length > 1 ? t('{n} Bilder', { n: imgs.length }) : t('{pxW} × {pxH} px → {cols} × {rows} Punkte ({dpi} DPI)', { pxW: s.pxW, pxH: s.pxH, cols: g.cols, rows: g.rows, dpi: Math.round(25.4 / L.interval) });
    }
    const qrs = ed.selBarcodes();
    qrProps.hidden = sepQr.hidden = !qrs.length;
    if (qrs.length) {
      const q = qrs[0].shape as BarcodeShape;
      qrInfo.textContent = qrs.length > 1 ? t('{n} Codes', { n: qrs.length }) : `${q.type === 'qr' ? t('QR-Code') : LINEAR_NAMES[q.type]}${q.vt ? ` (${t('variabel')})` : ''}`;
    }
    const gens = ed.selGens();
    genProps.hidden = sepGen.hidden = !gens.length;
    if (gens.length) {
      const gs = gens[0].shape as GenShape;
      genInfo.textContent = gens.length > 1 ? t('{n} Bauteile', { n: gens.length }) : genLabel(gs);
      genIcon.innerHTML = ICONS[getGenerator(gs.gen)?.icon ?? 'gear'] ?? ICONS.gear;
    }
    const nn = ed.nodeSelCount;
    nodeInfo.textContent = nn ? t('{n} Knoten', { n: nn }) : t('Knoten');
    nodeProps.classList.toggle('group-disabled', ed.tool === 'node' && !ed.sel.length);

    const rect = ed.sel.find((o) => o.shape.kind === 'rect');
    const poly = ed.sel.find((o) => o.shape.kind === 'polygon');
    rectProps.hidden = !(rect || ed.tool === 'rect');
    polyProps.hidden = !(poly || ed.tool === 'polygon');
    sepShape.hidden = rectProps.hidden && polyProps.hidden;
    bindField(fRad, 'r', f2(rect && rect.shape.kind === 'rect' ? rect.shape.r : ed.rectRadius), (o) => o.shape.kind === 'rect');
    const pv = poly && poly.shape.kind === 'polygon' ? poly.shape : { sides: ed.polySides, star: ed.polyStar };
    bindField(fSides, 'sides', String(pv.sides), (o) => o.shape.kind === 'polygon');
    starBtn.classList.toggle('on', pv.star);

    const ts = ed.selTexts();
    const tx = ts.length ? (ts[0].shape as TextShape) : ed.textDefaults;
    textProps.classList.toggle('group-disabled', !ts.length && ed.tool !== 'text');
    if (![...fontSel.options].some((o) => o.value === tx.font)) fontSel.append(h('option', { value: tx.font }, tx.font));
    if (document.activeElement !== fontSel) fontSel.value = tx.font;
    lastFont = tx.font;
    bindField(fSize, 'size', f2(tx.size), (o) => o.shape.kind === 'text');
    setVal(fHs, f2(tx.hSpace));
    setVal(fVs, f2(tx.vSpace));
    bBold.classList.toggle('on', tx.bold);
    bItal.classList.toggle('on', tx.italic);
    bUp.classList.toggle('on', tx.upper);
    alignBtns.forEach((b) => b.classList.toggle('on', b.dataset.align === tx.align));
    bWeld.classList.toggle('on', !!tx.weld);
    const tvt = ts.length ? (ts[0].shape as TextShape).vt : undefined;
    bVar.classList.toggle('on', !!tvt);
    bVar.hidden = vtProps.hidden = !ts.length;
    vtProps.hidden = !tvt;
    if (tvt) setVal(fVtOff, String(tvt.offset));
    bindField(fMaxW, 'maxW', f2(ts.length ? (ts[0].shape as TextShape).maxW ?? 0 : 0), (o) => o.shape.kind === 'text');
    bindField(fMaxH, 'maxH', f2(ts.length ? (ts[0].shape as TextShape).maxH ?? 0 : 0), (o) => o.shape.kind === 'text');
    bShrink.classList.toggle('on', ts.length > 0 && (ts[0].shape as TextShape).fit === 'shrink');
    bWrap.classList.toggle('on', ts.length > 0 && (ts[0].shape as TextShape).fit === 'wrap');
    bOnPath.hidden = !ed.canApplyPathToText();
    const tp = ts.length ? (ts[0].shape as TextShape).path : undefined;
    pathProps.hidden = !tp;
    if (tp) {
      setVal(fPOff, f2(tp.offset));
      setVal(fPDist, f2(tp.dist));
      bPFlip.classList.toggle('on', tp.flip);
    }
  };
  ed.on((w) => w !== 'view' && refresh());
  refresh();
}

// ---------- Funktionsleisten (anpassbar, siehe toolbars.ts) ----------

function buildBars(ed: Editor) {
  const n = () => ed.sel.length;
  const sel1 = () => n() >= 1;
  const sel2 = () => n() >= 2;
  const sel3 = () => n() >= 3;
  const F = t('Datei'),
    B = t('Bearbeiten'),
    V = t('Ansicht'),
    A = t('Anordnen'),
    W = t('Werkzeuge'),
    M = t('Formen ändern'),
    I = t('Bilder'),
    S = t('Seiten'),
    L = t('Laser');
  const tool = (id: Tool, icon: string, label: string): Action => ({ id: `tool:${id}`, cat: W, icon, label, run: () => ed.setTool(id), on: () => ed.tool === id });
  const list: Action[] = [
    { id: 'new', cat: F, icon: 'new', label: t('Neues Projekt in neuem Tab (Ctrl+N)'), run: () => ed.newTab() },
    { id: 'open', cat: F, icon: 'open', label: t('Öffnen'), run: () => openProject(ed) },
    { id: 'save', cat: F, icon: 'save', label: t('Speichern'), run: () => saveProject(ed) },
    { id: 'import', cat: F, icon: 'import', label: t('Importieren: Bilder, SVG, DXF, PDF, AI, LightBurn, 3D-Modelle (Ctrl+I)'), run: () => importFile(ed) },
    { id: 'export', cat: F, icon: 'export', label: t('Als SVG exportieren'), run: () => exportSvg(ed) },
    { id: 'export-dxf', cat: F, short: 'DXF', label: t('Als DXF exportieren'), run: () => exportDxf(ed) },
    { id: 'export-pdf', cat: F, short: 'PDF', label: t('Als PDF exportieren'), run: () => exportPdf(ed, 'pdf') },
    { id: 'export-ai', cat: F, short: 'AI', label: t('Als Illustrator-Datei (AI) exportieren'), run: () => exportPdf(ed, 'ai') },
    { id: 'undo', cat: B, icon: 'undo', label: t('Rückgängig (Ctrl+Z)'), run: () => ed.doUndo() },
    { id: 'redo', cat: B, icon: 'redo', label: t('Wiederholen (Ctrl+Y)'), run: () => ed.doRedo() },
    { id: 'cut', cat: B, icon: 'cut', label: t('Ausschneiden (Ctrl+X)'), run: () => ed.cut(), enabled: sel1 },
    { id: 'copy', cat: B, icon: 'copy', label: t('Kopieren (Ctrl+C)'), run: () => ed.copy(), enabled: sel1 },
    { id: 'paste', cat: B, icon: 'paste', label: t('Einfügen (Ctrl+V)'), run: () => ed.paste() },
    { id: 'duplicate', cat: B, short: t('Dupl.'), label: t('Duplizieren (Ctrl+D)'), run: () => ed.duplicate(), enabled: sel1 },
    { id: 'delete', cat: B, icon: 'delete', label: t('Löschen (Entf)'), run: () => ed.deleteSel(), enabled: sel1 },
    { id: 'selectall', cat: B, short: t('Alle'), label: t('Alles auswählen (Ctrl+A)'), run: () => ed.selectAll() },
    { id: 'tolines', cat: B, icon: 'tolines', label: t('In Pfad umwandeln (Ctrl+Shift+C)'), run: () => ed.convertSelToPath(), enabled: sel1 },
    { id: 'closepath', cat: M, short: t('Schließen|Pfad'), label: t('Pfad schließen'), run: () => ed.closeSel(), enabled: sel1 },
    { id: 'join', cat: M, short: t('Verbinden|Pfade'), label: t('Ausgewählte Formen verbinden (Alt+J)'), run: () => ed.joinSel(), enabled: sel2 },
    { id: 'breakapart', cat: M, short: t('Zerlegen'), label: t('Zerlegen (Alt+B)'), run: () => ed.breakApartSel(), enabled: sel1 },
    { id: 'reverse', cat: M, short: t('Umkehren'), label: t('Richtung umkehren'), run: () => ed.reverseSel(), enabled: sel1 },
    { id: 'corners', cat: M, short: t('Ecken'), label: t('Ecken runden oder fasen …'), run: () => openCornerDialog(ed), enabled: sel1 },
    { id: 'zoomin', cat: V, icon: 'zoomin', label: t('Vergrößern (+)'), run: () => ed.zoomAt(1.25) },
    { id: 'zoomout', cat: V, icon: 'zoomout', label: t('Verkleinern (-)'), run: () => ed.zoomAt(0.8) },
    { id: 'zoompage', cat: V, icon: 'zoompage', label: t('Ganze Seite (Ctrl+0)'), run: () => ed.zoomPage() },
    { id: 'grid', cat: V, icon: 'grid', label: t('Gitter ein-/ausblenden'), run: () => ed.setGrid({ show: !ed.grid.show }), on: () => ed.grid.show },
    { id: 'gridsettings', cat: V, icon: 'settings', small: true, label: t('Gitter einstellen …'), run: () => openGridDialog(ed) },
    { id: 'zoomsel', cat: V, icon: 'zoomsel', label: t('Auf Auswahl zoomen'), run: () => ed.zoomSelection(), enabled: sel1 },
    { id: 'view3d', cat: V, icon: 'view3d', label: t('3D-Ansicht: Baugruppen zusammengesteckt ansehen'), run: () => toggleWindow('view3d') },
    { id: 'wire', cat: V, short: t('Gefüllt'), label: t('Drahtgitter / Gefüllt (Alt+W)'), run: () => ((ed.filled = !ed.filled), ed.emit('view')), on: () => ed.filled },
    {
      id: 'theme', cat: V, icon: 'moon', label: t('Dunkles Design'), run: () => applyTheme(ed, isDark() ? 'light' : 'dark'),
      dyn: () => (isDark() ? { icon: 'sun', label: t('Helles Design') } : { icon: 'moon', label: t('Dunkles Design') }),
    },
    { id: 'group', cat: A, icon: 'group', label: t('Gruppieren (Ctrl+G)'), run: () => ed.group(), enabled: sel2 },
    { id: 'ungroup', cat: A, icon: 'ungroup', label: t('Gruppierung aufheben (Ctrl+U)'), run: () => ed.ungroup(), enabled: sel1 },
    { id: 'mirrorh', cat: A, icon: 'mirrorh', label: t('Horizontal spiegeln (Ctrl+Shift+H)'), run: () => ed.mirror(true), enabled: sel1 },
    { id: 'mirrorv', cat: A, icon: 'mirrorv', label: t('Vertikal spiegeln (Ctrl+Shift+V)'), run: () => ed.mirror(false), enabled: sel1 },
    { id: 'rotccw', cat: A, icon: 'rotccw', label: t('90° gegen Uhrzeigersinn (,)'), run: () => ed.rotateBy(90), enabled: sel1 },
    { id: 'rotcw', cat: A, icon: 'rotcw', label: t('90° im Uhrzeigersinn (.)'), run: () => ed.rotateBy(-90), enabled: sel1 },
    { id: 'alignl', cat: A, icon: 'alignl', label: t('Links ausrichten (L)'), run: () => ed.align('left'), enabled: sel2 },
    { id: 'alignhc', cat: A, icon: 'alignhc', label: t('Mitten horizontal ausrichten (C)'), run: () => ed.align('hcenter'), enabled: sel2 },
    { id: 'alignr', cat: A, icon: 'alignr', label: t('Rechts ausrichten (R)'), run: () => ed.align('right'), enabled: sel2 },
    { id: 'alignt', cat: A, icon: 'alignt', label: t('Oben ausrichten (T)'), run: () => ed.align('top'), enabled: sel2 },
    { id: 'alignvc', cat: A, icon: 'alignvc', label: t('Mitten vertikal ausrichten (E)'), run: () => ed.align('vcenter'), enabled: sel2 },
    { id: 'alignb', cat: A, icon: 'alignb', label: t('Unten ausrichten (B)'), run: () => ed.align('bottom'), enabled: sel2 },
    { id: 'disth', cat: A, icon: 'disth', label: t('Horizontal verteilen'), run: () => ed.distribute(true), enabled: sel3 },
    { id: 'distv', cat: A, icon: 'distv', label: t('Vertikal verteilen'), run: () => ed.distribute(false), enabled: sel3 },
    tool('select', 'select', t('Auswählen (Esc)')),
    tool('node', 'node', t('Knoten bearbeiten (Ctrl+`)')),
    tool('line', 'line', t('Linien zeichnen (Ctrl+L)')),
    tool('rect', 'rect', t('Rechteck (Ctrl+R)')),
    tool('ellipse', 'ellipse', t('Ellipse (Ctrl+E)')),
    tool('polygon', 'polygon', t('Polygon')),
    tool('text', 'text', t('Text (Ctrl+T)')),
    tool('trim', 'trim', t('Formen trimmen (Ctrl+K): Abschnitte bis zum nächsten Schnittpunkt anklicken und entfernen')),
    tool('start', 'startpoint', t('Startpunkt setzen: Knoten anklicken, an dem der Schnitt beginnt (Shift: Richtung umkehren)')),
    tool('measure', 'measure', t('Messen: Abstand, Winkel, Radius und Durchmesser')),
    ...REL_MODES.map((m): Action => ({
      id: `rel:${m}`, cat: A, icon: REL_ICONS[m], label: `${REL_LABELS[m]}: ${REL_HINTS[m]}`, short: REL_LABELS[m],
      run: () => ed.startRelation(m), on: () => ed.tool === 'relate' && ed.relMode === m,
    })),
    tool('joint', 'joint', t('Verbindung: Fingerzinken, Zapfen, Überblattung, Schnapp-, Haken-, Keil- oder T-Slot-Verbindung auf gerade Kanten anwenden')),
    {
      id: 'lidhinge', cat: W, icon: 'lidhinge', label: t('Scharnier für Deckel: Oberkante der Rückwand und Hinterkante des Deckels anklicken; erzeugt Knöchel, Schlitze und Stiftlöcher'),
      run: () => ed.startHingeTool(), on: () => ed.tool === 'joint' && ed.jointHingeMode,
    },
    { id: 'sketch', cat: W, icon: 'sketch', label: t('Neue Skizze: Linien, Kreise und Bögen mit Beziehungen und Bemaßungen'), run: () => void ed.newSketch(), on: () => ed.tool === 'sketch' },
    { id: 'sketchconv', cat: W, icon: 'sketchconv', label: t('Gewählte Formen in eine Skizze umwandeln (Beziehungen und Maße setzen)'), run: () => void ed.convertSelToSketch(), enabled: sel1 },
    { id: 'qr', cat: W, icon: 'qr', label: t('QR-Code erstellen'), run: () => openQrDialog(ed) },
    { id: 'barcode', cat: W, icon: 'barcode', label: t('Strichcode erstellen (Code 128, EAN, UPC, Code 39, ITF)'), run: () => openBarcodeDialog(ed) },
    { id: 'jig', cat: W, icon: 'jig', label: t('Jig: Halteplatte mit Aussparungen für Werkstücke, Nummern und Passermarken'), run: () => openGenDialog(ed, 'jig', undefined, ed.sel.length ? { shapes: encodeShapes(shapesFromSelection(ed)) } : undefined) },
    { id: 'gear', cat: W, icon: 'gear', label: t('Zahnrad erstellen (Evolventenverzahnung, Parameter bleiben erhalten)'), run: () => openGenDialog(ed, 'gear') },
    { id: 'rack', cat: W, icon: 'rack', label: t('Zahnstange erstellen (passend zum Zahnrad, Parameter bleiben erhalten)'), run: () => openGenDialog(ed, 'rack') },
    { id: 'pulley', cat: W, icon: 'pulley', label: t('Riemenscheibe erstellen (GT2, HTD; Parameter bleiben erhalten)'), run: () => openGenDialog(ed, 'pulley') },
    { id: 'cam', cat: W, icon: 'cam', label: t('Nocken erstellen (Hub, Rast, Rückhub; Parameter bleiben erhalten)'), run: () => openGenDialog(ed, 'cam') },
    { id: 'gearpair', cat: W, icon: 'gearpair', label: t('Zahnradpaar erstellen (Baugruppe mit Achsabstand und Grundplatte)'), run: () => openGenDialog(ed, 'gearpair') },
    { id: 'drawer', cat: W, icon: 'drawer', label: t('Schublade erstellen (Korpus, Schubkasten und Blende als Baugruppe)'), run: () => openGenDialog(ed, 'drawer') },
    { id: 'insert', cat: W, icon: 'insert', label: t('Einsatz mit Fächern erstellen (gesteckte Stege für Box oder Schublade)'), run: () => openGenDialog(ed, 'insert') },
    { id: 'shelf', cat: W, icon: 'shelf', label: t('Steckregal erstellen (Seiten und Böden gesteckt)'), run: () => openGenDialog(ed, 'shelf') },
    { id: 'stack', cat: W, icon: 'stack', label: t('Schichtmodell aus einem 3D-Modell (STL, OBJ) erstellen'), run: () => importModel(ed, 'stack') },
    { id: 'multilayer', cat: W, icon: 'stack', label: t('Mehrlagenarbeit aus den ausgewählten Formen erstellen oder bearbeiten'), run: () => openMultiLayerDialog(ed), enabled: sel1 },
    { id: 'ribs', cat: W, icon: 'ribs', label: t('Rippenmodell aus einem 3D-Modell (STL, OBJ) erstellen'), run: () => importModel(ed, 'ribs') },
    { id: 'discsphere', cat: W, icon: 'discsphere', label: t('Scheibenkugel erstellen (Lampe aus gesteckten Scheiben)'), run: () => openGenDialog(ed, 'discsphere') },
    { id: 'box', cat: W, icon: 'box', label: t('Box mit Fingerzinken erstellen (Baugruppe, Parameter bleiben erhalten)'), run: () => openGenDialog(ed, 'box') },
    { id: 'vartext', cat: W, icon: 'vartext', short: t('Var. Text'), label: t('Variabler Text …'), run: () => openVarTextDialog(ed) },
    { id: 'textpath', cat: W, short: t('Auf Pfad'), label: t('Text auf Pfad'), run: () => ed.applyPathToText(), enabled: sel2 },
    {
      id: 'union', cat: M, icon: 'union', label: t('Vereinen (Alt++): alle gewählten Formen verschmelzen, eine Gruppe oder ein Text auch mit sich selbst'),
      run: () => ed.booleanSel('union'), enabled: () => sel2() || (n() === 1 && ['group', 'text'].includes(ed.sel[0].shape.kind)),
    },
    {
      id: 'subtract', cat: M, icon: 'subtract', label: t('Abziehen'), run: () => ed.booleanSel('subtract'), enabled: sel2,
      dyn: () => ({ label: `${t('Abziehen')} (Alt+-): ${BOOL_BASE_HINT[ed.boolBase]}${ed.boolKeep ? t(' (Originale bleiben)') : ''}` }),
    },
    { id: 'intersect', cat: M, icon: 'intersect', label: t('Schnittmenge (Alt+*): nur die gemeinsame Fläche behalten'), run: () => ed.booleanSel('intersect'), enabled: sel2 },
    { id: 'boolopts', cat: M, icon: 'settings', small: true, label: t('Boolesche Optionen: Basis und Originale behalten'), run: () => openBooleanDialog(ed) },
    { id: 'offset', cat: M, icon: 'offset', label: t('Offset (Alt+O)'), run: () => openOffsetDialog(ed), enabled: sel1 },
    { id: 'warp', cat: M, icon: 'warp', label: t('Verformen: Formen, Text und Bilder biegen, wölben oder perspektivisch verzerren'), run: () => openWarpDialog(ed), enabled: sel1 },
    { id: 'gridarray', cat: M, icon: 'gridArray', label: t('Rasterarray: Auswahl in Spalten und Zeilen kopieren (Ctrl+Shift+A)'), run: () => openGridArrayDialog(ed), enabled: sel1 },
    { id: 'circarray', cat: M, icon: 'circArray', label: t('Kreisarray: Auswahl im Kreis um einen Mittelpunkt kopieren'), run: () => openCircularArrayDialog(ed), enabled: sel1 },
    { id: 'nest', cat: M, icon: 'nest', label: t('Verschachteln: Auswahl mit ihren echten Konturen platzsparend auf Bett, Material oder Reststück legen'), run: () => openNestDialog(ed), enabled: sel1 },
    { id: 'hinge', cat: M, icon: 'hinge', label: t('Biegeschnitte (Living Hinge): gewählte Form mit einem Schnittmuster füllen, damit sich die Platte dort biegen lässt'), run: () => openHingeDialog(ed) },
    { id: 'adjust', cat: I, icon: 'adjust', label: t('Bild anpassen …'), run: () => openAdjustDialog(ed), enabled: () => ed.selImages().length > 0 },
    { id: 'trace', cat: I, icon: 'trace', label: t('Bild nachzeichnen (Alt+T)'), run: () => openTraceDialog(ed), enabled: () => ed.selImages().length > 0 },
    { id: 'addpage', cat: S, short: t('+ Seite'), label: t('Neue Seite'), run: () => ed.addPage() },
    { id: 'prevpage', cat: S, icon: 'up', label: t('Vorherige Seite (Bild ↑)'), run: () => ed.setPage(ed.doc.page - 1), enabled: () => ed.doc.page > 0 },
    { id: 'nextpage', cat: S, icon: 'down', label: t('Nächste Seite (Bild ↓)'), run: () => ed.setPage(ed.doc.page + 1), enabled: () => ed.doc.page < ed.doc.pages.length - 1 },
    { id: 'check', cat: L, icon: 'check', label: t('Konstruktion prüfen: doppelte Linien, offene Umrisse, schmale Stege, kleine Ausschnitte, Passungen, Steckbarkeit und Arbeitsbereich'), run: () => openCheck() },
    { id: 'preview', cat: L, icon: 'preview', label: t('Vorschau (Alt+P)'), run: () => openPreview(ed) },
    { id: 'start', cat: L, icon: 'play', label: t('Job starten'), run: () => startJob(ed) },
    { id: 'frame', cat: L, icon: 'frame', label: t('Rahmen: Rechteck um den Job abfahren'), run: () => frameJob(ed, false) },
    { id: 'contour', cat: L, icon: 'contour', label: t('Kontur-Rahmen: Umriss des Jobs abfahren'), run: () => frameJob(ed, true) },
    { id: 'gcode', cat: L, icon: 'gcode', label: t('G-Code speichern'), run: () => saveGCode(ed) },
    { id: 'setup', cat: L, icon: 'setup', short: t('Einrichten'), label: t('Laser einrichten: Schritt für Schritt von der Verbindung bis zum ersten Testauftrag'), run: () => openSetupWizard(ed) },
    { id: 'materialtest', cat: L, icon: 'mattest', short: t('Test'), label: t('Materialtest …'), run: () => openMaterialTestDialog(ed) },
    { id: 'testphoto', cat: L, icon: 'testphoto', short: t('Auswerten'), label: t('Materialtest auswerten: Foto des gelaserten Tests laden und die beste Zelle anklicken'), run: () => openTestPhotoDialog(ed) },
    { id: 'focustest', cat: L, icon: 'focus', short: t('Fokus'), label: t('Fokustest: richtigen Abstand zwischen Laserkopf und Material finden'), run: () => openFocusTestDialog(ed) },
    { id: 'printcut', cat: L, icon: 'printcut', short: t('Print and Cut'), label: t('Print and Cut: gedrucktes Blatt an Passermarken einmessen und passgenau schneiden'), run: () => openPrintCutDialog(ed) },
    { id: 'calibrate', cat: L, icon: 'calibrate', short: t('Passung'), label: t('Passung kalibrieren: Schnittfuge und Steckspiel für ein Material ermitteln'), run: () => openCalibrateDialog(ed) },
    { id: 'devsettings', cat: L, icon: 'settings', label: t('Geräteeinstellungen'), run: () => openDeviceDialog(ed) },
    { id: 'devices', cat: L, short: t('Geräte'), label: t('Geräte …'), run: () => openDevicesDialog(ed) },
    { id: 'rotary', cat: L, icon: 'rotary', short: t('Rotary'), label: t('Drehachse (Rotary) …'), run: () => openRotaryDialog() },
    { id: 'slots', cat: M, icon: 'slots', label: t('Schlitze an Materialdicke anpassen …'), run: () => openSlotDialog(ed) },
    { id: 'jigfill', cat: A, icon: 'jigfill', label: t('Auf Jig-Fächer legen: gewähltes Design in jedes Fach eines Jigs kopieren, auf Wunsch mit Seriennummer je Fach'), run: () => openJigFillDialog(ed), enabled: sel1 },
    { id: 'workpiece', cat: A, icon: 'workpiece', label: t('Auf Werkstücke übertragen (Kamera) …'), run: () => openWorkpieceDialog(ed), enabled: sel1 },
    { id: 'bgremove', cat: I, icon: 'bgremove', label: t('Hintergrund entfernen …'), run: () => openBackgroundDialog(ed), enabled: () => ed.selImages().length > 0 },
    { id: 'series', cat: F, icon: 'series', label: t('Serie aus Tabelle (CSV) …'), run: () => openSeriesDialog(ed) },
    { id: 'newtemplate', cat: F, icon: 'template', label: t('Neu aus Vorlage …'), run: () => openTemplateLibrary(ed) },
    { id: 'filltemplate', cat: F, icon: 'filltemplate', label: t('Vorlage ausfüllen …'), run: () => openFillDialog(ed) },
    { id: 'packs', cat: F, icon: 'packs', label: t('Erweiterungen …'), run: () => openPacksDialog() },
    { id: 'sync', cat: F, icon: 'sync', label: t('Einstellungen übertragen …'), run: () => openSyncDialog(ed) },
    { id: 'fonts', cat: F, icon: 'fonts', short: t('Schriften'), label: t('Schriften: Google Fonts laden, eigene Schriften und Favoriten verwalten'), run: () => openFontManager(ed) },
    { id: 'apps', cat: W, icon: 'apps', label: t('Werkzeugkasten: alle Generatoren und Werkzeuge mit Suche'), run: () => toggleWindow('apps'), on: () => !isHidden('apps') },
    // Knopfgruppen: ein Knopf für die zuletzt benutzte Aktion, der Pfeil daneben zeigt die übrigen
    { id: 'grp:transform', cat: A, label: t('Spiegeln und drehen (Gruppe)'), items: ['mirrorh', 'mirrorv', 'rotccw', 'rotcw'], run: () => {} },
    { id: 'grp:align', cat: A, label: t('Ausrichten und verteilen (Gruppe)'), items: ['alignl', 'alignhc', 'alignr', 'alignt', 'alignvc', 'alignb', 'disth', 'distv'], run: () => {} },
    { id: 'grp:zoom', cat: V, label: t('Zoom (Gruppe)'), items: ['zoompage', 'zoomsel', 'zoomin', 'zoomout'], run: () => {} },
    { id: 'grp:bool', cat: M, label: t('Boolesche Operationen (Gruppe)'), items: ['union', 'subtract', 'intersect', 'boolopts'], run: () => {} },
    { id: 'grp:gen', cat: W, label: t('Generatoren (Gruppe)'), items: ['gear', 'rack', 'pulley', 'cam', 'gearpair', 'box', 'drawer', 'insert', 'shelf', 'discsphere', 'stack', 'ribs'], run: () => {} },
    { id: 'grp:array', cat: M, label: t('Arrays (Gruppe)'), items: ['gridarray', 'circarray'], run: () => {} },
    { id: 'grp:relate', cat: A, label: t('Beziehungen (Gruppe)'), items: REL_MODES.map((m) => `rel:${m}`), run: () => {} },
    { id: 'grp:path', cat: M, label: t('Pfad-Werkzeuge (Gruppe)'), items: ['tool:trim', 'tool:start', 'closepath', 'join', 'breakapart', 'reverse', 'corners'], run: () => {} },
  ];
  initToolbars(
    list,
    {
      main: [
        'new', 'open', 'save', 'import', 'export', SEP, 'undo', 'redo', SEP, 'cut', 'copy', 'paste', 'delete', SEP,
        'grp:zoom', 'view3d', SEP, 'check', 'preview', SEP,
        'group', 'ungroup', 'grp:transform', 'tolines', SEP, 'grp:align', SEP, 'theme',
      ],
      tools: [
        'tool:select', 'tool:node', SEP, 'tool:line', 'tool:rect', 'tool:ellipse', 'tool:polygon', 'tool:text', 'qr', 'apps', SEP,
        'grp:bool', 'offset', 'warp', 'grp:path', 'grp:array', 'nest', SEP, 'grp:relate', 'tool:measure',
      ],
    },
    // Gespeicherte Leisten von vor den Knopfgruppen: die alten Standardfolgen durch die Gruppe ersetzen
    [
      [['zoomin', 'zoomout', 'zoompage', 'zoomsel'], 'grp:zoom'],
      [['mirrorh', 'mirrorv', 'rotccw', 'rotcw'], 'grp:transform'],
      [['alignl', 'alignhc', 'alignr', 'alignt', 'alignvc', 'alignb', 'disth', 'distv'], 'grp:align'],
      [['union', 'subtract', 'intersect', 'boolopts'], 'grp:bool'],
      [['tool:trim', 'tool:start'], 'grp:path'],
      [['gridarray', 'circarray'], 'grp:array'],
    ],
  );
  let frame = 0;
  ed.on(() => (frame ||= requestAnimationFrame(() => ((frame = 0), refreshBars()))));
  themeListeners.add(refreshBars);
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'o' && ed.sel.length) {
      e.preventDefault();
      openOffsetDialog(ed);
    }
  });
}

function bakeVarText(ed: Editor) {
  const n = ed.bakeVarText();
  ed.hint = n
    ? tn('{n} Objekt festgeschrieben: der aktuelle Inhalt ist jetzt fester Text.', '{n} Objekte festgeschrieben: der aktuelle Inhalt ist jetzt fester Text.', n)
    : t('Keine Objekte mit variablem Text ausgewählt.');
  ed.emit('tool');
}

// ---------- Boolesche Optionen ----------

const BOOL_BASE_HINT: Record<BoolBase, string> = {
  selection: t('weitere Formen von der zuerst gewählten abziehen'),
  back: t('vordere Formen von der hintersten abziehen'),
  front: t('hintere Formen von der vordersten abziehen'),
};

function openBooleanDialog(ed: Editor) {
  let base = ed.boolBase;
  let keep = ed.boolKeep;
  const radio = (value: BoolBase, label: string) =>
    h('label', {}, h('input', { type: 'radio', name: 'bool-base', value, checked: value === base, onchange: () => (base = value) }), label);
  const dlg = h(
    'dialog',
    { class: 'offset-dialog bool-dialog' },
    h('h3', {}, t('Boolesche Optionen')),
    h(
      'div',
      { class: 'form' },
      h('label', {}, t('Basis')),
      h('div', { class: 'radios column' },
        radio('selection', t('Zuerst gewählte Form')),
        radio('back', t('Hinterste Form (vordere werden abgezogen)')),
        radio('front', t('Vorderste Form (hintere werden abgezogen)')),
      ),
      h('label', { for: 'bool-keep' }, t('Originale behalten')),
      h('input', { type: 'checkbox', id: 'bool-keep', checked: keep, onchange: (e: Event) => (keep = (e.target as HTMLInputElement).checked) }),
    ),
    h('div', { class: 'note' }, t('Die Basis bestimmt beim Abziehen, wovon abgezogen wird, und bei allen Operationen die Ebene des Ergebnisses. Vorn ist, was in der Stapelreihenfolge oben liegt (zuletzt gezeichnet).')),
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          ed.setBoolOptions({ base, keep });
          dlg.close();
        },
      }, t('Übernehmen')),
    ),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  (dlg as HTMLDialogElement).showModal();
}

// ---------- Pfade mit Toleranz schließen ----------

let closeState = { tol: 1, mode: 'line' as 'line' | 'move' };

function openCloseDialog(ed: Editor) {
  if (!ed.sel.length) return;
  const st = { ...closeState };
  const info = h('div', { class: 'note' });
  const update = () => {
    const r = ed.closeStats(st.tol);
    info.textContent = t('Offene Formen: {open} · werden geschlossen: {closed} · bleiben offen: {rest}', { open: r.open, closed: r.closed, rest: r.open - r.closed });
  };
  const val = h('input', { type: 'text', id: 'close-tol', value: dec(String(st.tol)), style: 'width: 64px' }) as HTMLInputElement;
  const slider = h('input', { type: 'range', min: '0', max: '1', step: '0.001', id: 'close-slider', style: 'flex: 1; min-width: 0' }) as HTMLInputElement;
  // logarithmisch von 0,01 bis 20 mm
  const toSlider = (v: number) => String(Math.log(v / 0.01) / Math.log(2000));
  const fromSlider = (x: number) => Math.round(0.01 * Math.pow(2000, x) * 1000) / 1000;
  slider.value = toSlider(st.tol);
  slider.oninput = () => {
    st.tol = fromSlider(Number(slider.value));
    val.value = dec(String(st.tol));
    update();
  };
  val.onchange = () => {
    const v = evalExpr(val.value);
    if (v && v > 0) {
      st.tol = v;
      slider.value = toSlider(v);
    }
    val.value = dec(String(st.tol));
    update();
  };
  const radio = (value: 'line' | 'move', label: string) =>
    h('label', {}, h('input', { type: 'radio', name: 'close-mode', value, checked: st.mode === value, onchange: () => (st.mode = value) }), label);
  const dlg = h(
    'dialog',
    { class: 'offset-dialog close-dialog' },
    h('h3', {}, t('Pfade mit Toleranz schließen')),
    h(
      'div',
      { class: 'form' },
      h('label', { for: 'close-tol' }, t('Höchstabstand (mm)')), h('div', { class: 'radios' }, slider, val),
      h('label', {}, t('Schließen durch')),
      h('div', { class: 'radios column' }, radio('line', t('Gerade einfügen')), radio('move', t('Enden zusammenziehen'))),
    ),
    info,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          closeState = st;
          dlg.close();
          ed.closeSel(st.tol, st.mode);
        },
      }, t('Übernehmen')),
    ),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  update();
}

// ---------- Beziehung „Abstand“ ----------

const REL_ICONS: Record<RelMode, string> = {
  concentric: 'relconc', equal: 'relequal', parallel: 'relpar', perpendicular: 'relperp',
  horizontal: 'relhor', vertical: 'relvert', tangent: 'reltan', distance: 'reldist',
};

/** Abstand für die Beziehung erfragen; null = abgebrochen */
function askDistance(current: number): Promise<number | null> {
  return new Promise((resolve) => {
    let result: number | null = null;
    const val = h('input', { type: 'text', id: 'rel-dist', value: dec(String(Math.round(current * 1000) / 1000)), style: 'width: 96px' }) as HTMLInputElement;
    const ok = () => {
      const v = evalExpr(val.value);
      if (v === null || !(v >= 0)) {
        val.focus();
        return;
      }
      result = v;
      dlg.close();
    };
    val.onkeydown = (e) => {
      if (e.key === 'Enter') ok();
    };
    const dlg = h(
      'dialog',
      { class: 'offset-dialog' },
      h('h3', {}, t('Abstand')),
      h('div', { class: 'form' }, h('label', { for: 'rel-dist' }, t('Abstand (mm)')), val),
      h('div', { class: 'note' }, t('Aktuell: {v} mm. Das zweite Objekt wird verschoben.', { v: dec(current.toFixed(3)) })),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
        h('button', { class: 'btn primary', onclick: ok }, t('Übernehmen'))),
    );
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.append(dlg);
    dlg.showModal();
    val.select();
    setTimeout(() => val.select(), 0);
  });
}

// ---------- Ecken runden oder fasen ----------

let cornerState = { mode: 'round' as CornerMode, r: 3 };

function openCornerDialog(ed: Editor) {
  if (!ed.sel.length) return;
  const st = { ...cornerState };
  const n = ed.cornerCount();
  const info = h('div', { class: 'note' });
  info.textContent = n
    ? ed.tool === 'node'
      ? tn('{n} ausgewählte Ecke wird bearbeitet.', '{n} ausgewählte Ecken werden bearbeitet.', n)
      : tn('{n} Ecke in der Auswahl wird bearbeitet.', '{n} Ecken in der Auswahl werden bearbeitet.', n)
    : ed.tool === 'node'
      ? t('Erst Eckknoten auswählen (Klick, Shift+Klick oder Rahmen).')
      : t('Keine Ecken in der Auswahl: Pfade oder Formen mit Ecken auswählen.');
  const rLabel = h('label', { for: 'corner-r' });
  const setLabel = () => (rLabel.textContent = st.mode === 'chamfer' ? t('Abstand von der Ecke (mm)') : t('Radius (mm)'));
  setLabel();
  const val = h('input', { type: 'text', id: 'corner-r', value: dec(String(st.r)), style: 'width: 64px' }) as HTMLInputElement;
  val.onchange = () => {
    const v = evalExpr(val.value);
    if (v && v > 0) st.r = v;
    val.value = dec(String(st.r));
  };
  const radio = (value: CornerMode, label: string) =>
    h('label', {}, h('input', { type: 'radio', name: 'corner-mode', value, checked: st.mode === value, onchange: () => ((st.mode = value), setLabel()) }), label);
  const dlg = h(
    'dialog',
    { class: 'offset-dialog corner-dialog' },
    h('h3', {}, t('Ecken runden oder fasen')),
    h(
      'div',
      { class: 'form' },
      h('label', {}, t('Ecke')),
      h('div', { class: 'radios column' }, radio('round', t('Runden')), radio('inverse', t('Innen runden (Bogen um die Ecke)')), radio('chamfer', t('Fasen'))),
      rLabel, h('div', { class: 'radios' }, val),
    ),
    info,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        disabled: !n,
        onclick: () => {
          val.onchange!(new Event('change'));
          cornerState = st;
          dlg.close();
          ed.cornerSel(st.mode, st.r);
        },
      }, t('Übernehmen')),
    ),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  val.select();
}

// ---------- Offset-Dialog ----------

let offsetState = { distance: 2, direction: 'outward' as 'outward' | 'inward' | 'both', join: 'round' as 'round' | 'miter' | 'square', keep: true };

function openOffsetDialog(ed: Editor) {
  if (!ed.sel.length) return;
  const st = { ...offsetState };
  const preview = () => ed.previewOffset({ distance: st.distance, direction: st.direction, join: st.join });
  const dist = numInput('', (v) => {
    if (v > 0) st.distance = v;
    preview();
  }, t('Abstand in mm'));
  dist.id = 'offset-distance';
  dist.value = String(st.distance);
  const radio = <T extends string>(name: string, value: T, label: string, cur: T, set: (v: T) => void) =>
    h('label', {}, h('input', { type: 'radio', name, value, checked: value === cur, onchange: () => (set(value), preview()) }), label);
  const join = h('select', { id: 'offset-join', onchange: (e: Event) => ((st.join = (e.target as HTMLSelectElement).value as typeof st.join), preview()) },
    h('option', { value: 'round', selected: st.join === 'round' }, t('Rund')),
    h('option', { value: 'miter', selected: st.join === 'miter' }, t('Spitz')),
    h('option', { value: 'square', selected: st.join === 'square' }, t('Abgeschrägt')),
  ) as HTMLSelectElement;
  const keep = h('input', { type: 'checkbox', id: 'offset-keep', checked: st.keep, onchange: (e: Event) => (st.keep = (e.target as HTMLInputElement).checked) }) as HTMLInputElement;
  const dlg = h(
    'dialog',
    { class: 'offset-dialog' },
    h('h3', {}, t('Offset')),
    h(
      'div',
      { class: 'form' },
      h('label', { for: 'offset-distance' }, t('Abstand (mm)')), dist,
      h('label', {}, t('Richtung')),
      h('div', { class: 'radios' },
        radio('dir', 'outward', t('Außen'), st.direction, (v) => (st.direction = v)),
        radio('dir', 'inward', t('Innen'), st.direction, (v) => (st.direction = v)),
        radio('dir', 'both', t('Beides'), st.direction, (v) => (st.direction = v)),
      ),
      h('label', { for: 'offset-join' }, t('Ecken')), join,
      h('label', { for: 'offset-keep' }, t('Original behalten')), keep,
    ),
    h('div', { class: 'note' }, t('Orange gestrichelt: Vorschau. Offene Linien bekommen eine geschlossene Kontur im Abstand.')),
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          const v = evalExpr(dist.value);
          if (v && v > 0) st.distance = v;
          offsetState = st;
          dlg.close();
          await ed.offsetSel({ distance: st.distance, direction: st.direction, join: st.join }, st.keep);
        },
      }, t('Übernehmen')),
    ),
  );
  dlg.addEventListener('close', () => {
    ed.previewOffset(null);
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  preview();
}

// ---------- Layer-Panel ----------

function buildLayers(ed: Editor) {
  const root = $('#layers');
  /** Gewählter Eintrag: Vektoren oder Bilder des aktiven Layers */
  let part: 'vec' | 'img' = 'vec';
  const render = () => {
    const used = ed.layerOrder();
    if (ed.activeLayer === null || !used.includes(ed.activeLayer)) ed.activeLayer = used[0] ?? null;
    root.replaceChildren();
    if (!used.length) {
      root.append(h('div', { class: 'empty' }, t('Noch keine Objekte. Zeichne links eine Form oder einen Text, oder importiere ein Bild (Ctrl+I). Die Farbe unten bestimmt den Layer.')));
      return;
    }
    const table = h(
      'table',
      { class: 'layers' },
      h('tr', {}, ...[t('Nr.'), t('Layer'), t('Modus'), t('Speed'), t('Leist.'), t('Air'), t('Aus'), t('Zeig.')].map((s) => h('th', {}, s))),
    );
    const partsOf = new Map(used.map((i) => [i, ed.layerParts(i)]));
    const ap = partsOf.get(ed.activeLayer!)!;
    if (part === 'img' && !ap.img) part = 'vec';
    if (part === 'vec' && !ap.vec && ap.img) part = 'img';
    for (const i of used) {
      const L = ed.layer(i);
      const parts = partsOf.get(i)!;
      const rows: ('vec' | 'img')[] = [];
      if (parts.vec) rows.push('vec');
      if (parts.img) rows.push('img');
      for (const p of rows) {
        const isImg = p === 'img';
        const IL = isImg ? ed.imgLayer(i) : null;
        const mode = isImg
          ? h('span', { class: 'mode-img', title: t('Bilder dieses Layers') }, t('Bild'))
          : h('select', { onchange: (e: Event) => ed.updateLayer(i, { mode: (e.target as HTMLSelectElement).value as Layer['mode'] }) },
              h('option', { value: 'line', selected: L.mode === 'line' }, t('Linie')),
              h('option', { value: 'fill', selected: L.mode === 'fill' }, t('Füllen')),
            );
        const out = h('input', { type: 'checkbox', checked: L.output, onchange: (e: Event) => ed.updateLayer(i, { output: (e.target as HTMLInputElement).checked }) });
        const show = h('input', { type: 'checkbox', checked: L.show, onchange: (e: Event) => ed.updateLayer(i, { show: (e.target as HTMLInputElement).checked }) });
        const air = h('input', { type: 'checkbox', checked: L.air, title: t('Air Assist'), onchange: (e: Event) => ed.updateLayer(i, { air: (e.target as HTMLInputElement).checked }) });
        const row = h(
          'tr',
          { class: ed.activeLayer === i && part === p ? 'active' : '', title: isImg ? t('Doppelklick: Bild anpassen') : t('Doppelklick: Layer-Einstellungen') },
          h('td', {}, h('span', { class: 'swatch', style: `background:${PALETTE[i]}` }, layerLabel(i))),
          h('td', {}, L.name),
          h('td', {}, mode),
          h('td', {}, String(IL ? IL.speed : L.speed)),
          h('td', {}, `${IL ? IL.power : L.power}%`),
          h('td', {}, air),
          h('td', {}, out),
          h('td', {}, show),
        );
        row.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('select,input')) return;
          ed.activeLayer = i;
          ed.currentLayer = i;
          part = p;
          render();
          ed.emit('tool');
        });
        // Wie in LightBurn: Doppelklick öffnet die Einstellungen
        row.addEventListener('dblclick', (e) => {
          if ((e.target as HTMLElement).closest('select,input')) return;
          if (isImg) openAdjustDialog(ed, i);
          else openLayerDialog(ed, i);
        });
        table.append(row);
      }
    }
    root.append(table);
    const a = ed.activeLayer!;
    root.append(
      h(
        'div',
        { class: 'layer-tools' },
        h('button', { title: t('Nach oben (früher ausgeben)'), onclick: () => ed.moveLayer(a, -1), html: '▲' }),
        h('button', { title: t('Nach unten (später ausgeben)'), onclick: () => ed.moveLayer(a, 1), html: '▼' }),
        h('button', { onclick: () => ed.selectLayer(a) }, t('Formen auswählen')),
        part === 'vec' ? h('button', { title: t('Alle Einstellungen dieses Layers (Doppelklick auf den Layer)'), onclick: () => openLayerDialog(ed, a) }, t('Einstellungen …')) : null,
      ),
    );
    const L = ed.layer(a);
    const name = h('input', { type: 'text', value: L.name, onchange: (e: Event) => ed.updateLayer(a, { name: (e.target as HTMLInputElement).value }) });
    const head = [h('label', {}, h('span', { class: 'swatch', style: `background:${PALETTE[a]}` }, layerLabel(a)), ' ', t('Name')), name];
    if (part === 'img') {
      root.append(imageLayerForm(ed, a, head));
      return;
    }
    const num = (key: 'speed' | 'power' | 'minPower' | 'passes' | 'interval', min: number, max: number, int = false) => {
      const el = numInput('', (v) => {
        const c = Math.max(min, Math.min(max, int ? Math.round(v) : v));
        ed.updateLayer(a, { [key]: c } as Partial<Layer>);
      });
      el.value = String(L[key]);
      return el;
    };
    root.append(
      h(
        'div',
        { class: 'form' },
        ...head,
        h('label', {}, t('Geschwindigkeit (mm/min)')), num('speed', 1, 100000),
        h('label', {}, t('Max. Leistung (%)')), num('power', 0, 100),
        h('label', {}, t('Min. Leistung (%)')), num('minPower', 0, 100),
        h('label', {}, t('Durchgänge')), num('passes', 1, 100, true),
        ...(L.mode === 'fill' ? [h('label', {}, t('Zeilenabstand (mm)')), num('interval', 0.01, 5)] : []),
        h('span', { class: 'checks' },
          h('label', { class: 'check', title: t('Luftunterstützung während dieses Layers (M8/M7, aus mit M9)') },
            h('input', { type: 'checkbox', checked: L.air, onchange: (e: Event) => ed.updateLayer(a, { air: (e.target as HTMLInputElement).checked }) }), t('Air Assist')),
        ),
      ),
      h('div', { class: 'note' }, layerSummary(L)),
    );
  };
  ed.on((w) => (w === 'doc' || w === 'sel') && schedule());
  let pending = false;
  // Während eines Ziehvorgangs nicht bei jeder Bewegung neu aufbauen
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (!isEditingIn(root)) render();
    });
  };
  root.addEventListener('focusout', () => setTimeout(schedule, 0));
  render();
}

/**
 * True while the user is typing or choosing in a field inside `root`, so a
 * rebuild would throw away the unfinished input. Buttons and checkboxes apply
 * their change immediately and must not hold back the refresh.
 */
function isEditingIn(root: HTMLElement): boolean {
  const el = document.activeElement;
  if (!el || !root.contains(el)) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'range', 'file'].includes(el.type);
  return (el as HTMLElement).isContentEditable;
}

/** Kurzfassung der weiteren Einstellungen aus dem Layer-Dialog */
function layerSummary(L: Layer): string {
  const parts: string[] = [];
  if (L.kerf) parts.push(t('Kerf {kerf} mm', { kerf: fmtNum(L.kerf) }));
  if (L.mode === 'line' && L.tabs.enabled) parts.push(L.tabs.useCount ? t('{count} Stege je Form', { count: L.tabs.count }) : t('Stege alle {spacing} mm', { spacing: fmtNum(L.tabs.spacing) }));
  if (L.mode === 'fill' && L.fillStyle === 'offset') parts.push(t('Kontur folgend'));
  else if (L.mode === 'fill') {
    if (L.angle) parts.push(t('Winkel {angle}°', { angle: fmtNum(L.angle) }));
    if (L.crossHatch) parts.push(t('Kreuzschraffur'));
    if (!L.bidirectional) parts.push(t('nur eine Richtung'));
  }
  if (L.mode === 'line') {
    if (L.perf?.enabled) parts.push(t('Perforation'));
    if (L.lead?.leadIn || L.lead?.leadOut) parts.push(t('Anschnitt'));
    if (L.lead?.overcut) parts.push(t('Überschnitt {mm} mm', { mm: fmtNum(L.lead.overcut) }));
    if (L.ramp?.enabled) parts.push(t('Leistungsrampe'));
  }
  if (L.zOffset || L.zStep) parts.push(t('Z-Versatz'));
  const subs = L.sub?.filter((s) => s.output).length ?? 0;
  if (subs) parts.push(t('Sub-Layer: {n}', { n: subs }));
  return parts.length ? t('Außerdem: {list}.', { list: parts.join(', ') }) : t('Kerf, Haltestege, Scanwinkel und mehr: Doppelklick auf den Layer.');
}

/** Felder für die Bild-Einstellungen eines Layers (auch im Dialog „Bild anpassen“ verwendet) */
function imageLayerFields(ed: Editor, i: number, live: boolean, onChange?: () => void): HTMLElement[] {
  const IL = ed.imgLayer(i);
  const set = (patch: Partial<ImageLayer>) => {
    ed.updateImgLayer(i, patch, !live);
    onChange?.();
  };
  const num = (key: 'speed' | 'power' | 'minPower' | 'passes' | 'overscan' | 'cells' | 'angle' | 'threshold', min: number, max: number, int = false) => {
    const el = numInput('', (v) => set({ [key]: Math.max(min, Math.min(max, int ? Math.round(v) : v)) } as Partial<ImageLayer>));
    el.value = String(IL[key]);
    return el;
  };
  const interval = numInput('', (v) => {
    const c = Math.max(0.01, Math.min(2, v));
    set({ interval: c });
    dpi.value = String(Math.round(25.4 / c));
  }, t('Zeilenabstand in mm'));
  interval.value = String(IL.interval);
  const dpi = numInput('', (v) => {
    const c = Math.max(12.7, Math.min(2540, v));
    set({ interval: Math.round((25.4 / c) * 10000) / 10000 });
    interval.value = String(ed.imgLayer(i).interval);
  }, t('Auflösung in Punkten pro Zoll'));
  dpi.value = String(Math.round(25.4 / IL.interval));
  const modeSel = h('select', {}, ...DITHER_MODES.map(([v, t]) => h('option', { value: v, selected: IL.dither === v }, t))) as HTMLSelectElement;
  const extra = h('div', { class: 'form sub' });
  const renderExtra = () => {
    const d = ed.imgLayer(i).dither;
    extra.replaceChildren(
      ...(d === 'threshold' ? [h('label', {}, t('Schwellwert (0–255)')), num('threshold', 0, 255, true)] : []),
      ...(isCellMode(d) ? [h('label', {}, t('Zellen pro Zoll')), num('cells', 2, 300), h('label', {}, t('Rasterwinkel (°)')), num('angle', -90, 90)] : []),
    );
    extra.hidden = !extra.childElementCount;
  };
  modeSel.addEventListener('change', () => {
    set({ dither: modeSel.value as DitherMode });
    renderExtra();
  });
  renderExtra();
  const check = (key: 'negative' | 'bidirectional', label: string) =>
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: IL[key], onchange: (e: Event) => set({ [key]: (e.target as HTMLInputElement).checked }) }), label);
  return [
    h('label', {}, t('Bildmodus')), modeSel,
    extra,
    h('label', {}, t('Zeilenabstand (mm)')), interval,
    h('label', {}, 'DPI'), dpi,
    h('span', { class: 'checks' }, check('negative', t('Negativ')), check('bidirectional', t('Bidirektional'))),
    ...(live ? [] : [
      h('label', {}, t('Geschwindigkeit (mm/min)')), num('speed', 1, 100000),
      h('label', {}, t('Max. Leistung (%)')), num('power', 0, 100),
      h('label', {}, t('Min. Leistung (%)')), num('minPower', 0, 100),
      h('label', {}, t('Durchgänge')), num('passes', 1, 100, true),
      h('label', {}, t('Überfahrweg (%)')), num('overscan', 0, 50),
    ]),
  ];
}

function imageLayerForm(ed: Editor, i: number, head: HTMLElement[]) {
  return h(
    'div',
    {},
    h('div', { class: 'form' }, ...head, ...imageLayerFields(ed, i, false)),
    h('div', { class: 'layer-tools' },
      h('button', { onclick: () => openAdjustDialog(ed, i) }, t('Bild anpassen …')),
    ),
  );
}

// ---------- Bild anpassen ----------

/** Schieberegler mit Zahlenanzeige */
function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void) {
  const out = h('span', { class: 'slider-val' }, fmtNum(value));
  const inp = h('input', { type: 'range', min, max, step, value: String(value) }) as HTMLInputElement;
  inp.addEventListener('input', () => {
    out.textContent = fmtNum(+inp.value);
    onInput(+inp.value);
  });
  const set = (v: number) => {
    inp.value = String(v);
    out.textContent = fmtNum(v);
  };
  return { el: [h('label', {}, label), h('span', { class: 'slider' }, inp, out)], set };
}
const fmtNum = (v: number) => dec(String(Math.round(v * 100) / 100));

function targetImages(ed: Editor, layer?: number): Obj[] {
  const sel = ed.selImages();
  if (sel.length) return sel;
  if (layer === undefined) return [];
  return ed.doc.objs.filter((o) => o.shape.kind === 'image' && o.layer === layer);
}

function openAdjustDialog(ed: Editor, layer?: number) {
  const targets = targetImages(ed, layer);
  if (!targets.length) {
    ed.hint = t('Erst ein Bild auswählen.');
    ed.emit('tool');
    return;
  }
  const first = targets[0];
  const shape = () => first.shape as ImageShape;
  const li = first.layer;
  const origAdj = targets.map((o) => ({ ...(o.shape as ImageShape).adjust }));
  const origLayer = { ...ed.imgLayer(li) };
  const adj: ImageAdjust = { ...shape().adjust };

  const view = h('canvas', { class: 'adjust-preview', width: 420, height: 300 }) as HTMLCanvasElement;
  let showOrig = false,
    oneToOne = false;
  let timer = 0;
  const drawPreview = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const ctx = view.getContext('2d')!;
      const dpr = window.devicePixelRatio || 1;
      const W = view.clientWidth || 420,
        H = view.clientHeight || 300;
      view.width = Math.round(W * dpr);
      view.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      const s = shape();
      const src: CanvasImageSource | null = showOrig ? assetImageOf(s) : displayCanvas(s, first.m, ed.imgLayer(li), true);
      if (!src) return;
      const sw = (src as HTMLCanvasElement).width || (src as HTMLImageElement).naturalWidth,
        sh = (src as HTMLCanvasElement).height || (src as HTMLImageElement).naturalHeight;
      if (oneToOne && !showOrig) {
        // Mitte des Bildes, ein Bildschirmpunkt je Laserpunkt
        ctx.imageSmoothingEnabled = false;
        const cw = W * dpr,
          ch = H * dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(src, Math.max(0, (sw - cw) / 2), Math.max(0, (sh - ch) / 2), Math.min(sw, cw), Math.min(sh, ch), Math.max(0, (cw - sw) / 2), Math.max(0, (ch - sh) / 2), Math.min(sw, cw), Math.min(sh, ch));
        return;
      }
      const k = Math.min(W / sw, H / sh);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
    }, 40);
  };
  const setAdj = (patch: Partial<ImageAdjust>) => {
    Object.assign(adj, patch);
    ed.setImageAdjust(targets, patch, false);
    drawPreview();
  };
  const sB = slider(t('Helligkeit'), -100, 100, 1, adj.brightness, (v) => setAdj({ brightness: v }));
  const sC = slider(t('Kontrast'), -100, 100, 1, adj.contrast, (v) => setAdj({ contrast: v }));
  const sG = slider(t('Gamma'), 0.1, 4, 0.01, adj.gamma, (v) => setAdj({ gamma: v }));
  const sS = slider(t('Schärfen (%)'), 0, 300, 1, adj.sharpen, (v) => setAdj({ sharpen: v }));
  const sR = slider(t('Radius'), 1, 10, 0.5, adj.sharpenRadius, (v) => setAdj({ sharpenRadius: v }));
  const sD = slider(t('Entrauschen'), 0, 50, 1, adj.denoise, (v) => setAdj({ denoise: v }));
  const layerForm = h('div', { class: 'form' }, ...imageLayerFields(ed, li, true, drawPreview));

  // Presets: Anpassungen und Bildmodus unter einem Namen merken
  let presets = loadPresets();
  const presetSel = h('select', { title: t('Gespeichertes Preset anwenden') }) as HTMLSelectElement;
  const presetName = h('input', { type: 'text', placeholder: t('Name für neues Preset') }) as HTMLInputElement;
  const delBtn = h('button', { class: 'btn', title: t('Gewähltes Preset löschen') }, t('Löschen')) as HTMLButtonElement;
  const renderPresets = (selected = '') => {
    presetSel.replaceChildren(
      h('option', { value: '' }, presets.length ? t('– Preset wählen –') : t('– noch keine Presets –')),
      ...presets.map((p) => h('option', { value: p.name, selected: p.name === selected }, p.name)),
    );
    delBtn.disabled = !presetSel.value;
  };
  presetSel.addEventListener('change', () => {
    const p = presets.find((x) => x.name === presetSel.value);
    delBtn.disabled = !p;
    if (!p) return;
    presetName.value = p.name;
    sB.set(p.adjust.brightness), sC.set(p.adjust.contrast), sG.set(p.adjust.gamma);
    sS.set(p.adjust.sharpen), sR.set(p.adjust.sharpenRadius), sD.set(p.adjust.denoise);
    ed.updateImgLayer(li, p.output, false);
    layerForm.replaceChildren(...imageLayerFields(ed, li, true, drawPreview));
    setAdj({ ...p.adjust });
  });
  const savePresetNow = () => {
    const name = presetName.value.trim();
    if (!name) return presetName.focus();
    if (presets.some((p) => p.name === name) && !confirm(t('Preset „{name}“ überschreiben?', { name }))) return;
    presets = savePreset({ name, adjust: { ...adj }, output: presetOutput(ed.imgLayer(li)) });
    renderPresets(name);
  };
  presetName.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), savePresetNow()));
  delBtn.addEventListener('click', () => {
    const name = presetSel.value;
    if (!name || !confirm(t('Preset „{name}“ löschen?', { name }))) return;
    presets = deletePreset(name);
    renderPresets();
  });
  renderPresets();
  const chk = (label: string, f: (v: boolean) => void) =>
    h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e: Event) => (f((e.target as HTMLInputElement).checked), drawPreview()) }), label);
  let applied = false;
  const dlg = h(
    'dialog',
    { class: 'adjust-dialog' },
    h('h3', {}, targets.length > 1 ? t('Bild anpassen ({n} Bilder)', { n: targets.length }) : t('Bild anpassen')),
    h(
      'div',
      { class: 'adjust-body' },
      h('div', { class: 'adjust-left' },
        view,
        h('div', { class: 'checks' }, chk(t('Original zeigen'), (v) => (showOrig = v)), chk(t('Ausschnitt 1:1'), (v) => (oneToOne = v))),
      ),
      h('div', { class: 'adjust-right' },
        h('div', { class: 'form-title' }, t('Preset')),
        h('div', { class: 'form' },
          h('label', {}, t('Anwenden')), h('span', { class: 'preset-row' }, presetSel, delBtn),
          h('label', {}, t('Speichern')), h('span', { class: 'preset-row' }, presetName, h('button', { class: 'btn', title: t('Aktuelle Anpassungen und Bildmodus als Preset speichern'), onclick: savePresetNow }, t('Speichern'))),
        ),
        h('div', { class: 'form-title' }, t('Anpassen')),
        h('div', { class: 'form' }, ...sB.el, ...sC.el, ...sG.el),
        h('div', { class: 'form-title' }, t('Schärfen')),
        h('div', { class: 'form' }, ...sS.el, ...sR.el, ...sD.el),
        h('div', { class: 'form-title' }, t('Layer {layer}: Bildausgabe', { layer: layerLabel(li) })),
        layerForm,
      ),
    ),
    h('div', { class: 'note' }, t('Die Arbeitsfläche zeigt das Ergebnis live. Bildmodus und Auflösung gelten für alle Bilder des Layers.')),
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', {
        class: 'btn',
        onclick: () => {
          const d = { brightness: 0, contrast: 0, gamma: 1, sharpen: 0, sharpenRadius: 1, denoise: 0 };
          sB.set(0), sC.set(0), sG.set(1), sS.set(0), sR.set(1), sD.set(0);
          setAdj(d);
        },
      }, t('Zurücksetzen')),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          applied = true;
          dlg.close();
        },
      }, t('Übernehmen')),
    ),
  );
  // Desktop-App: das Ergebnis kommt nachträglich aus dem Rust-Kern
  const offReady = onImageReady(drawPreview);
  dlg.addEventListener('close', () => {
    clearTimeout(timer);
    offReady();
    const newAdj = targets.map((o) => ({ ...(o.shape as ImageShape).adjust }));
    const newLayer = { ...ed.imgLayer(li) };
    // Ausgangszustand herstellen; bei „Übernehmen“ die Änderung als ein Undo-Schritt wieder anwenden
    targets.forEach((o, k) => ((o.shape as ImageShape).adjust = origAdj[k]));
    Object.assign(ed.imgLayer(li), origLayer);
    if (applied && (JSON.stringify(newAdj) !== JSON.stringify(origAdj) || JSON.stringify(newLayer) !== JSON.stringify(origLayer))) {
      ed.snapshot(t('Bild anpassen'));
      targets.forEach((o, k) => ((o.shape as ImageShape).adjust = newAdj[k]));
      Object.assign(ed.imgLayer(li), newLayer);
    }
    ed.emit('doc');
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  drawPreview();
}

function assetImageOf(s: ImageShape): HTMLImageElement | null {
  return assetImage(s.asset);
}

// ---------- Bild nachzeichnen ----------

let traceState = { threshold: 128, ignoreLess: 10, smooth: 0.3, deleteImage: false, centerline: false };

function openTraceDialog(ed: Editor) {
  const o = ed.selImages()[0];
  if (!o) {
    ed.hint = t('Erst ein Bild auswählen.');
    ed.emit('tool');
    return;
  }
  const st = { ...traceState };
  const info = h('div', { class: 'note' }, ' ');
  let subs: SubPath[] = [];
  let timer = 0;
  const preview = () => {
    clearTimeout(timer);
    info.textContent = t('Berechne …');
    timer = window.setTimeout(() => {
      const t0 = performance.now();
      subs = ed.traceImage(o, st);
      ed.setPreview(subs);
      const nodes = subs.reduce((n, sp) => n + sp.nodes.length, 0);
      info.textContent = st.centerline
        ? t('{lines} Linien, {nodes} Knoten ({ms} ms). Orange gestrichelt: Vorschau.', { lines: subs.length, nodes, ms: Math.round(performance.now() - t0) })
        : t('{contours} Konturen, {nodes} Knoten ({ms} ms). Orange gestrichelt: Vorschau.', { contours: subs.length, nodes, ms: Math.round(performance.now() - t0) });
    }, 120);
  };
  const sT = slider(t('Schwellwert'), 0, 255, 1, st.threshold, (v) => ((st.threshold = v), preview()));
  const sI = slider(t('Kleines ignorieren (px²)'), 0, 500, 1, st.ignoreLess, (v) => ((st.ignoreLess = v), preview()));
  const sS = slider(t('Glättung'), 0, 1, 0.05, st.smooth, (v) => ((st.smooth = v), preview()));
  const del = h('input', { type: 'checkbox', checked: st.deleteImage, onchange: (e: Event) => (st.deleteImage = (e.target as HTMLInputElement).checked) });
  const note = h('div', { class: 'note' });
  const showNote = () =>
    (note.textContent = st.centerline
      ? t('Striche werden auf ihre Mitte ausgedünnt und als offene Pfade nachgezeichnet, z. B. für Handschrift oder Strichzeichnungen. Kurze Seitenäste werden entfernt.')
      : t('Dunkler als der Schwellwert wird zur Fläche. Helligkeit, Kontrast und Gamma aus „Bild anpassen“ wirken mit.'));
  showNote();
  const mode = h('select', {
    onchange: (e: Event) => ((st.centerline = (e.target as HTMLSelectElement).value === 'center'), showNote(), preview()),
  },
    h('option', { value: 'outline', selected: !st.centerline }, t('Umrisse')),
    h('option', { value: 'center', selected: st.centerline }, t('Mittellinien')),
  ) as HTMLSelectElement;
  let applied = false;
  const dlg = h(
    'dialog',
    { class: 'offset-dialog trace-dialog' },
    h('h3', {}, t('Bild nachzeichnen')),
    h('div', { class: 'form' }, h('label', {}, t('Art')), mode, ...sT.el, ...sI.el, ...sS.el, h('span', { class: 'checks' }, h('label', { class: 'check' }, del, t('Bild danach löschen')))),
    note,
    info,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', { class: 'btn primary', onclick: () => ((applied = true), dlg.close()) }, t('Übernehmen')),
    ),
  );
  dlg.addEventListener('close', () => {
    clearTimeout(timer);
    ed.setPreview(null);
    if (applied) {
      traceState = st;
      subs = ed.traceImage(o, st);
      ed.commitTrace(o, subs, st.deleteImage, st.centerline);
    }
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  preview();
}

// ---------- Palette ----------

function buildPalette(ed: Editor) {
  const root = $('#palette');
  const btns: HTMLButtonElement[] = [];
  PALETTE.forEach((c, i) => {
    const b = h('button', {
      class: i >= 30 ? 'tool' : '',
      style: `background:${c}`,
      title: i >= 30 ? t('Werkzeug-Layer {layer} (wird nicht gelasert)', { layer: layerLabel(i) }) : t('Layer {layer}: Auswahl zuordnen', { layer: layerLabel(i) }),
      onclick: () => ed.assignLayer(i),
    }, layerLabel(i));
    btns.push(b);
    root.append(b);
  });
  const refresh = () => btns.forEach((b, i) => b.classList.toggle('cur', i === ed.currentLayer));
  ed.on((w) => (w === 'sel' || w === 'tool') && refresh());
  refresh();
}

// ---------- Statusleiste ----------

function buildStatus(ed: Editor) {
  const root = $('#status');
  const coords = h('span', { class: 'coords' });
  const selInfo = h('span', {});
  const hint = h('span', { class: 'hint' });
  const snap = h('input', { type: 'checkbox', onchange: (e: Event) => ed.setSnap({ grid: (e.target as HTMLInputElement).checked }) }) as HTMLInputElement;
  const snapObj = h('input', { type: 'checkbox', onchange: (e: Event) => ed.setSnap({ objects: (e.target as HTMLInputElement).checked }) }) as HTMLInputElement;
  const step = numInput('', (v) => v > 0 && ed.setSnap({ step: v }), t('Rasterweite (mm)'));
  step.style.width = '40px';
  step.value = String(ed.gridStep);
  const filled = h('input', { type: 'checkbox', checked: ed.filled, onchange: (e: Event) => ((ed.filled = (e.target as HTMLInputElement).checked), ed.emit('view')) }) as HTMLInputElement;
  const zoom = h('span', {});
  root.append(
    coords, selInfo, hint,
    h('label', { title: t('An Knoten, Mittelpunkten, Zentren, Schnittpunkten und Linien fangen (Ctrl beim Ziehen: umkehren, Alt: stärker und Ausrichtungshilfen)') }, snapObj, t('Fang')),
    h('label', { title: t('Am Raster fangen') }, snap, t('Raster'), step, 'mm'),
    h('label', { title: t('Füll-Layer gefüllt anzeigen (Alt+W)') }, filled, t('Gefüllt')),
    zoom,
    agentStatus(ed),
  );
  const refresh = () => {
    const m = ed.toMachine(ed.cursor);
    coords.textContent = `x ${m.x.toFixed(2)}  y ${m.y.toFixed(2)} mm`;
    const b = ed.selBounds();
    selInfo.textContent = b
      ? `${tn('{n} Objekt', '{n} Objekte', ed.sel.length)} · ${b.w.toFixed(2)} × ${b.h.toFixed(2)} mm`
      : tn('{n} Objekt', '{n} Objekte', ed.doc.objs.length);
    if (ed.doc.pages.length > 1) {
      const name = ed.doc.pages[ed.doc.page].name;
      const pg = t('Seite {n}/{total}', { n: ed.doc.page + 1, total: ed.doc.pages.length });
      selInfo.textContent = `${name === pageName(ed.doc.page) ? pg : `${pg} (${name})`} · ${selInfo.textContent}`;
    }
    hint.textContent = ed.hint;
    snap.checked = ed.snapGrid;
    if (document.activeElement !== step) step.value = dec(String(ed.gridStep));
    snapObj.checked = ed.snapObjects;
    filled.checked = ed.filled;
    zoom.textContent = `${Math.round(ed.view.zoom * 100) / 100} px/mm`;
  };
  ed.on(refresh);
  refresh();
}

// ---------- Texteingabe ----------

function buildTextEditor(ed: Editor) {
  const box = $('#texteditor');
  const ta = box.querySelector('textarea')!;
  let target: import('./model').Obj | null = null;
  let snapDone = false;
  const close = () => {
    if (!target) return;
    const t = target;
    target = null;
    box.hidden = true;
    ed.removeIfEmptyText(t);
    ed.canvas.focus();
  };
  ed.textEditor = (o, isNew) => {
    close();
    target = o;
    snapDone = isNew; // neuer Text: Snapshot wurde schon beim Anlegen erstellt
    ta.value = o.shape.kind === 'text' ? o.shape.text : '';
    const stage = $('#stage').getBoundingClientRect();
    const p = ed.toScreen({ x: o.m[4], y: o.m[5] });
    box.style.left = `${Math.max(4, Math.min(stage.width - 290, p.x))}px`;
    box.style.top = `${Math.max(4, Math.min(stage.height - 110, p.y + 12))}px`;
    box.hidden = false;
    ta.focus();
    setTimeout(() => ta.focus(), 0);
  };
  ta.addEventListener('input', () => {
    if (!target) return;
    if (!snapDone) {
      ed.snapshot(t('Text bearbeiten'));
      snapDone = true;
    }
    ed.setText(target, ta.value);
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      close();
    }
    e.stopPropagation();
  });
  ed.canvas.addEventListener('pointerdown', () => {
    if (target && ed.tool !== 'text') close();
  }, true);
  ta.addEventListener('blur', () => setTimeout(() => document.activeElement !== ta && close(), 0));
}
