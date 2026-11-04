// Window preferences of the Virtual Machine: colour theme and the sidebar layout (width, side, hidden, folded
// cards). Everything is stored per computer in localStorage and works without it.

export type Theme = 'system' | 'light' | 'dark';

const THEME_KEY = 'kizamubeam-vm.theme';
const SIDE_KEY = 'kizamubeam-vm.side';

export const SIDE_DEFAULT = 360;
export const SIDE_MIN = 260;

function read(k: string) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

function write(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage not available */
  }
}

// ---------- theme ----------

const dark = window.matchMedia('(prefers-color-scheme: dark)');
let theme: Theme = ((t) => (t === 'light' || t === 'dark' ? t : 'system'))(
  read(THEME_KEY),
);
const listeners: (() => void)[] = [];

function applyTheme() {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  for (const f of listeners) f();
}
applyTheme();
dark.addEventListener('change', () => theme === 'system' && applyTheme());

export const getTheme = () => theme;
/** true when the dark colours are in use right now */
export const isDark = () =>
  theme === 'system' ? dark.matches : theme === 'dark';

export function setTheme(t: Theme) {
  theme = t;
  write(THEME_KEY, t);
  applyTheme();
}

/** Called after the colours changed (theme switch or system change); canvases read the CSS variables again */
export function onThemeChange(f: () => void) {
  listeners.push(f);
}

// ---------- sidebar ----------

export interface SideLayout {
  width: number;
  left: boolean;
  hidden: boolean;
  /** ids of folded cards */
  folded: string[];
}

export function loadSide(): SideLayout {
  try {
    const v = JSON.parse(read(SIDE_KEY) ?? '{}') as Partial<SideLayout>;
    return {
      width:
        typeof v.width === 'number' && Number.isFinite(v.width)
          ? Math.max(SIDE_MIN, v.width)
          : SIDE_DEFAULT,
      left: v.left === true,
      hidden: v.hidden === true,
      folded: Array.isArray(v.folded)
        ? v.folded.filter((f) => typeof f === 'string')
        : [],
    };
  } catch {
    return { width: SIDE_DEFAULT, left: false, hidden: false, folded: [] };
  }
}

export const saveSide = (s: SideLayout) => write(SIDE_KEY, JSON.stringify(s));
