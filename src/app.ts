// Start der Oberfläche (aus main.ts, nachdem der Abgleich der Einstellungen gelaufen ist)
import { Editor } from './editor';
import { buildUI } from './ui';
import { ensurePacks } from './packs';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.tabIndex = 0;
const editor = new Editor(canvas);
// Erweiterungen im Hintergrund lesen; Dialoge warten bei Bedarf darauf
void ensurePacks();
buildUI(editor);
editor.setTool('select');
// Für Tests und Fehlersuche in der Konsole erreichbar
(window as unknown as { editor: Editor }).editor = editor;
