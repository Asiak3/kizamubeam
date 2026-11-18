// Dialog „Auf Werkstücke übertragen“: gleichartige Werkstücke im Kamerabild erkennen und die Auswahl auf alle legen.
// Vorlage ist entweder ein mit ausgewählter, geschlossener Umriss, der das übrige Design umschließt, oder das
// erkannte Werkstück unter dem Design. Vorschau im Dialog (Klick schaltet ein Werkstück an oder aus) und als
// orange gestrichelte Kopien auf der Arbeitsfläche.
import { Editor } from './editor';
import { check } from './arrayDialogs';
import { cameraViews } from './cameraui';
import { flattenSub, SCALE } from './clip';
import { h } from './dom';
import { boundsOf, Box, shapeSubs } from './geom';
import { dec, t, tn } from './i18n';
import { getTypography, groupFactor, onTypographyChange, resolveTypography } from './uiTypography';
import { cloneObjs, IDENT, Mat, mul, newId, Obj, Pt, visibleLeaves } from './model';
import { Blob, blobFromPolys, DEFAULT_DETECT, detectPieces, inside, Match, matchPiece, Piece, pieceMatrix, RGBAImage } from './workpieces';

const KEY = 'kizamubeam.workpieces';
/** Längere Seite des Bilds für die Erkennung in Pixeln */
const DETECT_PX = 1200;

interface Settings {
  sensitivity: number;
  minArea: number;
  useEmpty: boolean;
  copyOutline: boolean;
  hideTemplate: boolean;
  group: boolean;
  cam: string;
}
const DEFAULTS: Settings = { ...DEFAULT_DETECT, useEmpty: true, copyOutline: false, hideTemplate: true, group: false, cam: '' };

function load(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}
function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* Speicher nicht verfügbar */
  }
}

/** Geschlossener Umriss in der Auswahl, der alle übrigen gewählten Objekte umschließt (der größte) */
function findOutline(sel: Obj[]): Obj | null {
  if (sel.length < 2) return null;
  let best: Obj | null = null,
    bestA = 0;
  for (const o of sel) {
    const b = boundsOf([o]);
    if (!b || !isClosedOutline(o)) continue;
    const others = sel.filter((x) => x !== o);
    const ob = boundsOf(others);
    const tol = 0.5;
    if (!ob || ob.x < b.x - tol || ob.y < b.y - tol || ob.x + ob.w > b.x + b.w + tol || ob.y + ob.h > b.y + b.h + tol) continue;
    if (b.w * b.h > bestA) ((best = o), (bestA = b.w * b.h));
  }
  return best;
}

function isClosedOutline(o: Obj): boolean {
  let any = false;
  for (const [leaf] of visibleLeaves([o])) {
    const k = leaf.shape.kind;
    if (k === 'text' || k === 'image' || k === 'barcode') return false;
    const subs = shapeSubs(leaf.shape);
    if (!subs.length || subs.some((sp) => !sp.closed)) return false;
    any = true;
  }
  return any;
}

function outlinePolys(o: Obj): Pt[][] {
  const out: Pt[][] = [];
  for (const [leaf, m] of visibleLeaves([o]))
    for (const sp of shapeSubs(leaf.shape)) {
      const p = flattenSub(sp, m).map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE }));
      if (p.length >= 3) out.push(p);
    }
  return out;
}

/** Bild der Kamera verkleinert lesen; kx, ky = mm je Pixel */
function readImage(src: HTMLCanvasElement, bw: number, bh: number): { img: RGBAImage; kx: number; ky: number } {
  const f = Math.min(1, DETECT_PX / Math.max(src.width, src.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(src.width * f));
  c.height = Math.max(1, Math.round(src.height * f));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return { img: ctx.getImageData(0, 0, c.width, c.height), kx: bw / c.width, ky: bh / c.height };
}

interface Found extends Piece {
  match: Match | null;
  on: boolean;
  /** Zusätzliche Drehung von Hand (Bogenmaß) */
  extra: number;
  /** Werkstück unter dem Design (bekommt keine Kopie) */
  isRef: boolean;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
/** Drehung für die Anzeige: Grad gegen den Uhrzeigersinn wie in den Maschinenkoordinaten */
const showDeg = (a: number) => {
  let d = Math.round((-a * 180) / Math.PI * 10) / 10;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return `${dec(d.toFixed(1))}°`;
};

export function openWorkpieceDialog(ed: Editor) {
  if (!ed.sel.length) {
    ed.hint = t('Auf Werkstücke übertragen: erst das Design auswählen.');
    ed.emit('tool');
    return;
  }
  const views = cameraViews(ed);
  if (!views.length) {
    ed.hint = t('Auf Werkstücke übertragen: keine kalibrierte Kamera mit Bild. Im Fenster „Kamera“ verbinden und das Bild aktualisieren.');
    ed.emit('tool');
    return;
  }
  const st = load();
  if (!views.some((v) => v.id === st.cam)) st.cam = views[0].id;
  const view = () => views.find((v) => v.id === st.cam) ?? views[0];
  const sel = ed.doc.objs.filter((o) => ed.sel.includes(o));
  const outlineObj = findOutline(sel);
  let mode: 'outline' | 'piece' = outlineObj ? 'outline' : 'piece';
  const { w: bw, h: bh } = ed.doc.bed;

  let found: Found[] = [];
  let ref: Blob | null = null;
  let refC: Pt = { x: 0, y: 0 };
  let problem = '';
  let hover = -1;

  const designBox = (): Box | null => boundsOf(mode === 'outline' && outlineObj ? [outlineObj] : sel);

  const detect = () => {
    const v = view();
    const src = v.image;
    found = [];
    ref = null;
    problem = '';
    if (!src) return void (problem = t('Noch kein Kamerabild. „Neues Kamerabild“ drücken.'));
    const { img, kx, ky } = readImage(src, bw, bh);
    const bg = st.useEmpty && v.empty ? readImage(v.empty, bw, bh).img : null;
    const pieces = detectPieces(img, kx, ky, st, bg);
    if (mode === 'outline' && outlineObj) {
      ref = blobFromPolys(outlinePolys(outlineObj), Math.min(kx, ky));
      if (!ref) problem = t('Der Umriss hat keine Fläche.');
    } else {
      const b = designBox();
      const c = b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
      const under = c ? pieces.find((p) => inside(p, c.x, c.y)) : undefined;
      if (under) ref = under;
      else problem = t('Das Design liegt auf keinem erkannten Werkstück. Design auf ein Werkstück im Kamerabild legen oder einen Umriss mit auswählen.');
    }
    if (ref) refC = { x: ref.cx, y: ref.cy };
    found = pieces.map((p) => {
      const isRef = p === ref;
      const match = ref && !isRef ? matchPiece(ref, p) : null;
      const good = !!match && match.score >= 0.8 && match.areaRatio > 0.85 && match.areaRatio < 1.18;
      return { ...p, match, isRef, extra: 0, on: !isRef && !p.cut && good };
    });
  };

  const mats = (): Mat[] =>
    found.filter((f) => f.on && f.match).map((f) => pieceMatrix(refC, { x: f.cx, y: f.cy }, f.match!.angle + f.extra));

  // ----- Vorschau im Dialog -----
  const cv = h('canvas', { class: 'wp-preview', title: t('Klick auf ein Werkstück: übertragen an/aus') }) as HTMLCanvasElement;
  const PW = 460;
  cv.width = PW;
  cv.height = Math.max(120, Math.round((PW * bh) / bw));
  const toWorld = (e: MouseEvent): Pt => {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * bw, y: ((e.clientY - r.top) / r.height) * bh };
  };
  const draw = () => {
    const ctx = cv.getContext('2d')!;
    const s = cv.width / bw;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const src = view().image;
    if (src) ctx.drawImage(src, 0, 0, cv.width, cv.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const px = 1 / s;
    found.forEach((f, i) => {
      const p = new Path2D();
      for (const loop of f.outline) {
        loop.forEach((q, k) => (k ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
        p.closePath();
      }
      const unsure = !!f.match && (f.match.ambiguous || f.match.score < 0.9);
      const col = f.isRef ? '#2a7fff' : f.on ? (unsure ? '#ff9a1f' : '#20c060') : '#9a9a9a';
      ctx.fillStyle = col + (i === hover ? '88' : '44');
      ctx.fill(p, 'evenodd');
      ctx.strokeStyle = col;
      ctx.lineWidth = (i === hover ? 3 : 1.6) * px;
      ctx.stroke(p);
      // Unterstützend: Konturen-Nummern (Baseline: 13)
      ctx.font = `bold ${13 * px * groupFactor(resolveTypography(getTypography()), 'supporting')}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3 * px;
      ctx.strokeStyle = '#000';
      const label = f.isRef ? t('Vorlage') : String(i + 1);
      ctx.strokeText(label, f.cx, f.cy);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, f.cx, f.cy);
      // Drehrichtung der Vorlage als kleiner Pfeil
      if (f.match && f.on) {
        const a = f.match.angle + f.extra,
          L = 6 * px * 2;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.moveTo(f.cx, f.cy + 9 * px);
        ctx.lineTo(f.cx + Math.cos(a) * L, f.cy + 9 * px + Math.sin(a) * L);
        ctx.stroke();
      }
    });
    if (mode === 'outline' && ref) {
      // Umriss der Vorlage an ihrer gezeichneten Stelle
      const b = designBox();
      if (b) {
        ctx.setLineDash([4 * px, 3 * px]);
        ctx.strokeStyle = '#2a7fff';
        ctx.lineWidth = 1.2 * px;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.setLineDash([]);
      }
    }
  };
  cv.addEventListener('click', (e) => {
    const p = toWorld(e);
    const f = found.find((x) => inside(x, p.x, p.y));
    if (!f || f.isRef || !f.match) return;
    f.on = !f.on;
    update(false);
  });
  cv.addEventListener('mousemove', (e) => {
    const p = toWorld(e);
    const i = found.findIndex((x) => inside(x, p.x, p.y));
    if (i !== hover) ((hover = i), draw());
  });
  cv.addEventListener('mouseleave', () => ((hover = -1), draw()));

  // ----- Liste der Werkstücke -----
  const list = h('div', { class: 'wp-list' });
  const info = h('div', { class: 'note' });
  const fillList = () => {
    list.replaceChildren();
    found.forEach((f, i) => {
      if (f.isRef) return;
      const cb = h('input', { type: 'checkbox', checked: f.on, disabled: !f.match }) as HTMLInputElement;
      cb.addEventListener('change', () => ((f.on = cb.checked), update(false)));
      const turn = (a: number) => () => ((f.extra += a), (f.on = true), update(false));
      const notes: string[] = [];
      if (f.cut) notes.push(t('angeschnitten'));
      if (f.match?.ambiguous) notes.push(t('symmetrisch, Drehung prüfen'));
      if (f.match && (f.match.areaRatio < 0.85 || f.match.areaRatio > 1.18)) notes.push(t('andere Größe'));
      const row = h('div', { class: 'wp-row' },
        h('label', { class: 'check' }, cb, `${i + 1}`),
        h('span', { title: t('Deckung mit der Vorlage') }, f.match ? pct(f.match.score) : '–'),
        h('span', { title: t('Drehung gegenüber der Vorlage') }, f.match ? showDeg(f.match.angle + f.extra) : '–'),
        h('span', { class: 'wp-btns' },
          h('button', { class: 'btn small', title: t('90° gegen den Uhrzeigersinn drehen'), disabled: !f.match, onclick: turn(-Math.PI / 2) }, '↺ 90°'),
          h('button', { class: 'btn small', title: t('Um 180° drehen'), disabled: !f.match, onclick: turn(Math.PI) }, '180°'),
        ),
        h('span', { class: 'muted' }, notes.join(', ')),
      );
      row.addEventListener('mouseenter', () => ((hover = i), draw()));
      row.addEventListener('mouseleave', () => ((hover = -1), draw()));
      list.append(row);
    });
  };

  const run = h('button', { class: 'btn primary' }, t('Übertragen')) as HTMLButtonElement;
  const update = (redetect: boolean) => {
    if (!dlg.open) return;
    if (redetect) detect();
    fillList();
    draw();
    const n = found.filter((f) => f.on && f.match).length;
    const others = found.filter((f) => !f.isRef).length;
    info.textContent = problem
      || (!others ? t('Keine Werkstücke erkannt. Empfindlichkeit oder Mindestgröße ändern, oder ein Foto vom leeren Bett aufnehmen.')
        : tn('{n} von {m} Werkstück wird übertragen. Orange gestrichelt: Vorschau auf der Arbeitsfläche.', '{n} von {m} Werkstücken werden übertragen. Orange gestrichelt: Vorschau auf der Arbeitsfläche.', others, { n, m: others }));
    run.disabled = !n;
    const ms = mats();
    ed.setArrayPreview(ms.length ? [IDENT, ...ms] : null);
  };

  let timer = 0;
  const later = () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => update(true), 150);
  };
  // Typografie live nachführen, beim Schließen abmelden
  const offTypo = onTypographyChange(() => update(false));

  // ----- Einstellungen -----
  const camSel = h('select', { onchange: (e: Event) => ((st.cam = (e.target as HTMLSelectElement).value), syncEmpty(), update(true)) },
    ...views.map((v) => h('option', { value: v.id, selected: v.id === st.cam }, v.name)));
  const modeSel = h('select', { onchange: (e: Event) => ((mode = (e.target as HTMLSelectElement).value as typeof mode), syncMode(), update(true)) },
    h('option', { value: 'piece', selected: mode === 'piece' }, t('Werkstück unter dem Design')),
    outlineObj ? h('option', { value: 'outline', selected: mode === 'outline' }, t('Gewählter Umriss')) : null,
  ) as HTMLSelectElement;
  const sens = h('input', { type: 'range', min: 0, max: 100, step: 1, value: String(st.sensitivity) }) as HTMLInputElement;
  const sensVal = h('span', { class: 'slider-val' }, String(st.sensitivity));
  sens.addEventListener('input', () => ((st.sensitivity = Number(sens.value)), (sensVal.textContent = sens.value), later()));
  const minIn = h('input', { type: 'number', min: 1, step: 10, value: String(st.minArea) }) as HTMLInputElement;
  minIn.addEventListener('input', () => {
    const v = Number(minIn.value);
    if (v > 0) ((st.minArea = v), later());
  });
  const emptyChk = check(st.useEmpty, (v) => ((st.useEmpty = v), update(true)), t('Foto vom leeren Bett als Hintergrund'));
  const emptyBtn = h('button', { class: 'btn', title: t('Das aktuelle Kamerabild als leeres Bett merken (bis zum Beenden der App). Dafür die Werkstücke kurz herausnehmen.') }, t('Leeres Bett merken')) as HTMLButtonElement;
  const forgetBtn = h('button', { class: 'btn' }, t('Vergessen')) as HTMLButtonElement;
  const emptyTxt = h('span', { class: 'muted' });
  const syncEmpty = () => {
    const has = !!view().empty;
    const cb = emptyChk.querySelector('input') as HTMLInputElement;
    cb.disabled = !has;
    cb.checked = has && st.useEmpty;
    forgetBtn.disabled = !has;
    emptyTxt.textContent = has ? t('gemerkt') : t('keins');
  };
  emptyBtn.addEventListener('click', () => {
    view().setEmpty(true);
    st.useEmpty = true;
    (emptyChk.querySelector('input') as HTMLInputElement).checked = true;
    syncEmpty();
    update(true);
  });
  forgetBtn.addEventListener('click', () => (view().setEmpty(false), syncEmpty(), update(true)));
  const shotBtn = h('button', { class: 'btn', title: t('Neues Bild von der Kamera holen und neu erkennen') }, t('Neues Kamerabild')) as HTMLButtonElement;
  shotBtn.addEventListener('click', () => {
    if (!view().refresh()) info.textContent = t('Kein Bild: Kamera verbunden und kalibriert?');
    else update(true);
  });
  const outlineOpts = h('span', { class: 'checks' },
    check(st.copyOutline, (v) => (st.copyOutline = v), t('Umriss mit übertragen')),
    check(st.hideTemplate, (v) => (st.hideTemplate = v), t('Vorlage danach ausblenden (wird nicht gelasert)')),
  );
  const syncMode = () => (outlineOpts.style.display = mode === 'outline' ? '' : 'none');

  const apply = () => {
    const ms = mats();
    if (!ms.length) return;
    save(st);
    ed.snapshot(t('Auf Werkstücke übertragen'));
    const template = mode === 'outline' && outlineObj && !st.copyOutline ? sel.filter((o) => o !== outlineObj) : sel;
    const made: Obj[] = [];
    for (const M of ms) {
      const copies = cloneObjs(template);
      copies.forEach((c, i) => (c.m = mul(M, template[i].m)));
      if (st.group && copies.length > 1) made.push({ id: newId(), m: IDENT, layer: copies[0].layer, shape: { kind: 'group', children: copies } });
      else made.push(...copies);
    }
    for (const c of made) delete c.hidden;
    ed.doc.objs.push(...made);
    if (mode === 'outline' && st.hideTemplate) for (const o of sel) o.hidden = true;
    ed.setSel(mode === 'piece' ? [...sel, ...made] : made);
    ed.hint = tn('Auf {n} Werkstück übertragen.', 'Auf {n} Werkstücke übertragen.', ms.length);
    ed.emit('doc');
  };

  let applied = false;
  run.addEventListener('click', () => ((applied = true), dlg.close()));
  const dlg = h(
    'dialog',
    { class: 'offset-dialog wp-dialog' },
    h('h3', {}, t('Auf Werkstücke übertragen')),
    h('div', { class: 'form' },
      views.length > 1 ? h('label', {}, t('Kamera')) : null, views.length > 1 ? camSel : null,
      h('label', {}, t('Vorlage')), modeSel,
      h('label', {}, t('Empfindlichkeit')), h('div', { class: 'conn-row' }, sens, sensVal),
      h('label', {}, t('Mindestgröße (mm²)')), minIn,
      h('label', {}, t('Leeres Bett')), h('div', { class: 'conn-row' }, emptyBtn, forgetBtn, emptyTxt),
      h('span', { class: 'checks' }, emptyChk, check(st.group, (v) => (st.group = v), t('Je Werkstück gruppieren'))),
      outlineOpts,
    ),
    h('div', { class: 'conn-row' }, shotBtn),
    cv,
    list,
    info,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')), run),
  );
  dlg.addEventListener('close', () => {
    clearTimeout(timer);
    offTypo();
    ed.setArrayPreview(null);
    if (applied) apply();
    else save(st);
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  syncEmpty();
  syncMode();
  dlg.showModal();
  update(true);
}
