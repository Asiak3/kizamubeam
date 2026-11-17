// Bereich „Werkstücke“ im Dialog des Jig-Generators: Werkstückformen aus der Auswahl (Vektorgrafik, Text, Formen),
// aus einem Bild (Foto oder Scan, nachgezeichnet) oder aus dem Kamerabild holen; je Art Name, Anzahl und Drehung.
import { h } from '../dom';
import { t, tn } from '../i18n';
import { DEFAULT_DETECT, detectPieces, Piece, RGBAImage } from '../workpieces';
import { decodeShapes, encodeShapes, JigShape, outlineFromPolys } from './jig';
import type { GenHost, GenPanel } from './host';
import type { Params } from './types';

/** Außenkontur eines erkannten Teils (Pixel-Treppen werden beim Einpassen geglättet) */
const pieceShape = (pc: Piece, name: string, k = 1): JigShape => ({
  n: name,
  c: 1,
  r: 0,
  s: outlineFromPolys(pc.outline.map((pl) => pl.map((q) => ({ x: q.x * k, y: q.y * k }))), 0.15),
});

function readImage(src: CanvasImageSource, w: number, h: number, maxPx = 1000): { img: RGBAImage; f: number } {
  const f = Math.min(1, maxPx / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * f));
  c.height = Math.max(1, Math.round(h * f));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return { img: ctx.getImageData(0, 0, c.width, c.height), f };
}

const biggest = (ps: Piece[]) => ps.filter((p) => !p.cut).sort((a, b) => b.area - a.area)[0] ?? ps.sort((a, b) => b.area - a.area)[0];

/**
 * Image and camera sources for the jig's workpieces. The list itself and „From selection“ are drawn by the app
 * from the generator's declaration (lists, actions).
 */
export function jigPanel(p: Params, set: (patch: Params) => void, host?: GenHost): GenPanel {
  let shapes = decodeShapes(String(p.shapes ?? '[]'));
  const note = h('div', { class: 'note' });
  const add = (list: JigShape[], msg: string) => {
    if (!list.length) return void (note.textContent = msg);
    shapes = [...shapes, ...list];
    note.textContent = '';
    set({ shapes: encodeShapes(shapes) });
  };

  const imgWidth = h('input', { type: 'number', min: '1', max: '1000', step: '0.1', value: '20', class: 'jig-count', title: t('Echte Breite des Werkstücks im Bild, damit die Form die richtige Größe bekommt') }) as HTMLInputElement;
  const file = h('input', { type: 'file', accept: 'image/*', hidden: true }) as HTMLInputElement;
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const { img } = readImage(bmp, bmp.width, bmp.height);
      const pc = biggest(detectPieces(img, 1, 1, { ...DEFAULT_DETECT, minArea: (img.width * img.height) / 400 }));
      if (!pc) return void (note.textContent = t('Im Bild wurde kein Werkstück erkannt. Am besten ein Foto von oben auf einfarbigem Hintergrund.'));
      const ext = pc.outline.flat();
      const wPx = Math.max(...ext.map((q) => q.x)) - Math.min(...ext.map((q) => q.x));
      const wMm = Number(imgWidth.value) || 20;
      add([pieceShape(pc, f.name.replace(/\.[^.]+$/, ''), wMm / Math.max(1e-6, wPx))], '');
    } catch {
      note.textContent = t('Das Bild ließ sich nicht lesen.');
    }
  });
  const fromImg = h('button', { class: 'btn small', title: t('Foto oder Scan eines Werkstücks nachzeichnen; die Breite legt den Maßstab fest') }, t('Aus Bild …')) as HTMLButtonElement;
  fromImg.addEventListener('click', () => file.click());

  const views = host ? host.cameraImages() : [];
  const fromCam = h('button', { class: 'btn small', title: t('Werkstücke auf dem Bett im Kamerabild erkennen; Maße kommen aus der Kalibrierung') }, t('Aus Kamera')) as HTMLButtonElement;
  fromCam.hidden = !views.length;
  fromCam.addEventListener('click', () => {
    const v = views[0];
    const src = v?.image;
    if (!src || !host) return void (note.textContent = t('Kein Kamerabild. Im Fenster „Kamera“ verbinden und das Bild aktualisieren.'));
    const { w: bw, h: bh } = host.bed();
    const { img } = readImage(src, src.width, src.height, 1200);
    const ps = detectPieces(img, bw / img.width, bh / img.height, DEFAULT_DETECT, v.empty ? readImage(v.empty, v.empty.width, v.empty.height, 1200).img : null).filter((pc) => !pc.cut);
    if (!ps.length) return void (note.textContent = t('Kein Werkstück im Kamerabild erkannt.'));
    // Gleich große Teile nur einmal übernehmen (Fläche ±8 %): mehrere gleiche Anhänger = eine Art mit Anzahl
    const kinds: { pc: Piece; n: number }[] = [];
    for (const pc of ps) {
      const same = kinds.find((k) => Math.abs(k.pc.area - pc.area) / k.pc.area < 0.08);
      if (same) same.n++;
      else kinds.push({ pc, n: 1 });
    }
    add(kinds.map((k, i) => ({ ...pieceShape(k.pc, t('Kamera {n}', { n: shapes.length + i + 1 })), c: k.n })), '');
    note.textContent = tn('{n} Werkstück erkannt.', '{n} Werkstücke erkannt.', ps.length);
  });

  const el = h('div', { class: 'jig-panel' },
    h('div', { class: 'conn-row' }, fromImg, h('span', { class: 'muted' }, t('Breite (mm)')), imgWidth, fromCam, file),
    note,
  );
  return {
    el,
    refresh(np: Params) {
      shapes = decodeShapes(String(np.shapes ?? '[]'));
    },
  };
}
