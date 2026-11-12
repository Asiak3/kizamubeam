// Layer-Einstellungen (wie der Cut Settings Editor in LightBurn): öffnet per Doppelklick auf einen Layer.
// Bearbeitet wird eine Kopie; „Übernehmen“ schreibt alles als einen Undo-Schritt zurück.
// Sub-Layer bearbeiten dieselben Formen nach dem Layer (z. B. erst füllen, dann ausschneiden) und haben eigene Reiter.
import type { Editor } from './editor';
import { h, numInput } from './dom';
import { CutSettings, cutSettings, defaultCutSettings, defaultSubLayer, FillStyle, IMAGE_LAYER_DEFAULTS, LayerMode, layerLabel, PALETTE, SubLayer } from './model';
import { t } from './i18n';
import { lookEditor } from './view3d/lookui';
import { guessLook, lookName, resolveLook } from './view3d/looks';
import { library } from './materials';
import { imageLayerFields } from './imageLayerFields';

/** Opens "Adjust Image" for a layer; set by the UI module (it lives there) */
let openAdjust: ((ed: Editor, layer: number) => void) | null = null;
export const setAdjustOpener = (fn: (ed: Editor, layer: number) => void) => (openAdjust = fn);

export function openLayerDialog(ed: Editor, i: number) {
  const L = ed.layer(i);
  const c: CutSettings = cutSettings(L);
  // Images use speed, power and passes of the layer; their own image settings are edited live and reverted on cancel
  const parts = ed.layerParts(i);
  const vecs = parts.vec || !parts.img;
  const origImg = parts.img ? { ...ed.imgLayer(i) } : null;
  let name = L.name;
  let output = L.output;
  c.sub = c.sub?.map((s) => structuredClone(s)) ?? [];
  const subs = c.sub;
  /** Bearbeiteter Reiter: -1 = Layer, sonst Index des Sub-Layers */
  let tab = -1;
  type Entry = Omit<CutSettings, 'air' | 'look' | 'sub'>;
  const cur = (): Entry => (tab < 0 ? c : subs[tab]);

  const num = (get: () => number, set: (v: number) => void, min: number, max: number, int = false, title?: string) => {
    const el = numInput('', (v) => {
      set(Math.max(min, Math.min(max, int ? Math.round(v) : v)));
      el.value = String(get());
    }, title);
    el.value = String(get());
    return el;
  };
  const check = (label: string, get: () => boolean, set: (v: boolean) => void, title?: string, after?: () => void) =>
    h('label', { class: 'check', title }, h('input', { type: 'checkbox', checked: get(), onchange: (e: Event) => (set((e.target as HTMLInputElement).checked), after?.()) }), label);
  const row = (label: string, el: HTMLElement, title?: string) => [h('label', { title }, label), el];

  const tabBar = h('div', { class: 'sub-tabs' });
  /** Sub-Layer k entfernen; danach den benachbarten Reiter (oder den Layer) zeigen */
  const removeSub = (k: number) => {
    if (k < 0 || k >= subs.length) return;
    subs.splice(k, 1);
    if (tab === k) tab = Math.min(k, subs.length - 1);
    else if (tab > k) tab--;
    render();
  };
  const general = h('div', { class: 'form' });
  const modeBox = h('div');
  const render = () => {
    const e = cur();
    tabBar.replaceChildren(
      h('button', { type: 'button', class: `btn small${tab < 0 ? ' active' : ''}`, onclick: () => ((tab = -1), render()) }, t('Layer')),
      ...subs.map((s, k) =>
        h('span', { class: `sub-tab${tab === k ? ' active' : ''}${s.output ? '' : ' off'}` },
          h('button', {
            type: 'button',
            class: 'btn small',
            title: s.output ? '' : t('Nicht ausgegeben'),
            onclick: () => ((tab = k), render()),
          }, t('Sub-Layer {n}', { n: k + 1 })),
          h('button', {
            type: 'button',
            class: 'btn small sub-del',
            title: t('Sub-Layer entfernen'),
            onclick: (ev: Event) => (ev.stopPropagation(), removeSub(k)),
          }, '×'),
        ),
      ),
      h('button', {
        class: 'btn small',
        title: t('Weitere Bearbeitung derselben Formen nach diesem Layer, z. B. erst gravieren, dann ausschneiden'),
        onclick: () => {
          subs.push(defaultSubLayer(c.mode === 'fill' ? 'line' : 'fill'));
          tab = subs.length - 1;
          render();
        },
      }, t('+ Sub-Layer')),
    );
    const modeSel = h('select', {
      onchange: (ev: Event) => {
        e.mode = (ev.target as HTMLSelectElement).value as LayerMode;
        render();
      },
    },
      h('option', { value: 'line', selected: e.mode === 'line' }, t('Linie')),
      h('option', { value: 'fill', selected: e.mode === 'fill' }, t('Füllen')),
    );
    const sub = tab >= 0 ? subs[tab] : null;
    general.replaceChildren(
      ...(sub ? [] : row(t('Name'), h('input', { type: 'text', value: name, oninput: (ev: Event) => (name = (ev.target as HTMLInputElement).value) }))),
      ...(vecs ? row(t('Modus'), modeSel) : []),
      ...row(t('Geschwindigkeit (mm/min)'), num(() => e.speed, (v) => (e.speed = v), 1, 100000)),
      ...row(t('Max. Leistung (%)'), num(() => e.power, (v) => (e.power = v), 0, 100)),
      ...row(t('Min. Leistung (%)'), num(() => e.minPower, (v) => (e.minPower = v), 0, 100, false, t('Leistung in Ecken (Leistungsrampe) und bei Bildern in Graustufen'))),
      ...row(t('Durchgänge'), num(() => e.passes, (v) => (e.passes = v), 1, 100, true)),
      ...(!vecs ? [] : row(t('Kerf-Versatz (mm)'), num(() => e.kerf, (v) => (e.kerf = v), -5, 5, false, t('Positiv: Außenkonturen wandern nach außen, Löcher nach innen. Etwa die halbe Schnittbreite eintragen, damit Teile maßhaltig werden.')))),
      ...(!vecs ? [] : row(t('Z-Versatz (mm)'), num(() => e.zOffset, (v) => (e.zOffset = v), -50, 50, false, t('Fokus beim ersten Durchgang verschieben, positiv = tiefer ins Material. Braucht eine Z-Achse (Geräteeinstellungen); bezogen auf die Höhe beim Start.')))),
      ...(!vecs ? [] : row(t('Je Durchgang tiefer (mm)'), num(() => e.zStep, (v) => (e.zStep = v), -20, 20, false, t('Fokus nach jedem Durchgang um diesen Wert tiefer setzen, z. B. bei dickem Material. Am Ende fährt Z zurück.')))),
      sub
        ? h('span', { class: 'checks' },
            check(t('Ausgabe'), () => sub.output, (v) => (sub.output = v), t('Sub-Layer beim Lasern ausgeben'), render),
            h('button', { type: 'button', class: 'btn small', onclick: () => removeSub(tab) }, t('Sub-Layer entfernen')),
          )
        : h('span', { class: 'checks' },
            check(t('Air Assist'), () => c.air, (v) => (c.air = v), t('Luftunterstützung während dieses Layers einschalten (M8/M7, aus mit M9). Gilt auch für Bilder und Sub-Layer auf diesem Layer.')),
            check(t('Ausgabe'), () => output, (v) => (output = v), t('Layer beim Lasern ausgeben')),
          ),
    );
    modeBox.replaceChildren(...(vecs ? [e.mode === 'line' ? lineSection(e) : fillSection(e)] : []));
    lookSection.hidden = !!sub;
    imageSection.hidden = !!sub;
  };

  const lineSection = (c: Entry) => {
    const T = c.tabs;
    const box = h('div', { class: 'form' });
    const fill = () => {
      box.replaceChildren(
        h('span', { class: 'checks' }, check(t('Haltestege (Tabs) setzen'), () => T.enabled, (v) => (T.enabled = v), t('An diesen Stellen bleibt der Laser aus, damit ausgeschnittene Teile nicht herausfallen'), fill)),
        ...(T.enabled
          ? [
              ...row(t('Steglänge (mm)'), num(() => T.size, (v) => (T.size = v), 0.05, 50)),
              h('label', {}, t('Verteilung')),
              h('span', { class: 'radios' },
                h('label', {}, h('input', { type: 'radio', name: `tabs-${i}`, checked: T.useCount, onchange: () => ((T.useCount = true), fill()) }), t('Anzahl')),
                h('label', {}, h('input', { type: 'radio', name: `tabs-${i}`, checked: !T.useCount, onchange: () => ((T.useCount = false), fill()) }), t('Abstand')),
              ),
              ...(T.useCount
                ? row(t('Stege je Form'), num(() => T.count, (v) => (T.count = v), 1, 100, true))
                : row(t('Abstand (mm)'), num(() => T.spacing, (v) => (T.spacing = v), 1, 10000))),
              h('span', { class: 'checks' }, check(t('Innere Formen auslassen'), () => T.skipInner, (v) => (T.skipInner = v), t('Löcher und Formen innerhalb anderer Formen fallen heraus und brauchen keine Stege'))),
            ]
          : []),
      );
    };
    fill();
    return h('div', {}, h('div', { class: 'form-title' }, t('Linie')), box, perfSection(c), leadSection(c), rampSection(c));
  };

  /** Aufklappbarer Abschnitt, offen, wenn die Funktion eingeschaltet ist */
  const fold = (title: string, open: boolean, tip: string, ...body: HTMLElement[]) =>
    h('details', { class: 'cut-extra', open }, h('summary', { title: tip }, title), ...body);

  const perfSection = (c: Entry) => {
    const P = c.perf;
    return fold(t('Perforation'), P.enabled, t('Gestrichelt schneiden: abwechselnd ein Stück schneiden und eine Lücke stehen lassen, z. B. für Abreißkanten oder Falzlinien'),
      h('div', { class: 'form' },
        h('span', { class: 'checks' }, check(t('Perforieren'), () => P.enabled, (v) => (P.enabled = v))),
        ...row(t('Schnittlänge (mm)'), num(() => P.on, (v) => (P.on = v), 0.01, 1000)),
        ...row(t('Lücke (mm)'), num(() => P.off, (v) => (P.off = v), 0, 1000)),
      ),
    );
  };

  const leadSection = (c: Entry) => {
    const Ld = c.lead;
    const box = h('div', { class: 'form' });
    const fill = () =>
      box.replaceChildren(
        h('span', { class: 'checks' },
          check(t('Anschnitt (Lead-In)'), () => Ld.leadIn, (v) => (Ld.leadIn = v), t('Der Schnitt beginnt neben der Kontur, so bleibt am Startpunkt keine Brandstelle')),
          check(t('Auslauf (Lead-Out)'), () => Ld.leadOut, (v) => (Ld.leadOut = v), t('Der Schnitt endet neben der Kontur')),
        ),
        ...row(t('Länge (mm)'), num(() => Ld.length, (v) => (Ld.length = v), 0, 100)),
        h('label', {}, t('Form')),
        h('span', { class: 'radios' },
          h('label', {}, h('input', { type: 'radio', name: `lead-${i}`, checked: !Ld.arc, onchange: () => ((Ld.arc = false), fill()) }), t('Gerade')),
          h('label', {}, h('input', { type: 'radio', name: `lead-${i}`, checked: Ld.arc, onchange: () => ((Ld.arc = true), fill()) }), t('Bogen')),
        ),
        ...row(Ld.arc ? t('Bogenwinkel (°)') : t('Winkel zur Kontur (°)'), num(() => Ld.angle, (v) => (Ld.angle = v), Ld.arc ? 1 : 0, Ld.arc ? 180 : 90, false, Ld.arc ? t('Wie weit der Bogen um die Ecke führt') : t('90° = senkrecht zur Kontur, 0° = in Verlängerung'))),
        ...row(t('Überschnitt (mm)'), num(() => Ld.overcut, (v) => (Ld.overcut = v), 0, 100, false, t('Nach dem Schließen der Form so weit weiter schneiden, damit sich Anfang und Ende sicher treffen'))),
      );
    fill();
    return fold(t('Anschnitt und Überschnitt'), Ld.leadIn || Ld.leadOut || Ld.overcut > 0, t('Nur für geschlossene Formen. Anschnitt und Auslauf liegen immer auf der Abfallseite: außen bei Außenkonturen, innen bei Löchern.'), box);
  };

  const rampSection = (c: Entry) => {
    const R = c.ramp;
    return fold(t('Leistungsrampe'), R.enabled, t('In Ecken wird die Maschine langsamer; damit sie dort nicht stärker brennt, sinkt die Leistung zur Ecke hin auf die Min. Leistung'),
      h('div', { class: 'form' },
        h('span', { class: 'checks' }, check(t('Leistung in Ecken absenken'), () => R.enabled, (v) => (R.enabled = v))),
        ...row(t('Rampenlänge (mm)'), num(() => R.length, (v) => (R.length = v), 0.05, 50, false, t('Auf dieser Strecke vor und nach der Ecke steigt die Leistung von Min. auf Max.'))),
        ...row(t('Ab Richtungswechsel (°)'), num(() => R.angle, (v) => (R.angle = v), 1, 179, false, t('Nur Ecken, an denen sich die Richtung mindestens so stark ändert'))),
        h('span', { class: 'checks' }, check(t('Auch an Anfang und Ende'), () => R.ends, (v) => (R.ends = v))),
      ),
    );
  };

  const fillSection = (c: Entry) => {
    const interval = num(() => c.interval, (v) => ((c.interval = v), (lpi.value = String(Math.round(25.4 / v)))), 0.01, 5, false, t('Abstand der Füllzeilen in mm'));
    const lpi = num(() => Math.round(25.4 / c.interval), (v) => ((c.interval = Math.round((25.4 / v) * 10000) / 10000), (interval.value = String(c.interval))), 5, 2540, false, t('Zeilen pro Zoll'));
    const style = h('select', {
      onchange: (e: Event) => {
        c.fillStyle = (e.target as HTMLSelectElement).value as FillStyle;
        render();
      },
    },
      h('option', { value: 'scan', selected: c.fillStyle !== 'offset' }, t('Zeilenweise')),
      h('option', { value: 'offset', selected: c.fillStyle === 'offset' }, t('Kontur folgend')),
    );
    return h('div', {},
      h('div', { class: 'form-title' }, t('Füllen')),
      h('div', { class: 'form' },
        ...row(t('Füllart'), style, t('Zeilenweise: Fläche Zeile für Zeile abtasten. Kontur folgend: Ringe, die dem Umriss nach innen folgen (gut für schmale Rahmen, Schrift und Ornamente).')),
        ...row(t('Zeilenabstand (mm)'), interval),
        ...row(t('Zeilen pro Zoll'), lpi),
        ...(c.fillStyle === 'offset'
          ? []
          : [
              ...row(t('Scanwinkel (°)'), num(() => c.angle, (v) => (c.angle = v), -180, 180, false, t('0° = waagerechte Zeilen, 90° = senkrechte'))),
              ...row(t('Überfahrweg (%)'), num(() => c.overscan, (v) => (c.overscan = v), 0, 50, false, t('Anlauf- und Auslaufweg in % der Geschwindigkeit, damit der Rand gleichmäßig wird'))),
              h('span', { class: 'checks' },
                check(t('Bidirektional'), () => c.bidirectional, (v) => (c.bidirectional = v), t('In beide Richtungen lasern (schneller)')),
                check(t('Kreuzschraffur'), () => c.crossHatch, (v) => (c.crossHatch = v), t('Zweiter Durchgang um 90° gedreht')),
              ),
            ]),
      ),
    );
  };

  // Aussehen der Platten dieses Layers in der 3D-Ansicht
  const autoName = () => {
    const g = guessLook(library.get(L.material)?.material ?? '');
    return g ? t('Automatisch ({name})', { name: lookName(resolveLook(g)) }) : t('Automatisch (Standard der 3D-Ansicht)');
  };
  const lookSection = h('div', {},
    h('div', { class: 'form-title', title: t('Wie Platten und Gravuren dieses Layers in der 3D-Ansicht aussehen. Automatisch: aus dem Namen des Materials der Bibliothek, sonst der Standard der 3D-Ansicht.') }, t('Aussehen in 3D')),
    h('div', { class: 'form look-form' },
      h('label', {}, t('Material')),
      lookEditor(() => c.look, (v) => (c.look = v), autoName()),
    ),
  );

  // Image settings of this layer (only when it holds images)
  const imageSection = h('div', {},
    ...(parts.img
      ? [
          h('div', { class: 'form-title' }, vecs ? t('Bilder') : t('Bild')),
          h('div', { class: 'form' }, ...imageLayerFields(ed, i, true)),
          openAdjust
            ? h('div', { class: 'layer-tools' }, h('button', {
                type: 'button',
                class: 'btn small',
                title: t('Helligkeit, Kontrast, Schärfen und Vorschau; die Layer-Einstellungen werden dabei übernommen'),
                onclick: () => {
                  applied = true;
                  dlg.close();
                  openAdjust?.(ed, i);
                },
              }, t('Bild anpassen …')))
            : null,
        ]
      : []),
  );

  let applied = false;
  const dlg = h(
    'dialog',
    { class: 'layer-dialog' },
    h('h3', {}, h('span', { class: 'swatch', style: `background:${PALETTE[i]}` }, layerLabel(i)), ' ', t('Layer-Einstellungen')),
    vecs ? tabBar : null,
    general,
    modeBox,
    imageSection,
    lookSection,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', {
        class: 'btn',
        title: t('Standardwerte für den gewählten Modus'),
        onclick: () => {
          if (tab < 0) Object.assign(c, { ...defaultCutSettings(c.mode), sub: subs }, vecs ? {} : IMAGE_LAYER_DEFAULTS);
          else subs[tab] = { ...defaultSubLayer(subs[tab].mode), output: subs[tab].output } as SubLayer;
          render();
        },
      }, t('Standardwerte')),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          applied = true;
          dlg.close();
        },
      }, t('Übernehmen')),
    ),
  );
  render();
  dlg.addEventListener('close', () => {
    // Felder schreiben ihre Werte beim Verlassen; der Klick auf „Übernehmen“ kommt danach
    // Image fields changed the layer live: restore first, so the undo step holds the state before the dialog
    const newImg = origImg ? { ...ed.imgLayer(i) } : null;
    if (origImg) L.img = { ...origImg };
    if (applied) {
      const before = JSON.stringify({ ...cutSettings(L), name: L.name, output: L.output, img: origImg ?? undefined });
      const after = { ...c, sub: subs.length ? subs : undefined, name: name.trim() || L.name, output, img: newImg ?? undefined };
      if (JSON.stringify(after) !== before) ed.updateLayer(i, after);
      else ed.emit('doc');
    } else if (origImg) ed.emit('doc');
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
}
