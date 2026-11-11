import type { Editor } from '../editor';
import { Doc, Obj, Pt, SubPath, defaultLayer, IDENT, isOff, newId } from '../model';
import { shapeSubs } from '../geom';
import { OutlinePlan, preciseOutlinePlan, outlineResult, type OutlineMode } from '../outline';
import { t } from '../i18n';
import { pruneMultiLayers } from '../multilayer';

export interface OutlineSession {
  doc: Doc; stamp: string; sources: Obj[]; plan: OutlinePlan;
  geometry: Obj[];
  tool: Editor['tool']; isolation: Editor['isolation']; noLaser: boolean;
}

/** Transient workspace overlay and input owner; never serialized or sent to output. */
export interface OutlinePreview {
  subs: SubPath[]; holes: SubPath[][]; hover: number;
  original?: SubPath[];
  excluded?: SubPath[]; removed?: SubPath[];
  pick: (point: Pt) => void; move: (point: Pt) => void; cancel: () => void;
}

function plan(geometry: Obj[], tolerance?: number, allowEmpty = false): OutlinePlan {
  try { return preciseOutlinePlan(geometry, tolerance, allowEmpty); }
  catch (error) {
    if (error instanceof Error && error.message === 'outline-boundary') throw new Error(t('Konturgrenze nicht eindeutig aus den Quellkurven ableitbar. Verbindungstoleranz und Übergänge prüfen.'));
    throw new Error(t('Arbeitsgrenze der Außenkontur erreicht oder keine geschlossene Fläche vorhanden.'));
  }
}

function validate(ed: Editor, sources: Obj[]): boolean {
  let count = 0, disabled = false;
  const walk = (o: Obj) => {
    if (isOff(o) || o.locked || !o.m.every(Number.isFinite))
      throw new Error(t('Für die Außenkontur nur sichtbare, entsperrte Formen auswählen.'));
    disabled ||= !!o.noLaser;
    if (o.shape.kind === 'group') { for (const child of o.shape.children) walk(child); return; }
    const layer = ed.doc.layers[o.layer] ?? defaultLayer(o.layer);
    if (!layer.show || layer.locked) throw new Error(t('Für die Außenkontur nur sichtbare, entsperrte Formen auswählen.'));
    disabled ||= !layer.output;
    if (o.shape.kind === 'image') throw new Error(t('Außenkontur: Bilder werden nicht unterstützt.'));
    if (o.shape.kind === 'text') return; // Converted on copies after loading fonts.
    const subs = shapeSubs(o.shape);
    if (!subs.length || subs.some((s) => s.nodes.length < 2))
      throw new Error(t('Außenkontur: keine auswertbaren Pfade vorhanden.'));
    for (const s of subs) for (const n of s.nodes) {
      if (![n, n.cin, n.cout].filter(Boolean).every((p) => Number.isFinite(p!.x) && Number.isFinite(p!.y)))
        throw new Error(t('Außenkontur: ungültige Koordinaten.'));
      if (++count > 16384) throw new Error(t('Arbeitsgrenze der Außenkontur erreicht. Weniger oder einfachere Formen auswählen.'));
    }
  };
  for (const o of sources) {
    if (!ed.selectable(o)) throw new Error(t('Für die Außenkontur nur sichtbare, entsperrte Formen auswählen.'));
    walk(o);
  }
  return disabled;
}

function current(ed: Editor, session: OutlineSession) {
  return ed.doc === session.doc && ed.state() === session.stamp && ed.tool === session.tool &&
    ed.isolation === session.isolation && !ed.drag && !ed.draft && !ed.sketchEdit && !ed.pickHandler;
}

export class EditorOutline {
  async prepareOutline(this: Editor, tolerance?: number, allowEmpty = false): Promise<OutlineSession> {
    if (!this.sel.length || this.sel.length > 32 || this.drag || this.draft || this.sketchEdit || this.pickHandler)
      throw new Error(t('Für die Außenkontur 1 bis 32 Formen auswählen und laufende Bearbeitung beenden.'));
    const sources = this.doc.objs.filter((o) => this.sel.includes(o));
    const noLaser = validate(this, sources);
    const session: OutlineSession = { sources, doc: this.doc, stamp: this.state(), tool: this.tool,
      isolation: this.isolation, noLaser, geometry: [], plan: { outer: [], holes: [] } };
    const copies = await this.withTextOutlines(sources);
    if (!current(this, session)) throw new Error(t('Auswahl oder Quelle geändert. Außenkontur erneut öffnen.'));
    session.geometry = copies;
    session.plan = plan(copies, tolerance, allowEmpty);
    return session;
  }

  updateOutline(this: Editor, session: OutlineSession, tolerance: number): void {
    if (!current(this, session)) throw new Error(t('Auswahl oder Quelle geändert. Außenkontur erneut öffnen.'));
    session.plan = plan(session.geometry, tolerance, true);
  }

  applyOutline(this: Editor, session: OutlineSession, holes: ReadonlySet<number>, layer: number,
    keepOriginals = true, replaceConfirmed = false, mode: OutlineMode = 'combined',
    // `confirmed` remains accepted for earlier local callers; approximation
    // selection is now informational, not a modal-confirmation workflow.
    approximation: { islands?: ReadonlySet<number>; confirmed?: boolean } = {}): Obj {
    if (!current(this, session)) throw new Error(t('Auswahl oder Quelle geändert. Außenkontur erneut öffnen.'));
    validate(this, session.sources);
    const target = this.doc.layers[layer] ?? defaultLayer(layer);
    if (!Number.isInteger(layer) || layer < 0 || layer >= 32 || target.locked || !target.show)
      throw new Error(t('Eine sichtbare, entsperrte Zielebene wählen.'));
    if (!keepOriginals && !replaceConfirmed) throw new Error(t('Das Ersetzen der Originale muss ausdrücklich bestätigt werden.'));
    const approximateIslands=approximation.islands??new Set<number>();
    const subs = outlineResult(session.plan, holes, mode, approximateIslands);
    if (!subs.length) throw new Error(t('Keine Kontur für den gewählten Ausgabemodus vorhanden. Inseln auswählen oder den Modus ändern.'));
    const approximated=mode!=='outer'&&approximateIslands.size>0;
    const name=mode==='islands'?(approximated?t('Inselkonturen (mit Näherung)'):t('Inselkonturen')):
      approximated?t('Außenkontur (mit angenäherten Inseln)'):t('Außenkontur');
    const result: Obj = { id: newId(), m: [...IDENT], layer, name, shape: { kind: 'path', subs } };
    if (session.noLaser) result.noLaser = true;
    this.snapshot(t('Außenkontur und Inseln ableiten'));
    if (!keepOriginals) {
      this.doc.objs = this.doc.objs.filter((o) => !session.sources.includes(o));
      pruneMultiLayers(this.doc);
    }
    this.doc.objs.push(result);
    this.setSel([result]); this.emit('doc');
    return result;
  }
}
