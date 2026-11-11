// Kleine DOM-Helfer für die Oberfläche: Elemente bauen, Zahlenfelder mit Formeln.
import { ICONS } from './icons';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) el.append(c);
  return el;
}

export const iconBtn = (icon: string, title: string, onclick: () => void, id?: string) =>
  h('button', { class: 'ib', title, html: ICONS[icon], onclick, id });

export const sep = () => h('div', { class: 'sep' });

/** Modal dialog that keeps its key presses away from the editor shortcuts and removes itself when closed */
export function showDialog(dlg: HTMLDialogElement, onClose: () => void = () => {}) {
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => (dlg.remove(), onClose()));
  document.body.append(dlg);
  dlg.showModal();
}

/** Zahlenfeld-Auswertung mit Einheiten und Grundrechenarten: „5in“, „100/3“, „2*(3+4)cm“. */
export function evalExpr(src: string): number | null {
  const s = src.replace(/,/g, '.').trim().toLowerCase();
  let i = 0;
  const peek = () => s[i];
  const ws = () => {
    while (s[i] === ' ') i++;
  };
  const unit = (v: number) => {
    ws();
    const m = /^(mm|cm|in|"|m)/.exec(s.slice(i));
    if (!m) return v;
    i += m[0].length;
    return v * ({ mm: 1, cm: 10, in: 25.4, '"': 25.4, m: 1000 } as Record<string, number>)[m[0]];
  };
  const atom = (): number => {
    ws();
    if (peek() === '(') {
      i++;
      const v = sum();
      ws();
      if (peek() !== ')') throw 0;
      i++;
      return unit(v);
    }
    if (peek() === '-') {
      i++;
      return -atom();
    }
    const m = /^\d*\.?\d+(e[-+]?\d+)?/.exec(s.slice(i));
    if (!m) throw 0;
    i += m[0].length;
    return unit(parseFloat(m[0]));
  };
  const prod = (): number => {
    let v = atom();
    for (;;) {
      ws();
      if (peek() === '*') (i++, (v *= atom()));
      else if (peek() === '/') (i++, (v /= atom()));
      else return v;
    }
  };
  const sum = (): number => {
    let v = prod();
    for (;;) {
      ws();
      if (peek() === '+') (i++, (v += prod()));
      else if (peek() === '-') (i++, (v -= prod()));
      else return v;
    }
  };
  try {
    const v = sum();
    ws();
    return i === s.length && isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export const f2 = (v: number) => (Math.round(v * 1000) / 1000).toFixed(Math.abs(v) >= 1000 ? 1 : 2);

/**
 * Eingabefeld, das bei Enter/Verlassen einen Ausdruck auswertet. onFormula: Eingaben, die keine einfache Zahl
 * sind (z. B. Formeln mit Projekt-Parametern), dorthin geben; true = angenommen.
 */
export function numInput(cls: string, onCommit: (v: number) => void, title?: string, onFormula?: (src: string) => boolean) {
  const el = h('input', { type: 'text', class: cls, title }) as HTMLInputElement;
  let before = '';
  el.addEventListener('focus', () => {
    before = el.value;
    el.select();
  });
  const commit = () => {
    if (el.value === before) return;
    const v = evalExpr(el.value);
    if (v === null && onFormula?.(el.value.trim())) before = el.value;
    else if (v === null) el.value = before;
    else {
      before = el.value;
      onCommit(v);
    }
  };
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      commit();
      el.blur();
    } else if (e.key === 'Escape') {
      el.value = before;
      el.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const v = evalExpr(el.value) ?? 0;
      const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      el.value = f2(v + (e.key === 'ArrowUp' ? step : -step));
      commit();
    }
  });
  el.addEventListener('blur', commit);
  return el;
}

export const setVal = (el: HTMLInputElement, v: string) => {
  if (document.activeElement !== el) el.value = v;
};
