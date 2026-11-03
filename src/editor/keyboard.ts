// Editor: Tastatur.
import type { Editor } from '../editor';

export class EditorKeyboard {
  onKey(this: Editor, e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const run = (f: () => void) => {
      e.preventDefault();
      f();
    };
    if (e.code === 'Space') {
      this.space = true;
      e.preventDefault();
      return;
    }
    if (ctrl && e.shiftKey) {
      if (k === 'h') return run(() => this.mirror(true));
      if (k === 'v') return run(() => this.mirror(false));
      if (k === 'z') return run(() => this.doRedo());
      if (k === 'c') return run(() => this.convertSelToPath());
      if (k === 'a') return run(() => this.onGridArray?.());
    }
    const nodeMode = this.tool === 'node' && !!this.nodeTarget();
    if (ctrl && !e.shiftKey && k === 'a' && nodeMode) return run(() => this.selectAllNodes());
    if (ctrl) {
      if (k === 'z') return run(() => this.doUndo());
      if (k === 'y') return run(() => this.doRedo());
      if (k === 'c') return run(() => this.copy());
      if (k === 'x') return run(() => this.cut());
      if (k === 'v') {
        // Kein preventDefault: das paste-Ereignis bringt Bilder und SVG aus anderen Programmen.
        // Kommt es nicht (manche Webviews), wird die interne Zwischenablage eingefügt.
        clearTimeout(this.pasteTimer);
        this.pasteTimer = window.setTimeout(() => this.paste(), 80);
        return;
      }
      if (k === 'i') return run(() => this.onImport?.());
      if (k === 'd') return run(() => this.duplicate());
      if (k === 'a') return run(() => this.selectAll());
      if (k === 'g') return run(() => this.group());
      if (k === 'u') return run(() => this.ungroup());
      if (k === 'r') return run(() => this.setTool('rect'));
      if (k === 'e') return run(() => this.setTool('ellipse'));
      if (k === 'l') return run(() => this.setTool('line'));
      if (k === 't') return run(() => this.setTool('text'));
      if (k === '`' || e.code === 'Backquote') return run(() => this.setTool('node'));
      if (k === 'k') return run(() => this.setTool('trim'));
      if (k === '0') return run(() => this.zoomPage());
      return;
    }
    if (k === 'pageup' && !e.altKey) return run(() => this.setPage(this.doc.page - 1));
    if (k === 'pagedown' && !e.altKey) return run(() => this.setPage(this.doc.page + 1));
    // Boolesche Operationen: Alt + Plus / Minus / Stern (Mac: Option liefert ±, – bzw. ein Sonderzeichen, daher auch Ziffernblock-Codes)
    if (e.altKey && (k === '+' || k === '±' || e.code === 'NumpadAdd')) return run(() => void this.booleanSel('union'));
    if (e.altKey && (k === '-' || k === '–' || e.code === 'NumpadSubtract')) return run(() => void this.booleanSel('subtract'));
    if (e.altKey && (k === '*' || e.code === 'NumpadMultiply')) return run(() => void this.booleanSel('intersect'));
    if (e.altKey && k === 'w') return run(() => ((this.filled = !this.filled), this.emit('view')));
    // Alt+J / Alt+B (Mac: Option, dort liefert e.key ein Sonderzeichen, daher e.code)
    if (e.altKey && !e.shiftKey && e.code === 'KeyJ') return run(() => this.joinSel());
    if (e.altKey && !e.shiftKey && e.code === 'KeyB') return run(() => this.breakApartSel());
    if (k === 'escape')
      return run(() => {
        if (this.drag) return this.cancelDrag();
        if (this.tool === 'joint' && this.jointPicks.length) return this.clearJointPicks();
        if (this.tool === 'relate' && this.relPicks.length) return this.clearRelPicks();
        if (this.tool === 'measure' && this.measure) return ((this.measure = null), this.redraw());
        if (nodeMode && this.selectedNodes().length) return this.clearNodeSel();
        if (this.draft) this.finishLine();
        else if (this.tool !== 'select') this.setTool('select');
        else this.setSel([]);
      });
    if (k === 'enter' && this.draft) return run(() => this.finishLine());
    if (k === 'enter' && this.tool === 'joint' && this.jointPicks.length) return run(() => this.onJointDialog?.());
    if (nodeMode && !ctrl && !e.altKey) {
      if (k === 'd' || k === 'delete' || k === 'backspace') return run(() => this.deleteNodes());
      if (k === 'i') return run(() => this.insertNode());
      if (k === 'l') return run(() => this.setSegmentType(false));
      if (k === 'c') return run(() => this.setSegmentType(true));
      if (k === 'e') return run(() => this.setNodeType(false));
      if (k === 's') return run(() => this.setNodeType(true));
      if (k === 'b') return run(() => this.breakAtNodeKey());
      if (k === 't') return run(() => this.trimNodeSegment());
      const st = e.shiftKey ? 10 : 1;
      const arrows: Record<string, [number, number]> = { arrowleft: [-st, 0], arrowright: [st, 0], arrowup: [0, -st], arrowdown: [0, st] };
      if (arrows[k] && this.selectedNodes().length) return run(() => this.nudgeNodes(...arrows[k]));
    }
    if (k === 'delete' || k === 'backspace') return run(() => this.deleteSel());
    const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    if (k === 'arrowleft') return run(() => this.nudge(-step, 0));
    if (k === 'arrowright') return run(() => this.nudge(step, 0));
    if (k === 'arrowup') return run(() => this.nudge(0, -step));
    if (k === 'arrowdown') return run(() => this.nudge(0, step));
    if (k === '.') return run(() => this.rotateBy(-90));
    if (k === ',') return run(() => this.rotateBy(90));
    if (k === '+' || k === '=') return run(() => this.zoomAt(1.25));
    if (k === '-') return run(() => this.zoomAt(0.8));
    if (this.sel.length > 1) {
      const map: Record<string, Parameters<Editor['align']>[0]> = {
        l: 'left', r: 'right', t: 'top', b: 'bottom', c: 'hcenter', e: 'vcenter',
      };
      if (map[k]) return run(() => this.align(map[k]));
    }
  }
}
