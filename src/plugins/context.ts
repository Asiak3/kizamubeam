// Context a generator plugin may declare (#386): the material of the layer its part goes on and the work area of
// the machine. Only these values leave the app, as plain numbers and a name; no editor, document or machine state.
import type { Editor } from '../editor';
import { library, pairSide } from '../materials';
import type { PluginContext } from './manifest';

/** What host.context("material") answers; every value null when the app does not know it */
export interface MaterialContext {
  /** Material and title of the library entry on the layer, e.g. "Plywood 3 mm" */
  name: string | null;
  /** Thickness in mm */
  thickness: number | null;
  /** Calibrated kerf width in mm (material test) */
  kerf: number | null;
  /** Calibrated play per side for two parts fitted into each other (deprecated: use pairPlayTotal), in mm */
  pairPlay: number | null;
  /** Calibrated total play of two parts fitted into each other (both sides together), in mm */
  pairPlayTotal: number | null;
  /** Calibrated slot width over the thickness, in mm */
  slotPlay: number | null;
}

/** What host.context("workArea") answers: the machine's work area in mm */
export interface WorkAreaContext {
  width: number;
  height: number;
}

/** Layer whose material a generator dialog uses (the edited part's layer, or the current layer while creating) */
let dialogLayer: number | null = null;
export const setContextLayer = (layer: number | null) => void (dialogLayer = layer);

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null);

/** The context the editor gives a plugin; null for a layer without material */
export function editorContext(ed: Editor, what: PluginContext): MaterialContext | WorkAreaContext | null {
  if (what === 'workArea') return { width: num(ed.doc.bed.w) ?? 0, height: num(ed.doc.bed.h) ?? 0 };
  const e = library.get(ed.layer(dialogLayer ?? ed.currentLayer).material);
  if (!e) return null;
  return {
    name: [e.material, e.title].filter(Boolean).join(' ').slice(0, 200) || null,
    thickness: num(e.thickness),
    kerf: num(e.fit?.kerf),
    // The library holds the total play (#402); pairPlay stays what it always was, the play per side
    pairPlay: num(e.fit && pairSide(e.fit)),
    pairPlayTotal: num(e.fit?.pair),
    slotPlay: num(e.fit?.slot),
  };
}
