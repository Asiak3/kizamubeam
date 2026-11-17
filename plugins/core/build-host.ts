// Stand-in for src/generators/build inside the generators built as plugins: the "nested" part layout runs in the
// app through the host function `nest` (the same nestParts), which is many times faster than in QuickJS. Everything
// else is the real module.
import type { Pt, SubPath } from '../../src/model';
import { packParts } from '../../src/generators/build.ts';

export * from '../../src/generators/build.ts';

export function nestParts<T extends { key: string; subs: SubPath[] }>(items: T[], gap: number): { key: string; subs: SubPath[]; at: Pt }[] {
  if (items.length < 2) return packParts(items, gap);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const at: [number, number][] = (globalThis as any).host.nest({ parts: items.map((it) => ({ key: it.key, subs: it.subs })), gap });
  return items.map((it, i) => ({ key: it.key, subs: it.subs, at: { x: at[i][0], y: at[i][1] } }));
}

export function arrangeParts<T extends { key: string; subs: SubPath[] }>(items: T[], gap: number, layout: unknown): (T & { at: Pt })[] {
  const placed = layout === 'packed' || layout === 'rows' ? packParts(items, gap) : nestParts(items, gap);
  return items.map((it, i) => ({ ...it, at: placed[i].at }));
}

export function layoutParts<T extends { key: string; subs: SubPath[]; at: Pt }>(parts: T[], gap: number, layout: unknown): T[] {
  if (layout === 'rows') return parts;
  const placed = layout === 'packed' ? packParts(parts, gap) : nestParts(parts, gap);
  return parts.map((p, i) => ({ ...p, at: placed[i].at }));
}
