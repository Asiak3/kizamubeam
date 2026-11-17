// Path tools and image filters from extensions (#205 stage 3). A path tool gets the selected shapes as paths in
// mm and returns the shapes that replace them; an image filter gets a grayscale image and returns a new one. Both
// have parameters like a generator (dialog fields only) and answer through apply(); the app checks every answer.
import type { Issue, Params, ParamSpec } from '../generators/types';
import { checkFilterResult, checkPathResult, ContractError, toBase64, type PluginGray, type PluginToolObject } from './contract';
import { EngineError } from './engine';
import type { PluginProcess } from './client';
import type { PluginManifest } from './manifest';
import { spawnPlugin } from './generator';
import { pluginWords } from './words';
import { ICONS } from '../icons';

export type ToolType = 'pathtool' | 'imagefilter';

/** What a tool computes on: the selected shapes (path tool) or one grayscale image (image filter) */
export type ToolInput = { objects: PluginToolObject[] } | { image: PluginGray };

/** Result of a tool in the app's terms; without objects or image there is nothing to apply (see issues) */
export interface ToolResult {
  issues: Issue[];
  info: [string, string][];
  objects?: { from?: string; subs: PluginToolObject['subs'] }[];
  image?: PluginGray;
}

export interface PluginTool {
  id: string;
  type: ToolType;
  name: string;
  desc: string;
  keys: string;
  icon: string;
  /** Parameters with labels in the interface language */
  schema: ParamSpec[];
  pack: { id: string; name: string };
  manifest: PluginManifest;
  /** Compute the result for these (normalised) parameters; a newer call makes older ones obsolete */
  run(p: Params, input: ToolInput): Promise<ToolResult>;
  /** Progress of the running call (host.progress) */
  onProgress?: (done: number, text?: string) => void;
  /** Stop the running call; it ends with plugin-cancelled */
  cancel(): void;
  /** The plugin's dialog was opened or closed (optional open/close in the plugin) */
  openSession(p: Params): void;
  closeSession(): void;
  dispose(): void;
}

export const isToolType = (type: string): type is ToolType => type === 'pathtool' || type === 'imagefilter';

export function pluginTool(m: PluginManifest, pack: { id: string; name: string }): PluginTool {
  if (!isToolType(m.type)) throw new Error(`${m.id} is not a tool`);
  const type = m.type;
  const w = pluginWords(m);
  let proc: PluginProcess | null = null;
  const missing = new Set<string>();
  const start = () => {
    const p = spawnPlugin(m);
    p.onProgress = (done, text) => tool.onProgress?.(done, text);
    return p;
  };
  const errorOf = (e: unknown) => (e instanceof EngineError || e instanceof ContractError ? e.code : e instanceof Error && 'code' in e ? String((e as { code: unknown }).code) : 'plugin-crash');
  const failed = (code: string): ToolResult => ({ issues: [{ level: 'error', code, msg: w.codeText(code) }], info: [] });
  const session = (fn: 'open' | 'close', input: unknown) => {
    if (missing.has(fn) || (fn === 'close' && !proc)) return;
    (proc ??= start()).call(fn, input).catch((e) => {
      if (errorOf(e) === 'plugin-no-function') missing.add(fn);
    });
  };

  const tool: PluginTool = {
    id: m.id,
    type,
    name: w.name,
    desc: w.text('desc') ?? '',
    keys: w.text('keys') ?? '',
    icon: m.icon && ICONS[m.icon] ? m.icon : type === 'imagefilter' ? 'image' : 'packs',
    schema: w.schema,
    pack,
    manifest: m,
    async run(p, input) {
      const call = (proc ??= start()).call('apply', {
        params: { ...p },
        ...('objects' in input ? { objects: input.objects } : { image: { width: input.image.width, height: input.image.height, data: toBase64(input.image.data) } }),
      });
      let raw: unknown;
      try {
        raw = await call;
      } catch (e) {
        return failed(errorOf(e));
      }
      try {
        const ids = new Set('objects' in input ? input.objects.map((o) => o.id) : []);
        const r = type === 'pathtool' ? checkPathResult(raw, ids) : checkFilterResult(raw);
        const out: ToolResult = { issues: r.issues.map(w.issue), info: r.info.map(([k, v]) => [w.label(k), w.render(v)]) };
        if (out.issues.some((i) => i.level === 'error')) return out;
        if ('objects' in r) out.objects = r.objects;
        else if (r.image) out.image = r.image;
        return out;
      } catch (e) {
        return failed(errorOf(e));
      }
    },
    cancel: () => proc?.cancel(),
    openSession: (p) => session('open', { ...p }),
    closeSession: () => session('close', null),
    dispose() {
      proc?.dispose();
      proc = null;
    },
  };
  return tool;
}

/** A small input to try a tool with: a square with a round hole and an open line, or a gray ramp */
export function sampleInput(type: ToolType): ToolInput {
  if (type === 'imagefilter') {
    const width = 32, height = 24;
    const data = new Uint8ClampedArray(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = Math.round((x / (width - 1)) * 255 * (y % 2 ? 1 : 0.8));
    return { image: { width, height, data } };
  }
  const k = 0.5523;
  const circle = (cx: number, cy: number, r: number) => ({
    closed: true,
    nodes: [
      { x: cx + r, y: cy, cin: { x: cx + r, y: cy - k * r }, cout: { x: cx + r, y: cy + k * r } },
      { x: cx, y: cy + r, cin: { x: cx + k * r, y: cy + r }, cout: { x: cx - k * r, y: cy + r } },
      { x: cx - r, y: cy, cin: { x: cx - r, y: cy + k * r }, cout: { x: cx - r, y: cy - k * r } },
      { x: cx, y: cy - r, cin: { x: cx - k * r, y: cy - r }, cout: { x: cx + k * r, y: cy - r } },
    ],
  });
  const square = { closed: true, nodes: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }] };
  return {
    objects: [
      { id: 'sample-a', subs: [square, circle(20, 20, 8)] },
      { id: 'sample-b', subs: [{ closed: false, nodes: [{ x: 50, y: 0 }, { x: 70, y: 30 }] }] },
    ],
  };
}
