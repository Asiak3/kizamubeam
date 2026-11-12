import type { Editor } from '../editor';
import { Doc, Mat, Obj, Shape, defaultLayer, isOff, mul, IDENT } from '../model';
import { contourOffsetShape, offsetContours, offsetResults, offsetSource, offsetClosureOwners, offsetRemainderKey, readContourOffset, type OffsetContours, type OffsetSource, type TrimmedOffsetSpan } from '../contourOffset';
import { t } from '../i18n';
import { assessOffsetOutput } from '../contourOffsetValidation';

export interface ContourOffsetSession {
  doc: Doc; stamp: string; tool: Editor['tool']; isolation: Editor['isolation'];
  roots: Obj[]; leaves: Obj[]; sources: OffsetSource[]; plan: OffsetContours; tolerance: number;
}
export interface ContourOffsetApplyOptions {
  exclusions?: ReadonlyMap<number, readonly TrimmedOffsetSpan[]>;
  removeRemainders?: ReadonlySet<string>; confirmedRemainderRemoval?: boolean; confirmedClosureKerf?: boolean;
  confirmedManufacturability?: boolean;
  assemblyOwners?: ReadonlyMap<string, number>; confirmedAssembly?: boolean;
  confirmedOpenRemainders?: boolean;
}
export function offsetAssemblyOutputConflict(session: ContourOffsetSession, owners: ReadonlyMap<string, number>, amounts: ReadonlyMap<string, number>): boolean {
  const laserState = (id: number) => {
    const walk = (obj: Obj, disabled = false): boolean | undefined => {
      const off = disabled || !!obj.noLaser;
      if (obj.id === id) return off;
      if (obj.shape.kind === 'group') for (const child of obj.shape.children) { const found = walk(child, off); if (found !== undefined) return found; }
    };
    for (const root of session.roots) { const found = walk(root); if (found !== undefined) return found; }
    return true;
  };
  return [...owners].some(([key]) => amounts.has(key) && new Set(session.plan.contours.find(c => c.key === key)?.members.map(m => {
    const obj = session.leaves[m.owner], layer = session.doc.layers[obj.layer] ?? defaultLayer(obj.layer);
    return `${laserState(obj.id)}:${layer.output}:${layer.sub?.filter(s => s.output).length ?? 0}`;
  })).size > 1);
}
function current(ed: Editor, s: ContourOffsetSession): void {
  if (ed.doc !== s.doc || ed.state() !== s.stamp || ed.tool !== s.tool || ed.isolation !== s.isolation ||
    ed.drag || ed.draft || ed.sketchEdit || ed.pickHandler) throw new Error(t('Auswahl oder Quelle geändert. Konturversatz erneut öffnen.'));
}

function sourcesOf(ed: Editor, roots: Obj[]): { objects: Obj[]; sources: OffsetSource[] } {
  const objects: Obj[] = [], sources: OffsetSource[] = [], ids = new Set<number>();
  const walk = (o: Obj, parent: Mat, root: number) => {
    const layer = ed.doc.layers[o.layer] ?? defaultLayer(o.layer);
    if (isOff(o) || o.locked || !layer.show || layer.locked || o.mates?.length ||
      (o.bind && ['w', 'h', 'r', 'sides', 'size'].some(k => k in o.bind!)))
      throw new Error(t('Konturversatz: sichtbare, entsperrte Vektorformen ohne Form- oder Verbindungsbindungen auswählen.'));
    const matrix = mul(parent, o.m);
    if (o.shape.kind === 'group') { o.shape.children.forEach(child => walk(child, matrix, root)); return; }
    if (ids.has(o.id) || objects.length >= 128) throw new Error(t('Konturversatz: zu viele oder nicht eindeutig zuordenbare Quellobjekte.'));
    ids.add(o.id); objects.push(o); sources.push({ ...offsetSource(o.id, o.shape, matrix), root });
  };
  for (const root of roots) {
    if (!ed.selectable(root)) throw new Error(t('Konturversatz: sichtbare, entsperrte Vektorformen auswählen.'));
    walk(root, IDENT, root.id);
  }
  return { objects, sources };
}

export class EditorContourOffset {
  prepareContourOffset(this: Editor, tolerance?: number): ContourOffsetSession {
    if (!this.sel.length || this.sel.length > 32 || this.drag || this.draft || this.sketchEdit || this.pickHandler || this.tool === 'builder')
      throw new Error(t('Für den Konturversatz 1 bis 32 Quellobjekte oder Gruppen auswählen und laufende Bearbeitung beenden.'));
    const roots = this.doc.objs.filter(o => this.sel.includes(o));
    const { objects, sources } = sourcesOf(this, roots);
    const previous = sources.flatMap(s => s.edits.map(e => e.tolerance));
    const tol = tolerance ?? (previous.length ? Math.max(...previous) : 0.01);
    return { doc: this.doc, stamp: this.state(), tool: this.tool, isolation: this.isolation, roots, leaves: objects, sources,
      tolerance: tol, plan: offsetContours(sources, tol) };
  }

  updateContourOffset(this: Editor, session: ContourOffsetSession, tolerance: number): void {
    current(this, session);
    const plan = offsetContours(session.sources, tolerance);
    session.plan = plan; session.tolerance = tolerance;
  }

  applyContourOffset(this: Editor, session: ContourOffsetSession, amounts: ReadonlyMap<string, number>, permanent = false, confirmed = false,
    options: ContourOffsetApplyOptions = {}): boolean {
    current(this, session); sourcesOf(this, session.roots);
    if (permanent && !confirmed) throw new Error(t('Dauerhaftes Festschreiben muss ausdrücklich bestätigt werden.'));
    const removeRemainders = options.removeRemainders ?? new Set(session.sources.flatMap(s=>(s.trimmed??[]).map(span=>offsetRemainderKey(s.id,span))));
    const savedRemovals = new Set(session.sources.flatMap(s=>(s.trimmed??[]).map(span=>offsetRemainderKey(s.id,span))));
    if ([...removeRemainders].some(key=>!savedRemovals.has(key)) && !options.confirmedRemainderRemoval)
      throw new Error(t('Das Entfernen der angezeigten Reststücke muss ausdrücklich bestätigt werden.'));
    const savedOwners = new Map(session.sources.flatMap(s => s.edits.flatMap(e => e.outputOwner === undefined ? [] : [[e.token, e.outputOwner] as const])));
    const assemblyOwners = options.assemblyOwners ?? savedOwners;
    if ([...assemblyOwners].some(([key, owner]) => amounts.has(key) && savedOwners.get(key) !== owner) && !options.confirmedAssembly)
      throw new Error(t('Das gemeinsame geschlossene Ergebnis und sein Ausgabeobjekt müssen ausdrücklich bestätigt werden.'));
    if (offsetAssemblyOutputConflict(session, assemblyOwners, amounts))
      throw new Error(t('Gemeinsames Ergebnis gesperrt: Beteiligte Quellen haben unterschiedliche Laser-/Ausgabefreigaben. Diese zuerst ausdrücklich vereinheitlichen.'));
    const closureKerf = offsetClosureOwners(session.plan,session.sources,amounts,assemblyOwners).some(owner=>{
      const id = session.leaves[owner].layer;
      return Math.abs((this.doc.layers[id] ?? defaultLayer(id)).kerf)>1e-12;
    });
    if (closureKerf && !options.confirmedClosureKerf)
      throw new Error(t('Neu geschlossene Konturen berücksichtigen den vorhandenen Layer-Kerf. Diese zusätzliche Ausgabewirkung muss ausdrücklich bestätigt werden.'));
    const result = offsetResults(session.sources, session.plan, amounts, session.tolerance, removeRemainders, options.exclusions, assemblyOwners);
    const assessment = assessOffsetOutput(session.sources, result.recipes, result.preview,
      session.leaves.map(o => this.doc.layers[o.layer] ?? defaultLayer(o.layer)));
    if (assessment.unsafe.length) throw new Error(t('Ergebnis gesperrt: Der Versatz erzeugt neue offene oder unverbundene Konturen oder eine ungeklärte Kerf-/Füllwirkung. Problematische Kontur abwählen oder Reststücke gezielt prüfen.'));
    if (assessment.warnings.includes('open-source-remainders') && !options.confirmedOpenRemainders)
      throw new Error(t('Verbleibende offene Quellreste und ihre geänderte Kerf-Wirkung müssen ausdrücklich bestätigt werden.'));
    if (assessment.warnings.some(w => w === 'small-area' || w === 'narrow-span') && !options.confirmedManufacturability)
      throw new Error(t('Kleine oder schmale Ergebnisbereiche müssen vor dem Anwenden ausdrücklich bestätigt werden.'));
    const replacements: { object: Obj; shape: Shape }[] = [];
    session.leaves.forEach((object, i) => {
      const recipe = result.recipes[i];
      let shape: Shape;
      if (recipe) shape = permanent ? { kind: 'path', subs: recipe.result } : contourOffsetShape(recipe);
      else shape = readContourOffset(object.shape) ? structuredClone(session.sources[i].source) : object.shape;
      if (JSON.stringify(shape) !== JSON.stringify(object.shape)) replacements.push({ object, shape });
    });
    if (!replacements.length) return false;
    this.snapshot(permanent ? t('Konturversatz dauerhaft festschreiben') : t('Lokalen Konturversatz ändern'));
    for (const { object, shape } of replacements) { object.shape = shape; this.touch(shape); }
    this.emit('doc'); return true;
  }
}
