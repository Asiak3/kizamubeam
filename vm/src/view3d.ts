// 3D view of the machine: bed, frame, gantry with the laser head, the beam while the laser is on, and the placed
// workpieces with their burn maps. Coordinates as on the machine: X right, Y to the back, Z up, in mm.
// The travelled paths of the 2D view lie on the bed as a texture.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Snapshot } from './api';
import { contains, type BurnMap, type Piece } from './burn';
import { lookTexture, resolveLook, shadeHex, type LookPreset } from '../../src/view3d/looks';

const FRAME = 22;
/** height of the laser module's lower edge above the bed */
const HEAD_Z = 45;
/** how often a changed burn map is sent to the graphics card at most (ms) */
const UPLOAD_MS = 100;

const cssVar = (n: string, d: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d;

const texCache = new Map<string, THREE.DataTexture>();
function lookMap(p: LookPreset) {
  const key = `${p.id}|${p.color}`;
  let tx = texCache.get(key);
  if (tx) return tx;
  const { rgba } = lookTexture(p, 512);
  tx = new THREE.DataTexture(rgba, 512, 512, THREE.RGBAFormat);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.magFilter = THREE.LinearFilter;
  tx.minFilter = THREE.LinearMipmapLinearFilter;
  tx.generateMipmaps = true;
  tx.anisotropy = 4;
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.needsUpdate = true;
  texCache.set(key, tx);
  return tx;
}

interface PieceObj {
  piece: Piece;
  map: BurnMap;
  group: THREE.Group;
  burnTex: THREE.DataTexture;
  outline: THREE.LineSegments;
  pickables: THREE.Object3D[];
  uploaded: number;
  key: string;
}

/** Face material of a workpiece: look texture plus burn map (mark colour, darker with depth, holes where cut through) */
function faceMaterial(p: LookPreset, w: number, h: number, burnTex: THREE.DataTexture) {
  const map = p.tex === 'plain' ? null : lookMap(p).clone();
  if (map) {
    map.repeat.set(w / p.tile, h / p.tile);
    map.needsUpdate = true;
  }
  const mat = new THREE.MeshStandardMaterial({
    color: map ? 0xffffff : new THREE.Color(p.color),
    map,
    roughness: p.rough,
    metalness: p.metal,
    transparent: p.clear > 0,
    opacity: p.clear > 0 ? 1 - p.clear * 0.55 : 1,
  });
  const uniforms = {
    burnMap: { value: burnTex },
    burnColor: { value: new THREE.Color(p.engrave.color) },
    burnAlpha: { value: p.engrave.alpha },
    burnDeep: { value: p.engrave.style === 'burn' ? 0.45 : 0.15 },
    edgeColor: { value: new THREE.Color(p.edge ?? shadeHex(p.color, 0.45)) },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'varying vec2 vBurnUv;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vBurnUv = uv;');
    shader.fragmentShader =
      'uniform sampler2D burnMap;\nuniform vec3 burnColor;\nuniform vec3 edgeColor;\nuniform float burnAlpha;\nuniform float burnDeep;\nvarying vec2 vBurnUv;\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  vec2 burn = texture2D(burnMap, vBurnUv).rg;
  if (burn.g > 0.998) discard;
  diffuseColor.rgb = mix(diffuseColor.rgb, burnColor, burn.r * burnAlpha);
  diffuseColor.rgb *= 1.0 - burnDeep * burn.g;
  // seen from afar a thin cut is averaged with the surface around it: show it as a dark cut edge
  diffuseColor.rgb = mix(diffuseColor.rgb, edgeColor, smoothstep(0.15, 0.9, burn.g) * 0.85);
  diffuseColor.a = mix(diffuseColor.a, 1.0, burn.r * burnAlpha);`,
      );
  };
  mat.customProgramCacheKey = () => 'vm-burn';
  return mat;
}

export class Bed3D {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  private controls: OrbitControls;
  private machine = new THREE.Group();
  private piecesGroup = new THREE.Group();
  private head = new THREE.Group();
  private beam: THREE.Mesh;
  private glow: THREE.Sprite;
  private gantry: THREE.Mesh;
  private traces: { mesh: THREE.Mesh; tex: THREE.CanvasTexture } | null = null;
  private tracesAt = 0;
  private tracesVersion = -1;
  private objs: PieceObj[] = [];
  private bedW = 0;
  private bedH = 0;
  private snap: Snapshot | null = null;
  private needsRender = true;
  private raycaster = new THREE.Raycaster();
  private selected: string | null = null;
  active = false;
  /** a piece was clicked (null = empty space) */
  onSelect: (id: string | null) => void = () => {};
  /** a piece is being dragged; done = pointer released */
  onMove: (id: string, x: number, y: number, rot: number, done: boolean) => void = () => {};

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'bed3d';
    host.append(this.canvas);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-0.6, -1.2, 2);
    this.scene.add(sun);
    this.camera.up.set(0, 0, 1);
    // registered before OrbitControls, so a drag on a piece can switch the orbit off first
    this.bindPointer();
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => (this.needsRender = true));
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    // head: carriage on the gantry and laser module below
    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.2 });
    const alu = new THREE.MeshStandardMaterial({ color: 0xb9bec6, roughness: 0.4, metalness: 0.7 });
    // the module sits behind the nozzle, so the spot stays visible from the front
    const module = new THREE.Mesh(new THREE.BoxGeometry(34, 30, 70), dark);
    module.position.set(0, 13, HEAD_Z + 35);
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 12, 20), alu);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(0, 0, HEAD_Z + 6);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(16, 14, 6), dark);
    arm.position.set(0, 4, HEAD_Z + 9);
    const carriage = new THREE.Mesh(new THREE.BoxGeometry(50, 16, 40), alu);
    carriage.position.set(0, 36, HEAD_Z + 55);
    this.head.add(module, nozzle, arm, carriage);
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 1, 8),
      new THREE.MeshBasicMaterial({ color: 0xff3322, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.beam.rotation.x = Math.PI / 2;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff4422, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.glow.scale.set(14, 14, 1);
    this.gantry = new THREE.Mesh(new THREE.BoxGeometry(1, 20, 30), alu);
    this.scene.add(this.machine, this.piecesGroup, this.head, this.beam, this.glow, this.gantry);

    new ResizeObserver(() => this.fitSize()).observe(host);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    this.applyTheme();
    this.fitSize();
  }

  private applyTheme() {
    this.scene.background = new THREE.Color(cssVar('--stage', '#e7e7e4'));
    this.needsRender = true;
  }

  private fitSize() {
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  /** Bed and frame for a travel of w × h mm */
  setBed(w: number, h: number) {
    if (w === this.bedW && h === this.bedH) return;
    const first = this.bedW === 0;
    this.bedW = w;
    this.bedH = h;
    disposeTree(this.machine);
    this.machine.clear();
    // honeycomb bed: dark plate with a fine grid
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#3a3d42';
    g.fillRect(0, 0, 64, 64);
    g.strokeStyle = '#55595f';
    g.lineWidth = 3;
    g.strokeRect(0, 0, 64, 64);
    const grid = new THREE.CanvasTexture(c);
    grid.wrapS = grid.wrapT = THREE.RepeatWrapping;
    grid.repeat.set(w / 10, h / 10);
    grid.colorSpace = THREE.SRGBColorSpace;
    grid.anisotropy = 4;
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: grid, roughness: 0.8, metalness: 0.3 }));
    bed.position.set(w / 2, h / 2, -0.2);
    const alu = new THREE.MeshStandardMaterial({ color: 0xa9aeb6, roughness: 0.45, metalness: 0.6 });
    const rail = (x: number, y: number, sx: number, sy: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, FRAME), alu);
      m.position.set(x, y, FRAME / 2 - 6);
      return m;
    };
    const W = w + 2 * FRAME + 40,
      H = h + 2 * FRAME + 40;
    this.machine.add(
      bed,
      rail(-20 - FRAME / 2, h / 2, FRAME, H),
      rail(w + 20 + FRAME / 2, h / 2, FRAME, H),
      rail(w / 2, -20 - FRAME / 2, W, FRAME),
      rail(w / 2, h + 20 + FRAME / 2, W, FRAME),
    );
    // Y rails on top of the side frame, the gantry rides on them
    this.machine.add(rail(-20 - FRAME / 2, h / 2, FRAME, H), rail(w + 20 + FRAME / 2, h / 2, FRAME, H));
    this.machine.children.slice(-2).forEach((m) => (m.position.z = HEAD_Z + 55));
    this.gantry.scale.set(W, 1, 1);
    this.gantry.position.set(w / 2, 52, HEAD_Z + 55);
    if (this.traces) {
      this.traces.mesh.geometry.dispose();
      this.traces.mesh.geometry = new THREE.PlaneGeometry(w, h);
      this.traces.mesh.position.set(w / 2, h / 2, 0.05);
    }
    if (first) this.fit();
    this.needsRender = true;
  }

  /** Camera on the whole bed, slightly from the front */
  fit() {
    const s = Math.max(this.bedW, this.bedH);
    this.controls.target.set(this.bedW / 2, this.bedH / 2, 0);
    // steep enough that the gantry in front does not hide the front of the bed
    this.camera.position.set(this.bedW / 2, this.bedH / 2 - s * 0.95, s * 1.75);
    this.camera.near = s / 200;
    this.camera.far = s * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.needsRender = true;
  }

  /** Paths of the 2D view as a bitmap over the bed. version changes whenever new paths were drawn; make()
   *  draws the bitmap and is only called when it is sent to the graphics card (at most every 400 ms). */
  setTraces(version: number, make: () => HTMLCanvasElement) {
    const now = performance.now();
    if (!this.active || version === this.tracesVersion || now - this.tracesAt < 400) return;
    this.tracesVersion = version;
    this.tracesAt = now;
    const canvas = make();
    if (!this.traces) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.bedW || 1, this.bedH || 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      mesh.position.set(this.bedW / 2, this.bedH / 2, 0.05);
      this.traces = { mesh, tex: null as unknown as THREE.CanvasTexture };
      this.scene.add(mesh);
    }
    if (this.traces.tex?.image !== canvas) {
      this.traces.tex?.dispose();
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.traces.tex = tex;
      (this.traces.mesh.material as THREE.MeshBasicMaterial).map = tex;
      (this.traces.mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
    }
    this.traces.tex.needsUpdate = true;
    this.needsRender = true;
  }

  /** Show these workpieces; objects are rebuilt only when size, thickness or look changed */
  setPieces(list: { piece: Piece; map: BurnMap }[], selected: string | null) {
    const keep = new Map(this.objs.map((o) => [o.piece.id, o]));
    const next: PieceObj[] = [];
    for (const { piece, map } of list) {
      const key = `${piece.w}|${piece.h}|${piece.t}|${piece.look}|${piece.color ?? ''}`;
      let o = keep.get(piece.id);
      if (o && (o.key !== key || o.map !== map)) {
        this.dropPiece(o);
        o = undefined;
      }
      if (!o) o = this.buildPiece(piece, map, key);
      keep.delete(piece.id);
      o.piece = piece;
      o.group.position.set(piece.x + piece.w / 2, piece.y + piece.h / 2, 0);
      o.group.rotation.z = (piece.rot * Math.PI) / 180;
      o.outline.visible = piece.id === selected;
      next.push(o);
    }
    for (const o of keep.values()) this.dropPiece(o);
    this.objs = next;
    this.selected = selected;
    this.needsRender = true;
  }

  private buildPiece(piece: Piece, map: BurnMap, key: string): PieceObj {
    const look = resolveLook({ id: piece.look, color: piece.color });
    const burnTex = new THREE.DataTexture(map.tex, map.nx, map.ny, THREE.RGFormat, THREE.UnsignedByteType);
    burnTex.unpackAlignment = 1;
    burnTex.magFilter = THREE.LinearFilter;
    // mipmaps keep thin lines visible when zoomed out (without them every other cut pixel is skipped)
    burnTex.minFilter = THREE.LinearMipmapLinearFilter;
    burnTex.generateMipmaps = true;
    burnTex.anisotropy = 4;
    burnTex.needsUpdate = true;
    map.dirty = false;
    const group = new THREE.Group();
    const { w, h, t } = piece;
    const face = faceMaterial(look, w, h, burnTex);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(w, h), face);
    top.position.z = t;
    // bottom: same map seen from below (mirrored), so a cut shows through on both sides
    const bottomGeo = new THREE.PlaneGeometry(w, h);
    bottomGeo.rotateY(Math.PI);
    const uv = bottomGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    const bottom = new THREE.Mesh(bottomGeo, face);
    bottom.position.z = 0.01;
    const side = new THREE.MeshStandardMaterial({ color: new THREE.Color(shadeHex(look.color, 0.82)), roughness: look.rough, metalness: look.metal, transparent: look.clear > 0, opacity: look.clear > 0 ? 0.6 : 1 });
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), [side, side, side, side, hidden, hidden]);
    box.position.z = t / 2;
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w + 1, h + 1, t + 0.4)), new THREE.LineBasicMaterial({ color: new THREE.Color(cssVar('--accent', '#1f6feb')) }));
    outline.position.z = t / 2;
    group.add(box, top, bottom, outline);
    for (const m of [top, bottom, box]) m.userData.pieceId = piece.id;
    this.piecesGroup.add(group);
    return { piece, map, group, burnTex, outline, pickables: [top, box], uploaded: 0, key };
  }

  private dropPiece(o: PieceObj) {
    this.piecesGroup.remove(o.group);
    disposeTree(o.group);
    o.burnTex.dispose();
  }

  update(s: Snapshot) {
    const prev = this.snap;
    this.snap = s;
    if (!prev || prev.head[0] !== s.head[0] || prev.head[1] !== s.head[1] || prev.laserOn !== s.laserOn || prev.power !== s.power) this.needsRender = true;
  }

  invalidate() {
    this.needsRender = true;
  }

  /** Surface height under a bed point: the thickest piece there */
  private surface(x: number, y: number) {
    let z = 0;
    for (const o of this.objs) if (o.piece.t > z && contains(o.piece, x, y)) z = o.piece.t;
    return z;
  }

  draw() {
    if (!this.active) return;
    if (this.controls.update()) this.needsRender = true;
    const now = performance.now();
    for (const o of this.objs) {
      if (o.map.dirty && now - o.uploaded > UPLOAD_MS) {
        o.burnTex.needsUpdate = true;
        o.map.dirty = false;
        o.uploaded = now;
        this.needsRender = true;
      }
    }
    if (!this.needsRender) return;
    this.needsRender = false;
    const s = this.snap;
    const hx = s ? s.head[0] : 0,
      hy = s ? s.head[1] : 0;
    this.head.position.set(hx, hy, 0);
    this.gantry.position.y = hy + 52;
    const z = this.surface(hx, hy);
    const on = !!s && s.laserOn && s.power > 0;
    this.beam.visible = this.glow.visible = on;
    if (on) {
      const len = HEAD_Z - z;
      this.beam.scale.set(1, len, 1);
      this.beam.position.set(hx, hy, z + len / 2);
      this.glow.position.set(hx, hy, z + 0.3);
      const k = 6 + 14 * s!.power;
      this.glow.scale.set(k, k, 1);
      (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.6 * s!.power;
    }
    this.renderer.render(this.scene, this.camera);
  }

  // ---------- moving pieces with the mouse ----------

  private ray(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    return this.raycaster;
  }

  /** Point on the horizontal plane at height z under the pointer */
  private onPlane(e: PointerEvent, z: number) {
    const p = new THREE.Vector3();
    return this.ray(e).ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -z), p) ? p : null;
  }

  private bindPointer() {
    const c = this.canvas;
    let drag: { id: string; start: THREE.Vector3; x: number; y: number; rot: number; z: number; moved: boolean; rotate: boolean; a0: number } | null = null;
    let down: { x: number; y: number } | null = null;
    c.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
      if (e.button !== 0) return;
      const hits = this.ray(e).intersectObjects(this.objs.flatMap((o) => o.pickables), false);
      const id = hits[0]?.object.userData.pieceId as string | undefined;
      const o = id ? this.objs.find((q) => q.piece.id === id) : undefined;
      if (!o) return;
      const start = this.onPlane(e, o.piece.t);
      if (!start) return;
      this.controls.enabled = false;
      c.setPointerCapture(e.pointerId);
      const cx = o.piece.x + o.piece.w / 2,
        cy = o.piece.y + o.piece.h / 2;
      drag = { id: o.piece.id, start, x: o.piece.x, y: o.piece.y, rot: o.piece.rot, z: o.piece.t, moved: false, rotate: e.shiftKey, a0: Math.atan2(start.y - cy, start.x - cx) };
      if (o.piece.id !== this.selected) this.onSelect(o.piece.id);
    });
    c.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = this.onPlane(e, drag.z);
      if (!p) return;
      const o = this.objs.find((q) => q.piece.id === drag!.id);
      if (!o) return;
      drag.moved = true;
      if (drag.rotate) {
        const cx = drag.x + o.piece.w / 2,
          cy = drag.y + o.piece.h / 2;
        let rot = drag.rot + ((Math.atan2(p.y - cy, p.x - cx) - drag.a0) * 180) / Math.PI;
        rot = e.altKey ? rot : Math.round(rot);
        this.onMove(drag.id, drag.x, drag.y, ((rot % 360) + 360) % 360, false);
      } else {
        let x = drag.x + p.x - drag.start.x,
          y = drag.y + p.y - drag.start.y;
        if (!e.altKey) (x = Math.round(x * 2) / 2), (y = Math.round(y * 2) / 2);
        this.onMove(drag.id, x, y, drag.rot, false);
      }
    });
    const end = (e: PointerEvent) => {
      if (drag) {
        const o = this.objs.find((q) => q.piece.id === drag!.id);
        if (drag.moved && o) this.onMove(o.piece.id, o.piece.x, o.piece.y, o.piece.rot, true);
        drag = null;
        this.controls.enabled = true;
      } else if (down && e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && e.button === 0) {
        this.onSelect(null);
      }
      down = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('dblclick', () => this.fit());
  }
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,200,160,0.8)');
  grad.addColorStop(1, 'rgba(255,60,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    if (n instanceof THREE.Mesh || n instanceof THREE.LineSegments) {
      n.geometry.dispose();
      for (const m of (Array.isArray(n.material) ? n.material : [n.material]) as THREE.MeshStandardMaterial[]) {
        // look textures are shared (cache); clones only share the image, so disposing the clone is fine
        m.map?.dispose();
        m.dispose();
      }
    }
  });
}
