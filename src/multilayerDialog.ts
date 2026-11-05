import type { Editor } from './editor';
import { h } from './dom';
import { t } from './i18n';
import { objLabel } from './objectsPanel';
import { assemblyForObject, defaultPlate, hasClosedContour, makeAssembly } from './multilayer';
import { DEFAULT_LOOK, layerLook } from './view3d/looks';
import { lookEditor } from './view3d/lookui';
import { library } from './materials';
import type { MultiLayerPlate, Obj } from './model';
import { isCutLayer } from './model';

const rootsById = (ed: Editor) => new Map(ed.doc.pages.flatMap((p) => p.objs).map((o) => [o.id, o]));

/** Assistent für eine frei gestaltete Baugruppe; die Auswahl bleibt unverändert. */
export function openMultiLayerDialog(ed: Editor) {
  const existing = ed.sel.length ? assemblyForObject(ed.doc, ed.sel[0].id) : undefined;
  const selected = existing ? existing.plates.map((p) => rootsById(ed).get(p.object)).filter((o): o is Obj => !!o) : ed.sel;
  if (!selected.length || (!existing && (!selected.every((o) => hasClosedContour(o, (layer) => isCutLayer(ed.layer(layer)))) || selected.some((o) => assemblyForObject(ed.doc, o.id))))) {
    ed.hint = t('Mehrlagenarbeit: geschlossene Formen oder Gruppen auswählen, die noch zu keiner Mehrlagenarbeit gehören.');
    ed.emit('tool');
    return;
  }
  const byId = rootsById(ed);
  let plates: MultiLayerPlate[] = existing
    ? existing.plates.filter((p) => byId.has(p.object)).map((p) => ({ ...p, look: { ...p.look } }))
    : selected.map((o) => defaultPlate(o.id, objLabel(o), layerLook(ed.layer(o.layer), (id) => library.get(id)?.material, DEFAULT_LOOK), o.m));

  const list = h('div', { class: 'multilayer-list' });
  const redraw = () => {
    list.replaceChildren(...plates.map((p, i) => {
      const name = h('input', { type: 'text', value: p.name, class: 'multilayer-name', 'aria-label': t('Name der Platte') }) as HTMLInputElement;
      name.oninput = () => (p.name = name.value);
      const thickness = h('input', { type: 'number', min: '0.3', max: '50', step: '0.1', value: String(p.thickness), class: 'multilayer-thickness', 'aria-label': t('Materialdicke') }) as HTMLInputElement;
      thickness.oninput = () => (p.thickness = Math.max(0.3, Math.min(50, Number(thickness.value) || 3)));
      const up = h('button', { class: 'small', disabled: i === plates.length - 1, title: t('Eine Ebene höher') }, '↑') as HTMLButtonElement;
      up.onclick = () => { [plates[i], plates[i + 1]] = [plates[i + 1], plates[i]]; redraw(); };
      const down = h('button', { class: 'small', disabled: i === 0, title: t('Eine Ebene tiefer') }, '↓') as HTMLButtonElement;
      down.onclick = () => { [plates[i], plates[i - 1]] = [plates[i - 1], plates[i]]; redraw(); };
      const look = lookEditor(() => p.look, (v) => { p.look = v ?? DEFAULT_LOOK; }, p.name);
      return h('div', { class: 'multilayer-row' }, h('span', { class: 'muted' }, String(i + 1)), name, h('label', {}, t('Dicke'), thickness, ' mm'), look, down, up);
    }));
  };
  redraw();
  const ok = h('button', { class: 'btn primary', onclick: () => {
    if (plates.some((p) => !p.name.trim() || !(p.thickness >= 0.3 && p.thickness <= 50))) return;
    ed.snapshot(existing ? t('Mehrlagenarbeit bearbeiten') : t('Mehrlagenarbeit erstellen'));
    if (existing) existing.plates = plates;
    else (ed.doc.multiLayerAssemblies ??= []).push(makeAssembly(plates));
    ed.emit('doc');
    dlg.close();
  } }, existing ? t('Übernehmen') : t('Erstellen')) as HTMLButtonElement;
  const dlg = h('dialog', { class: 'offset-dialog multilayer-dialog' },
    h('h3', {}, existing ? t('Mehrlagenarbeit bearbeiten') : t('Mehrlagenarbeit erstellen')),
    h('p', { class: 'note' }, t('Die Liste läuft von unten nach oben. Die Formen bleiben editierbar; die 3D-Ansicht zeigt sie bündig gestapelt.')),
    list,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')), ok),
  ) as HTMLDialogElement;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
