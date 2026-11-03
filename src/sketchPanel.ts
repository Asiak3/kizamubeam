// Leiste des Skizzenmodus (oben über der Arbeitsfläche): Werkzeuge, Beziehungen für die Auswahl, Hilfsgeometrie,
// Zustand (Freiheitsgrade, voll bestimmt, Widerspruch), Fertig und Abbrechen. Dazu der Dialog für Bemaßungswerte.
import type { Editor } from './editor';
import { $, evalExpr, h } from './dom';
import { dec, t } from './i18n';
import { CON_BUTTONS, CON_GLYPHS, CON_LABELS, SkTool } from './editor/sketch';
import { evaluate } from './params';
import { setSolverWasm } from './sketch/solver';
import wasmUrl from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';

setSolverWasm(wasmUrl);

const TOOLS: [SkTool, string, string][] = [
  ['select', '↖', t('Auswählen und ziehen (S)')],
  ['line', '╱', t('Linie (L)')],
  ['rect', '▭', t('Rechteck (R)')],
  ['circle', '◯', t('Kreis (C)')],
  ['arc', '◠', t('Bogen (A)')],
  ['dim', '↔', t('Bemaßen (D)')],
];

const KEYS: Partial<Record<string, string>> = {
  coincident: 'O', horizontal: 'H', vertical: 'V', parallel: 'P', perpendicular: 'N', equal: 'E', tangent: 'T', concentric: 'X', midpoint: 'M', symmetric: 'Y', fixed: 'F',
};

export function installSketchPanel(ed: Editor) {
  const stage = $('#stage');
  const bar = h('div', { class: 'sketch-bar', hidden: true });
  stage.append(bar);
  const toolBtns = new Map<SkTool, HTMLButtonElement>();
  const conBtns = new Map<string, HTMLButtonElement>();
  const tools = h('div', { class: 'sketch-group' });
  for (const [id, glyph, label] of TOOLS) {
    const b = h('button', { class: 'btn', title: label, onclick: () => ed.setSketchTool(id) }, glyph) as HTMLButtonElement;
    toolBtns.set(id, b);
    tools.append(b);
  }
  const cons = h('div', { class: 'sketch-group' });
  for (const c of CON_BUTTONS) {
    const b = h('button', { class: 'btn', title: `${CON_LABELS[c]} (${KEYS[c]})`, onclick: () => ed.sketchConstrain(c) }, CON_GLYPHS[c] ?? '?') as HTMLButtonElement;
    conBtns.set(c, b);
    cons.append(b);
  }
  const aux = h('button', { class: 'btn', title: t('Hilfsgeometrie ein/aus (G): wird nicht gelasert'), onclick: () => ed.sketchToggleAux() }, '┄') as HTMLButtonElement;
  const del = h('button', { class: 'btn', title: t('Auswahl löschen (Entf)'), onclick: () => ed.sketchDeleteSel() }, '✕') as HTMLButtonElement;
  const status = h('span', { class: 'sketch-status' });
  const done = h('button', { class: 'btn primary', onclick: () => ed.closeSketch() }, t('Fertig'));
  const cancel = h('button', { class: 'btn', title: t('Alle Änderungen seit dem Öffnen verwerfen'), onclick: () => ed.closeSketch(true) }, t('Abbrechen'));
  bar.append(h('strong', {}, t('Skizze')), tools, cons, h('div', { class: 'sketch-group' }, aux, del), status, done, cancel);

  const refresh = () => {
    const s = ed.sketchEdit;
    bar.hidden = !s;
    if (!s) return;
    for (const [id, b] of toolBtns) b.classList.toggle('on', s.tool === id);
    const ok = new Set(ed.sketchConOptions());
    for (const [id, b] of conBtns) b.disabled = !ok.has(id as never);
    const hasEnt = [...s.sel].some((id) => s.sk.ents.some((e) => e.id === id));
    aux.disabled = !hasEnt;
    del.disabled = !s.sel.size;
    const st = s.status;
    status.className = 'sketch-status';
    if (!st) status.textContent = '';
    else if (!st.ok || st.conflicting.length) {
      status.classList.add('bad');
      status.textContent = t('Widerspruch');
    } else if (st.dof === 0) {
      status.classList.add('full');
      status.textContent = t('Voll bestimmt');
    } else status.textContent = t('Freiheitsgrade: {n}', { n: st.dof });
  };
  let frame = 0;
  ed.on(() => (frame ||= requestAnimationFrame(() => ((frame = 0), refresh()))));
  ed.canvas.addEventListener('pointerup', () => refresh());

  ed.onSketchValue = (title, current, unit, expr) => askValue(title, current, unit, expr);
}

/** Wert einer Bemaßung erfragen: Zahl (mit Rechnung, z. B. 30/2) oder Formel mit Projekt-Parametern */
function askValue(title: string, current: number, unit: string, expr?: string): Promise<{ v: number; expr?: string } | null> {
  return new Promise((resolve) => {
    let result: { v: number; expr?: string } | null = null;
    const val = h('input', { type: 'text', id: 'sk-val', value: expr ?? dec(String(Math.round(current * 1000) / 1000)), style: 'width: 160px' }) as HTMLInputElement;
    const err = h('div', { class: 'note' });
    const ok = () => {
      const src = val.value.trim();
      const n = evalExpr(src);
      if (n !== null && isFinite(n)) {
        if (!(n > 0) && unit === 'mm') {
          err.textContent = t('Der Wert muss größer als 0 sein.');
          return;
        }
        result = { v: n };
      } else {
        // Formel mit Projekt-Parametern
        try {
          const v = evaluate(src);
          if (typeof v !== 'number' || !isFinite(v)) throw new Error(t('Keine Zahl'));
          result = { v, expr: src };
        } catch (e) {
          err.textContent = t('Ungültiger Wert: {msg}', { msg: e instanceof Error ? e.message : String(e) });
          return;
        }
      }
      dlg.close();
    };
    val.onkeydown = (e) => {
      if (e.key === 'Enter') ok();
    };
    const dlg = h(
      'dialog',
      { class: 'offset-dialog' },
      h('h3', {}, title),
      h('div', { class: 'form' }, h('label', { for: 'sk-val' }, unit === '°' ? t('Winkel (°)') : t('Wert (mm)')), val),
      h('div', { class: 'note' }, t('Zahl, Rechnung (z. B. 40/2) oder Formel mit Projekt-Parametern (z. B. Breite - 2*Dicke).')),
      err,
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
        h('button', { class: 'btn primary', onclick: ok }, t('Übernehmen'))),
    );
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(result);
    });
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.append(dlg);
    dlg.showModal();
    // Der Dialog öffnet beim Klick auf die Arbeitsfläche; der folgende mousedown nimmt sonst den Fokus wieder weg
    val.select();
    setTimeout(() => val.select(), 0);
  });
}
