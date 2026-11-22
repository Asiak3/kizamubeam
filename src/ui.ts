import { openOutlineDialog } from './outlineDialog';
import { canEnterIsolation } from './isolation';
// Oberfläche: Menü, Leisten, Panels, Palette, Statusleiste.
import { Editor, Tool } from './editor';
import { initSync, openSyncDialog } from './syncDialog';
import type { CornerMode } from './corners';
import { ImageAdjust, ImageShape, Layer, layerLabel, Obj, pageName, PALETTE, SubPath } from './model';
import { deletePreset, loadPresets, presetOutput, savePreset } from './imagePresets';
import { openFillDialog, openSaveTemplateDialog, openSeriesDialog, openTemplateLibrary } from './templateDialogs';
import { exportDxf, exportPdf, exportSvg, importFile, installDropAndPaste, openProject, saveProcessedBitmap, saveProject } from './files';
import { onMeshReady } from './model3d/store';
import { onImageResourceReady } from './plugins/imageResource';
import { assetImage, displayCanvas, onImageReady } from './images';
import { openFontManager } from './fontManager';
import { $, evalExpr, h, numInput } from './dom';
import { openCircularArrayDialog, openGridArrayDialog } from './arrayDialogs';
import { openNestDialog } from './nestDialog';
import { openWorkpieceDialog } from './workpieceDialog';
import { cameraOverlaysVisible, toggleCameraOverlays } from './cameraOverlayVisibility';
import { openBackgroundDialog } from './bgDialog';
import { openJointDialog } from './jointDialog';
import { openHingeDialog } from './hingeDialog';
import { openPatternDialog } from './patternDialog';
import { PATTERN_GEN_ID } from './pattern';
import { openSlotDialog } from './slotDialog';
import { openSlotPlacementDialog } from './slotPlacementDialog';
import { isSlotGenerator } from './slotPlacement';
import { isContourOffsetGenerator } from './contourOffset';
import { openContourOffsetDialog } from './contourOffsetDialog';
import { openWarpDialog } from './warpDialog';
import { ZOOM_STEP, clampPan, imageOrigin, panBy, resetZoomView, zoomAtCursor, zoomPercent, type ZoomView } from './previewZoom';
import { cropDraftEnabled, EDIT_TITLE, runImageEdit } from './imageCropUi';
import { openVectorFitDialog } from './vectorDialog';
import { installEditorContext, stackingActions } from './editorContext';
import { bindingLabel, bindings, commandFor, commandKey, onShortcutsChanged, withShortcut } from './commandKeys';
import { openQrDialog, openVarTextDialog } from './qrDialog';
import { openBarcodeDialog } from './barcodeDialog';
import { askGenConvert, openGenDialog } from './generators/dialog';
import { assignLayerAsk, needsChildLayersQuestion } from './layerAssign';
import { GENERATORS } from './generators';
import { maybeOfferSetup, openSetupWizard } from './setupWizard';
import { maybeCheckForUpdates, nightlyBuild, nightlyWarning, openUpdateDialog } from './updateDialog';
import { openPacksDialog } from './packsDialog';
import { openGridDialog } from './gridDialog';
import { applyNewDocDefaults, buildLaser, frameJob, isPositionPick, openDeviceDialog, openDevicesDialog, openPreview, openRotaryDialog, saveGCode, startJob, togglePositionPick } from './laser';
import { openLayerDialog, setAdjustOpener } from './layerdialog';
import { imageLayerFields, liveLayerRaster } from './imageLayerFields';
import { openMaterialTestDialog } from './materialtest';
import { openTestPhotoDialog } from './testphotoDialog';
import { BoolBase } from './ops';
import { agentStatus, openAgentDialog } from './agentui';
import { startAgentBridge } from './agent';
import { openRemoteHostDialog, openRemoteJobsDialog, remoteHostStatus, startRemoteHost } from './remoteHost';
import { openHostSyncDialog } from './remote';
import { buildObjectsPanel } from './objectsPanel';
import { buildTabBar, closeTabAsk } from './tabsBar';
import { loadGroupedTabs, loadTabPages, saveGroupedTabs, saveTabPages } from './editor/tabs';
import { isSnapOn, toggleSnapMaster } from './editor/snapping';
import { buildHistoryPanel } from './historyPanel';
import { buildLibraryPanel, openAddSelectionDialog } from './libraryPanel';
import { buildCheckPanel, openCheck } from './checkPanel';
import { openCalibrateDialog } from './calibrateDialog';
import { openFocusTestDialog } from './focustestDialog';
import { openPrintCutDialog } from './printcutDialog';
import { openGenerator } from './generators/run';
import { openJigFillDialog } from './jigFillDialog';
import { openMultiLayerDialog } from './multilayerDialog';
import { buildParamsPanel, openShowIfDialog } from './paramsPanel';
import { buildNotesPanel } from './notesPanel';
import { buildView3dPanel } from './view3d/panel';
import { buildAppsPanel, openAppsPanel } from './appsPanel';
import { installSketchPanel } from './sketchPanel';
import { isSketchObj } from './editor/sketch';
import { loadRightPan } from './editor/pointer';
import { dockWindow, initDock, isHidden, resetLayout, toggleWindow, showWindow, windowList } from './dock';

import { REL_HINTS, REL_LABELS, REL_MODES, RelMode } from './relations';
import { Action, BarKey, barNames, initToolbars, isBarHidden, openToolbarDialog, refreshBars, SEP, setToolbarControls, showAllBars, toggleBar } from './toolbars';
import { bindEditorToolbarDialogs, createEditorToolbarControls } from './toolbars/controls';
import { dec, LangPref, langPref, LANGUAGES, setLangPref, t, tn } from './i18n';
import { version as APP_VERSION } from '../package.json';
import symbolLight from './assets/brand/symbol-64.png';
import symbolDark from './assets/brand/symbol-64-dark.png';
import logoLight from './assets/brand/logo-stacked.png';
import logoDark from './assets/brand/logo-stacked-dark.png';

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
  bindEditorToolbarDialogs(ed, {
    corner: () => openCornerDialog(ed), adjust: () => openAdjustDialog(ed), trace: () => openTraceDialog(ed),
  });
  setToolbarControls(createEditorToolbarControls(ed, refreshBars));
  buildBars(ed);
  buildLayers(ed);
  const contextCallbacks = {
    adjust: () => openAdjustDialog(ed), trace: () => openTraceDialog(ed), background: () => openBackgroundDialog(ed),
    saveBitmap: () => saveProcessedBitmap(ed), vectorFit: () => openVectorFitDialog(ed), builder: () => beginShapeBuilder(ed),
    library: () => openAddSelectionDialog(ed), preview: () => openPreview(ed), objects: () => showWindow('objects'),
  };
  buildObjectsPanel(ed, contextCallbacks);
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
  registerCoreSettings(ed, {
    theme: () => themeMode,
    setTheme: (m) => applyTheme(ed, m),
    setLanguage: (p) => changeLanguage(ed, p),
    shortcutCommands: () => shortcutCommands,
    fixedKeys: fixedKeyRows,
  });
  buildMenu(ed);

  const isolationBadge = h('div', { class: 'editor-isolation-badge', hidden: true },
    h('span', {}, t('Isolation aktiv – kein Ausgabefilter')),
    h('button', { type: 'button', class: 'btn', onclick: () => ed.leaveIsolation() }, t('Isolation verlassen')));
  document.body.append(isolationBadge);
  ed.on(() => { isolationBadge.hidden = !ed.isolation; });
  installEditorContext(ed, contextCallbacks);
  buildPalette(ed);
  buildStatus(ed);
  startAgentBridge(ed);
  void startRemoteHost(ed);
  buildTextEditor(ed);
  ed.onImport = () => importFile(ed);
  // 3D-Modelle aus der automatischen Sicherung kommen etwas später: 3D-Ansicht und Prüfung neu zeichnen
  onMeshReady(() => ed.emit('doc'));
  onImageResourceReady(() => ed.emit('doc'));
  ed.onBarcodeEdit = (o) => editBarcode(ed, o);
  ed.onGenEdit = (o) => (o.shape.kind === 'gen' && o.shape.gen === PATTERN_GEN_ID ? openPatternDialog(ed, { edit: o }) : o.shape.kind === 'gen' && isContourOffsetGenerator(o.shape.gen) ? openContourOffsetDialog(ed) : o.shape.kind === 'gen' && isSlotGenerator(o.shape.gen) ? openSlotPlacementDialog(ed, o) : isSketchObj(o) ? void ed.editSketch(o) : openGenDialog(ed, '', o));
  installSketchPanel(ed);
  ed.onGenGuard = askGenConvert;
  ed.onJointDialog = () => openJointDialog(ed);
  ed.onRelDistance = (cur) => askDistance(cur);
  installDropAndPaste(ed, $('#stage'));
  buildTabBar(ed);
}

async function beginShapeBuilder(ed: Editor): Promise<void> {
  if (ed.tool === 'builder' && ed.builderSession) return;
  if (!ed.sel.length) return;
  if (!confirm(t('Formerstellung als lokalen Test starten? Die erste Bearbeitung erstellt unabhängige Pfade und setzt die erhaltenen Originale auf „Nicht lasern“. Parametrische Originale bleiben editierbar; Ergebnisse aktualisieren sich nicht automatisch. Offene Linien und Lückenerkennung sind noch nicht unterstützt.'))) return;
  await ed.startShapeBuilder();
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
  document.title = nightlyBuild ? `KizamuBeam ${APP_VERSION}` : 'KizamuBeam';
  ($('#texteditor textarea') as HTMLTextAreaElement).placeholder = t('Text eingeben …');
  $('#texteditor .hint').textContent = t('Enter: neue Zeile · Ctrl+Enter oder Esc: fertig');
}

// ---------- Menü ----------

/** command: Kennung für das Tastenkürzel (commandKeys.ts), leer = keins; checked: Häkchen; enabled/visible: beim Öffnen prüfen; sub: Untermenü */
type MenuItem = [label: string, command: string, action: () => void, checked?: () => boolean, enabled?: () => boolean, visible?: () => boolean] | { sub: string; items: MenuItem[] } | 'sep';

function buildMenu(ed: Editor) {
  const menus: [string, MenuItem[]][] = [
    [t('Datei'), [
      [t('Neu'), 'new', () => (ed.newTab(), applyNewDocDefaults())],
      [t('Neu aus Vorlage …'), 'newtemplate', () => openTemplateLibrary(ed)],
      [t('Öffnen …'), 'open', () => openProject(ed)],
      [t('Speichern …'), 'save', () => saveProject(ed)],
      [t('Tab schließen'), '', () => closeTabAsk(ed)],
      'sep',
      [t('Als Vorlage speichern …'), '', () => openSaveTemplateDialog(ed)],
      [t('Vorlage ausfüllen …'), 'filltemplate', () => openFillDialog(ed)],
      [t('Serie aus Tabelle (CSV) …'), 'series', () => openSeriesDialog(ed)],
      'sep',
      [t('Importieren …'), 'import', () => importFile(ed)],
      { sub: t('Exportieren'), items: [
        [t('Als SVG exportieren …'), 'export', () => exportSvg(ed)],
        [t('Als DXF exportieren …'), 'export-dxf', () => exportDxf(ed)],
        [t('Als PDF exportieren …'), 'export-pdf', () => exportPdf(ed, 'pdf')],
        [t('Als Illustrator-Datei (AI) exportieren …'), 'export-ai', () => exportPdf(ed, 'ai')],
      ] },
      [t('Bearbeitetes Bild speichern …'), '', () => saveProcessedBitmap(ed)],
      'sep',
      [t('Schriften …'), 'fonts', () => openFontManager(ed)],
      [t('Erweiterungen …'), 'packs', () => openPacksDialog(ed.doc)],
      [t('Einstellungen übertragen …'), 'sync', () => openSyncDialog(ed)],
      [t('KI-Agenten (MCP) …'), '', () => openAgentDialog(ed)],
    ]],
    [t('Bearbeiten'), [
      [t('Rückgängig'), 'undo', () => ed.doUndo()],
      [t('Wiederholen'), 'redo', () => ed.doRedo()],
      'sep',
      [t('Ausschneiden'), 'cut', () => ed.cut()],
      [t('Kopieren'), 'copy', () => ed.copy()],
      [t('Einfügen'), 'paste', () => ed.paste()],
      [t('An Originalposition einfügen'), 'paste-in-place', () => ed.paste(0)],
      [t('Duplizieren'), 'duplicate', () => ed.duplicate()],
      [t('Löschen'), 'delete', () => ed.deleteSel()],
      'sep',
      [t('Alles auswählen'), 'selectall', () => ed.selectAll()],
      [t('In Pfad umwandeln'), 'tolines', () => ed.convertSelToPath()],
      'sep',
      [t('Sichtbar, wenn …'), '', () => openShowIfDialog(ed, ed.sel)],
      [t('Zur Bibliothek hinzufügen …'), '', () => openAddSelectionDialog(ed)],
      'sep',
      [t('Einstellungen …'), 'preferences', () => void openSettings()],
    ]],
    [t('Werkzeuge'), [
      [t('Werkzeugkasten …'), '', () => openAppsPanel()],
      'sep',
      [t('Auswählen'), 'tool:select', () => ed.setTool('select')],
      [t('Knoten bearbeiten'), 'tool:node', () => ed.setTool('node')],
      'sep',
      [t('Linien zeichnen'), 'tool:line', () => ed.setTool('line')],
      [t('Freihand / Bleistift'), 'tool:pencil', () => ed.setTool('pencil')],
      [t('Shaper'), 'tool:shaper', () => ed.setTool('shaper')],
      [t('Kurvenpfad zeichnen'), 'tool:curvature', () => ed.setTool('curvature')],
      [t('Bogen zeichnen'), 'tool:arc', () => ed.setTool('arc')],
      [t('Auswahl isolieren'), '', () => ed.isolateSelection(), undefined, () => canEnterIsolation(ed)],
      [t('Isolation verlassen'), '', () => ed.leaveIsolation(), undefined, () => !!ed.isolation, () => !!ed.isolation],
      [t('Pfade vereinfachen / glätten…'), 'vectorfit', () => openVectorFitDialog(ed)],
      [t('Formerstellung …'), 'shape-builder', () => beginShapeBuilder(ed)],
      [t('Schlitze / Ausklinkungen platzieren …'), 'slotplace', () => openSlotPlacementDialog(ed)],
      [t('Rechteck'), 'tool:rect', () => ed.setTool('rect')],
      [t('Ellipse'), 'tool:ellipse', () => ed.setTool('ellipse')],
      [t('Polygon'), 'tool:polygon', () => ed.setTool('polygon')],
      [t('Text'), 'tool:text', () => ed.setTool('text')],
      [t('Messen'), 'tool:measure', () => ed.setTool('measure')],
      'sep',
      { sub: t('Boolesche Operationen'), items: [
        [t('Vereinen'), 'union', () => ed.booleanSel('union')],
        [t('Abziehen'), 'subtract', () => ed.booleanSel('subtract')],
        [t('Vordere vom hinteren abziehen'), '', () => ed.booleanSel('subtract', 'back')],
        [t('Hintere vom vorderen abziehen'), '', () => ed.booleanSel('subtract', 'front')],
        [t('Schnittmenge'), 'intersect', () => ed.booleanSel('intersect')],
        'sep',
        [t('Boolesche Optionen …'), 'boolopts', () => openBooleanDialog(ed)],
      ] },
      [t('Außenkontur und Inseln ableiten …'), 'outline', () => void openOutlineDialog(ed)],
      [t('Offset …'), 'offset', () => openOffsetDialog(ed)],
      [t('Lokaler Konturversatz …'), 'contouroffset', () => openContourOffsetDialog(ed)],
      [t('Verformen …'), 'warp', () => openWarpDialog(ed)],
      { sub: t('Pfad'), items: [
        [t('Pfad schließen'), 'closepath', () => ed.closeSel()],
        [t('Pfade mit Toleranz schließen …'), '', () => openCloseDialog(ed)],
        [t('Ausgewählte Formen verbinden'), 'join', () => ed.joinSel()],
        [t('Zerlegen'), 'breakapart', () => ed.breakApartSel()],
        [t('Freihandpfad bearbeiten …'), 'freehand-edit', () => openFreehandEditDialog(ed)],
        [t('Lasso-Auswahl'), 'tool:lasso', () => ed.setTool('lasso')],
        [t('Pfadinseln trennen …'), 'path-islands', () => openPathIslandsDialog(ed)],
        [t('Richtung umkehren'), 'reverse', () => ed.reverseSel()],
        [t('Ecken runden oder fasen …'), 'corners', () => openCornerDialog(ed)],
        'sep',
        [t('Formen trimmen'), 'tool:trim', () => ed.setTool('trim')],
        [t('Startpunkt setzen'), 'tool:start', () => ed.setTool('start')],
        'sep',
        [t('Mittelpunkte markieren'), '', () => ed.markCentersSel()],
      ] },
      { sub: t('Array'), items: [
        [t('Rasterarray …'), 'gridarray', () => openGridArrayDialog(ed)],
        [t('Kreisarray …'), 'circarray', () => openCircularArrayDialog(ed)],
      ] },
      'sep',
      { sub: t('Textfunktionen'), items: [
        [t('Text auf Pfad'), 'textpath', () => ed.applyPathToText()],
        [t('Text vom Pfad lösen'), '', () => ed.removePathFromText()],
        'sep',
        [t('Variabler Text …'), 'vartext', () => openVarTextDialog(ed)],
        [t('Variablen Text festschreiben'), '', () => bakeVarText(ed)],
      ] },
      { sub: t('Bild'), items: [
        [t('Bild anpassen …'), 'adjust', () => openAdjustDialog(ed)],
        [t('Bild nachzeichnen …'), 'trace', () => openTraceDialog(ed)],
        [t('Hintergrund entfernen …'), 'bgremove', () => openBackgroundDialog(ed)],
        [EDIT_TITLE(), 'imageedit', () => runImageEdit(ed)],
        [t('Bild zuschneiden'), '', () => ed.cropImageSel(false)],
        [t('Maske auf Bild anwenden'), '', () => ed.cropImageSel(true)],
      ] },
    ]],
    [t('Anordnen'), [
      [t('Gruppieren'), 'group', () => ed.group()],
      [t('Gruppierung aufheben'), 'ungroup', () => ed.ungroup()],
      'sep',
      { sub: t('Spiegeln und drehen'), items: [
        [t('Horizontal spiegeln'), 'mirrorh', () => ed.mirror(true)],
        [t('Vertikal spiegeln'), 'mirrorv', () => ed.mirror(false)],
        'sep',
        [t('90° im Uhrzeigersinn'), 'rotcw', () => ed.rotateBy(-90)],
        [t('90° gegen Uhrzeigersinn'), 'rotccw', () => ed.rotateBy(90)],
      ] },
      { sub: t('Ausrichten und verteilen'), items: [
        [t('Links ausrichten'), 'alignl', () => ed.align('left')],
        [t('Rechts ausrichten'), 'alignr', () => ed.align('right')],
        [t('Oben ausrichten'), 'alignt', () => ed.align('top')],
        [t('Unten ausrichten'), 'alignb', () => ed.align('bottom')],
        [t('Mitten horizontal'), 'alignhc', () => ed.align('hcenter')],
        [t('Mitten vertikal'), 'alignvc', () => ed.align('vcenter')],
        'sep',
        [t('Horizontal verteilen'), 'disth', () => ed.distribute(true)],
        [t('Vertikal verteilen'), 'distv', () => ed.distribute(false)],
      ] },
      { sub: t('Reihenfolge'), items: ([['front', t('Ganz nach vorne')], ['forward', t('Eine Ebene nach vorne')],
        ['backward', t('Eine Ebene nach hinten')], ['back', t('Ganz nach hinten')]] as const).map(([dir, label]): MenuItem =>
        [label, dir === 'front' ? 'tofront' : dir === 'back' ? 'toback' : dir, () => ed.restack(dir), undefined, () => ed.canRestack(dir)]) },
      { sub: t('Beziehungen'), items: [
        ...REL_MODES.map((m): MenuItem => [REL_LABELS[m], `rel:${m}`, () => ed.startRelation(m), () => ed.tool === 'relate' && ed.relMode === m]),
      ] },
      'sep',
      [t('Verschachteln …'), 'nest', () => openNestDialog(ed)],
      'sep',
      [t('Nicht lasern'), '', () => ed.toggleNoLaser(), () => ed.sel.length > 0 && ed.sel.every((o) => o.noLaser)],
    ]],
    [t('Seiten'), [
      [t('Neue Seite'), 'addpage', () => ed.addPage()],
      [t('Seite duplizieren'), '', () => ed.duplicatePage()],
      [t('Seite löschen'), '', () => ed.deletePage()],
      'sep',
      [t('Vorherige Seite'), 'prevpage', () => ed.setPage(ed.doc.page - 1)],
      [t('Nächste Seite'), 'nextpage', () => ed.setPage(ed.doc.page + 1)],
      'sep',
      { sub: t('Auswahl verschieben'), items: [
        [t('Auswahl auf vorherige Seite'), '', () => ed.moveToPage(ed.sel, ed.doc.page - 1)],
        [t('Auswahl auf nächste Seite'), '', () => ed.moveToPage(ed.sel, ed.doc.page + 1)],
      ] },
    ]],
    [t('Laser'), [
      [t('Konstruktion prüfen'), 'check', () => openCheck()],
      [t('Vorschau …'), 'preview', () => openPreview(ed)],
      [t('G-Code speichern …'), 'gcode', () => saveGCode(ed)],
      'sep',
      [t('Start'), 'start', () => startJob(ed)],
      [t('Rahmen'), 'frame', () => frameJob(ed, false)],
      [t('Kontur-Rahmen'), 'contour', () => frameJob(ed, true)],
      'sep',
      [t('Laser einrichten …'), 'setup', () => openSetupWizard(ed)],
      { sub: t('Test und Kalibrieren'), items: [
        [t('Materialtest …'), 'materialtest', () => openMaterialTestDialog(ed)],
        [t('Materialtest auswerten …'), 'testphoto', () => openTestPhotoDialog(ed)],
        [t('Fokustest …'), 'focustest', () => openFocusTestDialog(ed)],
        [t('Passung kalibrieren …'), 'calibrate', () => openCalibrateDialog(ed)],
      ] },
      { sub: t('Fernsteuerung'), items: [
        [t('Host-Modus …'), '', () => openRemoteHostDialog(ed)],
        [t('Fernaufträge …'), '', () => openRemoteJobsDialog(ed)],
        'sep',
        [t('Vom Host übernehmen …'), '', () => void openHostSyncDialog(ed)],
      ] },
      { sub: t('Gerät'), items: [
        [t('Geräte …'), 'devices', () => openDevicesDialog(ed)],
        [t('Geräteeinstellungen …'), 'devsettings', () => openDeviceDialog(ed)],
        [t('Drehachse (Rotary) …'), 'rotary', () => openRotaryDialog()],
      ] },
      { sub: 'FluidNC', items: [
        [t('Konfiguration …'), '', () => import('./fluidncDialog').then((m) => m.openFluidConfig())],
        [t('Dateien auf der Steuerung …'), '', () => import('./fluidncDialog').then((m) => m.openFluidFiles(ed))],
      ] },
    ]],
    [t('Ansicht'), [
      [t('Alle Kameraüberlagerungen anzeigen'), 'camera-overlays', () => toggleCameraOverlays(ed), cameraOverlaysVisible],
      [t('Ganze Seite'), 'zoompage', () => ed.zoomPage()],
      [t('Auf Auswahl zoomen'), 'zoomsel', () => ed.zoomSelection()],
      [t('Vergrößern'), 'zoomin', () => ed.zoomAt(1.25)],
      [t('Verkleinern'), 'zoomout', () => ed.zoomAt(0.8)],
      'sep',
      [t('Drahtgitter / Gefüllt'), 'wire', () => ed.setFilled(!ed.filled)],
      { sub: t('Mittelpunkte zeigen'), items: [
        [t('Aus|Mittelpunkte'), '', () => ed.setSnap({ centers: 'off' }), () => ed.centerMarks === 'off'],
        [t('Bei Auswahl und unter dem Mauszeiger'), '', () => ed.setSnap({ centers: 'auto' }), () => ed.centerMarks === 'auto'],
        [t('Immer|Mittelpunkte'), '', () => ed.setSnap({ centers: 'all' }), () => ed.centerMarks === 'all'],
      ] },
      'sep',
      [t('Gruppierte Tabs'), '', () => { saveGroupedTabs(!loadGroupedTabs()); ed.onTabsChange?.(); }, () => loadGroupedTabs()],
      [t('Seiten in Tabs'), '', () => { saveTabPages(!loadTabPages()); ed.onTabsChange?.(); }, () => loadTabPages()],
      { sub: t('Gitter'), items: [
        [t('Gitter anzeigen'), 'grid', () => ed.setGrid({ show: !ed.grid.show }), () => ed.grid.show],
        [t('Gitter einstellen …'), 'gridsettings', () => openGridDialog(ed)],
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
    [t('Hilfe'), [[t('Tastenkürzel'), 'help', () => showHelp()], 'sep', [t('Nach Updates suchen …'), '', () => openUpdateDialog()], [t('Über KizamuBeam …'), '', () => showAbout()]]],
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
  // Häkchen und Verfügbarkeit werden beim Öffnen des Hauptmenüs aktualisiert
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
        const enabled = it[4];
        if (it[1]) menuCommands.add(it[1]);
        const kbd = h('kbd');
        const showKey = () => { kbd.textContent = commandKey(it[1]); kbd.hidden = !kbd.textContent; };
        showKey();
        checks.push(showKey);
        const b = h('button', { onclick: () => { if (!enabled || enabled()) { close(); it[2](); } } }, h('span', {}, it[0]), kbd);
        if (enabled) checks.push(() => { b.disabled = !enabled(); });
        const visible = it[5];
        if (visible) checks.push(() => { b.hidden = !visible(); });
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
}

/** Logo, Version, Herkunft des Namens und Lizenz */
function showAbout() {
  const dlg = h(
    'dialog',
    { class: 'about' },
    h('img', { src: isDark() ? logoDark : logoLight, alt: 'KizamuBeam' }),
    h('p', {}, t('Version {version}', { version: APP_VERSION })),
    nightlyBuild ? h('p', { class: 'note' }, nightlyWarning()) : null,
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

/** Keys and mouse actions with a fixed meaning (shortcut overview and Settings → Mouse and keyboard) */
function fixedKeyRows(): [string, string][] {
  return [
    ['Esc', t('Auswahlwerkzeug / Auswahl aufheben')],
    [t('Entf'), t('Löschen')],
    [t('Klick auf Auswahl'), t('Zwischen Skalieren und Drehen wechseln')],
    [t('Shift / Ctrl beim Ziehen'), t('Proportional bzw. frei / von der Mitte')],
    [t('Pfeiltasten'), t('1 mm verschieben (Shift 10 mm, Alt 0,1 mm)')],
    [loadRightPan() ? t('Leertaste + Ziehen, Mitteltaste, rechte Maustaste') : t('Leertaste + Ziehen, Mitteltaste'), t('Ansicht verschieben')],
    [t('Mausrad'), t('Zoomen')],
    [t('Knoten: D I L C E S'), t('Löschen, Einfügen, Gerade, Kurve, Ecke, Glatt')],
    [t('Ctrl beim Ziehen'), t('Fangen vorübergehend umkehren (aus, wenn eingeschaltet)')],
    [t('Alt beim Ziehen'), t('Stärker fangen und Ausrichtungshilfen an anderen Objekten')],
    [t('Aus dem Lineal ziehen'), t('Hilfslinie auf eigener Ebene, wird nie gelasert (verschieben durch Ziehen, zurück ins Lineal: löschen)')],
    [t('Palette'), t('Farbe anklicken = Auswahl diesem Layer zuordnen')],
  ];
}

/** Shortcut overview (F1): every command with a shortcut, then the fixed keys */
function helpRows(): [string, string][] {
  const commands = shortcutCommands.filter((c) => bindings(c.id).length).map((c): [string, string] => [
    bindings(c.id).map(bindingLabel).join(' / '),
    // Import also explains drag and paste
    c.id === 'import' ? t('Importieren (Bilder, SVG, DXF, PDF, AI, 3D-Modelle); Dateien auch auf die Arbeitsfläche ziehen oder mit Ctrl+V einfügen') : c.label.split(': ')[0],
  ]);
  return [...commands, ...fixedKeyRows()];
}

function showHelp() {
  const rows = helpRows();
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

// ---------- Numerik- und Formleiste, Textleiste ----------

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
    { id: 'new', cat: F, icon: 'new', label: t('Neues Projekt in neuem Tab'), run: () => (ed.newTab(), applyNewDocDefaults()) },
    { id: 'open', cat: F, icon: 'open', label: t('Öffnen'), run: () => openProject(ed) },
    { id: 'save', cat: F, icon: 'save', label: t('Speichern'), run: () => saveProject(ed) },
    { id: 'import', cat: F, icon: 'import', label: t('Importieren: Bilder, SVG, DXF, PDF, AI, LightBurn, 3D-Modelle'), run: () => importFile(ed) },
    { id: 'export', cat: F, icon: 'export', label: t('Als SVG exportieren'), run: () => exportSvg(ed) },
    { id: 'export-dxf', cat: F, icon: 'dxf', short: 'DXF', label: t('Als DXF exportieren'), run: () => exportDxf(ed) },
    { id: 'export-pdf', cat: F, icon: 'pdf', short: 'PDF', label: t('Als PDF exportieren'), run: () => exportPdf(ed, 'pdf') },
    { id: 'export-ai', cat: F, icon: 'ai', short: 'AI', label: t('Als Illustrator-Datei (AI) exportieren'), run: () => exportPdf(ed, 'ai') },
    { id: 'undo', cat: B, icon: 'undo', label: t('Rückgängig'), run: () => ed.doUndo() },
    { id: 'redo', cat: B, icon: 'redo', label: t('Wiederholen'), run: () => ed.doRedo() },
    { id: 'cut', cat: B, icon: 'cut', label: t('Ausschneiden'), run: () => ed.cut(), enabled: sel1 },
    { id: 'copy', cat: B, icon: 'copy', label: t('Kopieren'), run: () => ed.copy(), enabled: sel1 },
    { id: 'paste', cat: B, icon: 'paste', label: t('Einfügen'), run: () => ed.paste() },
    { id: 'duplicate', cat: B, icon: 'duplicate', short: t('Dupl.'), label: t('Duplizieren'), run: () => ed.duplicate(), enabled: sel1 },
    { id: 'delete', cat: B, icon: 'delete', label: t('Löschen'), run: () => ed.deleteSel(), enabled: sel1 },
    { id: 'selectall', cat: B, icon: 'selectall', short: t('Alle'), label: t('Alles auswählen'), run: () => ed.selectAll() },
    { id: 'tolines', cat: B, icon: 'tolines', label: t('In Pfad umwandeln'), run: () => ed.convertSelToPath(), enabled: sel1 },
    { id: 'closepath', cat: M, icon: 'closepath', short: t('Schließen|Pfad'), label: t('Pfad schließen'), run: () => ed.closeSel(), enabled: sel1 },
    { id: 'join', cat: M, icon: 'join', short: t('Verbinden|Pfade'), label: t('Ausgewählte Formen verbinden'), run: () => ed.joinSel(), enabled: sel2 },
    { id: 'breakapart', cat: M, icon: 'breakapart', short: t('Zerlegen'), label: t('Zerlegen'), run: () => ed.breakApartSel(), enabled: sel1 },
    { id: 'freehand-edit', cat: W, icon:'line', label:t('Freihandpfad bearbeiten …'), run:()=>openFreehandEditDialog(ed), enabled:sel1, on:()=>ed.tool==='freehand-edit' },
    tool('lasso', 'lasso', t('Lasso-Auswahl')),
    { id: 'path-islands', cat: M, icon: 'islands', short: t('Pfadinseln'), label: t('Pfadinseln trennen …'), run: () => openPathIslandsDialog(ed), enabled: sel1 },
    { id: 'reverse', cat: M, icon: 'reverse', short: t('Umkehren'), label: t('Richtung umkehren'), run: () => ed.reverseSel(), enabled: sel1 },
    { id: 'corners', cat: M, icon: 'corners', short: t('Ecken'), label: t('Ecken runden oder fasen …'), run: () => openCornerDialog(ed), enabled: sel1 },
    { id: 'zoomin', cat: V, icon: 'zoomin', label: t('Vergrößern'), run: () => ed.zoomAt(1.25) },
    { id: 'zoomout', cat: V, icon: 'zoomout', label: t('Verkleinern'), run: () => ed.zoomAt(0.8) },
    { id: 'zoompage', cat: V, icon: 'zoompage', label: t('Ganze Seite'), run: () => ed.zoomPage() },
    { id: 'grid', cat: V, icon: 'grid', label: t('Gitter ein-/ausblenden'), run: () => ed.setGrid({ show: !ed.grid.show }), on: () => ed.grid.show },
    { id: 'snap-toggle', cat: V, icon: 'snap', label: t('Fangen ein-/ausschalten (Objekt- und Rasterfang bleiben getrennt einstellbar)'), run: () => toggleSnapMaster(ed), on: () => isSnapOn(ed) },
    { id: 'camera-overlays', cat: V, icon: 'cameraOverlay', label: t('Alle Kameraüberlagerungen anzeigen'), run: () => toggleCameraOverlays(ed), on: cameraOverlaysVisible,
      dyn: () => ({ icon: cameraOverlaysVisible() ? 'cameraOverlay' : 'cameraOverlayOff' }) },
    { id: 'gridsettings', cat: V, icon: 'settings', small: true, label: t('Gitter einstellen …'), run: () => openGridDialog(ed) },
    { id: 'zoomsel', cat: V, icon: 'zoomsel', label: t('Auf Auswahl zoomen'), run: () => ed.zoomSelection(), enabled: sel1 },
    { id: 'view3d', cat: V, icon: 'view3d', label: t('3D-Ansicht: Baugruppen zusammengesteckt ansehen'), run: () => toggleWindow('view3d') },
    { id: 'wire', cat: V, icon: 'wire', short: t('Gefüllt'), label: t('Drahtgitter / Gefüllt'), run: () => ed.setFilled(!ed.filled), on: () => ed.filled },
    {
      id: 'theme', cat: V, icon: 'moon', label: t('Dunkles Design'), run: () => applyTheme(ed, isDark() ? 'light' : 'dark'),
      dyn: () => (isDark() ? { icon: 'sun', label: t('Helles Design') } : { icon: 'moon', label: t('Dunkles Design') }),
    },
    { id: 'group', cat: A, icon: 'group', label: t('Gruppieren'), run: () => ed.group(), enabled: sel2 },
    { id: 'ungroup', cat: A, icon: 'ungroup', label: t('Gruppierung aufheben'), run: () => ed.ungroup(), enabled: sel1 },
    { id: 'mirrorh', cat: A, icon: 'mirrorh', label: t('Horizontal spiegeln'), run: () => ed.mirror(true), enabled: sel1 },
    { id: 'mirrorv', cat: A, icon: 'mirrorv', label: t('Vertikal spiegeln'), run: () => ed.mirror(false), enabled: sel1 },
    { id: 'rotccw', cat: A, icon: 'rotccw', label: t('90° gegen Uhrzeigersinn'), run: () => ed.rotateBy(90), enabled: sel1 },
    { id: 'rotcw', cat: A, icon: 'rotcw', label: t('90° im Uhrzeigersinn'), run: () => ed.rotateBy(-90), enabled: sel1 },
    { id: 'alignl', cat: A, icon: 'alignl', label: t('Links ausrichten'), run: () => ed.align('left'), enabled: sel2 },
    { id: 'alignhc', cat: A, icon: 'alignhc', label: t('Mitten horizontal ausrichten'), run: () => ed.align('hcenter'), enabled: sel2 },
    { id: 'alignr', cat: A, icon: 'alignr', label: t('Rechts ausrichten'), run: () => ed.align('right'), enabled: sel2 },
    { id: 'alignt', cat: A, icon: 'alignt', label: t('Oben ausrichten'), run: () => ed.align('top'), enabled: sel2 },
    { id: 'alignvc', cat: A, icon: 'alignvc', label: t('Mitten vertikal ausrichten'), run: () => ed.align('vcenter'), enabled: sel2 },
    { id: 'alignb', cat: A, icon: 'alignb', label: t('Unten ausrichten'), run: () => ed.align('bottom'), enabled: sel2 },
    { id: 'disth', cat: A, icon: 'disth', label: t('Horizontal verteilen'), run: () => ed.distribute(true), enabled: sel3 },
    { id: 'distv', cat: A, icon: 'distv', label: t('Vertikal verteilen'), run: () => ed.distribute(false), enabled: sel3 },
    tool('select', 'select', t('Auswählen')),
    tool('node', 'node', t('Knoten bearbeiten')),
    tool('line', 'line', t('Linien zeichnen')),
    { id: 'isolate', cat: W, icon: 'isolate', label: t('Auswahl isolieren / Isolation verlassen'), run: () => { if (ed.isolation) ed.leaveIsolation(); else ed.isolateSelection(); }, enabled: () => !!ed.isolation || canEnterIsolation(ed), on: () => !!ed.isolation, dyn: () => ed.isolation ? { icon: 'isolateExit', label: t('Isolation verlassen') } : { icon: 'isolate', label: t('Auswahl isolieren') } },
    { id: 'vectorfit', cat: W, icon: 'vectorfit', label: t('Ausgewählte Pfade vereinfachen / glätten…'), run: () => openVectorFitDialog(ed), enabled: () => ed.vectorFitTargets().length > 0 },
    { id: 'shape-builder', cat: W, icon: 'shapeBuilder', label: t('Formerstellung …'), run: () => beginShapeBuilder(ed), enabled: sel1, on: () => ed.tool === 'builder' },
    tool('pencil', 'pencil', t('Freihand / Bleistift: Ziehen zeichnet einen angepassten Bézierpfad')),
  tool('shaper', 'shaper', t('Shaper: Geste formt Grundform, umfährt zum Vereinen, kreuzt zum Abziehen')),
    tool('curvature', 'curve', t('Kurven zeichnen: Klicken setzt Ecken, Ziehen formt Kurven')),
    tool('arc', 'arc', t('Bogen zeichnen: Mitte, Radius und Winkel oder drei Punkte')),
    tool('rect', 'rect', t('Rechteck')),
    tool('ellipse', 'ellipse', t('Ellipse')),
    tool('polygon', 'polygon', t('Polygon')),
    tool('text', 'text', t('Text')),
    tool('trim', 'trim', t('Formen trimmen: Abschnitte bis zum nächsten Schnittpunkt anklicken und entfernen')),
    tool('start', 'startpoint', t('Startpunkt setzen: Knoten oder Kante anklicken, wo der Schnitt beginnt (Shift: Richtung umkehren)')),
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
    // One action per registered generator (Generator.tile); the toolbox shows the same ones as tiles
    ...GENERATORS.filter((g) => g.tile).map((g) => ({ id: g.id, cat: W, icon: g.icon, label: g.tile!.text(t).action, run: () => openGenerator(ed, g) })),
    { id: 'multilayer', cat: W, icon: 'stack', label: t('Mehrlagenarbeit aus den ausgewählten Formen erstellen oder bearbeiten'), run: () => openMultiLayerDialog(ed), enabled: sel1 },
    { id: 'vartext', cat: W, icon: 'vartext', short: t('Var. Text'), label: t('Variabler Text …'), run: () => openVarTextDialog(ed) },
    { id: 'textpath', cat: W, icon: 'textpath', short: t('Auf Pfad'), label: t('Text auf Pfad'), run: () => ed.applyPathToText(), enabled: sel2 },
    {
      id: 'union', cat: M, icon: 'union', label: t('Vereinen: alle gewählten Formen verschmelzen, eine Gruppe oder ein Text auch mit sich selbst'),
      run: () => ed.booleanSel('union'), enabled: () => sel2() || (n() === 1 && ['group', 'text'].includes(ed.sel[0].shape.kind)),
    },
    {
      id: 'subtract', cat: M, icon: 'subtract', label: t('Abziehen'), run: () => ed.booleanSel('subtract'), enabled: sel2,
      dyn: () => ({ label: `${t('Abziehen')}: ${BOOL_BASE_HINT[ed.boolBase]}${ed.boolKeep ? t(' (Originale bleiben)') : ''}` }),
    },
    { id: 'intersect', cat: M, icon: 'intersect', label: t('Schnittmenge: nur die gemeinsame Fläche behalten'), run: () => ed.booleanSel('intersect'), enabled: sel2 },
    { id: 'boolopts', cat: M, icon: 'settings', small: true, label: t('Boolesche Optionen: Basis und Originale behalten'), run: () => openBooleanDialog(ed) },
    { id: 'outline', cat: M, icon: 'outline', label: t('Außenkontur und Inseln ableiten …'), run: () => void openOutlineDialog(ed), enabled: sel1 },
    { id: 'offset', cat: M, icon: 'offset', label: t('Offset'), run: () => openOffsetDialog(ed), enabled: sel1 },
    { id: 'warp', cat: M, icon: 'warp', label: t('Verformen: Formen, Text und Bilder biegen, wölben oder perspektivisch verzerren'), run: () => openWarpDialog(ed), enabled: sel1 },
    { id: 'gridarray', cat: M, icon: 'gridArray', label: t('Rasterarray: Auswahl in Spalten und Zeilen kopieren'), run: () => openGridArrayDialog(ed), enabled: sel1 },
    { id: 'circarray', cat: M, icon: 'circArray', label: t('Kreisarray: Auswahl im Kreis um einen Mittelpunkt kopieren'), run: () => openCircularArrayDialog(ed), enabled: sel1 },
    { id: 'nest', cat: M, icon: 'nest', label: t('Verschachteln: Auswahl mit ihren echten Konturen platzsparend auf Bett, Material oder Reststück legen'), run: () => openNestDialog(ed), enabled: sel1 },
    { id: 'hinge', cat: M, icon: 'hinge', label: t('Biegeschnitte (Living Hinge): gewählte Form mit einem Schnittmuster füllen, damit sich die Platte dort biegen lässt'), run: () => openHingeDialog(ed) },
    { id: 'patternfill', cat: M, icon: 'pattern', label: t('Muster füllen: gewählte Form mit einem nahtlosen Muster aus Vektoren füllen'), run: () => openPatternDialog(ed), enabled: sel1 },
    { id: 'adjust', cat: I, icon: 'adjust', label: t('Bild anpassen …'), run: () => openAdjustDialog(ed), enabled: () => ed.selImages().length > 0 },
    { id: 'trace', cat: I, icon: 'trace', label: t('Bild nachzeichnen'), run: () => openTraceDialog(ed), enabled: () => ed.selImages().length > 0 },
    { id: 'imageedit', cat: I, icon: 'imageedit', short: t('Bild bearb.'), label: EDIT_TITLE(), run: () => runImageEdit(ed), enabled: () => cropDraftEnabled(ed) },
    { id: 'addpage', cat: S, icon: 'addpage', short: t('+ Seite'), label: t('Neue Seite'), run: () => ed.addPage() },
    { id: 'prevpage', cat: S, icon: 'up', label: t('Vorherige Seite'), run: () => ed.setPage(ed.doc.page - 1), enabled: () => ed.doc.page > 0 },
    { id: 'nextpage', cat: S, icon: 'down', label: t('Nächste Seite'), run: () => ed.setPage(ed.doc.page + 1), enabled: () => ed.doc.page < ed.doc.pages.length - 1 },
    { id: 'check', cat: L, icon: 'check', label: t('Konstruktion prüfen: doppelte Linien, offene Umrisse, schmale Stege, kleine Ausschnitte, Passungen, Steckbarkeit und Arbeitsbereich'), run: () => openCheck() },
    { id: 'preview', cat: L, icon: 'preview', label: t('Vorschau'), run: () => openPreview(ed) },
    { id: 'start', cat: L, icon: 'play', label: t('Job starten'), run: () => startJob(ed) },
    { id: 'frame', cat: L, icon: 'frame', label: t('Rahmen: Rechteck um den Job abfahren'), run: () => frameJob(ed, false) },
    { id: 'contour', cat: L, icon: 'contour', label: t('Kontur-Rahmen: Umriss des Jobs abfahren'), run: () => frameJob(ed, true) },
    { id: 'laserpos', cat: L, icon: 'target', label: t('Laser positionieren: Klick auf die Arbeitsfläche fährt den Laser dorthin'), run: () => togglePositionPick(ed), on: () => isPositionPick(ed) },
    { id: 'gcode', cat: L, icon: 'gcode', label: t('G-Code speichern'), run: () => saveGCode(ed) },
    { id: 'setup', cat: L, icon: 'setup', short: t('Einrichten'), label: t('Laser einrichten: Schritt für Schritt von der Verbindung bis zum ersten Testauftrag'), run: () => openSetupWizard(ed) },
    { id: 'materialtest', cat: L, icon: 'mattest', short: t('Test'), label: t('Materialtest …'), run: () => openMaterialTestDialog(ed) },
    { id: 'testphoto', cat: L, icon: 'testphoto', short: t('Auswerten'), label: t('Materialtest auswerten: Foto des gelaserten Tests laden und die beste Zelle anklicken'), run: () => openTestPhotoDialog(ed) },
    { id: 'focustest', cat: L, icon: 'focus', short: t('Fokus'), label: t('Fokustest: richtigen Abstand zwischen Laserkopf und Material finden'), run: () => openFocusTestDialog(ed) },
    { id: 'printcut', cat: L, icon: 'printcut', short: t('Print and Cut'), label: t('Print and Cut: gedrucktes Blatt an Passermarken einmessen und passgenau schneiden'), run: () => openPrintCutDialog(ed) },
    { id: 'calibrate', cat: L, icon: 'calibrate', short: t('Passung'), label: t('Passung kalibrieren: Schnittfuge und Steckspiel für ein Material ermitteln'), run: () => openCalibrateDialog(ed) },
    { id: 'devsettings', cat: L, icon: 'devsettings', label: t('Geräteeinstellungen'), run: () => openDeviceDialog(ed) },
    { id: 'devices', cat: L, icon: 'devices', short: t('Geräte'), label: t('Geräte …'), run: () => openDevicesDialog(ed) },
    { id: 'rotary', cat: L, icon: 'rotary', short: t('Rotary'), label: t('Drehachse (Rotary) …'), run: () => openRotaryDialog() },
    { id: 'slots', cat: M, icon: 'slots', label: t('Schlitze an Materialdicke anpassen …'), run: () => openSlotDialog(ed) },
    { id: 'slotplace', cat: M, icon: 'slots', label: t('Schlitze / Ausklinkungen platzieren …'), run: () => openSlotPlacementDialog(ed), enabled: () => n() === 1 },
    { id: 'contouroffset', cat: M, icon: 'offset', label: t('Lokaler Konturversatz …'), run: () => openContourOffsetDialog(ed), enabled: () => n() > 0 },
    { id: 'jigfill', cat: A, icon: 'jigfill', label: t('Auf Jig-Fächer legen: gewähltes Design in jedes Fach eines Jigs kopieren, auf Wunsch mit Seriennummer je Fach'), run: () => openJigFillDialog(ed), enabled: sel1 },
    { id: 'workpiece', cat: A, icon: 'workpiece', label: t('Auf Werkstücke übertragen (Kamera) …'), run: () => openWorkpieceDialog(ed), enabled: sel1 },
    { id: 'bgremove', cat: I, icon: 'bgremove', label: t('Hintergrund entfernen …'), run: () => openBackgroundDialog(ed), enabled: () => ed.selImages().length > 0 },
    { id: 'series', cat: F, icon: 'series', label: t('Serie aus Tabelle (CSV) …'), run: () => openSeriesDialog(ed) },
    { id: 'newtemplate', cat: F, icon: 'template', label: t('Neu aus Vorlage …'), run: () => openTemplateLibrary(ed) },
    { id: 'filltemplate', cat: F, icon: 'filltemplate', label: t('Vorlage ausfüllen …'), run: () => openFillDialog(ed) },
    { id: 'packs', cat: F, icon: 'packs', label: t('Erweiterungen …'), run: () => openPacksDialog(ed.doc) },
    { id: 'sync', cat: F, icon: 'sync', label: t('Einstellungen übertragen …'), run: () => openSyncDialog(ed) },
    { id: 'preferences', cat: F, icon: 'settings', label: t('Einstellungen …'), run: () => void openSettings() },
    { id: 'fonts', cat: F, icon: 'fonts', short: t('Schriften'), label: t('Schriften: Google Fonts laden, eigene Schriften und Favoriten verwalten'), run: () => openFontManager(ed) },
    { id: 'apps', cat: W, icon: 'apps', label: t('Werkzeugkasten: alle Generatoren und Werkzeuge mit Suche'), run: () => toggleWindow('apps'), on: () => !isHidden('apps') },
    // Knopfgruppen: ein Knopf für die zuletzt benutzte Aktion, der Pfeil daneben zeigt die übrigen
    { id: 'grp:select', cat: W, label: t('Auswählen (Gruppe)'), items: ['tool:select', 'tool:lasso'], run: () => {} },
    { id: 'grp:draw', cat: W, label: t('Zeichnen (Gruppe)'), items: ['tool:line', 'tool:pencil', 'tool:curvature', 'tool:arc'], run: () => {} },
    { id: 'grp:transform', cat: A, label: t('Spiegeln und drehen (Gruppe)'), items: ['mirrorh', 'mirrorv', 'rotccw', 'rotcw'], run: () => {} },
    { id: 'grp:align', cat: A, label: t('Ausrichten und verteilen (Gruppe)'), items: ['alignl', 'alignhc', 'alignr', 'alignt', 'alignvc', 'alignb', 'disth', 'distv'], run: () => {} },
    { id: 'grp:zoom', cat: V, label: t('Zoom (Gruppe)'), items: ['zoompage', 'zoomsel', 'zoomin', 'zoomout'], run: () => {} },
    { id: 'grp:bool', cat: M, label: t('Boolesche Operationen (Gruppe)'), items: ['union', 'subtract', 'intersect', 'shape-builder', 'boolopts'], run: () => {} },
    { id: 'grp:gen', cat: W, label: t('Generatoren (Gruppe)'), items: GENERATORS.filter((g) => g.tile).map((g) => g.id), run: () => {} },
    { id: 'grp:array', cat: M, label: t('Arrays (Gruppe)'), items: ['gridarray', 'circarray'], run: () => {} },
    { id: 'grp:relate', cat: A, label: t('Beziehungen (Gruppe)'), items: REL_MODES.map((m) => `rel:${m}`), run: () => {} },
    { id: 'grp:path', cat: M, label: t('Pfad-Werkzeuge (Gruppe)'), items: ['tool:trim', 'tool:start', 'closepath', 'join', 'breakapart', 'reverse', 'corners', 'vectorfit'], run: () => {} },
    { id: 'grp:contour', cat: M, label: t('Kontur (Gruppe)'), items: ['offset', 'outline', 'contouroffset'], run: () => {} },
  ];
  for (const a of list) a.shortcut = () => commandKey(a.id);
  initToolbars(
    list,
    {
      main: [
        'new', 'open', 'save', 'import', 'export', SEP, 'undo', 'redo', SEP, 'cut', 'copy', 'paste', 'delete', SEP,
        'grp:zoom', 'view3d', 'camera-overlays', 'snap-toggle', SEP, 'devsettings', 'check', 'preview', SEP,
        'group', 'ungroup', 'isolate', 'grp:transform', 'tolines', SEP, 'grp:align', SEP, 'theme',
      ],
      tools: [
        'grp:select', 'tool:node', SEP, 'grp:draw', 'tool:shaper', 'tool:rect', 'tool:ellipse', 'tool:polygon', 'tool:text', SEP,
        'grp:bool', 'grp:contour', 'grp:path', 'grp:array', SEP, 'grp:relate', 'tool:measure', SEP, 'apps',
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
  onShortcutsChanged(refreshBars);
  // Tastenkürzel (#453): jede Aktion der Leisten, dazu die Reihenfolge und die Übersicht
  const stack = (id: string) => () => stackingActions(ed).find((a) => a.id === id);
  shortcutCommands = [
    ...list.filter((a) => !a.items),
    ...stackingActions(ed).map(({ id, label }): KeyCommand => ({ id, cat: A, label, run: () => void stack(id)()?.run(), enabled: () => stack(id)()?.enabled !== false })),
    { id: 'help', cat: t('Hilfe'), label: t('Tastenkürzel'), run: () => showHelp() },
  ];
  const byId = new Map(shortcutCommands.map((a) => [a.id, a]));
  ed.onCommandKey = (e) => {
    const id = commandFor(e);
    const action = id ? byId.get(id) : undefined;
    if (!id || !action) return false;
    // Wie bisher: Neu, Öffnen und Speichern nicht über einem offenen Dialog
    if (OUTSIDE_DIALOGS.has(id) && document.querySelector('dialog[open]')) return false;
    // Mit Ctrl oder Alt wie im Menü: was das Menü anbietet, läuft immer (die Befehle melden selbst, wenn die Auswahl
    // fehlt; Alt+J verbindet auch einen einzelnen Pfad). Sonst gilt die Verfügbarkeit der Leisten: eine Taste ohne
    // Ctrl geht dann weiter, mit Ctrl wird sie trotzdem verbraucht (kein Browser-Kürzel).
    const ctrl = e.ctrlKey || e.metaKey;
    if (!(menuCommands.has(id) && (ctrl || e.altKey)) && action.enabled?.() === false) {
      if (ctrl) e.preventDefault();
      return ctrl;
    }
    e.preventDefault();
    action.run();
    return true;
  };
}

/** Commands that can get a shortcut, in toolbar order (Settings → Mouse and keyboard) */
let shortcutCommands: KeyCommand[] = [];
type KeyCommand = Pick<Action, 'id' | 'cat' | 'label' | 'run' | 'enabled'>;
const OUTSIDE_DIALOGS = new Set(['new', 'open', 'save']);
/** Commands offered by the main menu (filled by buildMenu) */
const menuCommands = new Set<string>();

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
    // One row per layer: images on it use the same settings as its shapes
    for (const i of used) {
      const L = ed.layer(i);
      const parts = ed.layerParts(i);
      {
        const imgTag = h('span', { class: 'mode-img', title: t('Auf diesem Layer liegen Bilder; sie nutzen dieselben Einstellungen') }, parts.vec ? t('+ Bild') : t('Bild'));
        const mode = h('span', { class: 'mode-cell' },
          parts.vec || !parts.img
            ? h('select', { onchange: (e: Event) => ed.updateLayer(i, { mode: (e.target as HTMLSelectElement).value as Layer['mode'] }) },
                h('option', { value: 'line', selected: L.mode === 'line' }, t('Linie')),
                h('option', { value: 'fill', selected: L.mode === 'fill' }, t('Füllen')),
              )
            : null,
          parts.img ? imgTag : null,
        );
        const out = h('input', { type: 'checkbox', checked: L.output, onchange: (e: Event) => ed.updateLayer(i, { output: (e.target as HTMLInputElement).checked }) });
        const show = h('input', { type: 'checkbox', checked: L.show, onchange: (e: Event) => ed.updateLayer(i, { show: (e.target as HTMLInputElement).checked }) });
        const air = h('input', { type: 'checkbox', checked: L.air, title: t('Air Assist'), onchange: (e: Event) => ed.updateLayer(i, { air: (e.target as HTMLInputElement).checked }) });
        const row = h(
          'tr',
          { class: ed.activeLayer === i ? 'active' : '', title: t('Doppelklick: Layer-Einstellungen') },
          h('td', {}, h('span', { class: 'swatch', style: `background:${PALETTE[i]}` }, layerLabel(i))),
          h('td', {}, L.name),
          h('td', {}, mode),
          h('td', {}, String(L.speed)),
          h('td', {}, `${L.power}%`),
          h('td', {}, air),
          h('td', {}, out),
          h('td', {}, show),
        );
        row.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).closest('select,input')) return;
          ed.activeLayer = i;
          ed.currentLayer = i;
          render();
          ed.emit('tool');
        });
        // Wie in LightBurn: Doppelklick öffnet die Einstellungen
        row.addEventListener('dblclick', (e) => {
          if ((e.target as HTMLElement).closest('select,input')) return;
          openLayerDialog(ed, i);
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
        h('button', { title: t('Nach oben (früher ausgeben)'), onclick: () => ed.moveLayer(a, -1) }, '▲'),
        h('button', { title: t('Nach unten (später ausgeben)'), onclick: () => ed.moveLayer(a, 1) }, '▼'),
        h('button', { onclick: () => ed.selectLayer(a) }, t('Formen auswählen')),
        h('button', { title: t('Alle Einstellungen dieses Layers (Doppelklick auf den Layer)'), onclick: () => openLayerDialog(ed, a) }, t('Einstellungen …')),
      ),
    );
    const L = ed.layer(a);
    const ap = ed.layerParts(a);
    const name = h('input', { type: 'text', value: L.name, onchange: (e: Event) => ed.updateLayer(a, { name: (e.target as HTMLInputElement).value }) });
    const head = [h('label', {}, h('span', { class: 'swatch', style: `background:${PALETTE[a]}` }, layerLabel(a)), ' ', t('Name')), name];
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
        ...(L.mode === 'fill' && ap.vec ? [h('label', {}, t('Zeilenabstand (mm)')), num('interval', 0.01, 5)] : []),
        h('span', { class: 'checks' },
          h('label', { class: 'check', title: t('Luftunterstützung während dieses Layers (M8/M7, aus mit M9)') },
            h('input', { type: 'checkbox', checked: L.air, onchange: (e: Event) => ed.updateLayer(a, { air: (e.target as HTMLInputElement).checked }) }), t('Air Assist')),
        ),
        // Images use the layer's settings; below only what is specific to images (interval comes from Fill when shown above)
        ...(ap.img
          ? [h('div', { class: 'form-title' }, t('Bilder')), ...imageLayerFields(ed, a, false, undefined, L.mode === 'fill' && ap.vec ? null : { get: () => ed.layer(a), set: (p) => ed.updateLayer(a, p) })]
          : []),
      ),
    );
    if (ap.img) root.append(h('div', { class: 'layer-tools' }, h('button', { onclick: () => openAdjustDialog(ed, a) }, t('Bild anpassen …'))));
    if (ap.vec) root.append(h('div', { class: 'note' }, layerSummary(L)));
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
  if (L.mode === 'line' && L.tabs.enabled) parts.push(L.tabs.useCount ? tn('{n} Steg je Form', '{n} Stege je Form', L.tabs.count) : t('Stege alle {spacing} mm', { spacing: fmtNum(L.tabs.spacing) }));
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

setAdjustOpener((ed, layer) => openAdjustDialog(ed, layer));

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
  const rasterOf = () => { const L = ed.layer(li); return { interval: L.interval, bidirectional: L.bidirectional, overscan: L.overscan }; };
  const origRaster = rasterOf();
  const adj: ImageAdjust = { ...shape().adjust };

  const view = h('canvas', { class: 'adjust-preview', width: 420, height: 300 }) as HTMLCanvasElement;
  let showOrig = false,
    oneToOne = false;
  let zoom: ZoomView = resetZoomView();
  let panning: { x: number; y: number; ox: number; oy: number } | null = null;
  const comparisonMode = () => oneToOne || showOrig;
  let srcW = 1, srcH = 1;
  const viewSize = () => ({ w: view.clientWidth || 420, h: view.clientHeight || 300 });
  const zoomLabel = h('span', { class: 'slider-val', role: 'status', 'aria-live': 'polite', title: t('Zoomfaktor') }, '100 %');
  const syncZoomLabel = () => {
    zoomLabel.textContent = showOrig ? '100 %' : oneToOne ? '1:1' : `${zoomPercent(zoom)} %`;
    for (const button of zoomBar.querySelectorAll('button')) button.disabled = comparisonMode();
    if (comparisonMode()) panning = null;
    view.style.cursor = comparisonMode() ? 'default' : panning ? 'grabbing' : 'grab';
  };
  const zoomBtnStyle = 'min-height: 24px; min-width: 24px';
  const zoomBar = h('div', { class: 'adjust-zoom', style: 'display: flex; gap: 4px; align-items: center; margin-top: 4px' },
    h('button', {
      class: 'btn', style: zoomBtnStyle, title: t('Verkleinern'),
      onclick: () => {
        if (comparisonMode()) return;
        const v = viewSize();
        zoom = zoomAtCursor(zoom, v.w / 2, v.h / 2, 1 / ZOOM_STEP, srcW, srcH, v.w, v.h);
        syncZoomLabel(); drawPreview();
      },
    }, '−'),
    h('button', {
      class: 'btn', style: zoomBtnStyle, title: t('Vergrößern'),
      onclick: () => {
        if (comparisonMode()) return;
        const v = viewSize();
        zoom = zoomAtCursor(zoom, v.w / 2, v.h / 2, ZOOM_STEP, srcW, srcH, v.w, v.h);
        syncZoomLabel(); drawPreview();
      },
    }, '+'),
    h('button', {
      class: 'btn', style: 'min-height: 24px', title: t('Ansicht zurücksetzen'),
      onclick: () => { if (comparisonMode()) return; zoom = resetZoomView(); syncZoomLabel(); drawPreview(); },
    }, t('Einpassen')),
    zoomLabel,
  );
  let timer = 0;
  const drawPreview = () => {
    syncZoomLabel();
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
      const src: CanvasImageSource | null = showOrig ? assetImageOf(s) : displayCanvas(s, first.m, ed.imgOutput(li), true);
      if (!src) return;
      const sw = (src as HTMLCanvasElement).width || (src as HTMLImageElement).naturalWidth,
        sh = (src as HTMLCanvasElement).height || (src as HTMLImageElement).naturalHeight;
      if (!showOrig) { srcW = sw; srcH = sh; }
      if (oneToOne && !showOrig) {
        // Mitte des Bildes, ein Bildschirmpunkt je Laserpunkt
        ctx.imageSmoothingEnabled = false;
        const cw = W * dpr,
          ch = H * dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(src, Math.max(0, (sw - cw) / 2), Math.max(0, (sh - ch) / 2), Math.min(sw, cw), Math.min(sh, ch), Math.max(0, (cw - sw) / 2), Math.max(0, (ch - sh) / 2), Math.min(sw, cw), Math.min(sh, ch));
        return;
      }
      if (!showOrig) zoom = clampPan(zoom, sw, sh, W, H);
      const o = imageOrigin(sw, sh, W, H, showOrig ? resetZoomView() : zoom);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, o.x, o.y, sw * o.scale, sh * o.scale);
    }, 40);
  };
  // Rad = Zoom auf Cursor, Ziehen = Pan, Doppelklick (links wie Mitte) = Fit.
  view.style.touchAction = 'none';
  view.style.cursor = 'grab';
  view.addEventListener('wheel', (e: WheelEvent) => {
    if (comparisonMode()) return;
    e.preventDefault();
    const r = view.getBoundingClientRect();
    zoom = zoomAtCursor(zoom, e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, srcW, srcH, r.width || 420, r.height || 300);
    syncZoomLabel(); drawPreview();
  }, { passive: false });
  view.addEventListener('pointerdown', (e: PointerEvent) => {
    if ((e.button !== 0 && e.button !== 1) || comparisonMode()) return;
    try { view.setPointerCapture(e.pointerId); } catch { /* Kopf-Test */ }
    view.style.cursor = 'grabbing';
    panning = { x: e.clientX, y: e.clientY, ox: zoom.ox, oy: zoom.oy };
  });
  view.addEventListener('pointermove', (e: PointerEvent) => {
    if (!panning) return;
    const v = viewSize();
    zoom = panBy({ z: zoom.z, ox: panning.ox + (e.clientX - panning.x), oy: panning.oy + (e.clientY - panning.y) }, 0, 0, srcW, srcH, v.w, v.h);
    syncZoomLabel(); drawPreview();
  });
  const endPan = () => { panning = null; view.style.cursor = comparisonMode() ? 'default' : 'grab'; };
  view.addEventListener('pointerup', endPan);
  view.addEventListener('pointercancel', endPan);
  view.addEventListener('dblclick', () => { if (comparisonMode()) return; zoom = resetZoomView(); syncZoomLabel(); drawPreview(); });
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
  const layerForm = h('div', { class: 'form' }, ...imageLayerFields(ed, li, true, drawPreview, liveLayerRaster(ed, li)));

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
    layerForm.replaceChildren(...imageLayerFields(ed, li, true, drawPreview, liveLayerRaster(ed, li)));
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
        zoomBar,
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
    const newRaster = rasterOf();
    // Ausgangszustand herstellen; bei „Übernehmen“ die Änderung als ein Undo-Schritt wieder anwenden
    targets.forEach((o, k) => ((o.shape as ImageShape).adjust = origAdj[k]));
    Object.assign(ed.imgLayer(li), origLayer);
    Object.assign(ed.layer(li), origRaster);
    if (applied && (JSON.stringify(newAdj) !== JSON.stringify(origAdj) || JSON.stringify(newLayer) !== JSON.stringify(origLayer) || JSON.stringify(newRaster) !== JSON.stringify(origRaster))) {
      ed.snapshot(t('Bild anpassen'));
      targets.forEach((o, k) => ((o.shape as ImageShape).adjust = newAdj[k]));
      Object.assign(ed.imgLayer(li), newLayer);
      Object.assign(ed.layer(li), newRaster);
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
        ? `${tn('{n} Linie', '{n} Linien', subs.length)}, ${tn('{n} Knoten|one', '{n} Knoten', nodes)}${t(' ({ms} ms). Orange gestrichelt: Vorschau.', { ms: Math.round(performance.now() - t0) })}`
        : `${tn('{n} Kontur', '{n} Konturen', subs.length)}, ${tn('{n} Knoten|one', '{n} Knoten', nodes)}${t(' ({ms} ms). Orange gestrichelt: Vorschau.', { ms: Math.round(performance.now() - t0) })}`;
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

/** How long the layer bar waits for a second click before asking about groups on several layers */
const DOUBLE_CLICK_MS = 300;

function buildPalette(ed: Editor) {
  const root = $('#palette');
  const btns: HTMLButtonElement[] = [];
  // Groups with objects on several layers need a question (#255). Wait for a possible second click first,
  // so a double click still only opens the layer settings.
  let pending = 0;
  PALETTE.forEach((c, i) => {
    const b = h('button', {
      class: i >= 30 ? 'tool' : '',
      style: `background:${c}`,
      title: i >= 30 ? t('Werkzeug-Layer {layer} (wird nicht gelasert). Doppelklick: Layer-Einstellungen', { layer: layerLabel(i) }) : t('Layer {layer}: Auswahl zuordnen. Doppelklick: Layer-Einstellungen', { layer: layerLabel(i) }),
      // The second click of a double-click does not assign again (no extra undo step)
      onclick: (e: MouseEvent) => {
        if (e.detail >= 2) return;
        clearTimeout(pending);
        if (needsChildLayersQuestion(ed, i)) pending = window.setTimeout(() => void assignLayerAsk(ed, i), DOUBLE_CLICK_MS);
        else ed.assignLayer(i);
      },
      ondblclick: () => (clearTimeout(pending), openLayerDialog(ed, i)),
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
  const filled = h('input', { type: 'checkbox', checked: ed.filled, onchange: (e: Event) => ed.setFilled((e.target as HTMLInputElement).checked) }) as HTMLInputElement;
  const zoom = h('span', {});
  root.append(
    coords, selInfo, hint,
    h('label', { title: t('An Knoten, Mittelpunkten, Zentren, Schnittpunkten und Linien fangen (Ctrl beim Ziehen: umkehren, Alt: stärker und Ausrichtungshilfen)') }, snapObj, t('Fang')),
    h('label', { title: t('Am Raster fangen') }, snap, t('Raster'), step, 'mm'),
    h('label', { title: withShortcut(t('Füll-Layer gefüllt anzeigen'), 'wire') }, filled, t('Gefüllt')),
    zoom,
    agentStatus(ed),
    remoteHostStatus(ed),
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
import { openSettings } from './settings/dialog';
import { registerCoreSettings } from './settings/core';
import { openFreehandEditDialog } from './freehandEditDialog';
import { openPathIslandsDialog } from './pathIslandsDialog';
