// Path tools and image filters from extensions in the editor (#205 stage 3): what the selection hands to the
// plugin, the dialog with fields and a preview, and applying the result as one undo step. The MCP tool
// run_extension_tool uses the same input and apply functions.
import type { Editor } from '../editor';
import { check, numField, select } from '../arrayDialogs';
import { h } from '../dom';
import { homeLayer, IDENT, leaves, newId, type Obj } from '../model';
import { shapeSubs, subsToPath2D } from '../geom';
import { transformSubs } from '../importers';
import { addAsset } from '../images';
import { t } from '../i18n';
import { defaultParams, fieldActive, normalizeParams } from '../generators/index';
import type { Params, ParamSpec } from '../generators/types';
import { LIMITS, type PluginGray, type PluginToolObject } from './contract';
import type { PluginTool, ToolInput, ToolResult } from './tool';

const LAST_KEY = (id: string) => `kizamubeam.tool.${id}`;

/** What a tool works on, taken from the selection when it starts */
export type ToolTarget =
  | { type: 'pathtool'; objs: Obj[]; input: { objects: PluginToolObject[] } }
  | { type: 'imagefilter'; obj: Obj; alpha: Uint8ClampedArray; input: { image: PluginGray } };

/** The selection a tool needs, as a message when it is missing; null when the tool can start */
export function toolNeeds(ed: Editor, tool: PluginTool): string | null {
  if (tool.type === 'imagefilter') return ed.sel.length === 1 && ed.sel[0].shape.kind === 'image' ? null : t('„{name}“: erst ein Bild auswählen.', { name: tool.name });
  return ed.sel.some((o) => o.shape.kind !== 'image') ? null : t('„{name}“: erst passende Objekte auswählen.', { name: tool.name });
}

/**
 * Input for a tool from the selection: shapes as paths in mm with texts as outlines (path tool), or the selected
 * image as grayscale (image filter; transparent pixels count as white, they are not lasered). Null with a message
 * in ed.hint when the selection does not fit or the image is not loaded yet.
 */
export async function toolTarget(ed: Editor, tool: PluginTool): Promise<ToolTarget | null> {
  const need = toolNeeds(ed, tool);
  if (need) {
    ed.hint = need;
    return null;
  }
  if (tool.type === 'imagefilter') {
    const obj = ed.sel[0];
    const px = ed.imagePixels(obj, LIMITS.imagePixels);
    if (!px) {
      ed.hint = t('Das Bild ist noch nicht geladen.');
      return null;
    }
    const n = px.w * px.h;
    const gray = new Uint8ClampedArray(n), alpha = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) {
      const a = px.rgba[i * 4 + 3] / 255;
      const v = 0.299 * px.rgba[i * 4] + 0.587 * px.rgba[i * 4 + 1] + 0.114 * px.rgba[i * 4 + 2];
      gray[i] = v * a + 255 * (1 - a);
      alpha[i] = px.rgba[i * 4 + 3];
    }
    return { type: 'imagefilter', obj, alpha, input: { image: { width: px.w, height: px.h, data: gray } } };
  }
  const objs = ed.sel.filter((o) => o.shape.kind !== 'image');
  const outlined = await ed.withTextOutlines(objs);
  const objects = outlined.map((c, i) => {
    const subs = [];
    for (const [leaf, m] of leaves([c])) if (leaf.shape.kind !== 'image' && leaf.shape.kind !== 'text') subs.push(...transformSubs(shapeSubs(leaf.shape).filter((s) => s.nodes.length >= 2), m));
    return { id: String(objs[i].id), subs };
  });
  return { type: 'pathtool', objs, input: { objects } };
}

/** Apply a result: replace the selected shapes, or give the image the filtered pixels. One undo step. */
export async function applyToolResult(ed: Editor, tool: PluginTool, target: ToolTarget, r: ToolResult): Promise<boolean> {
  if (target.type === 'imagefilter') {
    const img = r.image;
    const o = target.obj;
    if (!img || o.shape.kind !== 'image' || !ed.doc.objs.includes(o)) return false;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const rgba = new Uint8ClampedArray(img.width * img.height * 4);
    // Same size: transparent areas stay transparent; a new size has no known transparency
    const keep = img.width === target.input.image.width && img.height === target.input.image.height;
    for (let i = 0; i < img.data.length; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = img.data[i];
      rgba[i * 4 + 3] = keep ? target.alpha[i] : 255;
    }
    c.getContext('2d')!.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
    const a = await addAsset(c.toDataURL('image/png'));
    ed.snapshot(tool.name);
    o.shape = { ...o.shape, asset: a.id, pxW: a.w, pxH: a.h };
    ed.setSel([o]);
    ed.hint = t('„{name}“ angewendet (Ctrl+Z macht es rückgängig).', { name: tool.name });
    ed.emit('doc');
    return true;
  }
  const objects = r.objects;
  if (!objects) return false;
  const inputs = target.objs.filter((o) => ed.doc.objs.includes(o));
  if (!inputs.length) return false;
  if (!(await ed.guardGen(inputs, tool.name))) return false;
  const byId = new Map(inputs.map((o) => [String(o.id), o]));
  const at = Math.min(...inputs.map((o) => ed.doc.objs.indexOf(o)));
  ed.snapshot(tool.name);
  const made: Obj[] = objects
    .filter((x) => x.subs.length)
    .map((x) => ({ id: newId(), m: IDENT, layer: homeLayer((x.from && byId.get(x.from)) || inputs[0]), shape: { kind: 'path', subs: x.subs } }));
  ed.doc.objs = ed.doc.objs.filter((o) => !inputs.includes(o));
  ed.doc.objs.splice(Math.min(at, ed.doc.objs.length), 0, ...made);
  ed.setSel(made);
  ed.hint = made.length ? t('„{name}“ angewendet (Ctrl+Z macht es rückgängig).', { name: tool.name }) : t('„{name}“ hat keine Formen geliefert; die Auswahl wurde entfernt (Ctrl+Z macht es rückgängig).', { name: tool.name });
  ed.emit('doc');
  return true;
}

function lastParams(tool: PluginTool): Params {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_KEY(tool.id)) ?? 'null');
    if (raw && typeof raw === 'object') return normalizeParams(tool, raw);
  } catch {
    /* no storage or old values */
  }
  return defaultParams(tool);
}

/** Open the dialog of a path tool or image filter for the current selection */
export async function openPluginTool(ed: Editor, tool: PluginTool) {
  const target = await toolTarget(ed, tool);
  if (!target) {
    ed.emit('tool');
    return;
  }
  const p = lastParams(tool);
  const rows = new Map<string, HTMLElement[]>();
  const field = (s: ParamSpec): HTMLElement[] => {
    const id = `tool-${s.key}`;
    const set = (v: Params[string]) => {
      p[s.key] = v;
      update();
    };
    const label = (text: string) => h('label', { for: id, title: s.title ?? '' }, text);
    if (s.type === 'data') return [];
    if (s.type === 'text') {
      const el = h('input', { type: 'text', id, value: String(p[s.key] ?? ''), maxlength: 2000, title: s.title ?? '' }) as HTMLInputElement;
      el.addEventListener('input', () => set(el.value));
      return [label(s.label), el];
    }
    if (s.type === 'enum') return [label(s.label), select(id, String(p[s.key]), s.options, set)];
    if (s.type === 'bool') return [h('span'), check(!!p[s.key], set, s.label)];
    const unit = s.type === 'length' ? ' (mm)' : s.type === 'angle' ? ' (°)' : '';
    return [label(s.label + unit), numField(id, Number(p[s.key]), set, s.title)];
  };
  const main: HTMLElement[] = [], adv: HTMLElement[] = [];
  const sections = new Map<string, HTMLElement[]>();
  for (const s of tool.schema) {
    const els = field(s);
    rows.set(s.key, els);
    if (s.advanced) adv.push(...els);
    else if (s.section) sections.set(s.section, [...(sections.get(s.section) ?? []), ...els]);
    else main.push(...els);
  }
  const sectionEls = [...sections].map(([label, els]) => h('details', { open: true, class: 'gen-section' }, h('summary', {}, label), h('div', { class: 'form' }, ...els)));
  const sectionKeys = [...sections.keys()].map((label) => tool.schema.filter((s) => !s.advanced && s.section === label));

  const canvas = h('canvas', { class: 'gen-preview', width: 240, height: 240 }) as HTMLCanvasElement;
  const infoEl = h('div', { class: 'gen-info' });
  const issuesEl = h('div', { class: 'gen-issues' });
  let result: ToolResult | null = null;
  let progress = '';
  let seq = 0, timer = 0;

  const draw = () => {
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const css = getComputedStyle(canvas);
    if (target.type === 'imagefilter') {
      const img = result?.image ?? target.input.image;
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const rgba = new Uint8ClampedArray(img.width * img.height * 4);
      for (let i = 0; i < img.data.length; i++) (rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = img.data[i]), (rgba[i * 4 + 3] = 255);
      c.getContext('2d')!.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
      const k = Math.min((canvas.width - 8) / img.width, (canvas.height - 8) / img.height);
      ctx.globalAlpha = result?.image ? 1 : 0.35;
      ctx.drawImage(c, (canvas.width - img.width * k) / 2, (canvas.height - img.height * k) / 2, img.width * k, img.height * k);
      ctx.globalAlpha = 1;
      return;
    }
    // Selection thin and faint, the result filled on top
    const before = target.input.objects.map((o) => o.subs);
    const after = result?.objects?.map((o) => o.subs) ?? [];
    const pts = [...before, ...after].flat().flatMap((s) => s.nodes);
    if (!pts.length) return;
    const minX = Math.min(...pts.map((q) => q.x)), maxX = Math.max(...pts.map((q) => q.x));
    const minY = Math.min(...pts.map((q) => q.y)), maxY = Math.max(...pts.map((q) => q.y));
    const k = Math.min((canvas.width - 12) / Math.max(1e-6, maxX - minX), (canvas.height - 12) / Math.max(1e-6, maxY - minY));
    ctx.setTransform(k, 0, 0, k, canvas.width / 2 - ((minX + maxX) / 2) * k, canvas.height / 2 - ((minY + maxY) / 2) * k);
    ctx.lineWidth = 1 / k;
    ctx.strokeStyle = css.color || '#333';
    ctx.globalAlpha = 0.3;
    for (const subs of before) ctx.stroke(subsToPath2D(subs));
    ctx.globalAlpha = 1;
    ctx.fillStyle = css.getPropertyValue('--accent-soft').trim() || 'rgba(80,140,220,0.18)';
    for (const subs of after) {
      const path = subsToPath2D(subs);
      ctx.fill(path, 'evenodd');
      ctx.stroke(path);
    }
  };

  const show = () => {
    const busy = !result;
    issuesEl.replaceChildren(
      ...(busy ? [h('div', { class: 'muted' }, t('Wird berechnet …') + progress), h('button', { class: 'btn small', onclick: () => tool.cancel() }, t('Berechnung abbrechen'))] : []),
      ...(result?.issues ?? []).map((i) => h('div', { class: i.level === 'error' ? 'error' : 'warn' }, i.msg)),
      ...(result?.issues.some((i) => i.code === 'plugin-cancelled' || i.code === 'plugin-timeout') ? [h('button', { class: 'btn small', onclick: () => compute() }, t('Neu berechnen'))] : []),
    );
    infoEl.replaceChildren(...(result?.info ?? []).map(([k, v]) => h('div', {}, h('span', { class: 'muted' }, k), ' ', v)));
    for (const s of tool.schema) {
      const bad = !!result?.issues.some((i) => i.key === s.key && i.level === 'error');
      rows.get(s.key)!.forEach((el) => el.classList.toggle('invalid', bad));
    }
    okBtn.disabled = !result || !(result.objects || result.image);
    draw();
  };
  const compute = () => {
    const my = ++seq;
    result = null;
    progress = '';
    show();
    void tool.run(normalizeParams(tool, p), target.input as ToolInput).then((r) => {
      if (my !== seq) return;
      result = r;
      show();
    });
  };
  const update = () => {
    const np = normalizeParams(tool, p);
    for (const s of tool.schema) rows.get(s.key)!.forEach((el) => (el.hidden = !fieldActive(s, np)));
    sectionEls.forEach((el, i) => (el.hidden = !sectionKeys[i].some((s) => fieldActive(s, np))));
    clearTimeout(timer);
    // A running call is stopped: only the newest parameters count
    if (!result) tool.cancel();
    timer = window.setTimeout(compute, 250);
  };
  tool.onProgress = (done, text) => {
    progress = ` ${Math.round(done * 100)} %${text ? ` · ${text}` : ''}`;
    if (!result) show();
  };

  const okBtn = h('button', {
    class: 'btn primary',
    onclick: async () => {
      if (!result) return;
      try {
        localStorage.setItem(LAST_KEY(tool.id), JSON.stringify(normalizeParams(tool, p)));
      } catch {
        /* no storage */
      }
      if (await applyToolResult(ed, tool, target, result)) dlg.close();
    },
  }, t('Anwenden')) as HTMLButtonElement;
  const dlg = h(
    'dialog',
    { class: 'offset-dialog gen-dialog' },
    h('h3', {}, tool.name),
    tool.desc ? h('p', { class: 'muted' }, tool.desc) : null,
    h('div', { class: 'qr-layout' },
      h('div', {},
        h('div', { class: 'form' }, ...main),
        ...sectionEls,
        adv.length ? h('details', {}, h('summary', {}, t('Erweitert')), h('div', { class: 'form' }, ...adv)) : null,
      ),
      h('div', {}, canvas, infoEl),
    ),
    issuesEl,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')), okBtn),
  );
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => {
    clearTimeout(timer);
    seq++;
    if (!result) tool.cancel();
    tool.onProgress = undefined;
    tool.closeSession();
    dlg.remove();
  });
  document.body.append(dlg);
  dlg.showModal();
  tool.openSession(normalizeParams(tool, p));
  update();
}
