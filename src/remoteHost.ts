// Remote KizamuBeam, host side (issue #188): host mode settings, the pairing code, computing and running jobs
// that other computers send, and the job list. The connection itself is in src-tauri/src/remote.rs; it checks
// pairing and roles and hands the requests to this window ("remote-request").
import type { Editor } from './editor';
import { h } from './dom';
import { estimate, formatDuration, frameGCode, Job, prepareGCode } from './gcode';
import { airProblem } from './fluidnc';
import { loadGen } from './generators';
import { locale, t, tBackend, tn } from './i18n';
import { registerAsset } from './images';
import { bedProblem, device, JobSource, laserNotify, makeJob, onDeviceChange, runBlocker, runGCode } from './laser';
import { isTauri, machine, RemoteHostState } from './machine';
import { allObjs, bumpIds, leaves, PALETTE } from './model';
import { withFonts } from './fonts';
import { bundleFonts, bytesToBase64, docImgLayer, docLayer, fontLabel, HostSync, JobBundle, openBundle, RemoteJobInfo } from './remoteBundle';
import { sharedCameraJpeg, sharedCameras } from './cameraui';
import { library } from './materials';
import { DEVICE_LOCAL_FIELDS } from './syncCore';

interface HostInfo {
  enabled: boolean;
  port: number;
  name: string;
  shown_name: string;
  confirm: boolean;
  running: boolean;
  error: string | null;
  fingerprint: string;
  address: string | null;
}

interface ClientInfo {
  id: string;
  name: string;
  role: 'viewer' | 'operator';
  paired_at: number;
  connected: number;
  address: string;
}

interface Request {
  id: number;
  client: { id: string; name: string; role: string };
  method: string;
  params: Record<string, unknown>;
}

interface HostJob extends RemoteJobInfo {
  bundle: JobBundle;
}

/** Jobs kept on the host (in memory, until the app quits) */
const MAX_JOBS = 20;
const jobs: HostJob[] = [];
let nextJob = 1;
let info: HostInfo | null = null;
let clients: ClientInfo[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(tBackend(String(e)));
  }
}

const summary = (j: HostJob, withPreview: boolean): RemoteJobInfo => ({
  id: j.id, name: j.name, sender: j.sender, at: j.at, total: j.total, warnings: j.warnings, preview: withPreview ? j.preview : '',
});

function hostState(): RemoteHostState {
  const local = machine.connected && !machine.remote;
  return {
    machine: { connected: local, where: local ? machine.where : '', device: device.name, fw: device.fw, bedW: device.bedW, bedH: device.bedH, running: local && machine.running },
    progress: local ? machine.progress : null,
    // without previews: the state goes to every client on each change
    jobs: jobs.map((j) => summary(j, false)),
    confirm: !!info?.confirm,
  };
}

let lastState = '';
function pushState() {
  if (!info?.running) return;
  const st = hostState();
  // Progress itself reaches clients as machine events; the state only changes when a job starts or ends
  const key = JSON.stringify({ ...st, progress: !!st.progress });
  if (key === lastState) return;
  lastState = key;
  void invoke('remote_host_state', { value: st }).catch(() => {});
}

// ---------- Computing jobs ----------

/** One computation at a time: the sender's fonts temporarily replace the installed ones (withFonts) */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

/** Job from a bundle with this computer's device, position and settings */
const computeJob = (ed: Editor, b: JobBundle) => serial(() => computeJobNow(ed, b));
async function computeJobNow(ed: Editor, b: JobBundle): Promise<{ job: Job; warnings: string[] }> {
  const { doc, only, assets } = openBundle(b);
  for (const [id, url] of Object.entries(assets)) if (typeof url === 'string') registerAsset(id, url);
  bumpIds(allObjs(doc));
  for (const [leaf] of leaves(allObjs(doc))) if (leaf.shape.kind === 'gen') loadGen(leaf.shape);
  const { files, missing } = bundleFonts(b);
  const src: JobSource = { doc, layer: docLayer(doc), imgLayer: docImgLayer(doc), name: b.name || 'KizamuBeam', color: (i) => PALETTE[i] ?? '#000', only };
  const job = await withFonts(files, () => makeJob(ed, false, src));
  if (!job.moves.n) throw new Error(only ? t('Nichts zu lasern: Die Auswahl ist leer oder liegt nur auf Layern ohne Ausgabe.') : t('Nichts zu lasern: Keine Objekte auf Layern mit Ausgabe.'));
  const warnings = [...job.warnings];
  if (missing.length) warnings.push(t('Schriften fehlen beim Absender, der Host nimmt seine eigenen: {list}', { list: missing.map(fontLabel).join(', ') }));
  const bed = bedProblem(ed, job);
  if (bed) warnings.push(bed.replace(/\n/g, ' '));
  const air = job.air.length && machine.fluid ? airProblem(machine.fluid.values, device.airCmd) : null;
  if (air) warnings.push(air);
  return { job, warnings };
}

/** Small preview of the burn moves on the work area, as PNG */
function jobPreview(job: Job, bed: { w: number; h: number }): string {
  const W = 480, H = 320;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  if (!c) return '';
  const tb = job.travel;
  const x0 = Math.min(0, tb?.x0 ?? 0), y0 = Math.min(0, tb?.y0 ?? 0);
  const x1 = Math.max(bed.w, tb?.x1 ?? 0), y1 = Math.max(bed.h, tb?.y1 ?? 0);
  const z = Math.min((W - 16) / (x1 - x0), (H - 16) / (y1 - y0));
  const ox = (W - (x1 - x0) * z) / 2, oy = (H - (y1 - y0) * z) / 2;
  const sx = (x: number) => ox + (x - x0) * z, sy = (y: number) => H - oy - (y - y0) * z;
  c.fillStyle = '#ffffff';
  c.fillRect(sx(0), sy(bed.h), bed.w * z, bed.h * z);
  c.strokeStyle = '#b0b0b0';
  c.strokeRect(sx(0), sy(bed.h), bed.w * z, bed.h * z);
  const mv = job.moves;
  const paths = new Map<number, Path2D>();
  let px = mv.x0, py = mv.y0;
  for (let i = 0; i < mv.n; i++) {
    if (mv.f[i] > 0 && mv.s[i] > 0) {
      let p = paths.get(mv.layer[i]);
      if (!p) paths.set(mv.layer[i], (p = new Path2D()));
      p.moveTo(sx(px), sy(py));
      p.lineTo(sx(mv.x[i]), sy(mv.y[i]));
    }
    px = mv.x[i];
    py = mv.y[i];
  }
  c.lineWidth = 1;
  for (const [l, p] of paths) {
    c.strokeStyle = PALETTE[l] ?? '#000';
    c.stroke(p);
  }
  return cv.toDataURL('image/png');
}

async function submitJob(ed: Editor, b: JobBundle, sender: string): Promise<HostJob> {
  const { job, warnings } = await computeJob(ed, b);
  const j: HostJob = {
    id: nextJob++, name: b.name || 'KizamuBeam', sender, at: Date.now(), total: estimate(job.moves, device).total, warnings,
    preview: jobPreview(job, ed.doc.bed), bundle: b,
  };
  jobs.unshift(j);
  jobs.length = Math.min(jobs.length, MAX_JOBS);
  changed();
  pushState();
  return j;
}

/** Start a job from the list: computed again (position and settings may have changed since) */
async function startHostJob(ed: Editor, j: HostJob, sender: string | null): Promise<void> {
  const blocked = () => {
    if (machine.remote) return t('Dieser Rechner ist selbst nur Client eines anderen KizamuBeam.');
    return runBlocker();
  };
  let why = blocked();
  if (why) throw new Error(why);
  if (sender && info?.confirm) {
    if (!(await confirmOnHost(j, sender))) throw new Error(t('Am Host abgelehnt.'));
    why = blocked();
    if (why) throw new Error(why);
  }
  const { job, warnings } = await computeJob(ed, j.bundle);
  j.warnings = warnings;
  const est = estimate(job.moves, device);
  j.total = est.total;
  const g = await prepareGCode(job, device, est, j.name);
  if (!(await runGCode(g))) throw new Error(t('Der Auftrag konnte nicht gestartet werden. Details stehen in der Konsole des Hosts.'));
  laserNotify(sender
    ? t('Fernauftrag „{name}“ von {sender} gestartet, geschätzt {total}.', { name: j.name, sender, total: formatDuration(est.total) })
    : t('Auftrag „{name}“ gestartet, geschätzt {total}.', { name: j.name, total: formatDuration(est.total) }));
  changed();
  pushState();
}

async function frameRemote(ed: Editor, b: JobBundle, contour: boolean) {
  const why = machine.remote ? t('Dieser Rechner ist selbst nur Client eines anderen KizamuBeam.') : runBlocker();
  if (why) throw new Error(why);
  const { doc, only, assets } = openBundle(b);
  for (const [id, url] of Object.entries(assets)) if (typeof url === 'string') registerAsset(id, url);
  const src: JobSource = { doc, layer: docLayer(doc), imgLayer: docImgLayer(doc), name: b.name, color: () => '#000', only };
  const job = await serial(() => withFonts(bundleFonts(b).files, () => makeJob(ed, false, src)));
  const lines = frameGCode(job, device, contour);
  if (!lines) throw new Error(t('Nichts zu lasern: Keine Objekte auf Layern mit Ausgabe.'));
  const bed = bedProblem(ed, job);
  if (bed) throw new Error(bed.replace(/\n/g, ' '));
  if (!(await machine.runJob(lines, null, true))) throw new Error(t('Der Auftrag konnte nicht gestartet werden. Details stehen in der Konsole des Hosts.'));
}

/** Host setting "confirm remote job starts": ask the person at the laser */
function confirmOnHost(j: HostJob, sender: string): Promise<boolean> {
  return new Promise((resolve) => {
    let ok = false;
    const dlg = h('dialog', { class: 'remote-confirm' },
      h('h3', {}, t('Fernauftrag von {sender}', { sender })),
      h('p', { class: 'note' }, t('Ein anderer Rechner möchte diesen Auftrag am Laser starten. Es passiert nichts, bevor du bestätigst.')),
      j.preview ? h('img', { class: 'remote-preview', src: j.preview, alt: '' }) : '',
      h('dl', { class: 'remote-facts' }, h('dt', {}, t('Name')), h('dd', {}, j.name), h('dt', {}, t('Geschätzte Dauer')), h('dd', {}, formatDuration(j.total))),
      ...(j.warnings.length ? [h('ul', { class: 'remote-warnings' }, ...j.warnings.map((w) => h('li', {}, w)))] : []),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => dlg.close() }, t('Ablehnen')),
        h('button', { class: 'btn primary', onclick: () => ((ok = true), dlg.close()) }, t('Job starten'))),
    );
    const timer = window.setTimeout(() => dlg.open && dlg.close(), 5 * 60_000);
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    dlg.addEventListener('close', () => {
      clearTimeout(timer);
      dlg.remove();
      resolve(ok);
    });
    document.body.append(dlg);
    dlg.showModal();
    (dlg.querySelector('.dialog-buttons .btn') as HTMLElement).focus();
    void attention();
  });
}

async function attention() {
  try {
    const { getCurrentWindow, UserAttentionType } = await import('@tauri-apps/api/window');
    await getCurrentWindow().requestUserAttention(UserAttentionType.Critical);
  } catch {
    /* not allowed or not supported */
  }
}

const findJob = (id: unknown) => {
  const j = jobs.find((x) => x.id === Number(id));
  if (!j) throw new Error(t('Diesen Auftrag gibt es am Host nicht mehr.'));
  return j;
};

/** Requests from clients (role already checked in Rust) */
async function handle(ed: Editor, r: Request): Promise<unknown> {
  const p = r.params ?? {};
  const needMachine = () => {
    if (!machine.connected || machine.remote) throw new Error(t('Der Host ist gerade nicht mit dem Laser verbunden.'));
  };
  switch (r.method) {
    case 'line':
      needMachine();
      if (machine.busy) throw new Error(t('Während ein Job läuft, sind keine Befehle möglich.'));
      await machine.send(String(p.line ?? ''));
      return null;
    case 'realtime':
      needMachine();
      await machine.realtime(Number(p.byte));
      return null;
    case 'pause':
      needMachine();
      machine.log(t('{name} hält den Job an.', { name: r.client.name }));
      await machine.pause();
      return null;
    case 'resume':
      needMachine();
      await machine.resume();
      return null;
    case 'stop':
      needMachine();
      machine.log(t('{name} hat Stopp gedrückt.', { name: r.client.name }), 'error');
      await machine.stop();
      return null;
    case 'jobs':
      return jobs.map((j) => summary(j, true));
    case 'job_submit': {
      needMachine();
      const j = await submitJob(ed, p.bundle as JobBundle, r.client.name);
      machine.log(t('Fernauftrag „{name}“ von {sender} empfangen.', { name: j.name, sender: r.client.name }));
      return { ...summary(j, true), confirm: !!info?.confirm };
    }
    case 'job_start':
      needMachine();
      await startHostJob(ed, findJob(p.id), r.client.name);
      return null;
    case 'frame':
      needMachine();
      await frameRemote(ed, p.bundle as JobBundle, !!p.contour);
      return null;
    // Stage 2: cameras and settings to take over
    case 'cameras':
      return sharedCameras();
    case 'camera_frame': {
      const jpeg = await sharedCameraJpeg(String(p.cam ?? ''));
      return { data: bytesToBase64(new Uint8Array(await jpeg.arrayBuffer())) };
    }
    case 'sync':
      return hostSync();
  }
  throw new Error(t('Unbekannte Anfrage: {method}', { method: r.method }));
}

/** Settings a client can take over: the current device (without connection details), materials, cameras */
function hostSync(): HostSync {
  const d: Record<string, unknown> = structuredClone({ ...device });
  for (const f of ['id', ...DEVICE_LOCAL_FIELDS]) delete d[f];
  return { device: d, materials: structuredClone(library.entries), cameras: sharedCameras() };
}

// ---------- Start ----------

let pairDlg: HTMLDialogElement | null = null;

/** When the window starts: answer remote requests and keep clients up to date */
export async function startRemoteHost(ed: Editor) {
  if (!isTauri()) return;
  const { listen } = await import('@tauri-apps/api/event');
  await listen<Request>('remote-request', async (e) => {
    let response: object;
    try {
      response = { result: (await handle(ed, e.payload)) ?? null };
    } catch (err) {
      response = { error: err instanceof Error ? err.message : String(err) };
    }
    await invoke('remote_respond', { id: e.payload.id, response }).catch(() => {});
  });
  await listen<{ name: string; code: string }>('remote-pairing', (e) => showPairingCode(e.payload.name, e.payload.code));
  await listen<{ ok: boolean; name: string }>('remote-pairing-end', (e) => {
    pairDlg?.close();
    if (e.payload.ok) machine.log(t('{name} ist jetzt mit diesem Rechner gekoppelt.', { name: e.payload.name }));
  });
  await listen<ClientInfo[]>('remote-clients', (e) => {
    clients = e.payload;
    // a new client gets the current state with its welcome; the next change goes to everyone
    lastState = '';
    pushState();
    changed();
  });
  machine.on((e) => {
    if (e.type === 'connection' || e.type === 'progress' || e.type === 'done') pushState();
  });
  onDeviceChange(pushState);
  await refreshInfo();
}

async function refreshInfo() {
  info = await invoke<HostInfo>('remote_host_info').catch(() => null);
  clients = info?.running ? await invoke<ClientInfo[]>('remote_host_clients').catch(() => []) : [];
  lastState = '';
  pushState();
  changed();
}

function showPairingCode(name: string, code: string) {
  pairDlg?.close();
  const role = h('select', { onchange: (e: Event) => void invoke('remote_pairing_role', { role: (e.target as HTMLSelectElement).value }) },
    h('option', { value: 'operator' }, t('Bediener (darf den Laser steuern)')),
    h('option', { value: 'viewer' }, t('Zuschauer (sieht nur zu)')),
  );
  const dlg = h('dialog', { class: 'remote-pair' },
    h('h3', {}, t('Kopplung mit {name}', { name: name || t('unbekanntem Rechner') })),
    h('p', { class: 'note' }, t('Gib diesen Code am anderen Rechner ein. Nur wer ihn kennt, kann sich mit diesem Laser verbinden.')),
    h('div', { class: 'remote-code' }, `${code.slice(0, 3)} ${code.slice(3)}`),
    h('label', { class: 'remote-role' }, t('Rolle'), role),
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => (void invoke('remote_pairing_cancel').catch(() => {}), dlg.close()) }, t('Abbrechen'))),
  ) as HTMLDialogElement;
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => {
    if (pairDlg === dlg) pairDlg = null;
    dlg.remove();
  });
  pairDlg = dlg;
  document.body.append(dlg);
  dlg.showModal();
  void attention();
}

// ---------- Status bar, settings, job list ----------

/** Hint in the status bar while host mode is on; click opens the settings */
export function remoteHostStatus(ed: Editor): HTMLElement {
  const el = h('button', { class: 'agent-status remote-status', hidden: true, onclick: () => openRemoteHostDialog(ed) });
  const fill = () => {
    el.hidden = !info?.enabled;
    el.classList.toggle('error', !!info?.error);
    const n = clients.reduce((s, c) => s + c.connected, 0);
    el.textContent = n ? tn('Host-Modus · {n} verbunden|one', 'Host-Modus · {n} verbunden', n) : t('Host-Modus');
    el.title = info?.error ? tBackend(info.error) : t('Andere Rechner können diesen Laser steuern oder zusehen');
  };
  listeners.add(fill);
  fill();
  return el;
}

export async function openRemoteHostDialog(ed: Editor) {
  if (!isTauri()) {
    alert(t('Die Maschinenanbindung gibt es nur in der Desktop-App.'));
    return;
  }
  await refreshInfo();
  const enabled = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const name = h('input', { type: 'text', maxlength: '80' }) as HTMLInputElement;
  const port = h('input', { type: 'number', min: '1024', max: '65535' }) as HTMLInputElement;
  const confirmBox = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const state = h('div', { class: 'agent-state' });
  const fp = h('p', { class: 'note remote-fp' });
  const table = h('table', { class: 'remote-clients' });

  const apply = async () => {
    try {
      info = await invoke<HostInfo>('remote_host_configure', { enabled: enabled.checked, port: Number(port.value) || 47900, name: name.value.trim(), confirm: confirmBox.checked });
    } catch (e) {
      alert((e as Error).message);
    }
    await refreshInfo();
  };
  enabled.onchange = port.onchange = name.onchange = confirmBox.onchange = apply;

  const fill = () => {
    if (!info) return;
    enabled.checked = info.enabled;
    if (document.activeElement !== name) name.value = info.name;
    name.placeholder = info.shown_name;
    if (document.activeElement !== port) port.value = String(info.port);
    confirmBox.checked = info.confirm;
    state.classList.toggle('error', !!info.error);
    state.textContent = info.error
      ? tBackend(info.error)
      : info.enabled
        ? t('Läuft. Andere Rechner verbinden sich mit {address}, Port {port}.', { address: info.address ?? t('der Adresse dieses Rechners'), port: info.port })
        : t('Aus. Kein anderer Rechner kann diesen Laser erreichen.');
    fp.textContent = info.fingerprint ? t('Fingerabdruck: {fp}', { fp: info.fingerprint }) : '';
    table.replaceChildren(
      h('tr', {}, h('th', {}, t('Rechner')), h('th', {}, t('Rolle')), h('th', {}, t('Verbunden')), h('th', {})),
      ...(clients.length
        ? clients.map((c) => h('tr', {},
            h('td', { title: t('Gekoppelt am {date}', { date: new Date(c.paired_at * 1000).toLocaleDateString(locale) }) }, c.name || '—'),
            h('td', {}, h('select', {
              onchange: async (e: Event) => {
                clients = await invoke<ClientInfo[]>('remote_host_client_role', { id: c.id, role: (e.target as HTMLSelectElement).value }).catch(() => clients);
                fill();
              },
            }, h('option', { value: 'operator', selected: c.role === 'operator' }, t('Bediener')), h('option', { value: 'viewer', selected: c.role === 'viewer' }, t('Zuschauer')))),
            h('td', {}, c.connected ? c.address || t('ja') : t('nein')),
            h('td', {}, h('button', {
              class: 'btn small',
              onclick: async () => {
                if (!confirm(t('Kopplung mit {name} aufheben? Der Rechner muss sich danach neu koppeln.', { name: c.name }))) return;
                clients = await invoke<ClientInfo[]>('remote_host_client_remove', { id: c.id }).catch(() => clients);
                fill();
              },
            }, t('Entfernen')))))
        : [h('tr', {}, h('td', { colspan: '4', class: 'note' }, t('Noch kein Rechner gekoppelt.')))]),
    );
  };
  listeners.add(fill);

  const dlg = h('dialog', { class: 'agent-dialog remote-dialog' },
    h('h3', {}, t('Host-Modus')),
    h('p', { class: 'note' }, t('Andere Rechner mit KizamuBeam können diesen Laser über das Heimnetz oder ein VPN steuern oder zusehen. Sie schicken das Projekt, dieser Rechner berechnet den G-Code mit seinem Gerät und lasert. Wer hier am Laser steht, kann jederzeit pausieren oder stoppen.')),
    h('label', { class: 'check' }, enabled, t('Host-Modus einschalten')),
    state,
    h('div', { class: 'form' },
      h('label', {}, t('Name')), name,
      h('label', {}, t('Port')), port,
    ),
    h('label', { class: 'check' }, confirmBox, t('Fernstarts an diesem Rechner bestätigen')),
    fp,
    h('p', { class: 'note' }, t('Koppeln: Am anderen Rechner ein Gerät mit dem Anschluss „Anderer KizamuBeam“ anlegen, die Adresse dieses Rechners eintragen und „Koppeln …“ wählen. Hier erscheint dann ein Code.')),
    h('h3', {}, t('Gekoppelte Rechner')),
    table,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => openRemoteJobsDialog(ed) }, t('Fernaufträge …')),
      h('button', { class: 'btn primary', onclick: () => dlg.close() }, t('Schließen'))),
  );
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => {
    listeners.delete(fill);
    dlg.remove();
  });
  document.body.append(dlg);
  fill();
  dlg.showModal();
}

/** Jobs other computers sent: start again, open in the editor, remove */
export function openRemoteJobsDialog(ed: Editor) {
  const list = h('div', { class: 'remote-jobs' });
  const msg = h('div', { class: 'note' });
  const fill = () => {
    list.replaceChildren(
      ...(jobs.length
        ? jobs.map((j) => {
            const start = h('button', {
              class: 'btn small',
              onclick: async () => {
                start.disabled = true;
                msg.classList.remove('error');
                msg.textContent = '';
                try {
                  await startHostJob(ed, j, null);
                  dlg.close();
                } catch (e) {
                  msg.textContent = (e as Error).message;
                  msg.classList.add('error');
                  start.disabled = false;
                }
              },
            }, t('Starten')) as HTMLButtonElement;
            return h('div', { class: 'remote-job' },
              j.preview ? h('img', { src: j.preview, alt: '' }) : h('div', {}),
              h('div', { class: 'remote-job-text' },
                h('b', {}, j.name),
                h('div', { class: 'note' }, t('von {sender}, {time}', { sender: j.sender, time: new Date(j.at).toLocaleTimeString(locale) }) + ' · ' + formatDuration(j.total)),
                ...(j.warnings.length ? [h('div', { class: 'note error', title: j.warnings.join('\n') }, tn('{n} Warnung', '{n} Warnungen', j.warnings.length))] : [])),
              h('div', { class: 'remote-job-buttons' },
                start,
                h('button', {
                  class: 'btn small',
                  title: t('Als normales Projekt in einem neuen Tab öffnen; Änderungen gehen nicht an den Absender zurück'),
                  onclick: () => {
                    ed.openInTab(j.bundle.project, j.name);
                    dlg.close();
                  },
                }, t('Im Editor öffnen')),
                h('button', {
                  class: 'btn small',
                  onclick: () => {
                    jobs.splice(jobs.indexOf(j), 1);
                    changed();
                    pushState();
                  },
                }, t('Entfernen'))));
          })
        : [h('p', { class: 'note' }, t('Noch keine Aufträge von anderen Rechnern.'))]),
    );
  };
  listeners.add(fill);
  const dlg = h('dialog', { class: 'remote-jobs-dialog' },
    h('h3', {}, t('Fernaufträge')),
    h('p', { class: 'note' }, t('Aufträge, die andere Rechner geschickt haben (die letzten 20, bis KizamuBeam beendet wird). Beim Starten wird der Auftrag mit den aktuellen Geräteeinstellungen neu berechnet.')),
    list,
    msg,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn primary', onclick: () => dlg.close() }, t('Schließen'))),
  );
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => {
    listeners.delete(fill);
    dlg.remove();
  });
  document.body.append(dlg);
  fill();
  dlg.showModal();
}
