// Konstruktion prüfen: Fertigungsprüfung der aktuellen Seite vor dem Lasern. Findet doppelte Schnittlinien,
// ungewollt offene oder nicht verbundene Konturen, schmale Stege, zu kleine Innenausschnitte, Objekte außerhalb
// des Arbeitsbereichs und Import-Hinweise. Jeder Befund nennt die betroffenen Objekte, die Stellen zum Markieren
// (Weltkoordinaten) und, wo es geht, eine Korrektur. Ohne DOM, damit es auch in den Tests läuft.
import { IDENT, inv, isCutLayer, Layer, leaves, Mat, mul, Obj, outputLeaves, Pt, selfOutputOff, SubPath } from './model';
import { conditionHolds } from './params';
import { boundsOf, shapeSubs, textOutline } from './geom';
import { resolveImageEdits } from './imageEdits';
import { imageCutSettings, objectsById, resolveImageCutPath } from './imageCut';
import { imageCutIssueText } from './gcode';
import { parkedObjs } from './parking';
import { segments } from './curves';
import { copySub, extract } from './pathtools';
import { t, tn } from './i18n';
import { geomText } from './checkText';
import { checkFits, FitFinding } from './fitcheck';
import { AsmFinding, checkAssemblies } from './asmcheck';

import { boxLine, checkDouble, checkOpen, checkWebsAndHoles, DEFAULT_CHECK, makeContour, type CheckFix, type CheckIssue, type CheckLevel, type CheckSettings, type Contour, type GeomIssue } from './checkGeom';
export type { CheckFix, CheckIssue, CheckKind, CheckLevel, CheckSettings } from './checkGeom';
export { DEFAULT_CHECK };

const KEY = 'kizamubeam.check';

export function loadCheckSettings(): CheckSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULT_CHECK, ...raw, engraveLayers: Array.isArray(raw.engraveLayers) ? raw.engraveLayers : [] };
  } catch {
    return { ...DEFAULT_CHECK };
  }
}

export function saveCheckSettings(s: CheckSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ohne Speicher gelten die Einstellungen nur bis zum Neustart
  }
}

/** Beschriftung des Korrektur-Knopfs */
export function fixLabel(f: CheckFix): string {
  switch (f.kind) {
    case 'delete':
      return tn('Doppeltes Objekt löschen', 'Doppelte Objekte löschen', f.objs.length);
    case 'spans':
      return t('Doppelte Linien entfernen');
    case 'close':
      return t('Schließen|Pfad');
    case 'join':
      return t('Verbinden|Pfade');
    case 'bed':
      return t('Aufs Bett schieben');
    case 'note':
      return t('Hinweis ausblenden');
    case 'gen':
      return f.calibrated ? t('Kalibrierte Werte übernehmen') : 'thickness' in f.patch && Object.keys(f.patch).length === 1 ? t('Materialdicke übernehmen') : t('Spiel anpassen');
  }
}

export interface CheckInput {
  objs: Obj[];
  layer: (i: number) => Layer;
  bed: { w: number; h: number };
  settings: CheckSettings;
  /** Lage auf dem Bett nicht prüfen (Start ab Benutzer-Ursprung oder aktueller Position, Drehachse) */
  skipBed?: boolean;
  /** Objekte aller Seiten (Baugruppen, deren Teile nach dem Verschachteln verteilt liegen); sonst nur objs */
  allObjs?: Obj[];
  /** Objekte je Seite: gezeichnete Formen schneiden Löcher und Kerben in Baugruppen wie beim Lasern (nur dieselbe Seite) */
  pages?: Obj[][];
}

function collect(inp: CheckInput): Contour[] {
  const out: Contour[] = [];
  const engrave = new Set(inp.settings.engraveLayers);
  // Ausgabe-Semantik wie outputLeaves (Issue #217): hidden zählt mit, noLaser/showIf-falsch schließt aus (vererbt)
  const walk = (top: Obj, o: Obj, parent: Mat, noLaserAbove = false, offAbove = false) => {
    const noLaser = noLaserAbove || !!o.noLaser;
    const off = offAbove || (!!o.showIf && !conditionHolds(o.showIf));
    if (noLaser || off) return;
    const m = mul(parent, o.m);
    if (o.shape.kind === 'group') {
      for (const c of o.shape.children) walk(top, c, m, noLaser, off);
      return;
    }
    if (o.shape.kind === 'image') return;
    const L = inp.layer(o.layer);
    if (!L.output) return;
    const text = o.shape.kind === 'text';
    const subs = o.shape.kind === 'text' ? (textOutline(o.shape)?.subs ?? []) : shapeSubs(o.shape);
    const fill = L.mode === 'fill';
    // Beschriftung eines Generator-Teils (z. B. Schichtnummer) wird nur geritzt, nie ausgeschnitten
    const mark = o.shape.kind === 'path' && !!o.shape.mark;
    subs.forEach((sp, si) => {
      const c = makeContour(sp, m, {
        idx: out.length, top, leaf: o, sub: si, layer: o.layer, fill, cut: !fill && !engrave.has(o.layer) && !mark,
        kerf: fill ? 0 : L.kerf, beam: L.kerf > 0 ? 2 * L.kerf : inp.settings.beam, text,
      });
      if (c) out.push(c);
    });
  };
  for (const o of inp.objs) walk(o, o, IDENT);
  return out;
}

const withText = (out: CheckIssue[]) => (f: GeomIssue) => {
  const { code, values, ...rest } = f;
  out.push({ ...rest, msg: geomText({ code, values }) });
};

/** Objekte ganz oder teilweise außerhalb des Arbeitsbereichs */
function checkBed(inp: CheckInput, cs: Contour[], out: CheckIssue[]) {
  const { w, h } = inp.bed;
  const tops = new Set(cs.map((c) => c.top));
  for (const top of inp.objs) {
    if ([...outputLeaves([top])].some(([o]) => o.shape.kind === 'image' && inp.layer(o.layer).output)) tops.add(top);
  }
  const eps = 1e-3;
  // Parts parked completely outside the work area are fine: they are not lasered
  const parked = parkedObjs(inp.objs, inp.bed, inp.layer);
  for (const o of inp.objs) {
    if (parked.has(o)) continue;
    if (!tops.has(o) && !(o.shape.kind === 'image' && !selfOutputOff(o) && inp.layer(o.layer).output)) continue;
    const b = boundsOf([o]);
    if (!b) continue;
    if (b.x >= -eps && b.y >= -eps && b.x + b.w <= w + eps && b.y + b.h <= h + eps) continue;
    const away = b.x > w || b.y > h || b.x + b.w < 0 || b.y + b.h < 0;
    const issue: CheckIssue = {
      key: `bed:${o.id}`,
      kind: 'bed',
      level: 'error',
      msg: away ? t('Liegt außerhalb des Arbeitsbereichs.') : t('Ragt über den Arbeitsbereich hinaus.'),
      objs: [o],
      lines: [boxLine(b)],
      pts: [],
    };
    if (b.w <= w && b.h <= h) {
      const dx = Math.min(Math.max(b.x, 0), w - b.w) - b.x,
        dy = Math.min(Math.max(b.y, 0), h - b.h) - b.y;
      issue.fix = { kind: 'bed', objs: [o], dx, dy };
    }
    out.push(issue);
  }
}

/** Beim Import übersprungene Elemente (Hinweis steht am importierten Objekt) */
function checkImport(inp: CheckInput, out: CheckIssue[]) {
  const by = new Map<string, Obj[]>();
  for (const o of inp.objs) if (o.importNote) (by.get(o.importNote) ?? by.set(o.importNote, []).get(o.importNote)!).push(o);
  for (const [note, objs] of by) {
    const b = boundsOf(objs);
    out.push({
      key: `import:${note}`,
      kind: 'import',
      level: 'info',
      msg: t('Einige Elemente der Quelldatei wurden nicht übernommen. {note}', { note }),
      objs,
      lines: b ? [boxLine(b)] : [],
      pts: [],
      fix: { kind: 'note', objs },
    });
  }
}

/**
 * Gravuren, die auf keinem Schnittteil liegen (Issue #326): Sie fehlen in der 3D-Ansicht und würden beim Lasern die
 * Arbeitsfläche treffen. Ein Teil ist eine geschlossene Form auf einem Schnitt-Layer (auch bei ausgeschalteter Ausgabe:
 * so wird eine Platte gezeichnet), es zählt sein Umgebungskasten wie in der 3D-Ansicht. Ohne Teile auf der Seite wird
 * nichts gemeldet: Dann liegt alles auf einem fertigen Gegenstand (Becher, Handyhülle).
 */
function checkLooseEngravings(inp: CheckInput, out: CheckIssue[]) {
  const box = (o: Obj, m: Mat) => {
    const b = boundsOf([o], mul(m, inv(o.m)));
    return b ? { b, r: [b.x, b.y, b.x + b.w, b.y + b.h] } : null;
  };
  const plates: number[][] = [];
  for (const [o, m] of leaves(inp.objs)) {
    const s = o.shape;
    if (!isCutLayer(inp.layer(o.layer)) || s.kind === 'text' || s.kind === 'image') continue;
    if (s.kind === 'path' && (s.mark || !s.subs.some((sp) => sp.closed))) continue;
    const x = box(o, m);
    if (x) plates.push(x.r);
  }
  if (!plates.length) return;
  const parked = parkedObjs(inp.objs, inp.bed, inp.layer);
  for (const top of inp.objs) {
    if (parked.has(top)) continue;
    const lines: Pt[][] = [];
    for (const [o, m] of outputLeaves([top])) {
      const L = inp.layer(o.layer);
      const s = o.shape;
      if (!L.output) continue;
      const mark = s.kind === 'image' || s.kind === 'text' || L.mode === 'fill' || (s.kind === 'path' && (s.mark || s.subs.some((sp) => !sp.closed)));
      if (!mark) continue;
      const x = box(o, m);
      if (!x || plates.some((p) => x.r[0] < p[2] && x.r[2] > p[0] && x.r[1] < p[3] && x.r[3] > p[1])) continue;
      lines.push(boxLine(x.b));
    }
    if (!lines.length) continue;
    out.push({
      key: `engrave:${top.id}`,
      kind: 'engrave',
      level: 'warn',
      msg: t('Diese Gravur liegt auf keinem Teil und würde die Arbeitsfläche treffen.'),
      objs: [top],
      lines,
      pts: [],
    });
  }
}

/** Gescheiterte Bildschnitt-Konturen sind ein harter Befund: der Job würde sonst keine Kontur haben. */
function checkImageCuts(inp: CheckInput, out: CheckIssue[]) {
  const byId = objectsById(inp.objs);
  for (const [o, world] of outputLeaves(inp.objs)) {
    const s = o.shape;
    if (s.kind !== 'image' || !imageCutSettings(inp.layer(o.layer).img).output) continue;
    const path = resolveImageCutPath(o, world, (id) => byId.get(id));
    if (path.ok) continue;
    out.push({ key: `image-cut:${o.id}`, kind: 'image', level: 'error',
      msg: imageCutIssueText(path.reason, s.name ?? t('Bild')), objs: [o], lines: [], pts: [] });
  }
}

const ORDER: Record<CheckLevel, number> = { error: 0, warn: 1, info: 2 };

/** Alle Prüfungen für die Objekte einer Seite; Ergebnis nach Schwere sortiert */
export function checkDesign(inp: CheckInput): CheckIssue[] {
  const out: CheckIssue[] = [];
  for (const top of inp.objs) {
    for (const [o] of leaves([top])) {
      if (o.shape.kind !== 'image' || o.shape.edit === undefined || resolveImageEdits(o.shape).ok) continue;
      out.push({ key: `image:${top.id}:${o.id}`, kind: 'image', level: 'error',
        msg: t('Ungültiger Bildzuschnitt oder ungültige Perspektive. Zuschnitt und Perspektive zurücksetzen oder das Bild ersetzen.'),
        objs: [top], lines: [], pts: [] });
    }
  }
  checkImageCuts(inp, out);
  // Invalid images must be reported before any bounds-dependent checks.
  if (out.length) return out;
  const cs = collect(inp);
  if (!inp.skipBed) checkBed(inp, cs, out);
  const geom: GeomIssue[] = [];
  checkDouble(cs, inp.settings, geom);
  checkOpen(cs, inp.settings, geom);
  checkWebsAndHoles(cs, inp.settings, geom);
  geom.forEach(withText(out));
  checkImport(inp, out);
  checkLooseEngravings(inp, out);
  const fits: FitFinding[] = [];
  checkFits(inp.objs, inp.layer, inp.settings.beam, fits);
  for (const f of fits)
    out.push({
      key: f.key, kind: f.kind, level: f.level, msg: f.msg, objs: f.objs, lines: f.lines, pts: [],
      fix: f.gen ? { kind: 'gen', obj: f.gen.obj, patch: f.gen.patch, calibrated: f.calibrated } : undefined,
    });
  const asm: AsmFinding[] = [];
  checkAssemblies(inp.objs, inp.allObjs ?? inp.objs, inp.layer, asm, inp.pages);
  for (const f of asm) out.push({ key: f.key, kind: f.kind, level: f.level, msg: f.msg, objs: f.objs, lines: f.lines, pts: [] });
  return out.map((x, i) => [x, i] as const).sort((a, b) => ORDER[a[0].level] - ORDER[b[0].level] || a[1] - b[1]).map(([x]) => x);
}

/**
 * Abschnitte [u0, u1] (Pfadparameter) aus einem Unterpfad entfernen; liefert die verbleibenden Stücke als offene
 * Unterpfade (Bézierkurven bleiben erhalten). Bei geschlossenen darf ein Abschnitt über den Anfang laufen (u1 < u0).
 */
export function removeSpans(sp: SubPath, spans: [number, number][]): SubPath[] {
  const n = segments(sp).length;
  if (!n || !spans.length) return [copySub(sp)];
  // Abschnitte über den Anfang aufteilen, sortieren und zusammenfassen
  const list: [number, number][] = [];
  for (const [a, b] of spans) {
    if (sp.closed && b < a) {
      list.push([a, n], [0, b]);
    } else list.push([Math.max(0, a), Math.min(n, b)]);
  }
  list.sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const s of list) {
    const l = merged[merged.length - 1];
    if (l && s[0] <= l[1] + 1e-9) l[1] = Math.max(l[1], s[1]);
    else merged.push([...s]);
  }
  const keep: [number, number][] = [];
  if (sp.closed) {
    if (merged.length === 1 && merged[0][0] <= 1e-9 && merged[0][1] >= n - 1e-9) return [];
    for (let i = 0; i < merged.length; i++) {
      const from = merged[i][1];
      const to = i + 1 < merged.length ? merged[i + 1][0] : merged[0][0] + n;
      if (to - from > 1e-6) keep.push([from, to > n ? to - n : to]);
    }
  } else {
    let at = 0;
    for (const [a, b] of merged) {
      if (a - at > 1e-6) keep.push([at, a]);
      at = b;
    }
    if (n - at > 1e-6) keep.push([at, n]);
  }
  return keep.map(([a, b]) => extract(sp, a, b)).filter((q) => q.nodes.length >= 2);
}
