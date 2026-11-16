// Open a generator from a toolbox tile, toolbar button or menu, with the inputs it declares (Generator.inputs).
import type { Editor } from '../editor';
import { importModel } from '../files';
import { openGenDialog } from './dialog';
import { encodeShapes } from './jig';
import { shapesFromSelection } from './jigPanel';
import type { Generator } from './types';

export function openGenerator(ed: Editor, g: Generator) {
  const input = g.inputs?.[0];
  if (input?.kind === 'model3d') return void importModel(ed, g.id as Parameters<typeof importModel>[1]); // any model3d generator once the import is generic (#341)
  if (input?.kind === 'selection') return void openGenDialog(ed, g.id, undefined, ed.sel.length ? { [input.param]: encodeShapes(shapesFromSelection(ed)) } : undefined);
  return void openGenDialog(ed, g.id);
}
