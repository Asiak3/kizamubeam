#!/usr/bin/env node
// Build built-in generators as plugins (#205, #327: existing generators move to the plugin system). The generator
// source in src/generators stays as it is; it is bundled with a stand-in for src/i18n (plugins/core/i18n-shim.ts)
// and the wrapper plugins/core/wrap.ts into one JavaScript file for QuickJS. The manifest (parameters, texts in
// every app language, issue and info codes) is generated from the same source and the locale files, so the
// plugin shows the same dialog and the same messages as the built-in generator.
//
// Output: plugins/core/dist/org.kizamubeam.core-generators.kzp (one pack with all listed generators).
// Usage: node scripts/build-core-plugins.mjs [id …]   (default: all in CORE)
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SHIM = join(ROOT, 'plugins/core/i18n-shim.ts');
const LANGS = ['de', 'en', 'it', 'es', 'pt-BR'];
const dicts = Object.fromEntries(LANGS.filter((l) => l !== 'de').map((l) => [l, JSON.parse(readFileSync(join(ROOT, `src/locales/${l}.json`), 'utf8'))]));

/**
 * Generators built as plugins. label: text for the Objects window with placeholders mapped to parameters
 * (the plugin fills placeholders with parameter values; generators whose label needs computed values leave it out).
 */
export const CORE = {
  gear: { file: 'src/generators/gear', name: 'GEAR', label: { text: 'Zahnrad z={z} m={m}', values: { z: 'teeth', m: 'module' } } },
  box: { file: 'src/generators/box', name: 'BOX' },
  rack: { file: 'src/generators/rack', name: 'RACK' },
  pulley: { file: 'src/generators/pulley', name: 'PULLEY' },
  cam: { file: 'src/generators/cam', name: 'CAM' },
  gearpair: { file: 'src/generators/gearpair', name: 'GEARPAIR' },
  drawer: { file: 'src/generators/drawer', name: 'DRAWER' },
  insert: { file: 'src/generators/insert', name: 'INSERT' },
  shelf: { file: 'src/generators/shelf', name: 'SHELF' },
  discsphere: { file: 'src/generators/discsphere', name: 'DISCSPHERE' },
  fingerbox: { file: 'src/generators/fingerbox', name: 'FINGERBOX' },
  // The jig's panel (image and camera sources) needs the DOM, and print-and-cut marks pull in geom with fonts; the
  // plugin gets an empty panel until image and camera inputs exist (#335 stage 3) and never uses boundsOf
  jig: { file: 'src/generators/jig', name: 'JIG', stub: { jigPanel: 'export const jigPanel = () => undefined;', geom: 'export const boundsOf = () => { throw new Error("not in plugins"); };' } },
};

const i18nShim = {
  name: 'i18n-shim',
  setup(b) {
    b.onResolve({ filter: /(^|\/)i18n$/ }, (a) => (a.importer.includes('plugins/core') ? undefined : { path: SHIM }));
  },
};

/** Same as plugins/core/codes.ts */
function codeOf(de) {
  let h = 0x811c9dc5;
  for (let i = 0; i < de.length; i++) {
    h ^= de.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 't' + h.toString(16).padStart(8, '0');
}
const strip = (s) => s.split('|')[0];
/** Text in a language: German is the source; other languages from src/locales, falling back to German */
const tr = (de, lang) => (lang === 'de' ? strip(de) : (dicts[lang][de] ?? strip(de)));
const MARK = '\u0001', VALS = '\u0002', END = '\u0003';
/** A text from the generator (plain German source, or with markers from the i18n shim) in a language */
function render(s, lang) {
  if (!s.includes(MARK)) return tr(s, lang);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const a = s.indexOf(MARK, i);
    if (a < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, a);
    const e = s.indexOf(END, a);
    const body = s.slice(a + 1, e < 0 ? s.length : e);
    const v = body.indexOf(VALS);
    const de = v < 0 ? body : body.slice(0, v);
    const vals = v < 0 ? {} : JSON.parse(body.slice(v + 1));
    out += tr(de, lang).replace(/\{(\w+)\}/g, (all, k) => (k in vals ? (typeof vals[k] === 'string' ? render(vals[k], lang) : String(vals[k])) : all));
    i = e < 0 ? s.length : e + 1;
  }
  return out;
}

/** All t('…') source texts in the given files (the codes a plugin can report) */
function sourceTexts(files) {
  const out = new Set();
  const re = /\bt\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  const rn = /\btn\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*,\s*(['"`])((?:\\.|(?!\3).)*)\3/g;
  for (const f of files) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    for (const m of text.matchAll(re)) if (!m[2].includes('${')) out.add(m[2].replace(/\\(['"`\\])/g, '$1'));
    // tn('one', 'other', n): both forms (the shim picks the German form by n)
    for (const m of text.matchAll(rn)) for (const x of [m[2], m[4]]) if (!x.includes('${')) out.add(x.replace(/\\(['"`\\])/g, '$1'));
  }
  return [...out];
}

/** Replace modules by name (`./jigPanel`) with the given source */
const stubs = (map = {}) => ({
  name: 'stubs',
  setup(b) {
    const names = Object.keys(map);
    if (!names.length) return;
    b.onResolve({ filter: new RegExp(`/(${names.join('|')})$`) }, (a) => ({ path: a.path.split('/').pop(), namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: map[a.path], loader: 'ts' }));
  },
});

async function bundle(entry, format, platform, stub) {
  const r = await build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'ts' },
    bundle: true, format, platform, target: 'es2020', write: false, metafile: true, minify: format === 'iife',
    mainFields: ['module', 'main'], plugins: [i18nShim, stubs(stub)], logLevel: 'error', legalComments: 'none',
  });
  const files = Object.keys(r.metafile.inputs).filter((x) => !x.includes('node_modules') && !x.startsWith('plugins/core') && x.endsWith('.ts'));
  return { js: r.outputFiles[0].text, files };
}

/** One plugin entry for the pack */
export async function corePlugin(id) {
  const c = CORE[id];
  if (!c) throw new Error(`unknown core generator ${id}`);
  const code = (await bundle(`import { ${c.name} } from './${c.file}'; import { wrap } from './plugins/core/wrap'; wrap(${c.name});`, 'iife', 'neutral', c.stub)).js;
  // Read the generator definition in Node through the same shim: labels arrive as German source texts
  const node = await bundle(`export { ${c.name} as default } from './${c.file}';`, 'esm', 'node', c.stub);
  const dir = mkdtempSync(join(tmpdir(), 'kzb-core-'));
  let g;
  try {
    writeFileSync(join(dir, 'g.mjs'), node.js);
    g = (await import(pathToFileURL(join(dir, 'g.mjs')).href)).default;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const texts = Object.fromEntries(LANGS.map((l) => [l, {}]));
  const put = (key, s) => {
    for (const l of LANGS) texts[l][key] = render(s, l);
  };
  put('name', g.name);
  if (g.tile) {
    const tile = g.tile.text((s) => s);
    if (tile.desc) put('desc', tile.desc);
    if (tile.keys) put('keys', tile.keys);
  }
  if (c.label) {
    put('label', c.label.text);
    for (const l of LANGS) texts[l].label = texts[l].label.replace(/\{(\w+)\}/g, (all, k) => (c.label.values[k] ? `{${c.label.values[k]}}` : all));
  }
  const params = g.schema.map((s) => {
    const p = { key: s.key, type: s.type };
    if (s.label && s.type !== 'data') put(s.key, s.label);
    if (s.title) put(`${s.key}.title`, s.title);
    if ('min' in s) Object.assign(p, { min: s.min, max: s.max });
    p.def = s.def;
    if (s.type === 'enum')
      p.options = s.options.map(([v, label]) => {
        put(`${s.key}.${v}`, label);
        return v;
      });
    for (const k of ['advanced', 'resetOnNew', 'showIf']) if (s[k] !== undefined) p[k] = s[k];
    return p;
  });
  for (const de of sourceTexts(node.files)) put(codeOf(de), de);
  // Codes generate() throws (Generator.texts), e.g. „ratio-count“
  for (const [code, text] of Object.entries(g.texts ?? {})) put(code, text());
  // Lists and actions (dialog schema 2): texts under fixed keys
  const lists = g.lists?.map((l) => {
    const k = `list.${l.param}`;
    put(k, l.label);
    const out = { param: l.param, label: k, columns: [] };
    if (l.empty) (put(`${k}.empty`, l.empty), (out.empty = `${k}.empty`));
    if (l.shape) out.shape = l.shape;
    if (l.remove) out.remove = true;
    if (l.removeTitle) (put(`${k}.remove`, l.removeTitle), (out.removeTitle = `${k}.remove`));
    out.columns = l.columns.map((c) => {
      const ck = `${k}.${c.key}`;
      put(ck, c.label);
      const col = { key: c.key, type: c.type, label: ck };
      if (c.title) (put(`${ck}.title`, c.title), (col.title = `${ck}.title`));
      if (c.type === 'text' && c.max) col.max = c.max;
      if ('min' in c) Object.assign(col, { min: c.min, max: c.max });
      if (c.type === 'enum') col.options = c.options.map(([v, label], i) => (put(`${ck}.${i}`, label), [v, `${ck}.${i}`]));
      return col;
    });
    return out;
  });
  const actions = g.actions?.map((a) => {
    const k = `action.${a.id}`;
    put(k, a.label);
    const out = { id: a.id, label: k };
    if (a.title) (put(`${k}.title`, a.title), (out.title = `${k}.title`));
    if (a.inputs) out.inputs = a.inputs;
    return out;
  });
  const sha256 = createHash('sha256').update(code).digest('hex');
  return {
    id: g.id, type: 'generator', api: 1, version: g.version, kind: g.kind, runtime: 'js', code, sha256,
    icon: g.icon, dialog: lists || actions ? { version: 2, ...(lists ? { lists } : {}), ...(actions ? { actions } : {}) } : { version: 1 },
    ...(g.preview?.center ? { preview: { center: true } } : {}), params, texts,
  };
}

/** The pack with all core generators given */
export async function corePack(ids = Object.keys(CORE)) {
  const plugins = [];
  for (const id of ids) plugins.push(await corePlugin(id));
  return {
    format: 'kizamubeam-pack', formatVersion: 2, id: 'org.kizamubeam.core-generators', version: '1.0.0',
    name: { en: 'Built-in generators', de: 'Eingebaute Generatoren', it: 'Generatori integrati' },
    description: { en: 'Built-in generators as plugins, built from the same source.' },
    author: 'KizamuBeam', plugins,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ids = process.argv.slice(2);
  const pack = await corePack(ids.length ? ids : undefined);
  const out = join(ROOT, 'plugins/core/dist', `${pack.id}.kzp`);
  mkdirSync(join(ROOT, 'plugins/core/dist'), { recursive: true });
  const text = JSON.stringify(pack);
  writeFileSync(out, text);
  for (const p of pack.plugins) console.log(`${p.id}: ${(p.code.length / 1024).toFixed(0)} KB code, ${p.params.length} parameters, ${Object.keys(p.texts.en).length} texts`);
  console.log(`${out} (${(text.length / 1024).toFixed(0)} KB)`);
}
