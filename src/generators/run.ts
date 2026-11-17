// Open a generator from a toolbox tile, toolbar button or menu, with the inputs it declares (Generator.inputs).
import type { Editor } from '../editor';
import { importModel } from '../files';
import { openGenDialog } from './dialog';
import { selectedForGen } from '../genHost';
import type { Generator } from './types';

export function openGenerator(ed: Editor, g: Generator) {
  const input = g.inputs?.[0];
  if (input?.kind === 'model3d') return void importModel(ed, g.id);
  // A plugin turns the selection into parameters in its Worker: the dialog opens with its answer
  if (input?.kind === 'selection')
    return void Promise.resolve(ed.sel.length ? g.fromInputs?.({ selection: selectedForGen(ed) }) : undefined).then(
      (p) => openGenDialog(ed, g.id, undefined, p),
      () => openGenDialog(ed, g.id),
    );
  return void openGenDialog(ed, g.id);
}
