// Dialoge für Generatoren: Parameter-Dialog (aus dem Schema gebaut, mit Vorschau) und die Rückfrage,
// bevor eine Aktion ein parametrisches Bauteil in Pfade umwandelt.
import type { Editor } from '../editor';
import { check, numField, select } from '../arrayDialogs';
import { h } from '../dom';
import type { GenShape, Obj } from '../model';
import type { BuildResult } from './index';
import { subsToPath2D } from '../geom';
import { dec, t, tn } from '../i18n';
import { autoText, buildGen, defaultParams, fieldActive, GENERATORS, genLabel, getGenerator, normalizeParams, resolveBinds } from './index';
import { evalExpr, f2 } from '../dom';
import { evaluate, formatNumber, namesIn, projectParams } from '../params';
import type { GenAsk, GenChange, Generator, Params, ParamSpec, ParamValue } from './types';
import { library, entryLabel } from '../materials';
import { genFitPatch } from '../fitcheck';
import { genHost } from '../genHost';
import { onPluginResult } from '../plugins/generator';
import { listsArea } from './dialogLists';
import { surfaceArea } from './dialogSurface';

const LAST_KEY = (id: string) => `kizamubeam.gen.${id}`;

function lastParams(g: Generator): Params {
  try {
    return normalizeParams(g, JSON.parse(localStorage.getItem(LAST_KEY(g.id)) ?? '{}'));
  } catch {
    return defaultParams(g);
  }
}

/** Last-used settings must not carry a legacy layout into a newly created object. */
export function initialDialogParams(g: Generator, old: GenShape | null, init?: Params): Params {
  const p = old ? normalizeParams(g, old.params) : init ? normalizeParams(g, init, lastParams(g)) : lastParams(g);
  // E.g. new multi-part objects are nested compactly, even if the last-used settings came from a saved one
  if (!old) for (const s of g.schema) if (s.resetOnNew) p[s.key] = s.def;
  return p;
}

const UNIT: Record<string, string> = { length: 'mm', angle: '°' };

/** A text field that says the same as its suggestion (ignoring spaces) is stored empty, so it follows later changes */
const isSuggested = (g: Generator, key: string, p: Params) => {
  const v = String(p[key] ?? '').replace(/\s+/g, '');
  return !!v && v === autoText(g, key, p).replace(/\s+/g, '');
};

/** Dauert eine Vorschau länger (große Baugruppen), wird sie erst kurz nach der letzten Eingabe neu berechnet */
const SLOW_PREVIEW_MS = 40;
const PREVIEW_DELAY_MS = 120;
const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : f2(v));

/** Generator-Dialog: neues Bauteil erzeugen (ohne o) oder die Parameter eines vorhandenen ändern */
export function openGenDialog(ed: Editor, genId: string, o?: Obj, init?: Params) {
  const old = o?.shape.kind === 'gen' ? o.shape : null;
  const g = getGenerator(old?.gen ?? genId);
  if (!g) {
    ed.hint = old?.ext
      ? t('Die Erweiterung „{name}“ fehlt. Die gespeicherte Kontur bleibt erhalten; zum Ändern der Parameter die Erweiterung installieren.', { name: old.ext })
      : t('Generator „{id}“ ist in dieser Programmversion nicht vorhanden. Die gespeicherte Kontur bleibt erhalten.', { id: old?.gen ?? genId });
    ed.emit('tool');
    return;
  }
  const p = initialDialogParams(g, old, init);
  for (const s of g.schema) if (s.type === 'text' && isSuggested(g, s.key, p)) p[s.key] = '';
  // Felder mit Formel aus Projekt-Parametern (z. B. Dicke); beim Erstellen ohne Formeln
  const binds: Record<string, string> = { ...(old?.bind ?? {}) };
  const hasParams = projectParams().length > 0;
  const layerKerf = ed.layer(o?.layer ?? ed.currentLayer).kerf;
  // Kalibrierte Passung des Materials am Layer: bei neuen Bauteilen gleich übernehmen, sonst per Knopf
  const matEntry = library.get(ed.layer(o?.layer ?? ed.currentLayer).material);
  const calibPatch = (): Partial<Params> | null => {
    const pt = matEntry?.fit ? genFitPatch(g.id, matEntry, p, layerKerf) : null;
    if (!pt) return null;
    for (const k of Object.keys(pt)) if (binds[k]) delete pt[k];
    return Object.keys(pt).length ? pt : null;
  };
  const calibNote = h('div', { class: 'note' });
  if (!old) {
    const pt = calibPatch();
    if (pt) {
      Object.assign(p, pt);
      calibNote.textContent = t('Materialdicke, Schnittfuge und Spiel aus der Kalibrierung für „{entry}“.', { entry: entryLabel(matEntry!) });
    }
  }

  const rows = new Map<string, HTMLElement[]>();
  const textInputs = new Map<string, HTMLInputElement>();
  const field = (s: ParamSpec): HTMLElement[] => {
    const id = `gen-${s.key}`;
    if (s.type === 'data') return [];
    if (s.type === 'text') {
      const control = h('input', { type: 'text', id, value: String(p[s.key] || autoText(g, s.key, p) || ''), maxlength: 2000 }) as HTMLInputElement;
      if (s.title) control.title = s.title;
      textInputs.set(s.key, control);
      control.addEventListener('input', () => { p[s.key] = control.value; update(); });
      control.addEventListener('blur', () => {
        if (isSuggested(g, s.key, p)) {
          p[s.key] = '';
          control.value = autoText(g, s.key, p);
          update();
          return;
        }
        if (!p[s.key]) control.value = autoText(g, s.key, p);
      });
      return [h('label', { for: id, title: s.title ?? '' }, s.label), control];
    }
    const unit = s.type === 'length' || s.type === 'angle' ? ` (${UNIT[s.type]})` : '';
    let input: HTMLElement;
    if (s.type === 'enum' || s.type === 'bool') {
      const set = (v: ParamValue) => {
        const before = p[s.key];
        p[s.key] = v;
        const undo = () => {
          p[s.key] = before;
          if (control instanceof HTMLSelectElement) control.value = String(before);
          else (control.querySelector('input') as HTMLInputElement).checked = !!before;
        };
        if (!changed(s.key, before, undo)) update();
      };
      const control: HTMLElement = s.type === 'enum' ? select(id, String(p[s.key]), s.options, set) : check(!!p[s.key], set, s.label);
      const els = s.type === 'enum' ? [h('label', { for: id, title: s.title ?? '' }, s.label), control] : [h('span'), control];
      if (s.title) control.title = s.title;
      if (!hasParams && !binds[s.key]) return els;
      // Auswahl und Ja/Nein: Knopf ƒ schaltet auf eine Formel um (z. B. Deckel ? "closed" : "open")
      const ff = formulaField(s, `${id}-fx`);
      const fx = h('button', { class: 'small gen-fx', title: t('Formel mit Projekt-Parametern') }, 'ƒ') as HTMLButtonElement;
      let on = !!binds[s.key];
      const show = () => {
        control.hidden = on;
        ff.hidden = !on;
        fx.classList.toggle('on', on);
      };
      fx.onclick = () => {
        on = !on;
        if (!on) delete binds[s.key];
        show();
        if (on) ff.querySelector('input')!.focus();
        update();
      };
      show();
      return [els[0], h('div', { class: 'gen-linkable' }, control, ff, fx)];
    } else if (hasParams || binds[s.key]) input = formulaField(s, id);
    else input = numField(id, Number(p[s.key]), (v) => ((p[s.key] = v), update()), s.title);
    if (s.title) input.title = s.title;
    if (g.onChange) {
      // Committed value goes to Generator.onChange; a declined question restores the value and formula from before
      const el = input instanceof HTMLInputElement ? input : input.querySelector('input');
      let previous = p[s.key], previousBind = binds[s.key], previousText = '';
      el?.addEventListener('focus', () => { previous = p[s.key]; previousBind = binds[s.key]; previousText = el.value; });
      el?.addEventListener('blur', () => {
        if (p[s.key] === previous) return;
        const undo = () => {
          p[s.key] = previous;
          if (previousBind) binds[s.key] = previousBind; else delete binds[s.key];
          el.value = previousText;
        };
        if (!changed(s.key, previous, undo)) update();
      });
    }
    return [h('label', { for: id, title: s.title ?? '' }, s.label + unit), input];
  };
  /**
   * Feld, das Formeln mit Projekt-Parametern annimmt (z. B. „Dicke“ oder „Breite / 2“). Zahlenfelder nehmen
   * auch weiter einfache Zahlen; Auswahl- und Ja/Nein-Felder nur Formeln.
   */
  function formulaField(s: ParamSpec, id: string): HTMLElement {
    const isNum = s.type !== 'enum' && s.type !== 'bool';
    const el = h('input', { type: 'text', id, value: binds[s.key] ?? (isNum ? fmtNum(Number(p[s.key])) : '') }) as HTMLInputElement;
    if (s.type === 'enum') el.placeholder = s.options.map(([k]) => `"${k}"`).join(' / ');
    if (s.type === 'bool') el.placeholder = s.label;
    const shown = h('span', { class: 'gen-bound muted' });
    const sync = () => {
      const src = el.value.trim();
      const plain = isNum ? evalExpr(src) : null;
      el.classList.remove('invalid');
      shown.textContent = '';
      if (plain !== null) {
        delete binds[s.key];
        p[s.key] = plain;
      } else if (src && (!isNum || namesIn(src).length)) {
        binds[s.key] = src;
        try {
          const v = evaluate(src);
          if (typeof v === 'number') p[s.key] = v;
          shown.textContent = `= ${typeof v === 'number' ? formatNumber(v) : String(v)}`;
        } catch (e) {
          shown.textContent = e instanceof Error ? e.message : String(e);
          el.classList.add('invalid');
        }
      } else if (src || isNum) el.classList.add('invalid');
      else delete binds[s.key];
      el.classList.toggle('bound', !!binds[s.key]);
      update();
    };
    el.addEventListener('input', sync);
    el.addEventListener('focus', () => el.select());
    el.addEventListener('blur', () => {
      if (isNum && !binds[s.key] && evalExpr(el.value) !== null) el.value = fmtNum(evalExpr(el.value)!);
    });
    el.title = (s.title ? s.title + '\n' : '') + (isNum
      ? t('Zahl oder Formel mit Projekt-Parametern, z. B. „Dicke“ oder „Breite / 2“')
      : s.type === 'enum'
        ? t('Formel, die eine der Auswahlen ergibt: {values}', { values: s.options.map(([k, l]) => `"${k}" = ${l}`).join(', ') })
        : t('Formel mit Projekt-Parametern, die ja oder nein ergibt, z. B. „Deckel“ oder „Breite > 100“'));
    if (binds[s.key]) setTimeout(sync, 0);
    return h('div', { class: 'gen-formula' }, el, shown);
  }
  const main: HTMLElement[] = [],
    adv: HTMLElement[] = [];
  const sections = new Map<string, HTMLElement[]>();
  // Fields an action shows next to its button (e.g. the real width of an image)
  const actionFields = new Set((g.actions ?? []).map((a) => a.field).filter((k): k is string => !!k));
  for (const s of g.schema) {
    const els = field(s);
    rows.set(s.key, els);
    if (actionFields.has(s.key)) continue;
    if (s.advanced) adv.push(...els);
    else if (s.section) {
      if (!sections.has(s.section)) sections.set(s.section, []);
      sections.get(s.section)!.push(...els);
    } else main.push(...els);
  }

  // A section whose fields are all hidden (showIf) is hidden as well
  const sectionEls = [...sections].map(([label, els]) => h('details', { open: true, class: 'gen-section' }, h('summary', {}, label), h('div', { class: 'form' }, ...els)));
  const sectionKeys = [...sections.keys()].map((label) => g.schema.filter((s) => !s.advanced && s.section === label));

  const canvas = h('canvas', { class: 'gen-preview', width: 240, height: 240 }) as HTMLCanvasElement;
  const issuesEl = h('div', { class: 'gen-issues' });
  const infoEl = h('div', { class: 'gen-info' });
  const kerfNote = h('div', { class: 'note' });
  let built: BuildResult | null = null;
  const host = genHost(ed);
  // Drawing surface (#335 stage 4), lists and action buttons (stage 3) the generator declares; a patch is
  // checked like user input
  const surface = surfaceArea(g, p, (patch) => patchFields('', patch), () => dlg.open);
  const lists = listsArea(g, p, (patch) => patchFields('', patch), host, () => dlg.open, (key) => rows.get(key) ?? [], surface);

  const render = () => {
    // Werte für die Prüfung auf den gültigen Bereich bringen; die Eingabefelder behalten, was getippt wurde
    // Formeln mit den aktuellen Parameterwerten auswerten (fehlerhafte Formeln sperren Erzeugen)
    const rb = resolveBinds(g, normalizeParams(g, p), binds);
    const np = rb.params;
    for (const s of g.schema) if (s.type === 'text' && !p[s.key] && document.activeElement !== textInputs.get(s.key)) {
      const control = textInputs.get(s.key);
      if (control) control.value = autoText(g, s.key, np);
    }
    for (const s of g.schema) rows.get(s.key)!.forEach((el) => (el.hidden = !fieldActive(s, np)));
    sectionEls.forEach((el, i) => (el.hidden = !sectionKeys[i].some((s) => fieldActive(s, np))));
    const r = buildGen(g, np);
    r.issues.unshift(...rb.issues);
    if (rb.issues.some((i) => i.level === 'error')) r.parts = [];
    if (Object.keys(binds).length) for (const pt of r.parts) pt.shape.bind = { ...binds };
    built = r.parts.length ? r : null;
    issuesEl.replaceChildren(...r.issues.map((i) => h('div', { class: i.level === 'error' ? 'error' : 'warn' }, i.msg)));
    for (const s of g.schema) {
      const bad = r.issues.some((i) => i.key === s.key && i.level === 'error');
      rows.get(s.key)!.forEach((el) => el.classList.toggle('invalid', bad));
    }
    infoEl.replaceChildren(...r.info.map(([k, v]) => h('div', {}, h('span', { class: 'muted' }, k), ' ', v)));
    okBtn.disabled = addBtn.disabled = !built || asking;
    surface?.refresh(np);
    lists?.refresh(np);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!built) return;
    // Alle Teile an ihrer vorgeschlagenen Lage, gemeinsam eingepasst
    const pts = built.parts.flatMap((pt) => pt.shape.subs.flatMap((sp) => sp.nodes.map((q) => ({ x: q.x + pt.at.x, y: q.y + pt.at.y }))));
    const minX = Math.min(...pts.map((q) => q.x)), maxX = Math.max(...pts.map((q) => q.x));
    const minY = Math.min(...pts.map((q) => q.y)), maxY = Math.max(...pts.map((q) => q.y));
    const centre = !!g.preview?.center && pts.length > 0;
    const previewX = centre ? (minX + maxX) / 2 : 0;
    const previewY = centre ? (minY + maxY) / 2 : 0;
    const ext = Math.max(1e-6, ...pts.map((q) => Math.max(Math.abs(q.x - previewX), Math.abs(q.y - previewY))));
    const k = (canvas.width / 2 - 6) / ext;
    const css = getComputedStyle(canvas);
    ctx.fillStyle = css.getPropertyValue('--accent-soft').trim() || 'rgba(80,140,220,0.18)';
    ctx.strokeStyle = css.color || '#333';
    ctx.lineWidth = 1 / k;
    for (const pt of built.parts) {
      ctx.setTransform(k, 0, 0, k, canvas.width / 2 + (pt.at.x - previewX) * k, canvas.height / 2 + (pt.at.y - previewY) * k);
      const path = subsToPath2D(pt.shape.subs);
      ctx.fill(path, 'evenodd');
      ctx.stroke(path);
    }
    if (old && matEntry) {
      const pt = calibPatch();
      const differs = !!pt && Object.entries(pt).some(([k, v]) => typeof v === 'number' ? Math.abs(v - Number(p[k])) > 1e-6 : v !== p[k]);
      calibNote.replaceChildren();
      if (differs)
        calibNote.append(
          t('Die Werte weichen von der Kalibrierung für „{entry}“ ab. ', { entry: entryLabel(matEntry) }),
          h('button', {
            class: 'small',
            onclick: () => {
              const now = calibPatch();
              if (!now) return;
              Object.assign(p, now);
              for (const [k, v] of Object.entries(now)) {
                const el = dlg.querySelector<HTMLInputElement>(`#gen-${k}`);
                if (el && typeof v === 'number') el.value = fmtNum(v);
              }
              update();
            },
          }, t('Kalibrierte Werte übernehmen')),
        );
    }
    const kerf = Number(np.kerf ?? 0);
    kerfNote.textContent =
      layerKerf
        ? t('Der Layer hat zusätzlich einen Kerf-Versatz von {k} mm, der beim Lasern noch dazukommt.', { k: dec(String(layerKerf)) })
        : kerf
          ? t('Die Schnittfuge ist schon in der Kontur enthalten; der Layer hat keinen zusätzlichen Kerf-Versatz.')
          : t('Ohne Schnittfuge werden die Teile um die Fugenbreite zu klein. Fuge hier oder als Kerf-Versatz am Layer eintragen.');
  };

  // Vorschau sofort, außer die letzte Berechnung war langsam: dann nach einer kurzen Pause im Tippen. Vor jeder
  // Aktion (Klick, Enter, Übernehmen) wird eine ausstehende Berechnung nachgeholt, damit nichts mit alten Werten entsteht.
  let pending = 0;
  let renderMs = 0;
  /** A question of the generator is open (OK and Add stay off) */
  let asking = false;
  /** Counts committed fields, so a late plugin answer to an older change is dropped */
  let changeSeq = 0;
  const askEl = h('div', { class: 'gen-ask', role: 'alertdialog', hidden: true });
  const flush = () => {
    if (pending) clearTimeout(pending);
    pending = 0;
    const t0 = performance.now();
    render();
    renderMs = performance.now() - t0;
  };
  const flushPending = () => {
    if (pending) flush();
  };
  /**
   * Hand a committed field to Generator.onChange. Returns true when it handled the change (and updated the
   * dialog); undo restores the field when the user declines the generator's question.
   */
  function changed(key: string, before: ParamValue, undo: () => void): boolean {
    if (!g!.onChange) return false;
    let r: GenChange | void | Promise<GenChange | void>;
    try {
      r = g!.onChange(key, before, normalizeParams(g!, p));
    } catch {
      return false;
    }
    if (r instanceof Promise) {
      // A plugin answers from its Worker: the field stays as committed until then; the answer only counts while
      // the field still holds that value and no other question is open
      const committed = p[key];
      const token = ++changeSeq;
      void r.then(
        (x) => {
          if (dlg.open && token === changeSeq && p[key] === committed) applyChange(key, x, undo);
        },
        () => undefined,
      );
      return false;
    }
    return applyChange(key, r, undo);
  }
  /** Apply the answer of onChange: a patch at once, a question inside the dialog first */
  function applyChange(key: string, r: GenChange | void, undo: () => void): boolean {
    if (!r || (!r.patch && !r.ask)) return false;
    const base = r.patch ?? {};
    if (r.ask) {
      showAsk(r.ask, (opt) => {
        if (opt) patchFields(key, { ...base, ...opt.patch });
        else {
          undo();
          update();
        }
      });
      return true;
    }
    patchFields(key, base);
    return true;
  }
  /** Checked against the schema like user input; text fields show the new text */
  function patchFields(key: string, patch: Params) {
    const keys = Object.keys(patch).filter((k) => k !== key && g!.schema.some((s) => s.key === k));
    const np = normalizeParams(g!, { ...p, ...patch }, p);
    for (const k of keys) {
      p[k] = np[k];
      delete binds[k];
      const control = textInputs.get(k);
      if (control) control.value = String(np[k]);
      else showValue(k);
      if (isSuggested(g!, k, p)) p[k] = '';
    }
    update();
  }
  /** Show a value set by the generator in its field (number, choice, switch) */
  function showValue(k: string) {
    const v = p[k];
    const el = dlg.querySelector<HTMLElement>(`#gen-${CSS.escape(k)}`);
    if (el instanceof HTMLSelectElement) el.value = String(v);
    else if (el instanceof HTMLInputElement) el.value = typeof v === 'number' ? fmtNum(v) : String(v);
    for (const row of rows.get(k) ?? []) {
      const box = row.querySelector<HTMLInputElement>('input[type=checkbox]');
      if (box) box.checked = !!v;
    }
  }
  /**
   * The generator's question inside the dialog (#335 stage 2): its options and Cancel; until it is answered,
   * OK and Add stay off. Cancel restores the field.
   */
  function showAsk(ask: GenAsk, done: (opt: GenAsk['options'][number] | null) => void) {
    askEl.hidden = false;
    asking = true;
    okBtn.disabled = addBtn.disabled = true;
    const finish = (opt: GenAsk['options'][number] | null) => {
      askEl.hidden = true;
      askEl.replaceChildren();
      asking = false;
      done(opt);
    };
    askEl.replaceChildren(
      h('p', {}, ask.question),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => finish(null) }, t('Abbrechen')),
        ...ask.options.map((o, i) => h('button', { class: i === 0 ? 'btn primary' : 'btn', onclick: () => finish(o) }, o.label)),
      ),
    );
    (askEl.querySelector('.btn.primary') as HTMLButtonElement | null)?.focus();
  }
  const update = () => {
    if (renderMs <= SLOW_PREVIEW_MS) return flush();
    if (pending) clearTimeout(pending);
    pending = window.setTimeout(flush, PREVIEW_DELAY_MS);
  };

  /**
   * Übernehmen/Erstellen (close) oder Hinzufügen (Dialog bleibt offen). Hinzufügen legt immer ein neues Teil an,
   * auch beim Bearbeiten; das bearbeitete Teil bleibt dann unverändert.
   */
  const commit = async (close: boolean) => {
    flushPending();
    if (!built) return;
    // Eigene Kopie: Ein zweites Hinzufügen ohne Änderung darf nicht dieselben Formen wiederverwenden
    const r = structuredClone(built);
    const apply = close && !!old ? o : undefined;
    if (!apply && !ed.genFitsPage(r)) {
      const answer = await askTooLarge();
      if (answer === 'back') return;
      if (answer === 'cancel') return dlg.close();
    }
    try {
      localStorage.setItem(LAST_KEY(g.id), JSON.stringify(r.parts[0].shape.params));
    } catch {
      /* Speicher nicht verfügbar */
    }
    if (apply) ed.updateGen(apply, r);
    else ed.addGen(r, o?.layer);
    if (close) dlg.close();
  };
  const okBtn = h('button', { class: 'btn primary', onclick: () => void commit(true) }, old ? t('Übernehmen') : t('Erstellen')) as HTMLButtonElement;
  const addBtn = h('button', {
    class: 'btn',
    title: old
      ? t('Fügt ein neues Teil mit diesen Werten hinzu; das bearbeitete Teil bleibt unverändert.')
      : t('Fügt das Teil hinzu und lässt den Dialog offen, um das nächste mit anderen Maßen einzustellen.'),
    onclick: () => void commit(false),
  }, t('Hinzufügen')) as HTMLButtonElement;

  const dlg = h(
    'dialog',
    { class: 'offset-dialog gen-dialog' },
    h('h3', {}, old ? t('{name} bearbeiten', { name: g.name }) : t('{name} erstellen', { name: g.name })),
    h('div', { class: 'qr-layout' },
      h('div', {},
        h('div', { class: 'form' }, ...main),
        ...sectionEls,
        adv.length ? h('details', {}, h('summary', {}, t('Erweitert')), h('div', { class: 'form' }, ...adv)) : null,
      ),
      h('div', {}, canvas, infoEl),
    ),
    surface?.el ?? null,
    lists?.el ?? null,
    askEl,
    issuesEl,
    calibNote,
    kerfNote,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      addBtn,
      okBtn,
    ),
  );
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      flushPending();
      okBtn.click();
    }
  });
  // Vor dem Klick: Knöpfe und Vorschau auf den aktuellen Stand bringen
  dlg.addEventListener('pointerdown', flushPending, true);
  // Plugins answer from their Worker: show the result as soon as it arrives (until then „being computed“)
  const stopListening = onPluginResult((id) => {
    if (id === g.id && !pending) flush();
  });
  dlg.addEventListener('close', () => {
    if (pending) clearTimeout(pending);
    pending = 0;
    stopListening();
    dlg.remove();
  });
  document.body.append(dlg);
  dlg.showModal();
  flush();
}

/**
 * Das Teil ist größer als der Arbeitsbereich: trotzdem erstellen (in der Mitte), zurück zur Bearbeitung oder alles
 * abbrechen. Esc und das Schließkreuz führen zurück zur Bearbeitung, nur „Abbrechen“ schließt auch den Dialog.
 */
function askTooLarge(): Promise<'create' | 'back' | 'cancel'> {
  return new Promise((resolve) => {
    let answer: 'create' | 'back' | 'cancel' = 'back';
    const done = (a: typeof answer) => ((answer = a), dlg.close());
    const dlg = h(
      'dialog',
      { class: 'offset-dialog gen-guard' },
      h('h3', {}, t('Größer als der Arbeitsbereich')),
      h('p', {}, t('Das Teil passt mit Randabstand nicht auf eine leere Seite. Es wird keine neue Seite angelegt.')),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => done('cancel') }, t('Abbrechen')),
        h('button', { class: 'btn', onclick: () => done('back') }, t('Zurück zur Bearbeitung')),
        h('button', { class: 'btn primary', onclick: () => done('create') }, t('Trotzdem erstellen')),
      ),
    );
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    dlg.addEventListener('close', () => (dlg.remove(), resolve(answer)));
    document.body.append(dlg);
    // Erst nach dem auslösenden Tastendruck öffnen: Ein Enter im Feld würde sonst gleich einen Knopf drücken
    setTimeout(() => dlg.showModal(), 0);
  });
}

/** Generators that take a 3D model (Generator.inputs), in registry order */
export const modelGenerators = () => GENERATORS.filter((g) => g.inputs?.some((i) => i.kind === 'model3d'));

/** On importing a 3D model: which generator should it go to? One button per model generator; null = cancelled */
export function askModelKind(): Promise<string | null> {
  return new Promise((resolve) => {
    let answer: string | null = null;
    const done = (a: typeof answer) => ((answer = a), dlg.close());
    const gens = modelGenerators();
    const texts = gens.map((g) => ({ g, ...(g.tile?.text(t) ?? { name: g.name, desc: '' }) }));
    const dlg = h(
      'dialog',
      { class: 'offset-dialog gen-guard' },
      h('h3', {}, t('Was soll aus dem 3D-Modell werden?')),
      ...texts.map((x) => h('p', {}, h('b', {}, x.name), x.desc ? ` ${x.desc}` : '')),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => done(null) }, t('Abbrechen')),
        // The first registered generator is the default and sits last, as the primary button
        ...texts.slice().reverse().map((x, i, all) => h('button', { class: i === all.length - 1 ? 'btn primary' : 'btn', onclick: () => done(x.g.id) }, x.name)),
      ),
    );
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    dlg.addEventListener('close', () => (dlg.remove(), resolve(answer)));
    document.body.append(dlg);
    setTimeout(() => dlg.showModal(), 0);
  });
}

/** Kleine Rückfrage, bevor eine Aktion parametrische Bauteile in gewöhnliche Pfade umwandelt */
export function askGenConvert(objs: Obj[], action: string): Promise<'convert' | 'edit' | 'cancel'> {
  return new Promise((resolve) => {
    let answer: 'convert' | 'edit' | 'cancel' = 'cancel';
    const first = objs[0].shape as GenShape;
    const name = objs.length > 1 ? tn('{n} parametrisches Bauteil', '{n} parametrische Bauteile', objs.length) : genLabel(first);
    const done = (a: typeof answer) => ((answer = a), dlg.close());
    const dlg = h(
      'dialog',
      { class: 'offset-dialog gen-guard' },
      h('h3', {}, t('Parametrisches Bauteil ändern?')),
      h('p', {}, t('„{action}“ wandelt {name} in gewöhnliche Pfade um. Die Parameter gehen dabei verloren, Rückgängig stellt sie wieder her.', { action, name })),
      h('div', { class: 'dialog-buttons' },
        h('button', { class: 'btn', onclick: () => done('cancel') }, t('Abbrechen')),
        getGenerator(first.gen) ? h('button', { class: 'btn', onclick: () => done('edit') }, t('Parameter bearbeiten …')) : null,
        h('button', { class: 'btn primary', onclick: () => done('convert') }, t('In Pfade umwandeln')),
      ),
    );
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    dlg.addEventListener('close', () => (dlg.remove(), resolve(answer)));
    document.body.append(dlg);
    // Erst nach dem auslösenden Tastendruck öffnen: Ein Enter im Größenfeld würde sonst gleich den ersten Knopf drücken
    setTimeout(() => dlg.showModal(), 0);
  });
}
