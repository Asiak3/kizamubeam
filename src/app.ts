// Start der Oberfläche (aus main.ts, nachdem der Abgleich der Einstellungen gelaufen ist)
import { Editor } from './editor';
import { buildUI } from './ui';
import { ensurePacks } from './packs';
import { initDialogDrag } from './dialogDrag';
import { t } from './i18n';
import { initPlugins, PENDING } from './plugins/registry';
import { workerProcess } from './plugins/client';
import { setContextSource, setPluginSpawn, setResourceSource } from './plugins/generator';
import { editorContext } from './plugins/context';
import type { PluginManifest } from './plugins/manifest';
import { useCoreGenerators } from './plugins/core';
import { CORE_PACK_TEXT } from './plugins/corePack';
import { initPluginNet } from './plugins/netUi';
import { meshData } from './model3d/store';
import { imageResource } from './plugins/imageResource';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.tabIndex = 0;
// Plugins run in their own Worker. The generators that come with the app (core pack) are registered before the
// editor reads the last project: their plugins migrate parameters of older files.
const spawn = (m: PluginManifest) => workerProcess(m.runtime, m.code, m.host ?? []);
setPluginSpawn(spawn);
useCoreGenerators(CORE_PACK_TEXT);
const editor = new Editor(canvas);
// Material and work area for plugins that declare them (#386)
setContextSource((what) => editorContext(editor, what));
// Plugins of extensions. Parts whose formulas waited for a plugin are recomputed once it answers.
initPlugins(
  spawn,
  () => {
    if (editor.paramProblems.some((x) => x.issues.some((i) => i.code === PENDING))) editor.applyParams();
  },
);
// Plugins get the 3D models their parameters name (an object of a stack model plugin) from the model store
setResourceSource((kind, id) => (kind === 'model3d' ? meshData(id) : kind === 'image' ? imageResource(id) : null));
initPluginNet();
// Erweiterungen im Hintergrund lesen; Dialoge warten bei Bedarf darauf
void ensurePacks();
buildUI(editor);
initDialogDrag(() => t('Schließen'), () => t('Größe ändern (Doppelklick: Standardgröße)'));
editor.setTool('select');
// Für Tests und Fehlersuche in der Konsole erreichbar
(window as unknown as { editor: Editor }).editor = editor;
