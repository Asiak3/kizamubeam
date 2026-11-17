// Ruler, protractor and scale dial generator (#308). The outline is cut, ticks and numbers are engraved as open
// lines (part marks) and sit exactly at their nominal positions, so the scale can be used for measuring.
import { circle, definePlugin, mm, roundedRect, strokeText, textWidth, type Issue, type Node, type SubPath } from '../../sdk/ts';

interface P {
  [k: string]: number | string | boolean;
  type: string;
  units: string;
  length: number;
  inches: number;
  sub: string;
  width: number;
  radius: number;
  sweep: number;
  divisions: number;
  minorPer: number;
  startValue: number;
  step: number;
  major: number;
  half: number;
  minor: number;
  numbers: boolean;
  numberSize: number;
  numberEvery: number;
  rotate: boolean;
  labels: string;
  unitText: boolean;
  margin: number;
  corner: number;
  hole: boolean;
  holeDia: number;
}

const line = (x1: number, y1: number, x2: number, y2: number): SubPath => ({ closed: false, nodes: [{ x: x1, y: y1 }, { x: x2, y: y2 }] });
/** Number without trailing zeros (labels are drawn by the plugin, so no locale) */
const num = (v: number) => String(Math.round(v * 1000) / 1000);
const customLabels = (s: string) => s.split(/[,;]/).map((x) => x.trim()).filter((x, i, a) => x || i < a.length - 1);

/**
 * Number height that fits: the widest label may take 85 % of the distance between numbered ticks, so neighbours
 * never run into each other (a protractor numbered every 10° on a small radius)
 */
function fitSize(size: number, texts: string[], gap: number): number {
  const w = Math.max(0, ...texts.map((x) => textWidth(x, size)));
  return w > gap * 0.85 ? (size * gap * 0.85) / w : size;
}

/** Tick list for a scale: position along it (0 … 1) and kind */
interface Tick {
  at: number;
  kind: 'major' | 'half' | 'minor';
  /** Index of the major tick (for its label) */
  n?: number;
}

/** Ticks for `majors` intervals with `per` minor steps each; the middle one is a half tick when per is even */
function ticks(majors: number, per: number): Tick[] {
  const out: Tick[] = [];
  for (let i = 0; i <= majors * per; i++) {
    const at = i / (majors * per);
    if (i % per === 0) out.push({ at, kind: 'major', n: i / per });
    else out.push({ at, kind: per % 2 === 0 && i % per === per / 2 ? 'half' : 'minor' });
  }
  return out;
}

/** Arc of radius r around the origin from angle a0 to a1 (radians, 0 = up, clockwise), as Bézier nodes */
function arc(r: number, a0: number, a1: number): Node[] {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2)));
  const d = (a1 - a0) / n;
  const k = (4 / 3) * Math.tan(d / 4) * r;
  const pt = (a: number) => ({ x: r * Math.sin(a), y: -r * Math.cos(a) });
  const tan = (a: number) => ({ x: Math.cos(a), y: Math.sin(a) });
  const nodes: Node[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + i * d, p = pt(a), t = tan(a);
    const node: Node = { ...p };
    if (i > 0) node.cin = { x: p.x - t.x * k, y: p.y - t.y * k };
    if (i < n) node.cout = { x: p.x + t.x * k, y: p.y + t.y * k };
    nodes.push(node);
  }
  return nodes;
}

definePlugin<P>({
  validate(p) {
    const out: Issue[] = [];
    if (p.type === 'straight') {
      if (p.major >= p.width - 2) out.push({ key: 'major', level: 'error', code: 'ticks-too-long' });
      if (p.hole && p.holeDia + 4 > p.width) out.push({ key: 'holeDia', level: 'error', code: 'hole-too-large', values: { max: p.width - 4 } });
    } else {
      if (p.major >= p.radius * 0.8) out.push({ key: 'major', level: 'error', code: 'ticks-too-long' });
      if (p.hole && p.holeDia / 2 > p.radius - p.major - p.numberSize - 4) out.push({ key: 'holeDia', level: 'error', code: 'hole-too-large', values: { max: Math.max(0, Math.floor(2 * (p.radius - p.major - p.numberSize - 4))) } });
      if (p.sweep <= 180 && p.hole && p.holeDia / 2 > p.margin - 1) out.push({ key: 'holeDia', level: 'error', code: 'hole-too-large', values: { max: Math.max(0, 2 * (p.margin - 1)) } });
      if (p.type === 'dial' && p.minorPer > 1 && (p.radius * (p.sweep * Math.PI) / 180) / (p.divisions * p.minorPer) < 0.4)
        out.push({ key: 'minorPer', level: 'warn', code: 'ticks-dense' });
    }
    if (p.type === 'protractor' && p.sweep % 10 !== 0) out.push({ key: 'sweep', level: 'error', code: 'sweep-tens' });
    if (p.half > p.major || p.minor > p.half) out.push({ key: 'half', level: 'warn', code: 'tick-order' });
    return out;
  },
  generate(p) {
    const marks: SubPath[] = [];
    const subs: SubPath[] = [];
    const info: [string, string][] = [];
    let count = 0;
    let size = p.numberSize;
    const custom = p.labels.trim() ? customLabels(p.labels) : null;
    const tickLen = (k: Tick['kind']) => (k === 'major' ? p.major : k === 'half' ? p.half : p.minor);
    if (p.type === 'straight') {
      const inch = p.units === 'inch';
      const per = inch ? Number(p.sub) : 10;
      const majors = inch ? p.inches : Math.floor(p.length / 10);
      const L = inch ? p.inches * 25.4 : majors * 10;
      const holeRoom = p.hole ? p.holeDia + 6 : 0;
      const W = L + 2 * p.margin + holeRoom;
      const H = p.width;
      const x0 = -W / 2 + p.margin, top = -H / 2;
      subs.push(roundedRect(W, H, p.corner));
      if (p.hole) subs.push(circle(W / 2 - holeRoom / 2 - 1, 0, p.holeDia / 2));
      const labelOf = (n: number) => (custom ? (custom[n / p.numberEvery] ?? '') : num(p.startValue + n * p.step));
      const shown = ticks(majors, per).filter((t) => t.kind === 'major' && t.n! % p.numberEvery === 0).map((t) => labelOf(t.n!));
      size = fitSize(p.numberSize, shown, (L / majors) * p.numberEvery);
      for (const t of ticks(majors, per)) {
        // Inch rulers: quarter and eighth marks between half and minor length
        let len = tickLen(t.kind);
        if (inch && t.kind === 'minor') {
          const i = Math.round(t.at * majors * per) % per;
          const den = per / gcd(i, per);
          len = den <= 4 ? (p.half + p.minor) / 2 : den <= 8 ? p.minor : p.minor * 0.7;
        }
        const x = x0 + t.at * L;
        marks.push(line(x, top, x, top + len));
        count++;
        if (p.numbers && t.kind === 'major' && t.n! % p.numberEvery === 0) {
          const text = labelOf(t.n!);
          if (text) marks.push(...strokeText(text, size, { x, y: top + p.major + 1.5, align: 'center', valign: 'top' }));
        }
      }
      if (p.unitText) marks.push(...strokeText(inch ? 'IN' : 'CM', p.numberSize * 0.8, { x: x0, y: H / 2 - 2, align: 'left' }));
      info.push(['scale-length', `${mm(L)} mm`], ['size', `${mm(W)} × ${mm(H)} mm`]);
    } else {
      const R = p.radius;
      const sweep = (p.sweep * Math.PI) / 180;
      const full = p.sweep >= 360;
      const a0 = full ? 0 : -sweep / 2;
      const span = full ? 2 * Math.PI : sweep;
      const protractor = p.type === 'protractor';
      const majors = protractor ? Math.max(1, Math.round(p.sweep / 10)) : p.divisions;
      const per = protractor ? 10 : p.minorPer;
      const outer = R + p.margin;
      // Outline: up to 180° the arc with a straight base below the centre, beyond that a disc
      if (p.sweep > 180) subs.push(circle(0, 0, outer));
      else {
        const nodes = arc(outer, a0, a0 + span);
        const first = nodes[0], last = nodes[nodes.length - 1];
        const base = Math.max(first.y, 0) + p.margin;
        nodes.push({ x: last.x, y: base }, { x: first.x, y: base });
        subs.push({ closed: true, nodes });
      }
      if (p.hole) subs.push(circle(0, 0, p.holeDia / 2));
      const list = ticks(majors, per);
      const labelOf = (n: number) => (custom ? (custom[n / p.numberEvery] ?? '') : protractor ? num(n * 10) : num(p.startValue + n * p.step));
      const shown = list.filter((t) => t.kind === 'major' && t.n! % p.numberEvery === 0 && !(full && t.at === 1)).map((t) => labelOf(t.n!));
      const rl = R - p.major - 1.5 - p.numberSize / 2;
      size = p.rotate ? fitSize(p.numberSize, shown, rl * (span / majors) * p.numberEvery) : fitSize(p.numberSize, shown, rl * (span / majors) * p.numberEvery * 0.8);
      for (const t of list) {
        if (full && t.at === 1) continue;
        count++;
        const a = a0 + t.at * span;
        const len = tickLen(t.kind);
        const s = Math.sin(a), c = -Math.cos(a);
        marks.push(line(R * s, R * c, (R - len) * s, (R - len) * c));
        if (p.numbers && t.kind === 'major' && t.n! % p.numberEvery === 0) {
          const text = labelOf(t.n!);
          if (!text) continue;
          const r = R - p.major - 1.5 - size / 2;
          marks.push(...strokeText(text, size, { x: r * s, y: r * c, align: 'center', valign: 'middle', angle: p.rotate ? (a * 180) / Math.PI : 0 }));
        }
      }
      info.push(['size', `⌀ ${mm(2 * outer)} mm`], ['step', protractor ? '1°' : `${mm(p.sweep / (majors * per))}°`]);
    }
    info.push(['ticks', String(count)]);
    if (p.numbers && size < p.numberSize - 1e-9) info.push(['number-height', `${mm(size)} mm`]);
    return { parts: [{ key: p.type, subs, marks, at: { x: 0, y: 0 } }], info };
  },
});

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a || 1;
}
