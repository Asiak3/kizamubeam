// Fenster „Bibliothek“: eigene Motive, Bilder und Designelemente mit Vorschau und Suche. Doppelklick oder
// Ziehen auf die Arbeitsfläche fügt einen Eintrag ein; „+“ speichert die Auswahl, „Dateien …“ übernimmt SVG,
// DXF, Bilder und .kza-Dateien. Einträge aus Erweiterungen erscheinen mit dem Namen der Erweiterung.
import type { Editor } from './editor';
import { h, showDialog } from './dom';
import { t, tn } from './i18n';
import { dockWindow, isShown, onWindowShow, setBadge, showWindow } from './dock';
import { fileObjs, IMPORT_EXT, objsPreviewSvg, saveText } from './files';
import { decodeImage, scaledPng } from './images';
import {
  ASSET_CATEGORIES, ASSET_EXT, AssetCategory, AssetData, assetJson, categoryLabel, categoryPlural, parseAsset, parseTags, searchAssets,
} from './assetFormat';
import { groupLabel } from './builtinLibrary';
import { openPatternDialog } from './patternDialog';
import {
  addToLibrary, hasLibraryFolder, LibraryItem, libraryItems, loadLibraryAsset, onLibraryChanged, openLibraryFolder, reloadLibrary, removeFromLibrary,
  updateLibraryAsset,
} from './assetLibrary';

const DRAG_TYPE = 'application/x-kizamubeam-asset';
const svgUrl = (svg: string) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isTauri = () => '__TAURI_INTERNALS__' in window;

function hint(ed: Editor, msg: string) {
  ed.hint = msg;
  ed.emit('tool');
}

/** Vorschau eines Eintrags ohne gespeicherte Vorschau (z. B. aus einer Erweiterung): Bilder verkleinert */
export async function makePreview(a: AssetData): Promise<string> {
  const thumbs: Record<string, string> = {};
  for (const [id, url] of Object.entries(a.images)) {
    if (url.length <= 150_000) continue;
    try {
      thumbs[id] = scaledPng(await decodeImage(url));
    } catch {
      /* graue Fläche */
    }
  }
  return objsPreviewSvg(a.objs, (i) => ({ show: true, fill: !!a.fill?.includes(i) }), thumbs);
}

const previews = new Map<string, Promise<string>>();
function previewOf(it: LibraryItem): Promise<string> | string | null {
  if (it.meta.preview) return it.meta.preview;
  if (it.broken) return null;
  let p = previews.get(it.key);
  if (!p) {
    p = loadLibraryAsset(it.key).then(makePreview, () => '');
    previews.set(it.key, p);
  }
  return p;
}

// ---------- Einfügen ----------

/** Eintrag aus der Bibliothek einfügen (at: Weltpunkt, sonst Mitte der Ansicht) */
export async function insertLibraryItem(ed: Editor, key: string, at?: { x: number; y: number }) {
  try {
    const a = await loadLibraryAsset(key);
    // a pattern fills the selected shape (pattern fill dialog) instead of being placed as a motif
    if (a.pattern) openPatternDialog(ed, { pattern: { name: a.name, spec: a.pattern } });
    else ed.insertAsset(a, at);
  } catch (e) {
    alert(errText(e));
  }
}

/** Inhalt einer .kza-Datei einfügen (Importieren, Ziehen auf die Arbeitsfläche) */
export async function insertAssetFile(ed: Editor, text: string) {
  const a = parseAsset(text);
  if (ed.insertAsset(a)) hint(ed, t('„{name}“ eingefügt. Im Fenster „Bibliothek“ lässt sich der Eintrag mit „Dateien …“ dauerhaft übernehmen.', { name: a.name }));
}

// ---------- Hinzufügen ----------

/** Dateien (SVG, DXF, PDF, AI, Bilder, .kza) als Einträge übernehmen; Fehler werden gesammelt gemeldet */
export async function addFilesToLibrary(ed: Editor, files: { name: string; bytes: Uint8Array }[]) {
  const ok: string[] = [];
  const bad: string[] = [];
  for (const f of files) {
    try {
      let a: AssetData | null;
      if (/\.kza$/i.test(f.name)) a = parseAsset(new TextDecoder().decode(f.bytes));
      else {
        const { objs } = await fileObjs(ed, f.name, f.bytes);
        a = ed.assetFromObjs(objs, f.name.replace(/\.[^.]+$/, ''));
      }
      if (!a) throw new Error(t('keine verwertbaren Formen gefunden'));
      await addToLibrary(a);
      ok.push(a.name);
    } catch (e) {
      bad.push(`${f.name}: ${errText(e)}`);
    }
  }
  if (ok.length) hint(ed, tn('{n} Eintrag in die Bibliothek übernommen.', '{n} Einträge in die Bibliothek übernommen.', ok.length));
  if (bad.length) alert(t('Nicht übernommen:') + '\n' + bad.join('\n'));
}

async function pickFiles(ed: Editor) {
  const exts = [...IMPORT_EXT];
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const paths = await invoke<string[]>('pick_files', { filters: [[t('Alle unterstützten Dateien'), exts]] });
    const files = [];
    for (const path of paths) files.push({ name: path.split(/[\\/]/).pop() ?? path, bytes: new Uint8Array(await invoke<ArrayBuffer>('read_file', { path })) });
    if (files.length) await addFilesToLibrary(ed, files);
    return;
  }
  const input = h('input', { type: 'file', multiple: true, accept: exts.map((e) => '.' + e).join(',') }) as HTMLInputElement;
  input.onchange = async () => {
    const files = await Promise.all([...(input.files ?? [])].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
    if (files.length) await addFilesToLibrary(ed, files);
  };
  input.click();
}

// ---------- Dialog: Name, Art, Stichwörter ----------

function editDialog(title: string, a: AssetData, okLabel: string, onSave: (a: AssetData) => Promise<void>) {
  const name = h('input', { type: 'text', id: 'asset-name', value: a.name }) as HTMLInputElement;
  // patterns stay patterns; other entries cannot become one (they have no repeat settings)
  const cats = ASSET_CATEGORIES.filter((c) => (c === 'pattern') === !!a.pattern);
  const cat = h('select', { id: 'asset-cat' }, ...cats.map((c) => h('option', { value: c, selected: c === a.category }, categoryLabel(c)))) as HTMLSelectElement;
  const tags = h('input', { type: 'text', id: 'asset-tags', value: a.tags.join(', '), placeholder: t('z. B. Blume, Ranke, Hochzeit') }) as HTMLInputElement;
  const err = h('div', { class: 'error' });
  const save = async () => {
    if (!name.value.trim()) {
      err.textContent = t('Bitte einen Namen eingeben.');
      return;
    }
    try {
      await onSave({ ...a, name: name.value.trim().slice(0, 80), category: cat.value as AssetCategory, tags: parseTags(tags.value) });
      dlg.close();
    } catch (e) {
      err.textContent = errText(e);
    }
  };
  name.onkeydown = tags.onkeydown = (e: KeyboardEvent) => e.key === 'Enter' && save();
  const dlg = h('dialog', { class: 'tpl-dialog lib-dialog' },
    h('h3', {}, title),
    h('div', { class: 'tpl-head' },
      h('div', { class: 'form' },
        h('label', { for: 'asset-name' }, t('Name')), name,
        h('label', { for: 'asset-cat' }, t('Art')), cat,
        h('label', { for: 'asset-tags' }, t('Stichwörter')), tags,
      ),
      a.preview ? h('img', { class: 'tpl-thumb', src: svgUrl(a.preview), alt: '' }) : null,
    ),
    h('p', { class: 'note' }, t('Stichwörter mit Komma trennen. Die Suche findet Namen, Stichwörter und Art.')),
    err,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', { class: 'btn primary', onclick: save }, okLabel),
    ),
  ) as HTMLDialogElement;
  showDialog(dlg);
  name.select();
}

/** Bearbeiten → Zur Bibliothek hinzufügen …: Auswahl als Eintrag speichern */
export function openAddSelectionDialog(ed: Editor) {
  if (!ed.sel.length) {
    hint(ed, t('Erst die Objekte auswählen, die in die Bibliothek sollen.'));
    return;
  }
  const first = ed.sel.length === 1 ? ed.sel[0].name : undefined;
  const a = ed.assetFromObjs(ed.sel, first ?? '');
  if (!a) {
    hint(ed, t('Die Auswahl enthält nichts Sichtbares.'));
    return;
  }
  if (!first) a.name = '';
  editDialog(t('Zur Bibliothek hinzufügen'), a, t('Hinzufügen'), async (x) => {
    await addToLibrary(x);
    showWindow('library');
    hint(ed, t('„{name}“ in der Bibliothek gespeichert.', { name: x.name }));
  });
}

// ---------- Fenster ----------

export function buildLibraryPanel(ed: Editor) {
  const body = dockWindow('library', t('Bibliothek'), { near: 'history' });
  const search = h('input', { type: 'search', class: 'lib-search', placeholder: t('Suchen …'), title: t('Name, Stichwort oder Art') }) as HTMLInputElement;
  const cat = h('select', { class: 'lib-cat', title: t('Art') },
    h('option', { value: '' }, t('Alle')),
    ...ASSET_CATEGORIES.map((c) => h('option', { value: c }, categoryPlural(c))),
  ) as HTMLSelectElement;
  // Herkunft bzw. Gruppe: eigene, aus Erweiterungen oder eine Gruppe der mitgelieferten Einträge
  const grp = h('select', { class: 'lib-grp', title: t('Gruppe') }) as HTMLSelectElement;
  const btnAdd = h('button', { class: 'small', title: t('Auswahl zur Bibliothek hinzufügen'), onclick: () => openAddSelectionDialog(ed) }, t('+ Auswahl'));
  const btnFiles = h('button', { class: 'small', title: t('SVG, DXF, PDF, AI, Bilder oder .kza-Dateien übernehmen (oder hierher ziehen)'), onclick: () => pickFiles(ed) }, t('Dateien …'));
  const btnFolder = hasLibraryFolder()
    ? h('button', { class: 'small', title: t('Bibliotheks-Ordner zeigen'), onclick: () => openLibraryFolder().catch((e) => alert(errText(e))) }, t('Ordner'))
    : null;
  const btnReload = h('button', { class: 'small', title: t('Liste neu lesen'), onclick: () => reloadLibrary() }, '↻');
  const grid = h('div', { class: 'lib-grid' });
  const btnInsert = h('button', { class: 'small', onclick: () => sel && insertLibraryItem(ed, sel) }, t('Einfügen'));
  const btnEdit = h('button', { class: 'small', title: t('Name, Art und Stichwörter ändern'), onclick: () => editSelected() }, t('Ändern …'));
  const btnExport = h('button', { class: 'small', title: t('Als .kza-Datei speichern (z. B. zum Weitergeben)'), onclick: () => exportSelected() }, t('Export …'));
  const btnDelete = h('button', { class: 'small', onclick: () => deleteSelected() }, t('Löschen'));
  const info = h('div', { class: 'lib-info muted' });
  const foot = h('div', { class: 'lib-foot' }, info, h('div', { class: 'lib-actions' }, btnInsert, btnEdit, btnExport, btnDelete));
  body.append(
    h('div', { class: 'lib-bar' }, search, cat, grp),
    h('div', { class: 'lib-bar' }, btnAdd, btnFiles, btnFolder, btnReload),
    grid,
    foot,
  );

  let items: LibraryItem[] = [];
  let sel: string | null = null;
  let stale = true;
  const current = () => items.find((x) => x.key === sel);

  const updateFoot = () => {
    const it = current();
    foot.hidden = !it;
    if (!it) return;
    const own = !it.source;
    btnEdit.disabled = btnDelete.disabled = !own || !!it.broken;
    btnInsert.disabled = btnExport.disabled = !!it.broken;
    const size = it.meta.w ? `${it.meta.w.toFixed(1)} × ${it.meta.h.toFixed(1)} mm` : '';
    info.textContent = [it.meta.name, categoryLabel(it.meta.category), size, origin(it), it.broken ?? ''].filter(Boolean).join(' · ');
    info.title = it.meta.tags.join(', ');
  };

  const origin = (it: LibraryItem) => (it.pack ? t('aus „{name}“', { name: it.pack }) : it.builtin ? t('mitgeliefert') : '');
  const inGroup = (it: LibraryItem, g: string) => !g || (g === 'own' ? !it.source : g === 'packs' ? !!it.pack : it.builtin === g);
  /** Auswahl der Gruppen passend zur Art; die gewählte bleibt, solange es sie gibt */
  const fillGroups = () => {
    const c = cat.value;
    const prev = grp.value;
    const groups: string[] = [];
    for (const it of items) if (it.builtin && (!c || it.meta.category === c) && !groups.includes(it.builtin)) groups.push(it.builtin);
    const opts: [string, string][] = [['', t('Alle')], ['own', t('Eigene')]];
    if (items.some((x) => x.pack)) opts.push(['packs', t('Aus Erweiterungen')]);
    for (const g of groups) opts.push([g, groupLabel(g)]);
    grp.replaceChildren(...opts.map(([v, label]) => h('option', { value: v }, label)));
    grp.value = opts.some(([v]) => v === prev) ? prev : '';
  };

  const render = async () => {
    if (!isShown('library')) {
      stale = true;
      return;
    }
    stale = false;
    try {
      items = await libraryItems();
    } catch {
      items = [];
    }
    // Zahl im Reiter: eigene Einträge und die aus Erweiterungen (die mitgelieferten sind immer da)
    const ownCount = items.filter((x) => !x.builtin).length;
    setBadge('library', ownCount ? String(ownCount) : '');
    fillGroups();
    const shown = searchAssets(items, search.value, cat.value as AssetCategory | '').filter((it) => inGroup(it, grp.value));
    if (sel && !shown.some((x) => x.key === sel)) sel = null;
    grid.replaceChildren(
      ...shown.map((it) => {
        const img = h('img', { alt: '', draggable: false, loading: 'lazy' });
        const pv = previewOf(it);
        if (typeof pv === 'string') img.src = svgUrl(pv);
        else if (pv) pv.then((s) => s && (img.src = svgUrl(s)));
        const tile = h('div', {
          class: `lib-tile${it.key === sel ? ' sel' : ''}${it.broken ? ' broken' : ''}`,
          title: [it.meta.name, it.meta.tags.join(', '), origin(it)].filter(Boolean).join('\n'),
          draggable: !it.broken,
          tabindex: 0,
          onclick: () => {
            sel = it.key;
            grid.querySelectorAll('.lib-tile.sel').forEach((el) => el.classList.remove('sel'));
            tile.classList.add('sel');
            updateFoot();
          },
          ondblclick: () => !it.broken && insertLibraryItem(ed, it.key),
          onkeydown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !it.broken) insertLibraryItem(ed, it.key);
          },
          ondragstart: (e: DragEvent) => {
            e.dataTransfer?.setData(DRAG_TYPE, it.key);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
          },
        },
          img,
          h('span', { class: 'lib-name' }, it.meta.name),
          it.pack ? h('span', { class: 'lib-pack', title: it.pack }, '⬚') : null,
        );
        return tile;
      }),
    );
    if (!shown.length)
      grid.append(h('div', { class: 'empty' }, items.length ? t('Nichts gefunden.') : t('Noch keine Einträge. Objekte auswählen und „+ Auswahl“ drücken, oder SVG-, DXF- und Bilddateien hierher ziehen.')));
    updateFoot();
  };

  const editSelected = async () => {
    const it = current();
    if (!it || it.source) return;
    try {
      const a = await loadLibraryAsset(it.key);
      editDialog(t('Eintrag bearbeiten'), a, t('Speichern'), (x) => updateLibraryAsset(it.key, x));
    } catch (e) {
      alert(errText(e));
    }
  };
  const exportSelected = async () => {
    const it = current();
    if (!it) return;
    try {
      const a = await loadLibraryAsset(it.key);
      if (!a.preview) a.preview = await makePreview(a);
      await saveText(`${a.name}.${ASSET_EXT}`, t('KizamuBeam-Bibliothek'), ASSET_EXT, 'application/json', assetJson(a));
    } catch (e) {
      alert(errText(e));
    }
  };
  const deleteSelected = async () => {
    const it = current();
    if (!it || it.source) return;
    if (!confirm(t('„{name}“ aus der Bibliothek löschen?', { name: it.meta.name }))) return;
    try {
      await removeFromLibrary(it.key);
      sel = null;
    } catch (e) {
      alert(errText(e));
    }
  };

  search.oninput = () => render();
  cat.onchange = () => render();
  grp.onchange = () => render();
  search.addEventListener('keydown', (e) => e.stopPropagation());
  onLibraryChanged(() => render());
  onWindowShow('library', () => stale && render());

  // Dateien auf das Fenster ziehen: in die Bibliothek übernehmen
  body.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      body.classList.add('lib-drop');
    }
  });
  body.addEventListener('dragleave', () => body.classList.remove('lib-drop'));
  body.addEventListener('drop', async (e) => {
    body.classList.remove('lib-drop');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    await addFilesToLibrary(ed, await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
  });

  // Einträge auf die Arbeitsfläche ziehen: an der Stelle einfügen
  ed.canvas.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes(DRAG_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  ed.canvas.addEventListener('drop', (e) => {
    const key = e.dataTransfer?.getData(DRAG_TYPE);
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    const r = ed.canvas.getBoundingClientRect();
    insertLibraryItem(ed, key, ed.toWorld(e.clientX - r.left, e.clientY - r.top));
  });

  render();
}
