// Texts of the findings of the geometric checks (checkGeom.ts), shared by the design check and the host function
// check of plugins (#388).
import { dec, t, tn } from './i18n';
import type { GeomIssue } from './checkGeom';

export const fmt = (v: number) => dec(v < 10 ? v.toFixed(2) : v.toFixed(1));

/** Text of a finding of the geometric checks */
export function geomText(f: Pick<GeomIssue, 'code' | 'values'>): string {
  const v = f.values ?? {};
  switch (f.code) {
    case 'double-whole':
      return t('Diese Kontur würde zweimal geschnitten (deckungsgleiches Objekt).');
    case 'double':
      return t('{len} mm würden zweimal geschnitten (deckungsgleiche Linien).', { len: fmt(v.len ?? 0) });
    case 'unjoined':
      return tn(
        'Diese Linie bildet einen Umriss, ist aber nicht verbunden: Kerf und Füllen wirken nur auf geschlossene Formen.',
        'Diese {n} Linien bilden einen Umriss, sind aber nicht verbunden: Kerf und Füllen wirken nur auf geschlossene Formen.',
        v.n ?? 1,
      );
    case 'open':
      return t('Dieser Umriss ist nicht geschlossen (Lücke {gap} mm).', { gap: fmt(v.gap ?? 0) });
    case 'open-fill':
      return t('Offene Linie auf einem Füll-Layer: Sie wird nicht gelasert.');
    case 'hole-lost':
      return t('Der Kerf-Ausgleich ({k} mm) lässt diesen Ausschnitt verschwinden.', { k: fmt(v.k ?? 0) });
    case 'hole-small':
      return t('Der Ausschnitt ist für die Schnittbreite ({b} mm) zu klein.', { b: fmt(v.b ?? 0) });
    case 'web-cut':
      return t('Die Schnitte berühren sich hier: Das Material wird durchtrennt.');
    case 'web':
      return t('Steg nur {w} mm breit: Er könnte beim Schneiden brechen.', { w: fmt(v.w ?? 0) });
  }
}

const GEOM_CODES = new Set<string>(['double', 'double-whole', 'unjoined', 'open', 'open-fill', 'hole-lost', 'hole-small', 'web', 'web-cut']);

/** Text of a finding of the host function check of plugins (code check-<what>, #388); undefined for other codes */
export function checkCodeText(code: string, values?: Record<string, unknown>): string | undefined {
  if (!code.startsWith('check-')) return undefined;
  const v: Record<string, number> = {};
  for (const [k, x] of Object.entries(values ?? {})) if (typeof x === 'number' && Number.isFinite(x)) v[k] = x;
  const what = code.slice(6);
  if (what === 'too-big')
    return t('Das Teil ({w} × {h} mm) passt nicht auf die Arbeitsfläche ({aw} × {ah} mm).', { w: fmt(v.w ?? 0), h: fmt(v.h ?? 0), aw: fmt(v.aw ?? 0), ah: fmt(v.ah ?? 0) });
  return GEOM_CODES.has(what) ? geomText({ code: what as GeomIssue['code'], values: v }) : undefined;
}
