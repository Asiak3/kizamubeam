// Editor: Tastatur.
import type { Editor } from '../editor';
import { commandMatches } from '../commandKeys';
import { t } from '../i18n';

/** Schrittweiten der Pfeiltasten in mm (normal, mit Umschalt, mit Alt); frei belegbar, Default wie bisher */
export interface NudgeSteps { normal: number; shift: number; alt: number }
const NUDGE_STEPS_KEY = 'kizamubeam.nudgeSteps';
const DEFAULT_NUDGE_STEPS: NudgeSteps = { normal: 1, shift: 10, alt: 0.1 };const NUDGE_MIN = 0.001, NUDGE_MAX = 1000;
const validStep = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= NUDGE_MIN && v <= NUDGE_MAX;
export function loadNudgeSteps(): NudgeSteps {
  try {
    const raw = JSON.parse(localStorage.getItem(NUDGE_STEPS_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      return {
        normal: validStep(raw.normal) ? raw.normal : DEFAULT_NUDGE_STEPS.normal,
        shift: validStep(raw.shift) ? raw.shift : DEFAULT_NUDGE_STEPS.shift,
        alt: validStep(raw.alt) ? raw.alt : DEFAULT_NUDGE_STEPS.alt,
      };
    }
  } catch {
    /* Standardwerte */
  }
  return { ...DEFAULT_NUDGE_STEPS };
}
/** Schrittweiten speichern (Edit → Settings → Maus und Tastatur); false bei ungültigen Werten */
export function saveNudgeSteps(v: NudgeSteps): boolean {
  if (!validStep(v.normal) || !validStep(v.shift) || !validStep(v.alt)) return false;
  try {
    localStorage.setItem(NUDGE_STEPS_KEY, JSON.stringify({ normal: v.normal, shift: v.shift, alt: v.alt }));
    return true;
  } catch {
    return false;
  }
}

export class EditorKeyboard {
  /** Pfeiltasten-Schrittweiten mit Rückfall auf die Standardwerte (Tests ohne Konstruktor) */
  nudgeSt(this: Editor): NudgeSteps {
    return this.nudgeSteps ?? DEFAULT_NUDGE_STEPS;
  }
  /** Pfeiltasten-Schrittweiten ändern und merken */
  setNudgeSteps(this: Editor, patch: Partial<NudgeSteps>) {
    const next = { ...this.nudgeSteps, ...patch };
    if (!saveNudgeSteps(next)) throw new Error(t('Einstellung konnte nicht gespeichert werden.'));
    this.nudgeSteps = next;
  }
  onKey(this: Editor, e: KeyboardEvent) {
    if (e.defaultPrevented) return;
    const el = e.target as HTMLElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const run = (f: () => void) => {
      e.preventDefault();
      f();
    };
    if (this.outlinePreview) {
      if (e.key === 'Escape') return run(() => this.outlinePreview?.cancel());
      if (e.code === 'Space') { this.space = true; e.preventDefault(); return; }
      if (k === '0') return run(() => ctrl ? this.zoomPage() : this.zoomSelection());
      e.preventDefault();
      return;
    }
    // Skizzenmodus: eigene Tasten (Werkzeuge, Beziehungen, Esc/Enter); Ctrl+Z usw. laufen normal weiter
    if (this.pickHandler && e.key === 'Escape') {
      e.preventDefault();
      this.endPick();
      return;
    }
    if (this.tool === 'sketch' && !e.repeat && e.code !== 'Space' && this.sketchKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Space') {
      this.space = true;
      e.preventDefault();
      return;
    }
    if (ctrl && e.shiftKey) {
      if (k === 'h') return run(() => this.mirror(true));
      if (k === 'v') return run(() => this.mirror(false));
      if (k === 'z') return run(() => this.doRedo());
      if (commandMatches('tolines', e)) return run(() => this.convertSelToPath());
      if (k === 'a') return run(() => this.onGridArray?.());
    }
    const nodeMode = this.tool === 'node' && !!this.nodeTarget();
    if (commandMatches('selectall', e) && nodeMode) return run(() => this.selectAllNodes());
    if (ctrl) {
      if (k === 'z') return run(() => this.doUndo());
      if (k === 'y') return run(() => this.doRedo());
      if (commandMatches('copy', e)) return run(() => this.copy());
      if (commandMatches('cut', e)) return run(() => this.cut());
      if (commandMatches('paste', e)) {
        // Kein preventDefault: das paste-Ereignis bringt Bilder und SVG aus anderen Programmen.
        // Kommt es nicht (manche Webviews), wird die interne Zwischenablage eingefügt.
        clearTimeout(this.pasteTimer);
        this.pasteTimer = window.setTimeout(() => this.paste(), 80);
        return;
      }
      if (k === 'i') return run(() => this.onImport?.());
      if (commandMatches('duplicate', e)) return run(() => this.duplicate());
      if (commandMatches('selectall', e)) return run(() => this.selectAll());
      if (commandMatches('group', e)) return run(() => this.group());
      if (commandMatches('ungroup', e)) return run(() => this.ungroup());
      if (k === 'r') return run(() => this.setTool('rect'));
      if (k === 'e') return run(() => this.setTool('ellipse'));
      if (k === 'l') return run(() => this.setTool('line'));
      if (k === 't') return run(() => this.setTool('text'));
      if (commandMatches('tool:node', e) || (e.code === 'Backquote' && !e.altKey && !e.shiftKey)) return run(() => this.setTool('node'));
      if (k === 'k') return run(() => this.setTool('trim'));
      if (k === '0') return run(() => this.zoomPage());
      return;
    }
    if (k === 'pageup' && !e.altKey) return run(() => this.setPage(this.doc.page - 1));
    // UI-level image/preview commands must not also trigger unmodified node keys.
    if (commandMatches('trace', e) || commandMatches('preview', e)) return;
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
        if (this.tool === 'builder') return this.setTool('select');
        if (this.isolation && !this.draft && !this.sketchEdit) return this.leaveIsolation();
        if (this.tool === 'joint' && this.jointPicks.length) return this.clearJointPicks();
        if (this.tool === 'relate' && this.relPicks.length) return this.clearRelPicks();
        if (this.tool === 'measure' && this.measure) return ((this.measure = null), this.redraw());
        if (nodeMode && (this.selectedNodes().length || this.nodeTargets().some((o) => this.segmentSelection(o).size))) return this.clearNodeSel();
        // Esc verwirft den gesamten laufenden Bogen, auch zwischen zwei Klicks.
        if (this.tool === 'arc' && this.arcDraft) return this.cancelArc();
        if (this.draft) { if (this.tool === 'curvature') { this.draft = null; this.continuedFrom = null; this.redraw(); } else this.finishLine(); }
        else if (this.tool !== 'select') this.setTool('select');
        else this.setSel([]);
      });
    if (k === 'enter' && this.tool === 'arc' && this.arcDraft) return run(() => this.finishArc());
    if (k === 'enter' && this.draft) return run(() => this.finishDraft());
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
      const nst = this.nudgeSt();
      const st = e.shiftKey ? nst.shift : nst.normal;
      const arrows: Record<string, [number, number]> = { arrowleft: [-st, 0], arrowright: [st, 0], arrowup: [0, -st], arrowdown: [0, st] };
      if (arrows[k] && (this.selectedNodes().length || this.nodeTargets().some((o) => this.segmentSelection(o).size))) return run(() => this.nudgeNodes(...arrows[k]));
    }
    if (this.tool === 'curvature' && this.draft) {
      if (k === 'backspace' && !this.drag)
        return run(() => { this.draft!.nodes.pop(); if (!this.draft!.nodes.length) { this.draft = null; this.continuedFrom = null; } this.redraw(); });
      if (k === 'delete' || k === 'backspace') return run(() => {});
    }
    if (k === 'delete' || k === 'backspace') return run(() => this.deleteSel());
    const steps = this.nudgeSt();
    const step = e.shiftKey ? steps.shift : e.altKey ? steps.alt : steps.normal;
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
