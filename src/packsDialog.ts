// Fenster „Erweiterungen“ (Menü Datei): installierte Inhaltspakete zeigen, installieren und entfernen.
import { h, showDialog } from './dom';
import { openText } from './files';
import { entryLabel } from './materials';
import { FIRMWARES, LaserModule, LaserType } from './gcode';
import { Catalog, CatalogEntry, CatalogFetchProgress, catalogState, fetchCatalog, fetchCatalogPack } from './catalog';
import { version as APP_VERSION } from '../package.json';
import { lang, t, tn } from './i18n';
import {
  allPacks, brokenPacks, countSummary, ensurePacks, hasPackFolder, InstalledPack, installKind, installPack, localText, markVerified, openPackFolder, Pack, PACK_EXT, packSummary,
  packVerified, parsePack, removePack, restorePrevious, setPackDisabled, groupPresets, PresetFeature, PresetListEntry,
} from './packs';
import { pluginConflict, pluginProblems, testLoadPlugins } from './plugins/registry';
import { leaves, type Doc } from './model';
import { pluginText, type PluginManifest } from './plugins/manifest';
import { clearNetCache, netAllowed, netLog, netOff, setNetAllowed, setNetOff } from './plugins/net';
import { netHostList } from './plugins/netUi';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Bytegröße lesbar formatieren (B, KB, MB) */
export function formatPackBytes(bytes: number, locale = lang): string {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes)).toLocaleString(locale)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString(locale, { maximumFractionDigits: kb < 100 ? 1 : 0 })} KB`;
  const mb = kb / 1024;
  return `${mb.toLocaleString(locale, { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}

/** Fortschrittstext und Verhältnis (0..1 oder null für unbestimmt) beim Laden eines Katalogpakets */
export function catalogFetchStatus(name: string, progress: CatalogFetchProgress, locale = lang): { text: string; ratio: number | null } {
  if (progress.phase === 'verify') return { text: t('„{name}“ wird geprüft …', { name }), ratio: 1 };
  if (progress.total > 0 && progress.loaded > 0) {
    const ratio = Math.max(0, Math.min(1, progress.loaded / progress.total));
    const pct = Math.min(100, Math.round(ratio * 100));
    return {
      text: t('„{name}“ wird geladen … ({loaded} / {total} · {pct} %)', {
        name,
        loaded: formatPackBytes(progress.loaded, locale),
        total: formatPackBytes(progress.total, locale),
        pct,
      }),
      ratio,
    };
  }
  if (progress.loaded > 0) {
    return {
      text: t('„{name}“ wird geladen … ({loaded})', { name, loaded: formatPackBytes(progress.loaded, locale) }),
      ratio: null,
    };
  }
  return { text: t('„{name}“ wird geladen …', { name }), ratio: null };
}

interface ProgressBox {
  el: HTMLElement;
  show: (label: string, ratio?: number | null) => void;
  hide: () => void;
}

function createProgressBox(): ProgressBox {
  const text = h('div', { class: 'pack-progress-text', 'aria-live': 'polite' });
  const bar = h('progress', { class: 'pack-progress-bar', max: 1, value: 0 }) as HTMLProgressElement;
  const el = h('div', { class: 'pack-progress', hidden: true }, text, bar);
  return {
    el,
    show(label: string, ratio?: number | null) {
      el.hidden = false;
      text.textContent = label;
      if (typeof ratio === 'number' && Number.isFinite(ratio)) {
        bar.max = 1;
        bar.value = Math.max(0, Math.min(1, ratio));
      } else {
        bar.removeAttribute('value');
      }
    },
    hide() {
      el.hidden = true;
      text.textContent = '';
      bar.max = 1;
      bar.value = 0;
    },
  };
}

/** Eintrag der Auswahl „Neues Gerät aus Vorlage“; Vorlagen aus Erweiterungen nennen das Paket, die Quelle steht im Tooltip */
export function presetOption(p: PresetListEntry, i: number) {
  const label = `${p.preset.name} · ${FIRMWARES[p.preset.fw].label}${p.pack ? ` (${p.pack})` : ''}`;
  return h('option', { value: String(i), title: p.source ?? '' }, label);
}

/** Select „Neues Gerät aus Vorlage“, grouped by manufacturer; option values are indices into `presets` */
export function presetSelect(presets: PresetListEntry[]): HTMLSelectElement {
  const groups = groupPresets(presets, lang).map((g) =>
    h('optgroup', { label: g.vendor || (g.fromPack ? t('Aus Erweiterungen') : t('Allgemein|Gerätehersteller')) }, ...g.items.map(({ entry, index }) => presetOption(entry, index))),
  );
  return h('select', {}, ...groups) as HTMLSelectElement;
}

/** Name of a laser type for the interface */
export function laserTypeLabel(type: LaserType): string {
  return { diode: t('Diode'), ir: t('Infrarot (IR)'), co2: t('CO2'), fiber: t('Faser') }[type];
}

/** Laser module as short text, e.g. „10 W Diode · 455 nm“; empty when nothing is known */
export function laserText(m: LaserModule | undefined): string {
  if (!m) return '';
  const parts: string[] = [];
  const kind = [m.power !== undefined ? `${m.power.toLocaleString(lang)} W` : '', m.type ? laserTypeLabel(m.type) : ''].filter(Boolean).join(' ');
  if (kind) parts.push(kind);
  if (m.wavelength !== undefined) parts.push(`${m.wavelength} nm`);
  return parts.join(' · ');
}

function featureLabel(f: PresetFeature): string {
  return {
    'air-assist': t('Air Assist'),
    autofocus: t('Autofokus'),
    camera: t('Kamera'),
    enclosure: t('Gehäuse'),
    wifi: t('WLAN'),
    bluetooth: t('Bluetooth'),
    offline: t('Offline-Betrieb'),
  }[f];
}

/** Details of a preset below the select: laser, work area, equipment and where the values come from */
export function presetDetails(p: PresetListEntry | undefined): HTMLElement {
  const box = h('div', { class: 'note preset-details' });
  if (!p) return box;
  const d = p.preset;
  const facts: string[] = [t('{w} × {h} mm', { w: d.bedW!, h: d.bedH! })];
  const laser = laserText(d.laser);
  if (laser) facts.unshift(laser);
  if (d.zAxis) facts.push(t('Z-Achse'));
  if (p.features?.length) facts.push(...p.features.map(featureLabel));
  box.append(h('div', {}, facts.join(' · ')));
  const origin = p.measured ? t('Maße an einer Maschine gemessen') : t('Maße laut Hersteller oder Testbericht');
  const checked = p.checked ? t('geprüft am {date}', { date: p.checked }) : '';
  box.append(h('div', {}, [origin, checked].filter(Boolean).join(', ')));
  if (p.source || p.sourceUrl) box.append(h('div', { class: 'muted' }, t('Quelle: {source}', { source: [p.source, p.sourceUrl].filter(Boolean).join(' · ') })));
  return box;
}

/** Select plus details that follow the selection; option values are indices into `presets` */
export function presetPicker(presets: PresetListEntry[]): { select: HTMLSelectElement; details: HTMLElement } {
  const select = presetSelect(presets);
  const details = h('div', {});
  const show = () => details.replaceChildren(presetDetails(presets[Number(select.value)]));
  select.addEventListener('change', show);
  show();
  return { select, details };
}

/** Inhalt eines Pakets als Liste (Rückfrage beim Installieren) */
function contentList(p: Pack): HTMLElement {
  const ul = h('ul', { class: 'pack-contents' });
  for (const d of p.devices)
    ul.append(h('li', { title: d.source ?? '' }, t('Gerätevorlage: {name} · {fw}, {w} × {h} mm', { name: d.preset.name, fw: FIRMWARES[d.preset.fw].label, w: d.preset.bedW!, h: d.preset.bedH! })));
  for (const tp of p.templates) ul.append(h('li', {}, t('Vorlage: {name}', { name: tp.info.title })));
  for (const m of p.materials) ul.append(h('li', {}, t('Material: {name}', { name: entryLabel(m) })));
  for (const x of p.plugins)
    ul.append(h('li', {}, t('Plugin: {name} ({runtime})', { name: pluginText(x.texts, lang, 'name') ?? x.id, runtime: x.runtime === 'js' ? 'JavaScript' : 'WebAssembly' })));
  return ul;
}

/**
 * Paketdatei prüfen, Inhalt zeigen und nach Rückfrage installieren. Gibt das installierte Paket zurück oder null
 * (abgebrochen oder fehlerhaft; Fehler erscheinen als Meldung).
 */
export async function installPackFile(name: string, text: string, fromCatalog = false): Promise<Pack | null> {
  await ensurePacks();
  let p: Pack;
  try {
    p = parsePack(text);
  } catch (e) {
    alert(t('„{file}“ lässt sich nicht installieren: {message}', { file: name, message: errText(e) }));
    return null;
  }
  // A plugin must not take the id of a built-in generator or of another extension's plugin
  const clash = p.plugins.map((x) => pluginConflict(p, x.id)).find(Boolean);
  if (clash) {
    alert(t('„{file}“ lässt sich nicht installieren: {message}', { file: name, message: clash }));
    return null;
  }
  const { kind, old } = installKind(p);
  const status = {
    new: '',
    update: t('Ersetzt die installierte Version {old}.', { old: old?.version ?? '' }),
    same: t('Diese Version ist schon installiert und wird neu eingelesen.'),
    downgrade: t('Achtung: Installiert ist die neuere Version {old}. Sie wird durch diese ältere ersetzt.', { old: old?.version ?? '' }),
  }[kind];
  return new Promise((resolve) => {
    let result: Pack | null = null;
    const progress = createProgressBox();
    const err = h('p', { class: 'error' });
    const ok = h('button', { class: 'btn primary' }, kind === 'update' ? t('Aktualisieren') : t('Installieren')) as HTMLButtonElement;
    const cancel = h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')) as HTMLButtonElement;
    // Unsigned program code: the user confirms the source before Install becomes available
    let trust: HTMLElement | null = null;
    let trustBox: HTMLInputElement | null = null;
    if (p.plugins.length && !fromCatalog) {
      const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
      trustBox = box;
      box.onchange = () => (ok.disabled = !box.checked);
      ok.disabled = true;
      trust = h('label', { class: 'check' }, box, ' ', t('Ich vertraue der Quelle dieser Erweiterung'));
    }
    let busy = false;
    ok.onclick = async () => {
      if (busy) return;
      busy = true;
      ok.disabled = true;
      cancel.disabled = true;
      if (trustBox) trustBox.disabled = true;
      err.textContent = '';
      try {
        // Atomic: the new version is only written after its plugins started and answered
        if (p.plugins.length) {
          const totalSteps = p.plugins.length + 1;
          const bad = await testLoadPlugins(p, ({ index, total, plugin }) => {
            const pName = pluginText(plugin.texts, lang, 'name') ?? plugin.id;
            const label = total > 1
              ? t('Plugins werden geprüft ({step}/{total}): {name} …', { step: index + 1, total, name: pName })
              : t('Plugins werden geprüft …');
            progress.show(label, total > 1 ? index / totalSteps : null);
          });
          if (bad) throw new Error(bad);
          progress.show(t('„{name}“ wird installiert …', { name: p.name }), p.plugins.length / totalSteps);
        } else {
          progress.show(t('„{name}“ wird installiert …', { name: p.name }), null);
        }
        result = await installPack(text, { verified: fromCatalog });
        progress.show(t('„{name}“ wird installiert …', { name: p.name }), 1);
        dlg.close();
      } catch (e) {
        progress.hide();
        err.textContent = errText(e);
        busy = false;
        ok.disabled = trustBox ? !trustBox.checked : false;
        cancel.disabled = false;
        if (trustBox) trustBox.disabled = false;
      }
    };
    const dlg = h('dialog', { class: 'packs-dialog' },
      h('h3', {}, t('Erweiterung installieren')),
      h('p', {}, h('b', {}, p.name), ` ${p.version}`, p.author ? ` · ${p.author}` : ''),
      p.description ? h('p', { class: 'muted' }, p.description) : null,
      contentList(p),
      status ? h('p', { class: kind === 'downgrade' ? 'warn' : 'note' }, status) : null,
      p.plugins.length
        ? h('p', { class: fromCatalog ? 'note' : 'warn' }, fromCatalog
          ? t('Aus dem signierten KizamuBeam-Katalog. Die Erweiterung enthält Programmcode (Plugins). Er läuft abgeschottet: ohne Zugriff auf Dateien, Netzwerk und das Projekt, mit Zeit- und Speichergrenze. Prüfe die erzeugten Teile trotzdem vor dem ersten Job.')
          : t('Ungeprüfte Erweiterung mit Programmcode (Plugins). Diese Datei ist nicht signiert. Der Code läuft abgeschottet, ohne Zugriff auf Dateien, Netzwerk und das Projekt, kann aber falsche Teile erzeugen. Installiere sie nur, wenn du der Quelle vertraust.'))
        : h('p', { class: 'note' }, fromCatalog
          ? t('Aus dem signierten KizamuBeam-Katalog. Erweiterungen enthalten nur Daten, keinen Programmcode. Prüfe Maße und Laserwerte trotzdem vor dem ersten Job.')
          : t('Erweiterungen enthalten nur Daten, keinen Programmcode. Diese Datei ist nicht signiert: Installiere sie nur, wenn du der Quelle vertraust, und prüfe Maße und Laserwerte vor dem ersten Job.')),
      ...p.plugins.filter((x) => x.network?.length).flatMap((x) => [
        h('p', { class: 'warn' }, t('„{name}“ lädt Daten aus dem Internet. KizamuBeam fragt vor der ersten Anfrage und stellt sie selbst, nur an diese Server:', { name: pluginText(x.texts, lang, 'name') ?? x.id })),
        netHostList(x),
      ]),
      trust,
      progress.el,
      err,
      h('div', { class: 'dialog-buttons' }, ok, cancel),
    ) as HTMLDialogElement;
    dlg.addEventListener('cancel', (ev) => {
      if (busy) ev.preventDefault();
    });
    showDialog(dlg, () => resolve(result));
  });
}

/** Parts in the document made by plugins of this pack (they keep their shape but cannot be edited without it) */
export function partsUsing(doc: Doc | undefined, pack: Pack): number {
  if (!doc || !pack.plugins.length) return 0;
  const ids = new Set(pack.plugins.map((m) => m.id));
  let n = 0;
  for (const page of doc.pages) for (const [o] of leaves(page.objs)) if (o.shape.kind === 'gen' && ids.has(o.shape.gen)) n++;
  return n;
}

/** All network access of plugins off (#280) */
function netSwitch(): HTMLElement {
  const box = h('input', { type: 'checkbox', checked: netOff() }) as HTMLInputElement;
  box.onchange = () => setNetOff(box.checked);
  return h('label', { class: 'check note' }, box, ' ', t('Erweiterungen dürfen keine Daten aus dem Internet laden (offline)'));
}

type Filter = 'all' | 'content' | 'plugins' | 'templates' | 'materials' | 'assets';
const hasContent = (devices: number, templates: number, materials: number, assets: number) => devices + templates + materials + assets > 0;

/** Window „Extensions“: installed packs and the catalogue, with a search and a filter for content or plugins (#206) */
export async function openPacksDialog(doc?: Doc, opts?: { loadCatalog?: () => Promise<Catalog> }) {
  await ensurePacks();
  const list = h('div', { class: 'pack-list' });
  const catalogPanel = h('div', { class: 'pack-panel' });
  const installedPanel = h('div', { class: 'pack-panel' });
  const details = h('aside', { class: 'pack-details' });
  const err = h('p', { class: 'error' });
  const search = h('input', { type: 'search', placeholder: t('Suchen …'), class: 'pack-search' }) as HTMLInputElement;
  let filter: Filter = 'all';
  /** Whether an entry passes the search and the filter */
  const shown = (words: (string | undefined)[], plugins: number, devices: number, templates: number, materials: number, assets: number) => {
    if (filter === 'plugins' && !plugins) return false;
    if (filter === 'content' && !hasContent(devices, templates, materials, assets)) return false;
    if (filter === 'templates' && !templates) return false;
    if (filter === 'materials' && !materials) return false;
    if (filter === 'assets' && !assets) return false;
    const q = search.value.trim().toLowerCase();
    if (!q) return true;
    const hay = words.filter(Boolean).join(' ').toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  };
  const badge = (text: string, kind: string, title = '') => h('span', { class: `pack-badge ${kind}`, title }, text);
  const act = (f: () => Promise<unknown>) => async () => {
    err.textContent = '';
    try {
      await f();
    } catch (e) {
      err.textContent = errText(e);
    }
    fill();
    fillCatalog();
  };
  const selectCard = (card: HTMLElement, content: HTMLElement) => {
    content.querySelectorAll('.pack-card.selected').forEach((x) => x.classList.remove('selected'));
    card.classList.add('selected');
  };
  const card = (ip: InstalledPack) => {
    const { pack, file } = ip;
    const verified = packVerified(ip);
    const badges = [
      pack.plugins.length ? badge(t('Plugins'), 'plugins') : null,
      verified
        ? badge(t('Geprüft (Katalog)'), 'verified', t('Diese Datei stammt aus dem signierten KizamuBeam-Katalog.'))
        : pack.plugins.length
          ? badge(t('Ungeprüft'), 'unverified', t('Nicht aus dem signierten Katalog installiert.'))
          : null,
      ip.disabled ? badge(t('Ausgeschaltet'), 'off') : null,
      pack.plugins.some((x) => x.network?.length)
        ? badge(t('Netzwerk'), 'network', [...new Set(pack.plugins.flatMap((x) => (x.network ?? []).map((n) => n.hostname)))].join(', '))
        : null,
    ];
    const remove = async () => {
      const used = partsUsing(doc, pack);
      const msg = t('Erweiterung „{name}“ entfernen? Unveränderte Materialien daraus verschwinden aus der Bibliothek, Geräte und Projekte bleiben.', { name: pack.name });
      const extra = used ? '\n\n' + tn('Im offenen Projekt stammt {n} Teil aus dieser Erweiterung. Es behält seine Form, lässt sich ohne sie aber nicht mehr bearbeiten.', 'Im offenen Projekt stammen {n} Teile aus dieser Erweiterung. Sie behalten ihre Form, lassen sich ohne sie aber nicht mehr bearbeiten.', used) : '';
      if (!confirm(msg + extra)) return;
      await removePack(file);
    };
    const result = h('div', { class: 'pack-card' + (ip.disabled ? ' disabled' : ''), tabIndex: 0, onclick: () => {
      selectCard(result, list);
      showInstalledDetails(ip);
    } },
      h('div', { class: 'pack-text' },
        h('div', {}, h('b', {}, pack.name), ` ${pack.version}`, pack.author ? h('span', { class: 'muted' }, ` · ${pack.author}`) : null, ' ', ...badges),
        h('div', { class: 'muted' }, packSummary(pack)),
        pack.description ? h('div', {}, pack.description) : null,
        pack.homepage ? h('div', { class: 'muted pack-url' }, pack.homepage) : null,
        ...pack.plugins.filter((x) => x.network?.length).map(netRow),
      ),
      h('div', { class: 'pack-actions' },
        h('button', { class: 'btn small', onclick: act(() => setPackDisabled(pack.id, !ip.disabled)) }, ip.disabled ? t('Einschalten') : t('Ausschalten')),
        ip.previous
          ? h('button', { class: 'btn small', title: t('Die Version vor der letzten Installation wiederherstellen'), onclick: act(() => restorePrevious(pack.id)) }, t('Zurück auf {version}', { version: ip.previous }))
          : null,
        h('button', { class: 'btn small', onclick: act(remove) }, t('Entfernen')),
      ),
    );
    return result;
  };
  /** Network access of a plugin (#280): the switch, its servers and the requests of this session */
  const netRow = (m: PluginManifest) => {
    const box = h('input', { type: 'checkbox', checked: netAllowed(m) === true }) as HTMLInputElement;
    box.onchange = () => {
      setNetAllowed(m, box.checked);
      if (!box.checked) clearNetCache();
    };
    const requests = netLog(m.id);
    return h('div', { class: 'pack-net' },
      h('label', { class: 'check' }, box, ' ', t('„{name}“ darf Daten laden von: {hosts}', { name: pluginText(m.texts, lang, 'name') ?? m.id, hosts: (m.network ?? []).map((x) => x.hostname).join(', ') })),
      requests.length
        ? h('details', {},
            h('summary', {}, tn('{n} Anfrage in dieser Sitzung', '{n} Anfragen in dieser Sitzung', requests.length)),
            h('ul', { class: 'pack-contents' },
              ...requests.slice().reverse().map((r) => h('li', {}, `${new Date(r.time).toLocaleTimeString(lang)} ${r.method} ${r.host}${r.path} · ${r.error ?? r.status} · ${r.bytes.toLocaleString(lang)} B${r.cached ? ` · ${t('aus dem Zwischenspeicher')}` : ''}`)),
            ))
        : null,
    );
  };
  const showInstalledDetails = (ip: InstalledPack) => {
    detailsAction = null;
    const { pack } = ip;
    details.replaceChildren(
      h('h4', {}, pack.name),
      h('div', { class: 'muted' }, `${pack.version}${pack.author ? ` · ${pack.author}` : ''}`),
      h('p', { class: 'muted' }, packSummary(pack)),
      ...(pack.description ? [h('p', {}, pack.description)] : []),
      ...(pack.homepage ? [h('p', { class: 'pack-url muted' }, pack.homepage)] : []),
      h('div', { class: 'pack-details-actions' },
        h('button', { class: 'btn primary', onclick: act(() => setPackDisabled(pack.id, !ip.disabled)) }, ip.disabled ? t('Einschalten') : t('Ausschalten')),
        h('button', { class: 'btn', onclick: act(() => removePack(ip.file)) }, t('Entfernen')),
      ),
    );
  };
  const showCatalogDetails = (e: CatalogEntry) => {
    const name = localText(e.name);
    const st = stateOf(e);
    const label = {
      install: t('Installieren'),
      update: t('Auf {version} aktualisieren', { version: e.version }),
      installed: t('Installiert'),
      'newer-installed': t('Neuere Version installiert'),
      'needs-app': e.minApp ? t('Braucht KizamuBeam {version}', { version: e.minApp }) : t('Braucht eine neuere Version von KizamuBeam'),
    }[st];
    const canAct = st === 'install' || st === 'update';
    const action = h('button', { class: 'btn primary', disabled: !canAct || isBusy() }, busyId === e.id ? t('Wird geladen …') : label) as HTMLButtonElement;
    action.onclick = () => void fromCatalog(e);
    detailsAction = { id: e.id, button: action, label, canAct };
    details.replaceChildren(
      h('h4', {}, name),
      h('div', { class: 'muted' }, `${e.version}${e.author ? ` · ${e.author}` : ''}`),
      badge(t('Geprüft (Katalog)'), 'verified', t('Diese Datei stammt aus dem signierten KizamuBeam-Katalog.')),
      h('p', { class: 'muted' }, countSummary(e.devices, e.templates, e.materials, e.assets, e.plugins)),
      ...(localText(e.description) ? [h('p', {}, localText(e.description))] : []),
      ...(e.source ? [h('p', { class: 'pack-url muted' }, t('Quellcode: {url}', { url: e.source }))] : []),
      h('div', { class: 'pack-details-actions' }, action),
    );
  };
  const fill = () => {
    list.replaceChildren();
    for (const ip of allPacks()) {
      const p = ip.pack;
      if (shown([p.name, p.id, p.author, p.description], p.plugins.length, p.devices.length, p.templates.length, p.materials.length, p.assets.length)) list.append(card(ip));
    }
    for (const msg of pluginProblems()) list.append(h('p', { class: 'error' }, msg));
    for (const b of brokenPacks())
      list.append(h('div', { class: 'pack-card broken' },
        h('div', { class: 'pack-text' }, h('b', {}, b.file), h('div', { class: 'error' }, b.error)),
        h('button', { class: 'btn small', onclick: act(() => removePack(b.file)) }, t('Entfernen')),
      ));
    if (!list.children.length)
      list.append(h('p', { class: 'note' }, allPacks().length
        ? t('Keine Treffer.')
        : t('Noch keine Erweiterungen installiert. Eine Erweiterung (.kzp) bringt Gerätevorlagen, Vorlagen oder Materialien mit, ohne dass KizamuBeam neu installiert werden muss.')));
  };
  const install = async () => {
    if (isBusy()) return;
    const r = await openText(t('KizamuBeam-Erweiterung'), [PACK_EXT]);
    if (!r) return;
    if (await installPackFile(r[0], r[1])) (fill(), fillCatalog());
  };

  // ---------- Katalog ----------
  const catList = h('div', { class: 'pack-list' });
  const catStatus = h('p', { class: 'note' });
  const catalogProgress = createProgressBox();
  const reloadBtn = h('button', { class: 'btn small' }, t('Neu laden')) as HTMLButtonElement;
  const updateAll = h('button', { class: 'btn small primary', hidden: true }) as HTMLButtonElement;
  const installFileBtn = h('button', { class: 'btn', onclick: install }, t('Installieren …')) as HTMLButtonElement;
  const closeBtn = h('button', { class: 'btn' }, t('Schließen')) as HTMLButtonElement;
  let catalog: Catalog | null = null;
  let view: 'catalog' | 'installed' | 'updates' = 'catalog';
  let busyId: string | null = null;
  let busyAll = false;
  let loadingCatalog = false;
  let selectedCatalogId: string | null = null;
  type CatalogActionBtn = { id: string; button: HTMLButtonElement; label: string; canAct: boolean };
  const catalogActions = new Map<string, CatalogActionBtn>();
  let detailsAction: CatalogActionBtn | null = null;
  const isBusy = () => busyId !== null || busyAll;
  const syncBusy = () => {
    const busy = isBusy();
    reloadBtn.disabled = busy || loadingCatalog;
    installFileBtn.disabled = busy;
    closeBtn.disabled = busy;
    updateAll.disabled = busy || loadingCatalog;
    updateAll.textContent = busyAll ? t('Wird aktualisiert …') : t('Alle aktualisieren ({n})', { n: updates().length });
    const apply = (item: CatalogActionBtn) => {
      item.button.disabled = !item.canAct || busy;
      item.button.textContent = busyId === item.id ? t('Wird geladen …') : item.label;
    };
    for (const item of catalogActions.values()) apply(item);
    if (detailsAction) apply(detailsAction);
  };
  const stateOf = (e: CatalogEntry) => catalogState(e, allPacks().find((x) => x.pack.id === e.id)?.pack, APP_VERSION);
  const updates = () => (catalog?.packs ?? []).filter((e) => stateOf(e) === 'update');
  const catalogTab = h('button', { class: 'tab', type: 'button' }, t('Katalog')) as HTMLButtonElement;
  const installedTab = h('button', { class: 'tab', type: 'button' }, t('Installiert')) as HTMLButtonElement;
  const updatesTab = h('button', { class: 'tab', type: 'button' }, t('Updates')) as HTMLButtonElement;
  const catalogHeading = h('h4', {}, t('Katalog'));
  const tabs = h('div', { class: 'tab-bar pack-tabs', role: 'tablist' }, catalogTab, installedTab, updatesTab);
  const categoryButtons: { filter: Filter; button: HTMLButtonElement }[] = [];
  const sidebar = h('nav', { class: 'pack-categories' }, h('h4', {}, t('Inhalte|Erweiterungen')));
  const addCategory = (value: Filter, label: string) => {
    const button = h('button', { class: 'pack-category', type: 'button', onclick: () => {
      filter = value;
      refilter();
    } }, label) as HTMLButtonElement;
    categoryButtons.push({ filter: value, button });
    sidebar.append(button);
  };
  addCategory('all', t('Alle'));
  addCategory('plugins', t('Plugins'));
  addCategory('content', t('Inhalte|Erweiterungen'));
  addCategory('templates', t('Vorlagen'));
  addCategory('materials', t('Material'));
  addCategory('assets', t('Bibliotheks-Einträge'));
  const workspace = h('div', { class: 'pack-workspace' }, sidebar, installedPanel, catalogPanel, details);
  const syncView = () => {
    const installed = allPacks().length;
    const updateCount = updates().length;
    installedTab.textContent = `${t('Installiert')} (${installed})`;
    updatesTab.textContent = `${t('Updates')} (${updateCount})`;
    catalogHeading.textContent = view === 'updates' ? t('Updates') : t('Katalog');
    catalogPanel.hidden = view === 'installed';
    installedPanel.hidden = view !== 'installed';
    catalogTab.classList.toggle('on', view === 'catalog');
    installedTab.classList.toggle('on', view === 'installed');
    updatesTab.classList.toggle('on', view === 'updates');
    for (const item of categoryButtons) item.button.classList.toggle('active', item.filter === filter);
    catalogTab.setAttribute('aria-selected', String(view === 'catalog'));
    installedTab.setAttribute('aria-selected', String(view === 'installed'));
    updatesTab.setAttribute('aria-selected', String(view === 'updates'));
  };
  catalogTab.onclick = () => {
    view = 'catalog';
    fillCatalog();
  };
  installedTab.onclick = () => {
    view = 'installed';
    syncView();
  };
  updatesTab.onclick = () => {
    view = 'updates';
    fillCatalog();
  };
  const fromCatalog = async (e: CatalogEntry) => {
    if (isBusy()) return;
    busyId = e.id;
    err.textContent = '';
    const name = localText(e.name);
    syncBusy();
    try {
      const text = await fetchCatalogPack(e, undefined, (progress) => {
        const s = catalogFetchStatus(name, progress);
        catalogProgress.show(s.text, s.ratio);
      });
      catalogProgress.hide();
      if (await installPackFile(e.file, text, true)) fill();
    } catch (x) {
      err.textContent = errText(x);
    } finally {
      busyId = null;
      catalogProgress.hide();
      syncBusy();
      fillCatalog();
    }
  };
  /** Update every pack with a newer catalogue version; each one only after its check and test load */
  updateAll.onclick = async () => {
    if (isBusy()) return;
    const listToUpdate = updates();
    if (!listToUpdate.length) return;
    busyAll = true;
    err.textContent = '';
    syncBusy();
    const failed: string[] = [];
    let done = 0;
    const total = listToUpdate.length;
    try {
      for (let i = 0; i < total; i++) {
        const e = listToUpdate[i];
        const name = localText(e.name);
        const step = i + 1;
        const stepText = (status: string) => t('{step} von {total}: {status}', { step, total, status });
        try {
          const text = await fetchCatalogPack(e, undefined, (progress) => {
            const s = catalogFetchStatus(name, progress);
            const sub = progress.phase === 'verify' ? 0.75 : s.ratio !== null ? s.ratio * 0.7 : 0;
            catalogProgress.show(stepText(s.text), (i + sub) / total);
          });
          const p = parsePack(text);
          const why = p.plugins.map((x) => pluginConflict(p, x.id)).find(Boolean)
            ?? (p.plugins.length
              ? await testLoadPlugins(p, ({ index, total: pluginTotal }) => {
                  const sub = 0.75 + (index / Math.max(1, pluginTotal)) * 0.15;
                  catalogProgress.show(stepText(t('„{name}“: Plugins werden geprüft …', { name })), (i + sub) / total);
                })
              : null);
          if (why) throw new Error(why);
          catalogProgress.show(stepText(t('„{name}“ wird installiert …', { name })), (i + 0.9) / total);
          await installPack(text, { verified: true });
          done++;
          catalogProgress.show(stepText(t('„{name}“ wird installiert …', { name })), (i + 1) / total);
        } catch (x) {
          failed.push(`${name}: ${errText(x)}`);
        }
      }
    } finally {
      busyAll = false;
      catalogProgress.hide();
      catStatus.textContent = tn('{n} Erweiterung aktualisiert.', '{n} Erweiterungen aktualisiert.', done);
      err.textContent = failed.join('\n');
      syncBusy();
      fill();
      fillCatalog();
    }
  };
  const fillCatalog = () => {
    catList.replaceChildren();
    catalogActions.clear();
    const n = updates().length;
    updateAll.hidden = n < 2;
    if (!catalog) {
      detailsAction = null;
      syncView();
      syncBusy();
      return;
    }
    let first: { card: HTMLElement; entry: CatalogEntry } | null = null;
    let kept: { card: HTMLElement; entry: CatalogEntry } | null = null;
    for (const e of catalog.packs) {
      if (view === 'updates' && stateOf(e) !== 'update') continue;
      const name = localText(e.name);
      const desc = localText(e.description);
      if (!shown([name, e.id, e.author, desc], e.plugins, e.devices, e.templates, e.materials, e.assets)) continue;
      const st = stateOf(e);
      const label = {
        install: t('Installieren'),
        update: t('Auf {version} aktualisieren', { version: e.version }),
        installed: t('Installiert'),
        'newer-installed': t('Neuere Version installiert'),
        'needs-app': e.minApp ? t('Braucht KizamuBeam {version}', { version: e.minApp }) : t('Braucht eine neuere Version von KizamuBeam'),
      }[st];
      const canAct = st === 'install' || st === 'update';
      const btn = h('button', { class: 'btn small' + (canAct ? ' primary' : ''), disabled: !canAct || isBusy() }, busyId === e.id ? t('Wird geladen …') : label) as HTMLButtonElement;
      catalogActions.set(e.id, { id: e.id, button: btn, label, canAct });
      const kinds = e.plugins ? [badge(t('Plugins'), 'plugins', (e.runtimes ?? []).map((r) => (r === 'js' ? 'JavaScript' : 'WebAssembly')).join(', '))] : [];
      if (e.network?.length) kinds.push(badge(t('Netzwerk'), 'network', e.network.join(', ')));
      const card = h('div', { class: 'pack-card', tabIndex: 0 },
        h('div', { class: 'pack-text' },
          h('div', {}, h('b', {}, name), ` ${e.version}`, e.author ? h('span', { class: 'muted' }, ` · ${e.author}`) : null, ' ', ...kinds),
          h('div', { class: 'muted' }, countSummary(e.devices, e.templates, e.materials, e.assets, e.plugins)),
          desc ? h('div', {}, desc) : null,
          e.source ? h('div', { class: 'muted pack-url' }, t('Quellcode: {url}', { url: e.source })) : null,
        ),
        btn,
      );
      btn.onclick = (ev) => {
        ev.stopPropagation();
        selectCard(card, catList);
        selectedCatalogId = e.id;
        showCatalogDetails(e);
        void fromCatalog(e);
      };
      card.onclick = () => {
        selectCard(card, catList);
        selectedCatalogId = e.id;
        showCatalogDetails(e);
      };
      catList.append(card);
      first ??= { card, entry: e };
      if (e.id === selectedCatalogId) kept = { card, entry: e };
    }
    const pick = kept ?? first;
    if (pick) {
      selectCard(pick.card, catList);
      selectedCatalogId = pick.entry.id;
      showCatalogDetails(pick.entry);
    } else {
      detailsAction = null;
      details.replaceChildren();
    }
    if (!catalog.packs.length) catList.append(h('p', { class: 'note' }, t('Der Katalog enthält noch keine Pakete.')));
    else if (!catList.children.length) catList.append(h('p', { class: 'note' }, view === 'updates' && !search.value.trim()
      ? t('{n} Aktualisierungen verfügbar.', { n: 0 })
      : t('Keine Treffer.')));
    syncView();
    syncBusy();
  };
  const loadCatalog = async () => {
    if (isBusy()) return;
    loadingCatalog = true;
    syncBusy();
    catStatus.textContent = t('Katalog wird geladen …');
    try {
      catalog = await (opts?.loadCatalog ?? fetchCatalog)();
      // Installed files the signed catalogue lists exactly count as checked
      for (const ip of allPacks()) {
        const e = catalog.packs.find((x) => x.id === ip.pack.id);
        if (e?.sha256 === ip.sha256) markVerified(ip.pack.id, ip.sha256);
      }
      const n = updates().length;
      catStatus.textContent = n ? tn('{n} Aktualisierung verfügbar.', '{n} Aktualisierungen verfügbar.', n) : t('Signatur geprüft.');
    } catch (e) {
      catalog = null;
      catStatus.textContent = t('Katalog nicht verfügbar: {message}', { message: errText(e) });
    } finally {
      loadingCatalog = false;
    }
    fill();
    fillCatalog();
  };
  reloadBtn.onclick = () => void loadCatalog();
  const refilter = () => (fill(), fillCatalog());
  search.addEventListener('input', refilter);
  const dlg = h('dialog', { class: 'packs-dialog' },
    h('h3', {}, t('Erweiterungen')),
    h('div', { class: 'pack-filter' }, search),
    tabs,
    workspace,
    catalogProgress.el,
    err,
    h('div', { class: 'dialog-buttons' },
      hasPackFolder() ? h('button', { class: 'btn', onclick: () => openPackFolder().catch((e) => (err.textContent = errText(e))) }, t('Ordner zeigen')) : null,
      installFileBtn,
      h('span', { class: 'param-spacer' }),
      closeBtn,
    ),
  ) as HTMLDialogElement;
  closeBtn.onclick = () => dlg.close();
  dlg.addEventListener('cancel', (ev) => {
    if (isBusy()) ev.preventDefault();
  });
  installedPanel.append(h('h4', {}, t('Installiert')), list, netSwitch());
  catalogPanel.append(
    h('div', { class: 'pack-section-heading' }, catalogHeading, h('div', {}, reloadBtn, ' ', updateAll)),
    catStatus,
    catList,
  );
  fill();
  syncView();
  syncBusy();
  showDialog(dlg);
  void loadCatalog();
}
