// Remote KizamuBeam, client side (issue #188): pairing with a host, sending jobs to it and showing its answer
// (preview, estimated time, warnings) before the laser starts. The host computes the G-code itself.
import type { Editor } from './editor';
import type { JobSource } from './laser';
import { h } from './dom';
import { formatDuration } from './gcode';
import { t, tBackend } from './i18n';
import { assetUrl } from './images';
import { isTauri, machine } from './machine';
import { BundleFont, bytesToBase64, fontLabel, fontsUsed, JobBundle, MAX_BUNDLE, sourceProject } from './remoteBundle';

/** Answer of the host to a submitted job */
interface Submitted {
  id: number;
  name: string;
  total: number;
  warnings: string[];
  preview: string;
  /** The host asks its own user before the job starts */
  confirm: boolean;
}

type Notify = (msg: string, error?: boolean) => void;

async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(tBackend(String(e)));
  }
}

async function appVersion(): Promise<string> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return '';
  }
}

/** Everything the host needs to compute the job: project with images, fonts, selection */
export async function buildBundle(ed: Editor, src: JobSource | undefined, cutSelected: boolean): Promise<{ bundle: JobBundle; missing: string[] }> {
  const project = src ? sourceProject(src.doc, src.layer, src.imgLayer, assetUrl) : ed.serialize();
  const missing: string[] = [];
  const fonts: BundleFont[] = await Promise.all(
    fontsUsed(src ? src.doc.objs : ed.doc.objs).map(async (f) => {
      let data: string | null = null;
      try {
        const buf = await invoke<ArrayBuffer>('font_data', { family: f.family, bold: f.bold, italic: f.italic });
        data = bytesToBase64(new Uint8Array(buf));
      } catch {
        missing.push(fontLabel(f));
      }
      return { ...f, data };
    }),
  );
  const bundle: JobBundle = {
    name: src?.name ?? ed.tab.name ?? 'KizamuBeam',
    project,
    only: !src && cutSelected ? ed.sel.map((o) => o.id) : null,
    fonts,
    app: await appVersion(),
  };
  return { bundle, missing };
}

async function makeBundle(ed: Editor, src: JobSource | undefined, cutSelected: boolean, notify: Notify): Promise<JobBundle | null> {
  if (!machine.remote) return notify(t('Nicht verbunden.'), true), null;
  if (!src && cutSelected && !ed.sel.length) return notify(t('Nichts zu lasern: Die Auswahl ist leer oder liegt nur auf Layern ohne Ausgabe.'), true), null;
  const { bundle, missing } = await buildBundle(ed, src, cutSelected);
  if (bundle.project.length + bundle.fonts.reduce((n, f) => n + (f.data?.length ?? 0), 0) > MAX_BUNDLE)
    return notify(t('Der Auftrag ist zu groß für die Übertragung (über {mb} MB). Große Bilder verkleinern oder in Teilen lasern.', { mb: MAX_BUNDLE / 1024 / 1024 }), true), null;
  if (missing.length) notify(t('Schriften fehlen auf diesem Rechner, der Host nimmt seine eigenen: {list}', { list: missing.join(', ') }));
  return bundle;
}

/**
 * Job through the host: send the bundle, show the host's preview with time and warnings, start on confirmation.
 * true when the host started the job.
 */
export async function remoteJob(ed: Editor, src: JobSource | undefined, cutSelected: boolean, notify: Notify): Promise<boolean> {
  const bundle = await makeBundle(ed, src, cutSelected, notify);
  if (!bundle) return false;
  const host = machine.remote!.host;
  notify(t('Auftrag geht an {host}, der Host berechnet ihn …', { host }));
  let r: Submitted;
  try {
    r = await machine.remoteRequest<Submitted>('job_submit', { bundle });
  } catch (e) {
    notify((e as Error).message, true);
    return false;
  }
  if (!(await confirmStart(host, r))) {
    notify(t('Nicht gestartet. Der Auftrag liegt in der Auftragsliste des Hosts.'));
    return false;
  }
  if (r.confirm) notify(t('Wartet auf die Bestätigung am Host …'));
  try {
    await machine.remoteRequest('job_start', { id: r.id });
  } catch (e) {
    notify((e as Error).message, true);
    return false;
  }
  notify(t('Job auf {host} gestartet, geschätzt {total}.', { host, total: formatDuration(r.total) }));
  return true;
}

/** Frame or contour of the job, computed and run by the host */
export async function remoteFrame(ed: Editor, src: JobSource | undefined, cutSelected: boolean, contour: boolean, notify: Notify): Promise<boolean> {
  const bundle = await makeBundle(ed, src, cutSelected, notify);
  if (!bundle) return false;
  try {
    machine.jobIsFrame = true;
    await machine.remoteRequest('frame', { bundle, contour });
    return true;
  } catch (e) {
    machine.jobIsFrame = false;
    notify((e as Error).message, true);
    return false;
  }
}

/** The host's answer before the start: preview, time, warnings */
function confirmStart(host: string, r: Submitted): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const startBtn = h('button', { class: 'btn primary', onclick: () => ((result = true), dlg.close()) }, r.confirm ? t('An den Host schicken') : t('Job starten')) as HTMLButtonElement;
    const dlg = h('dialog', { class: 'remote-confirm' },
      h('h3', {}, t('Auftrag auf {host}', { host })),
      h('p', { class: 'note' }, t('So hat der Host den Auftrag mit seinem Gerät berechnet. Erst „Job starten“ setzt den Laser in Gang.')),
      r.preview ? h('img', { class: 'remote-preview', src: r.preview, alt: '' }) : '',
      h('dl', { class: 'remote-facts' },
        h('dt', {}, t('Name')), h('dd', {}, r.name),
        h('dt', {}, t('Geschätzte Dauer')), h('dd', {}, formatDuration(r.total)),
      ),
      ...(r.warnings.length ? [h('ul', { class: 'remote-warnings' }, ...r.warnings.map((w) => h('li', {}, w)))] : []),
      r.confirm ? h('p', { class: 'note' }, t('Der Host fragt vor dem Start noch einmal nach. Jemand am Laser muss den Auftrag dort bestätigen.')) : '',
      h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')), startBtn),
    );
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    // Warnings deserve a look: do not start with Enter by accident
    (dlg.querySelector('.dialog-buttons .btn') as HTMLElement).focus();
  });
}

/** Name of the host this computer is paired with (by certificate fingerprint), or null */
export async function pairedHost(fingerprint: string): Promise<string | null> {
  if (!isTauri() || !fingerprint) return null;
  return invoke<string | null>('remote_paired', { fingerprint }).catch(() => null);
}

export async function forgetHost(fingerprint: string) {
  if (isTauri() && fingerprint) await invoke('remote_forget', { fingerprint });
}

/**
 * Pair with a host: the host shows a code, it is typed in here. Resolves with the certificate fingerprint
 * (stored in the device) and the host name, or null when cancelled.
 */
export function openPairDialog(host: string, port: number): Promise<{ fingerprint: string; host: string } | null> {
  return new Promise((resolve) => {
    if (!isTauri()) {
      alert(t('Die Maschinenanbindung gibt es nur in der Desktop-App.'));
      return resolve(null);
    }
    let result: { fingerprint: string; host: string } | null = null;
    const state = h('p', { class: 'note' }, t('Verbinde mit {where} …', { where: `${host}:${port}` }));
    const fp = h('p', { class: 'note remote-fp' });
    const code = h('input', { type: 'text', inputmode: 'numeric', maxlength: '6', placeholder: '000000', class: 'remote-code-input', disabled: true }) as HTMLInputElement;
    const okBtn = h('button', { class: 'btn primary', disabled: true }, t('Koppeln')) as HTMLButtonElement;
    const finish = async () => {
      if (code.value.trim().length !== 6) return void (state.textContent = t('Bitte den 6-stelligen Code vom Host eingeben.'));
      okBtn.disabled = true;
      try {
        result = await invoke<{ fingerprint: string; host: string }>('remote_pair_finish', { code: code.value.trim() });
        dlg.close();
      } catch (e) {
        state.textContent = (e as Error).message;
        state.classList.add('error');
        okBtn.disabled = false;
        code.select();
      }
    };
    okBtn.onclick = finish;
    code.addEventListener('keydown', (e) => e.key === 'Enter' && finish());
    const dlg = h('dialog', { class: 'remote-pair' },
      h('h3', {}, t('Mit anderem KizamuBeam koppeln')),
      state,
      fp,
      h('label', { class: 'remote-code-label' }, t('Code vom Host'), code),
      h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')), okBtn),
    );
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    dlg.addEventListener('close', () => {
      if (!result) void invoke('remote_pair_cancel').catch(() => {});
      dlg.remove();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    (async () => {
      try {
        const name = await invoke<string>('sync_machine_name').catch(() => '');
        const r = await invoke<{ fingerprint: string }>('remote_pair_begin', { host, port, name });
        state.textContent = t('Der Host zeigt jetzt einen 6-stelligen Code. Gib ihn hier ein.');
        fp.textContent = t('Fingerabdruck des Hosts: {fp}. Er steht auch in den Host-Einstellungen am anderen Rechner.', { fp: r.fingerprint });
        code.disabled = okBtn.disabled = false;
        code.focus();
      } catch (e) {
        state.textContent = (e as Error).message;
        state.classList.add('error');
      }
    })();
  });
}
