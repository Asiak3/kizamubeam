// Editor: parametrische Bauteile und Baugruppen aus Generatoren (Zahnrad, Box …) einfügen, ändern und vor
// ungewollter Umwandlung schützen.
import { defaultCutSettings, GenShape, IDENT, leaves, mul, newAsmId, newId, Obj, SubPath, translate } from '../model';
import { boundsOf, type Box } from '../geom';
import { BuildResult, GenPart, genLabel, getGenerator, normalizeParams } from '../generators';
import type { PlanSheet } from '../generators/types';
import { t, tn } from '../i18n';
import type { Editor } from '../editor';
import { findFreeSpot, fitsArea } from '../placement';
import { DEFAULT_NEST_SETTINGS } from './nest';

/** Parametrische Bauteile unter den Objekten (auch in Gruppen) */
export const genLeaves = (objs: Obj[]): Obj[] => [...leaves(objs)].map(([l]) => l).filter((l) => l.shape.kind === 'gen');

/** Name der ganzen Baugruppe (ohne Teil) bzw. des Bauteils */
const groupLabel = (s: GenShape) => genLabel({ ...s, part: undefined });

/** Kennung der Gravur eines Teils */
const markId = (asm: string, part: string | undefined) => `${asm}/${part ?? ''}`;

/** Gruppe aus einem Generator-Teil und seiner Gravur (so legt addGen Teile mit Nummer an) */
export function isMarkGroup(o: Obj): boolean {
  if (o.shape.kind !== 'group') return false;
  const ch = o.shape.children;
  return ch.length === 2 && ch.some((c) => c.shape.kind === 'gen') && ch.some((c) => c.shape.kind === 'path' && !!c.shape.mark);
}

interface Member {
  o: Obj;
  /** Liste, in der das Objekt steht (Seite oder Gruppe) */
  list: Obj[];
}

/** Oberstes Objekt einer Seite, das Teile einer Baugruppe enthält, und wie viele */
export interface AsmTop {
  top: Obj;
  page: number;
  parts: number;
}

/** Wo die Teile von Baugruppen liegen und ob sie sich auswählen lassen (Baugruppe auswählen, #237) */
export interface AsmStatus {
  /** Auf dieser Seite und auswählbar */
  ready: AsmTop[];
  /** Auf dieser Seite, nur durch eigenes Ausblenden oder Sperren nicht auswählbar */
  hidden: AsmTop[];
  /** Auf anderen Seiten */
  away: AsmTop[];
  /** Nicht auswählbar wegen Layer, Bedingung oder Isolation; bleiben, wie sie sind */
  blocked: AsmTop[];
}

/** Anzahl der Teile in den Einträgen */
export const asmParts = (list: AsmTop[]) => list.reduce((n, x) => n + x.parts, 0);

const isAsmPart = (o: Obj, asms: Set<string>) => o.shape.kind === 'gen' && !!o.shape.asm && asms.has(o.shape.asm);
const countAsmParts = (o: Obj, asms: Set<string>) => [...leaves([o])].filter(([l]) => isAsmPart(l, asms)).length;

/** Kopie bzw. Änderung: Ausblenden der Teile und der Gruppen um sie herum aufheben, oben auch das Sperren */
function revealed(o: Obj, asms: Set<string>, top = true): Obj {
  const c: Obj = { ...o };
  delete c.hidden;
  if (top) delete c.locked;
  if (c.shape.kind === 'group')
    c.shape = { ...c.shape, children: c.shape.children.map((x) => (countAsmParts(x, asms) ? revealed(x, asms, false) : x)) };
  return c;
}
function reveal(o: Obj, asms: Set<string>, top = true) {
  delete o.hidden;
  if (top) delete o.locked;
  if (o.shape.kind === 'group') for (const x of o.shape.children) if (countAsmParts(x, asms)) reveal(x, asms, false);
}

export class EditorGenerators {
  selGens(this: Editor): Obj[] {
    return this.sel.filter((o) => o.shape.kind === 'gen');
  }
  /** Alle Teile einer Baugruppe auf allen Seiten, auch in Gruppen */
  asmMembers(this: Editor, asm: string): Member[] {
    const out: Member[] = [];
    const walk = (list: Obj[]) => {
      for (const o of list) {
        if (o.shape.kind === 'group') walk(o.shape.children);
        else if (o.shape.kind === 'gen' && o.shape.asm === asm) out.push({ o, list });
      }
    };
    for (const pg of this.doc.pages) walk(pg.objs);
    return out;
  }
  /** Kennungen der Baugruppen, zu denen ausgewählte Teile gehören */
  selAsms(this: Editor): string[] {
    return [...new Set(genLeaves(this.sel).map((o) => (o.shape as GenShape).asm).filter((a): a is string => !!a))];
  }
  /** Namen der Baugruppen, z. B. „Box 200 × 150 × 100“ */
  asmLabel(this: Editor, asms: string[]): string {
    return asms.map((a) => this.asmMembers(a)[0]).filter((m) => !!m).map((m) => groupLabel(m.o.shape as GenShape)).join(', ');
  }
  /** Teile der Baugruppen nach ihrem obersten Objekt einordnen: auswählbar, ausgeblendet/gesperrt, andere Seite, blockiert */
  asmStatus(this: Editor, asms: string[]): AsmStatus {
    const set = new Set(asms);
    const st: AsmStatus = { ready: [], hidden: [], away: [], blocked: [] };
    this.doc.pages.forEach((pg, page) => {
      for (const top of pg.objs) {
        const parts = countAsmParts(top, set);
        if (!parts) continue;
        const entry = { top, page, parts };
        if (page !== this.doc.page) st.away.push(entry);
        else if (this.selectable(top)) st.ready.push(entry);
        else if (this.selectable(revealed(top, set))) st.hidden.push(entry);
        else st.blocked.push(entry);
      }
    });
    return st;
  }
  /**
   * Alle Teile der Baugruppen auf dieser Seite auswählen (das oberste Objekt, wie bei „Objekte dieses Layers auswählen“).
   * bring: vorher Teile anderer Seiten an dieselbe Stelle dieser Seite holen und ihr Ausblenden/Sperren aufheben.
   * Layer bleiben, wie sie sind. Gibt die Zahl der nicht ausgewählten Teile zurück.
   */
  selectAsm(this: Editor, asms: string[], bring = false): number {
    const set = new Set(asms);
    const st = this.asmStatus(asms);
    const total = asmParts([...st.ready, ...st.hidden, ...st.away, ...st.blocked]);
    if (bring && (st.hidden.length || st.away.length)) {
      this.snapshot(t('Teile der Baugruppe zusammenholen'));
      for (const { top, page } of st.away) {
        const list = this.doc.pages[page].objs;
        list.splice(list.indexOf(top), 1);
        this.doc.objs.push(top);
      }
      for (const { top } of [...st.hidden, ...st.away]) reveal(top, set);
      this.emit('doc');
    }
    const picked = this.doc.objs.filter((o) => this.selectable(o) && countAsmParts(o, set) > 0);
    this.setSel(picked);
    const missing = total - picked.reduce((n, o) => n + countAsmParts(o, set), 0);
    if (missing) {
      this.hint = tn('{n} Teil der Baugruppe ist nicht ausgewählt (andere Seite, ausgeblendet, gesperrt oder außerhalb der Isolation).',
        '{n} Teile der Baugruppe sind nicht ausgewählt (andere Seite, ausgeblendet, gesperrt oder außerhalb der Isolation).', missing);
      this.emit('tool');
    }
    return missing;
  }
  /**
   * Alle Teile der Baugruppen auf allen Seiten auf einen Layer legen, ohne sie auszuwählen.
   * Die Gravur (z. B. Teilnummer) bleibt auf ihrem Layer; die Gruppe aus Teil und Gravur folgt dem Teil.
   */
  assignAsmLayer(this: Editor, asms: string[], layer: number) {
    const set = new Set(asms);
    const parts: [Obj, Obj | null][] = [];
    const walk = (list: Obj[], parent: Obj | null) => {
      for (const o of list) {
        if (o.shape.kind === 'group') walk(o.shape.children, o);
        else if (isAsmPart(o, set)) parts.push([o, parent]);
      }
    };
    for (const pg of this.doc.pages) walk(pg.objs, null);
    if (!parts.length || parts.every(([o]) => o.layer === layer)) return;
    this.snapshot(t('Layer zuweisen'));
    for (const [o, parent] of parts) {
      o.layer = layer;
      if (parent && isMarkGroup(parent)) parent.layer = layer;
    }
    this.layer(layer);
    this.emit('doc');
  }
  /** Oberste Objekte mit Teilen der Baugruppen, auf allen Seiten */
  asmTops(this: Editor, asms: string[]): { top: Obj; page: number }[] {
    const set = new Set(asms);
    const out: { top: Obj; page: number }[] = [];
    this.doc.pages.forEach((pg, page) => {
      for (const top of pg.objs) if (countAsmParts(top, set)) out.push({ top, page });
    });
    return out;
  }
  /** Liegen alle Teile der Baugruppen auf dieser Seite? (Häkchen im Menü) */
  asmOnPage(this: Editor, asms: string[], page: number): boolean {
    const tops = this.asmTops(asms);
    return tops.length > 0 && tops.every((x) => x.page === page);
  }
  /**
   * Alle Teile der Baugruppen (mit ihrem obersten Objekt, an derselben Stelle) auf eine Seite verschieben.
   * 'new': neue Seite hinter der aktuellen anlegen und zu ihr wechseln, wie beim Hinzufügen einer Seite.
   * Landen die Teile auf der aktuellen Seite, werden sie ausgewählt.
   */
  moveAsmToPage(this: Editor, asms: string[], target: number | 'new') {
    const tops = this.asmTops(asms);
    if (!tops.length || (target !== 'new' && (!this.doc.pages[target] || tops.every((x) => x.page === target)))) return;
    this.snapshot(t('Baugruppe auf Seite verschieben'));
    const moving = target === 'new' ? tops : tops.filter((x) => x.page !== target);
    for (const { top, page } of moving) {
      const list = this.doc.pages[page].objs;
      list.splice(list.indexOf(top), 1);
    }
    const dest = target === 'new' ? this.insertPage() : target;
    this.doc.pages[dest].objs.push(...moving.map((x) => x.top));
    const set = new Set(asms);
    if (dest === this.doc.page) this.setSel(this.doc.objs.filter((o) => this.selectable(o) && countAsmParts(o, set) > 0));
    else this.setSel(this.sel.filter((o) => this.doc.objs.includes(o)));
    this.emit('doc');
  }
  /** Liegen alle Teile der Baugruppen auf diesem Layer? (Häkchen im Menü) */
  asmOnLayer(this: Editor, asms: string[], layer: number): boolean {
    const members = asms.flatMap((a) => this.asmMembers(a));
    return members.length > 0 && members.every((m) => m.o.layer === layer);
  }
  /**
   * Erzeugte Teile mittig in der sichtbaren Fläche auf dem aktuellen Layer einfügen (lokaler Ursprung = Teilmitte).
   * Teile einer Baugruppe werden einzelne Objekte mit gemeinsamer Kennung, damit sie zusammen neu berechnet werden.
   */
  /**
   * Layer für Gravuren von Generator-Teilen (z. B. Schichtnummern): der schon dafür benutzte, sonst ein freier,
   * der als feine Linien-Gravur eingestellt wird.
   */
  markLayer(this: Editor, cut: number): number {
    for (const pg of this.doc.pages) for (const [o] of leaves(pg.objs)) if (o.shape.kind === 'path' && o.shape.mark) return o.layer;
    const i = this.freeLayer(cut, true);
    if (i < 0) return cut;
    Object.assign(this.layer(i), defaultCutSettings('line'), { mode: 'line', speed: 3000, power: 15, name: t('Beschriftung'), output: true });
    return i;
  }
  /**
   * Niedrigster Layer 00–29, den kein Objekt auf irgendeiner Seite benutzt (leerer Layer); -1, wenn keiner frei ist.
   * exclude: diesen Layer nicht nehmen. fresh: einen ohne gespeicherte Einstellungen bevorzugen (für die Gravur,
   * deren Einstellungen danach gesetzt werden).
   */
  freeLayer(this: Editor, exclude = -1, fresh = false): number {
    const used = new Set<number>();
    for (const pg of this.doc.pages) for (const [o] of leaves(pg.objs)) used.add(o.layer);
    if (fresh) for (let k = 0; k < 30; k++) if (k !== exclude && !used.has(k) && !this.doc.layers[k]) return k;
    for (let k = 0; k < 30; k++) if (k !== exclude && !used.has(k)) return k;
    return -1;
  }
  /** Teil (lokal, m = Lage) mit seiner Gravur zu einer Gruppe verbinden; ohne Gravur bleibt es, wie es ist */
  withMark(this: Editor, part: Obj, marks: SubPath[] | undefined, markLayer: number): Obj {
    const s = part.shape as GenShape;
    if (!marks?.length) return part;
    // Einzelteile (Bauteil-Generatoren) haben keine Baugruppe: die Gravur trägt dann die Generator-Kennung
    const mark: Obj = { id: newId(), m: IDENT, layer: markLayer, shape: { kind: 'path', subs: marks, mark: markId(s.asm ?? s.gen, s.part) } };
    const g: Obj = { id: newId(), m: part.m, layer: part.layer, shape: { kind: 'group', children: [{ ...part, m: IDENT }, mark] } };
    return g;
  }
  /** Gravur eines Einzelteils nach einer Parameter-Änderung nachführen (ändern, entfernen oder neu anlegen) */
  syncSingleMark(this: Editor, o: Obj, marks: SubPath[] | undefined) {
    const find = (list: Obj[]): Obj[] | null => {
      if (list.includes(o)) return list;
      for (const x of list) if (x.shape.kind === 'group') { const f = find(x.shape.children); if (f) return f; }
      return null;
    };
    let list: Obj[] | null = null;
    for (const pg of this.doc.pages) if (!list) list = find(pg.objs);
    if (!list) return;
    const parent = list === this.doc.objs ? null : this.doc.objs.find((x) => x.shape.kind === 'group' && x.shape.children === list);
    const sib = parent && isMarkGroup(parent) ? list.find((x) => x.shape.kind === 'path' && !!x.shape.mark) : undefined;
    if (sib && sib.shape.kind === 'path') {
      if (marks?.length) { sib.shape = { ...sib.shape, subs: marks }; this.touch(sib.shape); }
      else list.splice(list.indexOf(sib), 1);
    } else if (marks?.length && list === this.doc.objs) list.splice(list.indexOf(o), 1, this.withMark(o, marks, this.markLayer(o.layer)));
  }
  /** Bauplan einer Baugruppe als neue Seite hinter der aktuellen (ohne Seitenwechsel), auf einem Layer, der nicht gelasert wird */
  addPlanPage(this: Editor, plan: PlanSheet, name: string) {
    let li = -1;
    for (let k = 0; k < 30 && li < 0; k++) if (this.doc.layers[k]?.name === t('Bauplan') && !this.doc.layers[k].output) li = k;
    if (li < 0) {
      const used = new Set<number>();
      for (const pg of this.doc.pages) for (const [o] of leaves(pg.objs)) used.add(o.layer);
      for (let k = 29; k >= 0 && li < 0; k--) if (!used.has(k) && !this.doc.layers[k]) li = k;
      for (let k = 29; k >= 0 && li < 0; k--) if (!used.has(k)) li = k;
      if (li < 0) li = 29;
      Object.assign(this.layer(li), defaultCutSettings('line'), { mode: 'line', name: t('Bauplan'), output: false });
    }
    const text = (s: string, x: number, y: number, size: number, align: 'left' | 'center' = 'left'): Obj => ({
      id: newId(), m: translate(x, y), layer: li,
      shape: { kind: 'text', text: s, font: 'Arial', size, bold: false, italic: false, upper: false, align, hSpace: 0, vSpace: 0 },
    });
    const objs: Obj[] = [text(plan.title, 15, 12, 6)];
    if (plan.lines.length)
      objs.push({ id: newId(), m: IDENT, layer: li, shape: { kind: 'path', subs: plan.lines.map((l) => ({ closed: false, nodes: l.map((q) => ({ x: q.x, y: q.y })) })) } });
    for (const lb of plan.labels) objs.push(text(lb.text, lb.x, lb.y + lb.size / 3, lb.size, 'center'));
    let y = 22 + 110 + 12;
    for (const st of plan.steps) {
      objs.push(text(st, 15, y, 4));
      y += 7;
    }
    const at = this.doc.page + 1;
    const used = new Set(this.doc.pages.map((p) => p.name));
    let pn = name;
    for (let i = 2; used.has(pn); i++) pn = `${name} ${i}`;
    this.doc.pages.splice(at, 0, { name: pn, objs });
  }
  /** Passt das Ergebnis als Ganzes (Baugruppe samt Anordnung) mit Randabstand auf eine leere Seite? */
  genFitsPage(this: Editor, r: BuildResult): boolean {
    const b = boundsOf(r.parts.map((p): Obj => ({ id: 0, m: translate(p.at.x, p.at.y), layer: 0, shape: p.shape })));
    return !b || fitsArea(b, this.doc.bed, DEFAULT_NEST_SETTINGS.margin);
  }
  /**
   * Bauteil bzw. Baugruppe einfügen. Mit center (z. B. vom KI-Agenten) an genau diese Stelle; sonst auf den
   * ersten freien Platz der Seite (von unten links, Baugruppe als ein Rechteck, alle Objekte der Seite zählen).
   * Ist kein Platz mehr frei, kommt sie auf eine neue Seite; ist sie größer als der Arbeitsbereich, in seine Mitte.
   */
  addGen(this: Editor, r: BuildResult, layer = this.currentLayer, center?: { x: number; y: number }): Obj[] {
    if (!r.parts.length) return [];
    const c = center ?? { x: 0, y: 0 };
    const bed = this.doc.bed;
    const asm = r.parts.some((p) => p.shape.part) ? newAsmId() : undefined;
    // Vor dem Beschriftungs-Layer und der neuen Seite, damit Rückgängig alles in einem Schritt zurücknimmt
    this.snapshot(t('Objekt hinzufügen'));
    const markLayer = r.parts.some((p) => p.marks?.length) ? this.markLayer(layer) : layer;
    const objs: Obj[] = r.parts.map((p) =>
      this.withMark({ id: newId(), m: translate(c.x + p.at.x, c.y + p.at.y), layer, shape: asm ? { ...p.shape, asm } : p.shape }, p.marks, markLayer),
    );
    let placed: 'free' | 'page' | 'center' = 'free';
    const b = boundsOf(objs);
    if (!center && b) {
      const { gap, margin } = DEFAULT_NEST_SETTINGS;
      const obstacles = this.doc.objs.map((o) => boundsOf([o])).filter((x): x is Box => !!x);
      let spot = findFreeSpot(obstacles, b, bed, gap, margin);
      if (!spot && fitsArea(b, bed, margin)) {
        this.insertPage();
        placed = 'page';
        spot = findFreeSpot([], b, bed, gap, margin);
      }
      if (!spot) {
        placed = 'center';
        spot = { x: bed.w / 2 - b.w / 2, y: bed.h / 2 - b.h / 2 };
      }
      for (const o of objs) o.m = mul(translate(spot.x - b.x, spot.y - b.y), o.m);
    }
    this.layer(layer);
    this.doc.objs.push(...objs);
    if (r.plan) this.addPlanPage(r.plan, t('Bauplan'));
    if (!this.agentCall) this.setTool('select');
    this.setSel(objs);
    const name = groupLabel(r.parts[0].shape);
    const done = asm
      ? t('{name} eingefügt ({n} Teile). Doppelklick auf ein Teil öffnet die Parameter der ganzen Baugruppe.', { name, n: objs.length })
      : t('{name} eingefügt. Doppelklick öffnet die Parameter wieder.', { name });
    this.hint = placed === 'page'
      ? `${t('Auf der Seite war kein Platz mehr: neue Seite „{page}“.', { page: this.doc.pages[this.doc.page].name })} ${done}`
      : placed === 'center'
        ? `${t('Größer als der Arbeitsbereich: liegt in seiner Mitte.')} ${done}`
        : done;
    this.emit('doc');
    if (placed === 'page') this.emit('sel');
    return objs;
  }
  /**
   * Parameter ändern: Die Geometrie wird ersetzt, Lage und Drehung bleiben. Bei Baugruppen werden alle Teile
   * (auf allen Seiten) neu berechnet; Teile, die die neuen Parameter nicht mehr ergeben, fallen weg, neu
   * hinzukommende (z. B. ein Deckel) kommen an ihren Platz in der Anordnung. Teile, die der Nutzer gelöscht
   * hat, bleiben gelöscht. silent: ohne eigenen Undo-Schritt, Hinweis und Meldung (Neuberechnung nach einer
   * Parameter-Änderung, die selbst den Schritt anlegt).
   */
  updateGen(this: Editor, o: Obj, r: BuildResult, silent = false) {
    if (o.shape.kind !== 'gen' || !r.parts.length) return;
    const old = o.shape;
    if (!silent) this.snapshot(t('{name} ändern', { name: groupLabel(old) }));
    const g = getGenerator(old.gen);
    if (!old.asm || !g) {
      o.shape = { ...r.parts[0].shape };
      this.touch(o.shape);
      this.syncSingleMark(o, r.parts[0].marks);
    } else {
      const asm = old.asm;
      const members = this.asmMembers(asm);
      const byKey = new Map(r.parts.map((p) => [p.shape.part, p]));
      let oldParts: GenPart[] = [];
      try {
        oldParts = g.generate(normalizeParams(g, old.params)).parts;
      } catch {
        /* alte Parameter nicht mehr erzeugbar: Teile bleiben, wo sie sind */
      }
      const oldAt = new Map(oldParts.map((p) => [p.key, p.at]));
      const oldKeys = new Set(oldParts.map((p) => p.key));
      // Ursprung der Anordnung (at = 0) in Weltkoordinaten, abgeleitet vom bearbeiteten Teil
      const worldOf = (x: Obj) => [...leaves(this.doc.objs)].find(([l]) => l === x)?.[1] ?? null;
      const at0 = oldAt.get(old.part!) ?? { x: 0, y: 0 };
      const origin = mul(worldOf(o) ?? o.m, translate(-at0.x, -at0.y));
      // Liegen noch alle Teile so, wie der Generator sie angeordnet hat? Dann wird die Anordnung mit den neuen
      // Maßen neu gelegt, damit größer gewordene Teile sich nicht überdecken. Sonst bleibt jedes Teil, wo es ist.
      const placed = (x: Obj, at: { x: number; y: number }) => {
        const want = mul(origin, translate(at.x, at.y));
        return x.m.every((v, i) => Math.abs(v - want[i]) < 1e-6);
      };
      // Teil oben auf der Seite oder in seiner Gruppe mit Gravur: dieses Objekt trägt die Lage
      const holder = (m: Member): Obj | null => {
        if (m.list === this.doc.objs) return m.o;
        const g = this.doc.objs.find((x) => x.shape.kind === 'group' && x.shape.children === m.list);
        return g && isMarkGroup(g) && m.o.m.every((v, i) => Math.abs(v - IDENT[i]) < 1e-9) ? g : null;
      };
      const relayout = members.every((m) => {
        const hd = holder(m);
        return !!hd && placed(hd, oldAt.get((m.o.shape as GenShape).part!) ?? { x: NaN, y: NaN });
      });
      const needMarks = r.parts.some((p) => p.marks?.length);
      const markLayer = needMarks ? this.markLayer(o.layer) : o.layer;
      const present = new Set<string | undefined>();
      for (const m of members) {
        const key = (m.o.shape as GenShape).part;
        present.add(key);
        const np = byKey.get(key);
        const mid = markId(asm, key);
        const sib = m.list.find((x) => x.shape.kind === 'path' && x.shape.mark === mid);
        const hd = holder(m);
        if (np) {
          m.o.shape = { ...np.shape, asm };
          this.touch(m.o.shape);
          if (relayout && hd) hd.m = mul(origin, translate(np.at.x, np.at.y));
          // Gravur nachführen: ändern, entfernen oder (oben auf der Seite) als Gruppe neu anlegen
          if (sib && np.marks?.length && sib.shape.kind === 'path') {
            sib.shape = { ...sib.shape, subs: np.marks };
            sib.m = m.o.m;
            this.touch(sib.shape);
          } else if (sib) m.list.splice(m.list.indexOf(sib), 1);
          else if (np.marks?.length && m.list === this.doc.objs) m.list.splice(m.list.indexOf(m.o), 1, this.withMark(m.o, np.marks, markLayer));
          else if (np.marks?.length)
            m.list.splice(m.list.indexOf(m.o) + 1, 0, { id: newId(), m: m.o.m, layer: markLayer, shape: { kind: 'path', subs: np.marks, mark: mid } });
        } else if (hd && hd !== m.o) this.doc.objs.splice(this.doc.objs.indexOf(hd), 1);
        else {
          m.list.splice(m.list.indexOf(m.o), 1);
          if (sib) m.list.splice(m.list.indexOf(sib), 1);
        }
      }
      // Neu hinzukommende Teile (z. B. Deckel) an ihren Platz in der Anordnung; vom Nutzer gelöschte nicht wiederholen
      const added: Obj[] = [];
      for (const p of r.parts) {
        if (present.has(p.shape.part) || oldKeys.has(p.shape.part!)) continue;
        added.push(this.withMark({ id: newId(), m: mul(origin, translate(p.at.x, p.at.y)), layer: o.layer, shape: { ...p.shape, asm } }, p.marks, markLayer));
      }
      this.doc.objs.push(...added);
      const alive = new Set(this.doc.objs);
      if (silent) this.sel = this.sel.filter((x) => alive.has(x));
      else this.setSel([...this.sel.filter((x) => alive.has(x)), ...added]);
    }
    if (silent) return;
    const n = r.parts.length;
    this.hint = n > 1
      ? t('{name}: {n} Teile neu berechnet.', { name: groupLabel(r.parts[0].shape), n })
      : t('{name}: Kontur neu berechnet.', { name: genLabel(r.parts[0].shape) });
    this.emit('doc');
    this.emit('sel');
  }
  /** Fehlermeldung für KI-Agenten, die ein parametrisches Bauteil skalieren oder umbauen wollen */
  genChangeError(this: Editor, objs: Obj[]): string {
    const g = genLeaves(objs)[0];
    return t('{name} (id {id}) ist ein parametrisches Bauteil: Parameter mit edit_generator ändern oder erst mit convert_to_path in Pfade umwandeln.', {
      name: g ? genLabel(g.shape as GenShape) : '', id: g?.id ?? '',
    });
  }
  /**
   * Vor Änderungen, die ein parametrisches Bauteil in gewöhnliche Pfade verwandeln (Skalieren, Knoten bearbeiten,
   * Boolesche Operationen …): fragen und bei Zustimmung umwandeln. false = Aktion abbrechen.
   * Ohne Oberfläche (Tests) wird umgewandelt; KI-Agenten bekommen einen Fehler und nutzen edit_generator bzw. convert_to_path.
   */
  async guardGen(this: Editor, objs: Obj[], action: string): Promise<boolean> {
    const gens = genLeaves(objs);
    if (!gens.length) return true;
    if (this.agentCall) throw new Error(this.genChangeError(gens));
    const answer = this.onGenGuard ? await this.onGenGuard(gens, action) : 'convert';
    if (answer === 'edit') {
      this.onGenEdit?.(gens[0]);
      return false;
    }
    if (answer !== 'convert') return false;
    this.snapshot(t('In Pfad umwandeln'));
    for (const g of gens) {
      this.convertObjToPath(g);
      this.touch(g.shape);
    }
    this.emit('doc');
    this.emit('sel');
    return true;
  }
}
