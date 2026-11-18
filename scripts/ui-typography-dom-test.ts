// Tests für den DOM-Adapter der UI-Schriftgruppen (reine Attributsetzung,
// kein Browser nötig). Aufruf: node scripts/run-ts.mjs scripts/ui-typography-dom-test.ts
import { strict as assert } from 'node:assert';

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
const dom = await import('../src/uiTypographyDom');

function stubRoot() {
  const props = new Map<string, string>();
  return {
    props,
    style: {
      setProperty: (k: string, v: string) => {
        props.set(k, String(v));
      },
      getPropertyValue: (k: string) => props.get(k) ?? '',
    },
  };
}

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

await test('Vier Faktoren werden gesetzt, nichts sonst', () => {
  const root = stubRoot();
  dom.applyTypography(root as unknown as HTMLElement, ty.resolveTypography({ interface: 125, supporting: 80, technical: 150, workspace: 100 }));
  assert.deepEqual([...root.props.entries()].sort(), [
    ['--ty-interface', '1.25'],
    ['--ty-supporting', '0.8'],
    ['--ty-technical', '1.5'],
    ['--ty-workspace', '1'],
  ]);
});

await test('Init wendet gespeicherten Stand an, Änderung folgt live', () => {
  store.clear();
  store.setItem('kizamubeam.uiTypography', '{"interface":125}');
  const root = stubRoot();
  const off = dom.initTypographyDom(root as unknown as HTMLElement);
  assert.equal(root.props.get('--ty-interface'), '1.25');
  assert.equal(root.props.get('--ty-supporting'), '1');
  ty.setTypographyGroup('supporting', 150);
  assert.equal(root.props.get('--ty-supporting'), '1.5');
  off();
  ty.setTypographyGroup('supporting', 80);
  assert.equal(root.props.get('--ty-supporting'), '1.5');
});

await test('Abmelder beendet nur eigene Bindung', () => {
  store.clear();
  const a = stubRoot();
  const b = stubRoot();
  const offA = dom.initTypographyDom(a as unknown as HTMLElement);
  const offB = dom.initTypographyDom(b as unknown as HTMLElement);
  offA();
  ty.setTypographyGroup('workspace', 125);
  assert.equal(a.props.get('--ty-workspace'), '1');
  assert.equal(b.props.get('--ty-workspace'), '1.25');
  offB();
  ty.resetTypography();
});

if (failed) {
  console.log(`${failed} FEHLGESCHLAGEN`);
  process.exit(1);
} else console.log('alle typografie-dom-tests bestanden');
