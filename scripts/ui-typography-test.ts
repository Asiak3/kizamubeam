// Tests für den UI-Schrift-Zustandskern: Normalisierung, Presets, Reset,
// reine Kandidatenauflösung, Speichern/Laden. Aufruf: npm run test:typography
import { strict as assert } from 'node:assert';

// Minimaler localStorage-Ersatz wie in sync-test.ts
class MemStorage {
  m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const store = new MemStorage();
(globalThis as Record<string, unknown>).localStorage = store;

const ty = await import('../src/uiTypography');

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

await test('Ohne Speicher: viermal 100', () => {
  store.clear();
  ty.initTypography();
  assert.deepEqual(ty.getTypography(), { interface: 100, supporting: 100, technical: 100, workspace: 100 });
});

await test('Jede Gruppe mal jedes Preset: nur eigene Gruppe skaliert', () => {
  for (const g of ty.TYPOGRAPHY_GROUPS) {
    for (const p of [80, 100, 125, 150] as const) {
      store.clear();
      ty.initTypography();
      ty.resetTypography();
      ty.setTypographyGroup(g, p);
      const got = ty.getTypography();
      for (const h of ty.TYPOGRAPHY_GROUPS) assert.equal(got[h], h === g ? p : 100);
      const r = ty.resolveTypography(got);
      assert.equal(r.groups[g], p);
      assert.equal(r.factors[g], p / 100);
      assert.ok(Math.abs(ty.typographySize(r, g, 12) - (12 * p) / 100) < 1e-9);
    }
  }
});

await test('Gemischt gültig/ungültig: nur ungültige fallen auf 100', () => {
  store.setItem('kizamubeam.uiTypography', '{"interface":125,"supporting":"125","technical":120,"workspace":null}');
  ty.initTypography();
  assert.deepEqual(ty.getTypography(), { interface: 125, supporting: 100, technical: 100, workspace: 100 });
});

await test('Ungültiges JSON: viermal 100', () => {
  store.setItem('kizamubeam.uiTypography', 'kein json');
  ty.initTypography();
  assert.deepEqual(ty.getTypography(), { interface: 100, supporting: 100, technical: 100, workspace: 100 });
});

await test('Unbekannte Gruppe bleibt erhalten, wird nicht angewendet', () => {
  store.setItem('kizamubeam.uiTypography', '{"interface":150,"zukunft":42}');
  ty.initTypography();
  assert.deepEqual(ty.getTypography(), { interface: 150, supporting: 100, technical: 100, workspace: 100 });
  ty.setTypographyGroup('supporting', 80);
  const raw = JSON.parse(store.getItem('kizamubeam.uiTypography')!);
  assert.equal(raw.zukunft, 42);
  assert.equal(raw.interface, 150);
  assert.equal(raw.supporting, 80);
});

await test('Einzelreset und Gesamtreset', () => {
  store.clear();
  ty.initTypography();
  ty.setTypographyGroup('interface', 150);
  ty.setTypographyGroup('workspace', 80);
  ty.resetTypography('interface');
  assert.deepEqual(ty.getTypography(), { interface: 100, supporting: 100, technical: 100, workspace: 80 });
  ty.resetTypography();
  assert.deepEqual(ty.getTypography(), { interface: 100, supporting: 100, technical: 100, workspace: 100 });
});

await test('Reine Auflösung: kein Speichern, keine Events, keine Mutation', () => {
  store.clear();
  ty.initTypography();
  let calls = 0;
  const off = ty.onTypographyChange(() => calls++);
  const candidate = { interface: 125, supporting: 80, technical: 150, workspace: 100 };
  const frozen = JSON.parse(JSON.stringify(candidate));
  const r = ty.resolveTypography(candidate);
  assert.deepEqual(candidate, frozen);
  assert.deepEqual(r.groups, candidate);
  assert.equal(store.getItem('kizamubeam.uiTypography'), null);
  assert.deepEqual(ty.getTypography(), { interface: 100, supporting: 100, technical: 100, workspace: 100 });
  assert.equal(calls, 0);
  off();
});

await test('groupFactor/baseline: reine Zugriffe, Baseline viermal Faktor 1', () => {
  const r = ty.resolveTypography({ interface: 150, supporting: 80, technical: 125, workspace: 100 });
  assert.equal(ty.groupFactor(r, 'interface'), 1.5);
  assert.equal(ty.groupFactor(r, 'supporting'), 0.8);
  assert.equal(ty.groupFactor(r, 'technical'), 1.25);
  assert.equal(ty.groupFactor(r, 'workspace'), 1);
  const b = ty.baselineTypography();
  assert.deepEqual(b.groups, { interface: 100, supporting: 100, technical: 100, workspace: 100 });
  assert.deepEqual({ ...b.factors }, { interface: 1, supporting: 1, technical: 1, workspace: 1 });
});

await test('withBaselineTypography: stellt wieder her, auch bei Fehler', () => {
  const user = ty.resolveTypography({ workspace: 150 });
  const host = { typo: user };
  const out = ty.withBaselineTypography(host, () => {
    assert.deepEqual({ ...host.typo.factors }, { interface: 1, supporting: 1, technical: 1, workspace: 1 });
    return 42;
  });
  assert.equal(out, 42);
  assert.equal(host.typo, user);
  assert.throws(() => ty.withBaselineTypography(host, () => { throw new Error('boom'); }), /boom/);
  assert.equal(host.typo, user);
});

await test('Gleicher Wert: kein Event, keine Änderung', () => {
  store.clear();
  ty.initTypography();
  let calls = 0;
  const off = ty.onTypographyChange(() => calls++);
  ty.setTypographyGroup('interface', 100);
  assert.equal(calls, 0);
  ty.setTypographyGroup('interface', 125);
  assert.equal(calls, 1);
  off();
});

if (failed) {
  console.log(`${failed} FEHLGESCHLAGEN`);
  process.exit(1);
} else console.log('alle typografie-zustandstests bestanden');
