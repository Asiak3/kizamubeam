// Plugin generators of the installed extensions: registered with the generators when packs are (re)loaded,
// removed when their pack is removed. A plugin may not take the id of a generator built into the app or of a
// plugin from another pack; such a plugin is skipped and listed in pluginProblems().
import { getGenerator, register, unregister } from '../generators/index';
import { installedPacks, onPacksChanged, type Pack } from '../packs';
import { isPluginGenerator, onPluginResult, pluginGenerator, PENDING, setPluginSpawn, type PluginGenerator, type Spawn } from './generator';
import { t } from '../i18n';

const active = new Map<string, PluginGenerator>();
let problems: string[] = [];

/** Plugins that could not be registered (id taken), as messages */
export const pluginProblems = () => problems;
/** Registered plugin generators in pack order */
export const pluginGenerators = (): PluginGenerator[] => [...active.values()];

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
  for (const [id, g] of active) {
    const w = want.get(id);
    // Same pack and the same code: keep the running plugin and its cache
    if (w && w.pack.id === g.pack.id && w.m.sha256 === g.manifest.sha256 && w.m.version === g.manifest.version && JSON.stringify(w.m.texts) === JSON.stringify(g.manifest.texts)) continue;
    g.dispose();
    unregister(id);
    active.delete(id);
  }
  for (const [id, { pack, m }] of want) {
    if (active.has(id)) continue;
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
