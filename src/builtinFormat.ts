// Mitgelieferte Bibliothek: Gruppen und kompakte Pfaddaten (ohne Abhängigkeit von der Oberfläche, damit
// scripts/build-library.ts es in Node nutzen kann). Laden und Einträge: builtinLibrary.ts.
import type { Node, SubPath } from './model';

/** Gruppen der mitgelieferten Einträge; der Name der Gruppe ist zugleich Stichwort */
export const GROUPS: Record<string, { de: string; en: string }> = {
  animals: { de: 'Tiere', en: 'Animals' },
  birds: { de: 'Vögel', en: 'Birds' },
  sea: { de: 'Meer', en: 'Sea' },
  insects: { de: 'Insekten', en: 'Insects' },
  plants: { de: 'Pflanzen', en: 'Plants' },
  food: { de: 'Essen & Trinken', en: 'Food & drink' },
  holidays: { de: 'Feste', en: 'Holidays' },
  nature: { de: 'Natur & Wetter', en: 'Nature & weather' },
  vehicles: { de: 'Fahrzeuge', en: 'Vehicles' },
  home: { de: 'Haus & Alltag', en: 'Home & everyday' },
  tools: { de: 'Werkzeug', en: 'Tools' },
  leisure: { de: 'Musik & Freizeit', en: 'Music & leisure' },
  symbols: { de: 'Symbole', en: 'Symbols' },
  zodiac: { de: 'Sternzeichen', en: 'Zodiac' },
  space: { de: 'Weltraum', en: 'Space' },
  frames: { de: 'Rahmen', en: 'Frames' },
  borders: { de: 'Bordüren', en: 'Borders' },
  corners: { de: 'Ecken', en: 'Corners' },
  dividers: { de: 'Trenner', en: 'Dividers' },
  ornaments: { de: 'Ornamente', en: 'Ornaments' },
  mandalas: { de: 'Rosetten', en: 'Rosettes' },
  badges: { de: 'Abzeichen', en: 'Badges' },
  banners: { de: 'Banner & Schilder', en: 'Banners & labels' },
  patterns: { de: 'Muster', en: 'Patterns' },
  fillpatterns: { de: 'Füllmuster', en: 'Fill patterns' },
  shapes: { de: 'Formen', en: 'Shapes' },
};

// ---------- Pfaddaten ----------

export const f = (v: number) => {
  const s = (Math.round(v * 100) / 100).toString();
  return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s;
};
/** Zahlen so knapp wie in SVG erlaubt: kein Trenner vor „-“ und vor „.“, wenn die Zahl davor schon einen Punkt hat */
function nums(v: number[], prev = ''): string {
  let out = '';
  let last = prev;
  for (const x of v) {
    const s = f(x);
    const sep = last && !s.startsWith('-') && !(s.startsWith('.') && last.includes('.')) ? ' ' : '';
    out += sep + s;
    last = s;
  }
  return out;
}

/**
 * Unterpfade als SVG-Pfaddaten: Anfang absolut (M), dann relativ (l, c), Z schließt; Koordinaten auf 0,01 mm
 * gerundet, Abstände aus den gerundeten Punkten, damit sich keine Fehler aufsummieren.
 */
export function encodeSubs(subs: SubPath[]): string {
  const q = (v: number) => Math.round(v * 100);
  let d = '';
  for (const sp of subs) {
    let n = sp.nodes;
    if (!n.length) continue;
    // Geschlossener Pfad, dessen letzter Knoten auf dem ersten liegt: zusammenlegen (wie decodeD)
    const z = n[n.length - 1];
    if (sp.closed && n.length > 2 && q(z.x) === q(n[0].x) && q(z.y) === q(n[0].y)) n = [{ ...n[0], ...(z.cin ? { cin: z.cin } : {}) }, ...n.slice(1, -1)];
    let cx = q(n[0].x),
      cy = q(n[0].y);
    d += 'M' + nums([cx / 100, cy / 100]);
    const last = sp.closed ? n.length : n.length - 1;
    let prev = '';
    let lastTok = '';
    for (let i = 0; i < last; i++) {
      const a = n[i],
        b = n[(i + 1) % n.length];
      if (sp.closed && i === n.length - 1 && !a.cout && !b.cin) break; // letzte Gerade schließt Z
      const cmd = a.cout || b.cin ? 'c' : 'l';
      const bx = q(b.x),
        by = q(b.y);
      const v =
        cmd === 'c'
          ? [q((a.cout ?? a).x) - cx, q((a.cout ?? a).y) - cy, q((b.cin ?? b).x) - cx, q((b.cin ?? b).y) - cy, bx - cx, by - cy]
          : [bx - cx, by - cy];
      const vs = v.map((x) => x / 100);
      const body = cmd === prev ? nums(vs, lastTok) : cmd + nums(vs);
      d += body;
      lastTok = f(vs[vs.length - 1]);
      prev = cmd;
      cx = bx;
      cy = by;
    }
    if (sp.closed) d += 'Z';
  }
  return d;
}

/** Pfaddaten aus encodeSubs zurück in Unterpfade (M, L, C absolut; m, l, c relativ; Z) */
export function decodeD(d: string): SubPath[] {
  const tokens = d.match(/[MLCZmlcz]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const subs: SubPath[] = [];
  let cur: SubPath | null = null;
  let cmd = '';
  let i = 0;
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  const num = () => parseFloat(tokens[i++]);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  while (i < tokens.length) {
    const tk = tokens[i];
    if (/[a-zA-Z]/.test(tk)) {
      cmd = tk;
      i++;
      if ((cmd === 'Z' || cmd === 'z') && cur) {
        cur.closed = true;
        // Schließt eine Kurve auf den Startpunkt: letzten Knoten mit dem ersten zusammenlegen
        const ns = cur.nodes;
        if (ns.length > 1) {
          const a = ns[0],
            b = ns[ns.length - 1];
          if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6) {
            if (b.cin) a.cin = b.cin;
            ns.pop();
          }
        }
        cur = null;
        x = sx;
        y = sy;
      }
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0,
      oy = rel ? y : 0;
    if (cmd === 'M' || cmd === 'm') {
      x = r2(ox + num());
      y = r2(oy + num());
      sx = x;
      sy = y;
      cur = { nodes: [{ x, y }], closed: false };
      subs.push(cur);
      cmd = rel ? 'l' : 'L';
    } else if ((cmd === 'L' || cmd === 'l') && cur) {
      x = r2(ox + num());
      y = r2(oy + num());
      cur.nodes.push({ x, y });
    } else if ((cmd === 'C' || cmd === 'c') && cur) {
      const c1 = { x: r2(ox + num()), y: r2(oy + num()) },
        c2 = { x: r2(ox + num()), y: r2(oy + num()) };
      x = r2(ox + num());
      y = r2(oy + num());
      const p: Node = { x, y, cin: c2 };
      cur.nodes[cur.nodes.length - 1].cout = c1;
      cur.nodes.push(p);
    } else i++;
  }
  return subs;
}
