/** Shared defaults for command dispatch and menu display, not extracted from translated labels.
 * No preference editor/override format is introduced in this prototype. */
const keys: Record<string, string> = {
  cut: 'Ctrl+X', copy: 'Ctrl+C', paste: 'Ctrl+V', duplicate: 'Ctrl+D', delete: 'Delete',
  selectall: 'Ctrl+A', group: 'Ctrl+G', ungroup: 'Ctrl+U', tolines: 'Ctrl+Shift+C',
  'tool:node': 'Ctrl+`', trace: 'Alt+T', preview: 'Alt+P', join: 'Alt+J', breakapart: 'Alt+B',
  mirrorh: 'Ctrl+Shift+H', mirrorv: 'Ctrl+Shift+V', alignl: 'L', alignhc: 'C', zoompage: 'Ctrl+0',
};
export const commandKey = (id: string): string => keys[id] ?? '';
export function commandMatches(id: string, event: KeyboardEvent): boolean {
  const binding = commandKey(id);
  if (!binding) return false;
  const parts = binding.toLowerCase().split('+'), key = parts.pop();
  return event.key.toLowerCase() === key && (event.ctrlKey || event.metaKey) === parts.includes('ctrl')
    && event.altKey === parts.includes('alt') && event.shiftKey === parts.includes('shift');
}
