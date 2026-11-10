// Fenster „Prüfung“ (Konstruktion prüfen): Befunde der aktuellen Seite als Liste. Klick auf einen Befund wählt die
// betroffenen Objekte aus und zeigt die Stelle, die auf der Arbeitsfläche markiert ist; wo es geht, gibt es eine
// Korrektur. Solange das Fenster zu sehen ist, wird nach jeder Änderung neu geprüft.
import type { Editor } from './editor';
import { h } from './dom';
import { dec, t, tn } from './i18n';
import { dockWindow, isShown, onWindowShow, setBadge, showWindow } from './dock';
import { CheckIssue, CheckKind, CheckSettings, fixLabel, loadCheckSettings, saveCheckSettings } from './check';
import { objLabel } from './objectsPanel';
import { isCutLayer, layerLabel, PALETTE } from './model';

const KIND_NAMES = (): Record<CheckKind, string> => ({
  double: t('Doppelte Linie'),
  open: t('Offener Umriss'),
  unjoined: t('Nicht verbunden'),
  web: t('Schmaler Steg'),
  hole: t('Kleiner Ausschnitt'),
  bed: t('Arbeitsbereich'),
  import: t('Import'),
  fit: t('Passung'),
  thickness: t('Materialdicke'),
  loose: t('Zusammenhalt'),
  insert: t('Stecken'),
});

let openPanel: (() => void) | null = null;

/** Fenster zeigen und sofort prüfen (Menü Laser → Konstruktion prüfen) */
export function openCheck() {
  showWindow('check');
  openPanel?.();
}

export function buildCheckPanel(ed: Editor) {
  const body = dockWindow('check', t('Prüfung'), { near: 'history' });
  const summary = h('span', { class: 'chk-summary muted' });
  const settingsBox = h('div', { class: 'chk-settings', hidden: true });
  const bar = h('div', { class: 'hist-bar chk-bar' },
    h('button', { class: 'small', title: t('Aktuelle Seite jetzt prüfen'), onclick: () => run(true) }, t('Prüfen')),
    summary,
    h('button', { class: 'small', title: t('Einstellungen der Prüfung'), onclick: () => ((settingsBox.hidden = !settingsBox.hidden), settingsBox.hidden || buildSettings()) }, '⚙'),
  );
  const list = h('div', { class: 'chk-list' });
  body.append(bar, settingsBox, list);

  const num = (label: string, title: string, get: (s: CheckSettings) => number, set: (s: CheckSettings, v: number) => void, step: number) => {
    const s = loadCheckSettings();
    const inp = h('input', { type: 'number', min: '0', step: String(step), value: String(get(s)), title });
    inp.addEventListener('change', () => {
      const v = Number(inp.value.replace(',', '.'));
      if (!Number.isFinite(v) || v < 0) return;
      const cur = loadCheckSettings();
      set(cur, v);
      saveCheckSettings(cur);
      run(true);
    });
    return h('label', { class: 'chk-field', title }, h('span', {}, label), inp, h('span', { class: 'muted' }, 'mm'));
  };
  const buildSettings = () => {
    const s = loadCheckSettings();
    const lineLayers = ed.usedLayers().filter((i) => isCutLayer(ed.layer(i)) && ed.layer(i).output);
    const chips = lineLayers.map((i) => {
      const cb = h('input', { type: 'checkbox', checked: s.engraveLayers.includes(i) });
      cb.addEventListener('change', () => {
        const cur = loadCheckSettings();
        cur.engraveLayers = cb.checked ? [...new Set([...cur.engraveLayers, i])] : cur.engraveLayers.filter((x) => x !== i);
        saveCheckSettings(cur);
        run(true);
      });
      return h('label', { class: 'chk-chip', title: ed.layer(i).name }, cb, h('span', { class: 'chk-swatch', style: `background:${PALETTE[i]}` }), layerLabel(i));
    });
    const before = h('input', { type: 'checkbox', checked: s.beforeLaser });
    before.addEventListener('change', () => {
      const cur = loadCheckSettings();
      cur.beforeLaser = before.checked;
      saveCheckSettings(cur);
    });
    settingsBox.replaceChildren(
      num(t('Mindeststeg'), t('Schmalere Stege zwischen zwei Schnitten werden gemeldet'), (x) => x.minWeb, (x, v) => (x.minWeb = v), 0.1),
      num(t('Schnittbreite'), t('Breite der Schnittfuge, wenn der Layer keinen Kerf-Versatz hat (sonst doppelter Kerf)'), (x) => x.beam, (x, v) => (x.beam = v), 0.01),
      num(t('Lücke bis'), t('Offene Umrisse, deren Enden höchstens so weit auseinanderliegen, gelten als versehentlich offen'), (x) => x.closeGap, (x, v) => (x.closeGap = v), 0.1),
      lineLayers.length
        ? h('div', { class: 'chk-field chk-layers' },
            h('span', { title: t('Linien auf diesen Layern werden nur graviert: Sie zählen nicht als Schnitt für Stege und Ausschnitte') }, t('Nur Gravur:')),
            ...chips)
        : '',
      h('label', { class: 'chk-field' }, before, h('span', {}, t('Vor dem Lasern prüfen und bei Problemen nachfragen'))),
    );
  };

  let lastKey = '';
  const row = (x: CheckIssue) => {
    const names = x.objs.slice(0, 3).map(objLabel).join(', ') + (x.objs.length > 3 ? ' …' : '');
    const el = h('div', {
      class: `chk-row lvl-${x.level}${ed.checkActive?.key === x.key ? ' cur' : ''}`,
      title: t('Klicken: Objekt auswählen und Stelle zeigen'),
      onclick: () => {
        ed.focusIssue(x);
        list.querySelectorAll('.chk-row.cur').forEach((r) => r.classList.remove('cur'));
        el.classList.add('cur');
      },
    },
      h('span', { class: 'chk-dot' }),
      h('div', { class: 'chk-text' },
        h('div', { class: 'chk-msg' }, x.msg),
        h('div', { class: 'chk-objs muted' }, `${KIND_NAMES()[x.kind]} · ${names}`),
        x.fix
          ? h('button', {
              class: 'small chk-fix',
              title: t('Korrektur anwenden (rückgängig machbar)'),
              onclick: (e: Event) => {
                e.stopPropagation();
                void ed.applyCheckFix(x).then(() => render(true));
              },
            }, fixLabel(x.fix))
          : ''),
      h('button', {
        class: 'small chk-ignore',
        title: t('Diesen Hinweis bis zum Neustart ausblenden'),
        onclick: (e: Event) => {
          e.stopPropagation();
          ed.ignoreIssue(x);
          render(true);
        },
      }, '×'),
    );
    return el;
  };

  const render = (force = false) => {
    const xs = ed.checkIssues;
    const serious = xs.filter((x) => x.level !== 'info').length;
    setBadge('check', serious ? String(serious) : '');
    if (!isShown('check')) return;
    const key = xs.map((x) => x.key + x.msg).join('\n');
    if (!force && key === lastKey) return;
    lastKey = key;
    const errors = xs.filter((x) => x.level === 'error').length;
    summary.textContent = xs.length
      ? [errors ? tn('{n} Fehler|one', '{n} Fehler', errors) : '', serious - errors ? tn('{n} Warnung', '{n} Warnungen', serious - errors) : '', xs.length - serious ? tn('{n} Hinweis', '{n} Hinweise', xs.length - serious) : '']
          .filter(Boolean)
          .join(', ')
      : t('Keine Probleme gefunden.');
    list.replaceChildren(...xs.map(row));
    if (!xs.length)
      list.append(h('div', { class: 'empty' },
        t('Geprüft werden doppelte Schnittlinien, offene Umrisse, schmale Stege (unter {w} mm), zu kleine Ausschnitte, Passungen von Steckverbindungen, der Arbeitsbereich und Import-Hinweise der aktuellen Seite.', { w: dec(String(loadCheckSettings().minWeb)) })));
  };

  let timer = 0;
  const run = (now = false) => {
    clearTimeout(timer);
    const go = () => {
      ed.runCheck();
      render(true);
    };
    if (now) go();
    else timer = window.setTimeout(go, 300);
  };
  openPanel = () => run(true);
  ed.on((what) => {
    if (what !== 'doc') return;
    if (isShown('check')) run();
    else if (ed.checkIssues.length) {
      // Alte Befunde nicht mehr anzeigen, bis wieder geprüft wird
      ed.checkIssues = [];
      ed.checkActive = null;
      setBadge('check', '');
    }
  });
  onWindowShow('check', () => {
    ed.checkMarks = true;
    run(true);
  });
  // Markierungen nur, solange das Fenster zu sehen ist
  const watch = () => {
    const shown = isShown('check');
    if (shown !== ed.checkMarks) {
      ed.checkMarks = shown;
      if (shown) run(true);
      ed.redraw();
    }
    window.setTimeout(watch, 500);
  };
  watch();
}
