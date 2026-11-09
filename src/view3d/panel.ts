// Fenster „3D-Ansicht“: zeigt Baugruppen aus Generatoren (Box, Schublade, Einsatz, Regal, Zahnradpaar)
// zusammengesteckt, markiert Durchdringungen und lässt die Teile auseinanderziehen. Andere Konturen auf
// Schnitt-Layern liegen flach mit der eingestellten Materialdicke dort, wo sie auf der Arbeitsfläche sind.
// Teile, die mit dem Verbindungs-Werkzeug verbunden wurden, werden über die gemerkten Verbindungen zusammengesetzt.
// Gezeigt wird die Auswahl (eine gewählte Baugruppe immer ganz), ohne Auswahl alles auf der Seite.
import type { Editor } from '../editor';
import type { GenShape, Mat, Obj } from '../model';
import { IDENT, inv, isCutLayer, leaves, mul, visibleLeaves } from '../model';
import { boundsOf } from '../geom';
import { region } from '../ops';
import ClipperLib from 'clipper-lib';
import { Path, Paths, SCALE } from '../clip';
import { h } from '../dom';
import { t } from '../i18n';
import { dockWindow, isShown, onWindowShow } from '../dock';
import { objLabel } from '../objectsPanel';
import { genLabel } from '../generators';
import { asmSolids, findOverlaps, Overlap, Solid, solidBounds } from './solids';
import { flatPose, genThickness } from './poses';
import { assembleMates, MatePart } from './mates';
import { BURN, CanvasPlace, engravings, memberPlace } from './engrave';
import { cleanLook, DEFAULT_LOOK, layerLook, LookPreset, MaterialLook, resolveLook } from './looks';
import { lookEditor } from './lookui';
import { library } from '../materials';
import { onImageReady } from '../images';
import type { MockupBg, Scene3D, Viewer3D, ViewPreset, ViewSolid } from './viewer';
import { saveDataUrl } from '../files';
import { plateAnchor } from '../multilayer';

/** Hintergründe des Mockups (Liste hier, damit three.js erst mit dem Fenster geladen wird) */
const MOCKUP_BGS: MockupBg[] = ['studio', 'white', 'grey', 'dark', 'theme'];
// i18n-keys-start (Namen der Hintergründe, übersetzt per t(BG_NAMES[…]))
const BG_NAMES: Record<MockupBg, string> = { studio: 'Studio', white: 'Weiß', grey: 'Grau', dark: 'Dunkel', theme: 'Wie die Oberfläche' };
// i18n-keys-end

const KEY = 'kizamubeam.view3d';
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });

interface Settings {
  th: number;
  overlaps: boolean;
  /** Gravuren (Füllungen, Linien, Bilder) auf den Platten zeigen */
  marks: boolean;
  /** Aussehen für Layer ohne eigenes Material */
  look: MaterialLook;
  /** Mockup-Modus: Schatten statt Raster, eigener Hintergrund */
  mockup: boolean;
  bg: MockupBg;
}

function loadSettings(): Settings {
  const d: Settings = { th: 3, overlaps: true, marks: true, look: DEFAULT_LOOK, mockup: false, bg: 'studio' };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (s.th > 0 && s.th <= 50) d.th = Number(s.th);
    if (typeof s.overlaps === 'boolean') d.overlaps = s.overlaps;
    if (typeof s.marks === 'boolean') d.marks = s.marks;
    d.look = cleanLook(s.look) ?? d.look;
    if (typeof s.mockup === 'boolean') d.mockup = s.mockup;
    if (MOCKUP_BGS.includes(s.bg)) d.bg = s.bg;
  } catch {
    /* Speicher nicht verfügbar */
  }
  return d;
}

/** Frei gezeichnete Mehrlagenarbeiten: die gespeicherte Ankerlage hält die Montage beim Nesting zusammen. */
function collectMultiLayers(ed: Editor, selected: Obj[] | null, fallback: MaterialLook, places: Map<string, CanvasPlace>) {
  const roots = new Map<number, { o: Obj; page: number }>();
  ed.doc.pages.forEach((pg, page) => pg.objs.forEach((o) => roots.set(o.id, { o, page })));
  const wanted = selected ? new Set(selected.map((o) => o.id)) : null;
  const solids: ViewSolid[] = [];
  const ids: string[] = [];
  const used = new Set<number>();
  let count = 0;
  for (const a of ed.doc.multiLayerAssemblies ?? []) {
    if (wanted && !a.plates.some((p) => wanted.has(p.object))) continue;
    const live = a.plates.map((p) => ({ p, root: roots.get(p.object) })).filter((x): x is { p: typeof a.plates[number]; root: { o: Obj; page: number } } => !!x.root);
    if (!live.length) continue;
    if (!wanted && live.every((x) => x.root.o.hidden)) continue;
    count++;
    let z = 0;
    for (let pi = 0; pi < live.length; pi++) {
      const { p, root } = live[pi];
      // Frühe Entwürfe speicherten die Objektmatrix als Anker und ließen Platten dadurch nebeneinander.
      // Diese alte Form wird beim Anzeigen einmalig als zentrierte Montage interpretiert.
      const legacyAnchor = p.anchor.every((v, i) => Math.abs(v - root.o.m[i]) < 1e-9);
      const delta = mul(legacyAnchor ? plateAnchor(root.o) : p.anchor, inv(root.o.m));
      const paths: Paths = [];
      for (const [leaf, m] of leaves([root.o])) {
        used.add(leaf.id);
        if (!isCutLayer(ed.layer(leaf.layer)) || leaf.shape.kind === 'text' || leaf.shape.kind === 'image') continue;
        if (leaf.shape.kind === 'path' && leaf.shape.mark) continue;
        paths.push(...region({ ...leaf, m: mul(delta, m) }));
      }
      let part = 0;
      for (const { outer, holes } of islands(paths)) {
        const key = `ml:${a.id}:${pi}:${part++}`;
        const polys = [outer, ...holes].map((q) => q.map((v) => ({ x: v.X / SCALE, y: v.Y / SCALE })));
        solids.push({ key, label: p.name, polys, pose: flatPose(0, 0, z), th: p.thickness, group: `ml:${a.id}`, layer: root.o.layer, look: resolveLook(p.look ?? fallback) });
        places.set(key, { page: root.page, toLocal: delta });
      }
      z += p.thickness;
    }
    ids.push(`ml:${a.id}`);
  }
  return { solids, ids, used, count };
}

/** Teile für die Ansicht sammeln; liefert auch einen Schlüssel, der sich nur ändert, wenn andere Objekte gezeigt werden */
export function collectScene(ed: Editor, th: number, marks = true, fallback: MaterialLook = DEFAULT_LOOK): { scene: Scene3D; key: string; asms: number } {
  const roots = ed.sel.length ? ed.sel : ed.doc.objs.filter((o) => !o.hidden);
  const solids: ViewSolid[] = [];
  const ids: (number | string)[] = [];
  const asmDone = new Set<string>();
  /** Lage jeder Platte auf der Arbeitsfläche (für die Gravuren) */
  const places = new Map<string, CanvasPlace>();
  const multi = collectMultiLayers(ed, ed.sel.length ? roots : null, fallback, places);
  solids.push(...multi.solids);
  ids.push(...multi.ids);
  let asms = multi.count;
  // Flache Konturen je Dicke sammeln: Ineinanderliegende Konturen sind wie beim Lasern Löcher
  const flats = new Map<number, { paths: Paths; names: { label: string; box: number[]; layer: number }[] }>();
  const flat = (o: Obj, m: Obj['m'], thick: number) => {
    const L = ed.layer(o.layer);
    if (!isCutLayer(L) || o.shape.kind === 'text' || o.shape.kind === 'image') return;
    // Beschriftung eines Generator-Teils (Schichtnummer) ist Gravur, auch wenn sie geschlossen ist
    if (o.shape.kind === 'path' && o.shape.mark) return;
    const paths = region({ ...o, m });
    if (!paths.length) return;
    const f = flats.get(thick) ?? { paths: [], names: [] };
    flats.set(thick, f);
    f.paths.push(...paths);
    f.names.push({ label: o.shape.kind === 'gen' ? genLabel(o.shape) : objLabel(o), box: pathBox(paths), layer: o.layer });
    ids.push(o.id);
  };
  // Eine Auswahl zeigt auch ausgeblendete Objekte, die ganze Seite nur sichtbare
  const all = [...(ed.sel.length ? leaves(roots) : visibleLeaves(roots))].filter(([o]) => !multi.used.has(o.id));
  const mated = collectMates(ed, all, th, places);
  for (const g of mated.groups) {
    solids.push(...g);
    ids.push(...g.map((x) => x.key));
  }
  asms += mated.groups.length;
  for (const [o, m] of all) {
    if (mated.used.has(o.id)) continue;
    const s = o.shape;
    if (s.kind === 'gen' && s.asm) {
      if (asmDone.has(s.asm)) continue;
      const members = ed.asmMembers(s.asm);
      const keys = new Set(members.map((x) => (x.o.shape as GenShape).part ?? 'main'));
      const parts = asmSolids(s.gen, s.params, th, keys);
      if (!parts) {
        // Ohne räumlichen Aufbau (oder mit fehlerhaften Parametern): flach zeigen wie andere Konturen
        flat(o, m, genThickness(s.params, th));
        continue;
      }
      asmDone.add(s.asm);
      asms++;
      placeAssembly(parts, members.map((x) => x.o).filter((x) => onPage(ed, x)));
      for (const p of parts) {
        const key = `${s.asm}:${p.key}`;
        const mem = members.find((x) => ((x.o.shape as GenShape).part ?? 'main') === p.key);
        solids.push({ ...p, key, group: s.asm, layer: (mem ?? members[0])?.o.layer ?? o.layer });
        const pl = mem && memberPlace(ed, mem.o);
        if (pl) places.set(key, pl);
      }
      ids.push(s.asm);
    } else if (s.kind === 'gen') flat(o, m, genThickness(s.params, th));
    else flat(o, m, th);
  }
  let n = 0;
  for (const [thick, f] of flats)
    for (const { outer, holes } of islands(f.paths)) {
      const box = pathBox([outer]);
      // Name des Objekts, dessen Umriss die Insel ist, sonst durchnummeriert
      const named = f.names.find((x) => x.box.every((v, i) => Math.abs(v - box[i]) < 10));
      // Material: Layer des Umrisses, sonst der erste Teil, der in der Insel liegt
      const layer = named?.layer ?? f.names.find((x) => x.box[0] >= box[0] && x.box[1] >= box[1] && x.box[2] <= box[2] && x.box[3] <= box[3])?.layer ?? f.names[0]?.layer ?? 0;
      const polys = [outer, ...holes].map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE })));
      n++;
      solids.push({ key: `f${n}`, label: named?.label ?? t('Teil {n}', { n }), polys, pose: flatPose(), th: thick, group: `f${n}`, layer });
      places.set(`f${n}`, { page: ed.doc.page, toLocal: IDENT });
    }
  // Aussehen je Platte aus ihrem Layer
  const looks = new Map<number, LookPreset>();
  for (const s of solids) {
    if (!s.look) {
      const li = s.layer ?? 0;
      if (!looks.has(li)) looks.set(li, resolveLook(layerLook(ed.layer(li), (id) => library.get(id)?.material, fallback)));
      s.look = looks.get(li);
    }
  }
  if (marks) {
    const eng = engravings(ed, solids, places, (s) => (s as ViewSolid).look?.engrave ?? BURN);
    for (const s of solids) s.engraving = eng.get(s.key);
  }
  const overlaps = findOverlaps(solids);
  return { scene: { solids, overlaps }, key: `${th}|${ids.join(',')}`, asms };
}

/** Darf ein Objekt als Platte (bzw. als Loch darin) erscheinen? Nur geschlossene Konturen auf Schnitt-Layern. */
const cutShape = (ed: Editor, o: Obj) => isCutLayer(ed.layer(o.layer)) && o.shape.kind !== 'text' && o.shape.kind !== 'image' && !(o.shape.kind === 'gen' && o.shape.asm);

/** Punkt in der Fläche (Gerade-Ungerade über alle Konturen) */
const inRegion = (paths: Paths, pt: { X: number; Y: number }) => paths.filter((p) => ClipperLib.Clipper.PointInPolygon(pt, p) !== 0).length % 2 === 1;

/**
 * Über Verbindungen zusammenhängende Teile: Wird eines gezeigt, kommt die ganze Gruppe dazu. Formen, die ganz in
 * einer solchen Platte liegen (Löcher, Schlitze auf einer Hilfslinie), werden zu Löchern der Platte.
 */
function collectMates(ed: Editor, shown: [Obj, Mat][], th: number, places: Map<string, CanvasPlace>): { groups: ViewSolid[][]; used: Set<number> } {
  // Verbundene Teile auf allen Seiten (z. B. nach dem Verschachteln auf mehrere Platten verteilt)
  const page = new Map<number, [Obj, Mat]>();
  const pageNo = new Map<number, number>();
  ed.doc.pages.forEach((pg, i) => {
    for (const [o, m] of leaves(pg.objs)) {
      page.set(o.id, [o, m]);
      pageNo.set(o.id, i);
    }
  });
  const graph = new Map<number, number[]>();
  const link = (x: number, y: number) => (graph.get(x) ?? graph.set(x, []).get(x)!).push(y);
  for (const [o] of page.values())
    for (const mt of o.mates ?? [])
      if (mt.to !== o.id && page.has(mt.to)) {
        link(o.id, mt.to);
        link(mt.to, o.id);
      }
  const used = new Set<number>();
  if (!graph.size) return { groups: [], used };
  const ids = new Set<number>();
  for (const [o] of shown) {
    if (!graph.has(o.id) || ids.has(o.id)) continue;
    const queue = [o.id];
    ids.add(o.id);
    while (queue.length)
      for (const y of graph.get(queue.shift()!)!)
        if (!ids.has(y)) {
          ids.add(y);
          queue.push(y);
        }
  }
  if (!ids.size) return { groups: [], used };
  const regions = new Map<number, Paths>();
  for (const id of ids) {
    const [o, m] = page.get(id)!;
    regions.set(id, region({ ...o, m }));
    used.add(id);
  }
  // Formen in den Platten zu Löchern machen
  for (const [o, m] of page.values()) {
    if (ids.has(o.id) || !cutShape(ed, o)) continue;
    const paths = region({ ...o, m });
    if (!paths.length) continue;
    const box = pathBox(paths);
    for (const [id, own] of regions) {
      // Löcher nur aus derselben Seite: Seiten liegen übereinander auf demselben Bett
      if (pageNo.get(id) !== pageNo.get(o.id)) continue;
      const pb = pathBox(own);
      if (box[0] < pb[0] || box[1] < pb[1] || box[2] > pb[2] || box[3] > pb[3]) continue;
      if (!paths.every((p) => inRegion(own, p[0]))) continue;
      own.push(...paths);
      used.add(o.id);
      break;
    }
  }
  const parts: MatePart[] = [...ids].map((id) => {
    const [o, m] = page.get(id)!;
    const merged = ClipperLib.Clipper.SimplifyPolygons(regions.get(id)!, ClipperLib.PolyFillType.pftEvenOdd);
    return { id, label: objLabel(o), polys: merged.map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE }))), m, mates: o.mates ?? [] };
  });
  const r = assembleMates(parts, th);
  const byGroup = new Map<string, ViewSolid[]>();
  for (const s of r.solids) {
    const g = r.groups.get(s.key)!;
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push({ ...s, key: 'm' + s.key, group: g, layer: page.get(Number(s.key))?.[0].layer });
    // Konturen liegen in Koordinaten der Arbeitsfläche ihrer Seite
    places.set('m' + s.key, { page: pageNo.get(Number(s.key)) ?? ed.doc.page, toLocal: IDENT });
  }
  // Jede Gruppe unter die Mitte ihrer Teile auf der Arbeitsfläche
  for (const g of byGroup.values()) {
    const pts = g.flatMap((s) => s.polys.flat());
    const xs = pts.map((q) => q.x),
      ys = pts.map((q) => q.y);
    placeAt(g, (Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
  }
  return { groups: [...byGroup.values()], used };
}

/** Ausdehnung von Clipper-Pfaden (µm): [x0, y0, x1, y1] */
function pathBox(paths: Paths): number[] {
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

/** Konturen nach Gerade-Ungerade-Regel in zusammenhängende Flächen mit ihren Löchern zerlegen */
function islands(paths: Paths): { outer: Path; holes: Path[] }[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  const out: { outer: Path; holes: Path[] }[] = [];
  const walk = (node: ClipperLib.PolyNode) => {
    for (const ch of node.Childs()) {
      if (ch.IsHole()) continue;
      out.push({ outer: ch.Contour(), holes: ch.Childs().map((x) => x.Contour()) });
      for (const hole of ch.Childs()) walk(hole);
    }
  };
  walk(tree);
  return out;
}

const onPage = (ed: Editor, o: Obj) => [...leaves(ed.doc.objs)].some(([l]) => l === o);

/** Baugruppe so legen, dass ihre Mitte unter der Mitte ihrer Teile auf der Arbeitsfläche liegt (Boden auf Z = 0) */
function placeAssembly(parts: Solid[], onCanvas: Obj[]) {
  const c = boundsOf(onCanvas);
  placeAt(parts, c ? c.x + c.w / 2 : 0, c ? c.y + c.h / 2 : 0);
}

/** Teile so verschieben, dass ihre Mitte unter dem Punkt (cx, cy) der Arbeitsfläche liegt und der Boden auf Z = 0 */
function placeAt(parts: Solid[], cx: number, cy: number) {
  const b = parts.map(solidBounds);
  const min = [0, 1, 2].map((k) => Math.min(...b.map((x) => x.min[k])));
  const max = [0, 1, 2].map((k) => Math.max(...b.map((x) => x.max[k])));
  const d = [cx - (min[0] + max[0]) / 2, -cy - (min[1] + max[1]) / 2, -min[2]];
  for (const p of parts) p.pose = { ...p.pose, o: [p.pose.o[0] + d[0], p.pose.o[1] + d[1], p.pose.o[2] + d[2]] };
}

function overlapText(list: Overlap[], solids: ViewSolid[]): string {
  if (!list.length) return t('Keine Überschneidungen');
  const name = (k: string) => {
    const s = solids.find((x) => x.key === k);
    // Bei Baugruppen nur den Teil nennen („Box …: Boden“ → „Boden“)
    return s ? (s.label.includes(': ') ? s.label.slice(s.label.lastIndexOf(': ') + 2) : s.label) : k;
  };
  const vol = list.reduce((s, o) => s + o.volume, 0);
  const worst = [...list].sort((a, b) => b.volume - a.volume).slice(0, 3);
  return (
    t('Überschneidungen: {n}, zusammen {v} mm³', { n: list.length, v: fmt(vol) }) +
    ': ' +
    worst.map((o) => `${name(o.a)} / ${name(o.b)}`).join(', ') +
    (list.length > 3 ? ' …' : '')
  );
}

export function buildView3dPanel(ed: Editor) {
  const body = dockWindow('view3d', t('3D-Ansicht'), { float: { w: 640, h: 500 } });
  const set = loadSettings();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(set));
    } catch {
      /* Speicher nicht verfügbar */
    }
  };
  const host = h('div', { class: 'v3d-canvas' });
  const status = h('div', { class: 'v3d-status' });
  const hint = h('div', { class: 'v3d-empty' }, t('Wähle eine Baugruppe (z. B. eine Box) oder Teile aus. Ohne Auswahl zeigt die Ansicht alle Schnitte der Seite.'));
  const explode = h('input', { type: 'range', min: '0', max: '1.5', step: '0.01', value: '0', title: t('Teile auseinanderziehen') }) as HTMLInputElement;
  const spinBox = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const spinLbl = h('label', { class: 'v3d-check', title: t('Zahnräder drehen') }, spinBox, t('Drehen'));
  const ovBox = h('input', { type: 'checkbox', checked: set.overlaps }) as HTMLInputElement;
  const markBox = h('input', { type: 'checkbox', checked: set.marks }) as HTMLInputElement;
  const mockBox = h('input', { type: 'checkbox', checked: set.mockup }) as HTMLInputElement;
  const bgSel = h(
    'select',
    { title: t('Hintergrund des Mockups'), hidden: !set.mockup },
    ...MOCKUP_BGS.map((b) => h('option', { value: b, selected: b === set.bg }, t(BG_NAMES[b]))),
  ) as HTMLSelectElement;
  const shotBtn = h('button', {
    class: 'small',
    title: t('Die aktuelle Ansicht in doppelter Auflösung als PNG speichern, z. B. als Mockup für Kunden'),
    onclick: async () => {
      if (!viewer) return;
      await saveDataUrl(t('mockup.png'), 'PNG', 'png', viewer.snapshot(2));
    },
  }, t('Bild speichern …'));
  const thIn = h('input', { type: 'number', min: '0.3', max: '50', step: '0.1', value: String(set.th), class: 'v3d-th' }) as HTMLInputElement;
  const view = (p: ViewPreset) => viewer?.view(p);
  const bar = h(
    'div',
    { class: 'v3d-bar' },
    h('button', { class: 'small', title: t('Schräg von vorne'), onclick: () => view('iso') }, t('3D')),
    h('button', { class: 'small', title: t('Von oben'), onclick: () => view('top') }, t('Oben|3D')),
    h('button', { class: 'small', title: t('Von vorne'), onclick: () => view('front') }, t('Vorne|3D')),
    h('label', { class: 'v3d-range', title: t('Teile auseinanderziehen') }, t('Explosion'), explode),
    spinLbl,
    h('label', { class: 'v3d-check', title: t('Bereiche, in denen sich Teile durchdringen, rot zeigen') }, ovBox, t('Überschneidungen')),
    h('label', { class: 'v3d-check', title: t('Füllungen, gravierte Linien und Bilder auf den Teilen zeigen') }, markBox, t('Gravuren')),
    h('label', { class: 'v3d-th-lbl', title: t('Für Teile ohne eigene Materialdicke (z. B. Zahnräder und gezeichnete Formen)') }, t('Dicke'), thIn, 'mm'),
    h('label', { class: 'v3d-look', title: t('Aussehen für Layer ohne eigenes Material. Eigenes Aussehen je Schnitt-Layer im Layer-Dialog (Doppelklick auf den Layer).') },
      t('Material'),
      lookEditor(() => set.look, (v) => {
        set.look = v ?? DEFAULT_LOOK;
        save();
        update();
      }),
    ),
    h('label', { class: 'v3d-check', title: t('Ohne Raster, mit weichen Schatten und eigenem Hintergrund, z. B. für Bilder für Kunden') }, mockBox, t('Mockup')),
    bgSel,
    shotBtn,
  );
  body.append(bar, h('div', { class: 'v3d-stage' }, host, hint), status);

  let viewer: Viewer3D | null = null;
  let loading: Promise<void> | null = null;
  let lastKey = '';
  let info = '';
  let queued = 0;

  const update = () => {
    queued = 0;
    if (!viewer || !isShown('view3d')) return;
    const { scene, key, asms } = collectScene(ed, set.th, set.marks, set.look);
    hint.hidden = scene.solids.length > 0;
    viewer.setScene(scene, key !== lastKey);
    lastKey = key;
    spinLbl.hidden = !scene.solids.some((s) => s.spin);
    if (spinLbl.hidden && spinBox.checked) {
      spinBox.checked = false;
      viewer.setSpin(false);
    }
    const parts = scene.solids.length
      ? t('Teile: {n}', { n: scene.solids.length }) + (asms ? ` (${t('Baugruppen: {n}', { n: asms })})` : '')
      : '';
    info = parts ? `${parts} · ${set.overlaps ? overlapText(scene.overlaps, scene.solids) : ''}` : '';
    status.textContent = info;
    status.classList.toggle('v3d-bad', set.overlaps && scene.overlaps.length > 0);
  };
  const schedule = () => {
    if (!queued) queued = window.setTimeout(update, 150);
  };

  const open = () => {
    if (!loading)
      loading = import('./viewer')
        .then(({ Viewer3D }) => {
          try {
            viewer = new Viewer3D(host);
          } catch (e) {
            hint.hidden = false;
            hint.textContent = t('3D-Darstellung nicht möglich: {msg}', { msg: e instanceof Error ? e.message : String(e) });
            return;
          }
          viewer.onHover = (label) => (status.textContent = label ?? info);
          viewer.isVisible = () => isShown('view3d');
          viewer.setExplode(Number(explode.value));
          viewer.setShowOverlaps(set.overlaps);
          viewer.setMockup(set.mockup, set.bg);
          lastKey = '';
          update();
          viewer.setActive(isShown('view3d'));
        })
        .catch((e) => {
          hint.hidden = false;
          hint.textContent = t('3D-Darstellung nicht möglich: {msg}', { msg: String(e) });
        });
    else if (viewer) {
      update();
      viewer.setActive(true);
    }
  };
  onWindowShow('view3d', open);
  // The dock does not report windows that are already visible when the app starts (saved layout), so the
  // viewer would never load until the window is closed and reopened. Check once the dock is built.
  window.setTimeout(() => {
    if (isShown('view3d')) open();
  }, 0);
  explode.addEventListener('input', () => viewer?.setExplode(Number(explode.value)));
  spinBox.addEventListener('change', () => viewer?.setSpin(spinBox.checked));
  ovBox.addEventListener('change', () => {
    set.overlaps = ovBox.checked;
    save();
    viewer?.setShowOverlaps(set.overlaps);
    update();
  });
  markBox.addEventListener('change', () => {
    set.marks = markBox.checked;
    save();
    update();
  });
  const mockChanged = () => {
    set.mockup = mockBox.checked;
    set.bg = bgSel.value as MockupBg;
    bgSel.hidden = !set.mockup;
    save();
    viewer?.setMockup(set.mockup, set.bg);
  };
  mockBox.addEventListener('change', mockChanged);
  bgSel.addEventListener('change', mockChanged);
  thIn.addEventListener('change', () => {
    const v = Number(thIn.value.replace(',', '.'));
    if (v >= 0.3 && v <= 50) set.th = v;
    thIn.value = String(set.th);
    save();
    update();
  });
  ed.on((what) => {
    if (what !== 'doc' && what !== 'sel') return;
    if (!isShown('view3d')) return;
    // Fallback: if the window became visible without onShow, load the viewer now instead of doing nothing
    if (!viewer && !loading) open();
    else schedule();
  });
  // Neue oder geänderte Bibliotheksmaterialien können das Aussehen ändern
  library.on(() => {
    if (isShown('view3d')) schedule();
  });
  // Bilder werden im Hintergrund aufbereitet: danach die Gravuren neu zeichnen
  onImageReady(() => {
    if (set.marks && isShown('view3d')) schedule();
  });
}
