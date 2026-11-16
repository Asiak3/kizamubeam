// Open a generator from a toolbox tile, toolbar button or menu, with the inputs it declares (Generator.inputs).
import type { Editor } from '../editor';
import { importModel } from '../files';
import { openGenDialog } from './dialog';
import { selectedForGen } from '../genHost';
import type { Generator } from './types';

export function openGenerator(ed: Editor, g: Generator) {
  const input = g.inputs?.[0];
  if (input?.kind === 'model3d') return void importModel(ed, g.id);
  if (input?.kind === 'selection') return void openGenDialog(ed, g.id, undefined, ed.sel.length ? g.fromInputs?.({ selection: selectedForGen(ed) }) : undefined);
  return void openGenDialog(ed, g.id);
}
