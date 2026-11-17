// The generators that come with the app (box, gear, drawer, …) run as plugins from the core pack (#327): the pack
// is built from src/generators by scripts/build-core-plugins.mjs and bundled with the app (corePack.ts). Everything
// a generator needs comes from its plugin: geometry, dialog, parameter migrations of older projects (migrate, run
// in the Worker when a file is read), toolbox tile, plug-in joints and the assembly check.
import { register } from '../generators/index';
import { parsePack } from '../packs';
import { pluginGenerator, type PluginGenerator } from './generator';

export const CORE_PACK_ID = 'org.kizamubeam.core-generators';

let core: PluginGenerator[] = [];
/** The generators registered from the core pack */
export const coreGenerators = () => core;

/** Register the generators of the core pack (pack text in .kzp format); returns their ids */
export function useCoreGenerators(text: string): string[] {
  const pack = parsePack(text);
  if (pack.id !== CORE_PACK_ID) throw new Error(`not the core pack: ${pack.id}`);
  // register() replaces by id and keeps the toolbox order
  for (const g of core) g.dispose();
  core = [];
  for (const m of pack.plugins) {
    if (m.type !== 'generator') continue;
    const g = pluginGenerator(m, { id: pack.id, name: pack.name }, { core: true });
    register(g);
    core.push(g);
  }
  return core.map((g) => g.id);
}
