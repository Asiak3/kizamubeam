// Prüft die Sprachdateien in src/locales gegen die Texte im Code.
// Aufruf: npm run i18n:check  (mit --write werden fehlende Einträge mit leerem Wert ergänzt
// und nicht mehr benutzte entfernt, Reihenfolge wie im Code; leere Werte zeigen die App deutsch an)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'src');
const keys = new Map(); // Text → erste Fundstelle
const pluralKeys = new Set(); // plural texts of tn(); language files may add "<text>|few" etc.
let bad = 0;

// auch Unterordner (z. B. src/editor/); Pfade mit / wie in den Meldungen
for (const f of fs.readdirSync(srcDir, { recursive: true }).map((f) => f.split(path.sep).join('/')).filter((f) => f.endsWith('.ts')).sort()) {
  const file = path.join(srcDir, f);
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const add = (s, node) => {
    if (!keys.has(s)) keys.set(s, `src/${f}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
  };
  const lit = (a) => {
    if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) return add(a.text, a), true;
    if (ts.isParenthesizedExpression(a)) return lit(a.expression);
    if (ts.isConditionalExpression(a)) return lit(a.whenTrue) && lit(a.whenFalse);
    return false;
  };
  const collect = (a, cb) => {
    if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) cb(a.text);
    else if (ts.isParenthesizedExpression(a)) collect(a.expression, cb);
    else if (ts.isConditionalExpression(a)) (collect(a.whenTrue, cb), collect(a.whenFalse, cb));
  };
  const visit = (n) => {
    const fn = ts.isCallExpression(n) && ts.isIdentifier(n.expression) ? n.expression.text : '';
    // t(text, …) und tn(einzahl, mehrzahl, n, …)
    const texts = fn === 't' ? n.arguments.slice(0, 1) : fn === 'tn' ? n.arguments.slice(0, 2) : [];
    if (fn === 'tn' && n.arguments[1]) collect(n.arguments[1], (s) => pluralKeys.add(s));
    // Same key for singular and plural: translations could not tell them apart (tn('{n} Fehler|one', '{n} Fehler', n))
    const [a0, a1] = fn === 'tn' ? n.arguments : [];
    if (a0 && a1 && ts.isStringLiteral(a0) && ts.isStringLiteral(a1) && a0.text === a1.text) {
      console.log(`tn() with the same singular and plural text in src/${f}:${sf.getLineAndCharacterOfPosition(a0.getStart()).line + 1}; add a context to the singular, e.g. '${a0.text}|one'`);
      bad++;
    }
    for (const a of texts)
      if (!lit(a) && f !== 'i18n.ts') console.warn(`Warnung: ${fn}() ohne festen Text in src/${f}:${sf.getLineAndCharacterOfPosition(a.getStart()).line + 1}`);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // Texte, die nicht direkt in t() stehen (z. B. Meldungen aus Rust), stehen zwischen Markierungen
  const m = /i18n-keys-start([\s\S]*?)i18n-keys-end/.exec(text);
  if (m) {
    const block = ts.createSourceFile('b.ts', m[1].replace(/^[^\n]*\n/, ''), ts.ScriptTarget.Latest, true);
    const v = (n) => {
      if (ts.isStringLiteral(n)) keys.has(n.text) || keys.set(n.text, `src/${f} (Markierung)`);
      ts.forEachChild(n, v);
    };
    v(block);
  }
}

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
const write = process.argv.includes('--write');
for (const lf of fs.readdirSync(path.join(srcDir, 'locales')).filter((f) => f.endsWith('.json'))) {
  const lpath = path.join(srcDir, 'locales', lf);
  // The file name is the language code (src/i18n.ts finds the files on its own), so it must be a valid tag
  const code = lf.slice(0, -5);
  try {
    if (Intl.getCanonicalLocales(code)[0].toLowerCase() !== code.toLowerCase()) throw new Error();
  } catch {
    console.log(`${lf}: file name is not a language code such as "it" or "pt-BR"`);
    bad++;
  }
  const dict = JSON.parse(fs.readFileSync(lpath, 'utf8'));
  // Extra plural forms of this language ("<plural text>|few" etc., see tn() in src/i18n.ts)
  let categories = [];
  try {
    categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories.filter((c) => c !== 'one' && c !== 'other');
  } catch {
    /* reported above */
  }
  const extra = new Map(); // "<plural text>|<category>" → plural text
  for (const k of pluralKeys) for (const c of categories) extra.set(`${k}|${c}`, k);
  const missing = [...keys.keys()].filter((k) => !dict[k]);
  const unused = Object.keys(dict).filter((k) => !keys.has(k) && !extra.has(k));
  const wrongVars = [...keys.keys(), ...[...extra.keys()].filter((k) => k in dict)].filter((k) => dict[k] && placeholders(extra.get(k) ?? k) !== placeholders(dict[k]));
  console.log(`${lf}: ${keys.size} Texte, ${missing.length} fehlen, ${unused.length} unbenutzt, ${wrongVars.length} mit falschen Platzhaltern`);
  for (const k of missing) console.log(`  fehlt      ${JSON.stringify(k)}  (${keys.get(k)})`);
  for (const k of unused) console.log(`  unbenutzt  ${JSON.stringify(k)}`);
  for (const k of wrongVars) console.log(`  Platzhalter ${JSON.stringify(k)} → ${JSON.stringify(dict[k])}`);
  bad += missing.length + wrongVars.length;
  if (write) {
    const out = {};
    for (const k of keys.keys()) {
      out[k] = dict[k] ?? '';
      if (pluralKeys.has(k)) for (const c of categories) if (dict[`${k}|${c}`]) out[`${k}|${c}`] = dict[`${k}|${c}`];
    }
    fs.writeFileSync(lpath, JSON.stringify(out, null, 2) + '\n');
  }
}
process.exit(bad && !write ? 1 : 0);
