// Fenster „Erweiterungen“ (Menü Datei): installierte Inhaltspakete zeigen, installieren und entfernen.
import { h, showDialog } from './dom';
import { openText } from './files';
import { entryLabel } from './materials';
import { FIRMWARES } from './gcode';
import { Catalog, CatalogEntry, catalogState, fetchCatalog, fetchCatalogPack } from './catalog';
import { version as APP_VERSION } from '../package.json';
import { t, tn } from './i18n';
import {
  brokenPacks, countSummary, ensurePacks, hasPackFolder, installedPacks, installKind, installPack, localText, openPackFolder, Pack, PACK_EXT, packSummary, parsePack, presetList, removePack,
} from './packs';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Eintrag der Auswahl „Neues Gerät aus Vorlage“; Vorlagen aus Erweiterungen nennen das Paket, die Quelle steht im Tooltip */
export function presetOption(p: ReturnType<typeof presetList>[number], i: number) {
  const label = `${p.preset.name} · ${FIRMWARES[p.preset.fw].label}${p.pack ? ` (${p.pack})` : ''}`;
  return h('option', { value: String(i), title: p.source ?? '' }, label);
}

/** Inhalt eines Pakets als Liste (Rückfrage beim Installieren) */
function contentList(p: Pack): HTMLElement {
  const ul = h('ul', { class: 'pack-contents' });
  for (const d of p.devices)
    ul.append(h('li', { title: d.source ?? '' }, t('Gerätevorlage: {name} · {fw}, {w} × {h} mm', { name: d.preset.name, fw: FIRMWARES[d.preset.fw].label, w: d.preset.bedW!, h: d.preset.bedH! })));
  for (const tp of p.templates) ul.append(h('li', {}, t('Vorlage: {name}', { name: tp.info.title })));
  for (const m of p.materials) ul.append(h('li', {}, t('Material: {name}', { name: entryLabel(m) })));
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
  const { kind, old } = installKind(p);
  const status = {
    new: '',
    update: t('Ersetzt die installierte Version {old}.', { old: old?.version ?? '' }),
    same: t('Diese Version ist schon installiert und wird neu eingelesen.'),
    downgrade: t('Achtung: Installiert ist die neuere Version {old}. Sie wird durch diese ältere ersetzt.', { old: old?.version ?? '' }),
  }[kind];
  return new Promise((resolve) => {
    let result: Pack | null = null;
    const err = h('p', { class: 'error' });
    const ok = h('button', { class: 'btn primary' }, kind === 'update' ? t('Aktualisieren') : t('Installieren')) as HTMLButtonElement;
    ok.onclick = async () => {
      ok.disabled = true;
      try {
        result = await installPack(text);
        dlg.close();
      } catch (e) {
        err.textContent = errText(e);
        ok.disabled = false;
      }
    };
    const dlg = h('dialog', { class: 'packs-dialog' },
      h('h3', {}, t('Erweiterung installieren')),
      h('p', {}, h('b', {}, p.name), ` ${p.version}`, p.author ? ` · ${p.author}` : ''),
      p.description ? h('p', { class: 'muted' }, p.description) : null,
      contentList(p),
      status ? h('p', { class: kind === 'downgrade' ? 'warn' : 'note' }, status) : null,
      h('p', { class: 'note' }, fromCatalog
        ? t('Aus dem signierten KizamuBeam-Katalog. Erweiterungen enthalten nur Daten, keinen Programmcode. Prüfe Maße und Laserwerte trotzdem vor dem ersten Job.')
        : t('Erweiterungen enthalten nur Daten, keinen Programmcode. Diese Datei ist nicht signiert: Installiere sie nur, wenn du der Quelle vertraust, und prüfe Maße und Laserwerte vor dem ersten Job.')),
      err,
      h('div', { class: 'dialog-buttons' }, ok, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen'))),
    ) as HTMLDialogElement;
    showDialog(dlg, () => resolve(result));
  });
}

export async function openPacksDialog() {
  await ensurePacks();
  const list = h('div', { class: 'pack-list' });
  const err = h('p', { class: 'error' });
  const fill = () => {
    list.replaceChildren();
    for (const { file, pack } of installedPacks())
      list.append(h('div', { class: 'pack-card' },
        h('div', { class: 'pack-text' },
          h('div', {}, h('b', {}, pack.name), ` ${pack.version}`, pack.author ? h('span', { class: 'muted' }, ` · ${pack.author}`) : null),
          h('div', { class: 'muted' }, packSummary(pack)),
          pack.description ? h('div', {}, pack.description) : null,
          pack.homepage ? h('div', { class: 'muted pack-url' }, pack.homepage) : null,
        ),
        h('button', {
          class: 'btn small',
          onclick: async () => {
            if (!confirm(t('Erweiterung „{name}“ entfernen? Unveränderte Materialien daraus verschwinden aus der Bibliothek, Geräte und Projekte bleiben.', { name: pack.name }))) return;
            try {
              await removePack(file);
              fill();
            } catch (e) {
              err.textContent = errText(e);
            }
          },
        }, t('Entfernen')),
      ));
    for (const b of brokenPacks())
      list.append(h('div', { class: 'pack-card broken' },
        h('div', { class: 'pack-text' }, h('b', {}, b.file), h('div', { class: 'error' }, b.error)),
        h('button', { class: 'btn small', onclick: async () => (await removePack(b.file).catch((e) => (err.textContent = errText(e))), fill()) }, t('Entfernen')),
      ));
    if (!list.children.length)
      list.append(h('p', { class: 'note' }, t('Noch keine Erweiterungen installiert. Eine Erweiterung (.kzp) bringt Gerätevorlagen, Vorlagen oder Materialien mit, ohne dass KizamuBeam neu installiert werden muss.')));
  };
  const install = async () => {
    const r = await openText(t('KizamuBeam-Erweiterung'), [PACK_EXT]);
    if (!r) return;
    if (await installPackFile(r[0], r[1])) (fill(), fillCatalog());
  };

  // ---------- Katalog ----------
  const catList = h('div', { class: 'pack-list' });
  const catStatus = h('p', { class: 'note' });
  let catalog: Catalog | null = null;
  const fromCatalog = async (e: CatalogEntry, btn: HTMLButtonElement) => {
    btn.disabled = true;
    try {
      const text = await fetchCatalogPack(e);
      if (await installPackFile(e.file, text, true)) fill();
    } catch (x) {
      err.textContent = errText(x);
    }
    fillCatalog();
  };
  const fillCatalog = () => {
    catList.replaceChildren();
    if (!catalog) return;
    const have = new Map(installedPacks().map(({ pack }) => [pack.id, pack]));
    for (const e of catalog.packs) {
      const st = catalogState(e, have.get(e.id), APP_VERSION);
      const label = {
        install: t('Installieren'),
        update: t('Auf {version} aktualisieren', { version: e.version }),
        installed: t('Installiert'),
        'newer-installed': t('Neuere Version installiert'),
        'needs-app': t('Braucht KizamuBeam {version}', { version: e.minApp ?? '' }),
      }[st];
      const btn = h('button', { class: 'btn small' + (st === 'install' || st === 'update' ? ' primary' : ''), disabled: st !== 'install' && st !== 'update' }, label) as HTMLButtonElement;
      btn.onclick = () => fromCatalog(e, btn);
      const desc = localText(e.description);
      catList.append(h('div', { class: 'pack-card' },
        h('div', { class: 'pack-text' },
          h('div', {}, h('b', {}, localText(e.name)), ` ${e.version}`, e.author ? h('span', { class: 'muted' }, ` · ${e.author}`) : null),
          h('div', { class: 'muted' }, countSummary(e.devices, e.templates, e.materials, e.assets)),
          desc ? h('div', {}, desc) : null,
        ),
        btn,
      ));
    }
    if (!catalog.packs.length) catList.append(h('p', { class: 'note' }, t('Der Katalog enthält noch keine Pakete.')));
  };
  const loadCatalog = async () => {
    catStatus.textContent = t('Katalog wird geladen …');
    try {
      catalog = await fetchCatalog();
      const updates = catalog.packs.filter((e) => catalogState(e, installedPacks().find((x) => x.pack.id === e.id)?.pack, APP_VERSION) === 'update').length;
      catStatus.textContent = updates ? tn('{n} Aktualisierung verfügbar.', '{n} Aktualisierungen verfügbar.', updates) : t('Signatur geprüft.');
    } catch (e) {
      catalog = null;
      catStatus.textContent = t('Katalog nicht verfügbar: {message}', { message: errText(e) });
    }
    fillCatalog();
  };
  const dlg = h('dialog', { class: 'packs-dialog' },
    h('h3', {}, t('Erweiterungen')),
    h('h4', {}, t('Installiert')),
    list,
    h('h4', {}, t('Katalog'), ' ', h('button', { class: 'btn small', onclick: loadCatalog }, t('Neu laden'))),
    catStatus,
    catList,
    err,
    h('div', { class: 'dialog-buttons' },
      hasPackFolder() ? h('button', { class: 'btn', onclick: () => openPackFolder().catch((e) => (err.textContent = errText(e))) }, t('Ordner zeigen')) : null,
      h('button', { class: 'btn', onclick: install }, t('Installieren …')),
      h('span', { class: 'param-spacer' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen')),
    ),
  ) as HTMLDialogElement;
  fill();
  showDialog(dlg);
  void loadCatalog();
}
