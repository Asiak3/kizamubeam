// Sections of the settings window that KizamuBeam brings itself. Every field reads and writes
// through the setter the rest of the app already uses, so menus, toolbars and this window stay in sync.
// New application-wide preferences belong here (or are added with addSettingsFields) instead of in a
// dialog of their own.
import type { Editor } from '../editor';
import { h } from '../dom';
import { LANGUAGES, langPref, LangPref, t } from '../i18n';
import { isTauri } from '../machine';
import { DEFAULT_GRID, GridSettings } from '../grid';
import type { BoolBase } from '../ops';
import { loadCheckSettings, saveCheckSettings } from '../check';
import { type CurveQuality, loadCurveQuality, saveCurveQuality } from '../geom';
import { autoInstallFonts, setAutoInstallFonts } from '../fontCatalog';
import { loadOverlapSettings, OVERLAP_HOLD_MS, OverlapSettings, saveOverlapSettings } from '../overlapPicker';
import { loadAutosaveInterval, loadCutSelectedDefault, loadJobOriginDefault, saveCutSelectedDefault, saveJobOriginDefault, setAutosaveInterval } from '../editor/document';
import { defaultUpdateChannel, openUpdateDialog, setUpdateAutoCheck, setUpdateChannel, updateAutoCheck, updateChannel } from '../updateDialog';
import type { Channel } from '../updates';
import { resetDialogPositions } from '../dialogDrag';
import { resetLayout } from '../dock';
import { openToolbarDialog, setAllToolbarIconSizes, showAllBars, toolbarIconSize } from '../toolbars';
import { openDeviceDialog, openDevicesDialog, openRotaryDialog } from '../laser';
import { fireOverlayInPanel, setFireOverlayInPanel } from '../fireUi';
import { openSetupWizard } from '../setupWizard';
import { openSyncDialog } from '../syncDialog';
import { openPacksDialog } from '../packsDialog';
import { openFontManager } from '../fontManager';
import { agentLevels, agentSettings, configureAgent, openAgentDialog } from '../agentui';
import { configureHost, hostSettings, openRemoteHostDialog } from '../remoteHost';
import { registerSettingsSection } from './registry';
import type { SvgDpi } from '../importers';
import { typographySettingsFields } from './typography';
import { electricityCurrencyField, electricityTariffField } from '../energyUi';

export type ThemeMode = 'system' | 'light' | 'dark';

/** What only ui.ts knows */
export interface CoreSettingsHooks {
  theme(): ThemeMode;
  setTheme(m: ThemeMode): void;
  setLanguage(p: LangPref): void;
  /** Rows of the shortcut overview (key, meaning) */
  shortcuts(): [string, string][];
}

export function registerCoreSettings(ed: Editor, hooks: CoreSettingsHooks) {
  const appNote = t('Gilt für diese Installation und wird mit „Einstellungen übertragen“ auf andere Rechner übernommen.');

  // ---------- General ----------
  registerSettingsSection({
    id: 'general',
    title: t('Allgemein'),
    order: 10,
    note: appNote,
    fields: [
      electricityTariffField(),
      electricityCurrencyField(),
      {
        kind: 'select', id: 'general.lang', label: t('Sprache'), keywords: 'language lingua idioma português portuguese', late: true, def: 'system',
        options: () => [['system', t('Wie System|Sprache')], ...LANGUAGES],
        get: () => langPref(),
        set: (v) => hooks.setLanguage(v as LangPref),
      },
      {
        kind: 'select', id: 'general.updateChannel', group: t('Updates'), label: t('Update-Kanal'), keywords: t('Nightly Beta Stabil Version'), def: defaultUpdateChannel(),
        options: () => [['stable', t('Stabil')], ['nightly', t('Nightly (mit Vorabversionen)')]],
        hint: t('Nightly-Builds entstehen jede Nacht automatisch aus dem aktuellen Entwicklungsstand und sind nicht an echter Hardware getestet. Mit einem Nightly gespeicherte Dateien lassen sich in der stabilen Version eventuell nicht öffnen.'),
        get: () => updateChannel(),
        set: (v) => setUpdateChannel(v as Channel),
      },
      {
        kind: 'toggle', id: 'general.updateAuto', group: t('Updates'), label: t('Beim Start einmal am Tag nach Updates suchen'), def: true,
        get: () => updateAutoCheck(),
        set: (v) => setUpdateAutoCheck(v),
      },
      { kind: 'action', id: 'general.updateNow', group: t('Updates'), label: t('Jetzt nach Updates suchen'), button: t('Jetzt suchen …'), run: () => openUpdateDialog() },
      {
        kind: 'number', id: 'general.autosaveInterval', group: t('Speichern'), label: t('Automatisches Sichern alle'), unit: t('Minuten'), integer: true, min: 0, max: 1440, def: 0,
        keywords: t('Auto-save Sicherung Intervall Minuten'),
        hint: t('Sichert das Projekt alle paar Minuten im Zwischenspeicher dieses Rechners. 0 = aus (nur kurze Verzögerung nach Änderungen).'),
        get: () => loadAutosaveInterval(),
        set: (v) => setAutosaveInterval(ed, v),
      },
      {
        kind: 'action', id: 'general.sync', label: t('Einstellungen übertragen'), keywords: t('Export Import Sync Ordner'),
        hint: t('Einstellungen, Geräte, Materialien und mehr als Datei sichern oder über einen Ordner zwischen Rechnern abgleichen.'),
        button: t('Öffnen …'), run: () => void openSyncDialog(ed),
      },
    ],
  });

  // ---------- Appearance ----------
  registerSettingsSection({
    id: 'appearance',
    title: t('Darstellung'),
    order: 20,
    note: appNote,
    fields: [
      {
        kind: 'select', id: 'appearance.theme', label: t('Design'), keywords: t('hell dunkel Farbe'), def: 'system',
        options: () => [['system', t('Wie System|Design')], ['light', t('Hell|Design')], ['dark', t('Dunkel|Design')]],
        get: () => hooks.theme(),
        set: (v) => hooks.setTheme(v as ThemeMode),
      },
      ...typographySettingsFields(),
      {
        kind: 'text', id: 'appearance.textFont', group: t('Textwerkzeug'), label: t('Standardschrift'), def: 'Arial',
        keywords: t('Schriftart Text Default'),
        get: () => ed.textDefaults.font, set: (v) => ed.updateTexts({ font: v || 'Arial' }),
      },
      {
        kind: 'number', id: 'appearance.textSize', group: t('Textwerkzeug'), label: t('Standardschriftgröße (mm)'), min: 1, max: 500, def: 10,
        keywords: t('Schriftgröße Text Default'),
        get: () => ed.textDefaults.size, set: (v) => ed.updateTexts({ size: v }),
      },
      {
        kind: 'select', id: 'appearance.toolbarIconSize', label: t('Symbolgröße'), def: 'm',
        options: () => [['s', t('Klein|Symbole')], ['m', t('Normal|Symbole')], ['l', t('Groß|Symbole')]],
        get: () => toolbarIconSize(),
        set: (v) => setAllToolbarIconSizes(v as 's' | 'm' | 'l'),
      },
      {
        kind: 'toggle', id: 'appearance.canvasDark', group: t('Arbeitsfläche'), label: t('Dunkle Arbeitsfläche'), def: false,
        keywords: t('Hintergrund dunkel Canvas Design'),
        hint: t('Dunkler Hintergrund unabhängig vom Design. Aus folgen Oberfläche und Design-Einstellung.'),
        get: () => ed.canvasDark, set: (v) => ed.setCanvasDark(v),
      },
      {
        kind: 'number', id: 'appearance.handleSize', group: t('Arbeitsfläche'), label: t('Griffgröße (px)'), unit: 'px', integer: true, min: 4, max: 16, def: 8,
        keywords: t('Griffe Knoten Anfasser Größe'),
        get: () => ed.handleSize, set: (v) => ed.setHandleSize(v),
      },
      {
        kind: 'toggle', id: 'appearance.crosshair', group: t('Arbeitsfläche'), label: t('Vollbild-Fadenkreuz'), def: false,
        keywords: t('Fadenkreuz Cursor Linien'),
        hint: t('Linien über die ganze Fläche an der Zeigerposition.'),
        get: () => ed.showCrosshair, set: (v) => ed.setShowCrosshair(v),
      },
      {
        kind: 'toggle', id: 'appearance.bedCenterCross', group: t('Arbeitsfläche'), label: t('Bettmittel-Kreuz'), def: false,
        keywords: t('Mitte Zentrum Bett Kreuz'),
        hint: t('Kleines Kreuz in der Mitte des Arbeitsbereichs.'),
        get: () => ed.bedCenterCross, set: (v) => ed.setBedCenterCross(v),
      },
      {
        kind: 'toggle', id: 'appearance.canvasFilled', group: t('Arbeitsfläche'), label: t('Füll-Layer gefüllt anzeigen'), def: true,
        keywords: t('Füllung Drahtgitter Alt W'),
        hint: t('Aus zeigt Füll-Layer nur als Linien (wie Alt+W und die Werkzeugleiste).'),
        get: () => ed.filled, set: (v) => ed.setFilled(v),
      },
      {
        kind: 'toggle', id: 'appearance.imageSmoothing', group: t('Arbeitsfläche'), label: t('Kantenglättung beim Zoomen'), def: true,
        keywords: t('Glättung Bilder Zoomen weich'),
        hint: t('Bilder verkleinert glätten. Vektorlinien sind immer kantengeglättet.'),
        get: () => ed.imageSmoothing, set: (v) => ed.setImageSmoothing(v),
      },
      {
        kind: 'select', id: 'appearance.curveQuality', group: t('Arbeitsfläche'), label: t('Kurvenqualität'), def: 'balanced',
        options: () => [['coarse', t('Grob (schnell)')], ['balanced', t('Ausgewogen')], ['fine', t('Fein (genau)')]],
        keywords: t('Kurven Qualität Tempo Genauigkeit'),
        hint: t('Abtastung von Kurven für Rahmen und Treffertest: grob ist schneller, fein genauer.'),
        get: () => loadCurveQuality(), set: (v) => (saveCurveQuality(v as CurveQuality), ed.redraw()),
      },
      {
        kind: 'action', id: 'appearance.toolbars', group: t('Fenster und Leisten'), label: t('Funktionsleisten'), hint: t('Knöpfe und Reihenfolge der Leisten wählen.'),
        button: t('Anpassen …'), run: () => openToolbarDialog(),
      },
      {
        kind: 'action', id: 'appearance.resetLayout', group: t('Fenster und Leisten'), label: t('Fenster und Leisten zurücksetzen'),
        hint: t('Alle Fenster an ihren ursprünglichen Platz, alle Leisten einblenden. Wirkt sofort.'),
        button: t('Zurücksetzen'), run: () => (resetLayout(), showAllBars()),
      },
      {
        kind: 'action', id: 'appearance.resetDialogs', group: t('Fenster und Leisten'), label: t('Dialogpositionen zurücksetzen'),
        hint: t('Verschobene oder vergrößerte Dialoge öffnen wieder in der Mitte und in Standardgröße. Wirkt sofort.'),
        button: t('Zurücksetzen'), run: () => {
          resetDialogPositions();
          ed.hint = t('Dialoge öffnen wieder in der Mitte und in Standardgröße.');
          ed.emit('tool');
        },
      },
    ],
  });

  // ---------- Workspace ----------
  const grid = (key: keyof GridSettings) => ({
    get: () => ed.grid[key] as never,
    set: (v: never) => ed.setGrid({ [key]: v }),
    def: DEFAULT_GRID[key] as never,
  });
  registerSettingsSection({
    id: 'workspace',
    title: t('Arbeitsfläche und Fangen'),
    order: 30,
    note: appNote,
    fields: [
      {
        kind: 'toggle', id: 'workspace.snapObjects', group: t('Fangen'), label: t('An Objekten fangen'), def: true, keywords: t('Fang Knoten Mittelpunkte Schnittpunkte'),
        hint: t('An Knoten, Mittelpunkten, Zentren, Schnittpunkten und Linien fangen (Ctrl beim Ziehen: umkehren, Alt: stärker und Ausrichtungshilfen)'),
        get: () => ed.snapObjects, set: (v) => ed.setSnap({ objects: v }),
      },
      { kind: 'toggle', id: 'workspace.snapGrid', group: t('Fangen'), label: t('Am Raster fangen'), def: false, keywords: t('Fang'), get: () => ed.snapGrid, set: (v) => ed.setSnap({ grid: v }) },
      {
        kind: 'number', id: 'workspace.snapTolerance', group: t('Fangen'), label: t('Fangdistanz (px)'), min: 1, max: 64, def: 8,
        keywords: t('Fangdistanz Fangen Einrasten'),
        hint: t('Abstand in Bildschirmpunkten, ab dem Objekte einrasten; Alt verstärkt und zeigt Ausrichtungshilfen.'),
        get: () => ed.snapTolerance.normal, set: (v) => ed.setSnapTolerance({ normal: v }),
      },
      {
        kind: 'number', id: 'workspace.snapToleranceAlt', group: t('Fangen'), label: t('Fangdistanz mit Alt (px)'), min: 1, max: 64, def: 20,
        keywords: t('Fangdistanz Fangen Einrasten'),
        hint: t('Abstand in Bildschirmpunkten, ab dem Objekte einrasten; Alt verstärkt und zeigt Ausrichtungshilfen.'),
        get: () => ed.snapTolerance.alt, set: (v) => ed.setSnapTolerance({ alt: v }),
      },
      { kind: 'number', id: 'workspace.gridStep', group: t('Fangen'), label: t('Rasterweite (mm)'), min: 0.001, max: 1000, def: 1, keywords: t('Fang'), get: () => ed.gridStep, set: (v) => ed.setSnap({ step: v }) },
      {
        kind: 'select', id: 'workspace.centers', group: t('Fangen'), label: t('Mittelpunkte zeigen'), def: 'auto',
        options: () => [['off', t('Aus|Mittelpunkte')], ['auto', t('Bei Auswahl und unter dem Mauszeiger')], ['all', t('Immer|Mittelpunkte')]],
        get: () => ed.centerMarks, set: (v) => ed.setSnap({ centers: v as Editor['centerMarks'] }),
      },
      { kind: 'toggle', id: 'workspace.gridShow', group: t('Gitter'), label: t('Gitter anzeigen'), keywords: t('Gitter'), ...grid('show') },
      { kind: 'number', id: 'workspace.gridSpacing', group: t('Gitter'), label: t('Linienabstand (mm)'), hint: t('Abstand der Hauptlinien'), keywords: t('Gitter'), min: 0.01, max: 10000, ...grid('spacing') },
      { kind: 'number', id: 'workspace.gridDivisions', group: t('Gitter'), label: t('Unterteilungen'), hint: t('Feine Linien zwischen zwei Hauptlinien; 1 = keine feinen Linien'), keywords: t('Gitter'), integer: true, min: 1, max: 50, ...grid('divisions') },
      { kind: 'number', id: 'workspace.gridEvery', group: t('Gitter'), label: t('Kräftig alle n Linien'), hint: t('Jede n-te Hauptlinie kräftiger zeichnen; 0 = aus'), keywords: t('Gitter'), integer: true, min: 0, max: 50, ...grid('every') },
      {
        kind: 'color', id: 'workspace.gridColor', group: t('Gitter'), label: t('Farbe'), auto: t('Wie Design'), keywords: t('Gitter'),
        fallback: () => (ed.dark ? '#8a929c' : '#808080'), ...grid('color'),
      },
      { kind: 'number', id: 'workspace.gridOpacity', group: t('Gitter'), label: t('Deckkraft'), keywords: t('Gitter'), unit: '%', integer: true, min: 5, max: 100, ...grid('opacity') },
      {
        kind: 'select', id: 'workspace.boolBase', group: t('Boolesche Operationen'), label: t('Basis'), def: 'selection', keywords: t('Vereinen Abziehen Schnittmenge'),
        hint: t('Die Basis bestimmt beim Abziehen, wovon abgezogen wird, und bei allen Operationen die Ebene des Ergebnisses. Vorn ist, was in der Stapelreihenfolge oben liegt (zuletzt gezeichnet).'),
        options: () => [['selection', t('Zuerst gewählte Form')], ['back', t('Hinterste Form (vordere werden abgezogen)')], ['front', t('Vorderste Form (hintere werden abgezogen)')]],
        get: () => ed.boolBase, set: (v) => ed.setBoolOptions({ base: v as BoolBase }),
      },
      {
        kind: 'toggle', id: 'workspace.boolKeep', group: t('Boolesche Operationen'), label: t('Originale behalten'), def: false, keywords: t('Vereinen Abziehen Schnittmenge'),
        get: () => ed.boolKeep, set: (v) => ed.setBoolOptions({ keep: v }),
      },
      {
        kind: 'toggle', id: 'workspace.importAutoSelect', group: t('Import'), label: t('Importiertes nach dem Import auswählen'), def: true,
        keywords: t('Import Auswahl Selektion'),
        hint: t('Neu importierte Objekte werden wie bisher gleich ausgewählt; ausgeschaltet bleibt die bisherige Auswahl bestehen.'),
        get: () => ed.importAutoSelect, set: (v) => ed.setImportAutoSelect(v),
      },
      {
        kind: 'toggle', id: 'workspace.importCenterInBed', group: t('Import'), label: t('Import in Bettmitte legen'), def: false,
        keywords: t('Import Mitte Zentrum Bett'),
        hint: t('Neu importierte Objekte werden immer mittig auf den Arbeitsbereich gelegt; ausgeschaltet nur, wenn sie außerhalb liegen.'),
        get: () => ed.importCenterInBed, set: (v) => ed.setImportCenterInBed(v),
      },
      {
        kind: 'toggle', id: 'workspace.importSkippedNote', group: t('Import'), label: t('Hinweise zu übersprungenen Inhalten anzeigen'), def: true,
        keywords: t('Import Hinweis übersprungen Text DXF SVG'),
        hint: t('Nicht übernommene Inhalte (z. B. Texte, vorher in Pfade umwandeln) werden als Hinweis gemeldet; ausgeschaltet werden sie still ignoriert.'),
        get: () => ed.importSkippedNote, set: (v) => ed.setImportSkippedNote(v),
      },
      {
        kind: 'toggle', id: 'workspace.importAutoGroup', group: t('Import'), label: t('Importiertes automatisch gruppieren'), def: true,
        keywords: t('Import Gruppe gruppieren'),
        hint: t('Neu importierte Objekte werden wie bisher zu einer Gruppe zusammengefasst; ausgeschaltet bleiben sie einzeln.'),
        get: () => ed.importAutoGroup, set: (v) => ed.setImportAutoGroup(v),
      },
      {
        kind: 'select', id: 'workspace.dxfFallbackUnit', group: t('Import'), label: t('DXF-Einheit bei fehlender Angabe'), def: '1',
        keywords: t('DXF Einheit Fallback Import INSUNITS'),
        hint: t('Wird verwendet, wenn die DXF-Datei keine gültige Einheit enthält; entspricht dem bisherigen Millimeter-Verhalten.'),
        options: () => [['1', t('Millimeter')], ['10', t('Zentimeter')], ['25.4', t('Zoll')], ['0.001', t('Mikrometer')]],
        get: () => String(ed.dxfFallbackUnitMm), set: (v) => ed.setDxfFallbackUnit(Number(v)),
      },
      {
        kind: 'select', id: 'workspace.svgDpi', group: t('Import'), label: t('SVG-Auflösung für einheitenlose Maße'), def: '96',
        keywords: t('SVG DPI Auflösung Illustrator Import'),
        hint: t('Einheitenlose und px-Maße werden wie bisher mit 96 DPI gelesen; Illustrator-Dateien erkennt die Automatik an 72 DPI.'),
        options: () => [['96', t('96 DPI')], ['72', t('72 DPI')], ['auto', t('Automatisch (Illustrator 72, sonst 96)')]],
        get: () => ed.svgDpi, set: (v) => ed.setSvgDpi(v as SvgDpi),
      },
      {
        kind: 'toggle', id: 'workspace.cutSelectedDefault', group: t('Auftrag'), label: t('Standard: nur Auswahl lasern'), def: false,
        keywords: t('Nur Auswahl Standard Vorgabe Datei'),
        hint: t('Neue Dateien starten mit „Nur Auswahl“. Der Stand wird pro Datei gespeichert und beim Öffnen übernommen.'),
        get: () => loadCutSelectedDefault(), set: (v) => saveCutSelectedDefault(v),
      },
      {
        kind: 'select', id: 'workspace.jobOriginDefault', group: t('Auftrag'), label: t('Standard-Job-Ursprung'), def: '',
        keywords: t('Ursprung Standard Vorgabe Datei Position'),
        hint: t('Startpunkt neuer Dateien (Zeilen von oben nach unten, je links nach rechts). Der Stand wird pro Datei gespeichert und beim Öffnen übernommen.'),
        options: () => [
          ['', t('Vom Gerät behalten')],
          ['0', t('Oben links')], ['1', t('Oben Mitte')], ['2', t('Oben rechts')],
          ['3', t('Mitte links')], ['4', t('Mitte')], ['5', t('Mitte rechts')],
          ['6', t('Unten links')], ['7', t('Unten Mitte')], ['8', t('Unten rechts')],
        ],
        get: () => { const v = loadJobOriginDefault(); return v === null ? '' : String(v); },
        set: (v) => saveJobOriginDefault(v === '' ? null : Number(v)),
      },
    ],
  });

  // ---------- Mouse and keyboard ----------
  // Overlap trigger and delay are stored together; both fields write into one pending value.
  let overlap: OverlapSettings = loadOverlapSettings();
  const writeOverlap = (patch: Partial<OverlapSettings>) => {
    overlap = { ...overlap, ...patch };
    if (!saveOverlapSettings(overlap)) throw new Error(t('Einstellung konnte nicht gespeichert werden.'));
  };
  registerSettingsSection({
    id: 'input',
    title: t('Maus und Tastatur'),
    order: 40,
    note: appNote,
    prepare: () => void (overlap = loadOverlapSettings()),
    fields: [
      {
        kind: 'toggle', id: 'input.rightPan', group: t('Ansicht verschieben'), label: t('Mit gedrückter rechter Maustaste verschieben'), def: false,
        keywords: t('Rechtsklick Ziehen Mitteltaste Leertaste'),
        hint: t('Mitteltaste und Leertaste + Ziehen verschieben immer. Ein Rechtsklick ohne Bewegung öffnet weiter das Kontextmenü bzw. beendet die Linie.'),
        get: () => ed.rightPan, set: (v) => ed.setRightPan(v),
      },
      {
        kind: 'toggle', id: 'input.rememberToolOptions', group: t('Werkzeuge'), label: t('Werkzeugschalter merken'), def: false,
        keywords: t('Optionen Ecken Stern Radius Toleranz Bogen Formerkennung Start'),
        hint: t('Merkt sich z. B. Ecken, Stern, Eckenradius, Toleranzen und Bogenmodus für den nächsten Start. Ausgeschaltet bleiben die Schalter flüchtig wie bisher.'),
        get: () => ed.rememberToolOptions, set: (v) => ed.setRememberToolOptions(v),
      },
      {
        kind: 'toggle', id: 'input.selectAfterDraw', group: t('Zeichnen'), label: t('Nach dem Zeichnen zur Auswahl wechseln'), def: true,
        keywords: t('Auswahlwerkzeug Selektion Form anlegen Bogen Linie'),
        hint: t('Ausgeschaltet bleibt das Zeichenwerkzeug nach dem Anlegen aktiv; das neue Objekt ist trotzdem ausgewählt.'),
        get: () => ed.selectAfterDraw, set: (v) => ed.setSelectAfterDraw(v),
      },
      {
        kind: 'number', id: 'input.nudgeStep', group: t('Tastatur'), label: t('Schrittweite Pfeiltasten (mm)'), min: 0.001, max: 1000, def: 1,
        keywords: t('Pfeiltasten Nudge Schrittweite Tastatur'),
        hint: t('Gilt für Objekte und Knoten; die Pfeiltasten verschieben um diese Weiten.'),
        get: () => ed.nudgeSteps.normal, set: (v) => ed.setNudgeSteps({ normal: v }),
      },
      {
        kind: 'number', id: 'input.nudgeStepShift', group: t('Tastatur'), label: t('Schrittweite mit Umschalt (mm)'), min: 0.001, max: 1000, def: 10,
        keywords: t('Pfeiltasten Nudge Schrittweite Tastatur'),
        hint: t('Gilt für Objekte und Knoten; die Pfeiltasten verschieben um diese Weiten.'),
        get: () => ed.nudgeSteps.shift, set: (v) => ed.setNudgeSteps({ shift: v }),
      },
      {
        kind: 'number', id: 'input.nudgeStepAlt', group: t('Tastatur'), label: t('Schrittweite mit Alt (mm)'), min: 0.001, max: 1000, def: 0.1,
        keywords: t('Pfeiltasten Nudge Schrittweite Tastatur'),
        hint: t('Gilt für Objekte und Knoten; die Pfeiltasten verschieben um diese Weiten.'),
        get: () => ed.nudgeSteps.alt, set: (v) => ed.setNudgeSteps({ alt: v }),
      },
      {
        kind: 'number', id: 'input.clickTolerance', group: t('Auswahl'), label: t('Klick-Toleranz (px)'), min: 1, max: 32, def: 4,
        keywords: t('Klick Auswahl Toleranz Treffer'),
        hint: t('Wie genau ein Klick treffen muss, um ein Objekt auszuwählen.'),
        get: () => ed.clickTolerance, set: (v) => ed.setClickTolerance(v),
      },
      {
        kind: 'toggle', id: 'input.zoomInverted', group: t('Zoomen'), label: t('Mausrad-Zoomrichtung umkehren'), def: false,
        keywords: t('Zoom Richtung invertieren Scrollrad'),
        hint: t('Standard: Nach oben scrollen vergrößert. Umgekehrt schaltet diese Option ein: Nach oben scrollen verkleinert.'),
        get: () => ed.zoomInverted, set: (v) => ed.setZoomInverted(v),
      },
      {
        kind: 'select', id: 'input.overlapTrigger', group: t('Überlappungsauswahl'), label: t('Überlappungsauswahl'), def: 'right', keywords: t('Objekt unter dem Mauszeiger auswählen Rechtsklick Linksklick'),
        hint: t('Kurzer Klick und Ziehen bleiben unverändert. Die Liste ändert die Auswahl erst beim Bestätigen.'),
        options: () => [['right', t('Langer Rechtsklick')], ['left', t('Langer Linksklick')], ['off', t('Deaktiviert')]],
        get: () => overlap.trigger, set: (v) => writeOverlap({ trigger: v as OverlapSettings['trigger'] }),
      },
      {
        kind: 'number', id: 'input.overlapDelay', group: t('Überlappungsauswahl'), label: t('Haltedauer (ms)'), integer: true, min: 250, max: 2000, def: OVERLAP_HOLD_MS, keywords: t('Überlappungsauswahl'),
        get: () => overlap.delay, set: (v) => writeOverlap({ delay: v }),
      },
      {
        kind: 'custom', id: 'input.shortcuts', label: t('Tastenkürzel'), keywords: 'shortcuts keys F1',
        hint: t('Übersicht der Tastenkürzel (auch mit F1). Ändern lassen sie sich noch nicht.'),
        render: () => h('table', { class: 'settings-keys' }, ...hooks.shortcuts().map(([k, d]) => h('tr', {}, h('td', {}, h('kbd', {}, k)), h('td', {}, d)))),
      },
    ],
  });

  // ---------- Machines and services ----------
  let agent = { enabled: false, level: 0, port: 47800 };
  let agentDirty = false;
  let host = { enabled: false, port: 47900, name: '', shownName: '', confirm: true };
  let hostDirty = false;
  const desktop = () => isTauri();
  registerSettingsSection({
    id: 'machines',
    title: t('Maschinen und Dienste'),
    order: 50,
    note: t('Geräte, Anschlüsse, Arbeitsbereich und Kamera gehören zum jeweiligen Gerät und werden in dessen Dialogen eingestellt. Die Dienste gelten nur für diesen Rechner.'),
    prepare: async () => {
      agentDirty = hostDirty = false;
      if (!desktop()) return;
      const [a, hs] = await Promise.allSettled([agentSettings(), hostSettings()]);
      if (a.status === 'fulfilled') agent = a.value;
      if (hs.status === 'fulfilled') host = hs.value;
    },
    commit: async () => {
      const errors: string[] = [];
      if (agentDirty) await configureAgent(agent).catch((e: Error) => errors.push(e.message));
      if (hostDirty) await configureHost(host).catch((e: Error) => errors.push(e.message));
      agentDirty = hostDirty = false;
      if (errors.length) throw new Error(errors.join(' · '));
    },
    fields: [
      {
        kind: 'toggle', id: 'machines.checkBeforeLaser', group: t('Laser'), label: t('Vor dem Lasern prüfen und bei Problemen nachfragen'), def: true, keywords: t('Konstruktion prüfen'),
        get: () => loadCheckSettings().beforeLaser,
        set: (v) => saveCheckSettings({ ...loadCheckSettings(), beforeLaser: v }),
      },
      {
        kind: 'toggle', id: 'machines.ignoreOutOfBounds', group: t('Laser'), label: t('Formen außerhalb ignorieren'), def: false, keywords: t('Arbeitsbereich außerhalb Bett Prüfung'),
        hint: t('Formen außerhalb des Arbeitsbereichs werden in der Konstruktionsprüfung kommentarlos ignoriert statt gemeldet. Der Laser-Start prüft weiter.'),
        get: () => loadCheckSettings().ignoreOutOfBounds === true,
        set: (v) => saveCheckSettings({ ...loadCheckSettings(), ignoreOutOfBounds: v }),
      },
      { kind: 'action', id: 'machines.devices', group: t('Laser'), label: t('Geräte'), hint: t('Laser anlegen, wechseln, importieren und exportieren.'), button: t('Geräte …'), run: () => openDevicesDialog(ed) },
      { kind: 'action', id: 'machines.device', group: t('Laser'), label: t('Geräteeinstellungen'), hint: t('Anschluss, Arbeitsbereich, Firmware und Job-Vorgaben des aktuellen Geräts.'), button: t('Öffnen …'), run: () => openDeviceDialog(ed) },
      {
        kind: 'toggle', id: 'machines.fireOverlayInPanel', group: t('Laser'), def: true,
        label: t('Testfeuer-Overlay auch im Verschieben-Panel anzeigen'),
        hint: t('Wenn der Bedienknopf nicht vollständig sichtbar ist, erscheint das Overlay trotzdem.'),
        get: fireOverlayInPanel, set: setFireOverlayInPanel,
      },
      { kind: 'action', id: 'machines.rotary', group: t('Laser'), label: t('Drehachse (Rotary)'), button: t('Öffnen …'), run: () => openRotaryDialog() },
      { kind: 'action', id: 'machines.setup', group: t('Laser'), label: t('Laser einrichten'), hint: t('Schritt für Schritt von der Verbindung bis zum ersten Testauftrag'), button: t('Assistent starten …'), run: () => openSetupWizard(ed) },
      {
        kind: 'toggle', id: 'machines.agentEnabled', group: t('KI-Agenten (MCP)'), label: t('Zugang für KI-Agenten einschalten'), when: desktop, keywords: 'MCP Claude Codex',
        get: () => agent.enabled, set: (v) => { agent.enabled = v; agentDirty = true; },
      },
      {
        kind: 'select', id: 'machines.agentLevel', group: t('KI-Agenten (MCP)'), label: t('Erlaubt'), when: desktop, keywords: 'MCP',
        options: () => agentLevels().map(([v, l]) => [String(v), l]),
        get: () => String(agent.level), set: (v) => { agent.level = Number(v); agentDirty = true; },
      },
      {
        kind: 'number', id: 'machines.agentPort', group: t('KI-Agenten (MCP)'), label: t('Port'), when: desktop, integer: true, min: 1024, max: 65535, keywords: 'MCP',
        get: () => agent.port, set: (v) => { agent.port = v; agentDirty = true; },
      },
      {
        kind: 'action', id: 'machines.agentDetails', group: t('KI-Agenten (MCP)'), label: t('Token, Clients und Protokoll'), when: desktop, keywords: 'MCP Token',
        hint: t('Token, Einrichtung der Clients und Protokoll der Aufrufe.'), button: t('Details …'), run: () => void openAgentDialog(ed),
      },
      {
        kind: 'toggle', id: 'machines.hostEnabled', group: t('Host-Modus'), label: t('Host-Modus einschalten'), when: desktop, keywords: t('Fernsteuerung'),
        get: () => host.enabled, set: (v) => { host.enabled = v; hostDirty = true; },
      },
      {
        kind: 'text', id: 'machines.hostName', group: t('Host-Modus'), label: t('Name im Netzwerk'), when: desktop, maxLength: 80, keywords: t('Host-Modus Fernsteuerung'),
        placeholder: () => host.shownName,
        get: () => host.name, set: (v) => { host.name = v; hostDirty = true; },
      },
      {
        kind: 'number', id: 'machines.hostPort', group: t('Host-Modus'), label: t('Port'), when: desktop, integer: true, min: 1024, max: 65535, keywords: t('Fernsteuerung'),
        get: () => host.port, set: (v) => { host.port = v; hostDirty = true; },
      },
      {
        kind: 'toggle', id: 'machines.hostConfirm', group: t('Host-Modus'), label: t('Fernstarts an diesem Rechner bestätigen'), when: desktop, keywords: t('Host-Modus Fernsteuerung'),
        get: () => host.confirm, set: (v) => { host.confirm = v; hostDirty = true; },
      },
      {
        kind: 'action', id: 'machines.hostDetails', group: t('Host-Modus'), label: t('Gekoppelte Rechner'), when: desktop, keywords: t('Fernsteuerung gekoppelte Rechner'),
        hint: t('Gekoppelte Rechner, Rollen und Fingerabdruck.'), button: t('Details …'), run: () => void openRemoteHostDialog(ed),
      },
    ],
  });

  // ---------- Extensions ----------
  registerSettingsSection({
    id: 'extensions',
    title: t('Erweiterungen und Schriften'),
    order: 60,
    note: appNote,
    fields: [
      {
        kind: 'toggle', id: 'extensions.fontAutoInstall', label: t('Fehlende Schriften beim Öffnen automatisch von Google Fonts laden'), def: false, keywords: 'Google Fonts',
        get: () => autoInstallFonts(), set: (v) => setAutoInstallFonts(v),
      },
      { kind: 'action', id: 'extensions.fonts', label: t('Schriften'), hint: t('Google Fonts laden, eigene Schriften und Favoriten verwalten'), button: t('Öffnen …'), run: () => void openFontManager(ed) },
      { kind: 'action', id: 'extensions.packs', label: t('Erweiterungen'), hint: t('Inhaltspakete mit Vorlagen, Motiven und Materialien installieren und verwalten.'), button: t('Öffnen …'), run: () => void openPacksDialog(ed.doc) },
    ],
  });
}
