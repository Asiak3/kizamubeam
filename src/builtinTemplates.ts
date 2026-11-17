// Mitgelieferte Vorlagen: Schlüsselanhänger, Namensschild und beschriftete Box. Sie werden beim Öffnen aus
// Code erzeugt (immer passend zur aktuellen Version); Lage und Maße kommen aus Formeln mit den Parametern,
// die Geometrie hier ist nur der Ausgangspunkt, den applyParams beim Öffnen nachrechnet.
import { newAsmId, newDoc, newId, Obj, OBJ_BIND_KEYS, ObjBinds, Shape, TextShape, translate } from './model';
import { buildGenAsync, defaultParams, getGenerator } from './generators';
import { renameInExpr, renameInTemplate } from './params';
import type { ProjectParam } from './params';
import type { TemplateInfo } from './templates';
import { t } from './i18n';

export interface BuiltinTemplate {
  id: string;
  info: TemplateInfo;
  /** Inhalt wie eine .kzt-Datei (async: the box of the label box template may be a plugin computing in its Worker) */
  json: () => Promise<string>;
}

const BED_H = 400;
/** Maschinenkoordinaten (Ursprung unten links) → Welt (y nach unten) */
const at = (x: number, y: number) => translate(x, BED_H - y);
const C: [number, number] = [0.5, 0.5];
const BL: [number, number] = [0, 1];

const text = (s: string, extra: Partial<TextShape> = {}): TextShape => ({
  kind: 'text', text: s, font: 'Arial', size: 8, bold: false, italic: false, upper: false, align: 'center', hSpace: 0, vSpace: 0, fit: 'shrink', ...extra,
});
const obj = (layer: number, shape: Shape, x: number, y: number, bind?: ObjBinds, showIf?: string): Obj => ({
  id: newId(), m: at(x, y), layer, shape, ...(bind ? { bind } : {}), ...(showIf ? { showIf } : {}),
});
const num = (name: string, value: number, min: number, max: number, step = 1, note?: string): ProjectParam => ({
  name, type: 'number', value, min, max, step, unit: 'mm', ...(note ? { note } : {}),
});

/** Namen der Parameter in der Sprache der Oberfläche (gültige Namen für Formeln) */
const PARAM_NAMES = (): Record<string, string> => ({
  Name: t('Name|Vorlagen-Parameter'),
  Breite: t('Breite|Vorlagen-Parameter'),
  Höhe: t('Höhe|Vorlagen-Parameter'),
  Tiefe: t('Tiefe|Vorlagen-Parameter'),
  Dicke: t('Dicke|Vorlagen-Parameter'),
  Loch: t('Loch|Vorlagen-Parameter'),
  Löcher: t('Löcher|Vorlagen-Parameter'),
  Zeile2: t('Zeile2|Vorlagen-Parameter'),
  Beschriftung: t('Beschriftung|Vorlagen-Parameter'),
});

/** Parameter übersetzen; Formeln, Platzhalter und Felder werden mit umbenannt */
function localize(params: ProjectParam[], info: TemplateInfo, objs: Obj[]) {
  const names = PARAM_NAMES();
  for (const p of params) {
    const to = names[p.name] ?? p.name;
    if (to === p.name) continue;
    const from = p.name;
    p.name = to;
    for (const f of info.fields) if (f.name === from) f.name = to;
    for (const o of objs) {
      if (o.showIf) o.showIf = renameInExpr(o.showIf, from, to);
      if (o.bind) for (const k of OBJ_BIND_KEYS) if (o.bind[k]) o.bind[k] = renameInExpr(o.bind[k]!, from, to);
      const s = o.shape;
      if (s.kind === 'text') s.text = renameInTemplate(s.text, from, to);
      else if (s.kind === 'gen' && s.bind) for (const k of Object.keys(s.bind)) s.bind[k] = renameInExpr(s.bind[k], from, to);
    }
  }
}

function docJson(params: ProjectParam[], info: TemplateInfo, objs: Obj[]): string {
  info = { ...info, fields: info.fields.map((f) => ({ ...f })) };
  localize(params, info, objs);
  const d = newDoc();
  d.pages[0].name = info.title;
  d.params = params;
  const { preview: _, ...rest } = info;
  d.template = rest;
  d.objs.push(...objs);
  return JSON.stringify(d);
}

// Kleine Vorschaubilder (Schnitt blau, Gravur schwarz)
const svg = (vb: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" fill="none" stroke="#0000ff" stroke-width="1" vector-effect="non-scaling-stroke">${body}</svg>`;
const label = (x: number, y: number, size: number, s: string) =>
  `<text x="${x}" y="${y}" font-family="Arial" font-size="${size}" text-anchor="middle" dominant-baseline="middle" fill="#000" stroke="none">${s}</text>`;

const KEYFOB = (): TemplateInfo => ({
  title: t('Schlüsselanhänger'),
  description: t('Runder Anhänger mit Loch und Namen; der Name wird kleiner, wenn er nicht passt.'),
  fields: [{ name: 'Name' }, { name: 'Breite', slider: true }, { name: 'Höhe', slider: true }, { name: 'Loch', slider: true }],
  preview: svg('-2 -2 64 24', `<rect x="0" y="0" width="60" height="20" rx="10"/><circle cx="10" cy="10" r="2"/>${label(36, 10.5, 9, 'Anna')}`),
});
const NAMETAG = (): TemplateInfo => ({
  title: t('Namensschild'),
  description: t('Schild mit Namen und optionaler zweiter Zeile, auf Wunsch mit zwei Löchern.'),
  fields: [{ name: 'Name' }, { name: 'Zeile2', label: t('Zweite Zeile') }, { name: 'Breite', slider: true }, { name: 'Höhe', slider: true }, { name: 'Löcher' }],
  preview: svg('-2 -2 84 34', `<rect x="0" y="0" width="80" height="30" rx="3"/>${label(40, 12, 9, 'Anna Muster')}${label(40, 23, 5, t('Werkstatt'))}`),
});
const LABELBOX = (): TemplateInfo => ({
  title: t('Beschriftete Box'),
  description: t('Offene Box mit Fingerzinken und Beschriftung auf der Vorderwand.'),
  fields: [{ name: 'Beschriftung' }, { name: 'Breite', slider: true }, { name: 'Tiefe', slider: true }, { name: 'Höhe', slider: true }, { name: 'Dicke', label: t('Materialdicke'), slider: true }],
  preview: svg('-2 -2 88 88', `<rect x="0" y="60" width="40" height="24"/><rect x="44" y="60" width="40" height="24"/><rect x="0" y="32" width="30" height="24"/><rect x="34" y="32" width="30" height="24"/><rect x="0" y="0" width="40" height="28"/>${label(20, 72, 7, 'Box')}`),
});

export function builtinTemplates(): BuiltinTemplate[] {
  return [
    {
      id: 'keyfob',
      info: KEYFOB(),
      json: async () =>
        docJson(
          [
            { name: 'Name', type: 'text', value: 'Anna' },
            num('Breite', 60, 30, 120),
            num('Höhe', 20, 12, 40),
            num('Loch', 4, 2, 8, 0.5, t('Durchmesser des Lochs für den Schlüsselring')),
          ],
          KEYFOB(),
          [
            obj(1, { kind: 'rect', w: 60, h: 20, r: 10 }, 10, 30, { w: 'Breite', h: 'Höhe', r: 'Höhe / 2', x: '10', y: '10', anchor: BL }),
            obj(1, { kind: 'ellipse', rx: 2, ry: 2 }, 20, 20, { w: 'Loch', h: 'Loch', x: '10 + Höhe / 2', y: '10 + Höhe / 2', anchor: C }),
            obj(0, text('{Name}', { size: 10, maxW: 42 }), 46, 16, {
              size: 'Höhe * 0.5', maxW: 'Breite - Höhe - 3', x: '10 + (Höhe + Breite - 3) / 2', y: '10 + Höhe / 2', anchor: C,
            }),
          ],
        ),
    },
    {
      id: 'nametag',
      info: NAMETAG(),
      json: async () =>
        docJson(
          [
            { name: 'Name', type: 'text', value: 'Anna Muster' },
            { name: 'Zeile2', type: 'text', value: t('Werkstatt'), note: t('Leer lassen für ein Schild mit einer Zeile') },
            num('Breite', 80, 40, 200),
            num('Höhe', 30, 15, 80),
            { name: 'Löcher', type: 'bool', value: false, note: t('Zwei Löcher zum Aufhängen oder Anschrauben') },
          ],
          NAMETAG(),
          [
            obj(1, { kind: 'rect', w: 80, h: 30, r: 3 }, 10, 40, { w: 'Breite', h: 'Höhe', r: 'min(Breite; Höhe) * 0.1', x: '10', y: '10', anchor: BL }),
            obj(0, text('{Name}', { size: 10, maxW: 72, bold: true }), 50, 28, {
              size: 'Höhe * (len(Zeile2) > 0 ? 0.32 : 0.4)', maxW: 'Breite - 10', x: '10 + Breite / 2', y: '10 + Höhe * (len(Zeile2) > 0 ? 0.62 : 0.5)', anchor: C,
            }),
            obj(0, text('{Zeile2}', { size: 5, maxW: 72 }), 50, 18, {
              size: 'Höhe * 0.18', maxW: 'Breite - 10', x: '10 + Breite / 2', y: '10 + Höhe * 0.25', anchor: C,
            }, 'len(Zeile2) > 0'),
            obj(1, { kind: 'ellipse', rx: 1.5, ry: 1.5 }, 15, 35, { w: '3', h: '3', x: '10 + 5', y: '10 + Höhe - 5', anchor: C }, 'Löcher'),
            obj(1, { kind: 'ellipse', rx: 1.5, ry: 1.5 }, 85, 35, { w: '3', h: '3', x: '10 + Breite - 5', y: '10 + Höhe - 5', anchor: C }, 'Löcher'),
          ],
        ),
    },
    {
      id: 'labelbox',
      info: LABELBOX(),
      json: async () => {
        const params: ProjectParam[] = [
          { name: 'Beschriftung', type: 'text', value: t('Schrauben') },
          num('Breite', 100, 30, 300),
          num('Tiefe', 80, 30, 300),
          num('Höhe', 50, 20, 200),
          num('Dicke', 3, 1, 10, 0.5, t('Materialdicke; die Zinken passen sich an')),
        ];
        const box = getGenerator('box')!;
        const gp = { ...defaultParams(box), sizeMode: 'outer', width: 100, depth: 80, height: 50, thickness: 3, top: 'open' };
        const r = await buildGenAsync(box, gp);
        const asm = newAsmId();
        const bind = { width: 'Breite', depth: 'Tiefe', height: 'Höhe', thickness: 'Dicke' };
        // Anordnung über Formeln, damit die Platten beim Ändern der Maße nicht ineinanderlaufen:
        // unten Vorder- und Rückwand, darüber die Seitenwände, oben der Boden
        const place: Record<string, [string, string]> = {
          front: ['10', '10'],
          back: ['10 + Breite + 6', '10'],
          left: ['10', '10 + Höhe + 6'],
          right: ['10 + Tiefe + 6', '10 + Höhe + 6'],
          bottom: ['10', '10 + 2 * (Höhe + 6)'],
        };
        const parts: Obj[] = r.parts.map((p) => {
          const [x, y] = place[p.shape.part ?? ''] ?? ['10', '10'];
          return { id: newId(), m: translate(200 + p.at.x, 200 + p.at.y), layer: 1, shape: { ...p.shape, asm, bind }, bind: { x, y, anchor: BL } };
        });
        return docJson(
          params,
          LABELBOX(),
          [
            ...parts,
            obj(0, text('{Beschriftung}', { size: 15, maxW: 86 }), 60, 35, {
              size: 'min(Höhe * 0.35; 25)', maxW: 'Breite - 2 * Dicke - 10', x: '10 + Breite / 2', y: '10 + Höhe / 2', anchor: C,
            }),
          ],
        );
      },
    },
  ];
}
