# Translating KizamuBeam

Thank you for helping bring KizamuBeam to more people! You don't need to be a programmer to translate. If you can edit a text file and open a pull request on GitHub (or are willing to learn, it's not hard), you can contribute. And if you get stuck at any point, ask on [Discord](https://discord.gg/SSr8VHh7EJ) or in an issue.

There are four things that can be translated. They are independent of each other, so you can start with any of them:

| What | Where | How big |
|---|---|---|
| [The app](#1-the-app) | `src/locales/<code>.json` | about 4,000 short texts |
| [The website](#2-the-website) | `website/i18n/<code>.json` | one page |
| [The README](#3-the-readme) | `README.<code>.md` | one page |
| [The feature list](#4-the-feature-list) | `docs/features.<code>.md` | long reference |

The app matters most. The other three are welcome too, but it's perfectly fine to translate only the app.

Currently available: **German** (the original), **English**, **Italian**, **Spanish** and **Brazilian Portuguese**.

## Before you start

- Check the [open issues and pull requests](https://github.com/negurvulkan/kizamubeam/pulls) to see whether someone is already working on your language. If so, join them instead of starting over.
- For a new language, it helps to open a short issue (“Adding French”) so others can find you.
- You don't have to finish everything at once. A partial translation can be merged: untranslated texts simply show in English.

## 1. The app

### How the files work

The interface texts are written in **German** in the source code. Each language has one JSON file in [`src/locales/`](src/locales/), named after its language code, that maps every German text to its translation:

```json
{
  "Neue Skizze": "New sketch",
  "{n} Objekte ausgewählt": "{n} objects selected",
  "Verbindung|Gerät": "Connection"
}
```

- The **left side** (the key) is the German original. Never change it.
- The **right side** is your translation.
- An **empty value** (`""`) means “not translated yet”. The app then shows the English text, so a half-finished file is still usable.

Don't speak German? No problem: [`src/locales/en.json`](src/locales/en.json) contains the English version of every text under the same keys, so you can translate from English. Opening `en.json` and your file side by side works well.

### Adding a new language

1. Fork the repository and clone your fork (see [CONTRIBUTING.md](CONTRIBUTING.md#development-setup) for `npm ci`).
2. Create the file `src/locales/<code>.json` containing just `{}`. The file name is the language code:
   - a plain language code like `fr`, `es`, `pl`, `ja`, or
   - a language with a region, like `pt-BR` or `zh-TW`, if the variants differ.
3. Fill it with all texts (empty values):

   ```bash
   npm run i18n:check -- --write
   ```

4. Translate the empty values.

That's all. **Nothing needs to be registered anywhere.** The app finds every file in `src/locales/` on its own. The language's name in *View → Language*, the number and date format and the decimal separator come from the operating system and browser automatically. When the system language matches your file, the app picks it on first start.

### Updating an existing language

New features bring new texts. To find them:

```bash
npm run i18n:check
```

The output is in German. For each language file it prints a summary and then one line per problem:

```
it.json: 3945 Texte, 29 fehlen, 5 unbenutzt, 0 mit falschen Platzhaltern
  fehlt      "Außenkontur mit gewählten Löchern …"  (src/ui.ts:296)
  unbenutzt  "Fenster zurücksetzen"
```

| Word | Meaning |
|---|---|
| `Texte` | number of texts in the app |
| `fehlt` | missing: not translated yet. The file and line show where the text is used, which helps with context |
| `unbenutzt` | unused: the app no longer has this text. It can be deleted |
| `Platzhalter` | the placeholders in the translation don't match the original (see below) |

`npm run i18n:check -- --write` adds the missing texts with empty values and removes the unused ones, in the same order as in the code. Then translate the empty values.

> **Note:** `--write` rewrites *every* file in `src/locales/`, not just yours. Before committing, look at `git status` and only commit the file of your language (`git checkout src/locales/en.json` and so on undoes the rest). Likewise, the check exits with an error as long as *any* language has gaps, so judge your work by the line of your own file.

### Rules for the translation

**Placeholders.** Words in curly braces are filled in by the app. Keep them exactly as they are, but you may move them wherever your grammar needs them:

```json
"Bild {i} von {n} …": "Image {i} of {n} …"
"{n} Objekte ausgewählt": "{n} objets sélectionnés"
```

Don't translate the word inside the braces (`{n}`, `{name}`, `{error}`, …), and don't add or drop any. The check reports mismatches.

**Singular and plural.** Countable texts come in two separate entries: the first is the *singular* (“one”) form, the second the *plural* form:

```json
"{n} neues Objekt. Orange gestrichelt: Vorschau.": "{n} nuovo oggetto. …",
"{n} neue Objekte. Orange gestrichelt: Vorschau.": "{n} nuovi oggetti. …"
```

The app picks the form by the plural rules of *your* language, not by the German ones. Translate the first entry as your language's “one” form: in French it is also used for 0, in Russian also for 21, 31 and so on. Languages without a singular (e.g. Japanese, Chinese) always get the second entry.

When German uses the same word for both, the singular key ends in `|one` so the two can be told apart. Translate it like any other text, without the `|one`:

```json
"{n} Fehler|one": "{n} error",
"{n} Fehler": "{n} errors"
```

**More plural forms.** If your language has more than two forms (Polish, Russian, Czech, Arabic, …), add extra entries to your file: the key of the *plural* entry followed by `|few`, `|many`, `|two` or `|zero`, whichever categories your language uses ([overview of the categories per language](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)):

```json
"{n} Objekt": "{n} obiekt",
"{n} Objekte": "{n} obiektów",
"{n} Objekte|few": "{n} obiekty"
```

Here the singular is used for 1, `|few` for 2–4, 22–24 …, and the plain plural entry for everything else (Polish “many”). These extra entries are optional: a missing one falls back to the plural entry. `npm run i18n:check` accepts them and checks their placeholders too, and `--write` keeps them.

**Context after `|`.** When the same German word has two meanings, the key carries a hint after a vertical bar, e.g. `Verbindung|Gerät` (“connection, as in device”). The hint is not shown. Translate only the meaning, without the bar and hint.

**Technical terms.** Keep the vocabulary that laser users in your language already know. Terms like *G-code*, *Air Assist*, *kerf*, *homing*, *FluidNC* or *GRBL* are often better left as they are. When in doubt, look at how the community or popular forums in your language say it, and be consistent within the file.

**Length.** Buttons, menus and toolbars have limited space. Prefer short wording there; a tooltip can be longer.

**Punctuation.** Keep the meaning of characters like `…` (opens a dialog), `:` and line breaks (`\n`). Typographic quotes (`„…“`) in the German text can become the quotes that are usual in your language.

**Messages from the machine side.** A few error messages come from the Rust part of the app and are listed in `src/i18n.ts`. They appear in your JSON file like any other text; nothing special is needed.

### Trying it out

```bash
npm run dev          # opens the interface in the browser (enough for checking texts)
# or: npm run tauri dev   for the full desktop app
```

Then choose your language under *View → Language* (the app reloads). Click through menus, dialogs and the toolbars and look for cut-off or awkward texts. Screenshots of problem spots are very welcome in the pull request.

The KizamuBeam Virtual Machine (`vm/`) uses the same language list, but its own texts are only translated into English for now, so it shows English in other languages. You don't need to do anything for it.

## 2. The website

The website at <https://negurvulkan.github.io/kizamubeam/> is generated from [`website/i18n/`](website/i18n/). See [website/README.md](website/README.md) for details.

To update a language, change its `website/i18n/<code>.json`, keeping all keys in sync with `en.json`, then rebuild and commit both the JSON and the generated HTML:

```bash
node website/build.mjs
```

A new website language needs a bit more than the app:

1. Copy `website/i18n/en.json` to `website/i18n/<code>.json` and translate the values. Set `"lang"`, `"locale"` (e.g. `fr_FR`) and `"ui" → "lang_current"` (the language's own name).
2. Add an entry to `LANGS` in `website/build.mjs`, for example `{ code: 'fr', name: 'Français', path: 'fr/' }`.
3. Add the new page and its `hreflang` links to `website/sitemap.xml`.
4. Optional: the automatic redirect for first-time visitors (`REDIRECT` in `website/build.mjs`) currently knows Italian, Portuguese and English; extend it if you like, or leave it to the maintainers.
5. Run `node website/build.mjs` and commit everything, including the new `website/<code>/index.html`.

If this sounds too technical, just translate the JSON file and say so in the pull request; the maintainers will wire it up.

## 3. The README

The README is the first thing people see on GitHub. A translation lives next to the original as `README.<code>.md`, e.g. `README.fr.md`. Start from [README.md](README.md) and:

- keep the images, links and the version number as they are,
- leave the block between `<!-- ALL-CONTRIBUTORS-LIST:START -->` and `<!-- ALL-CONTRIBUTORS-LIST:END -->` untouched (it is maintained automatically; copy it from `README.md`),
- add your language to the language links at the top of **all** READMEs (`English · Deutsch · Italiano · …`).

## 4. The feature list

[docs/features.md](docs/features.md) describes every function with its menu path and shortcut. A translation is `docs/features.<code>.md`. Use the menu names as they appear in *your* translation of the app, so that readers find them. Add your language to the language links in the first lines of all `features*.md` files, and point “Back to the README” at your README if there is one.

The feature list is long and changes often. It's fine to skip it.

## Submitting your translation

1. Commit your changes on a branch in your fork, e.g. `translation-fr`.
2. Open a pull request against `main` of [negurvulkan/kizamubeam](https://github.com/negurvulkan/kizamubeam). A title like “Add French translation” or “Update Italian translation” is perfect.
3. In the description, mention:
   - the language and what you translated (app, website, README, feature list),
   - roughly how complete it is (the line from `npm run i18n:check`),
   - anything you were unsure about, and whether you tested it in the app,
   - whether you used machine translation or AI tools (that's fine, see [AI-assisted contributions](CONTRIBUTING.md#ai-assisted-contributions); please review the result yourself).
4. Maintainers or other speakers of your language may suggest changes. Partial translations can be merged and completed later.

Prefer not to use git? You can also edit a file directly on GitHub (the pencil icon opens an editor and creates the fork and pull request for you), or post your file on Discord or in an issue and a maintainer will take it from there.

## Getting credited

Translations are real contributions, and everyone who translates is listed in the [Contributors section of the README](README.md#contributors) with the 🌍 *translation* badge. After your pull request is merged, a maintainer adds you with a comment like

```
@all-contributors please add @your-name for translation
```

If you're missing from the list, just ask in your pull request or on Discord. Release notes also thank contributors by their GitHub handle. More in [CONTRIBUTING.md → Credits](CONTRIBUTING.md#credits).

## Keeping a language up to date

KizamuBeam is developed actively and new texts appear with almost every release. They show in English until someone translates them. If you'd like to keep looking after your language, say so in your pull request; so we can ping you when a release brings new texts. Running `npm run i18n:check` now and then shows what's new.

Thank you! 🌍
