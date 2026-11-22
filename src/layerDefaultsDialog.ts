// Dialog „Layer-Vorgaben“ (#265): Kategorien bearbeiten und den Layern 00–29 zuordnen. Geöffnet über das Zahnrad im
// Fenster Schnitte / Layer und aus den Einstellungen. Bearbeitet wird eine Kopie; gespeichert wird nur, wenn sich etwas
// geändert hat (ohne gespeicherte Vorgaben bleibt alles wie bisher, siehe layerCategories.ts).
import type { Editor } from './editor';
import { h, numInput, showDialog } from './dom';
import { t } from './i18n';
import { defaultLayer, defaultSubLayer, Layer, LAYER_TYPES, LayerType, layerLabel, layerTypeName, normalizeLayer, PALETTE } from './model';
import {
  applyCategoriesToProject,
  builtinCategory,
  CATEGORY_LAYERS,
  categoryFrom,
  categoryName,
  defaultLayerDefaults,
  isBuiltinCategory,
  LayerCategory,
  LayerDefaults,
  loadLayerDefaults,
  newCategoryId,
  sameLayerDefaults,
  saveLayerDefaults,
  standardCategoryId,
} from './layerCategories';
import { entryLabel, library, settingsSummary } from './materials';

type ModeChoice = 'line' | 'fill' | 'fill-line';

export function openLayerDefaultsDialog(ed: Editor) {
  /** Zuletzt gespeicherter Stand (ohne gespeicherte Vorgaben: die eingebauten) */
  let saved: LayerDefaults = loadLayerDefaults() ?? defaultLayerDefaults();
  let d: LayerDefaults = structuredClone(saved);
  /** „Alles zurücksetzen“ gedrückt: dann die gespeicherten Vorgaben löschen statt die Werkswerte zu speichern */
  let cleared = false;
  let tab: 'layers' | 'categories' = 'layers';
  let selId = d.categories[0].id;
  const status = h('div', { class: 'note' });

  /** Entwurf speichern, wenn er sich vom gespeicherten Stand unterscheidet */
  const commit = () => {
    if (cleared && sameLayerDefaults(d, defaultLayerDefaults())) saveLayerDefaults(null);
    else if (!sameLayerDefaults(d, saved)) saveLayerDefaults(d);
    saved = structuredClone(d);
    cleared = false;
  };

  const num = (get: () => number, set: (v: number) => void, min: number, max: number, int = false, label?: string) => {
    const el = numInput('', (v) => {
      set(Math.max(min, Math.min(max, int ? Math.round(v) : v)));
      el.value = String(get());
      renderSummary();
    });
    el.value = String(get());
    if (label) el.setAttribute('aria-label', label);
    return el;
  };
  const row = (label: string, el: HTMLElement) => {
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', label);
    return [h('label', {}, label), el];
  };

  const tabBar = h('div', { class: 'tab-bar', role: 'tablist' });
  const body = h('div');

  // ---------- Reiter Layer ----------
  const layersTab = () => {
    const grid = h('div', { class: 'ld-layers' });
    // Zwei Spalten: links 00–14, rechts 15–29
    const half = CATEGORY_LAYERS / 2;
    for (const i of Array.from({ length: CATEGORY_LAYERS }, (_, k) => (k % 2 ? half : 0) + (k >> 1))) {
      const cur = d.layers[i] ?? standardCategoryId(i);
      const sel = h('select', {
        'aria-label': t('Kategorie von Layer {layer}', { layer: layerLabel(i) }),
        onchange: (e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v === standardCategoryId(i)) delete d.layers[i];
          else d.layers[i] = v;
        },
      }, ...d.categories.map((c) => h('option', { value: c.id, selected: c.id === cur }, categoryName(c))));
      grid.append(h('span', { class: 'swatch', style: `background:${PALETTE[i]}` }, layerLabel(i)), sel);
    }
    return h('div', {},
      h('label', { class: 'check', title: t('Neue Projekte (Neu, neuer Reiter, Schließen des letzten Reiters, erster Start) bekommen diese Layer. Geöffnete Dateien bleiben, wie sie sind.') },
        h('input', { type: 'checkbox', checked: d.apply, onchange: (e: Event) => (d.apply = (e.target as HTMLInputElement).checked) }),
        t('Auf neue Projekte anwenden')),
      h('div', { class: 'note' }, t('Jeder Layer 00–29 bekommt die Einstellungen seiner Kategorie. Die Kategorien bearbeitest du im zweiten Reiter.')),
      grid,
      h('div', { class: 'layer-tools' },
        h('button', {
          type: 'button',
          class: 'btn',
          title: t('Speichert die Vorgaben und setzt die Layer 00–29 dieses Projekts auf die Einstellungen ihrer Kategorien (ein Undo-Schritt). Geänderte Layer bekommen wieder ihren Standardnamen (C03). Layer mit Bildern bleiben, wie sie sind.'),
          onclick: applyToProject,
        }, t('Auf dieses Projekt anwenden')),
      ),
      status,
    );
  };

  const applyToProject = () => {
    commit();
    const { changed, skipped } = applyCategoriesToProject(ed, d, t('Layer-Vorgaben anwenden'));
    // Welche benutzten Layer jetzt andere Einstellungen haben, damit vor dem Lasern nichts unbemerkt bleibt
    const used = new Set(ed.usedLayers());
    const shown = changed.filter((i) => used.has(i)).map(layerLabel);
    const lines = [
      !changed.length
        ? t('Die Layer dieses Projekts entsprechen schon den Vorgaben.')
        : shown.length
          ? t('Geändert: {layers} (rückgängig mit Ctrl+Z).', { layers: shown.join(', ') })
          : t('Layer dieses Projekts angepasst (rückgängig mit Ctrl+Z).'),
      skipped.length ? t('Nicht geändert, weil Bilder darauf liegen: {layers}.', { layers: skipped.map(layerLabel).join(', ') }) : '',
    ];
    status.textContent = lines.filter(Boolean).join(' ');
  };

  // ---------- Reiter Kategorien ----------
  const summary = h('div', { class: 'note' });
  const selected = () => d.categories.find((c) => c.id === selId) ?? d.categories[0];
  const renderSummary = () => {
    const c = selected();
    summary.textContent = settingsSummary({ ...c.cut, layerType: c.type }) + (c.cut.sub?.length ? ` + ${t('Linie')}` : '');
  };
  const modeOf = (c: LayerCategory): ModeChoice => (c.cut.mode === 'line' ? 'line' : c.cut.sub?.length ? 'fill-line' : 'fill');
  const setMode = (c: LayerCategory, m: ModeChoice) => {
    c.cut.mode = m === 'line' ? 'line' : 'fill';
    if (m === 'fill-line') c.cut.sub = c.cut.sub?.length ? c.cut.sub : [defaultSubLayer('line')];
    else delete c.cut.sub;
  };
  /** Einstellungen übernehmen (aktiver Layer, Bibliothek); bei eingebauten bleibt die Art */
  const takeOver = (c: LayerCategory, s: Layer | LayerCategory['cut']) => {
    const n = categoryFrom(s);
    c.cut = n.cut;
    if (!isBuiltinCategory(c.id)) c.type = n.type;
  };

  const categoriesTab = () => {
    const c = selected();
    const builtin = isBuiltinCategory(c.id);
    const list = h('div', { class: 'ld-list', role: 'listbox', 'aria-label': t('Kategorien') });
    let selBtn: HTMLButtonElement | null = null;
    list.append(...d.categories.map((x) => {
      const b = h('button', {
        type: 'button',
        role: 'option',
        class: x.id === c.id ? 'on' : '',
        'aria-selected': x.id === c.id ? 'true' : 'false',
        onclick: () => ((selId = x.id), render()),
      }, categoryName(x));
      if (x.id === c.id) selBtn = b;
      return b;
    }));
    const add = (cat: LayerCategory) => {
      d.categories.push(cat);
      selId = cat.id;
      render();
    };
    const listTools = h('div', { class: 'layer-tools' },
      h('button', { type: 'button', onclick: () => add({ ...builtinCategory('cut'), id: newCategoryId(), name: t('Neue Kategorie') }) }, t('Neu')),
      h('button', { type: 'button', onclick: () => add({ ...structuredClone(c), id: newCategoryId(), name: t('{name} (Kopie)', { name: categoryName(c) }) }) }, t('Duplizieren')),
      builtin
        ? h('button', {
            type: 'button',
            title: t('Eingebaute Kategorie auf die Werkswerte zurücksetzen'),
            onclick: () => {
              d.categories[d.categories.indexOf(c)] = builtinCategory(c.type);
              render();
            },
          }, t('Zurücksetzen'))
        : h('button', {
            type: 'button',
            title: t('Kategorie löschen; ihre Layer bekommen wieder die Standard-Kategorie'),
            onclick: () => {
              d.categories = d.categories.filter((x) => x !== c);
              for (const [k, v] of Object.entries(d.layers)) if (v === c.id) delete d.layers[Number(k)];
              selId = d.categories[0].id;
              render();
            },
          }, t('Löschen')),
    );

    const typeSel = h('select', {
      disabled: builtin,
      title: builtin ? t('Die Art einer eingebauten Kategorie steht fest') : '',
      onchange: (e: Event) => ((c.type = (e.target as HTMLSelectElement).value as LayerType), render()),
    }, ...LAYER_TYPES.map((k) => h('option', { value: k, selected: c.type === k }, layerTypeName(k))));
    const mode = modeOf(c);
    const modeSel = h('select', { onchange: (e: Event) => (setMode(c, (e.target as HTMLSelectElement).value as ModeChoice), render()) },
      h('option', { value: 'line', selected: mode === 'line' }, t('Linie')),
      h('option', { value: 'fill', selected: mode === 'fill' }, t('Füllen')),
      h('option', { value: 'fill-line', selected: mode === 'fill-line' }, t('Füllen + Linie')),
    );
    const s = c.cut;
    const sub = s.sub?.[0];
    const check = (label: string, get: () => boolean, set: (v: boolean) => void) =>
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => (set((e.target as HTMLInputElement).checked), renderSummary()) }), label);
    const active = ed.activeLayer ?? ed.currentLayer;
    const libSel = h('select', {
      'aria-label': t('Aus der Bibliothek'),
      disabled: !library.entries.length,
      onchange: (e: Event) => {
        const entry = library.entries.find((x) => x.id === (e.target as HTMLSelectElement).value);
        if (!entry) return;
        takeOver(c, entry.settings);
        render();
      },
    },
      h('option', { value: '', selected: true }, library.entries.length ? t('Aus der Bibliothek …') : t('Bibliothek ist leer')),
      ...library.entries.map((x) => h('option', { value: x.id }, entryLabel(x))),
    );
    const form = h('div', { class: 'form' },
      ...row(t('Name'), h('input', {
        type: 'text',
        value: c.name,
        placeholder: builtin ? layerTypeName(c.type) : '',
        oninput: (e: Event) => {
          c.name = (e.target as HTMLInputElement).value.trim();
          if (selBtn) selBtn.textContent = categoryName(c);
        },
      })),
      ...row(t('Art'), typeSel),
      ...row(t('Modus'), modeSel),
      ...row(t('Geschwindigkeit (mm/min)'), num(() => s.speed, (v) => (s.speed = v), 1, 100000)),
      ...row(t('Max. Leistung (%)'), num(() => s.power, (v) => (s.power = v), 0, 100)),
      ...row(t('Min. Leistung (%)'), num(() => s.minPower, (v) => (s.minPower = v), 0, 100)),
      ...row(t('Durchgänge'), num(() => s.passes, (v) => (s.passes = v), 1, 100, true)),
      ...(s.mode === 'fill' ? row(t('Zeilenabstand (mm)'), num(() => s.interval, (v) => (s.interval = v), 0.01, 5)) : []),
      ...row(t('Kerf-Versatz (mm)'), num(() => s.kerf, (v) => (s.kerf = v), -5, 5)),
      h('span', { class: 'checks' }, check(t('Air Assist'), () => s.air, (v) => (s.air = v))),
      ...(sub
        ? [
            h('div', { class: 'form-title' }, t('Linie (Sub-Layer)')),
            ...row(t('Geschwindigkeit (mm/min)'), num(() => sub.speed, (v) => (sub.speed = v), 1, 100000, false, t('Linie: Geschwindigkeit (mm/min)'))),
            ...row(t('Max. Leistung (%)'), num(() => sub.power, (v) => (sub.power = v), 0, 100, false, t('Linie: Max. Leistung (%)'))),
            ...row(t('Durchgänge'), num(() => sub.passes, (v) => (sub.passes = v), 1, 100, true, t('Linie: Durchgänge'))),
          ]
        : []),
    );
    renderSummary();
    return h('div', { class: 'ld-cats' },
      h('div', {}, list, listTools),
      h('div', {},
        builtin ? h('div', { class: 'note' }, t('Eingebaute Kategorie: lässt sich zurücksetzen, aber nicht löschen.')) : null,
        form,
        summary,
        h('div', { class: 'note' }, t('Weitere Einstellungen (Haltestege, Perforation, Füllart …) kommen vollständig mit:')),
        h('div', { class: 'layer-tools' },
          h('button', {
            type: 'button',
            title: t('Alle Einstellungen von Layer {layer} in diese Kategorie übernehmen', { layer: layerLabel(active) }),
            // Ohne ed.layer(): das legte einen fehlenden Layer im Projekt an
            onclick: () => (takeOver(c, normalizeLayer(structuredClone(ed.doc.layers[active] ?? defaultLayer(active)))), render()),
          }, t('Vom aktiven Layer ({layer})', { layer: layerLabel(active) })),
          libSel,
        ),
      ),
    );
  };

  const render = () => {
    tabBar.replaceChildren(
      h('button', { type: 'button', role: 'tab', class: `tab${tab === 'layers' ? ' on' : ''}`, onclick: () => ((tab = 'layers'), render()) }, t('Layer')),
      h('button', { type: 'button', role: 'tab', class: `tab${tab === 'categories' ? ' on' : ''}`, onclick: () => ((tab = 'categories'), render()) }, t('Kategorien')),
    );
    body.replaceChildren(tab === 'layers' ? layersTab() : categoriesTab());
  };

  let ok = false;
  const dlg = h('dialog', { class: 'layer-defaults-dialog' },
    h('h3', {}, t('Layer-Vorgaben')),
    tabBar,
    body,
    h('div', { class: 'dialog-buttons' },
      h('button', {
        class: 'btn',
        title: t('Alle Kategorien und Zuordnungen auf die Werkswerte zurücksetzen (gilt erst mit OK)'),
        onclick: () => {
          d = defaultLayerDefaults();
          cleared = true;
          selId = d.categories[0].id;
          render();
        },
      }, t('Alles zurücksetzen')),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', { class: 'btn primary', onclick: () => ((ok = true), dlg.close()) }, t('OK')),
    ),
  );
  render();
  showDialog(dlg, () => {
    if (ok) commit();
  });
}
