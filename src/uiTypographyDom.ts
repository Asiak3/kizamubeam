// DOM-Anbindung der UI-Schriftgruppen (src/uiTypography.ts): setzt vier
// CSS-Faktoren (--ty-*) auf ein Root-Element. Kein globales Zoom, keine
// Änderung an :root-Basis (12 px) oder Schriftfamilien.
import { getTypography, initTypography, onTypographyChange, resolveTypography, ResolvedTypography, TypographyGroup } from './uiTypography';

export const TYPO_VARS: Readonly<Record<TypographyGroup, string>> = {
  interface: '--ty-interface',
  supporting: '--ty-supporting',
  technical: '--ty-technical',
  workspace: '--ty-workspace',
};

const GROUPS = Object.keys(TYPO_VARS) as TypographyGroup[];

/** Gelöste Faktoren auf ein Root-Element schreiben (reiner Anwender, liest nur `resolved`). */
export function applyTypography(root: HTMLElement, resolved: ResolvedTypography): void {
  for (const g of GROUPS) root.style.setProperty(TYPO_VARS[g], String(resolved.factors[g]));
}

/** Aktuellen Stand auf ein Root-Element anwenden (Standard: Dokument). */
export function refreshTypographyDom(root: HTMLElement = document.documentElement): void {
  applyTypography(root, resolveTypography(getTypography()));
}

/** Zustand laden, Dokument initial anwenden, Änderungen live übernehmen. Gibt Abmelder zurück. */
export function initTypographyDom(root: HTMLElement = document.documentElement): () => void {
  initTypography();
  refreshTypographyDom(root);
  return onTypographyChange(() => refreshTypographyDom(root));
}
