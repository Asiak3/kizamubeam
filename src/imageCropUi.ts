// Bild-Zuschnitt/Perspektive: UI-Anbindung der geprüften Logik (src/editor/imageHandles.ts).
// Reine Helfer (301-nicht-DOM) plus Dialog/Overlay; kein Modell-, Raster- oder G-Code-Eingriff.
// Ziele: 24px-Treffer (visuell 8px wie Bestand, Trefferadius 12px), kein Abschluss bei
// Pointer-Down (Anwenden erst bei Loslassen/Enter), reduzierte Bewegung respektiert
// (keinerlei Animation hier), Tastatur-Alternativen zu jedem Griff.
import { t } from './i18n';
import { h } from './dom';
import { numField } from './arrayDialogs';
import { apply, inv } from './mat';
import { createImageGeometry } from './imageGeometry';
import { imageEditOrder } from './imageEdits';
import type { Obj, Pt } from './model';
import type { ImageCrop } from './imageGeometry';
import { imageDraftContour, type ImageCropHandle, type ImageEditTab } from './editor/imageHandles';

export const EDIT_TITLE = () => t('Bild bearbeiten …');
export const ORDER_TITLE = () => t('Reihenfolge');
export const ORDER_CROP_FIRST = () => t('Zuschnitt zuerst');
export const ORDER_PERSP_FIRST = () => t('Perspektive zuerst');
export const ORDER_HINT = () => t('Zuschnitt zuerst wählt im Originalbild aus, Perspektive zuerst schneidet achsparallel auf dem entzerrten Ergebnis zu.');
export const CROP_TAB_TITLE = () => t('Zuschnitt');
export const PERSP_TAB_TITLE = () => t('Perspektive');
export const ROUNDING_TAB_TITLE = () => t('Ecken abrunden');

const pending = new WeakMap<object, ImageCropHandle | number>();
const draftApplyGuards = new WeakMap<object, () => boolean>();

/** Trefferradius in px: 24px-Ziel (Durchmesser), visuell weiter 8px-Quadrate. */
export const IMAGE_HANDLE_HIT_R = 12;

/** Genau ein gewähltes Bild (Werkzeug/Menü/Kontext aktivieren nur dann). */
export function singleImageSel(ed: any): Obj | null {
  const sel: Obj[] = ed?.sel ?? [];
  if (sel.length !== 1) return null;
  const o = sel[0];
  return o && (o.shape as any)?.kind === 'image' ? o : null;
}

/** Toolbar-/Menü-Freischaltung: genau ein Bild gewählt, andere Typen unberührt. */
export function cropDraftEnabled(ed: any): boolean {
  return !!singleImageSel(ed);
}

function fail(ed: any, msg: string): string {
  ed.hint = msg;
  try { ed.emit('tool'); } catch { /* Kopf-Test ohne Emitter */ }
  return msg;
}

/** Starter (DOM-frei, damit echte Pipeline-Tests sie ohne Dialog nutzen können). */
export function startImageEditForSel(ed: any, tab: ImageEditTab = 'crop'): string | null {
  const o = singleImageSel(ed);
  if (!o) return fail(ed, t('Kein Bild gewählt. Ursache: Die Auswahl enthält kein Bild. Behebung: Ein einzelnes Bild wählen.'));
  const err = ed.startImageEdit(o.id, tab);
  if (err) return fail(ed, err);
  if (tab === 'rounding') pending.delete(ed as object);
  else pending.set(ed as object, tab === 'crop' ? 'right' : 2);
  return null;
}

/** Echter Toolbar-/Menü-Einstieg: Entwurf starten und (im Browser) Dialog öffnen. */
export function runImageEdit(ed: any, tab: ImageEditTab = 'crop'): string | null {
  const err = startImageEditForSel(ed, tab);
  if (!err) openImageCropDialog(ed);
  return err;
}

function imgOf(ed: any, id: number): Obj | null {
  const o = (ed.doc.objs as Obj[]).find((x) => x.id === id) ?? null;
  return o && (o.shape as any).kind === 'image' ? o : null;
}

export interface HandleScreen { handle: ImageCropHandle; local: Pt; screen: Pt; }
export interface CornerScreen { index: number; local: Pt; screen: Pt; }

/** Draft order wins while editing, otherwise the stored (sanitized) model order. */
function draftOrStoredOrder(ed: any, id: number): 'cropFirst' | 'perspectiveFirst' {
  const d = ed.imageDraft?.();
  if (d && d.objId === id) return d.order === 'perspectiveFirst' ? 'perspectiveFirst' : 'cropFirst';
  const o = imgOf(ed, id);
  return imageEditOrder((o?.shape as any)?.edit);
}

/** 8 Zuschnitt-Griffe in Bild-lokalen Achsen (rotationssicher), projiziert via echte View. */
export function cropHandleScreens(ed: any, id: number): HandleScreen[] {
  const o = imgOf(ed, id);
  if (!o) return [];
  const s: any = o.shape;
  const c = ed.imageCropPreview(id) ?? { left: 0, top: 0, right: 1, bottom: 1 };
  const l = c.left * s.w, r = c.right * s.w, tp = c.top * s.h, b = c.bottom * s.h;
  const mx = (l + r) / 2, my = (tp + b) / 2;
  const defs: [ImageCropHandle, Pt][] = [
    ['left', { x: l, y: my }], ['right', { x: r, y: my }],
    ['top', { x: mx, y: tp }], ['bottom', { x: mx, y: b }],
    ['tl', { x: l, y: tp }], ['tr', { x: r, y: tp }],
    ['br', { x: r, y: b }], ['bl', { x: l, y: b }],
  ];
  // perspectiveFirst crops axis-parallel in the warped result frame: show the box as-is.
  const first = draftOrStoredOrder(ed, id) !== 'perspectiveFirst';
  return defs.map(([handle, local]) => {
    const v = first ? warpLocal(ed, o, local) : local;
    return { handle, local, screen: ed.toScreen(apply(o.m, v.x, v.y)) };
  });
}

const FULL_CROP_SRC: ImageCrop = { left: 0, top: 0, right: 1, bottom: 1 };

/** Aktuelle Perspektive (Entwurf vor Modell) als lokale Ecken. */
function currentQuad(ed: any, o: Obj): [Pt, Pt, Pt, Pt] {
  const s: any = o.shape;
  const q = ed.imagePerspectivePreview?.(o.id) as [Pt, Pt, Pt, Pt] | null | undefined;
  if (Array.isArray(q) && q.length === 4) return q;
  return [{ x: 0, y: 0 }, { x: s.w, y: 0 }, { x: s.w, y: s.h }, { x: 0, y: s.h }];
}

/** Originalachse (mm) → perspektivisch verzerrte Lokalkoordinate (mm). Ohne Perspektive Identität. */
export function warpLocal(ed: any, o: Obj, p: Pt): Pt {
  try {
    const s: any = o.shape;
    const g = createImageGeometry(FULL_CROP_SRC, currentQuad(ed, o) as [Pt, Pt, Pt, Pt]);
    if (!g.ok) return p;
    return g.geometry.sourceToLocal({ x: p.x / s.w, y: p.y / s.h }) ?? p;
  } catch { return p; }
}

/** Perspektivisch verzerrte Lokalkoordinate (mm) → Originalachse (mm). Ohne Perspektive Identität. */
export function unwarpLocal(ed: any, o: Obj, p: Pt): Pt {
  try {
    const s: any = o.shape;
    const g = createImageGeometry(FULL_CROP_SRC, currentQuad(ed, o) as [Pt, Pt, Pt, Pt]);
    if (!g.ok) return p;
    const n = g.geometry.localToSource(p);
    return n ? { x: n.x * s.w, y: n.y * s.h } : p;
  } catch { return p; }
}
/** 4 Perspektiv-Ecken in Bild-lokalen Achsen, projiziert via echte View. */
export function perspectiveCornerScreens(ed: any, id: number): CornerScreen[] {
  const o = imgOf(ed, id);
  if (!o) return [];
  const q: Pt[] = ed.imagePerspectivePreview(id) ?? [{ x: 0, y: 0 }, { x: (o.shape as any).w, y: 0 },
    { x: (o.shape as any).w, y: (o.shape as any).h }, { x: 0, y: (o.shape as any).h }];
  return q.map((local, index) => {
    const w = apply(o.m, local.x, local.y);
    return { index, local: { ...local }, screen: ed.toScreen(w) };
  });
}

/** Overlay-Treffertest unter Rotation/Zoom/Offset (echte View-Transformation). */
export function hitImageCropHandle(ed: any, sx: number, sy: number): { mode: 'crop'; handle: ImageCropHandle } | { mode: 'perspective'; index: number } | null {
  const d = ed.imageDraft?.();
  if (!d || d.tab === 'rounding') return null;
  const R = IMAGE_HANDLE_HIT_R;
  if (d.tab === 'crop') {
    let best: HandleScreen | null = null; let bd = Infinity;
    for (const p of cropHandleScreens(ed, d.objId)) {
      const dist = Math.hypot(p.screen.x - sx, p.screen.y - sy);
      if (dist < bd) { bd = dist; best = p; }
    }
    if (best && bd <= R) { pending.set(ed as object, best.handle); return { mode: 'crop', handle: best.handle }; }
    return null;
  }
  let best: CornerScreen | null = null; let bd = Infinity;
  for (const p of perspectiveCornerScreens(ed, d.objId)) {
    const dist = Math.hypot(p.screen.x - sx, p.screen.y - sy);
    if (dist < bd) { bd = dist; best = p; }
  }
  if (best && bd <= R) { pending.set(ed as object, best.index); return { mode: 'perspective', index: best.index }; }
  return null;
}

/** Bildschirm → Bild-lokal (Originalachsen): echte View, inverse Objektmatrix, inverse Perspektive. */
export function screenToImageLocal(ed: any, o: Obj, sx: number, sy: number): Pt {
  const w = ed.toWorld(sx, sy);
  return unwarpLocal(ed, o, apply(inv(o.m), w.x, w.y));
}

/** Zeiger-Ziehen für Tests und Pointer-Dispatch (Shift = Seitenverhältnis, Fang via Event). */
export function pointerCropTo(ed: any, sx: number, sy: number, opt: { aspectLock?: boolean; snap?: boolean; event?: unknown } = {}): string | null {
  const d = ed.imageDraft?.();
  if (!d) return t('Kein Entwurf aktiv. Ursache: Nichts zum Anwenden. Behebung: Entwurf starten.');
  if (d.tab === 'rounding') return null;
  const o = imgOf(ed, d.objId);
  if (!o) return t('Bild nicht mehr vorhanden. Ursache: Das Bild wurde gelöscht. Behebung: Entwurf abbrechen.');
  // Griffe und Speicherung leben im verzerrten Ergebnis-Frame – nur der Zuschnitt
  // im cropFirst-Modus wird in Originalachsen editiert und braucht die Entzerrung.
  const local = d.tab === 'crop' && d.order !== 'perspectiveFirst'
    ? screenToImageLocal(ed, o, sx, sy)
    : (() => { const w = ed.toWorld(sx, sy); return apply(inv(o.m), w.x, w.y); })();
  if (d.tab === 'crop') {
    let handle = pending.get(ed as object);
    if (typeof handle !== 'string') {
      let best: ImageCropHandle = 'right'; let bd = Infinity;
      for (const p of cropHandleScreens(ed, d.objId)) {
        const dist = Math.hypot(p.screen.x - sx, p.screen.y - sy);
        if (dist < bd) { bd = dist; best = p.handle; }
      }
      handle = best;
      pending.set(ed as object, handle);
    }
    return ed.dragImageCropHandle(handle as ImageCropHandle, local, { aspectLock: opt.aspectLock, snap: opt.snap ?? true, event: opt.event });
  }
  let idx = pending.get(ed as object);
  if (typeof idx !== 'number') {
    let best = 2; let bd = Infinity;
    for (const p of perspectiveCornerScreens(ed, d.objId)) {
      const dist = Math.hypot(p.screen.x - sx, p.screen.y - sy);
      if (dist < bd) { bd = dist; best = p.index; }
    }
    idx = best;
    pending.set(ed as object, idx);
  }
  return ed.setImagePerspectiveCorner(idx as number, local, { snap: opt.snap ?? true, event: opt.event });
}

/** Fehler als Text mit Ursache + Behebung auf der bestehenden Statusfläche. */
export function showImageError(ed: any, msg: string): void {
  ed.hint = msg;
  try { ed.emit('tool'); } catch { /* Kopf-Test */ }
}

/** Offenen Bearbeitungsdialog schließen (löst über close-Listener ggf. Entwurfs-Abbruch aus). */
export function closeImageCropDialog(): void {
  if (typeof document === 'undefined') return;
  document.querySelector('dialog.image-crop-dialog[open]')?.closest('dialog')?.close();
}

/** Tastatur-Alternativen: Pfeile stupsen, Esc bricht ab, Enter wendet an. */
export function handleImageCropKey(ed: any, e: { key: string; shiftKey?: boolean }): boolean {
  const d = ed.imageDraft?.();
  if (!d) return false;
  const k = (e.key || '').toLowerCase();
  if (k === 'escape') { ed.cancelImageDraft(); closeImageCropDialog(); return true; }
  if (k === 'enter') {
    if (draftApplyGuards.get(ed)?.() === false) return true;
    const err = ed.applyImageDraft();
    if (err) showImageError(ed, err);
    else if (typeof document !== 'undefined') document.querySelector('dialog.image-crop-dialog')?.closest('dialog')?.close();
    return true;
  }
  if (d.tab === 'rounding') return false;
  const step = e.shiftKey ? 10 : 1;
  const dx = k === 'arrowleft' ? -step : k === 'arrowright' ? step : 0;
  const dy = k === 'arrowup' ? -step : k === 'arrowdown' ? step : 0;
  if (!dx && !dy) return false;
  if (d.tab === 'crop') {
    const p = pending.get(ed as object);
    const handle: ImageCropHandle = typeof p === 'string' ? p : 'right';
    const key = dx ? (dx < 0 ? 'ArrowLeft' : 'ArrowRight') : dy < 0 ? 'ArrowUp' : 'ArrowDown';
    const err = ed.nudgeImageCropHandle(handle, key, step);
    if (err) showImageError(ed, err);
    return true;
  }
  const p = pending.get(ed as object);
  const idx = typeof p === 'number' ? p : 2;
  const err = ed.moveImagePerspectiveCornerBy(idx, dx, dy);
  if (err) showImageError(ed, err);
  return true;
}

/** Overlay: Zuschnitt-Rechteck (perspektivisch korrekt) + Abdunklung in beiden Reitern;
 *  dazu 8 Quadrate (Zuschnitt) bzw. 4 Kreise + Umriss (Perspektive). Bestandskonvention. */
export function renderImageCropOverlay(ed: any, ctx: CanvasRenderingContext2D): void {
  const d = ed.imageDraft?.();
  if (!d) return;
  const o = imgOf(ed, d.objId);
  if (!o) return;
  if (d.tab === 'rounding') {
    const result = imageDraftContour(ed, d.objId);
    if (!result?.ok) return;
    ctx.save();
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    result.contour.corners.forEach((corner, index) => {
      const p = ed.toScreen(corner.vertex);
      ctx.fillStyle = '#24272d';
      ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(String(index + 1), p.x, p.y);
    });
    ctx.restore();
    return;
  }
  const T = (ed as any).colors ?? {};
  const sel = T.sel ?? '#5b93f5';
  ctx.save();
  ctx.strokeStyle = sel;
  ctx.lineWidth = 1;
  // Gleicher Stand in beiden Reitern: verzerrtes Zuschnitt-Rechteck ...
  const cropPts = cropHandleScreens(ed, d.objId);
  const quadPts = perspectiveCornerScreens(ed, d.objId);
  const by = (name: ImageCropHandle) => cropPts.find((p) => p.handle === name)!.screen;
  const tl = by('tl'), tr = by('tr'), br = by('br'), bl = by('bl');
  const qi = quadPts.map((p) => p.screen);
  // ... und Weggeschnittenes abdunkeln: Perspektiv-Viereck minus Zuschnitt-Rechteck.
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  const outer = [qi[0], qi[1], qi[2], qi[3]];
  const inner = [tl, tr, br, bl];
  for (let k = 0; k < 4; k++) {
    const a = outer[k], b = outer[(k + 1) % 4], c = inner[(k + 1) % 4], e = inner[k];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(e.x, e.y); ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y); ctx.lineTo(tr.x, tr.y); ctx.lineTo(br.x, br.y); ctx.lineTo(bl.x, bl.y); ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  if (d.tab === 'crop') {
    for (const p of cropPts) {
      ctx.fillStyle = T.handleFill ?? '#24272d';
      ctx.fillRect(p.screen.x - 4, p.screen.y - 4, 8, 8);
      ctx.strokeRect(p.screen.x - 4 + 0.5, p.screen.y - 4 + 0.5, 7, 7);
    }
  } else {
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    quadPts.forEach((p, i) => (i ? ctx.lineTo(p.screen.x, p.screen.y) : ctx.moveTo(p.screen.x, p.screen.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of quadPts) {
      ctx.fillStyle = T.handleFill ?? '#24272d';
      ctx.beginPath();
      ctx.arc(p.screen.x, p.screen.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Shared modeless image draft: crop, perspective and final corner rounding. */
export function openImageCropDialog(ed: any): void {
  if (typeof document === 'undefined') return;
  const dg = ed.imageDraft?.();
  if (!dg) return;
  const o = imgOf(ed, dg.objId);
  if (!o || document.querySelector('dialog.image-crop-dialog[open]')) return;
  const s: any = o.shape;
  let applied = false;
  const roundingErrors = new Map<HTMLInputElement, string>();
  const errBox = h('div', { id: 'imgedit-error', class: 'note', role: 'alert', 'aria-live': 'assertive' }) as HTMLElement;
  const showErr = (msg: string | null) => {
    const visibleError = roundingErrors.values().next().value ?? msg;
    errBox.textContent = visibleError ?? '';
    if (visibleError) showImageError(ed, visibleError);
  };
  const clearRoundingErrors = () => {
    for (const input of roundingErrors.keys()) {
      input.setAttribute('aria-invalid', 'false');
      input.setCustomValidity?.('');
    }
    if (roundingErrors.size) errBox.textContent = '';
    roundingErrors.clear();
  };
  // Zahlenstand in mm (Einheit nur Anzeige); Griffe schreiben den Entwurf, Entwurf schreibt die Felder.
  const st: { unit: 'mm' | 'percent'; l: number; t: number; r: number; b: number } = { unit: 'mm', l: 0, t: 0, r: 0, b: 0 };
  let numCtl: { L: any; T: any; R: any; B: any } | null = null;
  let roundingCtl: { input: HTMLInputElement; effective: HTMLElement }[] | null = null;
  let commonRadius: HTMLInputElement | null = null;
  let roundingStatus: HTMLElement | null = null;
  const toUnit = (mm: number, horizontal: boolean) => st.unit === 'mm' ? mm : (mm / (horizontal ? s.w : s.h)) * 100;
  const fromUnit = (v: number, horizontal: boolean) => st.unit === 'mm' ? v : (v / 100) * (horizontal ? s.w : s.h);
  const commitNumeric = () => {
    const err = ed.setImageCropNumeric({ left: st.l, top: st.t, right: st.r, bottom: st.b, unit: 'mm' as const });
    if (err) showErr(err); else showErr(null);
  };
  const refreshNumeric = () => {
    if (!numCtl) return;
    const d = ed.imageDraft?.();
    if (!d || d.tab !== 'crop') return;
    const prev = ed.imageCropPreview(o.id) ?? { left: 0, top: 0, right: 1, bottom: 1 };
    st.l = prev.left * s.w; st.t = prev.top * s.h; st.r = prev.right * s.w; st.b = prev.bottom * s.h;
    const ae = document.activeElement;
    const set = (el: any, v: number) => { if (el && el !== ae) el.value = String(round2(v)); };
    set(numCtl.L, toUnit(st.l, true));
    set(numCtl.T, toUnit(st.t, false));
    set(numCtl.R, toUnit(st.r, true));
    set(numCtl.B, toUnit(st.b, false));
  };
  const tabBar = h('div', { class: 'sub-tabs', role: 'tablist' });
  const bodyBox = h('div', { id: 'imgedit-panel', role: 'tabpanel' });
  const tabs = ['crop', 'perspective', 'rounding'] as const;
  const selectTab = (tab: ImageEditTab) => {
    ed.setImageEditTab(tab);
    renderTabs(); renderBody();
    document.getElementById?.(`imgedit-tab-${tab}`)?.focus();
  };
  const renderTabs = () => {
    const d = ed.imageDraft?.();
    const tab = d?.tab ?? 'crop';
    tabBar.replaceChildren(
      ...tabs.map((value) => h('button', {
        id: `imgedit-tab-${value}`, type: 'button', role: 'tab', 'aria-selected': String(tab === value),
        'aria-controls': 'imgedit-panel', style: 'min-height: 24px', class: `btn small${tab === value ? ' active' : ''}`,
        onclick: () => selectTab(value),
      }, value === 'crop' ? CROP_TAB_TITLE() : value === 'perspective' ? PERSP_TAB_TITLE() : ROUNDING_TAB_TITLE())),
    );
    bodyBox.setAttribute('aria-labelledby', `imgedit-tab-${tab}`);
  };
  tabBar.addEventListener('keydown', (e) => {
    const current = tabs.indexOf(ed.imageDraft?.()?.tab ?? 'crop');
    const index = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
      : e.key === 'ArrowRight' ? (current + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (current + tabs.length - 1) % tabs.length : null;
    if (index === null) return;
    e.preventDefault(); selectTab(tabs[index]);
  });
  const refreshRounding = (replaceInputs = false) => {
    const d = ed.imageDraft?.();
    if (!d || d.tab !== 'rounding') return;
    const result = imageDraftContour(ed, o.id);
    if (!result?.ok) { renderBody(); return; }
    const { corners, limited } = result.contour;
    if (!roundingCtl || roundingCtl.length !== corners.length) { renderBody(); return; }
    const common = corners.every(c => c.requested === corners[0].requested) ? String(corners[0].requested) : '';
    if (commonRadius && (replaceInputs || commonRadius !== document.activeElement && !roundingErrors.has(commonRadius))) commonRadius.value = common;
    corners.forEach((corner, index) => {
      const control = roundingCtl![index];
      if (replaceInputs || control.input !== document.activeElement && !roundingErrors.has(control.input)) control.input.value = String(corner.requested);
      control.effective.textContent = corner.radius < corner.requested
        ? t('Wirksam: {effective} mm; angefordert: {requested} mm', { effective: String(round2(corner.radius)), requested: String(corner.requested) }) : '';
    });
    if (roundingStatus) roundingStatus.textContent = limited
      ? t('Radien auf die verfügbaren Kanten begrenzt. Angeforderte Werte bleiben erhalten.') : '';
  };
  const renderBody = () => {
    const d = ed.imageDraft?.();
    clearRoundingErrors();
    roundingCtl = null;
    commonRadius = null;
    roundingStatus = null;
    if (d?.tab === 'rounding') {
      numCtl = null;
      const result = imageDraftContour(ed, o.id);
      if (!result?.ok) { bodyBox.replaceChildren(h('p', { class: 'note' }, t('Bildkontur ungültig. Zuschnitt oder Perspektive anpassen.'))); return; }
      const field = (id: string, radius: number, index: number | null) => h('input', {
        type: 'number', id, value: String(radius), min: '0', step: '0.1', 'aria-describedby': 'imgedit-error', style: 'min-height: 24px; min-width: 0; width: 100%',
        oninput: (e: Event) => {
          const input = e.target as HTMLInputElement;
          const err = ed.setImageCornerRadius(index, input.value.trim() === '' ? NaN : Number(input.value));
          input.setAttribute('aria-invalid', String(!!err));
          input.setCustomValidity?.(err ?? '');
          if (err) roundingErrors.set(input, err); else roundingErrors.delete(input);
          showErr(err);
        },
      }) as HTMLInputElement;
      commonRadius = field('imground-common', 0, null);
      commonRadius.placeholder = t('Individuell');
      roundingStatus = h('p', { class: 'note', role: 'status', 'aria-live': 'polite' });
      roundingCtl = result.contour.corners.map((corner, index) => ({
        input: field(`imground-${index}`, corner.requested, index),
        effective: h('span', { id: `imground-effective-${index}`, class: 'note' }),
      }));
      bodyBox.replaceChildren(
        h('p', { class: 'note' }, t('Abrundung nach Zuschnitt und Perspektive. Radien bleiben beim Skalieren in mm erhalten.')),
        h('div', { class: 'form' }, h('label', { for: 'imground-common' }, t('Alle sichtbaren Ecken (mm)')), commonRadius),
        ...roundingCtl.map((control, index) => {
          control.input.setAttribute('aria-describedby', `imground-effective-${index} imgedit-error`);
          return h('div', { class: 'form' }, h('label', { for: `imground-${index}` }, t('Ecke {number} (mm)', { number: String(index + 1) })), control.input, control.effective);
        }),
        roundingStatus,
      );
      refreshRounding();
      return;
    }
    if (!d || d.tab !== 'crop') {
      numCtl = null;
      bodyBox.replaceChildren(h('p', { class: 'note' }, t('Ecken auf der Arbeitsfläche ziehen, Esc bricht ab, Enter wendet an.')));
      return;
    }
    const prev = ed.imageCropPreview(o.id) ?? { left: 0, top: 0, right: 1, bottom: 1 };
    st.l = prev.left * s.w; st.t = prev.top * s.h; st.r = prev.right * s.w; st.b = prev.bottom * s.h;
    const fL = numField('imgcrop-l', toUnit(st.l, true), (v) => { st.l = fromUnit(v, true); commitNumeric(); }, t('Links'));
    const fT = numField('imgcrop-t', toUnit(st.t, false), (v) => { st.t = fromUnit(v, false); commitNumeric(); }, t('Oben'));
    const fR = numField('imgcrop-r', toUnit(st.r, true), (v) => { st.r = fromUnit(v, true); commitNumeric(); }, t('Rechts'));
    const fB = numField('imgcrop-b', toUnit(st.b, false), (v) => { st.b = fromUnit(v, false); commitNumeric(); }, t('Unten'));
    for (const f of [fL, fT, fR, fB]) (f as HTMLInputElement).style.minHeight = '24px';
    const unit = h('select', {
      id: 'imgcrop-unit', style: 'min-height: 24px',
      onchange: (e: Event) => {
        st.unit = (e.target as HTMLSelectElement).value as 'mm' | 'percent';
        refreshNumeric();
      },
    }, h('option', { value: 'mm', selected: st.unit === 'mm' }, 'mm'), h('option', { value: 'percent', selected: st.unit === 'percent' }, '%')) as HTMLSelectElement;
    numCtl = { L: fL, T: fT, R: fR, B: fB };
    bodyBox.replaceChildren(h('div', { class: 'form' },
      h('label', { for: 'imgcrop-l' }, t('Links')), fL,
      h('label', { for: 'imgcrop-t' }, t('Oben')), fT,
      h('label', { for: 'imgcrop-r' }, t('Rechts')), fR,
      h('label', { for: 'imgcrop-b' }, t('Unten')), fB,
      h('label', { for: 'imgcrop-unit' }, t('Einheit')), unit,
    ));
    requestAnimationFrame(() => (fL as HTMLInputElement).focus());
  };
  // Order switch above the tabs: draft-only, no snapshot, no close, no value loss.
  const initialOrder = (ed.imageDraft?.()?.order === 'perspectiveFirst') ? 'perspectiveFirst' : 'cropFirst';
  const orderBox = h('fieldset', { class: 'imgcrop-order' },
    h('legend', {}, ORDER_TITLE()),
    h('label', {}, h('input', { type: 'radio', name: 'imgcrop-order', checked: initialOrder === 'cropFirst',
      onchange: () => { showErr(ed.setImageEditOrder('cropFirst')); } }), ORDER_CROP_FIRST()),
    h('label', {}, h('input', { type: 'radio', name: 'imgcrop-order', checked: initialOrder === 'perspectiveFirst',
      onchange: () => { showErr(ed.setImageEditOrder('perspectiveFirst')); } }), ORDER_PERSP_FIRST()),
    h('p', { class: 'note' }, ORDER_HINT()),
  );
  renderTabs();
  renderBody();
  const canApplyDraft = () => {
    const invalid = roundingErrors.keys().next().value;
    if (invalid) { showErr(roundingErrors.get(invalid)!); invalid.focus(); return false; }
    return true;
  };
  const applyDraft = () => {
    if (!canApplyDraft()) return;
    const err = ed.applyImageDraft();
    if (err) { showErr(err); return; }
    applied = true;
    dlg.close();
  };
  const btnStyle = 'min-height: 24px';
  const dlg = h('dialog', { class: 'offset-dialog array-dialog image-crop-dialog', style: 'max-height: 90vh; overflow: auto' },
    h('h3', {}, EDIT_TITLE()),
    orderBox,
    tabBar,
    bodyBox,
    errBox,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', style: btnStyle, onclick: () => {
        const err = ed.resetImageCropDraft();
        if (err) { showErr(err); return; }
        showErr(null);
        refreshNumeric();
      } }, t('Bildzuschnitt zurücksetzen')),
      h('button', { class: 'btn', style: btnStyle, onclick: () => {
        const err = ed.resetImagePerspectiveDraft();
        if (err) { showErr(err); return; }
        showErr(null);
      } }, t('Bildperspektive zurücksetzen')),
      h('button', { class: 'btn', style: btnStyle, onclick: () => {
        clearRoundingErrors();
        const err = ed.resetImageRoundingDraft();
        if (!err) refreshRounding(true);
        showErr(err);
      } }, t('Eckenabrundung zurücksetzen')),
      h('button', { class: 'btn', style: btnStyle, onclick: () => {
        dlg.close();
      } }, t('Abbrechen')),
      h('button', {
        class: 'btn primary', style: btnStyle,
        onclick: applyDraft,
      }, t('Übernehmen')),
    ),
  ) as HTMLDialogElement;
  const syncDraft = () => {
    try {
      if (!ed.imageDraft?.()) dlg.close();
      else { refreshNumeric(); refreshRounding(); }
    } catch { /* Kopf-Test ohne Emitter */ }
  };
  try { ed.on(syncDraft); } catch { /* Kopf-Test ohne Emitter */ }
  draftApplyGuards.set(ed, canApplyDraft);
  dlg.addEventListener('close', () => {
    draftApplyGuards.delete(ed);
    try { ed.off(syncDraft); } catch { /* Kopf-Test ohne Emitter */ }
    if (!applied && ed.imageDraft?.()) ed.cancelImageDraft();
    dlg.remove();
  });
  dlg.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); dlg.close(); }
    else if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName === 'INPUT') {
      e.preventDefault();
      applyDraft();
    }
  });
  document.body.append(dlg);
  // Modellfrei statt modal: Die Griffe auf der Arbeitsfläche bleiben bedienbar,
  // der Dialog liefert Zahlen/Abbrechen/Übernehmen parallel dazu.
  dlg.show();
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
