# KizamuBeam website

Static product page for KizamuBeam, served by GitHub Pages at
<https://negurvulkan.github.io/kizamubeam/>. Plain HTML, one stylesheet, one small
script. No framework, no build tools, no third-party requests (no CDNs, fonts or
analytics). The only external call is an optional GitHub API request in `main.js`
that points the download buttons at the newest release's files (KizamuBeam itself and,
separately, the newest `vm-v*` release of the Virtual Machine); if it fails, the
buttons keep linking to the Releases page (for the VM: filtered to `vm-v`).

## Layout

| Path | What it is |
|---|---|
| `template.html` | The one page template (`{{key}}`, `{{raw:key}}`, `{{svg:name}}`, `{{#each list}}…{{/each}}`) |
| `i18n/de.json`, `i18n/en.json`, `i18n/it.json` | All texts. German is the default (`/`), English lives at `/en/`, Italian at `/it/` |
| `build.mjs` | Zero-dependency Node script that renders the template into the pages below |
| `index.html`, `en/index.html`, `it/index.html`, `404.html` | **Generated** – do not edit by hand, but do commit them |
| `styles.css`, `main.js` | Styles (light/dark via `prefers-color-scheme`) and progressive enhancement |
| `assets/` | Logos, favicons, OG image, screenshots (WebP, light/dark pairs) |
| `robots.txt`, `sitemap.xml`, `site.webmanifest`, `.nojekyll` | Static extras |

## Editing texts

1. Change the strings in `i18n/de.json`, `i18n/en.json` and `i18n/it.json` (keep the keys in sync).
   A new language needs its JSON file and an entry in `LANGS` in `build.mjs` (plus `sitemap.xml`).
   Layout changes go into `template.html`.
2. Rebuild: `node website/build.mjs` (Node 18+).
3. Commit the JSON/template **and** the regenerated HTML.

The version shown on the page comes from `"version"` in the JSON files. When a newer
release exists on GitHub, `main.js` replaces it with the release tag at runtime.

All asset paths are relative (the site lives under `/kizamubeam/`). Only `404.html`
uses absolute URLs, because Pages serves it for any missing path.

## Preview locally

```sh
node website/build.mjs
python3 -m http.server -d website 8000
# open http://localhost:8000/
```

The German page redirects first-time visitors whose browser language is Italian
to `/it/` and any other non-German language to `/en/`. Choosing a language with the
language switch is remembered (`localStorage`
key `kb-lang`) and always wins. To test the redirect again, clear that key.

## Deployment

`.github/workflows/pages.yml` deploys `website/` to GitHub Pages on every push to
`main` that touches `website/**` (or manually via *Actions → Pages → Run workflow*).
It first runs the build and fails if the committed HTML is stale.

One-time setup: *Settings → Pages → Build and deployment → Source: GitHub Actions*.
