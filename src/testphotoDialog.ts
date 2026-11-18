// Dialog „Materialtest auswerten“: Foto des gelaserten Tests von der Kamera oder aus einer Datei, vier Ecken des
// Rasters anklicken, danach ist jede Zelle im Foto anklickbar. Ihre Werte gehen auf den aktiven Layer oder in die
// Material-Bibliothek. Gemessene Färbung und Vorschlag sind eine Hilfe, keine Bewertung.
import type { Editor } from './editor';
import type { Pt } from './model';
import { h } from './dom';
import { pickImage } from './files';
import { cameraPhoto } from './cameraui';
import {
  applyCell, buildTestDoc, cellCaption, cellSettings, energy, gridLayout, lastTestOptions, saveCell, targetLayerLabel, TestOptions, testSummary,
} from './materialtest';
import { cellAt, cellQuad, Corners, cornersFromView, gridToImage, measureCells, Measurement, suggestCell } from './testphoto';
import { dec, t } from './i18n';
import { getTypography, groupFactor, onTypographyChange, resolveTypography } from './uiTypography';

/** Längere Seite des Arbeitsbilds in Pixeln; größere Fotos werden verkleinert */
const MAX_PX = 2400;
/** Greifradius der Ecken in CSS-Pixeln */
const GRAB = 12;

export function openTestPhotoDialog(ed: Editor, opts?: TestOptions) {
  const o = opts ?? lastTestOptions();
  const L = gridLayout(o);
  const font = ed.textDefaults.font;
  const pct = (v: number) => `${dec(String(Math.round(v * 100)))} %`;

  // Arbeitsbild, Ecken (Arbeitsbild-Pixel) und Ergebnis
  let work: HTMLCanvasElement | null = null;
  let corners: Pt[] = [];
  let H: number[] | null = null;
  let meas: Measurement | null = null;
  let suggestion: { r: number; c: number } | null = null;
  let picked: { r: number; c: number } | null = null;
  let showValues = true;
  let dragging = -1;
  let hover: Pt | null = null;

  const canvas = h('canvas', { class: 'tp-canvas' }) as HTMLCanvasElement;
  const wrap = h('div', { class: 'tp-wrap' }, canvas);
  const empty = h('div', { class: 'tp-empty' }, t('Foto des gelaserten Tests von der Kamera holen oder eine Bilddatei öffnen.'));
  const msg = h('div', { class: 'note' });
  const step = h('div', { class: 'tp-step' });
  const pickBox = h('div', { class: 'mt-pick' });
  const stats = h('div', { class: 'note' });

  const say = (text: string, warn = false) => {
    msg.textContent = text;
    msg.classList.toggle('warn', warn);
  };

  /** Bild laden, verkleinern; Ecken übernehmen oder neu setzen lassen */
  const setPhoto = (url: string, guess: (w: number, h: number, scale: number) => Corners | null) =>
    new Promise<void>((res) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0, c.width, c.height);
        work = c;
        corners = guess(c.width, c.height, k) ?? [];
        picked = null;
        recompute();
        layout();
        res();
      };
      img.onerror = () => (say(t('Das Bild konnte nicht gelesen werden.'), true), res());
      img.src = url;
    });

  const fromCamera = async () => {
    const p = cameraPhoto(ed);
    if (!p) return say(t('Keine Kamera verbunden. Im Laser-Fenster unter „Kamera“ verbinden, dann erneut versuchen.'), true);
    const test = buildTestDoc(o, ed.doc.bed, font);
    await setPhoto(p.url, (w, hh) => (p.view ? cornersFromView(test.grid, p.view, w, hh) : null));
    say(p.view && corners.length === 4
      ? t('Das Raster wurde dort eingesetzt, wo der Test bei „Starten ab: Absolut“ liegt. Liegt es daneben, die Ecken an die richtige Stelle ziehen.')
      : t('Kamerabild geladen.'));
  };
  const fromFile = async () => {
    try {
      const f = await pickImage();
      if (!f) return;
      await setPhoto(f.dataUrl, () => null);
      say(t('{name} geladen.', { name: f.name }));
    } catch (e) {
      say((e as Error).message, true);
    }
  };

  const recompute = () => {
    H = corners.length === 4 ? gridToImage(corners as Corners, L) : null;
    meas = null;
    suggestion = null;
    if (H && work) {
      const ctx = work.getContext('2d', { willReadFrequently: true })!;
      meas = measureCells(ctx.getImageData(0, 0, work.width, work.height), H, L);
      if (o.mode === 'fill') suggestion = suggestCell(meas, (r, c) => energy(cellSettings(o, r, c)));
    }
    panel();
  };

  // ---------- Zeichnen ----------

  /** Abbildung Arbeitsbild → Canvas (CSS-Pixel) */
  let view = { s: 1, x: 0, y: 0 };
  const toScreen = (p: Pt): Pt => ({ x: view.x + p.x * view.s, y: view.y + p.y * view.s });
  const toImage = (p: Pt): Pt => ({ x: (p.x - view.x) / view.s, y: (p.y - view.y) / view.s });

  const layout = () => {
    const has = !!work;
    wrap.classList.toggle('has-photo', has);
    empty.hidden = has;
    canvas.hidden = !has;
    if (!work) return;
    const W = wrap.clientWidth || 640;
    const Hmax = Math.max(240, Math.round(window.innerHeight * 0.62));
    const s = Math.min(W / work.width, Hmax / work.height);
    const cw = Math.round(work.width * s),
      ch = Math.round(work.height * s);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    view = { s, x: 0, y: 0 };
    draw();
  };

  const css = (name: string, fallback: string) => getComputedStyle(dlg).getPropertyValue(name).trim() || fallback;

  const draw = () => {
    if (!work) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = canvas.width / (parseFloat(canvas.style.width) || canvas.width);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(work, view.x, view.y, work.width * view.s, work.height * view.s);
    const accent = css('--accent', '#2f7ae5');
    const poly = (pts: Pt[]) => {
      ctx.beginPath();
      pts.map(toScreen).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    };
    if (H) {
      const cellPx = Math.hypot(...((): [number, number] => {
        const q = cellQuad(H!, L, 0, 0).map(toScreen);
        return [q[1].x - q[0].x, q[1].y - q[0].y];
      })());
      for (let r = 0; r < L.rows; r++)
        for (let c = 0; c < L.cols; c++) {
          const q = cellQuad(H, L, r, c);
          poly(q);
          const isPicked = picked && picked.r === r && picked.c === c;
          const isSugg = suggestion && suggestion.r === r && suggestion.c === c;
          if (isPicked) {
            ctx.fillStyle = 'rgba(47,122,229,0.25)';
            ctx.fill();
          }
          ctx.setLineDash(isSugg && !isPicked ? [4, 3] : []);
          ctx.lineWidth = isPicked || isSugg ? 2.5 : 1;
          ctx.strokeStyle = isPicked ? accent : isSugg ? '#20a050' : 'rgba(255,200,0,0.9)';
          ctx.stroke();
          ctx.setLineDash([]);
          if (showValues && meas && cellPx >= 18) {
            const m = meas.cells[r * L.cols + c];
            const ctr = toScreen({ x: (q[0].x + q[2].x) / 2, y: (q[0].y + q[2].y) / 2 });
            // Unterstützend: Zellmesswert, an Zellgröße gekoppelt (Baseline: 8–13)
            const fs = Math.max(8, Math.min(13, cellPx / 3.2)) * groupFactor(resolveTypography(getTypography()), 'supporting');
            ctx.font = `600 ${fs}px system-ui, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const label = String(Math.round(m.dark * 100));
            ctx.lineWidth = 3;
            ctx.strokeStyle = 'rgba(0,0,0,0.75)';
            ctx.strokeText(label, ctr.x, ctr.y);
            ctx.fillStyle = '#fff';
            ctx.fillText(label, ctr.x, ctr.y);
          }
        }
    }
    // Ecken mit Nummer
    corners.forEach((p, i) => {
      const s = toScreen(p);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = i === dragging ? accent : 'rgba(255,255,255,0.9)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = accent;
      ctx.stroke();
      // Unterstützend: Eckennummern (Baseline: 11)
      ctx.font = `600 ${11 * groupFactor(resolveTypography(getTypography()), 'supporting')}px system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(String(i + 1), s.x + 7, s.y - 5);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(i + 1), s.x + 7, s.y - 5);
    });
    if (corners.length > 1 && corners.length < 4) {
      ctx.beginPath();
      corners.map(toScreen).forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // Lupe beim Setzen und Ziehen der Ecken
    const at = dragging >= 0 ? corners[dragging] : corners.length < 4 && hover ? toImage(hover) : null;
    if (at) loupe(ctx, at);
  };

  const loupe = (ctx: CanvasRenderingContext2D, p: Pt) => {
    if (!work) return;
    const R = 55,
      zoom = 4;
    const sp = toScreen(p);
    const cw = parseFloat(canvas.style.width),
      ch = parseFloat(canvas.style.height);
    // Neben den Zeiger, aber im Bild
    let cx = sp.x + R + 24,
      cy = sp.y - R - 24;
    if (cx + R > cw) cx = sp.x - R - 24;
    if (cy - R < 0) cy = sp.y + R + 24;
    cy = Math.min(ch - R, cy);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#000';
    ctx.fill();
    const k = view.s * zoom;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(work, cx - p.x * k, cy - p.y * k, work.width * k, work.height * k);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.moveTo(cx - 10, cy);
    ctx.lineTo(cx + 10, cy);
    ctx.moveTo(cx, cy - 10);
    ctx.lineTo(cx, cy + 10);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = css('--accent', '#2f7ae5');
    ctx.stroke();
  };

  // ---------- Maus ----------

  const local = (e: PointerEvent): Pt => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const nearCorner = (p: Pt) => {
    let best = -1,
      d0 = GRAB;
    corners.forEach((c, i) => {
      const s = toScreen(c);
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < d0) ((d0 = d), (best = i));
    });
    return best;
  };
  const clampImg = (p: Pt): Pt => ({ x: Math.max(0, Math.min(work!.width, p.x)), y: Math.max(0, Math.min(work!.height, p.y)) });

  canvas.addEventListener('pointerdown', (e) => {
    if (!work || e.button !== 0) return;
    const p = local(e);
    const k = nearCorner(p);
    if (k >= 0) {
      dragging = k;
      canvas.setPointerCapture(e.pointerId);
      draw();
      return;
    }
    if (corners.length < 4) {
      corners.push(clampImg(toImage(p)));
      if (corners.length === 4) recompute();
      else panel();
      draw();
      return;
    }
    if (H) {
      const c = cellAt(H, L, toImage(p));
      picked = c;
      panel();
      draw();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!work) return;
    const p = local(e);
    hover = p;
    if (dragging >= 0) {
      corners[dragging] = clampImg(toImage(p));
      H = corners.length === 4 ? gridToImage(corners as Corners, L) : null;
    }
    canvas.style.cursor = dragging >= 0 || nearCorner(p) >= 0 ? 'grab' : corners.length < 4 ? 'crosshair' : 'pointer';
    draw();
  });
  const endDrag = () => {
    if (dragging < 0) return;
    dragging = -1;
    recompute();
    draw();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => ((hover = null), draw()));

  // ---------- Seitenleiste ----------

  const CORNER_NAMES = [
    t('oben links an der ersten Zelle (Zeile 1, Spalte 1)'),
    t('oben rechts (letzte Spalte)'),
    t('unten rechts (letzte Zeile, letzte Spalte)'),
    t('unten links (letzte Zeile)'),
  ];

  const panel = () => {
    if (!work) step.textContent = t('Zuerst ein Foto laden.');
    else if (corners.length < 4)
      step.textContent = t('Ecke {n} von 4 anklicken: {where}. Gemeint sind die äußeren Ecken der Zellen, ohne Beschriftung.', { n: corners.length + 1, where: CORNER_NAMES[corners.length] });
    else step.textContent = t('Zelle im Foto anklicken. Die Ecken lassen sich noch verschieben.');

    pickBox.replaceChildren(
      ...(picked
        ? [
            h('span', {}, t('Gewählt: {cell}', { cell: cellCaption(o, picked.r, picked.c) })),
            h('button', { class: 'btn', title: t('Werte dieser Zelle auf den aktiven Layer übernehmen'), onclick: () => picked && applyCell(ed, o, picked.r, picked.c) },
              t('Auf Layer {layer}', { layer: targetLayerLabel(ed) })),
            h('button', { class: 'btn', title: t('Werte dieser Zelle als Eintrag in der Material-Bibliothek speichern'), onclick: () => picked && saveCell(ed, o, picked.r, picked.c, describe(picked.r, picked.c)) },
              t('In Bibliothek …')),
          ]
        : []),
    );

    const parts: (HTMLElement | string)[] = [];
    if (meas && picked) {
      const m = meas.cells[picked.r * L.cols + picked.c];
      parts.push(h('div', {}, t('Färbung der gewählten Zelle: {dark}, Ungleichmäßigkeit {spread}.', { dark: pct(m.dark), spread: pct(m.spread) })));
    }
    if (meas) {
      if (suggestion)
        parts.push(h('div', {},
          t('Vorschlag (grün gestrichelt): {cell}. Kräftiger färben die übrigen Zellen kaum, brauchen aber mehr Energie. Ob die Zelle verbrannt oder unsauber ist, zeigt nur der Blick aufs Werkstück.', { cell: cellCaption(o, suggestion.r, suggestion.c) }),
          ' ',
          h('button', { class: 'btn', onclick: () => ((picked = suggestion), panel(), draw()) }, t('Wählen'))));
      else if (o.mode === 'line') parts.push(h('div', {}, t('Bei Schnitten zeigt das Foto nicht, ob das Material durchtrennt ist. Bitte die Teile prüfen und die beste Zelle selbst wählen.')));
      else parts.push(h('div', {}, t('Die Zellen unterscheiden sich im Foto kaum. Ausrichtung und Beleuchtung prüfen.')));
      if (!meas.materialMeasured) parts.push(h('div', { class: 'warn' }, t('Das unbearbeitete Material war nicht messbar; Bezug ist Weiß.')));
    }
    stats.replaceChildren(...parts);
  };

  const describe = (r: number, c: number) => {
    const m = meas?.cells[r * L.cols + c];
    const base = t('Aus Materialtest: {cell}', { cell: cellCaption(o, r, c) });
    return m ? `${base}. ${t('Färbung im Foto {dark}.', { dark: pct(m.dark) })}` : base;
  };

  const valuesBox = h('input', { type: 'checkbox', checked: showValues, onchange: (e: Event) => ((showValues = (e.target as HTMLInputElement).checked), draw()) });

  const dlg = h('dialog', { class: 'tp-dialog' },
    h('h3', {}, t('Materialtest auswerten')),
    h('div', { class: 'tp-body' },
      h('div', { class: 'tp-left' }, wrap, empty),
      h('div', { class: 'tp-right' },
        h('div', { class: 'conn-row' },
          h('button', { class: 'btn', title: t('Bild der verbundenen Kamera verwenden (kalibriert: entzerrt und mit Lage)'), onclick: () => fromCamera() }, t('Von der Kamera')),
          h('button', { class: 'btn', title: t('Foto aus einer Datei öffnen, z. B. vom Handy'), onclick: () => fromFile() }, t('Bilddatei …')),
        ),
        msg,
        h('div', { class: 'note' }, t('Test: {summary}', { summary: testSummary(o) })),
        step,
        h('div', { class: 'conn-row' },
          h('button', { class: 'btn', title: t('Alle vier Ecken neu anklicken'), onclick: () => ((corners = []), (picked = null), recompute(), draw()) }, t('Ecken neu setzen')),
          h('label', { class: 'check', title: t('Gemessene Färbung je Zelle in Prozent: 0 = wie das unbearbeitete Material, 100 = schwarz') }, valuesBox, t('Färbung zeigen')),
        ),
        pickBox,
        stats,
        ...(opts ? [] : [h('div', { class: 'note' }, t('Gilt für den zuletzt gelaserten Test. Für einen anderen Test im Materialtest-Dialog die Werte einstellen und dort „Foto auswerten …“ wählen.'))]),
      ),
    ),
    h('div', { class: 'dialog-buttons' },
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen')),
    ),
  );
  const ro = new ResizeObserver(() => layout());
  ro.observe(wrap);
  // Typografie live nachführen, beim Schließen abmelden
  const offTypo = onTypographyChange(() => draw());
  dlg.addEventListener('close', () => (ro.disconnect(), offTypo(), dlg.remove()));
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  layout();
  panel();
}
