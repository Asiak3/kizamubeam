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
import { autoInstallFonts, setAutoInstallFonts } from '../fontCatalog';
import { loadOverlapSettings, OVERLAP_HOLD_MS, OverlapSettings, saveOverlapSettings } from '../overlapPicker';
import { defaultUpdateChannel, openUpdateDialog, setUpdateAutoCheck, setUpdateChannel, updateAutoCheck, updateChannel } from '../updateDialog';
import type { Channel } from '../updates';
import { resetDialogPositions } from '../dialogDrag';
import { resetLayout } from '../dock';
import { openToolbarDialog, showAllBars } from '../toolbars';
import { openDeviceDialog, openDevicesDialog, openRotaryDialog } from '../laser';
import { openSetupWizard } from '../setupWizard';
import { openSyncDialog } from '../syncDialog';
import { openPacksDialog } from '../packsDialog';
import { openFontManager } from '../fontManager';
import { agentLevels, agentSettings, configureAgent, openAgentDialog } from '../agentui';
import { configureHost, hostSettings, openRemoteHostDialog } from '../remoteHost';
import { registerSettingsSection } from './registry';

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
      {
        kind: 'select', id: 'general.lang', label: t('Sprache'), keywords: 'language lingua idioma', late: true, def: 'system',
        options: () => [['system', t('Wie System|Sprache')], ...LANGUAGES],
        get: () => langPref(),
        set: (v) => hooks.setLanguage(v as LangPref),
      },
      {
        kind: 'select', id: 'general.updateChannel', group: t('Updates'), label: t('Update-Kanal'), keywords: t('Beta Stabil Version'), def: defaultUpdateChannel(),
        options: () => [['stable', t('Stabil')], ['beta', t('Beta (mit Vorabversionen)')]],
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
      { kind: 'action', id: 'machines.devices', group: t('Laser'), label: t('Geräte'), hint: t('Laser anlegen, wechseln, importieren und exportieren.'), button: t('Geräte …'), run: () => openDevicesDialog(ed) },
      { kind: 'action', id: 'machines.device', group: t('Laser'), label: t('Geräteeinstellungen'), hint: t('Anschluss, Arbeitsbereich, Firmware und Job-Vorgaben des aktuellen Geräts.'), button: t('Öffnen …'), run: () => openDeviceDialog(ed) },
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
      { kind: 'action', id: 'extensions.packs', label: t('Erweiterungen'), hint: t('Inhaltspakete mit Vorlagen, Motiven und Materialien installieren und verwalten.'), button: t('Öffnen …'), run: () => void openPacksDialog() },
    ],
  });
}
