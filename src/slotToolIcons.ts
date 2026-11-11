import { ICONS } from './icons';

// Fixed, trusted SVG markup only; labels and user feature names are separate text.
const svg = (body: string) => `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
export const SLOT_TOOL_ICONS: Record<string, string> = {
  ...ICONS,
  pan: svg('<path d="M8 12V5a1.5 1.5 0 013 0v6-8a1.5 1.5 0 013 0v8-6a1.5 1.5 0 013 0v7-4a1.5 1.5 0 013 0v7c0 4-2 7-6 7h-2c-2 0-3-1-4-3l-4-6a1.7 1.7 0 012.5-2L8 14"/>'),
  helper: svg('<circle cx="5" cy="8" r="2"/><circle cx="19" cy="8" r="2"/><path d="M7 8h10M12 2v20M12 12h4V8" stroke-dasharray="2 2"/>'),
  left: svg('<path d="M20 12H4l6-6M4 12l6 6"/>'),
  right: svg('<path d="M4 12h16l-6-6M20 12l-6 6"/>'),
  stage: svg('<path d="M4 12l5 5L20 6"/><path d="M4 21h16"/>'),
};
