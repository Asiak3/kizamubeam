// Reiter „Material“ im Laser-Panel: Material-Bibliothek ansehen, Einträge aus Layern anlegen,
// auf Layer übernehmen (wie „Assign“ in LightBurn), importieren und exportieren.
import type { Editor } from './editor';
import { h } from './dom';
import { openText, saveText } from './files';
import { layerLabel, PALETTE } from './model';
import {
  differsFrom, entryFromLayer, entryLabel, layerPatch, fitSummary, library, MaterialEntry, parseLibrary, settingsSummary, thicknessLabel,
} from './materials';
import { openMaterialTestDialog } from './materialtest';
import { openTestPhotoDialog } from './testphotoDialog';
import { openCalibrateDialog } from './calibrateDialog';
import { dec, t } from './i18n';

type EntryDraft = Omit<MaterialEntry, 'id'>;

/** Dialog für Material, Dicke, Titel und Beschreibung eines Eintrags */
export function openEntryDialog(init: EntryDraft, onSave: (e: EntryDraft) => void, opt: { heading?: string; imgChoice?: boolean } = {}) {
  const e = structuredClone(init);
  let withImg = !!e.img;
  const listId = `mat-list-${Math.random().toString(36).slice(2, 7)}`;
  const material = h('input', { type: 'text', value: e.material, list: listId, placeholder: t('z. B. Sperrholz Pappel') }) as HTMLInputElement;
  const thick = h('input', { type: 'text', value: e.thickness === null ? '' : dec(String(e.thickness)), placeholder: t('leer = ohne Dicke') }) as HTMLInputElement;
  const title = h('input', { type: 'text', value: e.title, placeholder: t('z. B. Schneiden, Gravieren') }) as HTMLInputElement;
  const desc = h('textarea', { rows: 3, placeholder: t('Notizen, z. B. Fokus, Abdeckband, Gerät') }) as HTMLTextAreaElement;
  desc.value = e.desc;
  const err = h('div', { class: 'warn' });
  const dlg = h('dialog', { class: 'material-dialog' },
    h('h3', {}, opt.heading ?? t('Material-Eintrag')),
    h('datalist', { id: listId }, ...library.materials().map((m) => h('option', { value: m }))),
    h('div', { class: 'form' },
      h('label', {}, t('Material')), material,
      h('label', {}, t('Dicke (mm)')), thick,
      h('label', {}, t('Titel')), title,
      h('label', {}, t('Beschreibung')), desc,
      opt.imgChoice
        ? h('span', { class: 'checks' }, h('label', { class: 'check', title: t('Auch Geschwindigkeit, Leistung, Dithering usw. für Bilder speichern') },
            h('input', { type: 'checkbox', checked: withImg, onchange: (ev: Event) => (withImg = (ev.target as HTMLInputElement).checked) }), t('Bild-Einstellungen mitspeichern')))
        : null,
    ),
    h('div', { class: 'note' }, e.img
      ? t('Einstellungen: {settings}; Bilder: {speed} mm/min, {power} %.', { settings: settingsSummary(e.settings), speed: e.img.speed, power: e.img.power })
      : t('Einstellungen: {settings}.', { settings: settingsSummary(e.settings) })),
    err,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          const m = material.value.trim();
          const raw = thick.value.trim().replace(',', '.');
          const tv = raw === '' ? null : Number(raw);
          if (!m) return void err.replaceChildren(t('Bitte ein Material angeben.'));
          if (tv !== null && !(tv > 0 && isFinite(tv))) return void err.replaceChildren(t('Die Dicke muss eine positive Zahl sein oder leer bleiben.'));
          onSave({ ...e, material: m, thickness: tv, title: title.value.trim(), desc: desc.value, img: withImg ? e.img : undefined });
          dlg.close();
        },
      }, t('Speichern')),
    ),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (ev) => ev.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  material.focus();
}

export function materialTab(ed: Editor): HTMLElement {
  const root = h('div', { class: 'material-tab' });
  let selected: string | null = null;
  let filter = '';
  const target = () => ed.activeLayer ?? ed.currentLayer;
  const hasImages = (i: number) => ed.layerParts(i).img;

  const assign = (e: MaterialEntry) => {
    const i = target();
    ed.updateLayer(i, layerPatch(e));
    ed.hint = t('Layer {layer} nutzt jetzt „{entry}“.', { layer: layerLabel(i), entry: entryLabel(e) });
    ed.emit('tool');
  };
  const createFromLayer = () => {
    const i = target();
    const L = ed.layer(i);
    const imgs = hasImages(i);
    const cur = library.get(L.material);
    openEntryDialog(
      { material: cur?.material ?? '', thickness: cur?.thickness ?? null, title: cur ? cur.title : L.mode === 'fill' ? t('Gravieren') : t('Schneiden'), desc: '', ...entryFromLayer(L, imgs) },
      (d) => {
        const n = library.add(d);
        selected = n.id;
        // Der Layer gehört jetzt zu diesem Eintrag
        ed.updateLayer(i, { material: n.id });
      },
      { heading: t('Neuer Eintrag aus Layer {layer}', { layer: layerLabel(i) }), imgChoice: imgs },
    );
  };
  const updateFromLayer = (e: MaterialEntry) => {
    const i = target();
    const L = ed.layer(i);
    if (!confirm(t('„{entry}“ mit den Einstellungen von Layer {layer} überschreiben?\n\n{settings}', { entry: entryLabel(e), layer: layerLabel(i), settings: settingsSummary(L) }))) return;
    library.update(e.id, entryFromLayer(L, !!e.img || hasImages(i)));
    if (L.material !== e.id) ed.updateLayer(i, { material: e.id });
  };
  const doImport = async () => {
    const f = await openText(t('Materialbibliothek'), ['kzm', 'lwm', 'clb', 'json']);
    if (!f) return;
    try {
      const list = parseLibrary(f[1]);
      const r = library.merge(list);
      alert(r.replaced
        ? t('{file}: {added} Einträge hinzugefügt, {replaced} ersetzt.', { file: f[0], added: r.added, replaced: r.replaced })
        : t('{file}: {added} Einträge hinzugefügt.', { file: f[0], added: r.added }));
    } catch (e) {
      alert(t('{file} konnte nicht gelesen werden: {message}', { file: f[0], message: (e as Error).message }));
    }
  };
  const doExport = () => saveText('materialien.kzm', t('KizamuBeam-Materialbibliothek'), 'kzm', 'application/json', library.serialize());

  const render = () => {
    // Bildlaufstand merken: Neuaufbau setzte sonst die Liste (und das Fenster) an den Anfang zurück.
    const oldList = root.querySelector<HTMLElement>('.mat-list');
    const listScroll = oldList?.scrollTop ?? 0;
    const outer: [HTMLElement, number][] = [];
    for (let p = root.parentElement; p; p = p.parentElement) if (p.scrollTop) outer.push([p, p.scrollTop]);
    const i = target();
    const L = ed.layer(i);
    const cur = library.get(L.material);
    if (!library.get(selected ?? undefined)) selected = null;
    const status = h('div', { class: 'mat-status' },
      h('span', { class: 'swatch', style: `background:${PALETTE[i]}` }, layerLabel(i)),
      cur
        ? h('span', {}, entryLabel(cur), differsFrom(L, cur) ? h('span', { class: 'muted', title: t('Die Layer-Einstellungen weichen vom Eintrag ab') }, t(' (geändert)')) : null)
        : h('span', { class: 'muted' }, t('eigene Einstellungen')),
    );
    const search = h('input', {
      type: 'search', class: 'mat-search', placeholder: t('Suchen …'), value: filter,
      oninput: (ev: Event) => ((filter = (ev.target as HTMLInputElement).value), renderList()),
    });
    const list = h('div', { class: 'mat-list' });
    const renderList = () => {
      const q = filter.trim().toLowerCase();
      const entries = library.entries.filter((e) => !q || `${entryLabel(e)} ${e.desc}`.toLowerCase().includes(q));
      list.replaceChildren();
      if (!library.entries.length) {
        list.append(h('div', { class: 'empty' }, t('Noch keine Materialien. Stelle einen Layer ein (zum Beispiel nach einem Materialtest) und speichere ihn mit „Neu aus Layer“. Vorhandene Bibliotheken (.kzm, .lwm, LightBurn .clb) lassen sich importieren.')));
        return;
      }
      if (!entries.length) {
        list.append(h('div', { class: 'empty' }, t('Nichts gefunden.')));
        return;
      }
      const byMat = new Map<string, MaterialEntry[]>();
      for (const e of entries) byMat.set(e.material, [...(byMat.get(e.material) ?? []), e]);
      for (const m of [...byMat.keys()].sort((a, b) => a.localeCompare(b, 'de'))) {
        list.append(h('div', { class: 'mat-group' }, m));
        const ms = byMat.get(m)!.sort((a, b) => (a.thickness ?? Infinity) - (b.thickness ?? Infinity) || a.title.localeCompare(b.title, 'de'));
        let lastT: number | null | undefined;
        for (const e of ms) {
          if (e.thickness !== lastT) list.append(h('div', { class: 'mat-thick' }, thicknessLabel(e.thickness)));
          lastT = e.thickness;
          const row = h('div', {
            class: `mat-entry${e.id === selected ? ' sel' : ''}${e.id === L.material ? ' cur' : ''}`,
            title: `${e.desc ? e.desc + '\n' : ''}${t('Doppelklick: auf Layer {layer} übernehmen', { layer: layerLabel(i) })}`,
          },
            h('span', {}, e.title || t('(ohne Titel)'), e.img ? h('span', { class: 'muted' }, ' + ', t('Bild')) : null,
              e.fit ? h('span', { class: 'mat-fit', title: fitSummary(e.fit) }, t('Passung')) : null),
            h('span', { class: 'muted' }, settingsSummary(e.settings)),
          );
          row.addEventListener('click', () => {
            if (selected === e.id) return;
            selected = e.id;
            for (const r of list.querySelectorAll('.mat-entry.sel')) r.classList.remove('sel');
            row.classList.add('sel');
            buttons.replaceChildren(...entryButtons());
          });
          row.addEventListener('dblclick', () => assign(e));
          list.append(row);
        }
      }
    };
    const btn = (label: string, title: string, f: () => void, enabled = true) =>
      h('button', { class: 'btn', title, disabled: !enabled, onclick: f }, label);
    const entryButtons = () => {
      const sel = library.get(selected ?? undefined) ?? null;
      return [
        btn(t('Übernehmen'), t('Einstellungen des gewählten Eintrags auf Layer {layer} übertragen (Doppelklick)', { layer: layerLabel(i) }), () => sel && assign(sel), !!sel),
        btn(t('Aus Layer aktualisieren'), t('Eintrag mit den Einstellungen von Layer {layer} überschreiben', { layer: layerLabel(i) }), () => sel && updateFromLayer(sel), !!sel),
        btn(t('Bearbeiten …'), t('Material, Dicke, Titel und Beschreibung ändern'), () => sel && openEntryDialog(sel, (d) => library.update(sel.id, d)), !!sel),
        btn(t('Duplizieren'), t('Kopie des Eintrags anlegen'), () => {
          if (!sel) return;
          const { id: _id, ...rest } = sel;
          selected = library.add({ ...rest, title: rest.title ? t('{name} (Kopie)', { name: rest.title }) : t('(Kopie)') }).id;
        }, !!sel),
        btn(t('Löschen'), t('Eintrag aus der Bibliothek entfernen'), () => sel && confirm(t('„{entry}“ löschen?', { entry: entryLabel(sel) })) && library.remove(sel.id), !!sel),
      ];
    };
    const buttons = h('div', { class: 'mat-buttons' }, ...entryButtons());
    renderList();
    root.replaceChildren(
      status,
      search,
      list,
      buttons,
      h('div', { class: 'mat-buttons' },
        btn(t('Neu aus Layer …'), t('Einstellungen von Layer {layer} als neuen Eintrag speichern', { layer: layerLabel(i) }), createFromLayer),
        btn(t('Importieren …'), t('Einträge aus einer .kzm-, .lwm- oder LightBurn-.clb-Datei hinzufügen'), doImport),
        btn(t('Exportieren …'), t('Ganze Bibliothek als .kzm-Datei speichern'), doExport, library.entries.length > 0),
        btn(t('Materialtest …'), t('Testraster mit gestufter Geschwindigkeit und Leistung lasern'), () => openMaterialTestDialog(ed)),
        btn(t('Test auswerten …'), t('Foto des gelaserten Materialtests laden und die beste Zelle anklicken'), () => openTestPhotoDialog(ed)),
        btn(t('Passung kalibrieren …'), t('Schnittfuge und Steckspiel für ein Material ermitteln'), () => openCalibrateDialog(ed)),
      ),
    );
    list.scrollTop = listScroll;
    for (const [p, top] of outer) p.scrollTop = top;
  };

  library.on(render);
  let pending = false;
  ed.on((w) => {
    if (w === 'view' || pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      if (!root.contains(document.activeElement) || document.activeElement?.tagName !== 'INPUT') render();
    });
  });
  render();
  return root;
}
