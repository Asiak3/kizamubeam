// Aufzeichnender Canvas-Kontext für Render-Tests: protokolliert Aufrufe samt
// aktiver Transform-Matrix, damit Welt- und Bildschirm-Koordinaten unterscheidbar
// bleiben. Nur die geprüften Operationen sind echt, alles andere ist ein No-op.
export type Mat6 = [number, number, number, number, number, number];

export interface RenderCall { op: string; mat: Mat6; args: unknown[] }

class MockPath2D {
  ops: { op: string; args: number[] }[] = [];
  moveTo(x: number, y: number) { this.ops.push({ op: 'moveTo', args: [x, y] }); }
  lineTo(x: number, y: number) { this.ops.push({ op: 'lineTo', args: [x, y] }); }
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number) { this.ops.push({ op: 'bezierCurveTo', args: [a, b, c, d, e, f] }); }
  closePath() { this.ops.push({ op: 'closePath', args: [] }); }
  rect(x: number, y: number, w: number, h: number) { this.ops.push({ op: 'rect', args: [x, y, w, h] }); }
  addPath(other: MockPath2D) { if (other?.ops) this.ops.push(...other.ops); }
}

export function installCanvasGlobals() {
  const g = globalThis as Record<string, unknown>;
  g.Path2D ??= MockPath2D;
  g.DOMMatrix ??= class { a = 1; b = 0; c = 0; d = 1; e = 0; f = 0; };
}

export { MockPath2D };

export function recordingCtx() {
  let cur: Mat6 = [1, 0, 0, 1, 0, 0];
  const stack: Mat6[] = [];
  const calls: RenderCall[] = [];
  const rec = (op: string, args: unknown[]) => calls.push({ op, mat: [...cur] as Mat6, args });

  const ctx: Record<string, unknown> = {
    strokeStyle: '#000', fillStyle: '#000', lineWidth: 1, globalAlpha: 1,
    font: '', textAlign: 'left', textBaseline: 'alphabetic', lineCap: 'butt', lineJoin: 'miter',
    imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
    canvas: { width: 800, height: 600 },
    save() { stack.push([...cur] as Mat6); },
    restore() { cur = stack.pop() ?? [1, 0, 0, 1, 0, 0]; },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { cur = [a, b, c, d, e, f]; },
    beginPath() { rec('beginPath', []); },
    closePath() { rec('closePath', []); },
    moveTo(...args: unknown[]) { rec('moveTo', args); },
    lineTo(...args: unknown[]) { rec('lineTo', args); },
    arc(...args: unknown[]) { rec('arc', args); },
    stroke(args?: unknown) { rec('stroke', [args]); },
    fill(args?: unknown) { rec('fill', [args]); },
    rect(...args: unknown[]) { rec('rect', args); },
    fillRect(...args: unknown[]) { rec('fillRect', args); },
    setLineDash(args: unknown[]) { rec('setLineDash', [args]); },
  };
  // Alles Ungenannte wird ein No-op (Farbverläufe, Text, Bilder …)
  const proxy = new Proxy(ctx, {
    get(t, p: string) {
      if (p in t) return t[p];
      const noop = () => ({ addColorStop() {}, width: 10, data: new Uint8ClampedArray(4) });
      t[p] = noop;
      return noop;
    },
    set(t, p: string, v) { t[p] = v; return true; },
  });
  return { ctx: proxy as unknown as CanvasRenderingContext2D, calls };
}
