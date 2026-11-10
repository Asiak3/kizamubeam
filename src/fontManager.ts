// Fenster „Schriften“ (Font-Manager): Google Fonts durchsuchen und mit Vorschau laden, eigene TTF/OTF-Dateien
// verwalten, Favoriten. Beim Öffnen eines Projekts fehlende Schriften von Google Fonts nachladen.
// Geladene Schriften liegen im Einstellungsordner der App (src-tauri/src/fonts.rs) und gehen auch offline.
import { h } from './dom';
import type { Editor } from './editor';
import { t, tn } from './i18n';
import { hasFontManager, refreshFonts, systemFonts } from './fonts';
import {
  autoInstallFonts, CatalogFont, findFont, FontCategory, fontFavorites, fontsInDoc, missingFonts, parseCatalog, pickVariants, searchFonts,
  setAutoInstallFonts, setFontFavorite, styleInfo,
} from './fontCatalog';

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface OwnFont {
  family: string;
  kind: 'google' | 'custom';
  styles: number;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

// ---------- Schriftliste ----------

let catalog: { fonts: CatalogFont[]; source: string; age: number } | null = null;
let catalogLoading: Promise<CatalogFont[]> | null = null;

/** Schriftliste von Google Fonts (gespeichert bis zu einer Woche; refresh lädt neu). Fehler, wenn nichts zu bekommen ist. */
export function loadCatalog(refresh = false): Promise<CatalogFont[]> {
  if (catalog && !refresh) return Promise.resolve(catalog.fonts);
  if (catalogLoading && !refresh) return catalogLoading;
  catalogLoading = (async () => {
    let source: string, text: string, age = 0;
    if (hasFontManager()) [source, text, age] = await invoke<[string, string, number]>('font_catalog', { refresh });
    else {
      // Browser-Vorschau: Nur Fontsource erlaubt das Abrufen von fremden Seiten (CORS)
      const r = await fetch('https://api.fontsource.org/v1/fonts?type=google');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      [source, text] = ['fontsource', await r.text()];
    }
    const fonts = parseCatalog(source, text);
    if (!fonts.length) throw new Error(t('Die Schriftliste ist leer.'));
    catalog = { fonts, source, age };
    return fonts;
  })().finally(() => (catalogLoading = null));
  return catalogLoading;
}

/** Schriften im eigenen Ordner der App */
export async function ownFonts(): Promise<OwnFont[]> {
  return hasFontManager() ? invoke<OwnFont[]>('font_installed') : [];
}

/**
 * Familie von Google Fonts laden (normal, fett, kursiv, soweit vorhanden). Gibt die Familiennamen der geladenen
 * Dateien zurück und lädt betroffene Texte neu.
 */
export async function installGoogleFont(family: string, info?: CatalogFont): Promise<string[]> {
  const r = await invoke<{ families: string[]; files: number }>('font_install_google', { family, variants: pickVariants(info) });
  refreshFonts([family, ...r.families]);
  return r.families;
}

// ---------- Vorschau ----------

const linked = new Set<string>();
/** Vorschau einer Google-Schrift im Fenster (Webfont von fonts.googleapis.com, wird nicht installiert) */
function linkGoogleCss(family: string) {
  if (linked.has(family)) return;
  linked.add(family);
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}&display=swap`;
  document.head.append(h('link', { rel: 'stylesheet', href, 'data-font-preview': '' }));
}

const faces = new Map<string, Promise<string>>();
/** Eigene Schrift (aus dem App-Ordner) als Webfont anmelden, damit die Vorschau sie zeigen kann */
function ownFace(family: string): Promise<string> {
  let p = faces.get(family);
  if (!p) {
    p = (async () => {
      const buf = await invoke<ArrayBuffer>('font_data', { family, bold: false, italic: false });
      const name = `kzb-preview-${faces.size}`;
      const face = new FontFace(name, buf);
      await face.load();
      document.fonts.add(face);
      return name;
    })().catch(() => '');
    faces.set(family, p);
  }
  return p;
}

const CATS: [FontCategory | 'all', () => string][] = [
  ['all', () => t('Alle Arten')],
  ['sans', () => t('Serifenlos')],
  ['serif', () => t('Serif')],
  ['display', () => t('Display')],
  ['handwriting', () => t('Handschrift')],
  ['mono', () => t('Monospace')],
];
const catLabel = (c: FontCategory) => (CATS.find((x) => x[0] === c)?.[1] ?? (() => ''))();

// ---------- Fenster ----------

const PAGE = 60;

export async function openFontManager(ed: Editor) {
  const desktop = hasFontManager();
  type Tab = 'google' | 'own' | 'fav';
  let tab: Tab = 'google';
  let own: OwnFont[] = [];
  let system: string[] = [];
  let shown = PAGE;
  let fonts: CatalogFont[] = [];

  const err = h('p', { class: 'error' });
  const status = h('p', { class: 'note' });
  const list = h('div', { class: 'font-list' });
  const search = h('input', { type: 'search', placeholder: t('Schrift suchen …'), class: 'font-search' }) as HTMLInputElement;
  const cat = h('select', { title: t('Art der Schrift') }, ...CATS.map(([v, l]) => h('option', { value: v }, l()))) as HTMLSelectElement;
  const sort = h('select', { title: t('Sortierung') }, h('option', { value: 'popular' }, t('Beliebt')), h('option', { value: 'name' }, t('Name'))) as HTMLSelectElement;
  const firstText = ed.selTexts()[0];
  const sampleIn = h('input', {
    type: 'text', class: 'font-sample-in', title: t('Vorschautext'),
    value: firstText?.shape.kind === 'text' && firstText.shape.text.trim() ? firstText.shape.text.split('\n')[0].slice(0, 60) : 'KizamuBeam 0123',
  }) as HTMLInputElement;
  const tabBtns = (['google', 'own', 'fav'] as Tab[]).map((id) => {
    const b = h('button', { class: 'toggle' }, { google: t('Google Fonts'), own: t('Eigene Schriften'), fav: t('Favoriten') }[id]);
    b.onclick = () => ((tab = id), (shown = PAGE), fill());
    return [id, b] as const;
  });

  const isOwn = (family: string) => own.find((o) => o.family.toLowerCase() === family.toLowerCase());
  const isSystem = (family: string) => system.some((s) => s.toLowerCase() === family.toLowerCase());

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const el = e.target as HTMLElement;
      io.unobserve(el);
      const fam = el.dataset.family!;
      if (el.dataset.src === 'google') {
        linkGoogleCss(fam);
        el.style.fontFamily = `"${fam}", var(--font-ui, sans-serif)`;
      } else if (el.dataset.src === 'own') void ownFace(fam).then((n) => n && (el.style.fontFamily = `"${n}", sans-serif`));
      else el.style.fontFamily = `"${fam}", sans-serif`;
    }
  }, { root: list });

  const useFont = (family: string) => {
    if (!ed.selTexts().length) {
      ed.updateTexts({ font: family }); // merkt die Schrift für den nächsten Text
      status.textContent = t('„{font}“ wird für neue Texte verwendet.', { font: family });
      return;
    }
    ed.updateTexts({ font: family });
    status.textContent = t('Schrift der gewählten Texte: {font}', { font: family });
  };

  const row = (family: string, opts: { info?: CatalogFont; src: 'google' | 'own' | 'system' }) => {
    const fav = fontFavorites().some((f) => f.toLowerCase() === family.toLowerCase());
    const star = h('button', { class: 'font-star' + (fav ? ' on' : ''), title: fav ? t('Aus Favoriten entfernen') : t('Zu Favoriten') }, fav ? '★' : '☆');
    star.onclick = () => {
      setFontFavorite(family, !fav);
      refreshFonts();
      fill();
    };
    const o = isOwn(family);
    const installed = !!o || isSystem(family);
    const meta: string[] = [];
    if (opts.info) {
      meta.push(catLabel(opts.info.category));
      const s = styleInfo(opts.info);
      meta.push([s.bold ? t('fett') : '', s.italic ? t('kursiv') : ''].filter(Boolean).join(', ') || t('nur normal'));
    }
    if (o) meta.push(o.kind === 'google' ? t('von Google Fonts geladen') : t('eigene Datei'));
    else if (isSystem(family)) meta.push(t('auf dem Rechner installiert'));
    const sample = h('div', { class: 'font-sample', 'data-family': family, 'data-src': installed && !o ? 'system' : o ? 'own' : 'google' }, sampleIn.value || family);
    io.observe(sample);
    const buttons: HTMLElement[] = [];
    if (installed) buttons.push(h('button', { class: 'btn small primary', onclick: () => useFont(o?.family ?? family) }, t('Verwenden')));
    if (!installed && desktop && opts.src === 'google') {
      const b = h('button', { class: 'btn small primary' }, t('Installieren')) as HTMLButtonElement;
      b.onclick = async () => {
        b.disabled = true;
        b.textContent = t('Lädt …');
        err.textContent = '';
        try {
          const got = await installGoogleFont(family, opts.info);
          own = await ownFonts();
          system = (await systemFonts()) ?? system;
          status.textContent = t('„{font}“ installiert.', { font: got[0] ?? family });
        } catch (e) {
          err.textContent = errText(e);
        }
        fill();
      };
      buttons.push(b);
    }
    if (o && desktop) {
      buttons.push(h('button', {
        class: 'btn small',
        onclick: async () => {
          if (!confirm(t('Schrift „{font}“ entfernen? Texte damit werden danach mit Roboto gezeichnet, bis die Schrift wieder installiert ist.', { font: o.family }))) return;
          try {
            await invoke('font_remove', { family: o.family, kind: o.kind });
            faces.delete(o.family);
            refreshFonts([o.family]);
            own = await ownFonts();
            system = (await systemFonts()) ?? system;
          } catch (e) {
            err.textContent = errText(e);
          }
          fill();
        },
      }, t('Entfernen')));
    }
    return h('div', { class: 'font-row' },
      star,
      h('div', { class: 'font-text' },
        h('div', {}, h('b', {}, family), meta.length ? h('span', { class: 'muted' }, ` · ${meta.join(' · ')}`) : null),
        sample,
      ),
      ...buttons,
    );
  };

  const fill = () => {
    for (const [id, b] of tabBtns) b.classList.toggle('on', id === tab);
    cat.disabled = sort.disabled = tab !== 'google';
    list.replaceChildren();
    io.disconnect();
    const q = search.value;
    let rows: HTMLElement[] = [];
    let total = 0;
    if (tab === 'google') {
      const hits = searchFonts(fonts, { query: q, category: cat.value as FontCategory | 'all', sort: sort.value as 'popular' | 'name' });
      total = hits.length;
      rows = hits.slice(0, shown).map((f) => row(f.family, { info: f, src: 'google' }));
      if (!fonts.length && q.trim() && desktop) {
        // Ohne Liste: Namen direkt laden (Schreibweise wie auf fonts.google.com)
        const b = h('button', { class: 'btn small primary' }, t('„{font}“ von Google Fonts laden', { font: q.trim() })) as HTMLButtonElement;
        b.onclick = async () => {
          b.disabled = true;
          try {
            const got = await installGoogleFont(q.trim());
            own = await ownFonts();
            system = (await systemFonts()) ?? system;
            status.textContent = t('„{font}“ installiert.', { font: got[0] ?? q.trim() });
            tab = 'own';
          } catch (e) {
            err.textContent = errText(e);
          }
          fill();
        };
        rows.push(h('div', { class: 'font-row' }, h('div', { class: 'font-text' }, t('Die Schriftliste ist nicht verfügbar. Du kannst eine Schrift trotzdem mit ihrem genauen Namen laden.')), b));
      }
    } else if (tab === 'own') {
      const hits = own.filter((o) => !q || o.family.toLowerCase().includes(q.toLowerCase()));
      total = hits.length;
      rows = hits.map((o) => row(o.family, { info: findFont(fonts, o.family), src: 'own' }));
      if (!own.length)
        rows.push(h('p', { class: 'note' }, desktop
          ? t('Noch keine eigenen Schriften. Lade Schriften von Google Fonts oder importiere eigene TTF- oder OTF-Dateien; sie liegen im Ordner der App und gehen auch offline.')
          : t('Eigene Schriften gibt es nur in der Desktop-App.')));
    } else {
      const favs = fontFavorites().filter((f) => !q || f.toLowerCase().includes(q.toLowerCase()));
      total = favs.length;
      rows = favs.map((f) => {
        const info = findFont(fonts, f);
        return row(f, { info, src: isOwn(f) || isSystem(f) ? 'system' : 'google' });
      });
      if (!favs.length) rows.push(h('p', { class: 'note' }, t('Markiere Schriften mit dem Stern. Favoriten stehen in der Schriftauswahl ganz oben.')));
    }
    list.append(...rows);
    if (tab === 'google' && total > shown) {
      const more = h('button', { class: 'btn small font-more' }, tn('{n} weitere anzeigen|one', '{n} weitere anzeigen', Math.min(PAGE, total - shown)));
      more.onclick = () => ((shown += PAGE), fill());
      list.append(more);
    }
    if (tab === 'google' && fonts.length) status.textContent ||= tn('{n} Schrift', '{n} Schriften', total);
  };

  let timer = 0;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => ((shown = PAGE), (status.textContent = ''), fill()), 150);
  });
  cat.onchange = sort.onchange = () => ((shown = PAGE), (status.textContent = ''), fill());
  sampleIn.addEventListener('input', () => list.querySelectorAll<HTMLElement>('.font-sample').forEach((el) => (el.textContent = sampleIn.value || el.dataset.family!)));

  const load = async (refresh: boolean) => {
    status.textContent = t('Schriftliste wird geladen …');
    try {
      fonts = await loadCatalog(refresh);
      status.textContent = '';
    } catch (e) {
      fonts = [];
      status.textContent = t('Schriftliste nicht verfügbar: {message}', { message: errText(e) });
    }
    fill();
  };

  const importBtn = h('button', {
    class: 'btn',
    onclick: async () => {
      err.textContent = '';
      try {
        const got = await invoke<string[]>('font_import', { filterName: t('Schriften (TTF, OTF)') });
        if (!got.length) return;
        refreshFonts(got);
        own = await ownFonts();
        system = (await systemFonts()) ?? system;
        status.textContent = tn('{n} Schrift importiert: {fonts}', '{n} Schriften importiert: {fonts}', got.length, { fonts: got.join(', ') });
        tab = 'own';
        fill();
      } catch (e) {
        err.textContent = errText(e);
      }
    },
  }, t('Eigene Schrift importieren …'));

  const dlg = h('dialog', { class: 'packs-dialog font-dialog' },
    h('h3', {}, t('Schriften')),
    h('div', { class: 'font-tabs' }, ...tabBtns.map(([, b]) => b)),
    h('div', { class: 'font-tools' }, search, cat, sort),
    h('label', { class: 'font-sample-label' }, t('Vorschau'), ' ', sampleIn),
    list,
    status,
    err,
    desktop ? null : h('p', { class: 'note' }, t('Installieren geht nur in der Desktop-App. Hier siehst du die Schriften nur als Vorschau.')),
    h('p', { class: 'note' }, t('Google-Fonts-Schriften stehen unter freien Lizenzen (meist SIL Open Font License) und dürfen auch für verkaufte Laserarbeiten genutzt werden.')),
    h('div', { class: 'dialog-buttons' },
      desktop ? h('button', { class: 'btn', onclick: () => invoke('font_open_folder').catch((e) => (err.textContent = errText(e))) }, t('Ordner zeigen')) : null,
      desktop ? importBtn : null,
      h('button', { class: 'btn', onclick: () => load(true) }, t('Liste neu laden')),
      h('span', { class: 'param-spacer' }),
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen')),
    ),
  ) as HTMLDialogElement;
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => (io.disconnect(), dlg.remove()));
  document.body.append(dlg);
  dlg.showModal();
  search.focus();
  [own, system] = await Promise.all([ownFonts().catch(() => []), systemFonts().then((s) => s ?? [])]);
  fill();
  void load(false);
}

// ---------- Fehlende Schriften beim Öffnen ----------

/**
 * Nach dem Öffnen eines Projekts: Schriften, die nicht installiert sind, von Google Fonts nachladen (mit Rückfrage,
 * außer „ohne Rückfrage“ ist eingestellt). Schriften, die es dort nicht gibt, werden nur genannt.
 */
export async function checkProjectFonts(ed: Editor) {
  if (!hasFontManager()) return;
  const installed = await systemFonts();
  if (!installed) return;
  const missing = missingFonts(fontsInDoc(ed.doc), installed);
  if (!missing.length) return;
  let list: CatalogFont[] = [];
  try {
    list = await loadCatalog();
  } catch {
    /* ohne Netz: nur Hinweis */
  }
  const avail = missing.map((f) => findFont(list, f)).filter((f): f is CatalogFont => !!f);
  const unknown = missing.filter((f) => !findFont(list, f));
  const hint = (msg: string) => {
    ed.hint = msg;
    ed.emit('tool');
  };
  if (!avail.length) {
    hint(tn('Schrift {fonts} nicht gefunden, Roboto verwendet.', 'Schriften {fonts} nicht gefunden, Roboto verwendet.', unknown.length, { fonts: unknown.join(', ') }));
    return;
  }
  const install = async () => {
    const done: string[] = [];
    const failed: string[] = [];
    for (const f of avail)
      try {
        await installGoogleFont(f.family, f);
        done.push(f.family);
      } catch {
        failed.push(f.family);
      }
    const parts = [];
    if (done.length) parts.push(tn('Schrift {fonts} von Google Fonts geladen.', 'Schriften {fonts} von Google Fonts geladen.', done.length, { fonts: done.join(', ') }));
    if (failed.length || unknown.length) parts.push(tn('Schrift {fonts} nicht gefunden, Roboto verwendet.', 'Schriften {fonts} nicht gefunden, Roboto verwendet.', failed.length + unknown.length, { fonts: [...failed, ...unknown].join(', ') }));
    hint(parts.join(' '));
  };
  if (autoInstallFonts()) return install();

  const auto = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const ok = h('button', { class: 'btn primary' }, t('Laden')) as HTMLButtonElement;
  const dlg = h('dialog', { class: 'packs-dialog' },
    h('h3', {}, t('Fehlende Schriften')),
    h('p', {}, tn('Dieses Projekt nutzt eine Schrift, die nicht installiert ist. Sie ist bei Google Fonts frei erhältlich:', 'Dieses Projekt nutzt Schriften, die nicht installiert sind. Sie sind bei Google Fonts frei erhältlich:', avail.length)),
    h('ul', { class: 'pack-contents' }, ...avail.map((f) => h('li', {}, f.family))),
    unknown.length ? h('p', { class: 'warn' }, t('Nicht bei Google Fonts: {fonts}. Diese Texte werden mit Roboto gezeichnet.', { fonts: unknown.join(', ') })) : null,
    h('label', { class: 'check' }, auto, ' ', t('Fehlende Schriften künftig ohne Rückfrage laden')),
    h('div', { class: 'dialog-buttons' }, ok, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Nicht jetzt'))),
  ) as HTMLDialogElement;
  ok.onclick = async () => {
    ok.disabled = true;
    if (auto.checked) setAutoInstallFonts(true);
    await install();
    dlg.close();
  };
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
