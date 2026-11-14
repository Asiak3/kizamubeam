// Updates: passenden Release auf GitHub finden (Kanal stabil oder Nightly) und über den Updater in Rust
// (src-tauri/src/updater.rs) prüfen und installieren. Die Auswahl ist reine Logik und wird mit
// `npm run test:updates` geprüft.

/** stable: only stable releases; nightly: nightly builds from main, release candidates and stable releases */
export type Channel = 'stable' | 'nightly';

export const RELEASES_API = 'https://api.github.com/repos/negurvulkan/kizamubeam/releases?per_page=100';
export const RELEASES_PAGE = 'https://github.com/negurvulkan/kizamubeam/releases';

export interface GhRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url?: string;
  assets: { name: string; browser_download_url: string }[];
}

export interface Candidate {
  version: string;
  manifest: string;
  page?: string;
}

/** Semver-Vergleich mit Vorabversionen: 1.2.0-beta < 1.2.0-beta.2 < 1.2.0 < 1.3.0-alpha */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre] = v.replace(/^v/, '').split('+')[0].split(/-(.*)/s);
    return { nums: core.split('.').map((n) => parseInt(n, 10) || 0), pre: pre ? pre.split('.') : [] };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && +p !== +q) return +p - +q;
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Nightly builds are versioned like 2.9.0-nightly.20261114.12 */
export const isNightly = (version: string) => /-nightly(\.|$)/.test(version);

/** Default: a nightly build stays on nightly, everything else (stable, release candidates) gets stable updates */
export const defaultChannel = (current: string): Channel => (isNightly(current) ? 'nightly' : 'stable');

/**
 * Channel from the stored setting. The former 'beta' channel (and anything unknown) becomes 'stable', so
 * existing beta testers are never moved to untested nightly builds without choosing them.
 */
export function resolveChannel(stored: string | null, current: string): Channel {
  if (stored === null) return defaultChannel(current);
  return stored === 'nightly' ? 'nightly' : 'stable';
}

/** Releases der App heißen v1.2.3…; andere Programme im selben Repo (Virtual Machine: vm-v0.1.0) nicht */
export const isAppTag = (tag: string) => /^v?\d/.test(tag);

/**
 * Neuester veröffentlichter Release des Kanals, der eine latest.json hat und neuer als `current` ist.
 * Releases, deren Build noch läuft (noch keine latest.json), werden übersprungen.
 */
export function pickRelease(releases: GhRelease[], channel: Channel, current: string): Candidate | null {
  let best: Candidate | null = null;
  for (const r of releases) {
    if (r.draft || (r.prerelease && channel !== 'nightly') || !isAppTag(r.tag_name)) continue;
    const manifest = r.assets.find((a) => a.name === 'latest.json');
    if (!manifest) continue;
    const version = r.tag_name.replace(/^v/, '');
    if (compareVersions(version, current) <= 0) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, manifest: manifest.browser_download_url, page: r.html_url };
  }
  return best;
}
