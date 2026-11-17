// Modifier keys of a pointer or key event on a generator's drawing surface (#385): only the held ones, Cmd counts
// as Ctrl on macOS like the editor's shortcuts.
import type { GenPointer } from './types';

export function pointerMods(e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): Pick<GenPointer, 'shift' | 'alt' | 'ctrl'> {
  return {
    ...(e.shiftKey ? { shift: true as const } : {}),
    ...(e.altKey ? { alt: true as const } : {}),
    ...(e.ctrlKey || e.metaKey ? { ctrl: true as const } : {}),
  };
}
