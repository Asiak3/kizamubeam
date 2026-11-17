// Plugin generators of the installed extensions: registered with the generators when packs are (re)loaded,
// removed when their pack is removed. A plugin may not take the id of a generator built into the app or of a
// plugin from another pack; such a plugin is skipped and listed in pluginProblems().
import { defaultParams, getGenerator, register, unregister } from '../generators/index';
import { installedPacks, onPacksChanged, type Pack } from '../packs';
import { isPluginGenerator, onPluginResult, pluginGenerator, PENDING, setPluginSpawn, type PluginGenerator, type Spawn } from './generator';
import { isToolType, pluginTool, sampleInput, type PluginTool } from './tool';
import { t } from '../i18n';

const active = new Map<string, PluginGenerator>();
const tools = new Map<string, PluginTool>();
const toolListeners = new Set<() => void>();
let problems: string[] = [];

/** Plugins that could not be registered (id taken), as messages */
export const pluginProblems = () => problems;
/** Registered plugin generators in pack order */
export const pluginGenerators = (): PluginGenerator[] => [...active.values()];

/** Path tools and image filters of the installed extensions (#205 stage 3), in pack order */
export const pluginTools = (): PluginTool[] => [...tools.values()];
export const getPluginTool = (id: string): PluginTool | undefined => tools.get(id);
/** Called when the list of tools changes; returns the function that stops listening */
export function onToolsChanged(f: () => void): () => void {
  toolListeners.add(f);
  return () => void toolListeners.delete(f);
}

/** Why a plugin of this pack cannot use its id, or null when it can */
export function pluginConflict(pack: Pack, id: string): string | null {
  const g = getGenerator(id);
  if (!g) return null;
  if (isPluginGenerator(g)) return g.pack.id === pack.id ? null : t('Die Kennung „{id}“ benutzt schon die Erweiterung „{name}“.', { id, name: g.pack.name });
  return t('Die Kennung „{id}“ gehört zu einem eingebauten Generator.', { id });
}

/** Bring the registered plugin generators in line with the installed packs */
export function syncPlugins() {
  const want = new Map<string, { pack: Pack; m: Pack['plugins'][number] }>();
  const bad: string[] = [];
  for (const { pack } of installedPacks())
    for (const m of pack.plugins) {
      const other = want.get(m.id);
      if (other) bad.push(t('Plugin „{id}“ aus „{name}“: Die Kennung benutzt schon die Erweiterung „{other}“.', { id: m.id, name: pack.name, other: other.pack.name }));
      else want.set(m.id, { pack, m });
    }
  const same = (w: { pack: Pack; m: Pack['plugins'][number] } | undefined, packId: string, m: Pack['plugins'][number]) =>
    !!w && w.pack.id === packId && w.m.sha256 === m.sha256 && w.m.version === m.version && w.m.type === m.type && JSON.stringify(w.m.texts) === JSON.stringify(m.texts);
  let toolsChanged = false;
  for (const [id, x] of tools) {
    if (same(want.get(id), x.pack.id, x.manifest)) continue;
    x.dispose();
    tools.delete(id);
    toolsChanged = true;
  }
  for (const [id, { pack, m }] of want) {
    if (!isToolType(m.type) || tools.has(id)) continue;
    tools.set(id, pluginTool(m, { id: pack.id, name: pack.name }));
    toolsChanged = true;
  }
  for (const [id, g] of active) {
    const w = want.get(id);
    // Same pack and the same code: keep the running plugin and its cache
    if (same(w, g.pack.id, g.manifest)) continue;
    g.dispose();
    unregister(id);
    active.delete(id);
  }
  for (const [id, { pack, m }] of want) {
    if (active.has(id) || m.type !== 'generator') continue;
    const why = pluginConflict(pack, id);
    if (why) {
      bad.push(t('Plugin „{id}“ aus „{name}“: {why}', { id, name: pack.name, why }));
      continue;
    }
    const g = pluginGenerator(m, { id: pack.id, name: pack.name });
    register(g);
    active.set(id, g);
  }
  problems = bad;
  if (toolsChanged) toolListeners.forEach((f) => f());
}

/**
 * Load every plugin of a pack once before it is installed (#206): start it in its own process and compute the
 * default parameters. Returns the first problem as a message, or null when all plugins answered.
 */
export async function testLoadPlugins(pack: Pick<Pack, 'id' | 'name' | 'plugins'>): Promise<string | null> {
  for (const m of pack.plugins) {
    if (isToolType(m.type)) {
      const why = await testLoadTool(m, pack);
      if (why) return t('Plugin „{id}“: {message}', { id: m.id, message: why });
      continue;
    }
    const g = pluginGenerator(m, { id: pack.id, name: pack.name });
    try {
      const p = defaultParams(g);
      await g.prepare(p);
      const bad = g.validate(p).find((i) => i.code?.startsWith('plugin-'));
      if (bad) return t('Plugin „{id}“: {message}', { id: m.id, message: bad.msg });
      if (!g.validate(p).some((i) => i.level === 'error')) {
        try {
          g.generate(p);
        } catch (e) {
          const code = e instanceof Error ? e.message : String(e);
          return t('Plugin „{id}“: {message}', { id: m.id, message: g.texts?.[code]?.() ?? code });
        }
      }
    } finally {
      g.dispose();
    }
  }
  return null;
}

/** Run a tool once with its defaults on a small sample; a code the app reports (crash, timeout) is a problem */
async function testLoadTool(m: Pack['plugins'][number], pack: Pick<Pack, 'id' | 'name'>): Promise<string | null> {
  const x = pluginTool(m, { id: pack.id, name: pack.name });
  try {
    const r = await x.run(defaultParams(x), sampleInput(x.type));
    return r.issues.find((i) => i.code?.startsWith('plugin-'))?.msg ?? null;
  } finally {
    x.dispose();
  }
}

let started = false;
/**
 * Register the plugins of installed packs now and after every change. spawn starts a plugin (the app: its Worker).
 * refresh is called when a plugin answer arrives that someone waited for (e.g. formulas of placed parts).
 */
export function initPlugins(spawn: Spawn, refresh?: (id: string) => void) {
  setPluginSpawn(spawn);
  if (started) return;
  started = true;
  onPacksChanged(syncPlugins);
  syncPlugins();
  if (refresh) onPluginResult(refresh);
}

export { PENDING };
