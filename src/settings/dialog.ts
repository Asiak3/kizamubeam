// Settings window (Edit → Settings …): sidebar with sections, search across all fields,
// changes take effect with OK. The fields themselves are registered in registry.ts.
import { evalExpr, h } from '../dom';
import { dec, t } from '../i18n';
import {
  applyChanges, loadValues, matchesSearch, sectionDefaults, SettingsField, SettingsSection, settingsSections, ValueField, visible,
} from './registry';

type Value = boolean | number | string;

let open: HTMLDialogElement | null = null;
let lastSection = '';

const fmtNum = (v: number) => dec(String(Math.round(v * 1000) / 1000));

/** Open the window, optionally at a section and with one field highlighted */
export async function openSettings(sectionId?: string, fieldId?: string) {
  if (open) {
    open.close();
    open = null;
  }
  const list = settingsSections();
  if (!list.length) return;
  const before = await loadValues(list);
  const draft = new Map(before);
  let current = list.find((s) => s.id === (sectionId || lastSection)) ?? list[0];

  const search = h('input', { type: 'search', class: 'settings-search', placeholder: t('Einstellungen durchsuchen …'), spellcheck: false }) as HTMLInputElement;
  const nav = h('nav', { class: 'settings-nav', role: 'tablist', 'aria-label': t('Bereiche') });
  const navSelect = h('select', { class: 'settings-nav-select', 'aria-label': t('Bereich') }) as HTMLSelectElement;
  const body = h('div', { class: 'settings-body' });
  const status = h('span', { class: 'settings-status note', role: 'status' });

  const control = (f: ValueField): HTMLElement => {
    const has = draft.has(f.id);
    const val = draft.get(f.id);
    const set = (v: Value) => draft.set(f.id, v);
    switch (f.kind) {
      case 'toggle': {
        const el = h('input', { type: 'checkbox', id: `set-${f.id}`, checked: !!val, disabled: !has }) as HTMLInputElement;
        el.onchange = () => set(el.checked);
        return el;
      }
      case 'select': {
        const el = h('select', { id: `set-${f.id}`, disabled: !has }, ...f.options().map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
        el.value = String(val ?? '');
        el.onchange = () => set(el.value);
        return el;
      }
      case 'number': {
        const el = h('input', { type: 'text', id: `set-${f.id}`, inputmode: 'decimal', disabled: !has, class: 'settings-num' }) as HTMLInputElement;
        el.value = has ? fmtNum(Number(val)) : '';
        el.onchange = () => {
          let v = evalExpr(el.value);
          if (v === null || !Number.isFinite(v)) {
            el.value = fmtNum(Number(draft.get(f.id)));
            return;
          }
          if (f.integer) v = Math.round(v);
          if (f.min !== undefined) v = Math.max(f.min, v);
          if (f.max !== undefined) v = Math.min(f.max, v);
          set(v);
          el.value = fmtNum(v);
        };
        return f.unit ? h('span', { class: 'settings-unit' }, el, ' ', f.unit) : el;
      }
      case 'text': {
        const el = h('input', { type: 'text', id: `set-${f.id}`, disabled: !has, maxlength: f.maxLength ? String(f.maxLength) : undefined }) as HTMLInputElement;
        el.value = String(val ?? '');
        if (f.placeholder) el.placeholder = f.placeholder();
        el.oninput = () => set(el.value);
        return el;
      }
      case 'color': {
        const color = h('input', { type: 'color', id: `set-${f.id}`, disabled: !has }) as HTMLInputElement;
        const autoBox = f.auto ? (h('input', { type: 'checkbox', disabled: !has }) as HTMLInputElement) : null;
        const fill = () => {
          const v = String(draft.get(f.id) ?? '');
          if (autoBox) autoBox.checked = !v;
          color.value = v || f.fallback?.() || '#808080';
          color.disabled = !has || (!!autoBox && !v);
        };
        color.oninput = () => set(color.value);
        if (autoBox) autoBox.onchange = () => (set(autoBox.checked ? '' : color.value), fill());
        fill();
        return h('span', { class: 'settings-color' }, ...(autoBox ? [h('label', {}, autoBox, ' ' + f.auto)] : []), color);
      }
    }
  };

  const row = (f: SettingsField): HTMLElement => {
    const hint = f.hint ? h('div', { class: 'note settings-hint' }, f.hint) : null;
    if (f.kind === 'action') {
      return h('div', { class: 'settings-row settings-action', 'data-field': f.id },
        h('div', { class: 'settings-label' }, h('span', {}, f.label), hint),
        h('div', { class: 'settings-ctl' }, h('button', { class: 'btn', type: 'button', onclick: () => f.run() }, f.button)));
    }
    if (f.kind === 'custom') {
      return h('div', { class: 'settings-row settings-custom', 'data-field': f.id }, h('div', { class: 'settings-label' }, h('span', {}, f.label), hint), f.render());
    }
    if (f.kind === 'toggle') {
      return h('div', { class: 'settings-row settings-toggle', 'data-field': f.id },
        h('label', { class: 'settings-label', for: `set-${f.id}` }, control(f), h('span', {}, f.label)),
        hint);
    }
    return h('div', { class: 'settings-row', 'data-field': f.id },
      h('div', { class: 'settings-label' }, h('label', { for: `set-${f.id}` }, f.label), hint),
      h('div', { class: 'settings-ctl' }, control(f)));
  };

  const sectionView = (s: SettingsSection, fields: SettingsField[], withTitle: boolean) => {
    const rows: HTMLElement[] = [];
    let group: string | undefined;
    for (const f of fields) {
      if (f.group && f.group !== group) rows.push(h('h5', { class: 'settings-group' }, f.group));
      group = f.group;
      rows.push(row(f));
    }
    return h('section', { class: 'settings-section', 'data-section': s.id },
      withTitle ? h('h4', {}, s.title) : null,
      !withTitle && s.note ? h('p', { class: 'note settings-note' }, s.note) : null,
      ...rows);
  };

  const render = () => {
    const q = search.value.trim();
    nav.querySelectorAll('button').forEach((b) => {
      const on = !q && b.dataset.section === current.id;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    });
    navSelect.value = current.id;
    if (q) {
      const parts = list
        .map((s) => [s, s.fields.filter((f) => visible(f) && matchesSearch(f, s, q))] as const)
        .filter(([, f]) => f.length);
      body.replaceChildren(...(parts.length ? parts.map(([s, f]) => sectionView(s, f, true)) : [h('p', { class: 'empty' }, t('Keine passende Einstellung gefunden.'))]));
      return;
    }
    const defaults = sectionDefaults(current);
    body.replaceChildren(
      h('div', { class: 'settings-head' },
        h('h4', {}, current.title),
        defaults.size
          ? h('button', {
              class: 'btn', type: 'button', title: t('Die Werte dieses Bereichs auf die Vorgaben setzen; wirksam erst mit OK'),
              onclick: () => {
                defaults.forEach((v, k) => before.has(k) && draft.set(k, v));
                render();
              },
            }, t('Standard'))
          : null),
      sectionView(current, current.fields.filter(visible), false),
    );
    body.scrollTop = 0;
  };

  for (const s of list) {
    nav.append(h('button', { type: 'button', role: 'tab', 'data-section': s.id, onclick: () => ((current = s), (lastSection = s.id), (search.value = ''), render()) }, s.title));
    navSelect.append(h('option', { value: s.id }, s.title));
  }
  navSelect.onchange = () => {
    current = list.find((s) => s.id === navSelect.value) ?? current;
    lastSection = current.id;
    search.value = '';
    render();
  };
  search.oninput = render;

  const ok = h('button', { class: 'btn primary', type: 'button' }, t('OK'));
  const dlg = h('dialog', { class: 'settings-dialog' },
    h('h3', {}, t('Einstellungen')),
    h('div', { class: 'settings-top' }, search, navSelect),
    h('div', { class: 'settings-main' }, nav, body),
    h('div', { class: 'dialog-buttons' },
      status,
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('Abbrechen')),
      ok),
  ) as HTMLDialogElement;
  ok.onclick = async () => {
    ok.disabled = true;
    const res = await applyChanges(list, before, draft);
    ok.disabled = false;
    if (res.errors.length) {
      const names = res.errors.map((e) => list.flatMap((s) => s.fields).find((f) => f.id === e.id)?.label ?? list.find((s) => s.id === e.id)?.title ?? e.id);
      const msg = res.errors.map((e) => (e.error instanceof Error ? e.error.message : String(e.error))).filter(Boolean)[0] ?? '';
      status.textContent = t('Nicht übernommen: {names}', { names: names.join(', ') }) + (msg ? ` (${msg})` : '');
      // what did work counts as the new starting point, so Cancel does not suggest it was undone
      for (const id of res.changed) before.set(id, draft.get(id)!);
      return;
    }
    dlg.close();
  };
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'search') {
      (e.target as HTMLInputElement).dispatchEvent(new Event('change'));
    }
  });
  dlg.addEventListener('close', () => {
    if (open === dlg) open = null;
    dlg.remove();
  });
  open = dlg;
  render();
  document.body.append(dlg);
  dlg.showModal();
  if (fieldId) {
    const el = body.querySelector<HTMLElement>(`[data-field="${CSS.escape(fieldId)}"]`);
    if (el) {
      el.classList.add('settings-flash');
      el.scrollIntoView({ block: 'center' });
      el.querySelector<HTMLElement>('input, select, button')?.focus();
    }
  } else search.focus();
}
