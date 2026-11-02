// Bereich „Werkstücke“ im Dialog des Jig-Generators: Werkstückformen aus der Auswahl (Vektorgrafik, Text, Formen),
// aus einem Bild (Foto oder Scan, nachgezeichnet) oder aus dem Kamerabild holen; je Art Name, Anzahl und Drehung.
import type { Editor } from '../editor';
import { cameraViews } from '../cameraui';
import { flattenSub, SCALE } from '../clip';
import { h } from '../dom';
import { shapeSubs, subsToPath2D } from '../geom';
import { dec, t, tn } from '../i18n';
import { IDENT, Obj, Pt, visibleLeaves } from '../model';
import { DEFAULT_DETECT, detectPieces, Piece, RGBAImage } from '../workpieces';
import { decodeShapes, encodeShapes, JigShape, outlineFromPolys } from './jig';
import type { GenPanel } from '../model3d/ribsPanel';
import type { Params } from './types';

const polysOfObj = (o: Obj): Pt[][] => {
  const out: Pt[][] = [];
  for (const [leaf, world] of visibleLeaves([o]))
    for (const sp of shapeSubs(leaf.shape)) if (sp.closed) out.push(flattenSub(sp, world).map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));
  return out;
};

const nameOf = (o: Obj) => o.name || (o.shape.kind === 'text' ? o.shape.text.slice(0, 20) : '');

/** Je gewähltem Objekt (oberste Ebene) eine Werkstückart: Außenumriss aller geschlossenen Konturen */
export function shapesFromSelection(ed: Editor): JigShape[] {
  const sel = ed.doc.objs.filter((o) => ed.sel.includes(o));
  return sel
    .map((o, i) => ({ n: nameOf(o) || t('Werkstück {n}', { n: i + 1 }), c: 1, r: 0, s: outlineFromPolys(polysOfObj(o)) }))
    .filter((s) => s.s.length);
}

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

export function jigPanel(p: Params, set: (patch: Params) => void, ed?: Editor): GenPanel {
  let shapes = decodeShapes(String(p.shapes ?? '[]'));
  const list = h('div', { class: 'jig-list' });
  const note = h('div', { class: 'note' });
  const commit = () => (set({ shapes: encodeShapes(shapes) }), render());
  const add = (list: JigShape[], msg: string) => {
    if (!list.length) return void (note.textContent = msg);
    shapes.push(...list);
    note.textContent = '';
    commit();
  };

  const render = () => {
    list.textContent = '';
    if (!shapes.length) list.append(h('div', { class: 'muted' }, t('Noch kein Werkstück.')));
    shapes.forEach((sh, i) => {
      const cv = h('canvas', { class: 'jig-thumb', width: 64, height: 64 }) as HTMLCanvasElement;
      const pts = sh.s.flatMap((sp) => sp.nodes);
      const ext = Math.max(1e-6, ...pts.map((q) => Math.max(Math.abs(q.x), Math.abs(q.y))));
      const ctx = cv.getContext('2d')!;
      const k = 28 / ext;
      ctx.setTransform(k, 0, 0, k, 32, 32);
      if (sh.r === 90) ctx.rotate(Math.PI / 2);
      ctx.lineWidth = 1.5 / k;
      ctx.strokeStyle = getComputedStyle(document.body).color || '#333';
      ctx.stroke(subsToPath2D(sh.s));
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const sp of sh.s)
        for (const f of flattenSub(sp, IDENT)) {
          const q = { x: f.X / SCALE, y: f.Y / SCALE };
          ((x0 = Math.min(x0, q.x)), (x1 = Math.max(x1, q.x)), (y0 = Math.min(y0, q.y)), (y1 = Math.max(y1, q.y)));
        }
      const name = h('input', { type: 'text', value: sh.n, class: 'jig-name' }) as HTMLInputElement;
      name.addEventListener('change', () => ((sh.n = name.value.trim()), commit()));
      const count = h('input', { type: 'number', min: '0', max: '500', step: '1', value: String(sh.c), class: 'jig-count', title: t('Anzahl Fächer für dieses Werkstück') }) as HTMLInputElement;
      count.addEventListener('change', () => ((sh.c = Math.max(0, Math.min(500, Math.round(Number(count.value) || 0)))), commit()));
      const rot = h('select', { title: t('Werkstück im Jig drehen') },
        h('option', { value: '0', selected: sh.r === 0 }, '0°'),
        h('option', { value: '90', selected: sh.r === 90 }, '90°'),
      ) as HTMLSelectElement;
      rot.addEventListener('change', () => ((sh.r = Number(rot.value)), commit()));
      list.append(
        h('div', { class: 'jig-row' },
          cv,
          h('div', { class: 'jig-col' }, name, h('span', { class: 'muted' }, `${dec((x1 - x0).toFixed(1))} × ${dec((y1 - y0).toFixed(1))} mm`)),
          h('label', {}, t('Anzahl'), ' ', count),
          rot,
          h('button', { class: 'btn small', title: t('Werkstück entfernen'), onclick: () => (shapes.splice(i, 1), commit()) }, '×'),
        ),
      );
    });
  };

  // ----- Quellen -----
  const fromSel = h('button', { class: 'btn small', title: t('Gewählte Objekte als Werkstücke übernehmen (Vektorgrafik, Formen, Text); je Objekt eine Art, Löcher zählen nicht') }, t('Aus Auswahl')) as HTMLButtonElement;
  fromSel.addEventListener('click', () => {
    if (!ed) return;
    add(shapesFromSelection(ed), t('Erst auf der Arbeitsfläche die Werkstückform auswählen (z. B. eine importierte SVG-, DXF- oder PDF-Datei).'));
  });

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

  const views = ed ? cameraViews(ed) : [];
  const fromCam = h('button', { class: 'btn small', title: t('Werkstücke auf dem Bett im Kamerabild erkennen; Maße kommen aus der Kalibrierung') }, t('Aus Kamera')) as HTMLButtonElement;
  fromCam.hidden = !views.length;
  fromCam.addEventListener('click', () => {
    const v = views[0];
    const src = v?.image;
    if (!src || !ed) return void (note.textContent = t('Kein Kamerabild. Im Fenster „Kamera“ verbinden und das Bild aktualisieren.'));
    const { w: bw, h: bh } = ed.doc.bed;
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
    h('h4', {}, t('Werkstücke')),
    list,
    h('div', { class: 'conn-row' }, fromSel, fromImg, h('span', { class: 'muted' }, t('Breite (mm)')), imgWidth, fromCam, file),
    note,
  );
  render();
  return {
    el,
    refresh(np: Params) {
      const s = String(np.shapes ?? '[]');
      if (s !== encodeShapes(shapes)) {
        shapes = decodeShapes(s);
        render();
      }
    },
  };
}
