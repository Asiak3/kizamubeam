// Remote KizamuBeam, client side (issue #188): pairing with a host, sending jobs to it and showing its answer
// (preview, estimated time, warnings) before the laser starts. The host computes the G-code itself.
import type { Editor } from './editor';
import type { JobSource } from './laser';
import { h } from './dom';
import { formatDuration } from './gcode';
import { t, tBackend, tn } from './i18n';
import { assetUrl } from './images';
import { isTauri, machine } from './machine';
import { base64ToBytes, REMOTE_PROTO, BundleFont, bytesToBase64, deviceDifferences, fontLabel, fontsUsed, HostSync, JobBundle, MAX_BUNDLE, sourceProject } from './remoteBundle';
import { hostCameraSource } from './camera';
import { FIRMWARES, type Device, type Firmware } from './gcode';
import { sanitizeEntry, type MaterialEntry } from './materials';
import { DEVICE_LOCAL_FIELDS } from './syncCore';

// Images of host cameras come through the remote connection (camera address kizamubeam:<id>)
hostCameraSource.frame = async (cam) => {
  const r = await machine.remoteRequest<{ data: string }>('camera_frame', { cam });
  const b = base64ToBytes(r.data);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

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

/** A KizamuBeam host found on the network (src-tauri/src/remote.rs, remote_discover) */
export interface FoundHost {
  name: string;
  host: string;
  port: number;
  fingerprint: string;
  shown: string;
  mdns: boolean;
  paired: boolean;
  proto: number;
}

/**
 * Search the local network for computers in host mode (mDNS and the own network on the port) and let the
 * person pick one. Resolves with the chosen host or null.
 */
export function openHostDiscovery(port: number): Promise<FoundHost | null> {
  return new Promise((resolve) => {
    if (!isTauri()) {
      alert(t('Die Maschinenanbindung gibt es nur in der Desktop-App.'));
      return resolve(null);
    }
    let result: FoundHost | null = null;
    const list = h('div', { class: 'remote-found' });
    const note = h('p', { class: 'note' }, t('Suche im Netzwerk … (einige Sekunden)'));
    const dlg = h('dialog', { class: 'remote-discover' },
      h('h3', {}, t('KizamuBeam-Hosts im Netzwerk')),
      h('p', { class: 'note' }, t('Gefunden werden Rechner, auf denen der Host-Modus läuft: per mDNS und an allen Adressen des eigenen Netzes auf Port {port}. Über ein VPN die Adresse von Hand eintragen. macOS fragt beim ersten Mal nach dem Zugriff auf das lokale Netzwerk.', { port })),
      list,
      note,
      h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen'))),
    );
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    document.body.append(dlg);
    dlg.showModal();
    invoke<FoundHost[]>('remote_discover', { port })
      .then((found) => {
        note.textContent = found.length ? '' : t('Kein Host gefunden. Läuft am Rechner mit dem Laser der Host-Modus (Laser → Fernsteuerung → Host-Modus …) und ist er im selben Netz?');
        for (const f of found) {
          const other = f.proto !== REMOTE_PROTO;
          list.append(h('div', { class: 'remote-found-row' },
            h('div', { class: 'grow' },
              h('b', {}, f.name || f.host),
              h('div', { class: 'note' }, `${f.host}:${f.port}`, f.paired ? ` · ${t('gekoppelt')}` : '', other ? ` · ${t('andere Version')}` : ''),
              h('div', { class: 'note remote-fp' }, f.shown)),
            h('button', { class: 'btn small primary', disabled: other, title: other ? t('Host und dieser Rechner verwenden verschiedene Protokollversionen. Bitte beide KizamuBeam auf dieselbe Version bringen.') : '', onclick: () => ((result = f), dlg.close()) }, t('Übernehmen')),
          ));
        }
      })
      .catch((e) => {
        note.textContent = (e as Error).message;
        note.classList.add('error');
      });
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

/**
 * Take over settings from the host (stage 2 of issue #188): its device settings for the current device (name
 * and connection stay), its material library (merged) and its cameras (calibration from the host, the image
 * through the connection).
 */
export async function openHostSyncDialog(ed: Editor) {
  const { device, laserNotify, patchDevice } = await import('./laser');
  if (!machine.remote) return laserNotify(t('Erst mit dem Host verbinden (Anschluss „Anderer KizamuBeam (Netzwerk)“).'), true);
  const host = machine.remote.host;
  let r: HostSync;
  try {
    r = await machine.remoteRequest<HostSync>('sync');
  } catch (e) {
    return laserNotify((e as Error).message, true);
  }
  const { importHostCameras } = await import('./cameraui');
  const { library } = await import('./materials');
  const hd = r.device as Partial<Device>;
  const diff = deviceDifferences(r.device, device as unknown as Record<string, unknown>, DEVICE_LOCAL_FIELDS);
  const materials = (Array.isArray(r.materials) ? r.materials : []).map(sanitizeEntry).filter(Boolean) as MaterialEntry[];
  const cameras = Array.isArray(r.cameras) ? r.cameras : [];
  const fwLabel = FIRMWARES[hd.fw as Firmware]?.label ?? String(hd.fw ?? '');
  const choice = (checked: boolean, disabled: boolean, title: string, detail: string) => {
    const cb = h('input', { type: 'checkbox', checked: checked && !disabled, disabled }) as HTMLInputElement;
    return { cb, row: h('label', { class: 'sync-section' }, cb, h('span', {}, h('b', {}, title), h('br'), h('small', { class: 'muted' }, detail))) };
  };
  const dev = choice(diff.length > 0, !diff.length, t('Geräteeinstellungen'),
    (diff.length
      ? tn('{n} Einstellung weicht ab', '{n} Einstellungen weichen ab', diff.length)
      : t('Gleich wie hier')) + ` · ${fwLabel} · ${hd.bedW ?? '?'} × ${hd.bedH ?? '?'} mm. ` + t('Name und Verbindung bleiben.'));
  const mat = choice(materials.length > 0, !materials.length, t('Material-Bibliothek'),
    tn('{n} Eintrag', '{n} Einträge', materials.length) + '. ' + t('Gleiche Material/Dicke/Titel-Kombinationen werden ersetzt, eigene Einträge bleiben.'));
  const cam = choice(cameras.length > 0, !cameras.length, t('Kameras'),
    (cameras.length ? cameras.map((c) => c.name).join(', ') : t('Keine')) + '. ' + t('Kalibrierung vom Host, das Bild kommt über die Verbindung.'));
  const ok = h('button', { class: 'btn primary' }, t('Übernehmen')) as HTMLButtonElement;
  const dlg = h('dialog', { class: 'remote-sync' },
    h('h3', {}, t('Vom Host übernehmen: {host}', { host })),
    h('p', { class: 'note' }, t('Für Gerät „{device}“ auf diesem Rechner. Der Host berechnet Aufträge ohnehin mit seinen eigenen Einstellungen; übernommen sehen Arbeitsfläche, Vorschau und Material-Auswahl hier genauso aus.', { device: device.name })),
    h('div', { class: 'sync-sections' }, dev.row, mat.row, cam.row),
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')), ok),
  );
  ok.onclick = () => {
    const done: string[] = [];
    if (dev.cb.checked) {
      const patch: Record<string, unknown> = {};
      for (const k of diff) patch[k] = structuredClone(r.device[k]);
      patchDevice(ed, patch as Partial<Device>);
      done.push(tn('{n} Geräteeinstellung', '{n} Geräteeinstellungen', diff.length));
    }
    if (mat.cb.checked) {
      const m = library.merge(materials);
      done.push(t('Materialien: {added} neu, {replaced} ersetzt', { added: m.added, replaced: m.replaced }));
    }
    if (cam.cb.checked) {
      const c = importHostCameras(ed, cameras);
      done.push(t('Kameras: {added} neu, {updated} aktualisiert', { added: c.added, updated: c.updated }));
    }
    dlg.close();
    if (done.length) laserNotify(t('Vom Host übernommen: {list}', { list: done.join('; ') }));
  };
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

