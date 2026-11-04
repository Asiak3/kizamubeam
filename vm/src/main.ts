// Window of the KizamuBeam Virtual Machine: bed with traces, state, connections, notices and console.
// The window fetches data from the controller about 30 times per second (api.poll).

import './style.css';
import { api, hasNative, type ClientInfo, type Config, type ServerInfo, type Snapshot, type VmEvent } from './api';
import { BurnMap, burnSegments, toBed, type Piece } from './burn';
import type { Analysis } from './parts';
import { t } from './i18n';
import { BedView } from './view';
import type { Bed3D, BodyState } from './view3d';
import { LOOK_GROUPS, LOOKS, lookName, resolveLook } from '../../src/view3d/looks';
import { t as tApp } from '../../src/i18n';

const VERSION = '0.3.0';
const PIECES_KEY = 'kizamubeam-vm.pieces';
const VIEW_KEY = 'kizamubeam-vm.view';

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage not available */
    }
  },
};

function loadPieces(): Piece[] {
  try {
    const v = JSON.parse(store.get(PIECES_KEY) ?? '[]') as Piece[];
    const num = (n: unknown, d: number) => (typeof n === 'number' && Number.isFinite(n) ? n : d);
    return Array.isArray(v)
      ? v.filter((p) => p && typeof p.id === 'string').map((p) => ({
          id: p.id,
          look: LOOKS.some((l) => l.id === p.look) ? p.look : 'birch',
          color: typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : undefined,
          x: num(p.x, 0),
          y: num(p.y, 0),
          w: Math.max(1, num(p.w, 100)),
          h: Math.max(1, num(p.h, 100)),
          t: Math.max(0.1, num(p.t, 3)),
          rot: num(p.rot, 0),
        }))
      : [];
  } catch {
    return [];
  }
}
const CONSOLE_MAX = 3000;

type Attrs = Record<string, unknown>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== false) el.append(c);
  return el;
}

const app = document.getElementById('app')!;

if (!hasNative()) {
  app.append(h('div', { class: 'nonative' }, h('h1', {}, 'KizamuBeam Virtual Machine'), h('p', {}, t('Die virtuelle Maschine läuft nur in der Desktop-App „KizamuBeam Virtual Machine“.'))));
} else {
  start();
}

function fmt(n: number, d = 3) {
  const s = n.toFixed(d);
  return s === `-${(0).toFixed(d)}` ? (0).toFixed(d) : s;
}

function time(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

async function start() {
  let cfg = await api.config();
  let info = await api.serverInfo();

  // ---------- header ----------
  const badge = h('span', { class: 'badge' }, '…');
  const chips = h('div', { class: 'chips' });
  const header = h('header', { class: 'top' },
    h('div', { class: 'title' }, h('strong', {}, 'KizamuBeam Virtual Machine'), h('span', { class: 'muted' }, t('Version {v}', { v: VERSION }))),
    badge,
    chips,
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn', title: t('Gefahrene Wege und Brennspuren auf dem Bett entfernen'), onclick: () => view.resetLayers() }, t('Spuren löschen')),
    h('button', { class: 'btn', title: t('Steuerung zurücksetzen (Strg-X): hält an und leert alle Puffer'), onclick: () => api.realtime(0x18) }, t('Zurücksetzen')),
    h('button', { class: 'btn', title: t('Maschine aus- und wieder einschalten: Der Kopf bleibt stehen, die Position beginnt dort bei 0'), onclick: () => api.powerCycle() }, t('Aus/Ein')),
    h('button', { class: 'btn primary', onclick: () => openSettings() }, t('Einstellungen')));

  // ---------- bed ----------
  const stage = h('section', { class: 'stage' });
  const rapidBox = h('input', { type: 'checkbox', checked: true, onchange: () => ((view.showRapids = rapidBox.checked), view.version++, view.invalidate()) });
  const b2d = h('button', { class: 'seg', onclick: () => setMode('2d') }, '2D');
  const b3d = h('button', { class: 'seg', onclick: () => setMode('3d') }, '3D');
  const overlay = h('div', { class: 'overlay' },
    h('div', { class: 'segs' }, b2d, b3d),
    h('label', {}, rapidBox, ' ', t('Eilgänge zeigen')),
    h('button', { class: 'btn small', onclick: () => (mode === '3d' ? bed3d?.fit() : view.fit()) }, t('Ansicht einpassen (Doppelklick)')));
  const help = h('div', { class: 'help muted small' });
  stage.append(overlay, help);
  const view = new BedView(stage);
  view.setBed(cfg.bedW, cfg.bedH);

  // ---------- workpieces ----------
  let pieces = loadPieces();
  const maps = new Map<string, BurnMap>();
  let selected: string | null = null;
  const mapOf = (p: Piece) => {
    let m = maps.get(p.id);
    if (!m || m.w !== p.w || m.h !== p.h) {
      m = new BurnMap(p.w, p.h, p.look, p.t);
      maps.set(p.id, m);
      analyses.delete(p.id);
      bodyStates.delete(p.id);
      analyzed.delete(p.id);
    }
    return m;
  };

  // ---------- cut-out parts (analysis in a worker) ----------
  const analyses = new Map<string, Analysis>();
  /** burn map version each analysis was made from */
  const analyzed = new Map<string, number>();
  const bodyStates = new Map<string, Map<string, BodyState>>();
  const statesOf = (id: string) => {
    let m = bodyStates.get(id);
    if (!m) bodyStates.set(id, (m = new Map()));
    return m;
  };
  const worker = new Worker(new URL('./parts.worker.ts', import.meta.url), { type: 'module' });
  let analysing = false;
  let lastAnalysis = 0;
  /** after a job ended: report parts that still hang once the analysis is up to date */
  let reportHanging = false;
  const analyseNext = (now: number) => {
    if (analysing || now - lastAnalysis < 1200) return;
    const p = pieces.find((q) => maps.has(q.id) && analyzed.get(q.id) !== maps.get(q.id)!.version);
    if (!p) {
      if (reportHanging) {
        reportHanging = false;
        for (const q of pieces) {
          const n = analyses.get(q.id)?.hanging.length ?? 0;
          if (n) notice(t('{name}: {n} Teil(e) hängen noch fest, der Schnitt geht nicht überall ganz durch.', { name: pieceLabel(q), n }), 'warn');
        }
      }
      return;
    }
    const m = maps.get(p.id)!;
    analysing = true;
    lastAnalysis = now;
    const tex = m.tex.slice();
    worker.postMessage({ id: p.id, version: m.version, map: { nx: m.nx, ny: m.ny, res: m.res, tex } }, [tex.buffer]);
  };
  worker.onmessage = (e: MessageEvent<{ id: string; version: number; analysis: Analysis }>) => {
    analysing = false;
    const { id, version, analysis } = e.data;
    if (!pieces.some((p) => p.id === id)) return;
    analyses.set(id, analysis);
    analyzed.set(id, version);
    const st = statesOf(id);
    for (const k of [...st.keys()]) if (!analysis.bodies.some((b) => b.key === k)) st.delete(k);
    bed3d?.setBodies(id, analysis, st);
    renderPieces(false);
    if (id === selected) renderParts();
  };
  worker.onerror = (e) => {
    analysing = false;
    console.error(e);
  };
  const setBodyState = (pieceId: string, key: string, patch: BodyState) => {
    const st = statesOf(pieceId);
    st.set(key, { ...st.get(key), ...patch });
    bed3d?.setBodies(pieceId, analyses.get(pieceId) ?? null, st);
    if (pieceId === selected) renderParts();
  };
  const savePieces = () => store.set(PIECES_KEY, JSON.stringify(pieces));
  const pushPieces = () => {
    for (const id of [...maps.keys()]) if (!pieces.some((p) => p.id === id)) maps.delete(id);
    view.setPieces(pieces, selected);
    bed3d?.setPieces(pieces.map((piece) => ({ piece, map: mapOf(piece) })), selected);
    for (const p of pieces) bed3d?.setBodies(p.id, analyses.get(p.id) ?? null, statesOf(p.id));
  };
  const onMove = (id: string, x: number, y: number, rot: number, done: boolean) => {
    pieces = pieces.map((p) => (p.id === id ? { ...p, x, y, rot } : p));
    pushPieces();
    if (done) savePieces();
    renderPieceForm();
  };
  const onSelect = (id: string | null) => {
    selected = id;
    pushPieces();
    renderPieces();
  };
  view.onMove = onMove;
  view.onSelect = onSelect;

  // ---------- 2D / 3D ----------
  let mode: '2d' | '3d' = store.get(VIEW_KEY) === '3d' ? '3d' : '2d';
  let bed3d: Bed3D | null = null;
  let loading3d = false;
  async function setMode(m: '2d' | '3d') {
    mode = m;
    store.set(VIEW_KEY, m);
    b2d.classList.toggle('on', m === '2d');
    b3d.classList.toggle('on', m === '3d');
    help.textContent = pieces.length
      ? m === '3d'
        ? t('Material ziehen verschiebt es, mit Umschalt drehen, mit Alt ohne Raster. Ansicht: linke Maustaste dreht, rechte verschiebt, Rad zoomt.')
        : t('Material ziehen verschiebt es, mit Umschalt drehen, mit Alt ohne Raster.')
      : '';
    if (m === '3d' && !bed3d && !loading3d) {
      loading3d = true;
      const { Bed3D } = await import('./view3d');
      bed3d = new Bed3D(stage);
      bed3d.setBed(cfg.bedW, cfg.bedH);
      bed3d.onMove = onMove;
      bed3d.onSelect = onSelect;
      bed3d.onBody = (pieceId, key) => setBodyState(pieceId, key, { out: !statesOf(pieceId).get(key)?.out });
      loading3d = false;
      pushPieces();
    }
    view.canvas.style.display = m === '2d' ? '' : 'none';
    if (bed3d) {
      bed3d.canvas.style.display = m === '3d' ? '' : 'none';
      bed3d.active = mode === '3d';
      bed3d.invalidate();
    }
    view.invalidate();
  }

  // ---------- sidebar ----------
  const status = h('dl', { class: 'status' });
  const clientsBox = h('div', { class: 'clients' });
  const hint = h('p', { class: 'hint' }, t('Aus KizamuBeam: Laser → Geräte → Neues Gerät → Vorlage „KizamuBeam Virtual Machine“. Andere Programme: als GRBL- bzw. FluidNC-Gerät über das Netzwerk (Telnet) mit dieser Adresse.'));
  const notices = h('ul', { class: 'notices' });
  const log = h('div', { class: 'log' });
  const showStatus = h('input', { type: 'checkbox', onchange: () => log.classList.toggle('show-status', showStatus.checked) });
  const input = h('input', { type: 'text', placeholder: t('Befehl senden, z. B. $$ oder G0 X10'), spellcheck: false });
  const history: string[] = [];
  let hpos = 0;
  const sendLine = () => {
    const l = input.value.trim();
    if (!l) return;
    if (l === '?') api.realtime(0x3f);
    else if (l === '!') api.realtime(0x21);
    else if (l === '~') api.realtime(0x7e);
    else api.send(l);
    history.push(l);
    hpos = history.length;
    input.value = '';
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendLine();
    else if (e.key === 'ArrowUp' && hpos > 0) input.value = history[--hpos];
    else if (e.key === 'ArrowDown' && hpos < history.length) input.value = history[++hpos] ?? '';
  });
  const quick = (label: string, fn: () => void) => h('button', { class: 'btn small', onclick: fn }, label);
  const pieceList = h('div', { class: 'pieces' });
  const pieceForm = h('div', { class: 'piece-form' });
  const partsBox = h('div', { class: 'parts' });
  const side = h('aside', { class: 'side' },
    h('section', { class: 'card' }, status),
    h('section', { class: 'card' },
      h('div', { class: 'row' }, h('h3', {}, t('Material')), h('button', { class: 'btn small', onclick: () => addPiece() }, t('Material einlegen'))),
      pieceList,
      pieceForm,
      partsBox),
    h('section', { class: 'card' }, h('h3', {}, t('Hier verbinden')), hint, h('h3', {}, t('Verbindungen')), clientsBox),
    h('section', { class: 'card notices-card' }, h('h3', {}, t('Hinweise')), notices),
    h('section', { class: 'card console' },
      h('div', { class: 'row' }, h('h3', {}, t('Konsole')), h('label', { class: 'small' }, showStatus, ' ', t('Statusabfragen zeigen'))),
      log,
      h('div', { class: 'row quick' }, quick('?', () => api.realtime(0x3f)), quick('!', () => api.realtime(0x21)), quick('~', () => api.realtime(0x7e)), quick('$H', () => api.send('$H')), quick('$X', () => api.send('$X')), quick('$$', () => api.send('$$'))),
      h('div', { class: 'row' }, input, h('button', { class: 'btn', onclick: sendLine }, t('Senden')))));

  app.append(header, h('main', { class: 'main' }, stage, side));

  function addPiece() {
    const n = pieces.length;
    const w = Math.min(200, cfg.bedW),
      hh = Math.min(150, cfg.bedH);
    const last = pieces.find((p) => p.id === selected) ?? pieces[n - 1];
    const p: Piece = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      look: last?.look ?? 'birch',
      color: last?.color,
      w: last?.w ?? w,
      h: last?.h ?? hh,
      t: last?.t ?? 3,
      x: Math.max(0, Math.min(cfg.bedW - w, (cfg.bedW - w) / 2 + n * 10)),
      y: Math.max(0, Math.min(cfg.bedH - hh, (cfg.bedH - hh) / 2 - n * 10)),
      rot: 0,
    };
    pieces = [...pieces, p];
    selected = p.id;
    savePieces();
    pushPieces();
    renderPieces();
    setMode(mode);
  }

  const pieceLabel = (p: Piece) => `${lookName(resolveLook({ id: p.look }))} · ${fmt(p.w, 0)} × ${fmt(p.h, 0)} × ${fmt(p.t, 1)} mm`;
  let lastList = '';
  function renderPieces(force = true) {
    const cutState = (p: Piece) => {
      const a = analyses.get(p.id);
      const parts = a?.bodies.filter((b) => b.kind === 'part').length ?? 0;
      const hang = a?.hanging.length ?? 0;
      return [parts, hang, (maps.get(p.id)?.through ?? 0) > 0] as const;
    };
    const key = JSON.stringify([pieces.map((p) => [p.id, pieceLabel(p), cutState(p)]), selected]);
    if (!force && key === lastList) return;
    lastList = key;
    pieceList.replaceChildren(
      ...(pieces.length
        ? pieces.map((p) =>
            h('div', { class: `piece${p.id === selected ? ' on' : ''}`, onclick: () => onSelect(p.id === selected ? null : p.id) },
              h('span', { class: 'swatch', style: `background:${resolveLook({ id: p.look, color: p.color }).color}` }),
              h('span', {}, pieceLabel(p)),
              (() => {
                const [parts, hang, through] = cutState(p);
                const txt = [parts ? t('{n} ausgeschnitten', { n: parts }) : through ? t('durchgeschnitten') : '', hang ? t('{n} hängt fest', { n: hang }) : ''].filter(Boolean).join(' · ');
                return txt ? h('span', { class: `cut small${hang ? ' hang' : ''}` }, txt) : null;
              })()))
        : [h('p', { class: 'muted small' }, t('Noch kein Material eingelegt. Gelaserte Linien brennen sich dann in Echtzeit ein.'))]),
    );
    renderPieceForm();
    renderParts();
  }

  /** Cut-out parts of the selected piece: take out, turn over, look at */
  let partsKey = '';
  function renderParts() {
    const p = pieces.find((q) => q.id === selected);
    const a = p ? analyses.get(p.id) : undefined;
    const st = p ? statesOf(p.id) : new Map<string, BodyState>();
    const key = JSON.stringify([p?.id, a ? a.bodies.map((b) => b.key) : null, a?.hanging.map((x) => [x.cx, x.cy]), [...st]]);
    if (key === partsKey) return;
    partsKey = key;
    if (!p || !a || (a.bodies.length <= 1 && !a.hanging.length)) {
      partsBox.replaceChildren(p ? h('p', { class: 'muted small' }, t('Noch nichts ausgeschnitten. Ausgeschnittene Teile lassen sich hier herausnehmen und ansehen.')) : '');
      return;
    }
    const look = async (k: string) => {
      if (mode !== '3d') await setMode('3d');
      bed3d?.focusBody(p.id, k);
    };
    const rows: (HTMLElement | null)[] = [];
    const split = a.bodies.length > 1;
    const parts = a.bodies.filter((b) => b.kind === 'part').sort((x, y) => y.area - x.area);
    const rests = a.bodies.filter((b) => b.kind === 'rest').sort((x, y) => y.area - x.area);
    const MAX = 40;
    const row = (label: string, b: (typeof a.bodies)[number]) => {
      const s = st.get(b.key) ?? {};
      return h('div', { class: 'part' },
        h('span', { class: 'name' }, label, h('span', { class: 'muted small' }, ` ${fmt(b.x1 - b.x0, 0)} × ${fmt(b.y1 - b.y0, 0)} mm`)),
        h('button', { class: `btn small${s.out ? ' on' : ''}`, onclick: () => setBodyState(p.id, b.key, { out: !s.out }) }, s.out ? t('Zurücklegen') : t('Herausnehmen')),
        h('button', { class: `btn small${s.flip ? ' on' : ''}`, title: t('Rückseite zeigen'), onclick: () => setBodyState(p.id, b.key, { flip: !s.flip }) }, t('Umdrehen')),
        h('button', { class: 'btn small', onclick: () => look(b.key) }, t('Ansehen')));
    };
    if (split) {
      rests.forEach((b, i) => rows.push(row(rests.length > 1 ? `${t('Restmaterial')} ${i + 1}` : t('Restmaterial'), b)));
      parts.slice(0, MAX).forEach((b, i) => rows.push(row(`${t('Teil')} ${i + 1}`, b)));
      if (parts.length > MAX) rows.push(h('p', { class: 'muted small' }, t('und {n} weitere kleine Teile', { n: parts.length - MAX })));
    }
    for (const hg of a.hanging) {
      const [x, y] = toBed(p, hg.cx, hg.cy);
      rows.push(h('p', { class: 'hang small' }, t('Teil bei X {x} / Y {y} hängt noch fest: der Schnitt geht nicht überall ganz durch (orange markiert).', { x: fmt(x, 0), y: fmt(y, 0) })));
    }
    const allOut = parts.length > 1 && parts.every((b) => st.get(b.key)?.out);
    partsBox.replaceChildren(
      h('div', { class: 'row' }, h('h3', {}, t('Ausgeschnitten')),
        parts.length > 1
          ? h('button', { class: 'btn small', onclick: () => parts.forEach((b) => setBodyState(p.id, b.key, { out: !allOut })) }, allOut ? t('Alle zurücklegen') : t('Alle Teile herausnehmen'))
          : null),
      ...rows.filter((r): r is HTMLElement => !!r),
      split ? h('p', { class: 'muted small' }, t('Doppelklick auf ein Teil in der 3D-Ansicht nimmt es heraus oder legt es zurück.')) : '');
  }

  let formFor = '';
  function renderPieceForm() {
    const p = pieces.find((q) => q.id === selected);
    if (!p) {
      pieceForm.replaceChildren();
      formFor = '';
      return;
    }
    // while the same piece is open, only refresh the numbers (keeps focus while typing)
    if (formFor === p.id) {
      for (const el of pieceForm.querySelectorAll<HTMLInputElement>('input[data-k]')) {
        if (document.activeElement === el) continue;
        const k = el.dataset.k as keyof Piece;
        el.value = String(Math.round(Number(p[k]) * 100) / 100);
      }
      return;
    }
    formFor = p.id;
    const update = (patch: Partial<Piece>) => {
      pieces = pieces.map((q) => (q.id === p.id ? { ...q, ...patch } : q));
      const np = pieces.find((q) => q.id === p.id)!;
      const m = maps.get(p.id);
      if (m && m.w === np.w && m.h === np.h) m.setMaterial(np.look, np.t);
      savePieces();
      pushPieces();
      renderPieces(false);
      view.invalidate();
    };
    const num = (label: string, k: 'w' | 'h' | 't' | 'x' | 'y' | 'rot', min: number, step = 1) => {
      const el = h('input', { type: 'number', min, step, value: String(p[k]) });
      el.dataset.k = k;
      el.addEventListener('change', () => {
        const v = Number(el.value);
        if (Number.isFinite(v) && v >= min) update({ [k]: v });
      });
      return [h('label', {}, label), el];
    };
    const sel = h('select', {});
    for (const g of LOOK_GROUPS) {
      const og = h('optgroup', { label: tApp(g.name) });
      for (const l of LOOKS.filter((q) => q.group === g.id)) og.append(h('option', { value: l.id }, lookName(l)));
      sel.append(og);
    }
    sel.value = p.look;
    const color = h('input', { type: 'color', value: resolveLook({ id: p.look, color: p.color }).color });
    color.addEventListener('change', () => update({ color: color.value }));
    sel.addEventListener('change', () => {
      color.value = resolveLook({ id: sel.value }).color;
      update({ look: sel.value, color: undefined });
    });
    pieceForm.replaceChildren(
      h('div', { class: 'grid2' },
        h('label', {}, t('Aussehen')), h('div', { class: 'pair' }, sel, color),
        ...num(t('Breite (mm)'), 'w', 1),
        ...num(t('Tiefe (mm)'), 'h', 1),
        ...num(t('Dicke (mm)'), 't', 0.1, 0.1),
        ...num(t('Lage X (mm)'), 'x', -10000, 0.5),
        ...num(t('Lage Y (mm)'), 'y', -10000, 0.5),
        ...num(t('Drehung (°)'), 'rot', -360, 1)),
      h('p', { class: 'muted small' }, t('Lage = vordere linke Ecke vor dem Drehen; gedreht wird um die Mitte. Eine neue Größe beginnt mit unbearbeitetem Material.')),
      h('div', { class: 'row quick' },
        h('button', { class: 'btn small', onclick: () => (maps.get(p.id)?.clear(), bodyStates.delete(p.id), renderPieces(), bed3d?.invalidate()) }, t('Abbrand entfernen')),
        h('button', {
          class: 'btn small',
          onclick: () => {
            pieces = pieces.filter((q) => q.id !== p.id);
            selected = null;
            savePieces();
            pushPieces();
            renderPieces();
            setMode(mode);
          },
        }, t('Material entfernen'))));
  }
  renderPieces();
  pushPieces();
  setMode(mode);

  // ---------- rendering ----------
  const renderChips = () => {
    chips.replaceChildren();
    const chip = (label: string, r: ServerInfo['telnet'], prefix = '') => {
      if (!r) return h('span', { class: 'chip off' }, `${label}: ${t('ausgeschaltet')}`);
      if ('Err' in r) return h('span', { class: 'chip err', title: r.Err }, `${label}: ${r.Err}`);
      return h('span', { class: 'chip ok', title: r.Ok }, `${label}: ${prefix}${r.Ok}`);
    };
    chips.append(chip(t('Telnet'), info.telnet), chip(t('WebSocket'), info.ws, 'ws://'));
  };
  renderChips();

  const row = (k: string, v: string, cls = '') => [h('dt', {}, k), h('dd', { class: cls }, v)];
  let lastStatus = '';
  const renderStatus = (s: Snapshot) => {
    const off = Math.hypot(s.head[0] - s.mpos[0], s.head[1] - s.mpos[1]) > 0.001;
    const laser = s.spindle === 'M5' ? t('aus') : `${s.spindle} S${fmt(s.s, 0)}${s.laserOn ? ` · ${Math.round(s.power * 100)} %` : ''}`;
    const items = [
      ...row(t('Zustand'), s.state, s.alarm !== null ? 'bad' : ''),
      ...row(t('Maschine (MPos)'), `X ${fmt(s.mpos[0])}  Y ${fmt(s.mpos[1])}  Z ${fmt(s.mpos[2])}`, 'mono'),
      ...row(t('Werkstück (WPos)'), `X ${fmt(s.wpos[0])}  Y ${fmt(s.wpos[1])}  Z ${fmt(s.wpos[2])}`, 'mono'),
      ...(off ? row(t('Kopf tatsächlich'), `X ${fmt(s.head[0])}  Y ${fmt(s.head[1])}`, 'mono bad') : []),
      ...row(t('Vorschub'), `${Math.round(s.feed)} mm/min`, 'mono'),
      ...row(t('Laser'), laser, s.laserOn ? 'hot' : ''),
      ...row(t('Overrides'), `F ${s.ovr[0]} %  R ${s.ovr[1]} %  S ${s.ovr[2]} %`, 'mono'),
      ...row(t('Planer'), `${s.plannerUsed} / ${s.plannerSize}`, 'mono'),
      ...row(t('Air Assist'), [s.flood ? 'M8' : '', s.mist ? 'M7' : ''].filter(Boolean).join(' + ') || t('aus')),
      ...(s.outputs ? row(t('Ausgänge'), Array.from({ length: 64 }, (_, i) => i).filter((i) => (BigInt(s.outputs) >> BigInt(i)) & 1n).join(', ')) : []),
      ...row(t('Referenziert'), s.homed ? t('ja') : t('nein')),
      ...row(t('Laufzeit'), time(s.jobTime), 'mono'),
    ];
    const key = items.map((e) => e.textContent + e.className).join('|');
    if (key === lastStatus) return;
    lastStatus = key;
    status.replaceChildren(...items);
    badge.textContent = s.state;
    badge.className = `badge ${s.alarm !== null ? 'alarm' : s.state === 'Idle' ? 'idle' : s.state.startsWith('Hold') ? 'hold' : 'run'}`;
  };

  let lastClients = '';
  const renderClients = (list: ClientInfo[]) => {
    const key = JSON.stringify(list);
    if (key === lastClients) return;
    lastClients = key;
    clientsBox.replaceChildren(
      ...(list.length ? list.map((c) => h('div', { class: 'client' }, h('span', { class: 'tag' }, `#${c.id}`), ` ${c.kind === 'ws' ? 'WebSocket' : 'Telnet'} · ${c.addr}`)) : [h('p', { class: 'muted' }, t('Noch keine Verbindung.'))]),
    );
  };

  const notice = (text: string, cls = '') => {
    const now = new Date();
    notices.prepend(h('li', { class: cls }, h('span', { class: 'muted' }, now.toLocaleTimeString()), ' ', text));
    while (notices.children.length > 30) notices.lastElementChild!.remove();
  };

  const alarmText = (code: number) =>
    code === 1 ? t('ALARM:1 – Endschalter während der Fahrt ausgelöst')
      : code === 2 ? t('ALARM:2 – Ziel außerhalb des Fahrwegs (weiche Grenzen)')
        : code === 3 ? t('ALARM:3 – während der Bewegung zurückgesetzt, Position evtl. verloren')
          : t('ALARM:{n}', { n: code });

  const handle = (e: VmEvent) => {
    if (e.type === 'console') {
      const who = e.client === 0xffffffff ? '*' : e.client === 0 ? '·' : `#${e.client}`;
      const el = h('div', { class: `l ${e.dir}${e.status ? ' st' : ''}` }, h('span', { class: 'who' }, who), e.text);
      log.append(el);
    } else if (e.type === 'warning') {
      if (e.code === 'rxOverflow') notice(t('Verbindung #{c} hat mehr gesendet, als in den Empfangspuffer ({n} Bytes) passt. Eine echte Steuerung würde Zeichen verlieren.', { c: e.client ?? '?', n: cfg.rxBuffer }), 'warn');
      else notice(t('Der Kopf ist bei X {x} / Y {y} gegen den Rahmen gefahren. Eine echte Maschine verliert dabei Schritte; die gemeldete Position stimmt danach nicht mehr.', { x: fmt(e.x, 1), y: fmt(e.y, 1) }), 'warn');
    } else if (e.type === 'alarm') {
      notice(alarmText(e.code), 'bad');
    } else if (e.type === 'configChanged') {
      api.config().then((c) => {
        cfg = c;
        view.setBed(c.bedW, c.bedH);
        bed3d?.setBed(c.bedW, c.bedH);
      });
    }
  };

  // ---------- polling ----------
  let busy = false;
  let lastState = '';
  let lastPoll = 0;
  const frame = async (ts: number) => {
    requestAnimationFrame(frame);
    if (mode === '3d' && bed3d) {
      bed3d.setTraces(view.version, () => view.traceImage());
      bed3d.draw();
    } else view.draw();
    if (busy || ts - lastPoll < 30) return;
    busy = true;
    lastPoll = ts;
    try {
      const p = await api.poll();
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
      for (const e of p.events) handle(e);
      while (log.childElementCount > CONSOLE_MAX) log.firstElementChild!.remove();
      if (atBottom) log.scrollTop = log.scrollHeight;
      if (p.segments.length && pieces.length) {
        burnSegments(p.segments, cfg.laserWatts, pieces.map((piece) => ({ piece, map: mapOf(piece) })));
        renderPieces(false);
      }
      view.addSegments(p.segments);
      view.update(p.snapshot);
      bed3d?.update(p.snapshot);
      if (p.snapshot.state === 'Idle' && lastState !== 'Idle' && lastState !== '') {
        reportHanging = true;
        lastAnalysis = 0;
      }
      lastState = p.snapshot.state;
      analyseNext(ts);
      renderStatus(p.snapshot);
      renderClients(p.clients);
    } catch (err) {
      console.error(err);
    } finally {
      busy = false;
    }
  };
  requestAnimationFrame(frame);

  // ---------- settings ----------
  async function openSettings() {
    const c: Config = { ...cfg };
    const lan = await api.lanAddresses().catch(() => [] as string[]);
    const num = (label: string, key: keyof Config, step = 1, min = 0) => {
      const el = h('input', { type: 'number', step, min, value: String(c[key]) });
      el.addEventListener('change', () => ((c as unknown as Record<string, number>)[key] = Number(el.value)));
      return [h('label', {}, label), el];
    };
    const check = (label: string, key: keyof Config) => {
      const el = h('input', { type: 'checkbox', checked: Boolean(c[key]) });
      el.addEventListener('change', () => ((c as unknown as Record<string, boolean>)[key] = el.checked));
      return h('label', { class: 'check' }, el, ' ', label);
    };
    const flavor = h('select', {}, h('option', { value: 'fluidnc' }, 'FluidNC 3.7'), h('option', { value: 'grbl' }, 'GRBL 1.1h'));
    flavor.value = c.flavor;
    flavor.addEventListener('change', () => (c.flavor = flavor.value as Config['flavor']));
    const bedW = h('input', { type: 'number', min: 10, step: 1, value: String(c.bedW) });
    const bedH = h('input', { type: 'number', min: 10, step: 1, value: String(c.bedH) });
    bedW.addEventListener('change', () => (c.bedW = Number(bedW.value)));
    bedH.addEventListener('change', () => (c.bedH = Number(bedH.value)));
    const mpos = h('input', { type: 'checkbox', checked: (c.statusMask & 1) === 1 });
    const bf = h('input', { type: 'checkbox', checked: (c.statusMask & 2) === 2 });
    const note = h('p', { class: 'note' });
    const dlg = h('dialog', { class: 'settings' },
      h('h2', {}, t('Einstellungen')),
      h('h3', {}, t('Steuerung')),
      h('div', { class: 'grid' },
        h('label', {}, t('Firmware')), flavor,
        h('label', {}, t('Fahrweg (mm)')), h('div', { class: 'pair' }, bedW, '×', bedH),
        ...num(t('Höchstgeschwindigkeit (mm/min)'), 'maxRate', 100, 60),
        ...num(t('Beschleunigung (mm/s²)'), 'accel', 50, 10),
        ...num(t('Junction Deviation (mm)'), 'junctionDev', 0.001, 0.001),
        ...num(t('S-Wert für 100 %'), 'sMax', 1, 1),
        ...num(t('Laserleistung (W, optisch)'), 'laserWatts', 0.5, 0.1),
        ...num(t('Empfangspuffer (Bytes)'), 'rxBuffer', 1, 64),
        ...num(t('Plätze im Planer'), 'plannerBlocks', 1, 4)),
      check(t('Laser-Modus ($32): Laser nur bei G1/G2/G3 an, M4 passt die Leistung an'), 'laserMode'),
      check(t('Endschalter vorhanden (Referenzfahrt $H)'), 'homing'),
      check(t('Nach dem Einschalten erst referenzieren (must_home)'), 'mustHome'),
      check(t('Weiche Grenzen ($20)'), 'softLimits'),
      check(t('Harte Grenzen ($21)'), 'hardLimits'),
      h('label', { class: 'check' }, mpos, ' ', t('Status mit Maschinenkoordinaten (MPos)')),
      h('label', { class: 'check' }, bf, ' ', t('Pufferstand im Status (Bf)')),
      h('h3', {}, t('Netzwerk')),
      h('div', { class: 'grid' },
        check(t('Telnet-Port'), 'telnetEnabled'), h('input', { type: 'number', min: 1, max: 65535, value: String(c.telnetPort), onchange: (e: Event) => (c.telnetPort = Number((e.target as HTMLInputElement).value)) }),
        check(t('WebSocket-Port'), 'wsEnabled'), h('input', { type: 'number', min: 1, max: 65535, value: String(c.wsPort), onchange: (e: Event) => (c.wsPort = Number((e.target as HTMLInputElement).value)) })),
      check(t('Auch aus dem Netzwerk erreichbar (sonst nur von diesem Rechner)'), 'lan'),
      lan.length ? h('p', { class: 'muted small' }, t('Adresse im Netzwerk: {ip}', { ip: lan.join(', ') })) : null,
      h('p', { class: 'muted small' }, t('Ports unter 1024 brauchen auf macOS und Linux Administratorrechte.')),
      note,
      h('div', { class: 'buttons' },
        h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            c.statusMask = (mpos.checked ? 1 : 0) | (bf.checked ? 2 : 0);
            for (const p of [c.telnetPort, c.wsPort]) {
              if (!Number.isInteger(p) || p < 1 || p > 65535) return void (note.textContent = t('Port {p} ist ungültig.', { p }));
            }
            if (c.telnetEnabled && c.wsEnabled && c.telnetPort === c.wsPort) return void (note.textContent = t('Telnet und WebSocket brauchen verschiedene Ports.'));
            info = await api.setConfig(c);
            cfg = await api.config();
            view.setBed(cfg.bedW, cfg.bedH);
            bed3d?.setBed(cfg.bedW, cfg.bedH);
            renderChips();
            dlg.close();
          },
        }, t('Speichern'))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }
}
