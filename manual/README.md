# KizamuBeam manual

The user manual for KizamuBeam, built with [Docusaurus 3](https://docusaurus.io/) and published at
<https://negurvulkan.github.io/kizamubeam/docs/>. How to write pages, screenshots, diagrams, videos and
translations is explained in the manual itself: [Contributing to the manual](docs/contributing.md).

## Layout

| Path | What it is |
|---|---|
| `docs/` | English pages (the original). Each folder is a sidebar chapter (`_category_.json`). |
| `i18n/de/`, `i18n/it/` | German and Italian: pages under `docusaurus-plugin-content-docs/current/`, labels in `*.json` |
| `static/img/` | Screenshots, logo, favicon |
| `src/css/custom.css` | Branding (colours follow `website/styles.css`), light and dark theme |
| `docusaurus.config.ts` | Site configuration: URL, languages, search, versioning |
| `sidebars.ts` | Sidebar, generated from the folder structure |

## Commands

Node.js 20 or newer. Run them in `manual/`:

```sh
npm ci
npm start                  # English dev server with live reload
npm run start:de           # German (one language at a time in dev mode)
npm run build              # all languages into build/, as published
npm run serve              # preview build/ (the search is easier to test with any static server)
npm run typecheck
npm run write-translations -- --locale de   # add new labels to i18n/de/*.json
```

`npm run build` fails on broken internal links, so check it before opening a pull request.

## Publishing

`.github/workflows/pages.yml` builds the manual together with the website and publishes it under
`/kizamubeam/docs/` on GitHub Pages whenever `manual/**` changes on `main`. Pull requests that touch
`manual/` are built by `.github/workflows/manual.yml`.

The URL is not hard-coded: `DOCS_URL` and `DOCS_BASE_URL` (environment variables, or repository
variables of the same name for the workflow) override the defaults. For a manual on its own domain,
for example:

```sh
DOCS_URL=https://docs.kizamubeam.com DOCS_BASE_URL=/ npm run build
```

`WEBSITE_URL` changes the link back to the product website.

## Search

The search is local (`@easyops-cn/docusaurus-search-local`), built into the static files, with no external
service. It indexes English, German and Italian.

## Versions

The pages in `docs/` describe the current major release (shown as “2.x”). Before a new major release
changes the manual substantially, freeze the current state:

```sh
npm run docusaurus docs:version 2.x
```

This copies `docs/` to `versioned_docs/version-2.x/` and the translations to
`i18n/<lang>/docusaurus-plugin-content-docs/version-2.x/`. Then change the label of `current` in `docusaurus.config.ts`
to the new major version (e.g. `3.x`). The version menu in the navigation bar lets readers switch.
