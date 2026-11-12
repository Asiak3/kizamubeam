// Dialog “Pattern fill” (issue #245): fill a closed shape with a seamless pattern made from the selected vectors
// or from the library, with live preview on the workspace. Double-clicking a pattern object opens it again.
import type { Editor } from './editor';
import type { Obj } from './model';
import { check, numField, select } from './arrayDialogs';
import { h } from './dom';
import { dec, lang, t } from './i18n';
import { objLabel } from './objectsPanel';
import { DEFAULT_PATTERN_OPTIONS, PatternOptions, patternInfo } from './pattern';
import {
  edgeLabel, mirrorLabel, outputLabel, PATTERN_EDGES, PATTERN_MIRRORS, PATTERN_OUTPUTS, PATTERN_REPEATS, PatternRecipe, PatternSpec, PatternTile, repeatLabel,
} from './patternFormat';
import { builtinPatterns, patternAsset } from './patternLibrary';
import { addToLibrary, libraryItems, loadLibraryAsset } from './assetLibrary';
import type { PatternPick, PatternRole, PatternSetup } from './editor/pattern';

const STATE_KEY = 'kizamubeam.patternfill';

interface State extends PatternOptions {
  /** Keep the target shape (e.g. as cut outline) */
  keepTarget: boolean;
  /** Remove the motif and frame objects after creating the pattern */
  removeMotif: boolean;
}

function loadState(): State {
  const def: State = { ...DEFAULT_PATTERN_OPTIONS, keepTarget: true, removeMotif: false };
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}');
    // the offset belongs to one shape; start centred
    return { ...def, ...raw, offsetX: 0, offsetY: 0 };
  } catch {
    return def;
  }
}
function saveState(st: State) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(st));
  } catch {
    /* storage not available */
  }
}

const ROLES = (): [PatternRole, string][] => [
  ['motif', t('Motiv')],
  ['frame', t('Kachelrahmen')],
  ['target', t('Zielform')],
  ['hole', t('Aussparen')],
  ['ignore', t('Nicht verwenden')],
];

export interface PatternDialogInit {
  /** Start with this library pattern (Library window: insert a pattern) */
  pattern?: { name: string; spec: PatternSpec };
  /** Change this pattern object */
  edit?: Obj;
}

export function openPatternDialog(ed: Editor, init: PatternDialogInit = {}) {
  const edit = init.edit ?? (init.pattern ? null : ed.patternObj());
  let st = loadState();
  let picks: PatternPick[] = [];
  let recipe: PatternRecipe | null = null;
  let tile: PatternTile | string;
  let tileName: string | undefined;
  /** Tile changed against the edited object */
  let tileChanged = false;
  let source: string;

  const builtin = builtinPatterns();
  const builtinName = (id: string) => {
    const p = builtin.find((x) => x.id === id)!;
    return lang === 'de' ? p.name[0] : p.name[1];
  };
  const useSpec = (name: string, spec: PatternSpec) => {
    tile = spec.tile;
    tileName = name;
    Object.assign(st, spec.settings);
    tileChanged = true;
  };

  if (edit) {
    const p = ed.patternOf(edit);
    if (!p) {
      ed.hint = t('Muster füllen: Das Muster-Rezept dieses Objekts ist beschädigt.');
      ed.emit('tool');
      return;
    }
    recipe = p.recipe;
    st = { ...st, ...p.options };
    tile = p.recipe.tile;
    tileName = p.recipe.name;
    source = 'keep';
  } else {
    picks = ed.patternPicks(!!init.pattern);
    if (!picks.some((p) => p.role === 'target')) {
      ed.hint = init.pattern
        ? t('Muster „{name}“: erst die Form auswählen, die das Muster füllen soll.', { name: init.pattern.name })
        : t('Muster füllen: die Form auswählen, die gefüllt werden soll, und dazu das Motiv (oder nur die Form und dann ein Muster aus der Liste wählen).');
      ed.emit('tool');
      return;
    }
    if (init.pattern) {
      useSpec(init.pattern.name, init.pattern.spec);
      source = 'init';
    } else if (picks.some((p) => p.role === 'motif')) {
      tile = ed.patternTile(picks);
      source = 'sel';
    } else {
      useSpec(builtinName(builtin[0].id), builtin[0].spec);
      source = `b:${builtin[0].id}`;
    }
  }

  // ---------- Fields ----------
  const info = h('div', { class: 'note' }, ' ');
  const vis: [() => boolean, HTMLElement[]][] = [];
  const when = (cond: () => boolean, ...els: HTMLElement[]) => (vis.push([cond, els]), els);
  const nums: [keyof PatternOptions, HTMLInputElement, number][] = [];
  const num = (key: keyof PatternOptions, title?: string, min = -Infinity, factor = 1) => {
    const el = numField(`pattern-${key}`, (st[key] as number) * factor, (v) => ((st[key] as number) = Math.max(min, v / factor)), title);
    nums.push([key, el, factor]);
    return el;
  };
  const selects: [keyof PatternOptions, HTMLSelectElement][] = [];
  const sel = <T extends string>(key: keyof PatternOptions, opts: [T, string][]) => {
    const el = select(`pattern-${key}`, st[key] as T, opts, (v) => ((st[key] as T) = v)) as HTMLSelectElement;
    selects.push([key, el]);
    return el;
  };
  const checks: [keyof State, HTMLInputElement][] = [];
  const chk = (key: keyof State, label: string) => {
    const el = check(st[key] as boolean, (v) => ((st[key] as boolean) = v), label);
    checks.push([key, el.querySelector('input') as HTMLInputElement]);
    return el;
  };
  /** Put the state into the fields again (after choosing a library pattern) */
  const sync = () => {
    for (const [k, el, f] of nums) el.value = dec(String(+((st[k] as number) * f).toFixed(4)));
    for (const [k, el] of selects) el.value = String(st[k]);
    for (const [k, el] of checks) el.checked = !!st[k];
  };

  // source of the tile
  const srcSel = h('select', { id: 'pattern-source' }) as HTMLSelectElement;
  const opt = (value: string, label: string) => h('option', { value, selected: value === source }, label);
  if (edit) srcSel.append(opt('keep', tileName ? t('Kachel dieses Musters ({name})', { name: tileName }) : t('Kachel dieses Musters')));
  else if (source === 'init') srcSel.append(opt('init', init.pattern!.name));
  else srcSel.append(opt('sel', t('Motiv aus der Auswahl')));
  srcSel.append(h('optgroup', { label: t('Mitgelieferte Muster') }, ...builtin.map((p) => opt(`b:${p.id}`, builtinName(p.id)))));
  // own patterns and patterns from extensions arrive later
  void libraryItems()
    .then((items) => {
      const own = items.filter((x) => x.meta.category === 'pattern' && !x.builtin && !x.broken);
      if (!own.length || !dlg.isConnected) return;
      srcSel.append(h('optgroup', { label: t('Bibliothek und Erweiterungen') }, ...own.map((x) => opt(`l:${x.key}`, x.pack ? `${x.meta.name} (${x.pack})` : x.meta.name))));
    })
    .catch(() => {});
  srcSel.addEventListener('change', async () => {
    const v = srcSel.value;
    source = v;
    if (v === 'keep' && recipe) {
      tile = recipe.tile;
      tileName = recipe.name;
      tileChanged = false;
    } else if (v === 'sel') {
      tile = ed.patternTile(picks);
      tileName = undefined;
    } else if (v === 'init' && init.pattern) useSpec(init.pattern.name, init.pattern.spec);
    else if (v.startsWith('b:')) {
      const p = builtin.find((x) => `b:${x.id}` === v);
      if (p) useSpec(builtinName(p.id), p.spec);
    } else if (v.startsWith('l:')) {
      try {
        const a = await loadLibraryAsset(v.slice(2));
        if (!a.pattern) throw new Error(t('Der Eintrag ist kein Muster.'));
        useSpec(a.name, a.pattern);
      } catch (e) {
        tile = (e as Error).message;
      }
    }
    sync();
    preview();
  });

  // roles of the selected objects (new pattern only)
  const roleRows: HTMLElement[] = [];
  if (!edit && picks.length) {
    for (const p of picks) {
      const s = select(`pattern-role-${p.obj.id}`, p.role, ROLES(), (v) => {
        p.role = v;
        if (source === 'sel') tile = ed.patternTile(picks);
        preview();
      });
      roleRows.push(h('label', { for: `pattern-role-${p.obj.id}`, class: 'pattern-role-name', title: objLabel(p.obj) }, objLabel(p.obj)), s);
    }
  }

  const saveName = h('input', { type: 'text', id: 'pattern-save-name', placeholder: t('Name des Musters') }) as HTMLInputElement;
  const saveBtn = h('button', {
    class: 'btn',
    title: t('Kachel und Wiederholung als Muster in der Bibliothek speichern (Kategorie „Muster“)'),
    onclick: async () => {
      if (typeof tile === 'string') return;
      const name = saveName.value.trim() || tileName || t('Muster|Bibliothek');
      const { repeat, shift, mirror, gapX, gapY, scale, angle, wrap, output } = st;
      try {
        await addToLibrary(patternAsset(name.slice(0, 80), { tile, settings: { repeat, shift, mirror, gapX, gapY, scale, angle, wrap, output } }));
        saveName.value = '';
        info.textContent = t('„{name}“ ist jetzt in der Bibliothek unter „Muster“.', { name });
        info.classList.remove('error');
      } catch (e) {
        info.textContent = (e as Error).message;
        info.classList.add('error');
      }
    },
  }, t('Als Muster speichern'));

  const body = [
    h('label', { for: 'pattern-source' }, t('Muster')),
    srcSel,
    ...(roleRows.length ? [h('div', { class: 'pattern-section' }, t('Gewählte Objekte')), ...roleRows] : []),
    h('div', { class: 'pattern-section' }, t('Wiederholung')),
    h('label', { for: 'pattern-repeat' }, t('Anordnung')),
    sel('repeat', PATTERN_REPEATS.map((r) => [r, repeatLabel(r)])),
    ...when(() => st.repeat === 'brick' || st.repeat === 'halfdrop',
      h('label', { for: 'pattern-shift' }, t('Versatz (%)')),
      num('shift', t('Versatz jeder zweiten Zeile bzw. Spalte in Prozent der Kachel'), 0, 100),
    ),
    ...when(() => st.repeat === 'mirror',
      h('label', { for: 'pattern-mirror' }, t('Spiegeln')),
      sel('mirror', PATTERN_MIRRORS.map((m) => [m, mirrorLabel(m)])),
    ),
    h('label', { for: 'pattern-gapX' }, t('Abstand waagerecht (mm)')),
    num('gapX', t('Zusätzlicher Abstand zwischen den Kacheln; negativ = überlappen')),
    h('label', { for: 'pattern-gapY' }, t('Abstand senkrecht (mm)')),
    num('gapY', t('Zusätzlicher Abstand zwischen den Kacheln; negativ = überlappen')),
    h('label', { for: 'pattern-scale' }, t('Größe (%)')),
    num('scale', t('Größe des ganzen Musters'), 0.05, 100),
    h('label', { for: 'pattern-angle' }, t('Drehung (°)')),
    num('angle', t('Drehung des ganzen Musters, gegen den Uhrzeigersinn')),
    h('label', { for: 'pattern-offsetX' }, t('Verschiebung X (mm)')),
    num('offsetX', t('Muster gegenüber der Mitte der Zielform verschieben')),
    h('label', { for: 'pattern-offsetY' }, t('Verschiebung Y (mm)')),
    num('offsetY', t('Muster gegenüber der Mitte der Zielform verschieben')),
    h('span', { class: 'checks' }, chk('wrap', t('Kanten umbrechen: Was über den Kachelrahmen ragt, läuft in der Nachbarkachel weiter'))),
    h('div', { class: 'pattern-section' }, t('Zielform und Laser')),
    h('label', { for: 'pattern-edge' }, t('Am Rand')),
    sel('edge', PATTERN_EDGES.map((e) => [e, edgeLabel(e)])),
    h('label', { for: 'pattern-margin' }, t('Randabstand (mm)')),
    num('margin', t('Abstand des Musters zum Umriss der Zielform und zu ausgesparten Bereichen'), 0),
    h('label', { for: 'pattern-output' }, t('Ergebnis')),
    sel('output', PATTERN_OUTPUTS.map((o) => [o, outputLabel(o)])),
    ...when(() => st.output === 'lines',
      h('span', { class: 'checks' }, chk('dedupe', t('Doppelte Linien entfernen (nichts wird zweimal gelasert)'))),
    ),
    h('label', { for: 'pattern-minFragment' }, t('Kleinste Reststücke (mm)')),
    num('minFragment', t('Kürzere Linienstücke am Rand (bei Flächen: kleinere Flächen) fallen weg'), 0),
    ...(!edit
      ? [
          h('span', { class: 'checks' }, chk('keepTarget', t('Zielform behalten (z. B. als Schnittkontur)'))),
          h('span', { class: 'checks' }, chk('removeMotif', t('Motiv und Kachelrahmen danach entfernen'))),
        ]
      : []),
    h('div', { class: 'pattern-section' }, t('Bibliothek')),
    h('span', { class: 'hinge-inline' }, saveName, saveBtn),
  ];

  // ---------- Preview ----------
  let timer = 0;
  const compute = () => {
    timer = 0;
    if (!dlg.open) return;
    for (const [cond, els] of vis) {
      const show = cond();
      els.forEach((el) => (el.hidden = !show));
    }
    saveBtn.disabled = typeof tile === 'string';
    const fail = (msg: string) => {
      info.textContent = msg;
      info.classList.add('error');
      ed.setPatternPreview(null);
    };
    if (typeof tile === 'string') return fail(tile);
    let r;
    if (edit && recipe) {
      const rec: PatternRecipe = tileChanged ? { ...recipe, tile, ...(tileName ? { name: tileName } : {}) } : recipe;
      r = ed.patternPreviewSubs(rec, st, ed.worldMatrix(edit));
    } else {
      const setup: PatternSetup | string = ed.patternSetup(picks, tile, tileName);
      if (typeof setup === 'string') return fail(setup);
      r = ed.patternPreviewSubs(setup.recipe, st, setup.center);
    }
    if (r.error) return fail(r.error);
    info.classList.remove('error');
    info.textContent = [`${patternInfo(r.result)}.`, ...r.result.warnings, t('Orange: Vorschau.')].join(' ');
    ed.setPatternPreview(r.subs);
  };
  const preview = () => {
    if (!timer) timer = window.setTimeout(compute, 40);
  };

  let applied = false;
  const dlg = h(
    'dialog',
    { class: 'offset-dialog array-dialog joint-dialog pattern-dialog' },
    h('h3', {}, edit ? t('Muster ändern') : t('Muster füllen')),
    h('div', { class: 'form' }, ...body),
    info,
    h(
      'div',
      { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      h('button', { class: 'btn primary', onclick: () => ((applied = true), dlg.close()) }, edit ? t('Übernehmen') : t('Muster einfügen')),
    ),
  ) as HTMLDialogElement;
  dlg.addEventListener('input', preview);
  dlg.addEventListener('change', preview);
  dlg.addEventListener('close', () => {
    if (timer) clearTimeout(timer);
    ed.setPatternPreview(null);
    if (applied && typeof tile !== 'string') {
      saveState(st);
      if (edit) ed.updatePattern(edit, st, tileChanged ? { tile, name: tileName } : undefined);
      else {
        const s = ed.patternSetup(picks, tile, tileName);
        if (typeof s === 'string') {
          ed.hint = s;
          ed.emit('tool');
        } else ed.insertPattern(picks, s, st, st.keepTarget, st.removeMotif);
      }
    }
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && e.target !== saveName) {
      e.preventDefault();
      applied = true;
      dlg.close();
    }
  });
  document.body.append(dlg);
  dlg.showModal();
  sync();
  compute();
}
