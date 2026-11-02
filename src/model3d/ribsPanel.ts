// Zeichenfläche im Dialog des Rippenmodells: Das Modell von vorne, von der Seite oder von oben, darin die Achsen
// der Abschnitte (Rumpf, Beine, Schwanz …) zum Zeichnen und Ziehen, die Teile als Umrisse und eine Liste der
// Abschnitte mit ihren Einstellungen. Ändert nur den Parameter „sections“ (JSON); gerechnet wird im Generator.
import { h } from '../dom';
import { t } from '../i18n';
import type { Params } from '../generators/types';
import { getMesh } from './store';
import type { Mesh } from './mesh';
import type { V3 } from './slice';
import { suggestSections } from './suggest';
import { materialAlong, parseSections, ribsLayout, Section, View, VIEWS, worldMesh } from '../generators/ribs';

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fmt = (v: number) => String(Math.round(v * 10) / 10);

const VIEW_LABEL: Record<View, () => string> = {
  xz: () => t('von vorne (X–Z)'),
  yz: () => t('von der Seite (Y–Z)'),
  xy: () => t('von oben (X–Y)'),
};

export interface GenPanel {
  el: HTMLElement;
  refresh(np: Params): void;
}

/** Bereich der Zeichenfläche (CSS-Pixel); die Leinwand wird für scharfe Linien größer angelegt */
const CW = 560,
  CH = 300;

export function ribsPanel(p: Params, set: (patch: Params) => void): GenPanel {
  let np: Params = p;
  let view: View = 'xz';
  let secs: Section[] = parseSections(String(p.sections ?? '')) ?? [];
  let sel = secs.length ? 0 : -1;
  let drawing: Section | null = null;
  let mouse: { a: number; b: number } | null = null;

  const canvas = h('canvas', { class: 'ribs-canvas', width: CW * 2, height: CH * 2, tabindex: '0' }) as HTMLCanvasElement;
  const list = h('div', { class: 'ribs-list' });
  const hint = h('div', { class: 'note ribs-hint' });
  const tabs = (['xz', 'yz', 'xy'] as View[]).map((v) =>
    h('button', { class: 'small', onclick: () => ((view = v), draw(), syncTabs()) }, VIEW_LABEL[v]()),
  );
  const syncTabs = () => tabs.forEach((b, i) => b.classList.toggle('on', (['xz', 'yz', 'xy'] as View[])[i] === view));
  const addBtn = h('button', { class: 'small', onclick: () => startDrawing() }, t('+ Abschnitt zeichnen'));
  const simpleBtn = h('button', { class: 'small', onclick: () => commit([]) }, t('Einfache Achse'));
  const manualBtn = h('button', { class: 'small', onclick: () => toManual() }, t('Abschnitte von Hand festlegen'));
  const suggestBtn = h('button', {
    class: 'small',
    title: t('Rumpf, Beine und Schwanz im Modell suchen und als Abschnitte anlegen; danach von Hand korrigieren'),
    onclick: () => {
      const m = getMesh(String(np.model ?? ''));
      if (!m) return;
      hint.textContent = t('Modell wird untersucht …');
      suggestBtn.disabled = true;
      // Erst zeichnen lassen, dann rechnen
      setTimeout(() => {
        try {
          const res = suggestSections(m, np);
          if (res.sections.length) {
            sel = 0;
            view = res.sections[0].view;
            syncTabs();
            commit(res.sections);
            hint.textContent = t('Vorschlag: {found}. Achsen prüfen und bei Bedarf ziehen.', { found: res.found });
          } else hint.textContent = res.found;
        } finally {
          suggestBtn.disabled = false;
        }
      }, 30);
    },
  }, t('Vorschlagen'));

  const commit = (next: Section[]) => {
    secs = next;
    if (sel >= secs.length) sel = secs.length - 1;
    set({ sections: secs.length ? JSON.stringify(secs) : '' });
  };

  // ---- Modell in Weltkoordinaten (wie der Generator es schneidet) ----
  let worldKey = '';
  let world: { mesh: Mesh; dims: V3; lo: V3; hi: V3 } | null = null;
  const getWorld = () => {
    const key = [np.model, np.up, np.size].join('|');
    if (key !== worldKey) {
      worldKey = key;
      silhouettes.clear();
      const m = getMesh(String(np.model ?? ''));
      if (!m) world = null;
      else {
        const wm = worldMesh(m, String(np.up), Number(np.size));
        const lo: V3 = [Infinity, Infinity, Infinity],
          hi: V3 = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < wm.mesh.pos.length; i += 3)
          for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k], wm.mesh.pos[i + k])), (hi[k] = Math.max(hi[k], wm.mesh.pos[i + k]));
        world = { ...wm, lo, hi };
      }
    }
    return world;
  };

  // ---- Abbildung Ansicht ↔ Leinwand ----
  const frame = () => {
    const w = getWorld();
    const V = VIEWS[view];
    const range = (e: V3) => (w ? [Math.min(dot(w.lo, e), dot(w.hi, e)), Math.max(dot(w.lo, e), dot(w.hi, e))] : [-50, 50]);
    const [a0, a1] = range(V.e1),
      [b0, b1] = range(V.e2);
    const k = Math.min((CW * 0.9) / Math.max(1, a1 - a0), (CH * 0.88) / Math.max(1, b1 - b0));
    return { k, ox: CW / 2 - ((a0 + a1) / 2) * k, oy: CH / 2 + ((b0 + b1) / 2) * k };
  };
  const toScreen = (a: number, b: number) => {
    const f = frame();
    return { x: f.ox + a * f.k, y: f.oy - b * f.k };
  };
  const fromScreen = (x: number, y: number) => {
    const f = frame();
    return { a: (x - f.ox) / f.k, b: (f.oy - y) / f.k };
  };
  const proj = (q: V3) => ({ a: dot(q, VIEWS[view].e1), b: dot(q, VIEWS[view].e2) });
  const secPoint3 = (s: Section, q: [number, number]): V3 => {
    const V = VIEWS[s.view];
    return [V.e1[0] * q[0] + V.e2[0] * q[1] + V.n[0] * s.offset, V.e1[1] * q[0] + V.e2[1] * q[1] + V.n[1] * s.offset, V.e1[2] * q[0] + V.e2[2] * q[1] + V.n[2] * s.offset];
  };

  // ---- Umriss des Modells je Ansicht (einmal gezeichnet) ----
  const silhouettes = new Map<View, HTMLCanvasElement>();
  const silhouette = (): HTMLCanvasElement | null => {
    const w = getWorld();
    if (!w) return null;
    let c = silhouettes.get(view);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = CW * 2;
    c.height = CH * 2;
    const ctx = c.getContext('2d')!;
    const f = frame();
    const V = VIEWS[view];
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--text').trim() || '#444';
    ctx.globalAlpha = 1;
    ctx.beginPath();
    const P = w.mesh.pos,
      T = w.mesh.tri;
    // Alle Dreiecke gleich herum, sonst heben sich Vorder- und Rückseite beim Füllen auf
    const xs = [0, 0, 0],
      ys = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < T.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const j = T[i + k] * 3;
        const q: V3 = [P[j], P[j + 1], P[j + 2]];
        xs[k] = f.ox + dot(q, V.e1) * f.k;
        ys[k] = f.oy - dot(q, V.e2) * f.k;
      }
      const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
      if (Math.abs(area) < 1e-9) continue;
      const order = area > 0 ? [0, 1, 2] : [0, 2, 1];
      ctx.moveTo(xs[order[0]], ys[order[0]]);
      ctx.lineTo(xs[order[1]], ys[order[1]]);
      ctx.lineTo(xs[order[2]], ys[order[2]]);
      ctx.closePath();
      // In Portionen füllen: ein Pfad mit Zehntausenden Teilstücken ist beim Füllen sehr langsam
      if (++n % 400 === 0) {
        ctx.fill('nonzero');
        ctx.beginPath();
      }
    }
    ctx.fill('nonzero');
    silhouettes.set(view, c);
    return c;
  };

  // ---- Zeichnen ----
  function draw() {
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const css = getComputedStyle(canvas);
    const accent = css.getPropertyValue('--accent').trim() || '#2b7de9';
    const text = css.getPropertyValue('--text').trim() || '#333';
    const sil = silhouette();
    if (sil) {
      ctx.globalAlpha = 0.14;
      ctx.drawImage(sil, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    // Teile als Umrisse (Rückgrat dunkler)
    const L = np.model ? ribsLayout(np) : null;
    if (L) {
      const th = Number(np.thickness) || 3;
      for (const part of [...L.ribs, ...L.spine]) {
        const isSpine = part.key.startsWith('S');
        ctx.strokeStyle = isSpine ? text : accent;
        ctx.globalAlpha = isSpine ? 0.55 : 0.45;
        ctx.lineWidth = isSpine ? 1.2 : 0.8;
        const { o, u, v, n } = part.pose;
        for (const poly of part.polys) {
          ctx.beginPath();
          poly.forEach((q, i) => {
            const p3: V3 = [o[0] + u[0] * q.x + v[0] * q.y + n[0] * th / 2, o[1] + u[1] * q.x + v[1] * q.y + n[1] * th / 2, o[2] + u[2] * q.x + v[2] * q.y + n[2] * th / 2];
            const s = toScreen(proj(p3).a, proj(p3).b);
            if (i) ctx.lineTo(s.x, s.y);
            else ctx.moveTo(s.x, s.y);
          });
          ctx.closePath();
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      // Einfache Achse: gestrichelt zeigen
      if (!secs.length && L.sections[0]) {
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        L.sections[0].axis.forEach((q, i) => {
          const s = toScreen(proj(q).a, proj(q).b);
          if (i) ctx.lineTo(s.x, s.y);
          else ctx.moveTo(s.x, s.y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // Achsen der Abschnitte
    const all = drawing ? [...secs, drawing] : secs;
    all.forEach((s, i) => {
      const native = s.view === view;
      const active = s === drawing || i === sel;
      const pts = s.pts.map((q) => {
        const p3 = secPoint3(s, q);
        return toScreen(proj(p3).a, proj(p3).b);
      });
      if (s === drawing && mouse) pts.push(toScreen(mouse.a, mouse.b));
      ctx.strokeStyle = active ? accent : text;
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.setLineDash(native ? [] : [4, 3]);
      ctx.beginPath();
      pts.forEach((s2, k) => (k ? ctx.lineTo(s2.x, s2.y) : ctx.moveTo(s2.x, s2.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      if (native)
        for (const q of pts.slice(0, s.pts.length)) {
          ctx.beginPath();
          ctx.arc(q.x, q.y, active ? 4 : 3, 0, Math.PI * 2);
          ctx.fillStyle = active ? accent : text;
          ctx.fill();
        }
      if (pts.length) {
        ctx.fillStyle = active ? accent : text;
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(s.name, pts[0].x + 6, pts[0].y - 6);
      }
    });
  }

  // ---- Liste der Abschnitte ----
  const field = (val: number, title: string, onset: (v: number) => void, placeholder = '') => {
    const el = h('input', { type: 'text', class: 'ribs-num', value: val ? fmt(val) : '', title, placeholder }) as HTMLInputElement;
    el.addEventListener('change', () => {
      const v = el.value.trim() === '' ? 0 : Number(el.value.replace(',', '.'));
      if (isFinite(v)) onset(v);
    });
    return el;
  };
  function renderList() {
    const L = np.model ? ribsLayout(np) : null;
    manualBtn.hidden = secs.length > 0;
    simpleBtn.hidden = secs.length === 0;
    if (!secs.length) {
      list.replaceChildren(h('div', { class: 'muted' }, t('Einfache Achse über das ganze Modell. Für Kopf, Beine oder Schwanz eigene Abschnitte zeichnen.')));
      return;
    }
    const head = h('div', { class: 'ribs-row ribs-head muted' },
      h('span', {}, t('Name')), h('span', {}, t('Ebene bei')), h('span', {}, t('Abstand')), h('span', {}, t('Verlängern')), h('span', {}, t('Radius')), h('span', {}, t('Rippen')), h('span'));
    const rows = secs.map((s, i) => {
      const info = L?.manual ? L.sections[i] : undefined;
      const upd = (patch: Partial<Section>) => commit(secs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
      const name = h('input', { type: 'text', value: s.name, class: 'ribs-name' }) as HTMLInputElement;
      name.addEventListener('change', () => upd({ name: name.value.trim() || s.name }));
      const row = h('div', { class: 'ribs-row' + (i === sel ? ' on' : ''), onclick: () => ((sel = i), (view = s.view), syncTabs(), draw(), mark()) },
        name,
        h('span', { class: 'ribs-off' },
          field(s.offset, t('Lage der Ebene quer zur Ansicht {view} (mm)', { view: VIEW_LABEL[s.view]() }), (v) => upd({ offset: v }), '0'),
          h('button', { class: 'small', title: t('Ebene in die Mitte des Materials an der Achse legen'), onclick: () => upd({ offset: centerOffset(s) }) }, t('Mitte')),
        ),
        field(s.spacing, t('Rippenabstand in diesem Abschnitt; leer = wie oben'), (v) => upd({ spacing: v }), fmt(Number(np.spacing))),
        field(s.extend, t('Rückgrat an beiden Enden um so viel über die Achse hinaus verlängern, z. B. damit die Beinplatte in den Rumpf reicht'), (v) => upd({ extend: v }), '0'),
        field(s.radius, t('Gebiet um die Achse, das zu diesem Abschnitt gehört; leer = automatisch'), (v) => upd({ radius: v }), info && isFinite(info.radius) ? fmt(info.radius) : t('auto')),
        h('span', { class: 'ribs-count' + (info && (!info.ribs || info.bend) ? ' warn' : '') }, info ? `${info.ribs}/${info.count}` : '–'),
        h('span', {},
          h('button', { class: 'small', title: t('Kopie (bei Versatz gespiegelt, z. B. für das zweite Bein)'), onclick: (e: Event) => (e.stopPropagation(), copy(i)) }, '⧉'),
          h('button', { class: 'small', title: t('Abschnitt löschen'), onclick: (e: Event) => (e.stopPropagation(), commit(secs.filter((_, k) => k !== i))) }, '✕'),
        ),
      );
      return row;
    });
    list.replaceChildren(head, ...rows);
  }
  const mark = () => list.querySelectorAll('.ribs-row:not(.ribs-head)').forEach((r, i) => r.classList.toggle('on', i === sel));

  const copy = (i: number) => {
    const s = secs[i];
    const c: Section = { ...s, pts: s.pts.map((q) => [q[0], q[1]]), name: nextName(s.name), offset: Math.abs(s.offset) > 0.5 ? -s.offset : s.offset };
    sel = secs.length;
    commit([...secs, c]);
  };
  const freshName = () => {
    let n = secs.length + 1;
    while (secs.some((s) => s.name === t('Abschnitt {n}', { n }))) n++;
    return t('Abschnitt {n}', { n });
  };
  const nextName = (base: string) => {
    const m = /^(.*?)(\d+)$/.exec(base);
    let n = m ? Number(m[2]) + 1 : 2;
    const stem = m ? m[1] : base + ' ';
    while (secs.some((s) => s.name === stem + n)) n++;
    return stem + n;
  };

  /** Mitte des Materials entlang der Normalen am Mittelpunkt der Achse, am nächsten zur bisherigen Lage */
  function centerOffset(s: Section): number {
    const w = getWorld();
    if (!w || !s.pts.length) return s.offset;
    const V = VIEWS[s.view];
    const mid = s.pts[Math.floor((s.pts.length - 1) / 2)];
    const nxt = s.pts[Math.min(s.pts.length - 1, Math.floor((s.pts.length - 1) / 2) + 1)];
    const a = (mid[0] + nxt[0]) / 2,
      b = (mid[1] + nxt[1]) / 2;
    const far = dot(w.lo, V.n) - 10;
    const o: V3 = [V.e1[0] * a + V.e2[0] * b + V.n[0] * far, V.e1[1] * a + V.e2[1] * b + V.n[1] * far, V.e1[2] * a + V.e2[2] * b + V.n[2] * far];
    const iv = materialAlong(w.mesh, o, V.n);
    if (!iv.length) return s.offset;
    let best = s.offset,
      bd = Infinity;
    for (const [t0, t1] of iv) {
      const c = far + (t0 + t1) / 2;
      if (Math.abs(c - s.offset) < bd) (bd = Math.abs(c - s.offset)), (best = c);
    }
    return Math.round(best * 10) / 10;
  }

  // ---- Von der einfachen Achse zu Abschnitten ----
  function toManual() {
    const L = np.model ? ribsLayout(np) : null;
    const s0 = L?.sections[0];
    if (!s0) return startDrawing();
    const V = VIEWS[s0.view];
    view = s0.view;
    syncTabs();
    sel = 0;
    commit([{ name: t('Rumpf'), view: s0.view, pts: s0.axis.map((q) => [Math.round(dot(q, V.e1) * 10) / 10, Math.round(dot(q, V.e2) * 10) / 10]), offset: Math.round(s0.offset * 10) / 10, spacing: 0, radius: 0, extend: 0 }]);
  }

  // ---- Zeichnen einer neuen Achse ----
  function startDrawing() {
    drawing = { name: freshName(), view, pts: [], offset: 0, spacing: 0, radius: 0, extend: 0 };
    hint.textContent = t('Klicken setzt Punkte der Achse, Doppelklick oder Enter beendet, Esc bricht ab.');
    canvas.focus();
    draw();
  }
  function finishDrawing() {
    const d = drawing;
    drawing = null;
    mouse = null;
    hint.textContent = '';
    if (!d || d.pts.length < 2) return draw();
    d.offset = centerOffset({ ...d, offset: 0 });
    sel = secs.length;
    commit([...secs, d]);
  }

  // ---- Maus ----
  const pos = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * CW, y: ((e.clientY - r.top) / r.height) * CH };
  };
  type Drag = { kind: 'point'; s: number; k: number } | { kind: 'move'; s: number; a: number; b: number; orig: Section } | { kind: 'offset'; s: number; a: number; b: number; orig: Section };
  let drag: Drag | null = null;
  const hit = (x: number, y: number): Drag | null => {
    const order = sel >= 0 ? [sel, ...secs.map((_, i) => i).filter((i) => i !== sel)] : secs.map((_, i) => i);
    for (const i of order) {
      const s = secs[i];
      if (s.view !== view) continue;
      for (let k = 0; k < s.pts.length; k++) {
        const q = toScreen(s.pts[k][0], s.pts[k][1]);
        if (Math.hypot(q.x - x, q.y - y) < 7) return { kind: 'point', s: i, k };
      }
    }
    const m = fromScreen(x, y);
    for (const i of order) {
      const s = secs[i];
      const pts = s.pts.map((q) => {
        const p3 = secPoint3(s, q);
        return toScreen(proj(p3).a, proj(p3).b);
      });
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k],
          b = pts[k + 1];
        const dx = b.x - a.x,
          dy = b.y - a.y;
        const l = dx * dx + dy * dy || 1;
        const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l));
        if (Math.hypot(a.x + u * dx - x, a.y + u * dy - y) < 6)
          {
          // Kopie: beim Ziehen wird der Abschnitt selbst geändert
          const orig: Section = { ...s, pts: s.pts.map((q) => [q[0], q[1]] as [number, number]) };
          return s.view === view ? { kind: 'move', s: i, a: m.a, b: m.b, orig } : { kind: 'offset', s: i, a: m.a, b: m.b, orig };
        }
      }
    }
    return null;
  };
  canvas.tabIndex = 0;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const { x, y } = pos(e);
    const m = fromScreen(x, y);
    if (drawing) {
      drawing.pts.push([Math.round(m.a * 10) / 10, Math.round(m.b * 10) / 10]);
      draw();
      return;
    }
    drag = hit(x, y);
    if (drag) {
      sel = drag.s;
      mark();
    }
    draw();
  });
  canvas.addEventListener('mousemove', (e) => {
    const { x, y } = pos(e);
    const m = fromScreen(x, y);
    if (drawing) {
      mouse = m;
      return draw();
    }
    canvas.style.cursor = hit(x, y) ? 'move' : 'default';
    if (!drag) return;
    const s = secs[drag.s];
    if (drag.kind === 'point') s.pts[drag.k] = [Math.round(m.a * 10) / 10, Math.round(m.b * 10) / 10];
    else if (drag.kind === 'move') {
      const da = m.a - drag.a,
        db = m.b - drag.b;
      s.pts = drag.orig.pts.map((q) => [Math.round((q[0] + da) * 10) / 10, Math.round((q[1] + db) * 10) / 10]);
    } else {
      // Andere Ansicht: Ziehen verschiebt die Ebene entlang ihrer Normalen
      const V = VIEWS[view],
        N = VIEWS[s.view].n;
      const d = (m.a - drag.a) * dot(V.e1, N) + (m.b - drag.b) * dot(V.e2, N);
      s.offset = Math.round((drag.orig.offset + d) * 10) / 10;
    }
    draw();
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    commit(secs.map((s) => ({ ...s, pts: s.pts.map((q) => [q[0], q[1]] as [number, number]) })));
  };
  canvas.addEventListener('mouseup', endDrag);
  canvas.addEventListener('mouseleave', endDrag);
  canvas.addEventListener('dblclick', () => {
    if (!drawing) return;
    // Der Doppelklick hat zwei Punkte an derselben Stelle gesetzt
    const pts = drawing.pts;
    while (pts.length > 1 && Math.hypot(pts[pts.length - 1][0] - pts[pts.length - 2][0], pts[pts.length - 1][1] - pts[pts.length - 2][1]) < 0.5) pts.pop();
    finishDrawing();
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const { x, y } = pos(e);
    const d = hit(x, y);
    if (d?.kind === 'point' && secs[d.s].pts.length > 2) commit(secs.map((s, i) => (i === d.s ? { ...s, pts: s.pts.filter((_, k) => k !== d.k) } : s)));
  });
  canvas.addEventListener('keydown', (e) => {
    if (!drawing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      finishDrawing();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      drawing = null;
      hint.textContent = '';
      draw();
    }
  });

  const el = h('div', { class: 'ribs-panel' },
    h('div', { class: 'ribs-bar' }, h('b', {}, t('Abschnitte')), ...tabs, h('span', { class: 'grow' }), suggestBtn, manualBtn, addBtn, simpleBtn),
    canvas,
    hint,
    list,
    h('div', { class: 'note muted' }, t('Punkte ziehen verschiebt die Achse, die Linie ziehen verschiebt den ganzen Abschnitt; in einer anderen Ansicht verschiebt Ziehen die Ebene. Rechtsklick auf einen Punkt löscht ihn.')),
  );
  // Enter in den Feldern übernimmt nur den Wert und erzeugt nicht gleich das Modell
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  });
  syncTabs();
  return {
    el,
    refresh(next: Params) {
      np = next;
      const parsed = parseSections(String(next.sections ?? '')) ?? [];
      if (!drag) secs = parsed;
      if (sel >= secs.length) sel = secs.length - 1;
      renderList();
      draw();
    },
  };
}
