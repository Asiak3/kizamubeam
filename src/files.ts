// Dateien öffnen/speichern: in Tauri über native Dialoge, im Browser per Download/Dateiauswahl.
import type { Editor } from './editor';
import { parseMeshFile } from './model3d/mesh';
import { addMesh } from './model3d/store';
import { askModelKind, openGenDialog } from './generators/dialog';
import { IDENT, Mat, mul, Obj, pageName, TextShape, visibleLeaves, PALETTE } from './model';
import { boundsOf, subsToD, shapeSubs, textLayout, textOutline } from './geom';
import { assetImage, assetUrl, flipImageV, hashId, processedPng, readDpi, registerAsset } from './images';
import { convertLbrn, finishLbrnTexts, isLbrn, LbrnResult, TextMeasure } from './lbrn';
import { loadFont, textToSubs } from './fonts';
import { importDxf, importSvg, ImportResult, PathBuilder, transformSubs } from './importers';
import { buildDxf, buildPdf, ExportItem, ExportPage, LayerInfo } from './vecexport';
import { FallbackResolver, importPdfPages, isPdf } from './pdfimport';
import { t, tn } from './i18n';
import { tabNameFromPath } from './editor/tabs';

const isTauri = () => '__TAURI_INTERNALS__' in window;

/** Textdatei speichern; false, wenn der Dialog abgebrochen wurde */
export async function saveText(name: string, filterName: string, ext: string, mime: string, contents: string): Promise<boolean> {
  return (await saveTextAs(name, filterName, ext, mime, contents)) !== null;
}

/** Textdatei speichern; liefert den gewählten Pfad (im Browser den Dateinamen) oder null bei Abbruch */
async function saveTextAs(name: string, filterName: string, ext: string, mime: string, contents: string): Promise<string | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string | null>('save_text_file', { defaultName: name, filterName, extensions: [ext], contents });
  }
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

/** Textdatei wählen und lesen; liefert [Dateiname, Inhalt] oder null */
export async function openText(filterName: string, extensions: string[]): Promise<[string, string] | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const res = await invoke<[string, string] | null>('open_text_file', { filterName, extensions });
    return res ? [res[0].split(/[\\/]/).pop() ?? res[0], res[1]] : null;
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = extensions.map((e) => '.' + e).join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? [f.name, await f.text()] : null);
    };
    input.click();
  });
}

/** Projekt des aktiven Tabs speichern; der Tab übernimmt den Dateinamen */
export async function saveProject(ed: Editor) {
  const tab = ed.tab;
  const contents = ed.serialize();
  const saved = ed.tabKey();
  const path = await saveTextAs(`${tab.name ?? t('projekt')}.kzb`, t('KizamuBeam-Projekt'), 'kzb', 'application/json', contents);
  if (path === null) return;
  // Während des Dialogs kann ein anderer Tab aktiv geworden sein
  tab.name = tabNameFromPath(path);
  tab.saved = saved;
  if (tab === ed.tab) ed.updateChanged();
  else tab.changed = false;
  ed.onTabsChange?.();
  ed.scheduleSave();
}

/** Text mit der echten Schrift messen (für bearbeitbaren Text aus LightBurn-Projekten) */
async function measureText(t: TextShape): Promise<TextMeasure> {
  const lf = await loadFont(t.font, t.bold, t.italic);
  const f = lf.font;
  const hhea = (f.tables as { hhea?: { ascender: number; descender: number; lineGap: number } }).hhea;
  const units = hhea ? hhea.ascender - hhea.descender + hhea.lineGap : f.ascender - f.descender;
  return { subs: textToSubs(t, f), lineHeight: (units / f.unitsPerEm) * t.size, fallback: lf.fallback };
}

/** Aus LightBurn-Projekt (.lbrn2) ein KizamuBeam-Projekt (JSON) machen; Hinweise für die Statusleiste */
async function lbrnProjectJson(ed: Editor, text: string): Promise<{ json: string; notes: string[] }> {
  const bed = { ...ed.doc.bed };
  const r = await convertLbrn(text, { bedH: bed.h, assetId: hashId, flipImage: flipImageV });
  await finishLbrnTexts(r, measureText);
  if (r.notes.length) for (const o of r.objs) o.importNote = r.notes.join(' ');
  const doc: Record<string, unknown> = { version: 2, bed, pages: [{ name: pageName(0), objs: r.objs }], page: 0, layers: r.layers, assets: r.assets };
  if (r.projectNotes) doc.notes = { process: r.projectNotes };
  if (r.vt) doc.vt = r.vt;
  return { json: JSON.stringify(doc), notes: r.notes };
}

const isLbrnName = (name: string) => /\.lbrn2?$/i.test(name);

/** Projektdatei in einem neuen Tab öffnen (oder im aktiven, wenn er leer ist); LightBurn-Projekte werden übersetzt */
export async function openProject(ed: Editor) {
  const apply = async (text: string, name: string) => {
    try {
      if (isLbrnName(name) || isLbrn(text)) {
        const { json, notes } = await lbrnProjectJson(ed, text);
        ed.openInTab(json, tabNameFromPath(name));
        // Erst als KizamuBeam-Projekt gespeichert gilt die Datei als gesichert
        ed.tab.saved = '';
        ed.updateChanged();
        ed.hint = [t('LightBurn-Projekt geöffnet.'), ...notes].join(' ');
        ed.emit('tool');
        return;
      }
      ed.openInTab(text, tabNameFromPath(name));
      // Fehlende Schriften von Google Fonts nachladen (mit Rückfrage)
      void import('./fontManager').then((m) => m.checkProjectFonts(ed));
    } catch (e) {
      alert(t('Datei konnte nicht geöffnet werden: {message}', { message: (e as Error).message }));
    }
  };
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const res = await invoke<[string, string] | null>('open_text_file', { filterName: t('KizamuBeam- und LightBurn-Projekte'), extensions: ['kzb', 'kzt', 'lwk', 'json', 'lbrn2', 'lbrn'] });
    if (res) await apply(res[1], res[0]);
    return;
  }
  const input = document.getElementById('fileinput') as HTMLInputElement;
  input.onchange = async () => {
    const f = input.files?.[0];
    input.value = '';
    if (f) await apply(await f.text(), f.name);
  };
  input.click();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * SVG der aktuellen Seite. preview: kleine Vorschau (z. B. für Vorlagen) nur um die Objekte herum, Linien
 * unabhängig von der Größe sichtbar, große Bilder als graue Fläche.
 */
export function buildSvg(ed: Editor, opts: { preview?: boolean } = {}): string {
  const { w, h } = ed.doc.bed;
  const style = (i: number) => {
    const L = ed.layer(i);
    return { show: L.show, fill: L.mode === 'fill' };
  };
  if (opts.preview) return objsPreviewSvg(ed.doc.objs, style);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="0 0 ${w} ${h}">\n` +
    objsSvgParts(ed.doc.objs, style, false).parts.join('\n') +
    `\n</svg>\n`
  );
}

type LayerStyle = (layer: number) => { show: boolean; fill: boolean };

/**
 * Kleine SVG-Vorschau nur um die Objekte herum (Vorlagen, Bibliothek). thumbs: verkleinerte Bilder nach
 * Asset-ID; große Bilder ohne verkleinerte Fassung erscheinen als graue Fläche.
 */
export function objsPreviewSvg(objs: Obj[], style: LayerStyle, thumbs: Record<string, string> = {}): string {
  const { parts, box } = objsSvgParts(objs, style, true, thumbs);
  if (!isFinite(box.x0)) return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
  const pad = Math.max(box.x1 - box.x0, box.y1 - box.y0) * 0.04 + 0.5;
  const vb = [box.x0 - pad, box.y0 - pad, box.x1 - box.x0 + 2 * pad, box.y1 - box.y0 + 2 * pad].map((v) => +v.toFixed(2));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}">${parts.join('')}</svg>`;
}

function objsSvgParts(objs: Obj[], style: LayerStyle, preview: boolean, thumbs: Record<string, string> = {}) {
  const parts: string[] = [];
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const sw = preview ? 'stroke-width="1" vector-effect="non-scaling-stroke"' : 'stroke-width="0.1"';
  for (const [o, m] of visibleLeaves(objs)) {
    const L = style(o.layer);
    if (!L.show) continue;
    if (preview) {
      // m enthält schon die Lage des Objekts
      const b = boundsOf([{ ...o, m: IDENT }], m);
      if (b) {
        box.x0 = Math.min(box.x0, b.x);
        box.y0 = Math.min(box.y0, b.y);
        box.x1 = Math.max(box.x1, b.x + b.w);
        box.y1 = Math.max(box.y1, b.y + b.h);
      }
    }
    const color = PALETTE[o.layer];
    const fill = L.fill ? color : 'none';
    if (o.shape.kind === 'image') {
      const url = thumbs[o.shape.asset] ?? assetUrl(o.shape.asset);
      const tf = `transform="matrix(${m.join(' ')})" width="${o.shape.w}" height="${o.shape.h}"`;
      if (url && preview && url.length > 150_000) parts.push(`<rect ${tf} fill="#bbb"/>`);
      else if (url) parts.push(`<image ${tf} preserveAspectRatio="none" href="${url}"/>`);
      continue;
    }
    if (o.shape.kind === 'text') {
      const t = o.shape;
      const ol = textOutline(t);
      if (ol) {
        parts.push(`<path d="${subsToD(ol.subs, m)}" fill="${fill}" fill-rule="evenodd" stroke="${color}" ${sw}/>`);
        continue;
      }
      const lay = textLayout(t);
      const anchor = t.align === 'left' ? 'start' : t.align === 'center' ? 'middle' : 'end';
      const lines = lay.lines
        .map((ln) => `<tspan x="0" y="${(ln.y * lay.k).toFixed(3)}">${esc(ln.text)}</tspan>`)
        .join('');
      parts.push(
        `<text transform="matrix(${m.join(' ')})" font-family="${esc(t.font)}" font-size="${t.size}" ` +
          `font-weight="${t.bold ? 'bold' : 'normal'}" font-style="${t.italic ? 'italic' : 'normal'}" ` +
          `letter-spacing="${t.hSpace}" text-anchor="${anchor}" fill="${fill === 'none' ? 'none' : color}" ` +
          `stroke="${fill === 'none' ? color : 'none'}" ${sw}>${lines}</text>`,
      );
      continue;
    }
    parts.push(`<path d="${subsToD(shapeSubs(o.shape), m)}" fill="${fill}" fill-rule="evenodd" stroke="${color}" ${sw}/>`);
  }
  return { parts, box };
}

export async function exportSvg(ed: Editor) {
  await saveText('export.svg', 'SVG', 'svg', 'image/svg+xml', buildSvg(ed));
}

// ---------- DXF, PDF, Illustrator ----------

/** Anzahl Farbkanäle einer JPEG-Datei (aus dem SOF-Block), 0 wenn unklar */
function jpegComponents(b: Uint8Array): number {
  let p = 2;
  while (p + 9 < b.length && b[p] === 0xff) {
    const mk = b[p + 1];
    const len = (b[p + 2] << 8) | b[p + 3];
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return b[p + 9];
    p += 2 + len;
  }
  return 0;
}

const dataUrlBytes = (url: string) => {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/**
 * Sichtbare Objekte als Exportdaten: Konturen in Weltkoordinaten, Texte als Umrisse, Bilder mit Bildpunkten.
 * notes sammelt, was nicht mitkommt.
 */
async function exportItems(ed: Editor, objs: Obj[], withImages: boolean, notes: Set<string>): Promise<ExportItem[]> {
  const items: ExportItem[] = [];
  for (const [o, m] of visibleLeaves(objs)) {
    const L = ed.layer(o.layer);
    if (!L.show) continue;
    const fill = L.mode === 'fill';
    if (o.shape.kind === 'image') {
      if (!withImages) {
        items.push({ kind: 'image', m, layer: o.layer, pxW: 0, pxH: 0 });
        continue;
      }
      const s = o.shape;
      const img = assetImage(s.asset);
      const url = assetUrl(s.asset);
      if (!img || !url) {
        notes.add(t('Ein Bild ließ sich nicht einbetten.'));
        continue;
      }
      const im: Mat = mul(m, [s.w, 0, 0, s.h, 0, 0]);
      const pxW = img.naturalWidth || img.width,
        pxH = img.naturalHeight || img.height;
      if (url.startsWith('data:image/jpeg')) {
        const jpeg = dataUrlBytes(url);
        if (jpegComponents(jpeg) === 3) {
          items.push({ kind: 'image', m: im, layer: o.layer, pxW, pxH, jpeg });
          continue;
        }
      }
      const c = document.createElement('canvas');
      c.width = pxW;
      c.height = pxH;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, pxW, pxH).data;
      const rgb = new Uint8Array(pxW * pxH * 3),
        alpha = new Uint8Array(pxW * pxH);
      for (let i = 0, j = 0; i < pxW * pxH; i++, j += 4) {
        rgb[i * 3] = px[j];
        rgb[i * 3 + 1] = px[j + 1];
        rgb[i * 3 + 2] = px[j + 2];
        alpha[i] = px[j + 3];
      }
      items.push({ kind: 'image', m: im, layer: o.layer, pxW, pxH, rgb, alpha });
      continue;
    }
    if (o.shape.kind === 'text') {
      const ts = o.shape;
      let ol = textOutline(ts);
      if (!ol) {
        try {
          await loadFont(ts.font, ts.bold, ts.italic);
        } catch {
          /* unten vermerkt */
        }
        ol = textOutline(ts);
      }
      if (!ol) {
        notes.add(t('Ein Text konnte nicht in Umrisse umgewandelt werden (Schrift fehlt).'));
        continue;
      }
      items.push({ kind: 'path', subs: transformSubs(ol.subs, m), layer: o.layer, fill });
      continue;
    }
    items.push({ kind: 'path', subs: transformSubs(shapeSubs(o.shape), m), layer: o.layer, fill });
  }
  return items;
}

const layerInfos = (ed: Editor): LayerInfo[] => Array.from({ length: PALETTE.length }, (_, i) => ({ index: i, name: ed.layer(i).name }));

const exportName = (ed: Editor, ext: string) => {
  return `${ed.tab?.name || 'export'}.${ext}`;
};

/** DXF der aktuellen Seite (mm, Kurven als Splines); Bilder kann DXF nicht aufnehmen */
export async function buildDxfText(ed: Editor): Promise<{ text: string; notes: string[] }> {
  const notes = new Set<string>();
  const items = await exportItems(ed, ed.doc.objs, false, notes);
  const r = buildDxf(items, layerInfos(ed), ed.doc.bed.h);
  if (r.skippedImages) notes.add(tn('{n} Bild wurde nicht übernommen (DXF kann keine Bilder enthalten).', '{n} Bilder wurden nicht übernommen (DXF kann keine Bilder enthalten).', r.skippedImages));
  return { text: r.text, notes: [...notes] };
}

export async function exportDxf(ed: Editor) {
  const { text, notes } = await buildDxfText(ed);
  if (await saveText(exportName(ed, 'dxf'), 'DXF', 'dxf', 'image/vnd.dxf', text)) exportHint(ed, 'DXF', notes);
}

/** PDF aller Seiten (eine PDF-Seite je Projektseite in Bettgröße) */
export async function buildPdfBytes(ed: Editor, opts: { currentOnly?: boolean } = {}): Promise<{ bytes: Uint8Array; notes: string[] }> {
  const notes = new Set<string>();
  const pages: ExportPage[] = [];
  const list = opts.currentOnly ? [ed.doc.pages[ed.doc.page]] : ed.doc.pages;
  for (const p of list) pages.push({ name: p.name, items: await exportItems(ed, p.objs, true, notes) });
  const title = ed.tab?.name || 'KizamuBeam';
  return { bytes: buildPdf(pages, { bed: ed.doc.bed, layers: layerInfos(ed), title }), notes: [...notes] };
}

/** PDF oder Illustrator-Datei (PDF-kompatibel, öffnet in Illustrator, Inkscape, Affinity …) speichern */
export async function exportPdf(ed: Editor, format: 'pdf' | 'ai' = 'pdf') {
  const { bytes, notes } = await buildPdfBytes(ed);
  const url = 'data:application/pdf;base64,' + bytesToBase64(bytes);
  const ok = await saveDataUrl(exportName(ed, format), format === 'ai' ? 'Adobe Illustrator' : 'PDF', format, url);
  if (ok) exportHint(ed, format === 'ai' ? 'AI' : 'PDF', notes);
}

function exportHint(ed: Editor, what: string, notes: string[]) {
  ed.hint = [t('{what} exportiert.', { what }), ...notes].join(' ');
  ed.emit('tool');
}

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s);
}

// ---------- Import ----------

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'webp', 'tif', 'tiff'];
/** Was Importieren annimmt; .kza = Eintrag der Bibliothek */
export const MODEL_EXT = ['stl', 'obj'];
export const IMPORT_EXT = ['svg', 'dxf', 'pdf', 'ai', 'lbrn2', 'lbrn', ...IMAGE_EXT, ...MODEL_EXT, 'kza'];
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', gif: 'image/gif', webp: 'image/webp',
};

function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(new Blob([bytes as BlobPart], { type: mime }));
  });
}

type ParsedFile = { kind: 'vectors'; res: ImportResult } | { kind: 'pdf'; pages: ImportResult[] } | { kind: 'image'; dataUrl: string; dpi: number | null } | { kind: 'lbrn'; res: LbrnResult };

/**
 * Ersatz für Schriften, die eine PDF-Datei nicht eingebettet hat: erst die Familie selbst (Systemschrift oder
 * im Font-Manager geladen), sonst die Ersatzschrift der App.
 */
const pdfFontFallback: FallbackResolver = async (families, bold, italic) => {
  let lf: Awaited<ReturnType<typeof loadFont>> | null = null,
    name = families[0] ?? '';
  for (const f of families) {
    const r = await loadFont(f, bold, italic);
    if (!r.fallback) {
      lf = r;
      name = f;
      break;
    }
    lf ??= r;
  }
  if (!lf) return null;
  const font = lf.font;
  const upm = font.unitsPerEm || 1000;
  return {
    unitsPerEm: upm,
    name: lf.fallback ? (font.names.fontFamily?.en ?? 'Roboto') : name,
    substituted: lf.fallback,
    glyph(ch: string) {
      const g = font.charToGlyph(ch);
      if (!g || !g.index) return null;
      // getPath liefert y nach unten; zurück in Schrifteinheiten mit y nach oben
      const pb = new PathBuilder();
      for (const c of g.getPath(0, 0, upm).commands) {
        if (c.type === 'M') pb.moveTo({ x: c.x, y: -c.y });
        else if (c.type === 'L') pb.lineTo({ x: c.x, y: -c.y });
        else if (c.type === 'C') pb.curveTo({ x: c.x1, y: -c.y1 }, { x: c.x2, y: -c.y2 }, { x: c.x, y: -c.y });
        else if (c.type === 'Q') {
          const p0 = pb.pos;
          pb.curveTo({ x: p0.x + (2 / 3) * (c.x1 - p0.x), y: p0.y + (2 / 3) * (-c.y1 - p0.y) }, { x: c.x + (2 / 3) * (c.x1 - c.x), y: -c.y + (2 / 3) * (-c.y1 + c.y) }, { x: c.x, y: -c.y });
        } else if (c.type === 'Z') pb.close();
      }
      return { subs: pb.subs.filter((sp) => sp.nodes.length > 1), advance: g.advanceWidth ?? upm / 2 };
    },
  };
};

/** Dateiinhalt anhand von Endung bzw. Dateikopf lesen; Fehler werden geworfen */
async function parseFile(name: string, bytes: Uint8Array, bedH: () => number): Promise<ParsedFile> {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
  const head = new TextDecoder().decode(bytes.slice(0, 512)).trimStart();
  if (ext === 'lbrn2' || ext === 'lbrn' || isLbrn(head)) {
    const res = await convertLbrn(new TextDecoder().decode(bytes), { bedH: bedH(), assetId: hashId, flipImage: flipImageV });
    await finishLbrnTexts(res, measureText);
    return { kind: 'lbrn', res };
  }
  if (ext === 'pdf' || ext === 'ai' || isPdf(bytes)) {
    if (!isPdf(bytes))
      throw new Error(
        ext === 'ai'
          ? t('Diese Illustrator-Datei enthält keine PDF-Fassung (altes Format). Bitte in Illustrator mit „PDF-kompatible Datei erstellen“ speichern oder als PDF/SVG exportieren.')
          : t('Keine gültige PDF-Datei'),
      );
    return { kind: 'pdf', pages: await importPdfPages(bytes, { fallback: pdfFontFallback }) };
  }
  if (ext === 'svg' || head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')))
    return { kind: 'vectors', res: importSvg(new TextDecoder().decode(bytes)) };
  if (ext === 'dxf' || /^\s*0\s*\r?\n\s*SECTION/.test(head)) return { kind: 'vectors', res: importDxf(new TextDecoder().decode(bytes)) };
  if (ext === 'tif' || ext === 'tiff' || isTiff(bytes)) return { kind: 'image', ...(await decodeTiff(bytes)) };
  const mime = MIME[ext] ?? sniffImage(bytes);
  if (!mime) throw new Error(t('Dateiformat wird nicht unterstützt (SVG, DXF, PDF, AI, PNG, JPG, BMP, GIF, WebP, TIFF).'));
  return { kind: 'image', dataUrl: await bytesToDataUrl(bytes, mime), dpi: readDpi(bytes) };
}

/** Dateiinhalt anhand von Endung bzw. Dateikopf importieren; Fehler werden geworfen */
export async function importBytesOrThrow(ed: Editor, name: string, bytes: Uint8Array) {
  if (/\.(stl|obj)$/i.test(name)) {
    await openModel(ed, name, bytes);
    return;
  }
  if (/\.kza$/i.test(name)) {
    const { insertAssetFile } = await import('./libraryPanel');
    await insertAssetFile(ed, new TextDecoder().decode(bytes));
    return;
  }
  const f = await parseFile(name, bytes, () => ed.doc.bed.h);
  if (f.kind === 'vectors') await ed.importVectors(f.res, name);
  else if (f.kind === 'pdf') await ed.importPdfPages(f.pages, name);
  else if (f.kind === 'lbrn') ed.importLbrn(f.res, name);
  else await ed.importImage(f.dataUrl, f.dpi, name);
}

/** Datei zu Objekten machen, ohne sie einzufügen (für die Bibliothek); notes: Hinweise des Imports */
export async function fileObjs(ed: Editor, name: string, bytes: Uint8Array): Promise<{ objs: Obj[]; notes: string[] }> {
  const f = await parseFile(name, bytes, () => ed.doc.bed.h);
  if (f.kind === 'image') return { objs: [await ed.imageObj(f.dataUrl, f.dpi, name)], notes: [] };
  if (f.kind === 'lbrn') {
    for (const [id, url] of Object.entries(f.res.assets)) registerAsset(id, url);
    return { objs: f.res.objs, notes: f.res.notes };
  }
  if (f.kind === 'pdf') {
    // Bibliothek: nur die erste Seite
    const res = f.pages[0];
    if (f.pages.length > 1) res.notes.push(t('Die Datei hat {n} Seiten; übernommen wurde Seite {page}.', { n: f.pages.length, page: 1 }));
    return { objs: await ed.vectorObjs(res, name), notes: res.notes };
  }
  return { objs: await ed.vectorObjs(f.res, name), notes: f.res.notes };
}

/** Dateiinhalt importieren, Fehler als Meldung */
export async function importBytes(ed: Editor, name: string, bytes: Uint8Array) {
  try {
    await importBytesOrThrow(ed, name, bytes);
  } catch (e) {
    alert(t('{name} konnte nicht importiert werden: {message}', { name, message: (e as Error).message }));
  }
}

const isTiff = (b: Uint8Array) => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42);

/**
 * TIFF lesen (die Webansicht kann es meist nicht) und als PNG weitergeben, damit Projektdatei, Browser und
 * Desktop-App dasselbe Bild sehen. Bei mehrseitigen Dateien zählt die erste Seite. Auflösung aus XResolution.
 */
async function decodeTiff(bytes: Uint8Array): Promise<{ dataUrl: string; dpi: number | null }> {
  const UTIF = (await import('utif')).default;
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  let ifd;
  try {
    ifd = UTIF.decode(buf).find((d) => typeof d.t256 !== 'undefined');
    if (ifd) UTIF.decodeImage(buf, ifd);
  } catch {
    ifd = undefined;
  }
  if (!ifd || !ifd.width || !ifd.height) throw new Error(t('TIFF-Datei konnte nicht gelesen werden.'));
  const rgba = UTIF.toRGBA8(ifd);
  const c = document.createElement('canvas');
  c.width = ifd.width;
  c.height = ifd.height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(ifd.width, ifd.height);
  img.data.set(rgba.subarray(0, img.data.length));
  ctx.putImageData(img, 0, 0);
  // XResolution (282) je ResolutionUnit (296): 2 = Zoll (Standard), 3 = Zentimeter, 1 = ohne Einheit
  const first = (v: unknown) => (Array.isArray(v) ? Number(v[0]) : NaN);
  const res = first(ifd.t282);
  const unit = first(ifd.t296);
  const dpi = res > 0 && unit !== 1 ? (unit === 3 ? res * 2.54 : res) : null;
  return { dataUrl: c.toDataURL('image/png'), dpi };
}

function sniffImage(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}

/** Bilddatei auswählen und als Data-URL lesen (TIFF wird zu PNG); null bei Abbruch, Fehler werden geworfen */
export async function pickImage(): Promise<{ name: string; dataUrl: string } | null> {
  const read = async (name: string, bytes: Uint8Array) => {
    const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase();
    if (ext === 'tif' || ext === 'tiff' || isTiff(bytes)) return { name, dataUrl: (await decodeTiff(bytes)).dataUrl };
    const mime = MIME[ext] ?? sniffImage(bytes);
    if (!mime) throw new Error(t('Dateiformat wird nicht unterstützt (PNG, JPG, BMP, GIF, WebP, TIFF).'));
    return { name, dataUrl: await bytesToDataUrl(bytes, mime) };
  };
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string | null>('pick_file', { filters: [[t('Bilder'), IMAGE_EXT]] });
    if (!path) return null;
    const buf = await invoke<ArrayBuffer>('read_file', { path });
    return read(path.split(/[\\/]/).pop() ?? path, new Uint8Array(buf));
  }
  return new Promise((res, rej) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_EXT.map((e) => '.' + e).join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return res(null);
      read(f.name, new Uint8Array(await f.arrayBuffer())).then(res, rej);
    };
    input.click();
  });
}

/** Datei > Importieren (Ctrl+I) */
export async function importFile(ed: Editor) {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string | null>('pick_file', {
      filters: [
        [t('Alle unterstützten Dateien'), IMPORT_EXT],
        [t('Bilder'), IMAGE_EXT],
        [t('Vektoren (SVG, DXF, PDF, AI)'), ['svg', 'dxf', 'pdf', 'ai']],
        [t('LightBurn-Projekte'), ['lbrn2', 'lbrn']],
        [t('3D-Modelle (STL, OBJ)'), MODEL_EXT],
        [t('Bibliotheks-Einträge'), ['kza']],
      ],
    });
    if (!path) return;
    const buf = await invoke<ArrayBuffer>('read_file', { path });
    await importBytes(ed, path.split(/[\\/]/).pop() ?? path, new Uint8Array(buf));
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = IMPORT_EXT.map((e) => '.' + e).join(',');
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) await importBytes(ed, f.name, new Uint8Array(await f.arrayBuffer()));
  };
  input.click();
}

/**
 * 3D-Modell einlesen und den Dialog des Schichtmodells bzw. Rippenmodells öffnen (ohne Vorgabe wird gefragt).
 * Das Netz kommt in den Modell-Speicher; die Teile tragen nur seine Kennung. Fehler werden geworfen.
 */
export async function openModel(ed: Editor, name: string, bytes: Uint8Array, gen?: 'stack' | 'ribs') {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const mesh = parseMeshFile(name, buf);
  const kind = gen ?? (await askModelKind());
  if (!kind) return;
  const id = addMesh(mesh);
  openGenDialog(ed, kind, undefined, { model: id, name: name.replace(/\.[^.]*$/, '') });
}

/** Kachel Schichtmodell/Rippenmodell: nur STL und OBJ anbieten */
export async function importModel(ed: Editor, gen: 'stack' | 'ribs') {
  const run = async (name: string, bytes: Uint8Array) => {
    try {
      await openModel(ed, name, bytes, gen);
    } catch (e) {
      alert(t('{name} konnte nicht importiert werden: {message}', { name, message: (e as Error).message }));
    }
  };
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string | null>('pick_file', { filters: [[t('3D-Modelle (STL, OBJ)'), MODEL_EXT]] });
    if (!path) return;
    const buf = await invoke<ArrayBuffer>('read_file', { path });
    await run(path.split(/[\\/]/).pop() ?? path, new Uint8Array(buf));
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = MODEL_EXT.map((e) => '.' + e).join(',');
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) await run(f.name, new Uint8Array(await f.arrayBuffer()));
  };
  input.click();
}

/** Dateien aus dem Dateimanager auf die Arbeitsfläche ziehen; Bilder/SVG aus der Zwischenablage einfügen */
export function installDropAndPaste(ed: Editor, stage: HTMLElement) {
  stage.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  stage.addEventListener('drop', async (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) {
      if (/\.kzt$/i.test(f.name)) {
        const { useTemplateFile } = await import('./templateDialogs');
        await useTemplateFile(ed, f.name, await f.text());
      } else if (/\.kzp$/i.test(f.name)) {
        const { installPackFile } = await import('./packsDialog');
        await installPackFile(f.name, await f.text());
      } else await importBytes(ed, f.name, new Uint8Array(await f.arrayBuffer()));
    }
  });
  ed.externalPaste = async (data) => {
    const file = [...data.files].find((f) => f.type.startsWith('image/'));
    if (file) {
      await importBytes(ed, file.name || t('Zwischenablage.png'), new Uint8Array(await file.arrayBuffer()));
      return true;
    }
    const text = data.getData('image/svg+xml') || data.getData('text/plain');
    if (/^\s*(<\?xml[^>]*>\s*)?(<!--(?:[^-]|-(?!->))*-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)) {
      await importBytes(ed, t('Zwischenablage.svg'), new TextEncoder().encode(text));
      return true;
    }
    return false;
  };
}

// ---------- Bearbeitetes Bild speichern ----------

/** Binärdatei (als Data-URL) speichern; false, wenn der Dialog abgebrochen wurde */
export async function saveDataUrl(name: string, filterName: string, ext: string, dataUrl: string): Promise<boolean> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string | null>('save_binary_file', { defaultName: name, filterName, extensions: [ext], base64: dataUrl.slice(dataUrl.indexOf(',') + 1) });
    return path !== null;
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  a.click();
  return true;
}

/** Das gerasterte/geditherte Bild so speichern, wie es gelasert würde */
export async function saveProcessedBitmap(ed: Editor) {
  const o = ed.selImages()[0];
  if (!o || o.shape.kind !== 'image') return;
  const url = await processedPng(o.shape, o.m, ed.imgLayer(o.layer));
  if (url) await saveDataUrl(t('bild-bearbeitet.png'), 'PNG', 'png', url);
}
