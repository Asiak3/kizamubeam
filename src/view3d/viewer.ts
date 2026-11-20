// Darstellung der 3D-Ansicht mit three.js: Platten als hochgezogene Konturen, Durchdringungen rot,
// Explosionsansicht und drehende Zahnräder. Wird erst geladen, wenn das Fenster zum ersten Mal aufgeht.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Pt } from '../model';
import type { Overlap, Solid } from './solids';
import type { Engraving } from './engrave';
import { outlineSegments, solidBounds } from './solids';
import { Pose, rotatePose } from './poses';
import { DEFAULT_LOOK, LookPreset, lookTexture, resolveLook, shadeHex } from './looks';
import { BlueprintLabels, BlueprintViewport, computeBlueprintLayout, computeOrthoScale, drawBlueprintOverlay } from './blueprint';

export type ViewPreset = 'iso' | 'top' | 'front';

/** Darstellungsmodus der 3D-Ansicht */
export type RenderMode = 'material' | 'shadedEdges' | 'layer' | 'xray' | 'hiddenLines' | 'wireframe' | 'blueprint';

/** Hintergrund im Mockup-Modus: wie die Oberfläche, Weiß, Hellgrau, Dunkel oder Studio-Verlauf */
export type MockupBg = 'theme' | 'white' | 'grey' | 'dark' | 'studio';

export interface ViewSolid extends Solid {
  /** Teile mit gleicher Gruppe (Baugruppe) werden gemeinsam auseinandergezogen */
  group: string;
  /** Gravuren auf der Oberfläche */
  engraving?: Engraving;
  /** Layer der Kontur (bestimmt das Material) */
  layer?: number;
  /** Farbe des Layers für den Render-Modus „Layer-Farben“ */
  layerColor?: string;
  /** Aussehen des Materials */
  look?: LookPreset;
}

export interface Scene3D {
  solids: ViewSolid[];
  overlaps: Overlap[];
}

interface Part {
  s: ViewSolid;
  holder: THREE.Group;
  mesh: THREE.Mesh;
  outline: THREE.LineSegments;
  hiddenOutline: THREE.LineSegments | null;
  engrave: THREE.Mesh | null;
  engravePbrMat: THREE.Material | null;
  engraveAlphaMap: THREE.CanvasTexture | null;
  pbrMats: [THREE.Material, THREE.Material];
  pbrLineColor: THREE.Color;
  pbrLineOpacity: number;
  /** Richtung und Weg beim Auseinanderziehen (Mitte des Teils minus Mitte der Baugruppe) */
  away: THREE.Vector3;
}

/** Punkt in Polygon (Gerade-Ungerade) */
function inside(poly: Pt[], p: Pt) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
const area = (poly: Pt[]) => {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  return Math.abs(s / 2);
};

/** Konturen in Flächen mit Löchern ordnen: gerade Verschachtelungstiefe = Fläche, ungerade = Loch der umgebenden */
function shapesOf(polys: Pt[][]): THREE.Shape[] {
  const ps = polys.filter((p) => p.length > 2);
  const depth = ps.map((p, i) => ps.filter((q, j) => j !== i && inside(q, p[0])).length);
  const shapes = new Map<number, THREE.Shape>();
  ps.forEach((p, i) => {
    if (depth[i] % 2 === 0) shapes.set(i, new THREE.Shape(p.map((q) => new THREE.Vector2(q.x, q.y))));
  });
  ps.forEach((p, i) => {
    if (depth[i] % 2 === 0) return;
    // Kleinste umgebende Fläche
    let best = -1;
    ps.forEach((q, j) => {
      if (depth[j] === depth[i] - 1 && inside(q, p[0]) && (best < 0 || area(q) < area(ps[best]))) best = j;
    });
    if (best >= 0) shapes.get(best)!.holes.push(new THREE.Path(p.map((q) => new THREE.Vector2(q.x, q.y))));
  });
  return [...shapes.values()];
}

const poseMatrix = (p: Pose) =>
  new THREE.Matrix4().makeBasis(new THREE.Vector3(...p.u), new THREE.Vector3(...p.v), new THREE.Vector3(...p.n)).setPosition(...p.o);

function slabGeometry(s: Solid) {
  return new THREE.ExtrudeGeometry(shapesOf(s.polys), { depth: s.th, bevelEnabled: false, curveSegments: 1 });
}

/** Outline lines from the 2D contours, independent of the cap triangulation (issue #182) */
function outlineGeometry(s: Solid) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(outlineSegments(s.polys.filter((p) => p.length > 2), s.th), 3));
  return g;
}

/** Texturen je Aussehen (Farbe und Höhenkarte), werden für alle Teile geteilt */
const texCache = new Map<string, { map: THREE.DataTexture; bump: THREE.DataTexture | null }>();
const TEX_PX = 512;

function lookTextures(p: LookPreset) {
  const key = `${p.id}|${p.color}`;
  let c = texCache.get(key);
  if (c) return c;
  const { rgba, height } = lookTexture(p, TEX_PX);
  const mk = (data: Uint8ClampedArray, format: THREE.PixelFormat, srgb: boolean) => {
    const tx = new THREE.DataTexture(data, TEX_PX, TEX_PX, format);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.magFilter = THREE.LinearFilter;
    tx.minFilter = THREE.LinearMipmapLinearFilter;
    tx.generateMipmaps = true;
    tx.anisotropy = 4;
    if (srgb) tx.colorSpace = THREE.SRGBColorSpace;
    tx.needsUpdate = true;
    return tx;
  };
  c = { map: mk(rgba, THREE.RGBAFormat, true), bump: p.tex === 'plain' ? null : mk(height, THREE.RedFormat, false) };
  texCache.set(key, c);
  return c;
}

/** Zufallszahl 0..1 je Teil, damit die Maserung nicht auf allen Teilen gleich liegt */
const partRand = (i: number, k: number) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Materialien für Fläche und Schnittkante einer Platte */
function slabMaterials(p: LookPreset, th: number, i: number): [THREE.Material, THREE.Material] {
  const tex = p.tex === 'plain' ? null : lookTextures(p);
  const ofs = (t: THREE.Texture) => {
    const c = t.clone();
    c.repeat.set(1 / p.tile, 1 / p.tile);
    c.offset.set(partRand(i, 1), partRand(i, 2));
    return c;
  };
  const common = {
    color: tex ? 0xffffff : new THREE.Color(p.color),
    map: tex ? ofs(tex.map) : null,
    bumpMap: tex?.bump ? ofs(tex.bump) : null,
    bumpScale: 0.6,
    roughness: p.rough,
    metalness: p.metal,
  };
  const face: THREE.Material =
    p.clear > 0
      ? new THREE.MeshPhysicalMaterial({ ...common, color: new THREE.Color(p.color), transmission: p.clear, ior: p.ior, thickness: th, clearcoat: 0.6, clearcoatRoughness: 0.05, specularIntensity: 1 })
      : new THREE.MeshStandardMaterial(common);
  // Gelaserte Kante: bei Holz verkohlt, bei Acryl blank poliert, sonst wie die Fläche etwas dunkler
  const side: THREE.Material =
    p.clear > 0
      ? new THREE.MeshPhysicalMaterial({ color: new THREE.Color(p.edge ?? p.color), transmission: p.clear * 0.8, ior: p.ior, thickness: th * 4, roughness: 0.02 })
      : new THREE.MeshStandardMaterial({ color: new THREE.Color(p.edge ?? shadeHex(p.color, 0.85)), roughness: Math.min(1, p.rough + 0.1), metalness: p.metal });
  return [face, side];
}

/** Gravuren als Bild auf der Plattenfläche, knapp darüber, damit es nicht mit der Fläche flimmert */
function engravingMesh(s: Solid, e: Engraving, p: LookPreset): THREE.Mesh {
  const geo = new THREE.ShapeGeometry(shapesOf(s.polys), 1);
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = ((pos.getX(i) - e.x0) * e.k) / e.canvas.width;
    uv[i * 2 + 1] = ((pos.getY(i) - e.y0) * e.k) / e.canvas.height;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const tex = new THREE.CanvasTexture(e.canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    // Gravierte Stellen sind matt; auf Metall bleibt die Markierung leicht metallisch
    roughness: p.engrave.style === 'frost' ? 0.9 : 0.85,
    metalness: p.engrave.style === 'light' ? p.metal * 0.5 : 0,
    bumpMap: engravingBump(e.canvas),
    bumpScale: 1.5,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.z = e.top ? s.th + 0.01 : -0.01;
  m.renderOrder = 1;
  return m;
}

/** Studio-Hintergrund: weicher Verlauf von hell oben zu etwas dunkler unten */
function studioBackground(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#f4f5f6');
  gr.addColorStop(0.55, '#e3e5e8');
  gr.addColorStop(1, '#b9bdc3');
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 256);
  const tx = new THREE.CanvasTexture(c);
  tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}

/** Höhenbild einer Gravur: graviert = tiefer, damit die Ränder Licht und Schatten bekommen */
function engravingBump(cv: HTMLCanvasElement): THREE.CanvasTexture {
  const out = document.createElement('canvas');
  out.width = cv.width;
  out.height = cv.height;
  const src = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i + 3];
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  out.getContext('2d')!.putImageData(src, 0, 0);
  const tx = new THREE.CanvasTexture(out);
  tx.flipY = false;
  return tx;
}

/** Alpha-Maske einer Gravur/Füllung als Graustufenbild für technische Render-Modi */
function engravingAlpha(cv: HTMLCanvasElement): THREE.CanvasTexture {
  const out = document.createElement('canvas');
  out.width = cv.width;
  out.height = cv.height;
  const src = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = d[i + 3];
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  out.getContext('2d')!.putImageData(src, 0, 0);
  const tx = new THREE.CanvasTexture(out);
  tx.flipY = false;
  return tx;
}

const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export class Viewer3D {
  private renderer: THREE.WebGLRenderer;
  private overlay: HTMLCanvasElement;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
  private orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
  private controls: OrbitControls;
  private root = new THREE.Group();
  private overlapGroup = new THREE.Group();
  private grid: THREE.GridHelper | null = null;
  /** Mockup: Boden, der nur Schatten zeigt, und Sonne mit Schatten */
  private ground: THREE.Mesh | null = null;
  private sun: THREE.DirectionalLight;
  private mockup = false;
  private mockupBg: MockupBg = 'studio';
  private renderMode: RenderMode = 'material';
  private blueprintLabels: BlueprintLabels = { iso: '3D', front: 'Vorne', top: 'Oben', side: 'Seite', dims: true };
  private modeMats: THREE.Material[] = [];
  private parts: Part[] = [];
  private explode = 0;
  private spin = false;
  private showOverlaps = true;
  private angle = 0;
  private active = false;
  private needsRender = true;
  private last = 0;
  private raycaster = new THREE.Raycaster();
  private resize: ResizeObserver;
  private themeObs: MutationObserver;
  /** Name des Teils unter dem Zeiger (null = keines) */
  onHover: (label: string | null) => void = () => {};
  /** Ist das Fenster zu sehen? Sonst hält die Zeichenschleife an, bis setActive(true) sie wieder startet */
  isVisible: () => boolean = () => true;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Weiche Spiegelungen aus einem Raum, damit Acryl, Glas, Metall und Lack echt wirken
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    this.overlay = document.createElement('canvas');
    this.overlay.style.pointerEvents = 'none';
    this.overlay.hidden = true;
    host.append(this.renderer.domElement, this.overlay);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => (this.needsRender = true));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8070, 0.9));
    const sun = (this.sun = new THREE.DirectionalLight(0xffffff, 1.8));
    sun.position.set(0.8, -1.2, 2);
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 6;
    sun.shadow.blurSamples = 16;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun, sun.target);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-1, 1.5, 0.5);
    this.scene.add(fill);
    this.scene.add(this.root, this.overlapGroup);
    this.resize = new ResizeObserver(() => this.fitSize());
    this.resize.observe(host);
    this.themeObs = new MutationObserver(() => this.applyTheme());
    this.themeObs.observe(document.documentElement, { attributes: true });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    this.renderer.domElement.addEventListener('pointermove', (e) => this.hover(e));
    this.renderer.domElement.addEventListener('pointerleave', () => this.onHover(null));
    this.applyTheme();
    this.fitSize();
  }

  private isDarkBackground(): boolean {
    if (this.renderMode === 'blueprint') return true;
    const bg = this.mockup ? this.mockupBg : 'theme';
    if (bg === 'dark') return true;
    if (bg === 'white' || bg === 'grey' || bg === 'studio') return false;
    const col = new THREE.Color(cssVar('--surface', '#ffffff'));
    return col.r * 0.299 + col.g * 0.587 + col.b * 0.114 < 0.5;
  }

  private applyTheme() {
    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
    if (this.renderMode === 'blueprint') {
      this.scene.background = new THREE.Color('#0b3b8c');
    } else {
      const bg = this.mockup ? this.mockupBg : 'theme';
      this.scene.background =
        bg === 'studio' ? studioBackground() : new THREE.Color(bg === 'white' ? '#ffffff' : bg === 'grey' ? '#c9ccd0' : bg === 'dark' ? '#202226' : cssVar('--surface', '#ffffff'));
    }
    if (this.grid) {
      (this.grid.material as THREE.LineBasicMaterial).color = new THREE.Color(cssVar('--line', '#c3c7ce'));
      this.grid.visible = !this.mockup && this.renderMode !== 'blueprint';
    }
    if (this.parts.length) this.applyRenderMode();
    this.needsRender = true;
  }

  private fitSize() {
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(1, this.host.clientHeight);
    const pr = this.renderer.getPixelRatio();
    this.renderer.setSize(w, h, false);
    this.overlay.width = Math.max(1, Math.round(w * pr));
    this.overlay.height = Math.max(1, Math.round(h * pr));
    if (this.renderMode === 'blueprint') {
      const vp = computeBlueprintLayout(w, h).iso;
      this.camera.aspect = vp.w / Math.max(1, vp.h);
    } else {
      this.camera.aspect = w / h;
    }
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  private disposeModeMats() {
    for (const m of this.modeMats) m.dispose();
    this.modeMats = [];
  }

  private clear() {
    for (const p of this.parts) {
      if (p.mesh.material !== p.pbrMats) {
        p.pbrMats[0].dispose();
        p.pbrMats[1].dispose();
      }
      if (p.engrave && p.engravePbrMat && p.engrave.material !== p.engravePbrMat) {
        const em = p.engravePbrMat as THREE.MeshStandardMaterial;
        if (em.map instanceof THREE.CanvasTexture) em.map.dispose();
        if (em.bumpMap instanceof THREE.CanvasTexture) em.bumpMap.dispose();
        em.dispose();
      }
      p.engraveAlphaMap?.dispose();
    }
    this.disposeModeMats();
    for (const g of [this.root, this.overlapGroup])
      g.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          // Texturen der Materialien sind geteilt (Cache), nur die Gravurbilder gehören dem Teil
          for (const mat of (Array.isArray(o.material) ? o.material : [o.material]) as (THREE.Material & { map?: THREE.Texture | null })[]) {
            if (mat.map instanceof THREE.CanvasTexture) mat.map.dispose();
            const bump = (mat as THREE.MeshStandardMaterial).bumpMap;
            if (bump instanceof THREE.CanvasTexture) bump.dispose();
            mat.dispose();
          }
        }
      });
    this.root.clear();
    this.overlapGroup.clear();
    this.parts = [];
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid = null;
    }
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
      (this.ground.material as THREE.Material).dispose();
      this.ground = null;
    }
  }

  /** Neue Teile zeigen; refit: Kamera auf die Teile ausrichten (z. B. wenn eine andere Baugruppe gewählt wurde) */
  setScene(sc: Scene3D, refit: boolean) {
    this.clear();
    // Mitte jeder Baugruppe für die Explosionsansicht
    const centers = new Map<string, THREE.Box3>();
    const boxOf = (s: Solid) => {
      const b = solidBounds(s);
      return new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
    };
    for (const s of sc.solids) centers.set(s.group, (centers.get(s.group) ?? new THREE.Box3()).union(boxOf(s)));
    sc.solids.forEach((s, i) => {
      const geo = slabGeometry(s);
      const look = s.look ?? resolveLook(DEFAULT_LOOK);
      // Fläche (Gruppe 0) und Schnittkante (Gruppe 1) der hochgezogenen Kontur
      const pbrMats = slabMaterials(look, s.th, i);
      const mesh = new THREE.Mesh(geo, pbrMats);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(poseMatrix(s.pose));
      mesh.castShadow = mesh.receiveShadow = true;
      // Feine Umrisslinie, damit Teile gleicher Farbe unterscheidbar bleiben
      const pbrLineColor = new THREE.Color(look.edge ?? shadeHex(look.color, 0.6)).multiplyScalar(look.clear > 0 ? 0.85 : 0.7);
      const pbrLineOpacity = look.clear > 0 ? 0.8 : 0.55;
      const outline = new THREE.LineSegments(outlineGeometry(s), new THREE.LineBasicMaterial({ color: pbrLineColor.clone(), transparent: true, opacity: pbrLineOpacity }));
      mesh.add(outline);
      const engrave = s.engraving ? engravingMesh(s, s.engraving, look) : null;
      const engravePbrMat = engrave ? (engrave.material as THREE.Material) : null;
      const engraveAlphaMap = s.engraving ? engravingAlpha(s.engraving.canvas) : null;
      if (engrave) mesh.add(engrave);
      mesh.userData.label = s.label;
      const holder = new THREE.Group();
      holder.add(mesh);
      this.root.add(holder);
      const c = boxOf(s).getCenter(new THREE.Vector3()).sub(centers.get(s.group)!.getCenter(new THREE.Vector3()));
      this.parts.push({ s, holder, mesh, outline, hiddenOutline: null, engrave, engravePbrMat, engraveAlphaMap, pbrMats, pbrLineColor, pbrLineOpacity, away: c });
    });
    const red = new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.85, depthTest: false });
    for (const o of sc.overlaps)
      for (const p of o.pieces) {
        const m = new THREE.Mesh(slabGeometry(p), red.clone());
        m.matrixAutoUpdate = false;
        m.matrix.copy(poseMatrix(p.pose));
        m.renderOrder = 10;
        this.overlapGroup.add(m);
      }
    red.dispose();
    const all = this.bounds();
    if (!all.isEmpty()) {
      const size = all.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y, 10) * 1.6;
      const step = Math.pow(10, Math.floor(Math.log10(span / 8)));
      const div = Math.max(2, Math.round(span / step));
      this.grid = new THREE.GridHelper(div * step, div, cssVar('--line', '#c3c7ce'), cssVar('--line', '#c3c7ce'));
      this.grid.rotation.x = Math.PI / 2;
      const c = all.getCenter(new THREE.Vector3());
      this.grid.position.set(c.x, c.y, all.min.z - 0.05);
      (this.grid.material as THREE.Material).transparent = true;
      (this.grid.material as THREE.Material).opacity = 0.6;
      this.scene.add(this.grid);
      // Boden für die Schatten im Mockup-Modus
      this.ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 4, span * 4), new THREE.ShadowMaterial({ opacity: 0.28 }));
      this.ground.position.set(c.x, c.y, all.min.z - 0.02);
      this.ground.receiveShadow = true;
      this.scene.add(this.ground);
    }
    this.applyMockup();
    this.applyTheme();
    this.layout();
    if (refit) this.view('iso');
  }

  /** Beschriftungen und Bemaßung für den Blueprint-Modus setzen */
  setBlueprintLabels(labels: Partial<BlueprintLabels>) {
    this.blueprintLabels = { ...this.blueprintLabels, ...labels };
    this.needsRender = true;
  }

  /** Darstellungsmodus (Material, Shaded + Kanten, Layer-Farben, Röntgen, Hidden Lines, Wireframe, Blueprint) */
  setRenderMode(mode: RenderMode) {
    if (this.renderMode === mode) return;
    this.renderMode = mode;
    this.applyMockup();
    this.applyTheme();
    this.fitSize();
    this.needsRender = true;
  }

  private applyRenderMode() {
    this.disposeModeMats();
    const mode = this.renderMode;
    this.overlay.hidden = mode !== 'blueprint';
    const techLine = this.isDarkBackground() ? 0xe6e8ec : 0x1e2024;
    const b = mode === 'blueprint' ? this.bounds() : null;
    const dashStep = b && !b.isEmpty() ? Math.max(1.5, Math.min(8, b.getBoundingSphere(new THREE.Sphere()).radius * 0.035)) : 3;
    for (const p of this.parts) {
      const lineMat = p.outline.material as THREE.LineBasicMaterial;
      if (p.hiddenOutline) p.hiddenOutline.visible = false;
      if (mode === 'material' || mode === 'shadedEdges') {
        p.mesh.material = p.pbrMats;
        p.mesh.castShadow = p.mesh.receiveShadow = true;
        if (p.engrave && p.engravePbrMat) {
          p.engrave.material = p.engravePbrMat;
          p.engrave.visible = true;
        }
        lineMat.depthFunc = THREE.LessEqualDepth;
        if (mode === 'material') {
          lineMat.color.copy(p.pbrLineColor);
          lineMat.opacity = p.pbrLineOpacity;
          lineMat.transparent = true;
          lineMat.depthTest = true;
          p.outline.renderOrder = 0;
        } else {
          lineMat.color.setHex(techLine);
          lineMat.opacity = 0.9;
          lineMat.transparent = true;
          lineMat.depthTest = true;
          p.outline.renderOrder = 2;
        }
      } else if (mode === 'layer') {
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(p.s.layerColor || '#888888'),
          roughness: 0.72,
          metalness: 0.05,
        });
        this.modeMats.push(mat);
        p.mesh.material = mat;
        p.mesh.castShadow = p.mesh.receiveShadow = true;
        if (p.engrave && p.engravePbrMat) {
          p.engrave.material = p.engravePbrMat;
          p.engrave.visible = true;
        }
        lineMat.color.setHex(techLine);
        lineMat.opacity = 0.75;
        lineMat.transparent = true;
        lineMat.depthTest = true;
        lineMat.depthFunc = THREE.LessEqualDepth;
        p.outline.renderOrder = 2;
      } else if (mode === 'xray') {
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(p.s.layerColor || p.s.look?.color || '#7aa2d4'),
          roughness: 0.6,
          metalness: 0.05,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        this.modeMats.push(mat);
        p.mesh.material = mat;
        p.mesh.castShadow = p.mesh.receiveShadow = false;
        if (p.engrave && p.engravePbrMat) {
          p.engrave.material = p.engravePbrMat;
          p.engrave.visible = true;
        }
        lineMat.color.setHex(techLine);
        lineMat.opacity = 0.65;
        lineMat.transparent = true;
        lineMat.depthTest = true;
        lineMat.depthFunc = THREE.LessEqualDepth;
        p.outline.renderOrder = 2;
      } else if (mode === 'hiddenLines') {
        const mat = new THREE.MeshBasicMaterial({
          colorWrite: false,
          depthWrite: true,
          depthTest: true,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        });
        this.modeMats.push(mat);
        p.mesh.material = mat;
        p.mesh.castShadow = p.mesh.receiveShadow = false;
        if (p.engrave && p.engraveAlphaMap) {
          const em = new THREE.MeshBasicMaterial({
            color: techLine,
            alphaMap: p.engraveAlphaMap,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          });
          this.modeMats.push(em);
          p.engrave.material = em;
          p.engrave.visible = true;
        }
        lineMat.color.setHex(techLine);
        lineMat.opacity = 1;
        lineMat.transparent = false;
        lineMat.depthTest = true;
        lineMat.depthFunc = THREE.LessEqualDepth;
        p.outline.renderOrder = 1;
      } else if (mode === 'blueprint') {
        const mat = new THREE.MeshBasicMaterial({
          colorWrite: false,
          depthWrite: true,
          depthTest: true,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        });
        this.modeMats.push(mat);
        p.mesh.material = mat;
        p.mesh.castShadow = p.mesh.receiveShadow = false;
        if (p.engrave && p.engraveAlphaMap) {
          const em = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            alphaMap: p.engraveAlphaMap,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          });
          this.modeMats.push(em);
          p.engrave.material = em;
          p.engrave.visible = true;
        }
        lineMat.color.setHex(0xffffff);
        lineMat.opacity = 0.95;
        lineMat.transparent = true;
        lineMat.depthTest = true;
        lineMat.depthFunc = THREE.LessEqualDepth;
        p.outline.renderOrder = 1;
        if (!p.hiddenOutline) {
          p.hiddenOutline = new THREE.LineSegments(
            p.outline.geometry,
            new THREE.LineDashedMaterial({
              color: 0xffffff,
              dashSize: dashStep,
              gapSize: dashStep * 0.65,
              transparent: true,
              opacity: 0.35,
              depthTest: true,
              depthFunc: THREE.GreaterDepth,
              depthWrite: false,
            }),
          );
          p.hiddenOutline.computeLineDistances();
          p.hiddenOutline.renderOrder = 2;
          p.mesh.add(p.hiddenOutline);
        } else {
          const hm = p.hiddenOutline.material as THREE.LineDashedMaterial;
          hm.dashSize = dashStep;
          hm.gapSize = dashStep * 0.65;
          hm.needsUpdate = true;
        }
        p.hiddenOutline.visible = true;
      } else {
        // wireframe
        const mat = new THREE.MeshBasicMaterial({
          colorWrite: false,
          depthWrite: false,
          depthTest: false,
        });
        this.modeMats.push(mat);
        p.mesh.material = mat;
        p.mesh.castShadow = p.mesh.receiveShadow = false;
        if (p.engrave && p.engraveAlphaMap) {
          const em = new THREE.MeshBasicMaterial({
            color: techLine,
            alphaMap: p.engraveAlphaMap,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            depthTest: false,
            side: THREE.DoubleSide,
          });
          this.modeMats.push(em);
          p.engrave.material = em;
          p.engrave.visible = true;
        }
        lineMat.color.setHex(techLine);
        lineMat.opacity = 0.85;
        lineMat.transparent = true;
        lineMat.depthTest = false;
        lineMat.depthFunc = THREE.LessEqualDepth;
        p.outline.renderOrder = 1;
      }
      lineMat.needsUpdate = true;
    }
  }

  /** Mockup-Modus: ohne Raster, mit Schatten und eigenem Hintergrund (für Bilder für Kunden) */
  setMockup(on: boolean, bg: MockupBg) {
    this.mockup = on;
    this.mockupBg = bg;
    this.applyMockup();
    this.applyTheme();
    this.layout();
  }

  private applyMockup() {
    if (this.grid) this.grid.visible = !this.mockup && this.renderMode !== 'blueprint';
    if (this.ground) this.ground.visible = this.mockup && this.renderMode !== 'blueprint';
    this.sun.castShadow = this.mockup && this.renderMode !== 'blueprint';
    if (this.ground) (this.ground.material as THREE.ShadowMaterial).opacity = this.mockupBg === 'dark' ? 0.5 : 0.28;
    // Sonne und Schattenbereich passend zu den Teilen (auch auseinandergezogen)
    const b = this.bounds();
    if (!b.isEmpty()) {
      const c = b.getCenter(new THREE.Vector3());
      const r = Math.max(b.getBoundingSphere(new THREE.Sphere()).radius * (1 + this.explode), 10);
      this.sun.target.position.copy(c);
      // Im Mockup kommt das Licht von vorne links, damit die Schatten sichtbar nach hinten rechts fallen
      const dir = this.mockup ? new THREE.Vector3(-1.1, -0.5, 1.5) : new THREE.Vector3(0.8, -1.2, 2);
      this.sun.position.copy(c).add(dir.normalize().multiplyScalar(r * 3));
      const cam = this.sun.shadow.camera;
      cam.left = cam.bottom = -r * 1.3;
      cam.right = cam.top = r * 1.3;
      cam.near = r * 0.5;
      cam.far = r * 6;
      cam.updateProjectionMatrix();
    }
    this.needsRender = true;
  }

  private setupOrtho(vp: BlueprintViewport, center: THREE.Vector3, size: THREE.Vector3, pxPerMm: number, dist: number) {
    const hw = vp.w / (2 * pxPerMm);
    const hh = vp.h / (2 * pxPerMm);
    this.orthoCam.left = -hw;
    this.orthoCam.right = hw;
    this.orthoCam.top = hh;
    this.orthoCam.bottom = -hh;
    this.orthoCam.near = 0.1;
    this.orthoCam.far = dist * 4 + Math.max(size.x, size.y, size.z);
    if (vp.id === 'front') {
      this.orthoCam.position.set(center.x, center.y - dist, center.z);
      this.orthoCam.up.set(0, 0, 1);
    } else if (vp.id === 'top') {
      this.orthoCam.position.set(center.x, center.y, center.z + dist);
      this.orthoCam.up.set(0, 1, 0);
    } else {
      this.orthoCam.position.set(center.x + dist, center.y, center.z);
      this.orthoCam.up.set(0, 0, 1);
    }
    this.orthoCam.lookAt(center);
    this.orthoCam.updateProjectionMatrix();
    this.orthoCam.updateMatrixWorld();
  }

  private renderFrame(w: number, h: number, overlayCtx?: CanvasRenderingContext2D | null, overlayScale = 1) {
    if (this.renderMode !== 'blueprint') {
      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, w, h);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const layout = computeBlueprintLayout(w, h);
    const b = this.bounds();
    const empty = b.isEmpty();
    const size = empty ? null : b.getSize(new THREE.Vector3());
    const center = empty ? new THREE.Vector3() : b.getCenter(new THREE.Vector3());
    const pxPerMm = size ? computeOrthoScale(size, layout) : 1;
    const dist = (size ? size.length() : 100) * 2 + 100;

    const renderVp = (vp: BlueprintViewport, cam: THREE.Camera) => {
      const vy = h - vp.y - vp.h;
      this.renderer.setViewport(vp.x, vy, vp.w, vp.h);
      this.renderer.setScissor(vp.x, vy, vp.w, vp.h);
      this.renderer.render(this.scene, cam);
    };

    const isoAspect = layout.iso.w / Math.max(1, layout.iso.h);
    if (Math.abs(this.camera.aspect - isoAspect) > 1e-4) {
      this.camera.aspect = isoAspect;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.setScissorTest(true);
    renderVp(layout.iso, this.camera);
    if (size) {
      for (const vp of [layout.front, layout.top, layout.side]) {
        this.setupOrtho(vp, center, size, pxPerMm, dist);
        renderVp(vp, this.orthoCam);
      }
    } else {
      // Leere Szene: untere Bereiche ebenfalls mit Hintergrundfarbe füllen
      for (const vp of [layout.front, layout.top, layout.side]) renderVp(vp, this.orthoCam);
    }
    this.renderer.setScissorTest(false);

    if (overlayCtx) {
      overlayCtx.save();
      overlayCtx.setTransform(overlayScale, 0, 0, overlayScale, 0, 0);
      drawBlueprintOverlay(overlayCtx, w, h, layout, size, pxPerMm, this.blueprintLabels);
      overlayCtx.restore();
    }
  }

  /** Aktuelle Ansicht als PNG (data:-URL) in scale-facher Auflösung */
  snapshot(scale = 2): string {
    const w = Math.max(1, this.host.clientWidth),
      h = Math.max(1, this.host.clientHeight);
    const pr = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(scale);
    this.renderer.setSize(w, h, false);
    this.renderFrame(w, h);
    let url: string;
    if (this.renderMode === 'blueprint') {
      const tmp = document.createElement('canvas');
      tmp.width = Math.max(1, Math.round(w * scale));
      tmp.height = Math.max(1, Math.round(h * scale));
      const ctx = tmp.getContext('2d')!;
      ctx.drawImage(this.renderer.domElement, 0, 0, tmp.width, tmp.height);
      const layout = computeBlueprintLayout(w, h);
      const b = this.bounds();
      const size = b.isEmpty() ? null : b.getSize(new THREE.Vector3());
      const pxPerMm = size ? computeOrthoScale(size, layout) : 1;
      ctx.scale(scale, scale);
      drawBlueprintOverlay(ctx, w, h, layout, size, pxPerMm, this.blueprintLabels);
      url = tmp.toDataURL('image/png');
    } else {
      url = this.renderer.domElement.toDataURL('image/png');
    }
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.needsRender = true;
    return url;
  }

  private bounds() {
    const b = new THREE.Box3();
    for (const p of this.parts) b.union(new THREE.Box3().setFromObject(p.holder));
    return b;
  }

  /** Teile auseinanderziehen (0 = zusammengesteckt, 1 = um die eigene Ausdehnung der Baugruppe) */
  setExplode(k: number) {
    this.explode = k;
    this.layout();
  }

  setSpin(on: boolean) {
    this.spin = on;
    this.last = performance.now();
    this.layout();
  }

  setShowOverlaps(on: boolean) {
    this.showOverlaps = on;
    this.layout();
  }

  private layout() {
    for (const p of this.parts) {
      p.holder.position.copy(p.away).multiplyScalar(this.explode);
      if (p.s.spin) p.mesh.matrix.copy(poseMatrix(this.angle ? rotatePose(p.s.pose, this.angle * p.s.spin) : p.s.pose));
    }
    if (this.mockup && !this.spin) this.applyMockup();
    // Die roten Bereiche gehören zur zusammengesteckten, ruhenden Lage
    this.overlapGroup.visible = this.showOverlaps && !this.mockup && this.explode === 0 && this.angle === 0;
    this.needsRender = true;
  }

  view(preset: ViewPreset) {
    const b = this.bounds();
    if (b.isEmpty()) return;
    const sphere = b.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1);
    const dir = preset === 'top' ? new THREE.Vector3(0, -0.0001, 1) : preset === 'front' ? new THREE.Vector3(0, -1, 0.0001) : new THREE.Vector3(0.9, -1.5, 1.1);
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * (this.camera.aspect < 1 ? 1.15 / this.camera.aspect : 1.15);
    this.camera.position.copy(sphere.center).addScaledVector(dir.normalize(), dist);
    this.camera.near = Math.max(0.01, dist / 1000);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(sphere.center);
    this.controls.update();
    this.needsRender = true;
  }

  /** Zeichnen nur, solange das Fenster zu sehen ist */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (!on) return;
    this.needsRender = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.active) return;
      if (!this.isVisible()) {
        this.active = false;
        return;
      }
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.spin) {
        this.angle += dt * 0.6;
        this.layout();
      } else if (this.angle) {
        this.angle = 0;
        this.layout();
      }
      this.controls.update();
      if (this.needsRender) {
        this.needsRender = false;
        const w = Math.max(1, this.host.clientWidth),
          h = Math.max(1, this.host.clientHeight);
        this.renderFrame(w, h, this.overlay.getContext('2d'), this.renderer.getPixelRatio());
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private hover(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let cam: THREE.Camera = this.camera;
    let ndcX = (px / r.width) * 2 - 1;
    let ndcY = -(py / r.height) * 2 + 1;
    if (this.renderMode === 'blueprint') {
      const layout = computeBlueprintLayout(r.width, r.height);
      const vp = [layout.iso, layout.front, layout.top, layout.side].find((v) => px >= v.x && px <= v.x + v.w && py >= v.y && py <= v.y + v.h);
      if (!vp) {
        this.onHover(null);
        return;
      }
      ndcX = ((px - vp.x) / Math.max(1, vp.w)) * 2 - 1;
      ndcY = -((py - vp.y) / Math.max(1, vp.h)) * 2 + 1;
      if (vp.id !== 'iso') {
        const b = this.bounds();
        if (b.isEmpty()) {
          this.onHover(null);
          return;
        }
        const size = b.getSize(new THREE.Vector3());
        this.setupOrtho(vp, b.getCenter(new THREE.Vector3()), size, computeOrthoScale(size, layout), size.length() * 2 + 100);
        cam = this.orthoCam;
      }
    }
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), cam);
    const hit = this.raycaster.intersectObjects(this.parts.map((x) => x.mesh), false)[0];
    this.onHover(hit ? String(hit.object.userData.label) : null);
  }

  dispose() {
    this.active = false;
    this.clear();
    this.resize.disconnect();
    this.themeObs.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
  }
}
