// Editor: Projekt-Parameter anlegen, ändern, umbenennen und löschen. Nach jeder Änderung werden Texte und
// QR-Codes mit Platzhaltern und Bauteile mit Formeln (GenShape.bind) auf allen Seiten neu berechnet.
import { about, allObjs, GenShape, leaves, mul, Obj, OBJ_BIND_KEYS, ObjBindKey, ObjBinds, rotate, scale, translate } from '../model';
import { boundsOf } from '../geom';
import { buildGen, getGenerator, resolveBinds } from '../generators';
import type { Issue } from '../generators';
import {
  coerce, defaultValue, evaluate, hasPlaceholders, nameError, ParamType, ProjectParam, renameInExpr, renameInTemplate, Scope, scopeOf, usesName,
} from '../params';
import { t } from '../i18n';
import type { Editor } from '../editor';
import { normalizeTemplate, TemplateInfo } from '../templates';
import { renameSketchParam, sketchUsesParam } from './sketch';

export class EditorParams {
  /** Parameter des Projekts (leer, wenn es keine gibt) */
  paramList(this: Editor): ProjectParam[] {
    return this.doc.params ?? [];
  }
  findParam(this: Editor, name: string): ProjectParam | undefined {
    const k = name.toLowerCase();
    return this.paramList().find((p) => p.name.toLowerCase() === k);
  }
  /** Neuer Parameter; ohne Namen „Zahl1“, „Text1“ … */
  addParam(this: Editor, type: ParamType, init: Partial<ProjectParam> = {}): ProjectParam {
    const base = init.name || { number: t('Zahl'), text: t('Text'), bool: t('Schalter') }[type];
    let name = base;
    if (!init.name) for (let i = 1; this.findParam(name) || nameError(name, this.paramList()); i++) name = `${base}${i}`;
    const err = nameError(name, this.paramList());
    if (err) throw new Error(err);
    const p: ProjectParam = { ...init, name, type, value: defaultValue(type) };
    p.value = coerce(p, init.value ?? p.value);
    this.snapshot(t('Parameter „{name}“ anlegen', { name }));
    (this.doc.params ??= []).push(p);
    this.emit('doc');
    return p;
  }
  /**
   * Eigenschaften ändern (Name, Bereich, Einheit …). Ein neuer Name wird in allen Platzhaltern und Formeln
   * des Projekts mit umbenannt.
   */
  editParam(this: Editor, p: ProjectParam, patch: Partial<ProjectParam>, undo = true) {
    if (patch.name !== undefined && patch.name !== p.name) {
      const err = nameError(patch.name, this.paramList(), p);
      if (err) throw new Error(err);
    }
    if (undo) this.snapshot(t('Parameter „{name}“ ändern', { name: p.name }));
    const from = p.name;
    Object.assign(p, patch);
    for (const k of ['min', 'max', 'step', 'unit', 'note'] as const) if (p[k] === undefined || p[k] === '') delete p[k];
    if (p.type !== 'number') for (const k of ['min', 'max', 'step', 'unit'] as const) delete p[k];
    p.value = coerce(p, patch.value ?? p.value);
    if (p.name !== from) this.renameParamRefs(from, p.name);
    this.applyParams();
  }
  /** Wert setzen. undo = false: ohne eigenen Schritt (z. B. während der Schieberegler gezogen wird) */
  setParamValue(this: Editor, p: ProjectParam, v: unknown, undo = true) {
    const nv = coerce(p, v);
    if (nv === p.value) return;
    if (undo) this.snapshot(t('Parameter „{name}“ ändern', { name: p.name }));
    p.value = nv;
    this.applyParams();
  }
  /** Mehrere Werte auf einmal (ein Schritt), z. B. von einem KI-Agenten */
  setParamValues(this: Editor, values: Record<string, unknown>) {
    const list = Object.entries(values).map(([k, v]) => {
      const p = this.findParam(k);
      if (!p) throw new Error(t('Unbekannter Parameter „{name}“', { name: k }));
      return [p, coerce(p, v)] as const;
    });
    if (list.every(([p, v]) => p.value === v)) return;
    this.snapshot(t('Parameter ändern'));
    for (const [p, v] of list) p.value = v;
    this.applyParams();
  }
  /** Löschen: Platzhalter bleiben als Text stehen, Formeln an Bauteilen werden zu ihrem letzten Wert */
  removeParam(this: Editor, p: ProjectParam) {
    this.snapshot(t('Parameter „{name}“ löschen', { name: p.name }));
    this.doc.params = this.paramList().filter((x) => x !== p);
    if (!this.doc.params.length) delete this.doc.params;
    if (this.doc.template) this.doc.template.fields = this.doc.template.fields.filter((f) => f.name !== p.name);
    for (const o of allObjs(this.doc)) {
      if (o.showIf && usesName(o.showIf, p.name, false)) delete o.showIf;
      if (!o.bind) continue;
      for (const k of OBJ_BIND_KEYS) if (o.bind[k] && usesName(o.bind[k]!, p.name, false)) delete o.bind[k];
      if (!OBJ_BIND_KEYS.some((k) => o.bind![k])) delete o.bind;
    }
    for (const [o] of leaves(allObjs(this.doc))) {
      const s = o.shape;
      if (s.kind !== 'gen' || !s.bind) continue;
      for (const [k, src] of Object.entries(s.bind)) if (usesName(src, p.name, false)) delete s.bind[k];
      if (!Object.keys(s.bind).length) delete s.bind;
    }
    this.applyParams();
  }
  moveParam(this: Editor, p: ProjectParam, to: number) {
    const list = this.paramList();
    const from = list.indexOf(p);
    if (from < 0 || to === from || to < 0 || to >= list.length) return;
    this.snapshot(t('Parameter „{name}“ verschieben', { name: p.name }));
    list.splice(from, 1);
    list.splice(to, 0, p);
    this.emit('doc');
  }
  renameParamRefs(this: Editor, from: string, to: string) {
    for (const f of this.doc.template?.fields ?? []) if (f.name.toLowerCase() === from.toLowerCase()) f.name = to;
    for (const o of allObjs(this.doc)) {
      if (o.showIf) o.showIf = renameInExpr(o.showIf, from, to);
      if (o.bind) for (const k of OBJ_BIND_KEYS) if (o.bind[k]) o.bind[k] = renameInExpr(o.bind[k]!, from, to);
    }
    for (const [o] of leaves(allObjs(this.doc))) {
      const s = o.shape;
      if (s.kind === 'text') s.text = renameInTemplate(s.text, from, to);
      else if (s.kind === 'barcode') s.data = renameInTemplate(s.data, from, to);
      else if (s.kind === 'gen' && s.bind) for (const k of Object.keys(s.bind)) s.bind[k] = renameInExpr(s.bind[k], from, to);
      renameSketchParam(o, from, to);
    }
  }
  /** Wo wird der Parameter benutzt? (Objekte auf allen Seiten) */
  paramUsers(this: Editor, p: ProjectParam): Obj[] {
    const out: Obj[] = [];
    const usedTop = (o: Obj) =>
      (!!o.showIf && usesName(o.showIf, p.name, false)) || (!!o.bind && OBJ_BIND_KEYS.some((k) => !!o.bind![k] && usesName(o.bind![k]!, p.name, false)));
    for (const o of allObjs(this.doc)) if (usedTop(o)) out.push(o);
    for (const [o] of leaves(allObjs(this.doc))) {
      if (out.includes(o)) continue;
      const s = o.shape;
      const used =
        s.kind === 'text' ? usesName(s.text, p.name, true)
        : s.kind === 'barcode' ? usesName(s.data, p.name, true)
        : s.kind === 'gen' && s.bind ? Object.values(s.bind).some((src) => usesName(src, p.name, false))
        : sketchUsesParam(o, p.name);
      if (used) out.push(o);
    }
    return out;
  }
  /**
   * Alles neu berechnen, was von Parametern abhängt: Texte und QR-Codes mit Platzhaltern zeichnen neu,
   * Bauteile mit Formeln bekommen neue Geometrie (Baugruppen einmal je Baugruppe). Gibt die Probleme zurück.
   */
  applyParams(this: Editor): { obj: Obj; issues: Issue[] }[] {
    const scope = scopeOf(this.paramList());
    const problems: { obj: Obj; issues: Issue[] }[] = [];
    const doneAsm = new Set<string>();
    // Erst sammeln: Neu berechnete Baugruppen können Teile entfernen oder hinzufügen
    for (const [o] of [...leaves(allObjs(this.doc))]) {
      const s = o.shape;
      if ((s.kind === 'text' && hasPlaceholders(s.text)) || (s.kind === 'barcode' && hasPlaceholders(s.data))) this.touch(s);
      if (s.kind === 'gen' && s.gen === 'sketch') {
        const issues = this.refreshSketchParams(o, scope);
        if (issues.length) problems.push({ obj: o, issues });
        continue;
      }
      if (s.kind !== 'gen' || !s.bind) continue;
      if (s.asm) {
        if (doneAsm.has(s.asm)) continue;
        doneAsm.add(s.asm);
      }
      const g = getGenerator(s.gen);
      if (!g) continue;
      const { params, issues } = resolveBinds(g, s.params, s.bind, scope);
      const changed = g.schema.some((x) => params[x.key] !== s.params[x.key]);
      if (changed) {
        const r = buildGen(g, params);
        for (const pt of r.parts) pt.shape.bind = { ...s.bind };
        if (r.parts.length) this.updateGen(o, r, true);
        issues.push(...r.issues.filter((i) => i.level === 'error'));
      }
      if (issues.length) problems.push({ obj: o, issues });
    }
    // Danach Lage und Größe: Texte und Bauteile haben jetzt ihre neuen Maße
    for (const o of allObjs(this.doc)) {
      if (!o.bind) continue;
      const issues = this.applyObjBinds(o, scope);
      if (issues.length) problems.push({ obj: o, issues });
    }
    this.paramProblems = problems;
    this.emit('doc');
    this.emit('sel');
    return problems;
  }
  /** Formeln eines Bauteils setzen (leere Formel = Feld wieder fest) und neu berechnen */
  setGenBinds(this: Editor, o: Obj, bind: Record<string, string>) {
    if (o.shape.kind !== 'gen') return;
    const s = o.shape as GenShape;
    const next = { ...s.bind };
    for (const [k, v] of Object.entries(bind)) {
      if (v.trim()) next[k] = v.trim();
      else delete next[k];
    }
    const members = s.asm ? this.asmMembers(s.asm).map((m) => m.o) : [o];
    for (const m of members) {
      const ms = m.shape as GenShape;
      if (Object.keys(next).length) ms.bind = { ...next };
      else delete ms.bind;
    }
  }
  /**
   * Formeln eines Objekts anwenden (oberste Ebene): erst Formmaße (Eckenradius, Ecken, Schriftgröße,
   * Höchstmaße), dann Drehung, dann Größe des Rahmens, zuletzt die Lage am Bezugspunkt. Ohne Undo-Schritt.
   */
  applyObjBinds(this: Editor, o: Obj, scope: Scope = scopeOf(this.paramList())): Issue[] {
    const b = o.bind;
    if (!b) return [];
    const issues: Issue[] = [];
    const val = (k: ObjBindKey): number | undefined => {
      const src = b[k];
      if (!src) return undefined;
      try {
        const v = evaluate(src, scope);
        const n = typeof v === 'number' ? v : Number(v);
        if (!isFinite(n)) throw new Error(t('Die Formel ergibt keine Zahl.'));
        return n;
      } catch (e) {
        issues.push({ key: k, level: 'error', msg: `${BIND_LABEL()[k]}: ${e instanceof Error ? e.message : String(e)}` });
        return undefined;
      }
    };
    const s = o.shape;
    let touched = false;
    const setShape = (key: string, v: number | undefined) => {
      if (v === undefined || (s as unknown as Record<string, unknown>)[key] === v) return;
      (s as unknown as Record<string, unknown>)[key] = v;
      touched = true;
    };
    if (s.kind === 'rect') setShape('r', ((v) => (v === undefined ? v : Math.max(0, v)))(val('r')));
    if (s.kind === 'polygon') setShape('sides', ((v) => (v === undefined ? v : Math.max(3, Math.min(64, Math.round(v)))))(val('sides')));
    if (s.kind === 'text') {
      setShape('size', ((v) => (v === undefined ? v : Math.max(0.1, v)))(val('size')));
      setShape('maxW', ((v) => (v === undefined ? v : Math.max(0, v)))(val('maxW')));
      setShape('maxH', ((v) => (v === undefined ? v : Math.max(0, v)))(val('maxH')));
    }
    if (touched) this.touch(s);
    const [ax, ay] = b.anchor ?? [0.5, 0.5];
    const rot = val('rot');
    if (rot !== undefined) {
      const cur = (-Math.atan2(o.m[1], o.m[0]) * 180) / Math.PI;
      const bx = boundsOf([o]);
      if (bx && Math.abs(rot - cur) > 1e-9) o.m = mul(about(rotate((-(rot - cur) * Math.PI) / 180), bx.x + ax * bx.w, bx.y + ay * bx.h), o.m);
    }
    const w = val('w'),
      h = val('h');
    if (w !== undefined || h !== undefined) {
      const bx = boundsOf([o]);
      if (s.kind === 'gen') issues.push({ level: 'error', msg: t('Die Größe parametrischer Bauteile kommt aus ihren Parametern; dort eine Formel eintragen.') });
      else if (bx) {
        let sx = w !== undefined && bx.w > 1e-9 ? w / bx.w : 1,
          sy = h !== undefined && bx.h > 1e-9 ? h / bx.h : 1;
        if (b.lock && (w === undefined) !== (h === undefined)) {
          if (w !== undefined) sy = sx;
          else sx = sy;
        }
        const axisAligned = Math.abs(o.m[1]) < 1e-12 && Math.abs(o.m[2]) < 1e-12;
        if (sx > 0 && sy > 0 && isFinite(sx) && isFinite(sy) && (Math.abs(sx - 1) > 1e-9 || Math.abs(sy - 1) > 1e-9)) {
          if (axisAligned && (s.kind === 'rect' || s.kind === 'ellipse')) {
            // Rechteck und Ellipse ohne Drehung: Maße der Form ändern, damit Eckenradius und Kreis rund bleiben
            if (s.kind === 'rect') {
              s.w *= sx;
              s.h *= sy;
            } else {
              s.rx *= sx;
              s.ry *= sy;
            }
            this.touch(s);
            const nb = boundsOf([o])!;
            o.m = mul(translate(bx.x + ax * bx.w - (nb.x + ax * nb.w), bx.y + ay * bx.h - (nb.y + ay * nb.h)), o.m);
          } else o.m = mul(about(scale(sx, sy), bx.x + ax * bx.w, bx.y + ay * bx.h), o.m);
        }
        else if (!(sx > 0 && sy > 0)) issues.push({ level: 'error', msg: t('Breite und Höhe müssen größer als 0 sein.') });
      }
    }
    const x = val('x'),
      y = val('y');
    if (x !== undefined || y !== undefined) {
      const bx = boundsOf([o]);
      if (bx) {
        const tx = x !== undefined ? x - (bx.x + ax * bx.w) : 0;
        const ty = y !== undefined ? this.doc.bed.h - y - (bx.y + ay * bx.h) : 0;
        if (Math.abs(tx) > 1e-9 || Math.abs(ty) > 1e-9) o.m = mul(translate(tx, ty), o.m);
      }
    }
    return issues;
  }
  /**
   * Formel für ein Feld der Zahlenleiste setzen (leer = Formel entfernen) und gleich anwenden. anchor und lock
   * merken sich Bezugspunkt und Seitenverhältnis-Sperre zum Zeitpunkt der Eingabe. Ein Undo-Schritt.
   */
  setObjBind(this: Editor, o: Obj, key: ObjBindKey, src: string, opts: { anchor?: [number, number]; lock?: boolean } = {}): Issue[] {
    this.snapshot(src.trim() ? t('Formel setzen') : t('Formel entfernen'));
    const b: ObjBinds = { ...o.bind };
    if (src.trim()) b[key] = src.trim();
    else delete b[key];
    if (opts.anchor && (key === 'x' || key === 'y' || key === 'w' || key === 'h' || key === 'rot')) b.anchor = opts.anchor;
    if (opts.lock !== undefined && (key === 'w' || key === 'h')) b.lock = opts.lock;
    if (OBJ_BIND_KEYS.some((k) => b[k])) o.bind = b;
    else delete o.bind;
    const issues = this.applyObjBinds(o);
    this.emit('doc');
    this.emit('sel');
    return issues;
  }
  /** Formel eines Feldes lösen, ohne eigenen Undo-Schritt (die folgende Änderung legt ihn an) */
  dropObjBind(this: Editor, objs: Obj[], keys: ObjBindKey[]) {
    for (const o of objs) {
      if (!o.bind) continue;
      for (const k of keys) delete o.bind[k];
      if (!OBJ_BIND_KEYS.some((k) => o.bind![k])) delete o.bind;
    }
  }
  /** Vorlagen-Angaben setzen (null = Projekt ist keine Vorlage mehr); ein Undo-Schritt, wenn sich etwas ändert */
  setTemplate(this: Editor, info: TemplateInfo | null) {
    const next = info ? normalizeTemplate(info, this.paramList()) : undefined;
    if (next) delete next.preview;
    if (JSON.stringify(next) === JSON.stringify(this.doc.template)) return;
    this.snapshot(t('Vorlage einrichten'));
    if (next) this.doc.template = next;
    else delete this.doc.template;
    this.emit('doc');
  }
  /**
   * Vorlage (Inhalt einer .kzt-Datei) als neues Projekt öffnen, ein Undo-Schritt. values: Werte nach
   * Parametername; unbekannte Namen werden gemeldet, bevor sich etwas ändert.
   */
  openTemplate(this: Editor, json: string, values: Record<string, unknown> = {}) {
    const raw = JSON.parse(json) as { params?: ProjectParam[] };
    const known = new Set((raw.params ?? []).map((p) => String(p?.name ?? '').toLowerCase()));
    for (const k of Object.keys(values)) if (!known.has(k.toLowerCase())) throw new Error(t('Unbekannter Parameter „{name}“', { name: k }));
    const bed = { ...this.doc.bed };
    this.openDoc(json);
    // Das Bett des aktuellen Geräts behalten; die Objekte behalten ihre Maschinenkoordinaten (Ursprung unten)
    const dy = bed.h - this.doc.bed.h;
    if (dy) for (const o of allObjs(this.doc)) o.m = mul(translate(0, dy), o.m);
    this.doc.bed = bed;
    if (dy) this.zoomPage();
    const title = this.doc.template?.title;
    this.history.relabel(title ? t('Neu aus Vorlage „{name}“', { name: title }) : t('Neu aus Vorlage'));
    if (this.doc.template) this.doc.template = normalizeTemplate(this.doc.template, this.paramList());
    delete this.doc.template?.preview;
    for (const [k, v] of Object.entries(values)) {
      const p = this.findParam(k)!;
      p.value = coerce(p, v);
    }
    this.applyParams();
  }
  /** Bedingung „Nur zeigen, wenn …“ setzen (leer = immer zeigen) */
  setShowIf(this: Editor, objs: Obj[], src: string) {
    if (!objs.length) return;
    this.snapshot(src.trim() ? t('Sichtbarkeit an Bedingung knüpfen') : t('Bedingung der Sichtbarkeit entfernen'));
    for (const o of objs) {
      if (src.trim()) o.showIf = src.trim();
      else delete o.showIf;
    }
    this.emit('doc');
    this.emit('sel');
    this.dropUnselectable();
  }
}

/** Namen der Felder für Meldungen */
export const BIND_LABEL = (): Record<ObjBindKey, string> => ({
  x: 'X', y: 'Y', w: t('Breite'), h: t('Höhe'), rot: t('Drehung'), r: t('Eckenradius'), sides: t('Ecken'), size: t('Schriftgröße'),
  maxW: t('Max. Breite'), maxH: t('Max. Höhe'),
});
