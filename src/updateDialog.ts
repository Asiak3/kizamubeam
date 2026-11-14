// Fenster „Nach Updates suchen“ (Menü Hilfe) und die stille Prüfung beim Start.
import { h } from './dom';
import { t } from './i18n';
import { hasNative, native } from './native';
import { Channel, defaultChannel, isNightly, pickRelease, RELEASES_API, RELEASES_PAGE, resolveChannel } from './updates';
import { version as APP_VERSION } from '../package.json';

const CHANNEL_KEY = 'kizamubeam.updateChannel';
const AUTO_KEY = 'kizamubeam.updateAuto';
const LAST_KEY = 'kizamubeam.updateLastCheck';
const DAY = 24 * 3600 * 1000;

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ohne Speicher gilt die Vorgabe */
  }
};
const channel = (): Channel => resolveChannel(read(CHANNEL_KEY), APP_VERSION);
const autoCheck = () => read(AUTO_KEY) !== '0';

/** For the settings window */
export const updateChannel = channel;
export const setUpdateChannel = (ch: Channel) => write(CHANNEL_KEY, ch);
export const updateAutoCheck = autoCheck;
export const setUpdateAutoCheck = (on: boolean) => write(AUTO_KEY, on ? '1' : '0');
export const defaultUpdateChannel = () => defaultChannel(APP_VERSION);
/** This build is a nightly build from main (untested on hardware) */
export const nightlyBuild = isNightly(APP_VERSION);
/** Warning shown with the nightly channel and in nightly builds */
export const nightlyWarning = () =>
  t('Nightly-Builds entstehen jede Nacht automatisch aus dem aktuellen Entwicklungsstand und sind nicht an echter Hardware getestet. Mit einem Nightly gespeicherte Dateien lassen sich in der stabilen Version eventuell nicht öffnen.');

interface Found {
  version: string;
  notes?: string | null;
  page?: string;
}

/** Neuere Version im gewählten Kanal suchen; null = aktuell */
async function check(ch: Channel): Promise<Found | null> {
  const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(t('GitHub antwortet mit {status}', { status: res.status }));
  const cand = pickRelease(await res.json(), ch, APP_VERSION);
  if (!cand) return null;
  const info = await native<{ version: string; notes?: string | null } | null>('update_check', { url: cand.manifest });
  return info ? { ...info, page: cand.page } : null;
}

/** Beim Start höchstens einmal am Tag still prüfen; das Fenster erscheint nur, wenn es etwas Neues gibt */
export async function maybeCheckForUpdates() {
  if (!hasNative() || !autoCheck()) return;
  const last = Number(read(LAST_KEY) ?? 0);
  if (Date.now() - last < DAY) return;
  try {
    if (!(await native<boolean>('update_supported'))) return;
    write(LAST_KEY, String(Date.now()));
    const found = await check(channel());
    if (found) openUpdateDialog(found);
  } catch {
    /* offline oder GitHub nicht erreichbar: beim nächsten Start erneut */
  }
}

export function openUpdateDialog(found?: Found) {
  const status = h('p', {});
  const notes = h('pre', { class: 'update-notes', hidden: true });
  const bar = h('progress', { hidden: true, max: 1, value: 0 }) as HTMLProgressElement;
  const checkBtn = h('button', { class: 'btn' }, t('Jetzt suchen'));
  const installBtn = h('button', { class: 'btn primary', hidden: true }, t('Jetzt aktualisieren'));
  const closeBtn = h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen'));

  const chSel = h(
    'select',
    { onchange: () => write(CHANNEL_KEY, chSel.value) },
    h('option', { value: 'stable' }, t('Stabil')),
    h('option', { value: 'nightly' }, t('Nightly (mit Vorabversionen)')),
  ) as HTMLSelectElement;
  chSel.value = channel();
  const chNote = h('p', { class: 'note' }, nightlyWarning());
  const showChNote = () => (chNote.hidden = chSel.value !== 'nightly');
  chSel.addEventListener('change', showChNote);
  showChNote();
  const auto = h('input', { type: 'checkbox', checked: autoCheck(), onchange: () => write(AUTO_KEY, auto.checked ? '1' : '0') }) as HTMLInputElement;

  const show = (f: Found | null) => {
    installBtn.hidden = !f;
    notes.hidden = !f?.notes;
    notes.textContent = f?.notes ?? '';
    status.textContent = f
      ? t('Version {version} ist verfügbar.', { version: f.version })
      : t('KizamuBeam ist auf dem neuesten Stand.');
  };

  const busy = (on: boolean) => {
    checkBtn.disabled = on;
    chSel.disabled = on;
  };

  checkBtn.onclick = async () => {
    busy(true);
    installBtn.hidden = true;
    status.textContent = t('Suche nach Updates …');
    try {
      write(LAST_KEY, String(Date.now()));
      show(await check(chSel.value as Channel));
    } catch (e) {
      status.textContent = t('Suche fehlgeschlagen: {error}', { error: String((e as Error)?.message ?? e) });
    }
    busy(false);
  };

  installBtn.onclick = async () => {
    busy(true);
    installBtn.disabled = true;
    closeBtn.disabled = true;
    bar.hidden = false;
    bar.removeAttribute('value');
    status.textContent = t('Update wird geladen …');
    const { Channel: IpcChannel } = await import('@tauri-apps/api/core');
    let total = 0;
    let got = 0;
    const onProgress = new IpcChannel<{ event: string; data?: { total?: number | null; len?: number } }>();
    onProgress.onmessage = (m) => {
      if (m.event === 'started' && m.data?.total) {
        total = m.data.total;
        bar.max = total;
        bar.value = 0;
      } else if (m.event === 'chunk' && total) bar.value = got += m.data?.len ?? 0;
      else if (m.event === 'finished') status.textContent = t('Update wird installiert, KizamuBeam startet danach neu …');
    };
    try {
      await native('update_install', { onProgress });
    } catch (e) {
      status.textContent = t('Update fehlgeschlagen: {error}', { error: String((e as Error)?.message ?? e) });
      bar.hidden = true;
      busy(false);
      installBtn.disabled = false;
      closeBtn.disabled = false;
    }
  };

  const unsupported = h('p', { class: 'note', hidden: true }, t('Diese Version kann sich nicht selbst aktualisieren. Neue Versionen gibt es unter {url}', { url: RELEASES_PAGE }));

  const dlg = h(
    'dialog',
    { class: 'update-dialog' },
    h('h3', {}, t('Updates')),
    h('p', {}, t('Installierte Version: {version}', { version: APP_VERSION })),
    h('label', { class: 'row' }, t('Kanal'), chSel),
    chNote,
    h('label', { class: 'row' }, auto, t('Beim Start einmal am Tag nach Updates suchen')),
    unsupported,
    status,
    notes,
    bar,
    h('div', { class: 'dialog-buttons' }, checkBtn, installBtn, closeBtn),
  );
  dlg.addEventListener('cancel', (e) => closeBtn.disabled && e.preventDefault());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();

  if (found) show(found);
  if (!hasNative()) {
    unsupported.hidden = false;
    checkBtn.disabled = true;
    return;
  }
  native<boolean>('update_supported').then((ok) => {
    if (ok) return;
    unsupported.hidden = false;
    checkBtn.disabled = true;
  });
}
