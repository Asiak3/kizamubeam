// Gezeichnete Formen auf Schnitt-Layern schneiden Löcher und Kerben in Platten (Teile von Baugruppen, Platten von
// Mehrlagenarbeiten): ganz darin ein Loch, am Rand eine Kerbe, wie beim Lasern. Gemeinsam für die 3D-Ansicht (panel.ts)
// und die Steckprüfung (asmcheck.ts), damit beide dieselbe Platte sehen (Issue #285).
import ClipperLib from 'clipper-lib';
import { apply, inv, isCutLayer, Layer, Mat, Obj, outputLeaves, Pt } from '../model';
import { region } from '../ops';
import { Paths, SCALE } from '../clip';

/** Schneidform auf der Arbeitsfläche (Koordinaten in µm wie Clipper) */
export interface Cutter {
  id: number;
  page: number;
  paths: Paths;
  /** Ausdehnung [x0, y0, x1, y1] in µm */
  box: number[];
}

/**
 * Schneidet diese Form beim Lasern Platten aus? Layer mit Ausgabe und Schnitt; keine Texte, Bilder und Beschriftungen.
 * Generator-Teile (Jig, Zahnrad, Wände) sind fertige Platten und schneiden nichts in andere.
 */
export const cutsPlates = (o: Obj, L: Layer) =>
  L.output && isCutLayer(L) && o.shape.kind !== 'text' && o.shape.kind !== 'image' && o.shape.kind !== 'gen' && !(o.shape.kind === 'path' && o.shape.mark);

/** Ausdehnung von Clipper-Pfaden (µm): [x0, y0, x1, y1] */
export function pathBox(paths: Paths): number[] {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of paths)
    for (const q of p) {
      b[0] = Math.min(b[0], q.X);
      b[1] = Math.min(b[1], q.Y);
      b[2] = Math.max(b[2], q.X);
      b[3] = Math.max(b[3], q.Y);
    }
  return b;
}

/**
 * Alle Formen aller Seiten, die Platten ausschneiden können. Wie die Laser-Ausgabe (outputLeaves, Issue #217): Auch
 * ausgeblendete Formen zählen, noLaser und Formen mit falscher Bedingung nicht. skip: IDs, die schon anders verwendet sind.
 */
export function collectCutters(pages: Obj[][], layerOf: (i: number) => Layer, skip?: Set<number>): Cutter[] {
  const out: Cutter[] = [];
  const seen = new Set<number>();
  pages.forEach((objs, page) => {
    for (const [o, m] of outputLeaves(objs)) {
      if (seen.has(o.id) || skip?.has(o.id) || !cutsPlates(o, layerOf(o.layer))) continue;
      seen.add(o.id);
      const paths = region({ ...o, m });
      if (paths.length) out.push({ id: o.id, page, paths, box: pathBox(paths) });
    }
  });
  return out;
}

const clip = (type: number, a: Paths, b: Paths): Paths => {
  const c = new ClipperLib.Clipper();
  c.AddPaths(a, ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(b, ClipperLib.PolyType.ptClip, true);
  const out: Paths = [];
  c.Execute(type, out, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  return out;
};
const area = (ps: Paths) => ps.reduce((sum, p) => sum + Math.abs(ClipperLib.Clipper.Area(p)), 0);

/**
 * Eine Platte mit den Formen ihrer Seite ausschneiden. polys: Konturen der Platte in ihren eigenen Koordinaten;
 * toLocal: Abbildung Arbeitsfläche → Platte. Liefert die neuen Konturen und die IDs der Formen, die wirklich etwas
 * weggenommen haben, oder null, wenn nichts geschnitten wurde. Berühren ohne Überdeckung schneidet nichts; eine Form,
 * die die ganze Platte überdeckt, auch nicht (die Platte bleibt dann, wie sie ist).
 */
export function cutPlate(polys: Pt[][], page: number, toLocal: Mat, cutters: Cutter[]): { polys: Pt[][]; used: number[] } | null {
  if (!polys.length || !cutters.length) return null;
  // Ausdehnung der Platte auf der Arbeitsfläche (Rahmen der vier Ecken, reicht als Vorfilter)
  const pts = polys.flat();
  const xs = pts.map((q) => q.x),
    ys = pts.map((q) => q.y);
  const back = inv(toLocal);
  const corners = [apply(back, Math.min(...xs), Math.min(...ys)), apply(back, Math.max(...xs), Math.min(...ys)), apply(back, Math.min(...xs), Math.max(...ys)), apply(back, Math.max(...xs), Math.max(...ys))];
  const cb = [Math.min(...corners.map((q) => q.x)) * SCALE, Math.min(...corners.map((q) => q.y)) * SCALE, Math.max(...corners.map((q) => q.x)) * SCALE, Math.max(...corners.map((q) => q.y)) * SCALE];
  let subject: Paths | null = null;
  const used: number[] = [];
  for (const c of cutters) {
    if (c.page !== page || c.box[0] >= cb[2] || c.box[2] <= cb[0] || c.box[1] >= cb[3] || c.box[3] <= cb[1]) continue;
    subject ??= polys.map((p) => p.map((q) => ({ X: Math.round(q.x * SCALE), Y: Math.round(q.y * SCALE) })));
    const local = c.paths.map((p) =>
      p.map((q) => {
        const r = apply(toLocal, q.X / SCALE, q.Y / SCALE);
        return { X: Math.round(r.x * SCALE), Y: Math.round(r.y * SCALE) };
      }),
    );
    if (area(clip(ClipperLib.ClipType.ctIntersection, subject, local)) < 1e-4 * SCALE * SCALE) continue;
    const rest = clip(ClipperLib.ClipType.ctDifference, subject, local);
    if (!rest.length) continue;
    subject = rest;
    used.push(c.id);
  }
  if (!subject || !used.length) return null;
  return { polys: subject.map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE }))), used };
}
