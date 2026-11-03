// Skizze als Generator-Objekt: die Skizze steht als JSON im Parameter „sketch“, der Umriss wird daraus gebaut.
// Nicht in GENERATORS (kein Eintrag im Werkzeugkasten-Dialog, nicht in generate_part), aber über getGenerator auffindbar.
import type { Generator } from '../generators/types';
import { t, tn } from '../i18n';
import { parseSketch, sketchSubs } from './model';

export const SKETCH: Generator = {
  id: 'sketch',
  version: 1,
  kind: 'part',
  name: t('Skizze'),
  icon: 'sketch',
  schema: [{ key: 'sketch', label: t('Skizze'), type: 'data', def: '{}' }],
  validate: () => [],
  generate(p) {
    const sk = parseSketch(p.sketch);
    return { parts: [{ key: 'sketch', subs: sketchSubs(sk), at: { x: 0, y: 0 } }], info: [] };
  },
  label(p) {
    const sk = parseSketch(p.sketch);
    return tn('Skizze ({n} Element)', 'Skizze ({n} Elemente)', sk.ents.length);
  },
};
