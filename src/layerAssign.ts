// Moving groups with objects on several layers to another layer (issue #255). Groups on a single layer
// and loose objects move as before. When at least one group mixes layers (e.g. a part on a cut layer and
// its engraving), one dialog asks whether to move only the group's main layer (default, the other layers
// stay), to move everything, or to choose the target per layer by hand for the whole selection. Cancel
// changes nothing, not even the current layer.
// The editor side is assignLayer/moveObjects.
import type { Editor } from './editor';
import { defaultLayer, LayerChoice, LayerMap, layerLabel, leaves, Obj, PALETTE } from './model';
import { h, showDialog } from './dom';
import { t, tn } from './i18n';

/** groups: the groups that mix layers; objs: everything that moves (the manual view lists all its layers) */
export type AskChildLayers = (ed: Editor, groups: Obj[], target: number, objs: Obj[]) => Promise<LayerChoice | null>;

/** Black or white text, whichever reads better on the layer color */
function ink(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150 ? '#000' : '#fff';
}

export function askChildLayers(ed: Editor, groups: Obj[], target: number, objs: Obj[]): Promise<LayerChoice | null> {
  return new Promise((resolve) => {
    let answer: LayerChoice | null = null;
    const done = (a: LayerChoice | null) => ((answer = a), dlg.close());
    // Read without ed.layer(): cancelling must not leave stored settings for an empty layer behind
    const layerName = (i: number) => (ed.doc.layers[i] ?? defaultLayer(i)).name;
    const name = (i: number) => `${layerLabel(i)} · ${layerName(i)}`;
    const layer = name(target);
    const swatch = (i: number) => h('span', { class: 'swatch', style: `background:${PALETTE[i]}` }, layerLabel(i));

    // Manual view: one row per layer in the whole selection, each starting on its own layer (unchanged rows stay)
    const used = [...new Set([...leaves(objs)].map(([l]) => l.layer))].sort((a, b) => a - b);
    const rows = used.map((from) => {
      const select = h('select', {},
        ...PALETTE.map((c, i) => h('option', { value: String(i), style: `background:${c};color:${ink(c)}` }, name(i))));
      select.value = String(from);
      const to = h('span', {}, swatch(from));
      select.onchange = () => to.replaceChildren(swatch(Number(select.value)));
      return { from, select, row: h('tr', {},
        h('td', {}, swatch(from), ' ', layerName(from)), h('td', {}, '→'), h('td', {}, select, ' ', to)) };
    });
    const apply = () => {
      const map: LayerMap = new Map();
      for (const { from, select } of rows) if (Number(select.value) !== from) map.set(from, Number(select.value));
      done(map);
    };
    const manualText = t('Für jeden Layer der Auswahl das Ziel wählen.');
    const manual = h('div', { hidden: true },
      h('p', {}, manualText),
      h('table', { class: 'layer-assign-map' },
        h('tr', {}, h('th', {}, t('Herkunft')), h('th', {}), h('th', {}, t('Ziel'))), ...rows.map((r) => r.row)),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => done(null) }, t('Abbrechen')),
        h('button', { class: 'btn primary', onclick: apply }, t('Übernehmen'))));

    const preserve = h('button', { class: 'btn primary', onclick: () => done('preserve'),
      title: t('Nur die Objekte auf dem Layer der Gruppe kommen auf {layer}. Die anderen bleiben, z. B. die Gravur.', { layer }) },
    t('Nur Hauptlayer verschieben'));
    const title = h('h3', {}, t('Auf Layer {layer} verschieben', { layer }));
    const question = h('p', {}, t('Was soll auf {layer}?', { layer }));
    const buttons = h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => done(null) }, t('Abbrechen')),
      h('button', { class: 'btn', title: manualText, onclick: () => {
        choices.hidden = true;
        manual.hidden = false;
        title.textContent = t('Layer manuell zuweisen');
        rows[0]?.select.focus();
      } }, t('Manuell zuweisen …')),
      h('button', { class: 'btn', onclick: () => done('all'), title: t('Alle Objekte der Gruppe kommen auf {layer}.', { layer }) },
        t('Alle Objekte verschieben')),
      preserve);
    const choices = h('div', {}, question, buttons);

    const dlg = h('dialog', { class: 'offset-dialog layer-assign' }, title,
      h('p', {}, tn('{n} Gruppe hat auch Objekte auf anderen Layern, z. B. eine Gravur.',
        '{n} Gruppen haben auch Objekte auf anderen Layern, z. B. eine Gravur.', groups.length)),
      choices, manual);
    showDialog(dlg, () => resolve(answer));
    // Enter moves only the main layer, the others stay: the safe choice for what gets lasered
    preserve.focus();
  });
}

/** Does moving the selection to this layer need the question? (layer bar: wait for a double click first) */
export const needsChildLayersQuestion = (ed: Editor, layer: number) => ed.mixedGroups(ed.sel, layer).length > 0;

/** "Move to layer" for the selection, asking first when a group mixes layers */
export async function assignLayerAsk(ed: Editor, layer: number, ask: AskChildLayers = askChildLayers) {
  const groups = ed.mixedGroups(ed.sel, layer);
  if (!groups.length) {
    ed.assignLayer(layer);
    return;
  }
  const sel = ed.sel;
  const answer = await ask(ed, groups, layer, sel);
  // Cancelled, or the selection changed meanwhile: nothing changes, not even the current layer
  if (!answer || ed.sel !== sel) return;
  ed.assignLayer(layer, answer);
}

/** Drag and drop in the Objects window onto another layer, asking first when a group mixes layers */
export async function moveObjectsAsk(ed: Editor, objs: Obj[], ref: Obj | null, front: boolean, layer?: number,
  ask: AskChildLayers = askChildLayers) {
  const groups = layer === undefined ? [] : ed.mixedGroups(objs, layer);
  if (!groups.length) {
    ed.moveObjects(objs, ref, front, layer);
    return;
  }
  const doc = ed.doc;
  const answer = await ask(ed, groups, layer!, objs);
  // Cancelled: neither the layers nor the order change
  if (!answer || ed.doc !== doc) return;
  ed.moveObjects(objs, ref, front, layer, answer);
}
