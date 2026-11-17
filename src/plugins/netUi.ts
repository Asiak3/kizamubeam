// The app side of plugin network access (#280): the question before a plugin's first request, and the transport
// (the Rust backend in the app, the browser's fetch without credentials in the browser build).
import { h, showDialog } from '../dom';
import { lang, t } from '../i18n';
import { isTauri } from '../machine';
import { pluginText, type PluginManifest } from './manifest';
import { setNetConsent, setNetTransport, type Transport } from './net';

/** The servers of a plugin with what it gets from each (for the question and the install dialog) */
export function netHostList(m: PluginManifest): HTMLElement {
  return h('ul', { class: 'pack-contents' },
    ...(m.network ?? []).map((x) => h('li', {}, h('b', {}, x.hostname), ` · ${pluginText(m.texts, lang, x.purpose) ?? x.purpose}`, x.attribution ? h('span', { class: 'muted' }, ` (${x.attribution})`) : '')));
}

function askConsent(m: PluginManifest): Promise<boolean> {
  return new Promise((resolve) => {
    let ok = false;
    const name = pluginText(m.texts, lang, 'name') ?? m.id;
    const dlg = h('dialog', { class: 'packs-dialog' },
      h('h3', {}, t('Daten aus dem Internet laden?')),
      h('p', {}, t('Die Erweiterung „{name}“ möchte Daten von diesen Servern laden:', { name })),
      netHostList(m),
      h('p', { class: 'note' }, t('KizamuBeam stellt die Anfragen selbst, ohne Cookies und Anmeldedaten, und nur an diese Server. Die Erweiterung sieht nur die Antworten. Im Fenster „Erweiterungen“ lässt sich das jederzeit ändern.')),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => dlg.close() }, t('Nicht erlauben')),
        h('button', { class: 'btn primary', onclick: () => ((ok = true), dlg.close()) }, t('Erlauben')),
      ),
    ) as HTMLDialogElement;
    showDialog(dlg, () => resolve(ok));
  });
}

/** In the app: the request runs in Rust (no cookies, no redirects, no local addresses) */
const tauriTransport: Transport = async (r) => {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const res = await invoke<{ status: number; contentType: string; body: string }>('plugin_fetch', { req: r });
    const bin = atob(res.body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { status: res.status, contentType: res.contentType, bytes };
  } catch (e) {
    throw new Error(/^net-[a-z-]+$/.test(String(e)) ? String(e) : 'net-failed');
  }
};

/** In the browser: fetch without credentials, referrer or redirects, with a size and time limit */
const browserTransport: Transport = async (r) => {
  let res: Response;
  try {
    res = await fetch(r.url, { method: r.method, body: r.body, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(r.timeoutMs), ...(r.body !== undefined ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } : {}) });
  } catch {
    throw new Error('net-failed');
  }
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > r.maxBytes) throw new Error('net-too-large');
  const reader = res.body?.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > r.maxBytes) {
      void reader.cancel();
      throw new Error('net-too-large');
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(n);
  let o = 0;
  for (const p of parts) (bytes.set(p, o), (o += p.length));
  return { status: res.status, contentType: res.headers.get('content-type') ?? '', bytes };
};

export function initPluginNet() {
  setNetConsent(askConsent);
  setNetTransport(isTauri() ? tauriTransport : browserTransport);
}
