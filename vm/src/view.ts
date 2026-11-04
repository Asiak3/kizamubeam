// Top view of the bed: burn marks and rapids are collected in bitmaps at bed resolution
// (independent of how many segments a job has), with grid, origins and the head on top.
// Machine coordinates: origin front left, Y towards the back (up on screen).

import type { Snapshot } from './api';
import { contains, corners, type Piece } from './burn';
import { t } from './i18n';
import { resolveLook } from '../../src/view3d/looks';

const MAX_PX = 4096;

export class BedView {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bedW = 400;
  private bedH = 400;
  /** pixels per mm of the trace bitmaps */
  private res = 8;
  private burn = document.createElement('canvas');
  private rapid = document.createElement('canvas');
  private bctx!: CanvasRenderingContext2D;
  private rctx!: CanvasRenderingContext2D;
  /** view: screen pixels per mm and offset */
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private fitted = false;
  private snap: Snapshot | null = null;
  showRapids = true;
  private dirty = true;
  /** Downscaled copies of the trace bitmaps (half size per level) so thin lines do not
   *  vanish when zoomed out; rebuilt when new segments arrived */
  private pyramid: { burn: HTMLCanvasElement; rapid: HTMLCanvasElement }[] = [];
  private pyramidAt = 0;
  private pyramidStale = true;
  /** counts changes of the trace bitmaps (for the 3D view) */
  version = 0;
  private composite: HTMLCanvasElement | null = null;
  private pieces: Piece[] = [];
  private selected: string | null = null;
  /** a piece was clicked (null = empty space) */
  onSelect: (id: string | null) => void = () => {};
  /** a piece is being dragged; done = pointer released */
  onMove: (id: string, x: number, y: number, rot: number, done: boolean) => void = () => {};

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'bed';
    host.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.resetLayers();
    new ResizeObserver(() => {
      this.resize();
      if (!this.fitted) this.fit();
      this.dirty = true;
    }).observe(host);
    this.bindPointer();
  }

  setBed(w: number, h: number) {
    if (w === this.bedW && h === this.bedH) return;
    this.bedW = w;
    this.bedH = h;
    this.resetLayers();
    this.fit();
  }

  /** clear traces */
  resetLayers() {
    this.res = Math.max(1, Math.min(10, MAX_PX / Math.max(this.bedW, this.bedH)));
    for (const c of [this.burn, this.rapid]) {
      c.width = Math.round(this.bedW * this.res);
      c.height = Math.round(this.bedH * this.res);
    }
    this.bctx = this.burn.getContext('2d')!;
    this.rctx = this.rapid.getContext('2d')!;
    this.bctx.lineCap = 'round';
    this.rctx.lineCap = 'round';
    this.pyramid = [];
    this.pyramidStale = true;
    this.dirty = true;
    this.version++;
  }

  setPieces(list: Piece[], selected: string | null) {
    this.pieces = list;
    this.selected = selected;
    this.dirty = true;
  }

  /** Paths (and rapids, if shown) in one bitmap of at most 2048 px per side, for the 3D view */
  traceImage() {
    const k = Math.min(1, 2048 / Math.max(this.burn.width, this.burn.height));
    const c = (this.composite ??= document.createElement('canvas'));
    const w = Math.max(1, Math.round(this.burn.width * k)),
      h = Math.max(1, Math.round(this.burn.height * k));
    if (c.width !== w || c.height !== h) (c.width = w), (c.height = h);
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    g.imageSmoothingEnabled = true;
    if (this.showRapids) g.drawImage(this.rapid, 0, 0, w, h);
    g.drawImage(this.burn, 0, 0, w, h);
    return c;
  }

  /** Bitmaps for level k (0 = full resolution); levels are made by repeated halving */
  private level(k: number) {
    if (k <= 0) return { burn: this.burn, rapid: this.rapid };
    const now = performance.now();
    if (this.pyramidStale && (now - this.pyramidAt > 250 || this.pyramid.length < k)) {
      this.pyramid = [];
      this.pyramidStale = false;
      this.pyramidAt = now;
    }
    while (this.pyramid.length < k) {
      const src = this.pyramid.length ? this.pyramid[this.pyramid.length - 1] : { burn: this.burn, rapid: this.rapid };
      const half = (c: HTMLCanvasElement) => {
        const d = document.createElement('canvas');
        d.width = Math.max(1, Math.round(c.width / 2));
        d.height = Math.max(1, Math.round(c.height / 2));
        const g = d.getContext('2d')!;
        g.imageSmoothingEnabled = true;
        g.drawImage(c, 0, 0, d.width, d.height);
        return d;
      };
      this.pyramid.push({ burn: half(src.burn), rapid: half(src.rapid) });
    }
    if (this.pyramidStale) this.dirty = true;
    return this.pyramid[k - 1];
  }

  /** Draw new segments (7 numbers each) into the bitmaps */
  addSegments(s: number[]) {
    if (!s.length) return;
    const r = this.res;
    const H = this.bedH;
    const b = this.bctx;
    const q = this.rctx;
    // laser spot about 0.15 mm, at least 2 px so cut lines stay visible when zoomed out
    b.lineWidth = Math.max(2, 0.15 * r);
    q.lineWidth = 1.5;
    q.strokeStyle = 'rgba(40, 110, 220, 0.35)';
    q.beginPath();
    for (let i = 0; i + 6 < s.length; i += 7) {
      const [x0, y0, x1, y1, p, dur, rapid] = [s[i], s[i + 1], s[i + 2], s[i + 3], s[i + 4], s[i + 5], s[i + 6]];
      const ax = x0 * r, ay = (H - y0) * r, bx = x1 * r, by = (H - y1) * r;
      if (p > 0) {
        if (x0 === x1 && y0 === y1) {
          // standing still with the laser on: a dot, darker the longer it lasts
          b.fillStyle = `rgba(45, 25, 10, ${Math.min(1, 0.3 + dur * p * 2)})`;
          b.beginPath();
          b.arc(ax, ay, Math.max(1, 0.2 * r), 0, Math.PI * 2);
          b.fill();
        } else {
          b.strokeStyle = `rgba(45, 25, 10, ${0.35 + 0.65 * p})`;
          b.beginPath();
          b.moveTo(ax, ay);
          b.lineTo(bx, by);
          b.stroke();
        }
      } else if (rapid || p === 0) {
        q.moveTo(ax, ay);
        q.lineTo(bx, by);
      }
    }
    q.stroke();
    this.pyramidStale = true;
    this.dirty = true;
    this.version++;
  }

  update(s: Snapshot) {
    const prev = this.snap;
    this.snap = s;
    if (!prev || prev.head[0] !== s.head[0] || prev.head[1] !== s.head[1] || prev.laserOn !== s.laserOn || prev.wco[0] !== s.wco[0] || prev.wco[1] !== s.wco[1]) this.dirty = true;
  }

  invalidate() {
    this.dirty = true;
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
  }

  fit() {
    const w = this.canvas.width, h = this.canvas.height;
    if (w < 10 || h < 10) return;
    const pad = 40 * (window.devicePixelRatio || 1);
    this.scale = Math.min((w - 2 * pad) / this.bedW, (h - 2 * pad) / this.bedH);
    this.ox = (w - this.bedW * this.scale) / 2;
    this.oy = (h - this.bedH * this.scale) / 2;
    this.fitted = true;
    this.dirty = true;
  }

  /** mm → screen */
  private sx(x: number) {
    return this.ox + x * this.scale;
  }
  private sy(y: number) {
    return this.oy + (this.bedH - y) * this.scale;
  }

  private bindPointer() {
    const c = this.canvas;
    let drag: { x: number; y: number } | null = null;
    let move: { id: string; mx: number; my: number; x: number; y: number; rot: number; rotate: boolean; a0: number; moved: boolean } | null = null;
    let down: { x: number; y: number } | null = null;
    const mm = (e: PointerEvent) => {
      const dpr = window.devicePixelRatio || 1;
      const r = c.getBoundingClientRect();
      return [((e.clientX - r.left) * dpr - this.ox) / this.scale, this.bedH - ((e.clientY - r.top) * dpr - this.oy) / this.scale];
    };
    c.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
      const [x, y] = mm(e);
      const hit = e.button === 0 ? [...this.pieces].reverse().find((p) => contains(p, x, y)) : undefined;
      if (hit) {
        const cx = hit.x + hit.w / 2,
          cy = hit.y + hit.h / 2;
        move = { id: hit.id, mx: x, my: y, x: hit.x, y: hit.y, rot: hit.rot, rotate: e.shiftKey, a0: Math.atan2(y - cy, x - cx), moved: false };
        if (hit.id !== this.selected) this.onSelect(hit.id);
        return;
      }
      drag = { x: e.clientX, y: e.clientY };
    });
    c.addEventListener('pointermove', (e) => {
      if (move) {
        const [x, y] = mm(e);
        const p = this.pieces.find((q) => q.id === move!.id);
        if (!p) return;
        move.moved = true;
        if (move.rotate) {
          const cx = move.x + p.w / 2,
            cy = move.y + p.h / 2;
          let rot = move.rot + ((Math.atan2(y - cy, x - cx) - move.a0) * 180) / Math.PI;
          rot = e.altKey ? rot : Math.round(rot);
          this.onMove(move.id, move.x, move.y, ((rot % 360) + 360) % 360, false);
        } else {
          let nx = move.x + x - move.mx,
            ny = move.y + y - move.my;
          if (!e.altKey) (nx = Math.round(nx * 2) / 2), (ny = Math.round(ny * 2) / 2);
          this.onMove(move.id, nx, ny, move.rot, false);
        }
        return;
      }
      if (!drag) return;
      const dpr = window.devicePixelRatio || 1;
      this.ox += (e.clientX - drag.x) * dpr;
      this.oy += (e.clientY - drag.y) * dpr;
      drag = { x: e.clientX, y: e.clientY };
      this.dirty = true;
    });
    c.addEventListener('pointerup', (e) => {
      if (move) {
        const p = this.pieces.find((q) => q.id === move!.id);
        if (move.moved && p) this.onMove(p.id, p.x, p.y, p.rot, true);
      } else if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && e.button === 0) {
        this.onSelect(null);
      }
      drag = move = down = null;
    });
    c.addEventListener('dblclick', () => this.fit());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dpr = window.devicePixelRatio || 1;
      const r = c.getBoundingClientRect();
      const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
      const k = Math.exp(-e.deltaY * 0.0015);
      const ns = Math.min(200, Math.max(0.2, this.scale * k));
      const f = ns / this.scale;
      this.ox = px - (px - this.ox) * f;
      this.oy = py - (py - this.oy) * f;
      this.scale = ns;
      this.dirty = true;
    }, { passive: false });
  }

  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    const g = this.ctx;
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const dpr = window.devicePixelRatio || 1;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = v('--stage');
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const x0 = this.sx(0), y0 = this.sy(this.bedH), w = this.bedW * this.scale, h = this.bedH * this.scale;
    // bed
    g.fillStyle = v('--bed');
    g.fillRect(x0, y0, w, h);
    // grid every 10 mm, stronger every 50 mm
    for (const [step, color] of [[10, v('--grid')], [50, v('--grid-major')]] as const) {
      if (step * this.scale < 6) continue;
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.beginPath();
      for (let x = step; x < this.bedW; x += step) {
        const X = Math.round(this.sx(x)) + 0.5;
        g.moveTo(X, y0);
        g.lineTo(X, y0 + h);
      }
      for (let y = step; y < this.bedH; y += step) {
        const Y = Math.round(this.sy(y)) + 0.5;
        g.moveTo(x0, Y);
        g.lineTo(x0 + w, Y);
      }
      g.stroke();
    }
    // workpieces under the paths
    for (const p of this.pieces) {
      const look = resolveLook({ id: p.look, color: p.color });
      const pts = corners(p).map(([x, y]) => [this.sx(x), this.sy(y)]);
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.globalAlpha = look.clear > 0 ? 0.35 : 0.9;
      g.fillStyle = look.color;
      g.fill();
      g.globalAlpha = 1;
      g.strokeStyle = p.id === this.selected ? v('--accent') : 'rgba(60, 40, 20, 0.45)';
      g.lineWidth = (p.id === this.selected ? 2 : 1) * dpr;
      g.stroke();
    }
    // matching level: bitmap at most twice as fine as the screen
    const k = this.scale < this.res ? Math.max(0, Math.floor(Math.log2(this.res / this.scale))) : 0;
    const lv = this.level(k);
    g.imageSmoothingEnabled = this.scale < this.res;
    if (this.showRapids) g.drawImage(lv.rapid, x0, y0, w, h);
    g.drawImage(lv.burn, x0, y0, w, h);
    g.strokeStyle = v('--bed-edge');
    g.lineWidth = 1.5 * dpr;
    g.strokeRect(x0, y0, w, h);
    // label
    g.fillStyle = v('--muted');
    g.font = `${11 * dpr}px system-ui, sans-serif`;
    g.textBaseline = 'top';
    g.fillText(`${t('Bett')} ${this.bedW} × ${this.bedH} mm`, x0, y0 + h + 6 * dpr);
    // machine origin
    this.cross(this.sx(0), this.sy(0), 9 * dpr, v('--muted'), 1.5 * dpr);
    const s = this.snap;
    if (!s) return;
    // work origin, if offset
    if (Math.abs(s.wco[0]) > 1e-6 || Math.abs(s.wco[1]) > 1e-6) {
      // WCO is in machine coordinates; the head deviation (physical − MPos) applies here too
      const dx = s.head[0] - s.mpos[0], dy = s.head[1] - s.mpos[1];
      this.cross(this.sx(s.wco[0] + dx), this.sy(s.wco[1] + dy), 8 * dpr, v('--accent'), 1.5 * dpr);
    }
    // head
    const hx = this.sx(s.head[0]), hy = this.sy(s.head[1]);
    if (s.laserOn) {
      const r = 14 * dpr;
      const grad = g.createRadialGradient(hx, hy, 0, hx, hy, r);
      grad.addColorStop(0, 'rgba(255, 60, 30, 0.9)');
      grad.addColorStop(1, 'rgba(255, 60, 30, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(hx, hy, r, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = v('--head');
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.arc(hx, hy, 7 * dpr, 0, Math.PI * 2);
    g.stroke();
    this.cross(hx, hy, 12 * dpr, v('--head'), 1.5 * dpr);
  }

  private cross(x: number, y: number, r: number, color: string, lw: number) {
    const g = this.ctx;
    g.strokeStyle = color;
    g.lineWidth = lw;
    g.beginPath();
    g.moveTo(x - r, y);
    g.lineTo(x + r, y);
    g.moveTo(x, y - r);
    g.lineTo(x, y + r);
    g.stroke();
  }
}
