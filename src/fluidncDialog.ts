// Dialoge für FluidNC: Konfiguration (config.yaml) lesen und ändern mit Sicherungen, Dateien auf SD-Karte und Flash,
// Steuerungen im Netzwerk suchen. Die Logik dazu steht in fluidnc.ts.
import type { Editor } from './editor';
import { h } from './dom';
import { openText, saveText } from './files';
import {
  deleteCmd, diffConfig, FluidFile, FluidFs, listCmd, parseEsp800, parseFileList, restoreCmds, RESTART_CMD, safeFileName, saveCmd, setCmd,
} from './fluidnc';
import { device, laserNotify, uploadJob } from './laser';
import { machine } from './machine';
import { parseFluidConfig } from './setup';
import { locale, t, tn } from './i18n';

function dialog(cls: string, ...children: (HTMLElement | string)[]): HTMLDialogElement {
  const dlg = h('dialog', { class: `fluid-dialog ${cls}` }, ...children) as HTMLDialogElement;
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

/** Zeilen nacheinander senden; liefert die Fehlermeldungen (Befehl und Antwort) */
async function sendAll(cmds: string[]): Promise<string[]> {
  const errors: string[] = [];
  for (const c of cmds) {
    const r = await machine.query([c], 3000);
    const e = r.find((l) => /^error/i.test(l));
    if (e) errors.push(`${c} → ${e}`);
  }
  return errors;
}

const ready = () => machine.connected && !machine.running && machine.fw.read === 'fluidnc';
const notReady = () =>
  !machine.connected ? t('Nicht verbunden.') : machine.running ? t('Es läuft bereits ein Auftrag.') : t('Nur für Steuerungen mit FluidNC.');

// ---------- Sicherungen ----------

interface Backup {
  date: string;
  file: string;
  text: string;
  note: string;
}

const BACKUP_KEY = 'kizamubeam.fluidBackups';
const MAX_BACKUPS = 10;

function loadBackups(): Backup[] {
  try {
    const all = JSON.parse(localStorage.getItem(BACKUP_KEY) || '{}') as Record<string, Backup[]>;
    return all[device.id] ?? [];
  } catch {
    return [];
  }
}

function saveBackups(list: Backup[]) {
  try {
    const all = JSON.parse(localStorage.getItem(BACKUP_KEY) || '{}') as Record<string, Backup[]>;
    all[device.id] = list.slice(0, MAX_BACKUPS);
    localStorage.setItem(BACKUP_KEY, JSON.stringify(all));
  } catch {
    /* nicht speicherbar */
  }
}

/** Stand vor einer Änderung sichern (die neueste zuerst; gleicher Text wie die letzte wird nicht doppelt gespeichert) */
export function addBackup(text: string, file: string, note: string) {
  const list = loadBackups();
  if (list[0]?.text === text) return;
  saveBackups([{ date: new Date().toISOString(), file, text, note }, ...list]);
}

const backupName = (b: Backup) => `fluidnc-${device.name.replace(/[^\w-]+/g, '-')}-${b.date.slice(0, 16).replace(/[:T]/g, '-')}.yaml`;

// ---------- Konfiguration ----------

/** Konfiguration der verbundenen FluidNC-Steuerung ansehen und ändern */
export async function openFluidConfig() {
  if (!ready()) return laserNotify(notReady(), true);
  const note = h('div', { class: 'note' }, t('Lese Konfiguration …'));
  const search = h('input', { type: 'search', placeholder: t('Suchen, z. B. max_travel oder laser'), oninput: () => render() }) as HTMLInputElement;
  const table = h('div', { class: 'fluid-config' });
  const backups = h('div', { class: 'fluid-backups' });
  const count = h('span', { class: 'note' });
  let base: Record<string, string> = {};
  let file = 'config.yaml';
  /** Geänderte Werte: Pfad → neuer Wert */
  const edits = new Map<string, string>();

  const applyBtn = h('button', { class: 'btn', title: t('Werte sofort setzen; nach einem Neustart gilt wieder die gespeicherte Datei'), onclick: () => apply(false) }, t('Nur ausprobieren')) as HTMLButtonElement;
  const saveBtn = h('button', { class: 'btn primary', onclick: () => apply(true) }, t('Übernehmen und speichern')) as HTMLButtonElement;
  const restartBtn = h('button', { class: 'btn', title: t('Steuerung neu starten ({cmd}); manche Änderungen, z. B. an Pins, wirken erst danach', { cmd: RESTART_CMD }), onclick: () => restart() }, t('Neu starten'));

  const dlg = dialog('fluid-config-dialog',
    h('h3', {}, t('FluidNC-Konfiguration')),
    h('div', { class: 'conn-row' }, search,
      h('button', { class: 'btn', onclick: () => load() }, t('Neu lesen')),
      h('button', { class: 'btn', title: t('Gelesene Konfiguration als YAML-Datei speichern'), onclick: () => saveFile() }, t('Als Datei speichern …')),
      h('button', { class: 'btn', title: t('Eine gespeicherte YAML-Datei mit der Steuerung vergleichen und die Unterschiede übernehmen'), onclick: () => restoreFromFile() }, t('Aus Datei laden …')),
    ),
    table,
    h('details', { class: 'fluid-backups-box' }, h('summary', {}, t('Sicherungen')), h('div', { class: 'note' }, t('Vor jedem Speichern legt KizamuBeam den bisherigen Stand hier ab (die letzten {n} je Gerät).', { n: MAX_BACKUPS })), backups),
    note,
    h('div', { class: 'dialog-buttons' }, count, restartBtn, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen')), applyBtn, saveBtn),
  );

  function render() {
    table.textContent = '';
    const q = search.value.trim().toLowerCase();
    const paths = Object.keys(base).filter((p) => !q || p.includes(q) || base[p].toLowerCase().includes(q));
    for (const p of paths.slice(0, 500)) {
      const input = h('input', {
        type: 'text', value: edits.get(p) ?? base[p], spellcheck: false,
        oninput: (e: Event) => {
          const v = (e.target as HTMLInputElement).value;
          if (v.trim() === base[p]) edits.delete(p);
          else edits.set(p, v);
          input.classList.toggle('changed', edits.has(p));
          updateButtons();
        },
      }) as HTMLInputElement;
      input.classList.toggle('changed', edits.has(p));
      table.append(h('label', { title: p }, p), input);
    }
    if (paths.length > 500) table.append(h('div', { class: 'note wide' }, t('Nur die ersten 500 Einträge; die Suche grenzt weiter ein.')));
    if (!paths.length) table.append(h('div', { class: 'note wide' }, t('Keine Einträge.')));
    renderBackups();
    updateButtons();
  }

  function updateButtons() {
    count.textContent = edits.size ? tn('{n} Änderung', '{n} Änderungen', edits.size) : '';
    applyBtn.disabled = saveBtn.disabled = !edits.size || !ready();
  }

  function renderBackups() {
    backups.textContent = '';
    const list = loadBackups();
    if (!list.length) backups.append(h('div', { class: 'note' }, t('Noch keine Sicherung.')));
    for (const b of list)
      backups.append(h('div', { class: 'conn-row' },
        h('span', { class: 'grow' }, `${new Date(b.date).toLocaleString(locale)} · ${b.file}${b.note ? ` · ${b.note}` : ''}`),
        h('button', { class: 'btn small', onclick: () => saveText(backupName(b), 'YAML', 'yaml', 'text/yaml', b.text) }, t('Speichern …')),
        h('button', { class: 'btn small', onclick: () => restore(parseFluidConfig(b.text.split('\n')), t('Sicherung vom {date}', { date: new Date(b.date).toLocaleString(locale) })) }, t('Wiederherstellen')),
      ));
  }

  async function load() {
    note.textContent = t('Lese Konfiguration …');
    const c = await machine.readFluidConfig();
    if (!c) {
      note.textContent = t('Keine Konfiguration erhalten. Details stehen in der Konsole.');
      return;
    }
    base = { ...c.values };
    file = c.file;
    edits.clear();
    note.textContent = tn('{n} Eintrag aus {file}. Geänderte Felder sind markiert.', '{n} Einträge aus {file}. Geänderte Felder sind markiert.', Object.keys(base).length, { file });
    render();
  }

  async function apply(persist: boolean) {
    if (!ready()) return void (note.textContent = notReady());
    const changes = [...edits].map(([path, v]) => ({ path, from: base[path], to: v.trim() }));
    let cmds: string[];
    try {
      cmds = changes.map((c) => setCmd(c.path, c.to));
    } catch (e) {
      note.textContent = (e as Error).message;
      return;
    }
    const list = changes.map((c) => `${c.path}: ${c.from} → ${c.to}`).join('\n');
    const msg = persist
      ? t('Diese Werte werden gesetzt und in {file} gespeichert:', { file }) + '\n\n' + list + '\n\n' + t('Der bisherige Stand wird vorher als Sicherung abgelegt. Weiter?')
      : t('Diese Werte werden sofort gesetzt, aber nicht gespeichert (nach einem Neustart gilt wieder {file}):', { file }) + '\n\n' + list + '\n\n' + t('Weiter?');
    if (!confirm(msg)) return;
    if (persist && machine.fluid) addBackup(machine.fluid.text, file, t('vor dem Speichern'));
    const errors = await sendAll(persist ? [...cmds, saveCmd(file)] : cmds);
    await load();
    note.textContent = errors.length
      ? t('Nicht alles hat geklappt:') + ' ' + errors.join(' · ')
      : persist
        ? t('Gespeichert. Änderungen an Pins, Motoren und WLAN wirken erst nach einem Neustart der Steuerung.')
        : t('Gesetzt (nicht gespeichert).');
    note.classList.toggle('error', errors.length > 0);
  }

  async function restore(values: Record<string, string>, what: string) {
    if (!ready()) return void (note.textContent = notReady());
    if (!Object.keys(values).length) return void (note.textContent = t('In der Datei steht keine Konfiguration.'));
    let cmds: string[];
    try {
      cmds = restoreCmds(base, values, file);
    } catch (e) {
      note.textContent = (e as Error).message;
      return;
    }
    if (!cmds.length) return void (note.textContent = t('{what} stimmt mit der Steuerung überein.', { what }));
    const ch = diffConfig(base, values);
    const extra = Object.keys(base).filter((k) => values[k] === undefined).length;
    const list = ch.slice(0, 30).map((c) => `${c.path}: ${c.from ?? '–'} → ${c.to}`).join('\n') + (ch.length > 30 ? '\n' + tn('… und {n} weitere|one', '… und {n} weitere', ch.length - 30) : '');
    if (!confirm(t('{what} wiederherstellen? Diese Werte werden gesetzt und in {file} gespeichert:', { what, file }) + '\n\n' + list +
      (extra ? '\n\n' + tn('{n} Eintrag gibt es nur in der Steuerung; er bleibt, wie er ist.', '{n} Einträge gibt es nur in der Steuerung; sie bleiben, wie sie sind.', extra) : ''))) return;
    if (machine.fluid) addBackup(machine.fluid.text, file, t('vor dem Wiederherstellen'));
    const errors = await sendAll(cmds);
    await load();
    note.textContent = errors.length ? t('Nicht alles hat geklappt:') + ' ' + errors.join(' · ') : t('Wiederhergestellt und gespeichert. Danach die Steuerung neu starten.');
    note.classList.toggle('error', errors.length > 0);
  }

  async function saveFile() {
    if (!machine.fluid) return;
    await saveText(`fluidnc-${device.name.replace(/[^\w-]+/g, '-')}.yaml`, 'YAML', 'yaml', 'text/yaml', machine.fluid.text);
  }

  async function restoreFromFile() {
    const f = await openText('YAML', ['yaml', 'yml']);
    if (f) await restore(parseFluidConfig(f[1].split(/\r?\n/)), f[0]);
  }

  async function restart() {
    if (!machine.connected) return;
    if (!confirm(t('Steuerung jetzt neu starten? Über WLAN bricht die Verbindung dabei ab; danach neu verbinden.'))) return;
    await machine.send(RESTART_CMD);
    dlg.close();
  }

  await load();
}

// ---------- Dateien ----------

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const runnable = (n: string) => /\.(gcode|nc|gc|ngc|g)$/i.test(n);

/** Dateien auf SD-Karte und Flash: ansehen, Job hochladen, starten, löschen */
export async function openFluidFiles(ed: Editor) {
  if (!ready()) return laserNotify(notReady(), true);
  let fs: FluidFs = device.runFrom === 'localfs' ? 'localfs' : 'sd';
  const list = h('div', { class: 'fluid-files' });
  const note = h('div', { class: 'note' });
  const nameIn = h('input', { type: 'text', value: 'kizamubeam.gcode', spellcheck: false, title: t('Dateiname auf der Steuerung') }) as HTMLInputElement;
  const tabs = (['sd', 'localfs'] as FluidFs[]).map((k) =>
    h('button', { class: 'btn', onclick: () => ((fs = k), load()) }, k === 'sd' ? t('SD-Karte') : t('Flash')) as HTMLButtonElement);
  const dlg = dialog('fluid-files-dialog',
    h('h3', {}, t('Dateien auf der Steuerung')),
    h('div', { class: 'conn-row' }, ...tabs, h('button', { class: 'btn', onclick: () => load() }, t('Neu lesen'))),
    list,
    h('div', { class: 'conn-row' },
      nameIn,
      h('button', { class: 'btn', title: t('Aktuellen Job berechnen und über WLAN auf die Steuerung laden (Weboberfläche, {host}:{port})', { host: device.host, port: device.httpPort }), onclick: () => upload() }, t('Job hochladen')),
    ),
    note,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen'))),
  );

  async function load() {
    tabs.forEach((b, i) => b.classList.toggle('primary', (['sd', 'localfs'] as FluidFs[])[i] === fs));
    list.textContent = '';
    note.textContent = t('Lese Dateiliste …');
    note.classList.remove('error');
    const lines = await machine.query([listCmd(fs)], 5000, true);
    const files = parseFileList(lines);
    const err = lines.find((l) => /^error|no sd|not found|failed/i.test(l));
    note.textContent = err && !files.length ? t('Die Steuerung meldet: {msg}', { msg: err }) : tFiles(files);
    note.classList.toggle('error', !!err && !files.length);
    for (const f of files) {
      const isConfig = !!machine.fluid && f.name.replace(/^\//, '') === machine.fluid.file && fs === 'localfs';
      list.append(h('div', { class: 'fluid-file' },
        h('span', { class: 'grow' }, f.dir ? `📁 ${f.name}` : f.name, isConfig ? h('span', { class: 'note' }, ` (${t('Konfiguration')})`) : ''),
        h('span', { class: 'note' }, f.dir ? '' : fmtSize(f.size)),
        ...(f.dir ? [] : [
          h('button', { class: 'btn small', disabled: !runnable(f.name), title: t('Auf der Steuerung starten'), onclick: () => run(f) }, t('Starten')),
          h('button', { class: 'btn small', onclick: () => del(f, isConfig) }, t('Löschen')),
        ]),
      ));
    }
  }

  const tFiles = (files: FluidFile[]) => (files.length ? tn('{n} Eintrag.', '{n} Einträge.', files.length) : t('Keine Dateien.'));

  async function run(f: FluidFile) {
    if (!confirm(t('{file} jetzt auf der Steuerung starten? Der Laser beginnt sofort.', { file: f.name }))) return;
    dlg.close();
    await machine.runStored(fs, f.name);
  }

  async function del(f: FluidFile, isConfig: boolean) {
    const msg = isConfig
      ? t('{file} ist die Konfiguration der Steuerung. Ohne sie startet FluidNC nur mit Grundeinstellungen. Wirklich löschen?', { file: f.name })
      : t('{file} löschen?', { file: f.name });
    if (!confirm(msg)) return;
    const r = await machine.query([deleteCmd(fs, f.name)], 3000);
    if (r.some((l) => /^error/i.test(l))) laserNotify(t('Löschen fehlgeschlagen, Details in der Konsole.'), true);
    await load();
  }

  async function upload() {
    if (!ready()) return void (note.textContent = notReady());
    const name = safeFileName(nameIn.value);
    nameIn.value = name;
    note.textContent = t('Lade hoch …');
    const size = await uploadJob(ed, fs, name);
    note.textContent = size === null ? t('Hochladen fehlgeschlagen, Details stehen im Laser-Fenster.') : t('{file} hochgeladen ({size}).', { file: name, size: fmtSize(size) });
    if (size !== null) await load();
  }

  await load();
}

// ---------- Suche im Netzwerk ----------

/** FluidNC im Netzwerk suchen; onPick bekommt die gewählte Adresse */
export function openDiscovery(httpPort: number, onPick: (host: string) => void) {
  const list = h('div', { class: 'fluid-files' });
  const note = h('div', { class: 'note' }, t('Suche im Netzwerk … (bis zu 15 Sekunden)'));
  const dlg = dialog('fluid-discover-dialog',
    h('h3', {}, t('FluidNC im Netzwerk suchen')),
    h('div', { class: 'note' }, t('Gesucht wird unter fluidnc.local und an allen Adressen des eigenen Netzes, die auf Port {port} wie FluidNC antworten. macOS fragt beim ersten Mal nach dem Zugriff auf das lokale Netzwerk.', { port: httpPort })),
    list,
    note,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen'))),
  );
  machine.discover(httpPort).then((found) => {
    note.textContent = found.length ? '' : t('Keine FluidNC-Steuerung gefunden. Ist sie eingeschaltet und im selben WLAN?');
    for (const f of found) {
      const info = parseEsp800(f.info);
      list.append(h('div', { class: 'fluid-file' },
        h('span', { class: 'grow' }, f.host, info?.hostname && info.hostname !== f.host ? h('span', { class: 'note' }, ` (${info.hostname}.local)`) : ''),
        h('span', { class: 'note' }, info?.version ?? 'FluidNC'),
        h('button', { class: 'btn small primary', onclick: () => (onPick(f.host), dlg.close()) }, t('Übernehmen')),
      ));
    }
  }).catch((e) => (note.textContent = String(e)));
}
