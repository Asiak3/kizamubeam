// Schriftdateien laden und Text in Bézierpfade umwandeln.
// Desktop: Systemschriften über Rust (fontdb). Browser: lokale Schriften (falls erlaubt), sonst Roboto als Ersatz.
import opentype from 'opentype.js';
import { Node, SubPath, TextShape } from './model';
import { PlacedGlyph, placeOnPath } from './textpath';
import { weldGlyphs } from './clip';
import { shownText } from './vartext';
import roboto400 from '@fontsource/roboto/files/roboto-latin-400-normal.woff?inline';
import roboto700 from '@fontsource/roboto/files/roboto-latin-700-normal.woff?inline';
import roboto400i from '@fontsource/roboto/files/roboto-latin-400-italic.woff?inline';
import roboto700i from '@fontsource/roboto/files/roboto-latin-700-italic.woff?inline';

const isTauri = () => '__TAURI_INTERNALS__' in window;

export interface LoadedFont {
  font: opentype.Font;
  /** true, wenn die gewünschte Schrift fehlte und Roboto eingesprungen ist */
  fallback: boolean;
}

const cache = new Map<string, Promise<LoadedFont>>();
/** Bereits geladene Schriften für synchronen Zugriff beim Zeichnen */
const ready = new Map<string, LoadedFont>();
const fontKey = (family: string, bold: boolean, italic: boolean) => `${family}|${bold}|${italic}`;

/** Schrift, falls schon geladen; sonst null (und das Laden beginnt). */
export function loadedFont(family: string, bold: boolean, italic: boolean): LoadedFont | null {
  const f = ready.get(fontKey(family, bold, italic));
  if (!f) void loadFont(family, bold, italic);
  return f ?? null;
}

function dataUrlToBuffer(url: string): ArrayBuffer {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function fallbackFont(bold: boolean, italic: boolean): Promise<opentype.Font> {
  const url = bold ? (italic ? roboto700i : roboto700) : italic ? roboto400i : roboto400;
  // Im fertigen Build eingebettet (data:), im Entwicklungsserver eine normale URL
  const buf = url.startsWith('data:') ? dataUrlToBuffer(url) : await (await fetch(url)).arrayBuffer();
  return opentype.parse(buf);
}

interface LocalFontData {
  family: string;
  style: string;
  blob(): Promise<Blob>;
}

async function browserLocalFont(family: string, bold: boolean, italic: boolean): Promise<ArrayBuffer | null> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
  if (!q) return null;
  try {
    // Nur nutzen, wenn der Zugriff schon erlaubt ist; sonst würde eine Rückfrage den Vorgang blockieren
    const perm = await navigator.permissions.query({ name: 'local-fonts' as PermissionName });
    if (perm.state !== 'granted') return null;
    const faces = (await q()).filter((f) => f.family.toLowerCase() === family.toLowerCase());
    if (!faces.length) return null;
    const want = (bold ? 'bold' : '') + (italic ? 'italic' : '');
    const norm = (s: string) => s.toLowerCase().replace(/regular|normal|oblique|\s/g, (m) => (m === 'oblique' ? 'italic' : ''));
    const face = faces.find((f) => norm(f.style) === want) ?? faces.find((f) => norm(f.style) === '') ?? faces[0];
    return await (await face.blob()).arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Zugriff auf die lokal installierten Schriften des Browsers anfordern (Local Font Access API, Chromium).
 * Muss aus einer Nutzer-Geste heraus aufgerufen werden (Klick/Change), sonst blockiert der Browser die
 * Berechtigungs-Rückfrage. Ergebnis: true = Zugriff steht (bereits erteilt oder gerade erteilt), danach
 * lädt `loadFont` echte Schrift-Binaries statt des Roboto-Fallbacks. false = keine API, abgelehnt oder
 * abgebrochen — dann bleibt der Fallback, es wird nicht erneut gefragt (außer der Stand ist noch „prompt“).
 * Desktop (Tauri) braucht das nicht: dort kommen Systemschriften über Rust (fontdb).
 */
export async function requestLocalFonts(): Promise<boolean> {
  if (isTauri()) return true;
  const w = window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> };
  if (!w.queryLocalFonts) return false;
  try {
    const perm = await navigator.permissions.query({ name: 'local-fonts' as PermissionName });
    if (perm.state === 'granted') return true;
    if (perm.state === 'denied') return false;
  } catch {
    // Permissions-API kennt „local-fonts“ nicht (oder fehlt) → direkt versuchen, löst ggf. die Rückfrage aus.
  }
  try {
    await w.queryLocalFonts();
    return true;
  } catch {
    return false;
  }
}

export function loadFont(family: string, bold: boolean, italic: boolean): Promise<LoadedFont> {
  const key = fontKey(family, bold, italic);
  let p = cache.get(key);
  if (!p) {
    p = (async (): Promise<LoadedFont> => {
      let buf: ArrayBuffer | null = null;
      if (isTauri()) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          buf = await invoke<ArrayBuffer>('font_data', { family, bold, italic });
        } catch {
          buf = null;
        }
      } else buf = await browserLocalFont(family, bold, italic);
      if (buf) {
        try {
          return { font: opentype.parse(buf), fallback: false };
        } catch {
          /* z. B. nicht unterstütztes Format */
        }
      }
      return { font: await fallbackFont(bold, italic), fallback: true };
    })().then((f) => {
      ready.set(key, f);
      fontListeners.forEach((cb) => cb());
      return f;
    });
    cache.set(key, p);
  }
  return p;
}

/** A font file sent along with a remote job (family and style as used in the project) */
export interface FontFile {
  family: string;
  bold: boolean;
  italic: boolean;
  buf: ArrayBuffer;
}

/**
 * Run fn with these font files in place of the installed ones (remote jobs compute with the sender's fonts).
 * Afterwards the previous fonts are back and cached text outlines are rebuilt.
 */
export async function withFonts<T>(files: FontFile[], fn: () => Promise<T>): Promise<T> {
  const saved = new Map<string, [Promise<LoadedFont> | undefined, LoadedFont | undefined]>();
  for (const f of files) {
    let font: opentype.Font;
    try {
      font = opentype.parse(f.buf);
    } catch {
      continue;
    }
    const key = fontKey(f.family, f.bold, f.italic);
    if (!saved.has(key)) saved.set(key, [cache.get(key), ready.get(key)]);
    const lf: LoadedFont = { font, fallback: false };
    cache.set(key, Promise.resolve(lf));
    ready.set(key, lf);
  }
  if (saved.size) fontListeners.forEach((cb) => cb());
  try {
    return await fn();
  } finally {
    for (const [key, [c, r]] of saved) {
      if (c) cache.set(key, c);
      else cache.delete(key);
      if (r) ready.set(key, r);
      else ready.delete(key);
    }
    if (saved.size) fontListeners.forEach((cb) => cb());
  }
}

const fontListeners: (() => void)[] = [];
/** Wird aufgerufen, sobald eine weitere Schrift geladen ist */
export function onFontLoaded(cb: () => void) {
  fontListeners.push(cb);
}

/** Liste der installierten Schriften (nur Desktop), sonst null. Enthält auch die im Font-Manager geladenen. */
export async function systemFonts(): Promise<string[] | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string[]>('list_fonts');
  } catch {
    return null;
  }
}

const listListeners: (() => void)[] = [];
/** Wird aufgerufen, wenn Schriften dazukommen oder entfernt werden (Font-Manager) */
export function onFontListChanged(cb: () => void) {
  listListeners.push(cb);
}

/**
 * Nach Installieren oder Entfernen: Schriften, für die Roboto eingesprungen ist (oder die genannten Familien),
 * neu laden. Texte werden danach mit der richtigen Schrift gezeichnet; Schriftlisten erneuern sich.
 */
export function refreshFonts(families: string[] = []) {
  const names = new Set(families.map((f) => f.toLowerCase()));
  for (const key of [...cache.keys()]) {
    const r = ready.get(key);
    if ((r && r.fallback) || names.has(key.split('|')[0].toLowerCase())) {
      cache.delete(key);
      ready.delete(key);
    }
  }
  fontListeners.forEach((cb) => cb());
  listListeners.forEach((cb) => cb());
}

/** Wurde für diese Schrift Roboto als Ersatz genommen? (null = noch nicht geladen) */
export function isFallbackFont(family: string, bold = false, italic = false): boolean | null {
  const f = ready.get(fontKey(family, bold, italic));
  return f ? f.fallback : null;
}

/** Desktop-App? Nur dort gibt es den Font-Manager mit eigenem Schriftordner. */
export const hasFontManager = isTauri;

/**
 * Text in Unterpfade umwandeln (lokale Koordinaten des Textobjekts, mm).
 * Gleiche Anordnung wie die Anzeige: Grundlinie der ersten Zeile bei y = 0, Zeilenhöhe 1,2 × Größe + Zeilenabstand.
 */
export function textToSubs(t: TextShape, font: opentype.Font): SubPath[] {
  return textGlyphSubs(t, font).flat();
}

/** Wie textToSubs, aber je Glyphe eine eigene Liste (bei geschweißtem Text eine einzige). */
export function textGlyphSubs(t: TextShape, font: opentype.Font): SubPath[][] {
  t = fitText(t, font);
  const scale = t.size / font.unitsPerEm;
  const glyphs: PlacedGlyph[] = [];
  for (const ln of textLines(t, font))
    ln.glyphs.forEach((g, i) => {
      const subs = commandsToSubs(g.getPath(ln.xs[i], ln.y, t.size).commands);
      // Gestauchte Zeile (Höchstbreite): Glyphe um ihren Anfang waagerecht zusammenschieben
      if (ln.sx !== 1) for (const sp of subs) for (const n of sp.nodes) squeezeNode(n, ln.xs[i], ln.sx);
      if (subs.length) glyphs.push({ subs, cx: ln.xs[i] + ((g.advanceWidth ?? 0) * scale * ln.sx) / 2, y: ln.y });
    });
  // Text auf Pfad: jede Glyphe für sich auf die Kurve setzen
  const placed = t.path && t.path.sub.nodes.length > 1 ? placeOnPath(glyphs, t.path, t.align) : glyphs.map((g) => g.subs);
  return t.weld ? [weldGlyphs(placed)] : placed;
}

function squeezeNode(n: Node, x0: number, sx: number) {
  n.x = x0 + (n.x - x0) * sx;
  if (n.cin) n.cin.x = x0 + (n.cin.x - x0) * sx;
  if (n.cout) n.cout.x = x0 + (n.cout.x - x0) * sx;
}

/**
 * Zeilen mit Glyphen und deren x-Positionen (mm); x/w ist die Zeilenbreite nach Vorschub.
 * sx < 1: Die Zeile ist breiter als die Höchstbreite und wird um diesen Faktor gestaucht.
 */
export function textLines(t: TextShape, font: opentype.Font) {
  return linesOf(fitText(t, font), font);
}

/**
 * Text in Rahmen einpassen: Ist der Block höher als maxH oder (bei fit = shrink) breiter als maxW, wird er mit
 * Schriftgröße und Abständen gleichmäßig verkleinert (nie vergrößert). Sonst bleibt der Text, wie er ist.
 */
export function fitText(t: TextShape, font: opentype.Font): TextShape {
  const byW = t.fit === 'shrink' && !!t.maxW && t.maxW > 0;
  const byH = !!t.maxH && t.maxH > 0;
  if (!byW && !byH) return t;
  // Textrahmen: Höhe der umbrochenen Zeilen zählt; kleiner gesetzt passen eher mehr Wörter in eine Zeile
  const lines = linesOf(wrapWidth(t) ? t : { ...t, maxW: undefined }, font);
  const w = Math.max(0, ...lines.map((l) => l.w));
  const h = (lines.length - 1) * (t.size * 1.2 + t.vSpace) + t.size;
  const f = Math.min(1, byW && w > 0 ? t.maxW! / w : 1, byH && h > 0 ? t.maxH! / h : 1);
  if (f >= 1 && !byW) return t;
  const out: TextShape = { ...t, size: t.size * f, hSpace: t.hSpace * f, vSpace: t.vSpace * f };
  // Verkleinert passt die Breite schon; ein Rest durch Rundung wird nicht mehr gestaucht
  if (byW) delete out.maxW;
  return out;
}

/** Breite des Textrahmens in mm, wenn der Text automatisch umbricht (fit = wrap), sonst 0 */
export function wrapWidth(t: TextShape): number {
  return t.fit === 'wrap' && t.maxW && t.maxW > 0 ? t.maxW : 0;
}

/**
 * Einen Absatz an Wortgrenzen in Zeilen umbrechen, die höchstens maxW breit sind (width misst eine Zeile in mm).
 * Ein Wort, das allein zu breit ist, wird zwischen den Buchstaben getrennt. Leerzeichen am Umbruch entfallen.
 */
export function wrapParagraph(text: string, maxW: number, width: (s: string) => number): string[] {
  const out: string[] = [];
  let cur = '';
  let gap = '';
  for (const tok of text.split(/( +)/)) {
    if (!tok) continue;
    if (tok[0] === ' ') {
      if (cur) gap += tok;
      else cur = tok; // Einrückung am Absatzanfang bleibt
      continue;
    }
    const cand = cur + gap + tok;
    gap = '';
    if (!cur.trim() || width(cand) <= maxW) cur = cand;
    else {
      out.push(cur);
      cur = tok;
    }
    // Zu langes Wort: vorne so viele Zeichen abtrennen, wie in eine Zeile passen
    while (width(cur) > maxW && [...cur].length > 1) {
      const chars = [...cur];
      let n = 1;
      while (n < chars.length - 1 && width(chars.slice(0, n + 1).join('')) <= maxW) n++;
      out.push(chars.slice(0, n).join(''));
      cur = chars.slice(n).join('');
    }
  }
  out.push(cur);
  return out;
}

function linesOf(t: TextShape, font: opentype.Font) {
  const size = t.size;
  const scale = size / font.unitsPerEm;
  const lh = size * 1.2 + t.vSpace;
  const text = shownText(t);
  const advancesOf = (glyphs: opentype.Glyph[]) =>
    glyphs.map((g, i) => {
      const kern = i < glyphs.length - 1 ? font.getKerningValue(g, glyphs[i + 1]) : 0;
      return ((g.advanceWidth ?? 0) + kern) * scale + (i < glyphs.length - 1 ? t.hSpace : 0);
    });
  const paras = (t.upper ? text.toUpperCase() : text).split('\n');
  const ww = wrapWidth(t);
  const width = (s: string) => advancesOf(font.stringToGlyphs(s)).reduce((a, b) => a + b, 0);
  const lines = ww ? paras.flatMap((p) => wrapParagraph(p, ww, width)) : paras;
  return lines.map((line, li) => {
    const glyphs = font.stringToGlyphs(line);
    let advances = advancesOf(glyphs);
    let w = advances.reduce((a, b) => a + b, 0);
    const sx = t.maxW && t.maxW > 0 && w > t.maxW ? t.maxW / w : 1;
    if (sx !== 1) {
      advances = advances.map((a) => a * sx);
      w = t.maxW!;
    }
    let x = t.align === 'left' ? 0 : t.align === 'center' ? -w / 2 : -w;
    const x0 = x;
    const xs = advances.map((adv) => {
      const cur = x;
      x += adv;
      return cur;
    });
    return { text: line, glyphs, xs, x: x0, w, y: li * lh, sx };
  });
}

function commandsToSubs(cmds: opentype.PathCommand[]): SubPath[] {
  const subs: SubPath[] = [];
  let cur: Node[] | null = null;
  let last = { x: 0, y: 0 };
  const close = (closed: boolean) => {
    if (!cur || cur.length < 2) {
      cur = null;
      return;
    }
    // Endpunkt, der auf dem Startpunkt liegt, mit dem Startknoten verschmelzen
    const a = cur[0],
      b = cur[cur.length - 1];
    if (closed && Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) {
      if (b.cin) a.cin = b.cin;
      cur.pop();
    }
    subs.push({ nodes: cur, closed });
    cur = null;
  };
  for (const c of cmds) {
    switch (c.type) {
      case 'M':
        close(false);
        cur = [{ x: c.x, y: c.y }];
        last = { x: c.x, y: c.y };
        break;
      case 'L':
        cur?.push({ x: c.x, y: c.y });
        last = { x: c.x, y: c.y };
        break;
      case 'Q': {
        if (!cur) break;
        const p0 = last;
        const prev = cur[cur.length - 1];
        prev.cout = { x: p0.x + (2 / 3) * (c.x1 - p0.x), y: p0.y + (2 / 3) * (c.y1 - p0.y) };
        cur.push({ x: c.x, y: c.y, cin: { x: c.x + (2 / 3) * (c.x1 - c.x), y: c.y + (2 / 3) * (c.y1 - c.y) } });
        last = { x: c.x, y: c.y };
        break;
      }
      case 'C': {
        if (!cur) break;
        cur[cur.length - 1].cout = { x: c.x1, y: c.y1 };
        cur.push({ x: c.x, y: c.y, cin: { x: c.x2, y: c.y2 } });
        last = { x: c.x, y: c.y };
        break;
      }
      case 'Z':
        close(true);
        break;
    }
  }
  close(false);
  return subs;
}
