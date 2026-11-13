// Schriften-Dropdown mit Hover-Vorschau für das Textwerkzeug (Prototyp).
// Ersetzt das native <select> (dessen OS-Liste keine Hover-Events liefert) durch eine eigene Popup-Liste:
// Hover oder Pfeiltasten zeigen die Schrift transient auf den gewählten Texten, erst Klick/Enter übernimmt
// permanent (mit Undo-Snapshot). Die Vorschau erzeugt keinen Verlaufseintrag und kein Autosave — sie schreibt
// direkt auf Formen/textDefaults und löst nur emit('sel') aus (reicht für Neuzeichnen, siehe onFontLoaded).
//
// BEKANNTE EINSCHRÄNKUNG (Stand 2026-11-13, Entscheidung: Prototyp behalten):
// Im Browser funktioniert die Vorschau von Systemschriften NICHT sauber. Der Canvas zeichnet Glyphen-Outlines
// aus Opentype-Binaries; loadFont löst Systemschriften mangels Local-Fonts-Permission immer auf den
// Roboto-Fallback auf. Beim Erst-Hover sieht man daher kurz die echte Systemschrift (Interim-fillText),
// danach den Roboto-Redraw — wirkt wie „Zucken und Zurückkehren". Das ist eine vorbestehende
// Plattform-Limitation (keine Prototyp-Regression: das alte Dropdown nutzt denselben Render-Pfad);
// in der Desktop-App (echte Font-Binaries via Tauri) arbeitet die Vorschau korrekt.
import { h } from './dom';
import type { Editor } from './editor';
import { t } from './i18n';
import { fontFavorites } from './fontCatalog';
import { linkGoogleCss } from './fontManager';
import { loadFont } from './fonts';
import type { TextShape } from './model';
import { closeEditorMenu } from './contextMenu';

const MANAGE = '\u0000manage';
/** Zeilen, die diese Familie im eigenen Schnitt zeigen, sobald sie im Dokument verfügbar ist */
function previewFace(row: HTMLElement, family: string) {
  const apply = (fam: string) => (row.style.fontFamily = `"${fam}", sans-serif`);
  // Lokal installierte Schrift (Systemschrift): ohne Netz-Request direkt nutzbar.
  try {
    if (document.fonts.check(`16px "${family}"`)) {
      apply(family);
      return;
    }
  } catch {
    /* weiter mit Lazy-Loading */
  }
  // Google-Font: CSS verlinken (kommt async nach); Systemschriften fallen oben raus und erzeugen keinen Request.
  void Promise.race([
    document.fonts.load(`16px "${family}"`),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500)),
  ])
    .then((faces) => (faces.length ? apply(family) : (linkGoogleCss(family), apply(family))))
    .catch(() => (linkGoogleCss(family), apply(family)));
}

export interface FontPicker {
  /** Button-Element für die Werkzeugleiste */
  el: HTMLButtonElement;
  /** Anzeige auf die Modell-Schrift synchronisieren (aus dem UI-refresh) */
  sync(font: string): void;
  /** Schriftliste neu aufbauen (wenn sich installierte Schriften ändern) */
  rebuild(names: string[]): void;
  /** Popup schließen (Vorschau wird dabei zurückgenommen) */
  close(): void;
}

export function createFontPicker(
  ed: Editor,
  opts: { initial: string[]; current: () => string; commit: (family: string) => void; openManager: () => void },
): FontPicker {
  let names = opts.initial;
  const btn = h('button', {
    type: 'button', class: 'fontpick-btn', title: t('Schriftart'),
    'aria-haspopup': 'listbox', 'aria-expanded': 'false',
  }) as HTMLButtonElement;
  const label = h('span', { class: 'fontpick-label' });
  const chev = h('span', { class: 'fontpick-chev', html: '▾' });
  btn.append(label, chev);

  let pop: HTMLElement | null = null;
  let rows: HTMLButtonElement[] = [];
  let io: IntersectionObserver | null = null;
  /** Modell-Stand bei Popup-Öffnung (zum Zurücknehmen der Vorschau) */
  let pre: { fonts: Map<number, string>; defaultsFont: string } | null = null;
  let previewed: string | null = null;
  let committedAtOpen = '';
  let disposers: (() => void)[] = [];
  /** Touch-Geräte haben kein Hover: Tap übernimmt dort direkt (Vorschau nicht möglich) */
  let touchMode = false;

  const selTexts = () => ed.selTexts();
  const flags = () => {
    const s = selTexts()[0]?.shape;
    return s?.kind === 'text' ? { bold: !!s.bold, italic: !!s.italic } : { bold: false, italic: false };
  };

  const setDisplay = (font: string) => {
    label.textContent = font;
    label.style.fontFamily = `"${font}", sans-serif`;
  };

  /** Vorschau auf die Modell-Objekte schreiben (transient, ohne Snapshot) */
  const applyPreview = (family: string) => {
    if (previewed === family) return;
    previewed = family;
    const { bold, italic } = flags();
    void loadFont(family, bold, italic).catch(() => undefined); // Fertigstellung zeichnet onFontLoaded neu
    const ts = selTexts();
    if (ts.length) for (const o of ts) {
      (o.shape as TextShape).font = family;
      ed.touch(o.shape);
    }
    else ed.textDefaults.font = family;
    ed.emit('sel');
    setDisplay(family);
  };

  /** Modell auf den Öffnungs-Stand zurücksetzen (transient, ohne Snapshot) */
  const restore = () => {
    if (!pre || previewed === null) return;
    previewed = null;
    for (const o of selTexts()) {
      const f = pre.fonts.get(o.id);
      if (f !== undefined && o.shape.kind === 'text') {
        o.shape.font = f;
        ed.touch(o.shape);
      }
    }
    ed.textDefaults.font = pre.defaultsFont;
    ed.emit('sel');
    setDisplay(opts.current());
  };

  const dispose = () => {
    disposers.forEach((d) => d());
    disposers = [];
    io?.disconnect();
    io = null;
    pop?.remove();
    pop = null;
    rows = [];
    btn.setAttribute('aria-expanded', 'false');
  };

  const close = () => {
    if (!pop) return;
    restore();
    dispose();
    pre = null;
    if (btn.isConnected) btn.focus({ preventScroll: true });
  };

  /** Permanent übernehmen: erst Vorschau zurücknehmen (Undo-Basis!), dann committen */
  const commitAndClose = (family: string) => {
    const keep = pop !== null;
    restore();
    dispose();
    pre = null;
    if (keep) opts.commit(family);
    if (btn.isConnected) btn.focus({ preventScroll: true });
  };

  const markActive = (row: HTMLButtonElement | null) => {
    rows.forEach((r) => r.classList.toggle('active', r === row));
  };

  const onRowEnter = (family: string) => {
    const row = rows.find((r) => r.dataset.family === family) ?? null;
    markActive(row);
    row?.focus({ preventScroll: true });
    if (family === MANAGE || (row?.dataset.missing && family === committedAtOpen)) restore();
    else applyPreview(family);
  };

  const buildRows = (parent: HTMLElement, list: string[], missing: string | null) => {
    const lower = new Set(names.map((f) => f.toLowerCase()));
    const favs = fontFavorites().filter((f) => lower.has(f.toLowerCase()));
    const mk = (family: string, miss = false) => {
      const b = h('button', {
        type: 'button', role: 'option', class: 'fontpick-row' + (miss ? ' missing' : ''),
        'data-family': family, 'aria-selected': String(family === committedAtOpen),
        onmouseenter: () => {
          if (!touchMode) onRowEnter(family);
        },
        onclick: () => {
          if (family === MANAGE) {
            restore();
            dispose();
            pre = null;
            opts.openManager();
            return;
          }
          commitAndClose(family);
        },
      }, h('span', {}, family)) as HTMLButtonElement;
      if (miss) b.dataset.missing = '1';
      io!.observe(b);
      rows.push(b);
      return b;
    };
    if (missing) parent.append(mk(missing, true));
    if (favs.length) {
      parent.append(h('div', { class: 'fontpick-group', role: 'presentation' }, t('Favoriten')));
      favs.forEach((f) => parent.append(mk(f)));
      parent.append(h('div', { class: 'fontpick-group', role: 'presentation' }, t('Alle Schriften')));
    }
    list.forEach((f) => parent.append(mk(f)));
    parent.append(h('div', { class: 'fontpick-group', role: 'presentation' }, '…'));
    parent.append(mk(MANAGE));
    const man = rows[rows.length - 1];
    man.replaceChildren(h('span', {}, t('Weitere Schriften …')));
  };

  const keydown = (e: KeyboardEvent) => {
    // Tastatur gehört dem Popup, solange es offen ist (wie im Editor-Kontextmenü).
    e.stopImmediatePropagation();
    if (!pop) return;
    const cur = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = rows.length;
      const next = rows[(cur + (e.key === 'ArrowDown' ? 1 : -1) + n) % n];
      if (next) onRowEnter(next.dataset.family!);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const fam = rows[cur]?.dataset.family;
      if (fam === MANAGE) {
        restore();
        dispose();
        pre = null;
        opts.openManager();
      } else if (fam) commitAndClose(fam);
    } else if (e.key === 'Tab') {
      // Verlassen übernimmt die aktive Vorschau, sonst ohne Änderung schließen.
      e.preventDefault();
      if (previewed !== null) commitAndClose(previewed);
      else close();
    } else if (e.key.length === 1) {
      // Anfangsbuchstaben-Sprung wie im nativen Dropdown.
      const hit = rows.find((r) => (r.dataset.family ?? '').toLowerCase().startsWith(e.key.toLowerCase()));
      if (hit) onRowEnter(hit.dataset.family!);
    }
  };

  const open = () => {
    if (pop) {
      close();
      return;
    }
    closeEditorMenu();
    committedAtOpen = opts.current();
    pre = {
      fonts: new Map(selTexts().map((o) => [o.id, (o.shape as TextShape).font])),
      defaultsFont: ed.textDefaults.font,
    };
    previewed = null;
    rows = [];
    pop = h('div', { class: 'fontpick-pop', role: 'listbox' });
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const b = e.target as HTMLButtonElement;
          io!.unobserve(b);
          if (b.dataset.family && b.dataset.family !== MANAGE && !b.dataset.missing) previewFace(b, b.dataset.family);
        }
      },
      { root: pop },
    );
    const lower = new Set(names.map((f) => f.toLowerCase()));
    const missing = committedAtOpen && !lower.has(committedAtOpen.toLowerCase()) ? committedAtOpen : null;
    buildRows(pop, names, missing);
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    pop.style.minWidth = `${Math.max(220, r.width)}px`;
    pop.style.left = `${Math.max(4, Math.min(r.left, innerWidth - pop.offsetWidth - 4))}px`;
    pop.style.top = `${r.bottom + 4}px`;
    if (r.bottom + 4 + pop.offsetHeight > innerHeight - 4)
      pop.style.top = `${Math.max(4, r.top - 4 - pop.offsetHeight)}px`;
    btn.setAttribute('aria-expanded', 'true');
    touchMode = matchMedia('(hover: none)').matches;
    const outside = (e: MouseEvent) => {
      if (!pop || pop.contains(e.target as Node) || btn.contains(e.target as Node)) return;
      close();
    };
    const onResize = () => close();
    const onBlur = () => close();
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onBlur);
    disposers = [
      () => document.removeEventListener('mousedown', outside, true),
      () => document.removeEventListener('keydown', keydown, true),
      () => window.removeEventListener('resize', onResize),
      () => window.removeEventListener('blur', onBlur),
    ];
    const start = rows.find((x) => x.dataset.family === committedAtOpen && !x.dataset.missing) ?? rows[0];
    if (start) {
      markActive(start);
      start.focus({ preventScroll: true });
      start.scrollIntoView({ block: 'nearest' });
    }
  };

  btn.addEventListener('click', open);
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });

  setDisplay(opts.current());

  return {
    el: btn,
    sync: (font: string) => setDisplay(font),
    rebuild: (list: string[]) => {
      names = list;
      if (pop) close();
    },
    close,
  };
}
