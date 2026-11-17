// Start der Oberfläche (aus main.ts, nachdem der Abgleich der Einstellungen gelaufen ist)
import { Editor } from './editor';
import { buildUI } from './ui';
import { ensurePacks } from './packs';
import { initDialogDrag } from './dialogDrag';
import { t } from './i18n';
import { initPlugins, PENDING } from './plugins/registry';
import { workerProcess } from './plugins/client';
import { setResourceSource } from './plugins/generator';
import { meshData } from './model3d/store';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.tabIndex = 0;
const editor = new Editor(canvas);
// Plugins of extensions run in their own Worker. Parts whose formulas waited for a plugin are recomputed once it answers.
initPlugins(
  (m) => workerProcess(m.runtime, m.code),
  () => {
    if (editor.paramProblems.some((x) => x.issues.some((i) => i.code === PENDING))) editor.applyParams();
  },
);
// Plugins get the 3D models their parameters name (an object of a stack model plugin) from the model store
setResourceSource((kind, id) => (kind === 'model3d' ? meshData(id) : null));
// Erweiterungen im Hintergrund lesen; Dialoge warten bei Bedarf darauf
void ensurePacks();
buildUI(editor);
initDialogDrag(() => t('Schließen'), () => t('Größe ändern (Doppelklick: Standardgröße)'));
editor.setTool('select');
// Für Tests und Fehlersuche in der Konsole erreichbar
(window as unknown as { editor: Editor }).editor = editor;
