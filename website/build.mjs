#!/usr/bin/env node
// Builds website/index.html (DE) and website/en/index.html (EN) from
// template.html + i18n/*.json. Zero dependencies: `node website/build.mjs`.
// The generated HTML is committed so GitHub Pages can serve it as-is.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const SITE = 'https://negurvulkan.github.io/kizamubeam/';
const REPO = 'https://github.com/negurvulkan/kizamubeam';
const RELEASES = `${REPO}/releases`;
// The Virtual Machine has its own vm-v* tags; this lists only those releases.
const VM_RELEASES = `${RELEASES}?q=vm-v&expanded=true`;
const DISCORD = 'https://discord.gg/SSr8VHh7EJ';
const LICENSE = `${REPO}/blob/main/LICENSE`;

const template = readFileSync(join(root, 'template.html'), 'utf8');
const load = (lang) => JSON.parse(readFileSync(join(root, 'i18n', `${lang}.json`), 'utf8'));

// Simple line icons (24x24, stroke = currentColor).
const line = (d) =>
  `<svg class="icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const ICONS = {
  github: '<svg class="icon" viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
  discord: '<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>',
  download: line('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  free: line('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>'),
  open: line('<path d="m8 8-5 4 5 4"/><path d="m16 8 5 4-5 4"/><path d="m14 4-4 16"/>'),
  build: line('<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>'),
  safe: line('<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6Z"/><path d="m9 12 2 2 4-4"/>'),
  pen: line('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  image: line('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>'),
  laser: line('<path d="M9 3h6v5l-2 3h-2L9 8Z"/><path d="M12 11v6"/><path d="M4 21h16"/><path d="m8 17 4 2 4-2"/>'),
  gear: line('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>'),
  layers: line('<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>'),
  chip: line('<rect x="6" y="6" width="12" height="12" rx="1.5"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
  plug: line('<path d="M9 2v6M15 2v6"/><path d="M6 8h12v3a6 6 0 0 1-12 0Z"/><path d="M12 17v5"/>'),
  list: line('<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>'),
  check: line('<path d="M20 6 9 17l-5-5"/>'),
  x: line('<path d="M18 6 6 18M6 6l12 12"/>'),
  flask: line('<path d="M9 3h6"/><path d="M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>'),
  shield: line('<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6Z"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
  warn: line('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
  plus: line('<path d="M12 5v14M5 12h14"/>'),
  apple: '<svg class="icon" viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true" focusable="false"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1ZM13.9 5c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3-1.5Z"/></svg>',
  windows: '<svg class="icon" viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true" focusable="false"><path d="M3 5.2 10.4 4v7.3H3Zm8.4-1.3L21 2.5v8.8h-9.6ZM3 12.7h7.4V20L3 18.8Zm8.4 0H21v8.8l-9.6-1.4Z"/></svg>',
  terminal: line('<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="m7 9 3 3-3 3"/><path d="M13 15h4"/>'),
};

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function lookup(ctx, item, key) {
  const v = key === '.' ? item : key.startsWith('.') ? get(item, key.slice(1)) : get(ctx, key);
  if (v === undefined) throw new Error(`Missing key: ${key}`);
  return v;
}

function render(tpl, ctx, item) {
  // {{#each path}} ... {{/each}} (no nesting needed)
  tpl = tpl.replace(/\{\{#each ([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, body) => {
    const list = lookup(ctx, item, key);
    if (!Array.isArray(list)) throw new Error(`Not a list: ${key}`);
    return list.map((it) => render(body, ctx, it)).join('');
  });
  return tpl.replace(/\{\{(raw:|svg:)?([\w.]+|\.)\}\}/g, (_, mode, key) => {
    if (mode === 'svg:') {
      const name = key.startsWith('.') ? lookup(ctx, item, key) : key;
      if (!ICONS[name]) throw new Error(`Unknown icon: ${name}`);
      return ICONS[name];
    }
    const v = lookup(ctx, item, key);
    return mode === 'raw:' ? String(v) : esc(v);
  });
}

// Replace {version} in every string of the copy.
const withVersion = (v, version) =>
  typeof v === 'string'
    ? v.replaceAll('{version}', version)
    : Array.isArray(v)
      ? v.map((x) => withVersion(x, version))
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withVersion(x, version)]))
        : v;

// Runs inline in <head> of the German root page only. First-time visitors
// whose browser language is not German go to /en/. Any explicit choice made
// with the language switch is stored and always wins. Crawlers are left alone.
const REDIRECT = `<script>(function(){try{var s=localStorage.getItem('kb-lang');if(s)return;if(/bot|crawl|spider|slurp|preview/i.test(navigator.userAgent))return;var l=((navigator.languages&&navigator.languages[0])||navigator.language||'').toLowerCase();if(l&&l.indexOf('de')!==0){location.replace('en/'+location.hash);}}catch(e){}})();</script>`;

const pages = [
  { lang: 'de', out: 'index.html', base: '', url: SITE, altLang: 'en', altHref: 'en/' },
  { lang: 'en', out: 'en/index.html', base: '../', url: `${SITE}en/`, altLang: 'de', altHref: '../' },
];

for (const p of pages) {
  const raw = load(p.lang);
  const t = withVersion(raw, raw.version);
  const alt = load(p.altLang);
  t.dl.lead_tpl = raw.dl.lead;
  t.vm.dl_lead_tpl = raw.vm.dl_lead_tpl;
  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'KizamuBeam',
    description: t.meta.description,
    applicationCategory: 'DesignApplication',
    operatingSystem: 'macOS, Windows, Linux',
    softwareVersion: raw.version,
    license: LICENSE,
    url: p.url,
    downloadUrl: RELEASES,
    image: `${SITE}assets/og-image.png`,
    inLanguage: p.lang,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
  };
  const ctx = {
    ...t,
    base: p.base,
    site: SITE,
    page_url: p.url,
    alt_lang: p.altLang,
    alt_href: p.altHref,
    alt_locale: alt.locale,
    lang_upper: p.lang.toUpperCase(),
    repo: REPO,
    releases: RELEASES,
    vm_releases: VM_RELEASES,
    license_url: LICENSE,
    discord: DISCORD,
    // "Dein Laser. Deine Software. Frei." -> one line per sentence, last one glows.
    hero_title_html: t.hero.title
      .split(/(?<=[.!?])\s+/)
      .map((l, i, a) => `<span class="h1-line${i === a.length - 1 ? ' h1-accent' : ''}">${esc(l)}</span>`)
      .join(' '),
    redirect_script: p.lang === 'de' ? REDIRECT : '',
    jsonld: JSON.stringify(jsonld).replace(/</g, '\\u003c'),
  };
  const html = render(template, ctx).replace(/\n\s*\n(\s*\n)+/g, '\n\n');
  const out = join(root, p.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`wrote ${p.out} (${html.length} bytes)`);
}

// 404 page: self-contained (inline styles, absolute links) because GitHub Pages
// serves it for any missing path, where relative asset URLs would break.
{
  const de = load('de');
  const en = load('en');
  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 – KizamuBeam</title>
<meta name="robots" content="noindex">
<link rel="icon" href="${SITE}assets/favicon.ico" sizes="any">
<style>
:root{--bg:#f7f5f2;--text:#1f282f;--muted:#4f5b66;--link:#b83a00;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#161c21;--text:#e8eaed;--muted:#a8b0b8;--link:#ff7a33}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--text);font:1.0625rem/1.6 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",Arial,sans-serif;background-image:linear-gradient(rgb(128 128 128/.08) 1px,transparent 1px),linear-gradient(90deg,rgb(128 128 128/.08) 1px,transparent 1px);background-size:40px 40px}
main{max-width:34rem;text-align:center}
p.code{color:var(--text);font:700 clamp(4rem,10vw,7rem)/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:-.04em;margin:0}
.beam{height:2px;border:0;margin:20px auto 28px;width:min(320px,80%);background:linear-gradient(90deg,transparent,#ff5600 15%,#ff5600 85%,transparent);box-shadow:0 0 12px 1px rgb(255 86 0/.55)}
h1{font-size:1.5rem;margin:0 0 .25rem;letter-spacing:-.02em}p{margin:0 0 .5rem;color:var(--muted)}
.links{margin-top:2rem;display:flex;flex-wrap:wrap;gap:12px;justify-content:center}
a{color:var(--link);font-weight:600}a:focus-visible{outline:2px solid #ff5600;outline-offset:3px;border-radius:4px}
</style>
</head>
<body>
<main>
<p class="code">404</p>
<hr class="beam">
<h1>${esc(de.notfound.title)}</h1>
<p>${esc(de.notfound.text)}</p>
<div lang="en"><h2 style="font-size:1.5rem;margin:1.25rem 0 .25rem">${esc(en.notfound.title)}</h2><p>${esc(en.notfound.text)}</p></div>
<p class="links"><a href="${SITE}">${esc(de.notfound.home)}</a><a href="${SITE}en/" lang="en" hreflang="en">${esc(en.notfound.home)}</a></p>
</main>
</body>
</html>
`;
  writeFileSync(join(root, '404.html'), html);
  console.log('wrote 404.html');
}
