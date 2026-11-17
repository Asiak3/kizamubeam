#!/usr/bin/env node
// Build an extension pack (.kzp) from a plugin folder (issue #205): reads <dir>/plugin.json, replaces every
// plugin "code": "@relative/path" with the file (WebAssembly as Base64, JavaScript as text), adds its SHA-256 and
// writes <dir>/dist/<pack id>.kzp.
//
// With --build, the code is first built from source with the recipes in the pack's "build" list (fixed recipes,
// no free commands, so the catalogue build in CI only runs known tools):
//   { "rust": "<crate folder>", "out": "dist/x.wasm" }      cargo build --release --target wasm32-unknown-unknown
//   { "esbuild": "<entry .ts/.js>", "out": "dist/x.js" }     one script for QuickJS (IIFE, ES2020, no imports left)
//
// Usage: node scripts/plugin-pack.mjs [--build] <plugin folder>
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const inside = (dir, p, self = false) => {
  const full = resolve(dir, p);
  const rel = relative(resolve(dir), full);
  if ((!rel && !self) || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${p}: path must stay inside ${dir}`);
  return full;
};

/** Build the code of a plugin folder from source with its recipes */
export async function buildPluginSources(dir) {
  const pack = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8'));
  for (const r of pack.build ?? []) {
    const out = inside(dir, r.out);
    mkdirSync(dirname(out), { recursive: true });
    if (r.rust !== undefined) {
      const crate = inside(dir, r.rust || '.', true);
      const toml = readFileSync(join(crate, 'Cargo.toml'), 'utf8');
      const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
      if (!name) throw new Error(`${crate}/Cargo.toml: no package name`);
      const target = join(crate, 'target');
      execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown', '--manifest-path', join(crate, 'Cargo.toml'), '--target-dir', target], { stdio: 'inherit' });
      copyFileSync(join(target, 'wasm32-unknown-unknown/release', `${name.replace(/-/g, '_')}.wasm`), out);
    } else if (r.esbuild !== undefined) {
      const { build } = await import('esbuild');
      await build({ entryPoints: [inside(dir, r.esbuild)], bundle: true, format: 'iife', platform: 'neutral', target: 'es2020', mainFields: ['module', 'main'], minify: true, outfile: out, logLevel: 'error', legalComments: 'none' });
    } else throw new Error(`unknown build recipe ${JSON.stringify(r)}`);
  }
}

/** Pack text for the plugin folder `dir` (code files must exist) */
export function buildPluginPack(dir) {
  const pack = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8'));
  delete pack.build;
  for (const p of pack.plugins ?? []) {
    if (typeof p.code !== 'string' || !p.code.startsWith('@')) continue;
    const bytes = readFileSync(inside(dir, p.code.slice(1)));
    p.sha256 = createHash('sha256').update(bytes).digest('hex');
    p.code = p.runtime === 'wasm' ? bytes.toString('base64') : bytes.toString('utf8');
  }
  return JSON.stringify(pack, null, 1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const doBuild = args.includes('--build');
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) {
    console.error('Usage: node scripts/plugin-pack.mjs [--build] <plugin folder>');
    process.exit(1);
  }
  if (doBuild) await buildPluginSources(dir);
  const text = buildPluginPack(dir);
  const out = join(dir, 'dist', `${JSON.parse(text).id}.kzp`);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(out, text);
  console.log(`${out} (${(text.length / 1024).toFixed(0)} KB)`);
}
