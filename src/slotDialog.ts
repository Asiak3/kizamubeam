// Dialog „Schlitze an Materialdicke anpassen“: erkennt Schlitze in der Auswahl (bzw. auf der ganzen Seite),
// zeigt sie orange auf der Arbeitsfläche und macht sie für eine neue Materialdicke breiter oder schmaler.
// Bauteile aus Generatoren (Box, Schublade, Einsatz, Regal) bekommen die neue Dicke als Parameter.
import { Editor } from './editor';
import { numField } from './arrayDialogs';
import { h } from './dom';
import { Mat, Obj, visibleLeaves } from './model';
import { findSlots, resizeSlots, Slot, slotWidths } from './slots';
import { buildGen, getGenerator, normalizeParams } from './generators/index';
import type { Params } from './generators/types';
import { library } from './materials';
import { dec, t, tn } from './i18n';

const STATE_KEY = 'kizamubeam.slots';

const mm = (v: number) => dec(String(Math.round(v * 100) / 100));

/** Durchsuchte Blätter: die Auswahl oder, ohne Auswahl, alle sichtbaren Objekte der Seite */
function scope(ed: Editor): [Obj, Mat][] {
  return [...visibleLeaves(ed.sel.length ? ed.sel : ed.doc.objs)];
}

/** Generator-Bauteile mit Materialdicke um th (± tol), je Baugruppe eines; gebundene Dicke bleibt außen vor */
function genTargets(items: [Obj, Mat][], th: number, tol: number): Obj[] {
  const seen = new Set<string>();
  const out: Obj[] = [];
  for (const [o] of items) {
    const s = o.shape;
    if (s.kind !== 'gen' || s.bind?.thickness || typeof s.params.thickness !== 'number') continue;
    if (Math.abs(s.params.thickness - th) > tol + 1e-9) continue;
    const k = s.asm ?? `obj${o.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(o);
  }
  return out;
}

export interface SlotResizeResult {
  slots: number;
  gens: number;
  skipped: number;
}

/**
 * Schlitze der Breite th (± tol) für die Dicke thNew anpassen: jede Schlitzbreite ändert sich um thNew − th,
 * das Spiel bleibt also erhalten. Ein Undo-Schritt für alles.
 */
export function applySlotResize(ed: Editor, th: number, tol: number, thNew: number): SlotResizeResult {
  const items = scope(ed);
  const delta = thNew - th;
  const slots = findSlots(items, { width: th, tol });
  const gens = genTargets(items, th, tol);
  const res: SlotResizeResult = { slots: 0, gens: 0, skipped: 0 };
  if ((!slots.length && !gens.length) || Math.abs(delta) < 1e-6) return res;
  ed.snapshot(t('Schlitze anpassen'));
  const ok = slots.filter((s) => s.width + delta > 0.05);
  res.skipped = slots.length - ok.length;
  for (const leaf of resizeSlots(ok, delta)) {
    ed.touch(leaf.shape);
    // Verbindungen aus dem Verbindungs-Werkzeug rechnen danach mit der neuen Dicke
    for (const mt of leaf.mates ?? []) if (Math.abs(mt.th - th) <= tol + 1e-9) mt.th = Math.round((mt.th + delta) * 1000) / 1000;
  }
  res.slots = ok.length;
  for (const o of gens) {
    if (o.shape.kind !== 'gen') continue;
    const g = getGenerator(o.shape.gen);
    if (!g) continue;
    const p = normalizeParams(g, o.shape.params);
    const r = buildGen(g, { ...p, thickness: Math.round((Number(p.thickness) + delta) * 1000) / 1000 } as Params);
    if (r.issues.some((i) => i.level === 'error') || !r.parts.length) {
      res.skipped++;
      continue;
    }
    ed.updateGen(o, r, true);
    res.gens++;
  }
  if (!res.slots && !res.gens) ed.dropSnapshot();
  ed.emit('doc');
  return res;
}

function loadState(): { tol: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}');
    return { tol: typeof raw.tol === 'number' && raw.tol > 0 ? raw.tol : 0.3 };
  } catch {
    return { tol: 0.3 };
  }
}

export function openSlotDialog(ed: Editor) {
  const items = scope(ed);
  const all = findSlots(items);
  const widths = slotWidths(all);
  const gensAll = items.filter(([o]) => o.shape.kind === 'gen' && typeof o.shape.params.thickness === 'number');
  const st = { th: 3, tol: loadState().tol, thNew: 3 };
  // Schlitze sind meist etwas breiter als das Material (Spiel): als Dicke den nächsten halben Millimeter annehmen
  if (widths.length) st.th = Math.max(0.5, Math.round(widths[0].width * 2) / 2);
  else if (gensAll.length) st.th = Number((gensAll[0][0].shape as { params: Params }).params.thickness);
  // Neue Dicke aus dem Material des Layers, falls es eine andere Dicke hat
  const firstLayer = items[0]?.[0].layer ?? ed.currentLayer;
  const libTh = library.get(ed.layer(firstLayer).material)?.thickness ?? null;
  // Passt sie zur erkannten Breite, ist sie wohl die bisherige Dicke (die Breite enthält dann noch das Spiel)
  if (libTh && Math.abs(libTh - st.th) <= st.tol) st.th = libTh;
  st.thNew = libTh && Math.abs(libTh - st.th) > 0.05 ? libTh : st.th;

  const info = h('div', { class: 'note' }, ' ');
  const found = h('div', { class: 'note' },
    widths.length
      ? t('Erkannte Schlitzbreiten: {list}', { list: widths.slice(0, 5).map((w) => `${mm(w.width)} mm (${w.count}×)`).join(', ') })
      : t('Keine Schlitze erkannt. Gesucht werden Durchbrüche und Kerben mit zwei parallelen Seiten, die tiefer als breit sind.'),
  );
  let current: Slot[] = [];
  let applied = false;
  const preview = () => {
    if (!dlg.open) return;
    current = findSlots(items, { width: st.th, tol: st.tol });
    const gens = genTargets(items, st.th, st.tol);
    const parts = [tn('{n} Schlitz gefunden', '{n} Schlitze gefunden', current.length)];
    if (current.length) {
      const avg = current.reduce((a, x) => a + x.width, 0) / current.length;
      parts[0] += t(' (Spiel {p} mm)', { p: mm(avg - st.th) });
    }
    if (gens.length) parts.push(tn('{n} Generator-Bauteil', '{n} Generator-Bauteile', gens.length));
    const d = st.thNew - st.th;
    info.textContent = parts.join(', ') + '. ' + (Math.abs(d) < 1e-6
      ? t('Neue und aktuelle Dicke sind gleich.')
      : d > 0
        ? t('Jeder Schlitz wird {d} mm breiter (Spiel bleibt). Orange: gefundene Schlitze.', { d: mm(d) })
        : t('Jeder Schlitz wird {d} mm schmaler (Spiel bleibt). Orange: gefundene Schlitze.', { d: mm(-d) }));
    ed.setPreview(current.map((s) => ({ closed: true, nodes: s.outline.slice(0, 4).map((p) => ({ x: p.x, y: p.y })) })));
  };

  const dlg = h(
    'dialog',
    { class: 'offset-dialog array-dialog' },
    h('h3', {}, t('Schlitze an Materialdicke anpassen')),
    h('div', { class: 'note' }, ed.sel.length ? t('Durchsucht werden die ausgewählten Objekte.') : t('Durchsucht werden alle sichtbaren Objekte der Seite.')),
    found,
    h(
      'div',
      { class: 'form' },
      h('label', { for: 'slot-th' }, t('Aktuelle Dicke (mm)')),
      numField('slot-th', st.th, (v) => (st.th = v), t('Materialdicke, für die die Schlitze gezeichnet sind (Schlitzbreite)')),
      h('label', { for: 'slot-tol' }, t('Toleranz (mm)')),
      numField('slot-tol', st.tol, (v) => (st.tol = Math.max(0.01, v)), t('Schlitze, die so viel breiter oder schmaler sind, werden mit angepasst (z. B. wegen Spiel)')),
      h('label', { for: 'slot-new' }, t('Neue Dicke (mm)')),
      numField('slot-new', st.thNew, (v) => (st.thNew = v)),
    ),
    info,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', { class: 'btn primary', onclick: () => ((applied = true), dlg.close()) }, t('Übernehmen')),
    ),
  ) as HTMLDialogElement;
  dlg.addEventListener('input', preview);
  dlg.addEventListener('change', preview);
  dlg.addEventListener('close', () => {
    ed.setPreview(null);
    if (applied) {
      try {
        localStorage.setItem(STATE_KEY, JSON.stringify({ tol: st.tol }));
      } catch {
        /* Speicher nicht verfügbar */
      }
      const r = applySlotResize(ed, st.th, st.tol, st.thNew);
      ed.hint = r.slots || r.gens
        ? [r.slots ? tn('{n} Schlitz angepasst', '{n} Schlitze angepasst', r.slots) : '', r.gens ? tn('{n} Generator-Bauteil angepasst', '{n} Generator-Bauteile angepasst', r.gens) : '']
          .filter(Boolean).join(', ') + (r.skipped ? tn(', {n} übersprungen.|one', ', {n} übersprungen.', r.skipped) : '.')
        : t('Nichts angepasst.');
      ed.emit('tool');
    }
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      applied = true;
      dlg.close();
    }
  });
  document.body.append(dlg);
  dlg.showModal();
  preview();
}
