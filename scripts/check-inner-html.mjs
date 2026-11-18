// Fails when markup or code is built from strings outside the allowlist (issue #283).
// Markup goes through h({ icon }) / h({ svg }) / setIcon() / setTrustedSvg() in src/dom.ts only;
// text from files, plugins, catalogs or the network is always inserted as text.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ALLOW = new Set(['src/dom.ts']);
const RULES = [
  [/\.(innerHTML|outerHTML)\s*[+]?=/, 'innerHTML/outerHTML assignment'],
  [/\binsertAdjacentHTML\s*\(/, 'insertAdjacentHTML'],
  [/\bcreateContextualFragment\s*\(/, 'createContextualFragment'],
  [/\bdocument\.write(ln)?\s*\(/, 'document.write'],
  [/\bsrcdoc\b/, 'srcdoc'],
  [/[{,]\s*html\s*:/, 'h({ html }) prop (use icon or svg)'],
  [/\bnew Function\s*\(/, 'new Function'],
  [/(^|[^.\w])eval\s*\(/, 'eval'],
];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.|\.d\.ts$/.test(name)) files.push(p);
  }
};
walk(join(ROOT, 'src'));

const hits = [];
for (const f of files) {
  const rel = relative(ROOT, f).split(sep).join('/');
  if (ALLOW.has(rel)) continue;
  readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      for (const [re, what] of RULES) if (re.test(line)) hits.push(`${rel}:${i + 1}: ${what}\n    ${line.trim()}`);
    });
}
if (hits.length) {
  console.error(`Markup or code built from strings outside ${[...ALLOW].join(', ')} (see issue #283):\n` + hits.join('\n'));
  process.exit(1);
}
console.log(`check-inner-html: ${files.length} files clean`);
