/** Pure reader/upgrader for the existing toolbar format, not the new layout format. */
export type LegacyBarId = 'main' | 'tools';
export type LegacyIconSize = 's' | 'm' | 'l';
export interface LegacyConfig {
  v: 14;
  bars: Record<string, string[]> & Record<LegacyBarId, string[]>;
  size: Record<string, LegacyIconSize> & Record<LegacyBarId, LegacyIconSize>;
  hidden: string[];
  groups: Record<string, string>;
}
export type LegacyMigrations = readonly (readonly [readonly string[], string])[];
export type LegacyUpgradeResult =
  | { ok: true; config: LegacyConfig }
  | { ok: false; error: { code: 'invalid-config' | 'invalid-version' | 'future-version'; message: string } };

export const CONFIG_V = 14;
export const SEP = '|';
/** New defaults added after the saved version. Buttons later removed from defaults are omitted. */
const ADDED: { v: number; bar: LegacyBarId; id: string; after: string }[] = [
  { v: 3, bar: 'tools', id: 'apps', after: 'grp:gen' },
  { v: 5, bar: 'tools', id: 'grp:relate', after: 'nest' },
  { v: 5, bar: 'tools', id: 'tool:measure', after: 'grp:relate' },
  { v: 7, bar: 'main', id: 'camera-overlays', after: 'view3d' },
  { v: 6, bar: 'tools', id: 'tool:pencil', after: 'tool:line' },
  { v: 11, bar: 'tools', id: 'tool:curvature', after: 'tool:pencil' },
  // Insert after curvature before the v13 drawing-sequence fold runs.
  { v: 14, bar: 'tools', id: 'tool:shaper', after: 'tool:curvature' },
  { v: 11, bar: 'main', id: 'isolate', after: 'ungroup' },
];
/** Only unchanged contiguous default sequences are replaced; customized orders survive. */
const REMOVED: { v: number; bar: LegacyBarId; seq: string[]; keep: string[]; tail?: string[] }[] = [
  { v: 4, bar: 'tools', seq: ['grp:gen', 'apps'], keep: ['apps'] },
  { v: 4, bar: 'tools', seq: ['tool:joint', 'lidhinge', 'hinge'], keep: [] },
  { v: 4, bar: 'main', seq: ['check', 'preview', 'devsettings'], keep: ['check', 'preview'] },
  { v: 11, bar: 'tools', seq: ['tool:node', 'vectorfit', 'shape-builder', 'isolate'], keep: ['tool:node'] },
  { v: 11, bar: 'tools', seq: ['tool:text', 'qr', 'apps'], keep: ['tool:text'], tail: [SEP, 'apps'] },
  { v: 11, bar: 'tools', seq: ['grp:bool', 'outline', 'offset', 'warp', 'grp:path', 'grp:array', 'nest'], keep: ['grp:bool', 'grp:contour', 'grp:path', 'grp:array'] },
  { v: 11, bar: 'tools', seq: ['tool:measure', 'laserpos'], keep: ['tool:measure'] },
  { v: 12, bar: 'tools', seq: ['tool:select'], keep: ['grp:select'] },
  { v: 13, bar: 'tools', seq: ['tool:line', 'tool:pencil', 'tool:curvature'], keep: ['grp:draw'] },
];

/** Upgrade one existing bar, retaining the historical exported facade API. */
export function upgradeBar(bar: LegacyBarId, list: string[], raw: number): string[] {
  const out = [...list];
  for (const a of ADDED) if (a.bar === bar && !(raw >= a.v) && !out.includes(a.id)) insertAfter(out, a.id, a.after);
  for (const r of REMOVED) {
    if (r.bar !== bar || raw >= r.v) continue;
    for (let i = 0; i + r.seq.length <= out.length; i++)
      if (r.seq.every((x, k) => out[i + k] === x)) {
        out.splice(i, r.seq.length, ...r.keep);
        if (r.tail) out.push(...r.tail);
        break;
      }
  }
  // v10: after REMOVED so the v4 removal cannot remove device settings again.
  if (bar === 'main' && !(raw >= 10) && !out.includes('devsettings')) {
    const i = out.indexOf('check');
    if (i >= 0) out.splice(i, 0, 'devsettings');
    else out.push('devsettings');
  }
  return out;
}

function insertAfter(list: string[], id: string, after: string) {
  const i = list.indexOf(after);
  if (i < 0) list.push(id);
  else list.splice(i + 1, 0, id);
}

/** Fold all matching old single-button sequences, in the original migration order. */
function migrate(list: string[], migrations: LegacyMigrations): string[] {
  const out = [...list];
  for (const [seq, group] of migrations) {
    if (!seq.length) continue; // A malformed caller-supplied empty sequence must not grow forever.
    for (let i = 0; i + seq.length <= out.length; i++)
      if (seq.every((x, k) => out[i + k] === x)) out.splice(i, seq.length, group);
  }
  return out;
}

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((x) => typeof x === 'string');
const own = (value: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/**
 * Upgrade supported legacy data without registry filtering or input mutation.
 * Optional old fields retain their historical defaults; missing bars use current defaults unchanged.
 * An absent version is v1 only when an actual old bar is present. Invalid/future versions fail closed.
 * The caller owns persistence: on failure it must retain the original, not save fallback defaults.
 */
export function upgradeLegacyConfig(raw: unknown, defaults: Record<LegacyBarId, readonly string[]>, migrations: LegacyMigrations = []): LegacyUpgradeResult {
  const fail = (code: 'invalid-config' | 'invalid-version' | 'future-version', message: string): LegacyUpgradeResult => ({ ok: false, error: { code, message } });
  if (!record(raw)) return fail('invalid-config', 'Expected a legacy toolbar object');
  let version = raw.v;
  if (!own(raw, 'v')) {
    if (!record(raw.bars) || !(['main', 'tools'] as const).some((id) => own(raw.bars as Record<string, unknown>, id) && strings((raw.bars as Record<string, unknown>)[id])))
      return fail('invalid-version', 'Unversioned legacy data requires an existing bar');
    version = 1;
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    return fail('invalid-version', 'Expected a positive integer legacy version');
  if (version > CONFIG_V) return fail('future-version', 'Toolbar data is newer than this legacy reader');
  if (raw.bars !== undefined && !record(raw.bars)) return fail('invalid-config', 'Expected legacy bars');
  const bars = (raw.bars ?? {}) as Record<string, unknown>;
  if (!Object.values(bars).every(strings)) return fail('invalid-config', 'Expected a string array for each existing bar');
  if (raw.hidden !== undefined && !strings(raw.hidden)) return fail('invalid-config', 'Expected hidden bar IDs');
  if (raw.groups !== undefined && (!record(raw.groups) || !Object.values(raw.groups).every((x) => typeof x === 'string')))
    return fail('invalid-config', 'Expected group choices');
  const c: LegacyConfig = {
    v: CONFIG_V,
    bars: { ...Object.fromEntries(Object.entries(bars).map(([id, list]) => [id, [...list as string[]]])), main: [...defaults.main], tools: [...defaults.tools] },
    size: { ...Object.fromEntries(Object.entries(record(raw.size) ? raw.size : {}).filter(([, value]) => value === 's' || value === 'm' || value === 'l')), main: 'm', tools: 'm' },
    hidden: strings(raw.hidden) ? [...raw.hidden] : [],
    // fromEntries defines own properties even for __proto__, constructor and toString.
    groups: Object.fromEntries(Object.entries((raw.groups ?? {}) as Record<string, string>)),
  };
  for (const id of ['main', 'tools'] as const) {
    if (own(bars, id)) {
      const list = bars[id] as string[];
      c.bars[id] = upgradeBar(id, version < 2 ? migrate(list, migrations) : list, version);
    }
    const size = record(raw.size) ? raw.size[id] : undefined;
    if (size === 's' || size === 'm' || size === 'l') c.size[id] = size;
  }
  // A customized pre-v11 tools bar retaining isolate must not gain a second copy on main.
  if (version < 11 && c.bars.tools.includes('isolate') && strings(bars.main) && !bars.main.includes('isolate'))
    c.bars.main = c.bars.main.filter((x) => x !== 'isolate');
  return { ok: true, config: c };
}
