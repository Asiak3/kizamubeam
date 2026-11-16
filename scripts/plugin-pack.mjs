#!/usr/bin/env node
// Build an extension pack (.kzp) from a plugin folder (issue #205): reads <dir>/plugin.json, replaces every
// plugin "code": "@relative/path" with the file (WebAssembly as Base64, JavaScript as text), adds its SHA-256 and
// writes <dir>/dist/<pack id>.kzp.  Usage: node scripts/plugin-pack.mjs plugins/hole-plate
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Pack text for the plugin folder `dir` */
export function buildPluginPack(dir) {
  const pack = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8'));
  for (const p of pack.plugins ?? []) {
    if (typeof p.code !== 'string' || !p.code.startsWith('@')) continue;
    const bytes = readFileSync(join(dir, p.code.slice(1)));
    p.sha256 = createHash('sha256').update(bytes).digest('hex');
    p.code = p.runtime === 'wasm' ? bytes.toString('base64') : bytes.toString('utf8');
  }
  return JSON.stringify(pack, null, 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node scripts/plugin-pack.mjs <plugin folder>');
    process.exit(1);
  }
  const text = buildPluginPack(dir);
  const out = join(dir, 'dist', `${JSON.parse(text).id}.kzp`);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(out, text);
  console.log(`${out} (${(text.length / 1024).toFixed(0)} KB)`);
}
