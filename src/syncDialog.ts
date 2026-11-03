// Fenster „Einstellungen übertragen“ (Menü Datei): Bereiche wählen, als Datei exportieren/importieren und über
// einen Ordner synchronisieren. Dazu der Hinweis „Neu laden“, wenn ein anderer Rechner etwas geändert hat.
import { h } from './dom';
import { openText, saveText } from './files';
import { t, tn } from './i18n';
import type { Editor } from './editor';
import { BUNDLE_EXT, Bundle, LOCAL_ONLY, parseBundle, SectionId, SECTIONS } from './syncCore';
import {
  bundleCounts, exportBundle, folderMachines, importBundle, isDesktop, onLiveSync, onSyncStatus, resetSyncState, setSyncConfig, startSyncLoop, syncConfig,
  SyncStatus, syncNow, syncSoon, syncStatus,
} from './sync';
import { onLibraryChanged, reloadLibrary } from './assetLibrary';
import { loadPacks, onPacksChanged } from './packs';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const EXPORT_KEY = 'kizamubeam.syncExport';

function sectionLabel(s: SectionId): [string, string] {
  switch (s) {
    case 'settings':
      return [t('Einstellungen'), t('Aussehen, Sprache, Raster, Fangen und die zuletzt benutzten Werte der Dialoge')];
    case 'devices':
      return [t('Geräte'), t('Geräteprofile mit Arbeitsbereich, Firmware, Skripten und Drehachse; Anschluss und Adresse bleiben je Rechner')];
    case 'materials':
      return [t('Material-Bibliothek'), t('Gespeicherte Laserwerte je Material und Dicke')];
    case 'library':
      return [t('Bibliothek'), t('Eigene Motive, Bilder und Designelemente')];
    case 'templates':
      return [t('Vorlagen'), t('Eigene Vorlagen mit variablen Feldern')];
    case 'packs':
      return [t('Erweiterungen'), t('Installierte Inhaltspakete (.kzp)')];
    case 'ui':
      return [t('Oberfläche'), t('Anordnung der Fenster, Funktionsleisten und Werkzeugkasten')];
    case 'camera':
      return [t('Kamera-Kalibrierung'), t('Gehört zur Kamera an diesem Rechner; wird nie synchronisiert, nur auf Wunsch exportiert')];
  }
}

function showDialog(dlg: HTMLDialogElement, onClose: () => void = () => {}) {
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => (dlg.remove(), onClose()));
  document.body.append(dlg);
  dlg.showModal();
}

/** Arbeitsstand sichern und die App neu laden (übernimmt Einstellungen, die schon im Arbeitsspeicher lagen) */
function reloadApp(ed: Editor) {
  ed.saveNow();
  location.reload();
}

function sectionChecks(sections: readonly SectionId[], checked: (s: SectionId) => boolean, extra: (s: SectionId) => string = () => '') {
  const boxes = new Map<SectionId, HTMLInputElement>();
  const list = h('div', { class: 'sync-sections' });
  for (const s of sections) {
    const [label, hint] = sectionLabel(s);
    const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
    cb.checked = checked(s);
    boxes.set(s, cb);
    const more = extra(s);
    list.append(h('label', { class: 'sync-section', title: hint }, cb, h('span', {}, h('b', {}, label), more ? h('span', { class: 'muted' }, ` · ${more}`) : null, h('br'), h('small', { class: 'muted' }, hint))));
  }
  return { list, chosen: () => sections.filter((s) => boxes.get(s)!.checked) };
}

const fmtTime = (ms: number) => (ms ? new Date(ms).toLocaleString() : '–');

export async function openSyncDialog(ed: Editor) {
  const desktop = isDesktop();
  const err = h('p', { class: 'error' });

  // ---------- Datei ----------
  let lastExport: SectionId[] = [];
  try {
    lastExport = JSON.parse(localStorage.getItem(EXPORT_KEY) ?? '[]');
  } catch {
    /* Standard */
  }
  const exp = sectionChecks(SECTIONS, (s) => (lastExport.length ? lastExport.includes(s) : !LOCAL_ONLY.includes(s)));
  const doExport = async () => {
    err.textContent = '';
    const sections = exp.chosen();
    if (!sections.length) return void (err.textContent = t('Bitte mindestens einen Bereich wählen.'));
    try {
      localStorage.setItem(EXPORT_KEY, JSON.stringify(sections));
    } catch {
      /* egal */
    }
    try {
      const text = await exportBundle(sections, syncConfig().machineName || undefined);
      const day = new Date().toISOString().slice(0, 10);
      await saveText(`KizamuBeam-${t('Einstellungen')}-${day}.${BUNDLE_EXT}`, t('KizamuBeam-Einstellungen'), BUNDLE_EXT, 'application/json', text);
    } catch (e) {
      err.textContent = errText(e);
    }
  };
  const doImport = async () => {
    err.textContent = '';
    const r = await openText(t('KizamuBeam-Einstellungen'), [BUNDLE_EXT]);
    if (!r) return;
    let b: Bundle;
    try {
      b = parseBundle(r[1]);
    } catch (e) {
      err.textContent =
        errText(e) === 'newer'
          ? t('„{file}“ stammt aus einer neueren Version von KizamuBeam. Bitte erst aktualisieren.', { file: r[0] })
          : t('„{file}“ ist keine Einstellungs-Datei von KizamuBeam.', { file: r[0] });
      return;
    }
    dlg.close();
    openImportDialog(ed, r[0], b);
  };

  // ---------- Sync-Ordner ----------
  const cfg = syncConfig();
  const syncBox = h('div', { class: 'sync-folder' });
  let unsub = () => {};
  if (desktop) {
    const sync = sectionChecks(
      SECTIONS.filter((s) => !LOCAL_ONLY.includes(s)),
      (s) => cfg.sections.includes(s),
    );
    const nameIn = h('input', { type: 'text', value: cfg.machineName, spellcheck: false, placeholder: t('z. B. MacBook Werkstatt') }) as HTMLInputElement;
    if (!cfg.machineName)
      void import('@tauri-apps/api/core').then((api) => api.invoke<string>('sync_machine_name')).then((n) => {
        if (!nameIn.value && n) nameIn.value = n;
      });
    const folderOut = h('code', { class: 'sync-path' }, cfg.folder || t('Kein Ordner gewählt'));
    let folder = cfg.folder;
    const onCb = h('input', { type: 'checkbox' }) as HTMLInputElement;
    onCb.checked = cfg.enabled && !!cfg.folder;
    const state = h('div', { class: 'sync-state' });
    const save = () => {
      const c = syncConfig();
      setSyncConfig({ ...c, folder, enabled: onCb.checked && !!folder, sections: sync.chosen(), machineName: nameIn.value.trim() || c.machineName });
    };
    const show = (st: SyncStatus) => {
      const c = syncConfig();
      state.replaceChildren(...([
        h('div', {}, !c.enabled ? t('Synchronisieren ist aus.') : st.running ? t('Gleiche ab …') : st.error ? h('span', { class: 'error' }, t('Fehler: {message}', { message: st.error })) : t('Zuletzt abgeglichen: {time}', { time: fmtTime(st.last) })),
        st.machines.length ? h('div', { class: 'muted' }, t('Andere Rechner: {list}', { list: st.machines.map((m) => `${m.name} (${fmtTime(m.written)})`).join(', ') })) : null,
        st.pending.sections.length
          ? h('div', { class: 'warn' }, t('Neue Einstellungen von einem anderen Rechner gelten nach dem Neuladen.'), ' ', h('button', { class: 'btn small', onclick: () => reloadApp(ed) }, t('Neu laden')))
          : null,
        st.conflicts.length
          ? h('div', { class: 'muted', title: st.conflicts.map((x) => x.key).join('\n') }, tn('{n} lokale Änderung wurde durch eine neuere von einem anderen Rechner ersetzt.', '{n} lokale Änderungen wurden durch neuere von anderen Rechnern ersetzt.', st.conflicts.length))
          : null,
      ].filter(Boolean) as Node[]));
    };
    show(syncStatus());
    unsub = onSyncStatus(show);
    const pick = async () => {
      err.textContent = '';
      const api = await import('@tauri-apps/api/core');
      const p = await api.invoke<string | null>('sync_pick_folder');
      if (!p) return;
      let first: 'pull' | 'push' | null = 'push';
      try {
        const own = (await import('./syncCore')).syncFileName(nameIn.value.trim() || 'KizamuBeam', syncConfig().machineId);
        const others = await folderMachines(p, own);
        if (others.length) first = await askFirst(others.map((o) => o.name));
      } catch (e) {
        err.textContent = errText(e);
        return;
      }
      if (!first) return;
      folder = p;
      folderOut.textContent = p;
      onCb.checked = true;
      resetSyncState();
      save();
      await syncNow({ startup: true, first });
      if (syncStatus().error) return;
      // Übernommene Einstellungen liegen noch alt im Arbeitsspeicher
      if (first === 'pull') reloadApp(ed);
    };
    onCb.onchange = () => {
      if (onCb.checked && !folder) return void ((onCb.checked = false), pick());
      save();
      if (onCb.checked) void syncNow();
      else show(syncStatus());
    };
    nameIn.onchange = save;
    sync.list.addEventListener('change', save);
    syncBox.append(
      h('h4', {}, t('Über einen Ordner synchronisieren')),
      h('p', { class: 'note' }, t('Wähle einen Ordner, den iCloud Drive, Dropbox, Nextcloud, OneDrive oder ein Netzlaufwerk auf deine Rechner verteilt. Jeder Rechner schreibt nur seine eigene Datei in den Unterordner „KizamuBeam“; je Eintrag gilt die neueste Änderung.')),
      h('div', { class: 'sync-row' }, h('label', {}, onCb, ' ', t('Synchronisieren')), h('button', { class: 'btn small', onclick: pick }, t('Ordner wählen …')), folderOut),
      h('label', { class: 'sync-row' }, t('Name dieses Rechners'), nameIn),
      h('details', {}, h('summary', {}, t('Was wird synchronisiert?')), sync.list),
      state,
      h('div', { class: 'sync-row' },
        h('button', { class: 'btn small', onclick: () => (save(), void syncNow()) }, t('Jetzt abgleichen')),
        h('button', { class: 'btn small', onclick: () => folder && void import('@tauri-apps/api/core').then((api) => api.invoke('sync_open_folder', { folder })).catch((e) => (err.textContent = errText(e))) }, t('Ordner zeigen')),
      ),
    );
  } else {
    syncBox.append(h('h4', {}, t('Über einen Ordner synchronisieren')), h('p', { class: 'note' }, t('Synchronisieren über einen Ordner gibt es nur in der Desktop-App. Im Browser kannst du die Einstellungen als Datei übertragen.')));
  }

  const dlg = h('dialog', { class: 'sync-dialog' },
    h('h3', {}, t('Einstellungen übertragen')),
    h('h4', {}, t('Als Datei')),
    h('p', { class: 'note' }, t('Exportiere die gewählten Bereiche in eine Datei (.kzs) und lies sie auf einem anderen Rechner wieder ein.')),
    exp.list,
    h('div', { class: 'sync-row' }, h('button', { class: 'btn', onclick: doExport }, t('Exportieren …')), h('button', { class: 'btn', onclick: doImport }, t('Importieren …'))),
    syncBox,
    err,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen'))),
  ) as HTMLDialogElement;
  showDialog(dlg, () => unsub());
}

/** Erster Abgleich mit einem Ordner, in dem schon Einstellungen anderer Rechner liegen */
function askFirst(names: string[]): Promise<'pull' | 'push' | null> {
  return new Promise((resolve) => {
    let r: 'pull' | 'push' | null = null;
    const dlg = h('dialog', { class: 'sync-dialog' },
      h('h3', {}, t('Ordner enthält schon Einstellungen')),
      h('p', {}, t('Hier liegen schon Einstellungen von: {list}.', { list: names.join(', ') })),
      h('p', {}, t('Was soll gelten, wenn es einen Eintrag auf beiden Seiten gibt? Einträge, die nur auf einer Seite vorkommen, kommen in jedem Fall dazu.')),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn primary', onclick: () => ((r = 'pull'), dlg.close()) }, t('Ordner übernehmen')),
        h('button', { class: 'btn', onclick: () => ((r = 'push'), dlg.close()) }, t('Diesen Rechner übernehmen')),
        h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      ),
    ) as HTMLDialogElement;
    showDialog(dlg, () => resolve(r));
  });
}

function openImportDialog(ed: Editor, file: string, b: Bundle) {
  const counts = bundleCounts(b);
  const present = SECTIONS.filter((s) => b.sections[s]);
  const err = h('p', { class: 'error' });
  const pick = sectionChecks(present, () => true, (s) => tn('{n} Eintrag', '{n} Einträge', counts[s] ?? 0));
  const merge = h('input', { type: 'radio', name: 'sync-mode', checked: true }) as HTMLInputElement;
  const replace = h('input', { type: 'radio', name: 'sync-mode' }) as HTMLInputElement;
  const ok = h('button', { class: 'btn primary' }, t('Übernehmen')) as HTMLButtonElement;
  ok.onclick = async () => {
    const sections = pick.chosen();
    if (!sections.length) return void (err.textContent = t('Bitte mindestens einen Bereich wählen.'));
    ok.disabled = true;
    try {
      await importBundle(b, sections, replace.checked ? 'replace' : 'merge');
      reloadApp(ed);
    } catch (e) {
      err.textContent = errText(e);
      ok.disabled = false;
    }
  };
  const dlg = h('dialog', { class: 'sync-dialog' },
    h('h3', {}, t('Einstellungen importieren')),
    h('p', {}, h('b', {}, file), h('span', { class: 'muted' }, ` · ${[b.machine, b.created ? new Date(b.created).toLocaleString() : '', b.app ? `KizamuBeam ${b.app}` : ''].filter(Boolean).join(' · ')}`)),
    present.length ? pick.list : h('p', { class: 'note' }, t('Die Datei enthält keine Einstellungen.')),
    h('div', { class: 'sync-mode' },
      h('label', {}, merge, ' ', h('b', {}, t('Zusammenführen')), h('small', { class: 'muted' }, ' · ', t('Einträge aus der Datei kommen dazu oder ersetzen gleichnamige, alle anderen bleiben'))),
      h('label', {}, replace, ' ', h('b', {}, t('Ersetzen')), h('small', { class: 'muted' }, ' · ', t('Einträge, die in der Datei fehlen, werden in den gewählten Bereichen gelöscht'))),
    ),
    h('p', { class: 'note' }, t('Anschluss und Adresse vorhandener Geräte bleiben. Danach lädt die App neu; dein Projekt bleibt erhalten.')),
    err,
    h('div', { class: 'dialog-buttons' }, ok, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen'))),
  ) as HTMLDialogElement;
  showDialog(dlg);
}

/** Beim Start der Oberfläche: Abgleich im Hintergrund, Listen nach Änderungen neu lesen, Hinweis „Neu laden“ */
export function initSync(ed: Editor) {
  if (!isDesktop()) return;
  startSyncLoop();
  onLiveSync((sections) => {
    if (sections.includes('library')) reloadLibrary();
    if (sections.includes('packs')) void loadPacks();
  });
  onLibraryChanged(syncSoon);
  onPacksChanged(syncSoon);
  let banner: HTMLElement | null = null;
  let dismissed = '';
  onSyncStatus((st) => {
    const sig = st.pending.sections.join(',');
    if (!sig || sig === dismissed) {
      if (!sig) banner?.remove(), (banner = null);
      return;
    }
    if (banner) return;
    const from = st.pending.from.join(', ');
    banner = h('div', { class: 'sync-banner', role: 'status' },
      h('span', {}, from ? t('Neue Einstellungen von „{name}“.', { name: from }) : t('Neue Einstellungen von einem anderen Rechner.')),
      h('button', { class: 'btn small primary', onclick: () => reloadApp(ed) }, t('Neu laden')),
      h('button', { class: 'btn small', onclick: () => ((dismissed = sig), banner?.remove(), (banner = null)) }, t('Später')),
    );
    document.body.append(banner);
  });
  if (syncConfig().enabled) void syncNow();
}
