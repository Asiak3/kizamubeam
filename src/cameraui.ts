// Kamera-Oberfläche: Tab im Laser-Panel, Kamerabilder auf der Arbeitsfläche und Kalibrier-Assistent.
// Je Gerät gibt es eine Liste von Kameras, die gleichzeitig verbunden und eingeblendet sein können: feste Kameras
// über dem Bett und Kopfkameras, die mit dem Laserkopf fahren. Kopfkameras setzen ihre Bilder zu einem Mosaik
// zusammen, Bild für Bild an der jeweiligen Kopfposition oder per „Bereich erfassen“ in einem Rutsch.
import type { Editor } from './editor';
import { h, numInput } from './dom';
import { ICONS } from './icons';
import { saveText } from './files';
import { defaultLayer, loadDoc, Obj, Pt, translate } from './model';
import { buildJob, estimate, FIRMWARES, writeGCode } from './gcode';
import { machine } from './machine';
import { device, onDeviceChange } from './laser';
import {
  bedToPixel, buildRemap, buildRemapRect, calibFits, calibrate, CameraCalib, cameraError, CameraMount, CameraSettings,
  CameraStream, coverRect, DEFAULT_CAMERA, footprint, headMarkRect, headShift, markPositionsIn, MarkSettings,
  NETCAM_EXAMPLES, Rect, Remap, warp,
} from './camera';
import { dec, t, tn } from './i18n';
import { openWorkpieceDialog } from './workpieceDialog';

// ---------- Einstellungen je Gerät ----------

interface DeviceCams {
  cams: CameraSettings[];
  /** Im Tab gewählte Kamera */
  cur: number;
}

const STORE_KEY = 'kizamubeam.camera';
const newCamId = () => Math.random().toString(36).slice(2, 10);
/** Fehlende Felder ergänzen (ältere Einstellungen) */
function fill(s: Partial<CameraSettings>, i: number): CameraSettings {
  const c: CameraSettings = { ...structuredClone(DEFAULT_CAMERA), ...s };
  c.marks = { ...DEFAULT_CAMERA.marks, ...(s.marks ?? {}) };
  if (!c.id) c.id = newCamId();
  if (!c.name) c.name = t('Kamera {i}', { i: i + 1 });
  if (c.mount !== 'head') c.mount = 'fixed';
  return c;
}
let store: Record<string, DeviceCams> = {};
try {
  const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as Record<string, unknown>;
  for (const [id, v] of Object.entries(raw)) {
    if (!v || typeof v !== 'object') continue;
    const d = v as Partial<DeviceCams>;
    // Früher genau eine Kamera je Gerät: die alten Einstellungen werden zur ersten Kamera der Liste
    store[id] = Array.isArray(d.cams)
      ? { cams: d.cams.map(fill), cur: Number(d.cur) || 0 }
      : { cams: [fill(v as Partial<CameraSettings>, 0)], cur: 0 };
  }
} catch {
  /* leer */
}
/** Kameras des gewählten Geräts (Kalibrierungen gehören zur Maschine, an der die Kameras hängen) */
function devCams(): DeviceCams {
  let d = store[device.id];
  if (!d || !d.cams.length) d = store[device.id] = { cams: [fill({}, 0)], cur: 0 };
  d.cur = Math.max(0, Math.min(d.cams.length - 1, d.cur));
  return d;
}
const cfg = () => {
  const d = devCams();
  return d.cams[d.cur];
};
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* nicht speicherbar */
  }
}

const RESOLUTIONS: [number, number][] = [
  [640, 480],
  [1280, 720],
  [1920, 1080],
  [2592, 1944],
  [3264, 2448],
  [3840, 2160],
];

// ---------- Laserkopf ----------

/** Kopfposition (Werkstückkoordinaten, y nach oben), null = unbekannt */
function headPos(): Pt | null {
  const p = machine.connected ? machine.status.wpos : null;
  return p ? { x: p[0], y: p[1] } : null;
}
/** Seit wann der Kopf an der aktuellen Stelle steht */
let lastPos: Pt | null = null;
let lastMove = 0;
machine.on((e) => {
  if (e.type !== 'status' && e.type !== 'connection') return;
  const p = headPos();
  if (!p || !lastPos || Math.hypot(p.x - lastPos.x, p.y - lastPos.y) > 0.01) lastMove = performance.now();
  lastPos = p;
});
/** Steht der Kopf ruhig genug für ein Bild einer Kopfkamera? */
function headStill(ms = 500): boolean {
  const st = machine.status.state;
  return !!headPos() && !/^(Run|Jog|Home)/i.test(st) && performance.now() - lastMove > ms;
}

// ---------- Kameras und ihre Bilder auf dem Bett ----------

/** Pixel des Mosaiks einer Kopfkamera auf der längeren Bettseite */
const MOSAIC_PX = 2400;

class CamUnit {
  readonly stream = new CameraStream();
  /** Feste Kamera: entzerrtes Bild des ganzen Betts; Kopfkamera: Mosaik aller Aufnahmen */
  readonly overlay = document.createElement('canvas');
  ready = false;
  /** Kopfkamera: belegter Bereich des Mosaiks in Pixeln */
  covered: { i0: number; j0: number; i1: number; j1: number } | null = null;
  private remap: Remap | null = null;
  private remapKey = '';
  private foot: Rect | null = null;
  private footKey = '';
  private liveTimer = 0;
  /** Laufendes Abfahren eines Bereichs */
  scan: { stop: boolean } | null = null;
  /** Foto vom leeren Bett (wie overlay) als Hintergrund für die Werkstückerkennung, nur im Speicher */
  empty: HTMLCanvasElement | null = null;

  constructor(public s: CameraSettings) {}

  get head() {
    return this.s.mount === 'head';
  }

  /** Gültige Kalibrierung für das laufende Bild (Seitenverhältnis und Montage passen) */
  calib(): CameraCalib | null {
    const c = this.s.calib;
    const w = this.stream.width,
      hh = this.stream.height;
    if (!c || !w || !hh || !calibFits(c, w, hh) || this.head !== !!c.head) return null;
    return c;
  }

  /** Sichtbereich an der Kalibrierposition (nur Kopfkamera sinnvoll) */
  footprint(): Rect | null {
    const c = this.calib();
    if (!c) return null;
    const key = `${c.date}|${this.stream.width}x${this.stream.height}`;
    if (key !== this.footKey) ((this.foot = footprint(c, this.stream.width, this.stream.height)), (this.footKey = key));
    return this.foot;
  }

  async connect(ed: Editor) {
    const s = this.s;
    await this.stream.start(s.cam, s.width, s.height, s.url ?? '');
    // Gewählte Kamera merken (deviceId kann nach der ersten Freigabe erst feststehen)
    s.cam = this.stream.deviceId || s.cam;
    s.label = this.stream.label || s.label;
    save();
    // Belichtung braucht einen Moment
    setTimeout(() => (!this.head || headStill()) && this.update(ed), 600);
    this.setLive(ed);
  }

  disconnect(ed: Editor) {
    clearInterval(this.liveTimer);
    this.liveTimer = 0;
    if (this.scan) this.scan.stop = true;
    this.stream.stop();
    if (!this.head) this.ready = false;
    ed.redraw();
  }

  setLive(ed: Editor) {
    clearInterval(this.liveTimer);
    this.liveTimer = 0;
    const s = this.s;
    // Kopfkamera: nur bei stehendem Kopf, sonst landet ein verwischtes Bild an der falschen Stelle
    if (s.live && s.show && this.stream.open)
      this.liveTimer = window.setInterval(() => !this.scan && (!this.head || headStill()) && this.update(ed), 500);
  }

  /** Mosaik leeren */
  clear(ed: Editor) {
    this.overlay.getContext('2d')!.clearRect(0, 0, this.overlay.width, this.overlay.height);
    this.covered = null;
    this.ready = false;
    ed.redraw();
  }

  /** Neues Kamerabild holen und entzerrt aufs Bett legen; Kopfkamera: an der aktuellen Kopfposition ins Mosaik */
  update(ed: Editor): boolean {
    const frame = this.stream.grab();
    const c = this.calib();
    if (!frame || !c) return false;
    const src = frame.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, frame.width, frame.height);
    const { w: bw, h: bh } = ed.doc.bed;
    const o = this.overlay;
    if (!this.head) {
      const key = `${c.date}|${frame.width}x${frame.height}|${bw}x${bh}`;
      if (key !== this.remapKey) ((this.remap = buildRemap(c, frame.width, frame.height, bw, bh)), (this.remapKey = key));
      const r = this.remap!;
      if (o.width !== r.w || o.height !== r.h) ((o.width = r.w), (o.height = r.h));
      const octx = o.getContext('2d')!;
      const out = octx.createImageData(r.w, r.h);
      warp(src, r, out);
      octx.putImageData(out, 0, 0);
    } else {
      const pos = headPos();
      const f = this.footprint();
      if (!pos || !f) return false;
      // Mosaik in Bettgröße; bei geänderter Bettgröße neu anfangen
      const k = Math.max(bw, bh) / MOSAIC_PX;
      const W = Math.max(1, Math.round(bw / k)),
        H = Math.max(1, Math.round(bh / k));
      if (o.width !== W || o.height !== H) ((o.width = W), (o.height = H), (this.covered = null));
      const kx = bw / W,
        ky = bh / H;
      const sh = headShift(c, pos);
      const clampI = (v: number, n: number) => Math.max(0, Math.min(n, v));
      const i0 = clampI(Math.floor((f.x0 + sh.x) / kx), W),
        i1 = clampI(Math.ceil((f.x1 + sh.x) / kx), W);
      const j0 = clampI(Math.floor((bh - (f.y1 + sh.y)) / ky), H),
        j1 = clampI(Math.ceil((bh - (f.y0 + sh.y)) / ky), H);
      if (i1 <= i0 || j1 <= j0) return false;
      const rect: Rect = { x0: i0 * kx, x1: i1 * kx, y0: bh - j1 * ky, y1: bh - j0 * ky };
      const r = buildRemapRect(c, frame.width, frame.height, rect, Math.min(kx, ky), sh);
      const tile = document.createElement('canvas');
      tile.width = r.w;
      tile.height = r.h;
      const tctx = tile.getContext('2d')!;
      const out = tctx.createImageData(r.w, r.h);
      warp(src, r, out);
      tctx.putImageData(out, 0, 0);
      // Übereinanderlegen: Pixel außerhalb des Kamerabilds sind durchsichtig und lassen das Mosaik stehen
      o.getContext('2d')!.drawImage(tile, i0, j0, i1 - i0, j1 - j0);
      const cv = this.covered;
      this.covered = cv
        ? { i0: Math.min(cv.i0, i0), j0: Math.min(cv.j0, j0), i1: Math.max(cv.i1, i1), j1: Math.max(cv.j1, j1) }
        : { i0, j0, i1, j1 };
    }
    this.ready = true;
    ed.redraw();
    return true;
  }

  /** Bild zum Einfügen: Bettbereich (Weltkoordinaten) und Bilddaten */
  snapshot(ed: Editor): { x: number; y: number; w: number; h: number; url: string } | null {
    const { w: bw, h: bh } = ed.doc.bed;
    if (!this.head) return this.update(ed) ? { x: 0, y: 0, w: bw, h: bh, url: this.overlay.toDataURL('image/png') } : null;
    const cv = this.covered;
    if (!this.ready || !cv) return null;
    const kx = bw / this.overlay.width,
      ky = bh / this.overlay.height;
    const c = document.createElement('canvas');
    c.width = cv.i1 - cv.i0;
    c.height = cv.j1 - cv.j0;
    c.getContext('2d')!.drawImage(this.overlay, cv.i0, cv.j0, c.width, c.height, 0, 0, c.width, c.height);
    return { x: cv.i0 * kx, y: cv.j0 * ky, w: c.width * kx, h: c.height * ky, url: c.toDataURL('image/png') };
  }

  /**
   * Kopfkamera: Bereich r (Bettkoordinaten) in Bahnen abfahren und an jeder Stelle ein Bild ins Mosaik legen.
   * progress(i, n) meldet den Fortschritt; Rückgabe: Fehlermeldung oder ''.
   */
  async scanArea(ed: Editor, r: Rect, progress: (i: number, n: number) => void): Promise<string> {
    const c = this.calib();
    if (!c || !c.head) return t('Kopfkamera nicht kalibriert.');
    if (!machine.connected) return t('Nicht verbunden.');
    if (machine.running) return t('Es läuft bereits ein Auftrag.');
    if (!headPos()) return t('Die aktuelle Position ist noch nicht bekannt.');
    const cov = coverRect(c, this.stream.width, this.stream.height);
    const cw = cov.x1 - cov.x0,
      ch = cov.y1 - cov.y0;
    if (!(cw > 1 && ch > 1)) return t('Das Sichtfeld der Kamera ist zu klein.');
    // Linke untere Ecke des lückenlos sichtbaren Bereichs relativ zum Kopf
    const off = { x: cov.x0 - c.head.x, y: cov.y0 - c.head.y };
    // 15 % Überlappung, die Bilder gleichmäßig über den Bereich verteilt
    const lay = (a0: number, a1: number, size: number) => {
      const span = a1 - a0;
      if (span <= size) return [a0 + (span - size) / 2];
      const n = Math.ceil((span - size) / (size * 0.85)) + 1;
      return Array.from({ length: n }, (_, i) => a0 + ((span - size) * i) / (n - 1));
    };
    const xs = lay(r.x0, r.x1, cw),
      ys = lay(r.y0, r.y1, ch).reverse();
    const { w: bw, h: bh } = ed.doc.bed;
    const pts: Pt[] = [];
    ys.forEach((y, j) => (j % 2 ? [...xs].reverse() : xs).forEach((x) => pts.push({
      x: Math.max(0, Math.min(bw, x - off.x)),
      y: Math.max(0, Math.min(bh, y - off.y)),
    })));
    const scan = (this.scan = { stop: false });
    try {
      await machine.send('G90');
      for (let i = 0; i < pts.length; i++) {
        if (scan.stop) return t('Abgebrochen.');
        progress(i, pts.length);
        const p = pts[i];
        await machine.send(`G0 X${p.x.toFixed(2)} Y${p.y.toFixed(2)}`);
        // Warten, bis der Kopf angekommen ist und ruhig steht
        const t0 = performance.now();
        for (;;) {
          await new Promise((res) => setTimeout(res, 100));
          if (scan.stop) return t('Abgebrochen.');
          if (!machine.connected || !this.stream.open) return t('Verbindung getrennt.');
          if (machine.running) return t('Es läuft bereits ein Auftrag.');
          const q = headPos();
          if (q && Math.hypot(q.x - p.x, q.y - p.y) < 0.2 && headStill(300)) break;
          if (performance.now() - t0 > 60000) return t('Der Laserkopf hat die Position nicht erreicht.');
        }
        await this.stream.freshFrames(3);
        this.update(ed);
      }
      progress(pts.length, pts.length);
      return '';
    } finally {
      this.scan = null;
    }
  }
}

const units = new Map<string, CamUnit>();
function unit(s: CameraSettings): CamUnit {
  let u = units.get(s.id);
  if (!u) units.set(s.id, (u = new CamUnit(s)));
  u.s = s;
  return u;
}
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

/** Kameras eines anderen Geräts trennen: ihre Kalibrierung gilt dort nicht */
function dropOtherDevices(ed: Editor) {
  const mine = new Set(devCams().cams.map((s) => s.id));
  for (const [id, u] of units)
    if (!mine.has(id)) {
      u.disconnect(ed);
      units.delete(id);
    }
}

/**
 * Kamerabild für die Auswertung eines Materialtests, von der gewählten Kamera zuerst. Kalibrierte Kameras liefern
 * das entzerrte Bettbild samt gezeigtem Bereich (Dokument-mm), andere das Rohbild (view = null).
 * null, wenn keine Kamera verbunden ist.
 */
export function cameraPhoto(ed: Editor): { url: string; view: { x: number; y: number; w: number; h: number } | null } | null {
  const d = devCams();
  const order = [d.cams[d.cur], ...d.cams.filter((_, i) => i !== d.cur)];
  for (const s of order) {
    const u = units.get(s.id);
    if (!u?.stream.open) continue;
    const snap = u.calib() ? u.snapshot(ed) : null;
    if (snap) return { url: snap.url, view: { x: snap.x, y: snap.y, w: snap.w, h: snap.h } };
    const g = u.stream.grab();
    if (g) return { url: g.toDataURL('image/png'), view: null };
  }
  return null;
}

/** Kamerabild auf dem Bett für die Werkstückerkennung */
export interface CameraView {
  id: string;
  name: string;
  head: boolean;
  /** Entzerrtes Bild in Bettgröße (Welt 0 … Bettbreite/-höhe), durchsichtig außerhalb des Kamerabilds */
  image: HTMLCanvasElement | null;
  /** Neues Bild holen (Kopfkamera: an der aktuellen Kopfposition ins Mosaik) */
  refresh(): boolean;
  empty: HTMLCanvasElement | null;
  /** Aktuelles Bild als Foto vom leeren Bett merken (null = vergessen) */
  setEmpty(keep: boolean): void;
}

/** Verbundene oder schon aufgenommene, kalibrierte Kameras des aktuellen Geräts */
export function cameraViews(ed: Editor): CameraView[] {
  return devCams().cams.flatMap((s) => {
    const u = units.get(s.id);
    if (!u || !s.calib || (!u.ready && !u.stream.open)) return [];
    return [{
      id: s.id,
      name: s.name,
      head: u.head,
      get image() {
        return u.ready ? u.overlay : null;
      },
      refresh: () => u.update(ed),
      get empty() {
        return u.empty;
      },
      setEmpty(keep: boolean) {
        if (!keep || !u.ready) return void (u.empty = null);
        const c = document.createElement('canvas');
        c.width = u.overlay.width;
        c.height = u.overlay.height;
        c.getContext('2d')!.drawImage(u.overlay, 0, 0);
        u.empty = c;
      },
    }];
  });
}

// ---------- Tab im Laser-Panel ----------

export function cameraTab(ed: Editor): HTMLElement {
  ed.background = (ctx) => {
    const { w: bw, h: bh } = ed.doc.bed;
    const cams = devCams().cams;
    for (const s of cams) {
      const u = units.get(s.id);
      if (!u || !s.show || !u.ready || !s.calib) continue;
      ctx.globalAlpha = s.opacity;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(u.overlay, 0, 0, bw, bh);
    }
    ctx.globalAlpha = 1;
    // Sichtfeld der Kopfkameras an der aktuellen Kopfposition
    const pos = headPos();
    if (!pos) return;
    const px = (window.devicePixelRatio || 1) / ctx.getTransform().a;
    for (const s of cams) {
      const u = units.get(s.id);
      const c = u?.calib();
      const f = u?.footprint();
      if (!u || !s.show || !c || !f) continue;
      const sh = headShift(c, pos);
      ctx.strokeStyle = 'rgba(0,150,255,0.9)';
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.strokeRect(f.x0 + sh.x, bh - (f.y1 + sh.y), f.x1 - f.x0, f.y1 - f.y0);
      ctx.setLineDash([]);
    }
  };

  const root = h('div', { class: 'camera-tab' });
  const listSel = h('select', { title: t('Kameras dieses Geräts') }) as HTMLSelectElement;
  const addBtn = h('button', { class: 'ib small', title: t('Kamera hinzufügen'), }, '+') as HTMLButtonElement;
  const delBtn = h('button', { class: 'ib small', title: t('Kamera entfernen'), html: ICONS.delete }) as HTMLButtonElement;
  const nameIn = h('input', { type: 'text', title: t('Name der Kamera') }) as HTMLInputElement;
  const mountSel = h('select', { title: t('Wo die Kamera sitzt') },
    h('option', { value: 'fixed' }, t('Fest über dem Bett')),
    h('option', { value: 'head' }, t('Am Laserkopf (Kopfkamera)')),
  ) as HTMLSelectElement;
  const camSel = h('select', { title: t('Kamera') }) as HTMLSelectElement;
  const resSel = h('select', { title: t('Gewünschte Auflösung (die Kamera nimmt die nächstmögliche)') }) as HTMLSelectElement;
  /** option value of the network camera in the camera list */
  const NET = '__net__';
  const urlList = h('datalist', { id: 'netcam-urls' }, ...NETCAM_EXAMPLES.map((u) => h('option', { value: u })));
  const urlIn = h('input', {
    type: 'url',
    list: 'netcam-urls',
    style: 'grid-column: 1 / -1',
    spellcheck: false,
    placeholder: NETCAM_EXAMPLES[0],
    title: t('MJPEG-Stream oder Einzelbild über http://, z. B. ESP32-CAM (Port 81, /stream) oder die KizamuBeam Virtual Machine (Port 8282, /stream)'),
  }) as HTMLInputElement;
  const urlLbl = h('label', {}, t('Adresse'));
  const resLbl = h('label', {}, t('Auflösung'));
  const connBtn = h('button', { class: 'btn' }, t('Verbinden')) as HTMLButtonElement;
  const dot = h('span', { class: 'dot' });
  const stTxt = h('span', {});
  const calTxt = h('div', { class: 'note' });
  const msg = h('div', { class: 'note' });
  const preview = h('div', { class: 'camera-preview' });
  const show = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const live = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const liveLbl = h('label', { class: 'check' }, live, t('Laufend aktualisieren'));
  const opacity = h('input', { type: 'range', min: '0.1', max: '1', step: '0.05' }) as HTMLInputElement;
  const updBtn = h('button', { class: 'btn' }, t('Bild aktualisieren')) as HTMLButtonElement;
  const calBtn = h('button', { class: 'btn', title: t('Linse und Lage der Kamera mit gelaserten Markierungen bestimmen') }, t('Kalibrieren …')) as HTMLButtonElement;
  const insBtn = h('button', { class: 'btn', title: t('Entzerrtes Kamerabild als Bildobjekt einfügen, z. B. zum Nachzeichnen') }, t('Als Bild einfügen')) as HTMLButtonElement;
  const scanBtn = h('button', { class: 'btn' }, t('Bereich erfassen')) as HTMLButtonElement;
  const clearBtn = h('button', { class: 'btn', title: t('Alle Aufnahmen der Kopfkamera von der Arbeitsfläche nehmen') }, t('Mosaik leeren')) as HTMLButtonElement;
  const headRow = h('div', { class: 'conn-row' }, scanBtn, clearBtn);

  const say = (text: string, error = false) => {
    msg.textContent = text;
    msg.classList.toggle('error', error);
  };
  const cur = () => unit(cfg());

  const loadCams = async () => {
    const s = cfg();
    let list: MediaDeviceInfo[] = [];
    try {
      list = await CameraStream.list();
    } catch {
      /* keine Liste */
    }
    camSel.textContent = '';
    if (!list.length) camSel.append(h('option', { value: s.cam }, s.label || t('Standardkamera')));
    list.forEach((d, i) =>
      camSel.append(h('option', { value: d.deviceId, selected: !s.url && (d.deviceId === s.cam || (!!s.label && d.label === s.label)) }, d.label || t('Kamera {i}', { i: i + 1 }))),
    );
    camSel.append(h('option', { value: NET, selected: !!s.url }, t('Netzwerk-Kamera (Adresse)')));
  };
  RESOLUTIONS.forEach(([w, hh]) => resSel.append(h('option', { value: `${w}x${hh}` }, `${w} × ${hh}`)));

  const refresh = () => {
    const d = devCams();
    const s = cfg();
    const u = cur();
    const cam = u.stream;
    listSel.textContent = '';
    d.cams.forEach((c, i) => {
      const open = units.get(c.id)?.stream.open;
      listSel.append(h('option', { value: String(i), selected: i === d.cur }, open ? t('{name} (verbunden)', { name: c.name }) : c.name));
    });
    delBtn.disabled = d.cams.length < 2;
    if (document.activeElement !== nameIn) nameIn.value = s.name;
    mountSel.value = s.mount;
    resSel.value = `${s.width}x${s.height}`;
    // network camera: address instead of resolution (the camera sends its own size)
    const net = !!s.url;
    urlLbl.hidden = urlIn.hidden = !net;
    resLbl.hidden = resSel.hidden = net;
    if (document.activeElement !== urlIn) urlIn.value = s.url ?? '';
    show.checked = s.show;
    live.checked = s.live;
    opacity.value = String(s.opacity);
    connBtn.textContent = cam.open ? t('Trennen') : t('Verbinden');
    dot.className = `dot ${cam.open ? 'ok' : ''}`;
    stTxt.textContent = cam.open ? t('Verbunden, {width} × {height}', { width: cam.width, height: cam.height }) : t('Nicht verbunden');
    if (preview.firstChild !== cam.view) preview.replaceChildren(cam.view);
    preview.hidden = !cam.open;
    const c = s.calib;
    if (!c) calTxt.textContent = t('Nicht kalibriert. Ohne Kalibrierung erscheint das Bild nicht auf der Arbeitsfläche.');
    else if (u.head !== !!c.head)
      calTxt.textContent = u.head
        ? t('Die Kalibrierung stammt von einer festen Kamera. Als Kopfkamera bitte neu kalibrieren.')
        : t('Die Kalibrierung stammt von einer Kopfkamera. Als feste Kamera bitte neu kalibrieren.');
    else if (cam.open && !calibFits(c, cam.width, cam.height))
      calTxt.textContent = t('Kalibriert für {w} × {h}, die Kamera liefert {width} × {height}. Bitte dieselbe Auflösung wählen oder neu kalibrieren.', { w: c.w, h: c.h, width: cam.width, height: cam.height });
    else
      calTxt.textContent = t('Kalibriert und ausgerichtet (Restfehler ⌀ {err} mm, max. {maxErr} mm).', { err: dec(c.err.toFixed(2)), maxErr: dec(c.maxErr.toFixed(2)) });
    const ok = !!u.calib();
    updBtn.title = u.head
      ? t('Bild an der aktuellen Kopfposition aufnehmen und ins Mosaik legen')
      : t('Neues Kamerabild auf die Arbeitsfläche legen');
    updBtn.disabled = !ok;
    insBtn.disabled = !ok || (u.head && !u.covered);
    calBtn.disabled = !cam.open;
    liveLbl.title = u.head
      ? t('Zweimal pro Sekunde ein Bild aufnehmen, wenn der Laserkopf steht')
      : t('Zweimal pro Sekunde ein neues Bild holen');
    headRow.hidden = !u.head;
    scanBtn.textContent = u.scan ? t('Erfassen abbrechen') : ed.sel.length ? t('Auswahl erfassen') : t('Bett erfassen');
    scanBtn.title = t('Den Laserkopf über den Bereich fahren und an jeder Stelle ein Bild aufnehmen (ohne Laser)');
    scanBtn.disabled = !u.scan && (!ok || !machine.connected || machine.running);
    clearBtn.disabled = !u.covered;
  };
  listeners.add(refresh);
  ed.on((w) => w === 'sel' && !headRow.hidden && refresh());
  machine.on((e) => e.type !== 'line' && e.type !== 'status' && refresh());
  onDeviceChange(() => {
    dropOtherDevices(ed);
    loadCams();
    changed();
    ed.redraw();
  });

  listSel.addEventListener('change', () => {
    devCams().cur = Number(listSel.value);
    save();
    say('');
    loadCams();
    changed();
  });
  addBtn.addEventListener('click', () => {
    const d = devCams();
    const s = fill({}, d.cams.length);
    d.cams.push(s);
    d.cur = d.cams.length - 1;
    save();
    say('');
    loadCams();
    changed();
  });
  delBtn.addEventListener('click', () => {
    const d = devCams();
    if (d.cams.length < 2) return;
    const s = cfg();
    if (!confirm(t('Kamera „{name}“ mit ihrer Kalibrierung entfernen?', { name: s.name }))) return;
    const u = units.get(s.id);
    if (u) (u.disconnect(ed), units.delete(s.id));
    d.cams.splice(d.cur, 1);
    d.cur = Math.min(d.cur, d.cams.length - 1);
    save();
    loadCams();
    changed();
    ed.redraw();
  });
  nameIn.addEventListener('change', () => {
    const v = nameIn.value.trim();
    if (v) cfg().name = v;
    save();
    changed();
  });
  mountSel.addEventListener('change', () => {
    const s = cfg();
    const u = cur();
    s.mount = mountSel.value as CameraMount;
    save();
    u.clear(ed);
    u.setLive(ed);
    changed();
  });
  camSel.addEventListener('change', async () => {
    const s = cfg();
    if (camSel.value === NET) {
      s.url = s.url || urlIn.value.trim() || NETCAM_EXAMPLES[0];
    } else {
      s.url = '';
      s.cam = camSel.value;
      s.label = camSel.selectedOptions[0]?.textContent ?? '';
    }
    save();
    refresh();
    if (cur().stream.open) await reconnect();
  });
  urlIn.addEventListener('change', async () => {
    const s = cfg();
    s.url = urlIn.value.trim() || NETCAM_EXAMPLES[0];
    save();
    if (cur().stream.open) await reconnect();
  });
  resSel.addEventListener('change', async () => {
    const [w, hh] = resSel.value.split('x').map(Number);
    const s = cfg();
    s.width = w;
    s.height = hh;
    save();
    if (cur().stream.open) await reconnect();
  });
  const reconnect = async () => {
    const u = cur();
    say(t('Verbinde …'));
    try {
      await u.connect(ed);
      say('');
      await loadCams();
    } catch (e) {
      u.disconnect(ed);
      say(cameraError(e), true);
    }
    changed();
  };
  connBtn.addEventListener('click', async () => {
    const u = cur();
    if (u.stream.open) {
      u.disconnect(ed);
      changed();
    } else await reconnect();
  });
  show.addEventListener('change', () => {
    cfg().show = show.checked;
    save();
    cur().setLive(ed);
    ed.redraw();
  });
  live.addEventListener('change', () => {
    cfg().live = live.checked;
    save();
    cur().setLive(ed);
  });
  opacity.addEventListener('input', () => {
    cfg().opacity = Number(opacity.value);
    save();
    ed.redraw();
  });
  updBtn.addEventListener('click', () => {
    const u = cur();
    if (u.head && !headPos()) say(t('Für die Kopfkamera muss der Laser verbunden und seine Position bekannt sein.'), true);
    else if (u.head && !headStill(0)) say(t('Der Laserkopf fährt gerade. Bitte warten, bis er steht.'), true);
    else if (!u.update(ed)) say(u.head ? t('Kein Bild: Liegt das Sichtfeld der Kamera auf dem Bett?') : t('Kein Bild: Kamera verbunden und kalibriert?'), true);
    else if (!cfg().show) say(t('Das Kamerabild ist ausgeblendet („Auf der Arbeitsfläche zeigen“).'));
    else say('');
    changed();
  });
  calBtn.addEventListener('click', () => openCalibration(ed, cur()));
  insBtn.addEventListener('click', async () => {
    const u = cur();
    const snap = u.snapshot(ed);
    if (!snap) return void say(t('Noch kein Kamerabild auf der Arbeitsfläche.'), true);
    // Auf den Werkzeug-Layer T1: wird nicht gelasert
    await ed.importImageAt(snap.url, snap.x, snap.y, snap.w, snap.h, t('Kamerabild'),
      t('Kamerabild auf Layer T1 eingefügt (wird nicht gelasert). Zum Nachzeichnen: Werkzeuge › Bild nachzeichnen (Alt+T).'), 30);
  });
  scanBtn.addEventListener('click', async () => {
    const u = cur();
    if (u.scan) return void (u.scan.stop = true);
    const { w: bw, h: bh } = ed.doc.bed;
    const b = ed.selBounds();
    // Auswahl in Bettkoordinaten (y nach oben), sonst das ganze Bett
    const r: Rect = b && ed.sel.length
      ? { x0: Math.max(0, b.x), x1: Math.min(bw, b.x + b.w), y0: Math.max(0, bh - b.y - b.h), y1: Math.min(bh, bh - b.y) }
      : { x0: 0, y0: 0, x1: bw, y1: bh };
    if (!cfg().show) ((cfg().show = true), save());
    const p = u.scanArea(ed, r, (i, n) => say(t('Bild {i} von {n} …', { i: Math.min(i + 1, n), n })));
    changed();
    const err = await p;
    say(err || t('Bereich erfasst.'), !!err && err !== t('Abgebrochen.'));
    changed();
  });
  clearBtn.addEventListener('click', () => (cur().clear(ed), changed()));

  root.append(
    h('div', { class: 'conn-row' }, listSel, addBtn, delBtn),
    h('div', { class: 'laser-status' }, h('span', {}, dot, stTxt)),
    h('div', { class: 'form' },
      h('label', {}, t('Name')), nameIn,
      h('label', {}, t('Montage')), mountSel,
      h('label', {}, t('Kamera')), h('div', { class: 'conn-row' }, camSel, h('button', { class: 'ib small', title: t('Kameras neu suchen'), html: ICONS.refresh, onclick: () => loadCams() })),
      urlLbl, urlIn,
      resLbl, resSel,
    ),
    urlList,
    h('div', { class: 'conn-row' }, connBtn, calBtn),
    preview,
    calTxt,
    h('div', { class: 'form' },
      h('label', { class: 'check' }, show, t('Auf der Arbeitsfläche zeigen')),
      h('label', {}, t('Deckkraft')), opacity,
      liveLbl,
    ),
    h('div', { class: 'conn-row' }, updBtn, insBtn),
    h('div', { class: 'conn-row' }, h('button', { class: 'btn', title: t('Gleichartige Werkstücke im Kamerabild erkennen und die Auswahl auf alle übertragen'), onclick: () => openWorkpieceDialog(ed) }, t('Auf Werkstücke übertragen …'))),
    headRow,
    msg,
  );
  loadCams();
  refresh();
  return root;
}

// ---------- Markierungen zum Kalibrieren ----------

/** Markierungen als Objekte (Weltkoordinaten): Kreis mit Kreuz, die erste mit zweitem Ring zum Wiedererkennen */
function markObjects(pts: Pt[], size: number, bedH: number): Obj[] {
  const r = size / 2;
  const objs: Obj[] = [];
  pts.forEach((p, i) => {
    const at = translate(p.x, bedH - p.y);
    const ring = (rr: number): Obj => ({ id: 0, m: at, layer: 1, shape: { kind: 'ellipse', rx: rr, ry: rr } });
    objs.push(ring(r));
    if (i === 0) objs.push(ring(r * 0.55));
    objs.push({
      id: 0, m: at, layer: 1,
      shape: {
        kind: 'path',
        subs: [
          { nodes: [{ x: -r * 1.4, y: 0 }, { x: r * 1.4, y: 0 }], closed: false },
          { nodes: [{ x: 0, y: -r * 1.4 }, { x: 0, y: r * 1.4 }], closed: false },
        ],
      },
    });
  });
  return objs;
}

async function markGCode(ed: Editor, m: MarkSettings, pts: Pt[]) {
  const { w, h: bh } = ed.doc.bed;
  const layer = { ...defaultLayer(1), mode: 'line' as const, speed: m.speed, power: m.power, passes: 1 };
  // Absolut zum Maschinennullpunkt, unabhängig von „Starten ab“: die Kalibrierung gilt für Bettkoordinaten
  const dev = { ...device, startFrom: 'absolute' as const, cutSelected: false };
  const job = await buildJob({
    doc: loadDoc({ bed: { w, h: bh }, objs: markObjects(pts, m.size, bh), layers: { 1: layer } }),
    layer: () => layer,
    imgLayer: (i) => ed.imgLayer(i),
    device: dev,
  });
  return writeGCode(job, dev, estimate(job.moves, dev), t('KizamuBeam Kamera-Markierungen'));
}

// ---------- Kalibrier-Assistent ----------

function openCalibration(ed: Editor, u: CamUnit) {
  const s = u.s;
  const cam = u.stream;
  const head = u.head;
  const m: MarkSettings = { ...s.marks };
  const { w: bedW, h: bedH } = ed.doc.bed;
  /** Kopfkamera: Mitte des Markierungsfelds (anfangs die Kopfposition) */
  const hp = headPos();
  const center: Pt = hp ? { ...hp } : { x: bedW / 2, y: bedH / 2 };
  const markRect = (): Rect => (head ? headMarkRect(m, center) : { x0: m.margin, y0: m.margin, x1: bedW - m.margin, y1: bedH - m.margin });
  let targets = markPositionsIn(m, markRect());
  /** Kopfkamera: Kopfposition beim Foto */
  let shotPos: Pt | null = null;
  /** Angeklickte Bildpunkte je Markierung (null = übersprungen / noch offen) */
  let clicks: (Pt | null)[] = targets.map(() => null);
  let cur = 0;
  let frame: HTMLCanvasElement | null = null;
  let lens = true;
  let result: CameraCalib | null = null;
  let mode: 'marks' | 'click' | 'check' = 'marks';

  const sketch = h('canvas', { class: 'cal-sketch', width: 220, height: 220 }) as HTMLCanvasElement;
  const view = h('canvas', { class: 'cal-view' }) as HTMLCanvasElement;
  const info = h('div', { class: 'note' });
  const resTxt = h('div', { class: 'cal-result' });

  // --- Schritt 1: Markierungen ---
  const nSel = h('select', {}, ...[[2, t('2 × 2 (nur Ausrichtung)')], [3, '3 × 3'], [4, t('4 × 4 (genauer)')], [5, '5 × 5']].map(([v, label]) =>
    h('option', { value: String(v), selected: v === m.n }, String(label)))) as HTMLSelectElement;
  const numField = (val: number, set: (v: number) => void) => {
    const el = numInput('', (v) => {
      if (v > 0) set(v);
      remark();
    });
    el.value = String(val);
    return el;
  };
  const remark = () => {
    targets = markPositionsIn(m, markRect());
    clicks = targets.map(() => null);
    cur = 0;
    result = null;
    draw();
  };
  nSel.addEventListener('change', () => ((m.n = Number(nSel.value)), remark()));
  const burnBtn = h('button', { class: 'btn primary', title: t('Markierungen mit dem verbundenen Laser auf das Material lasern') }, t('Markierungen lasern')) as HTMLButtonElement;
  burnBtn.disabled = !machine.connected;
  burnBtn.addEventListener('click', async () => {
    if (!machine.connected || machine.running) return void (info.textContent = machine.running ? t('Es läuft bereits ein Auftrag.') : t('Nicht verbunden.'));
    const mr = markRect();
    const rr = m.size / 2;
    if (mr.x0 - rr < 0 || mr.y0 - rr < 0 || mr.x1 + rr > bedW || mr.y1 + rr > bedH)
      return void (info.textContent = t('Die Markierungen liegen teilweise außerhalb des Betts. Mitte oder Feldgröße ändern.'));
    const g = await markGCode(ed, m, targets);
    info.textContent = head
      ? t('Markierungen werden gelasert. Danach den Kopf über die Markierungen fahren und das Foto aufnehmen.')
      : t('Markierungen werden gelasert. Danach „Weiter“.');
    await machine.runJob(g.lines, g.times);
  });
  const saveBtn = h('button', { class: 'btn', title: t('Markierungen als G-Code-Datei speichern') }, t('Als G-Code speichern'));
  saveBtn.addEventListener('click', async () => {
    const g = await markGCode(ed, m, targets);
    await saveText('kamera-markierungen.gcode', 'G-Code', 'gcode', 'text/plain', g.lines.join('\n') + '\n');
  });
  const cx = numField(center.x, (v) => (center.x = v)),
    cy = numField(center.y, (v) => (center.y = v));
  const fmt = (v: number) => dec(String(Math.round(v * 10) / 10));
  for (const el of [cx, cy]) el.style.width = '5em';
  cx.value = fmt(center.x);
  cy.value = fmt(center.y);
  const hereBtn = h('button', { class: 'ib small', title: t('Aktuelle Kopfposition als Mitte übernehmen'), html: ICONS.target }) as HTMLButtonElement;
  hereBtn.addEventListener('click', () => {
    const p = headPos();
    if (!p) return void (info.textContent = t('Die aktuelle Position ist noch nicht bekannt.'));
    ((center.x = p.x), (center.y = p.y));
    cx.value = fmt(p.x);
    cy.value = fmt(p.y);
    remark();
  });
  const step1 = h('div', { class: 'cal-step' },
    h('div', { class: 'form-title' }, t('1. Markierungen lasern')),
    h('p', { class: 'note' }, head
      ? t('Ein flaches Stück Pappe oder Sperrholz unter den Laserkopf legen und fokussieren. Die Markierungen werden rund um die Mitte gelasert, standardmäßig um die aktuelle Kopfposition. Die Kamera darf sich am Kopf danach nicht mehr verstellen.')
      : t('Ein flaches Stück Pappe oder Sperrholz auf das ganze Bett legen und den Laser fokussieren. Die Kamera muss fest montiert sein und darf sich nach der Kalibrierung nicht mehr bewegen.')),
    h('div', { class: 'form' },
      h('label', {}, t('Raster')), nSel,
      ...(head
        ? [
          h('label', { title: t('Abstand der äußeren Markierungen; das Feld sollte etwa zwei Drittel des Kamerabilds füllen') }, t('Feldgröße (mm)')),
          numField(m.field, (v) => (m.field = Math.max(4, v))),
          h('label', {}, t('Mitte X / Y (mm)')), h('div', { class: 'conn-row' }, cx, cy, hereBtn),
        ]
        : [h('label', {}, t('Abstand zum Rand (mm)')), numField(m.margin, (v) => (m.margin = Math.min(v, Math.min(bedW, bedH) / 2 - 5)))]),
      h('label', {}, t('Durchmesser (mm)')), numField(m.size, (v) => (m.size = v)),
      h('label', {}, t('Geschwindigkeit (mm/min)')), numField(m.speed, (v) => (m.speed = v)),
      h('label', {}, t('Leistung (%)')), numField(m.power, (v) => (m.power = Math.min(100, v))),
    ),
    h('div', { class: 'conn-row' }, burnBtn, saveBtn),
    h('p', { class: 'note' }, t('Die Markierungen liegen an festen Bettpositionen (absolut zum Maschinennullpunkt). Markierung 1 hat einen zweiten Ring.')),
  );
  if (head && m.size > m.field / 3) info.textContent = t('Tipp: Für eine Kopfkamera kleine Markierungen wählen, etwa 3 bis 5 mm.');

  // --- Schritt 2: Anklicken ---
  const shotBtn = h('button', { class: 'btn primary' }, t('Foto aufnehmen')) as HTMLButtonElement;
  const skipBtn = h('button', { class: 'btn', title: t('Diese Markierung auslassen (z. B. verdeckt)') }, t('Überspringen')) as HTMLButtonElement;
  const backBtn = h('button', { class: 'btn', title: t('Zur vorigen Markierung') }, t('Zurück')) as HTMLButtonElement;
  const lensBox = h('input', { type: 'checkbox', checked: lens }) as HTMLInputElement;
  lensBox.addEventListener('change', () => ((lens = lensBox.checked), compute()));
  const checkBtn = h('button', { class: 'btn', title: t('Entzerrtes Bild mit den Sollpositionen der Markierungen zeigen') }, t('Prüfen')) as HTMLButtonElement;
  shotBtn.addEventListener('click', async () => {
    if (head) {
      const p = headPos();
      if (!p) return void (info.textContent = t('Für die Kopfkamera muss der Laser verbunden und seine Position bekannt sein.'));
      if (!headStill(300)) return void (info.textContent = t('Der Laserkopf fährt gerade. Bitte warten, bis er steht.'));
      // Neues Foto an anderer Stelle: die Klicks passen nicht mehr
      if (shotPos && Math.hypot(p.x - shotPos.x, p.y - shotPos.y) > 0.05) ((clicks = targets.map(() => null)), (cur = 0));
      shotPos = p;
      await cam.freshFrames(2);
    }
    const g = cam.grab();
    if (!g) return void (info.textContent = t('Kein Kamerabild.'));
    frame = document.createElement('canvas');
    frame.width = g.width;
    frame.height = g.height;
    frame.getContext('2d')!.drawImage(g, 0, 0);
    mode = 'click';
    fitView();
    compute();
  });
  skipBtn.addEventListener('click', () => {
    clicks[cur] = null;
    cur = Math.min(cur + 1, targets.length);
    compute();
  });
  backBtn.addEventListener('click', () => {
    cur = Math.max(0, cur - 1);
    draw();
  });
  checkBtn.addEventListener('click', () => {
    mode = mode === 'check' ? 'click' : 'check';
    fitView();
    draw();
  });
  // Kopfkamera: den Kopf im Dialog verfahren, bis die Kamera alle Markierungen sieht
  const jogStep = h('select', { title: t('Schrittweite') },
    ...[1, 5, 10, 20, 50].map((v) => h('option', { value: String(v), selected: v === 10 }, `${v} mm`))) as HTMLSelectElement;
  const jog = (dx: number, dy: number) => {
    if (!machine.connected) return void (info.textContent = t('Nicht verbunden.'));
    if (machine.running) return void (info.textContent = t('Es läuft bereits ein Auftrag.'));
    const st = Number(jogStep.value);
    for (const l of FIRMWARES[device.fw].jog(dx * st, dy * st, 3000)) machine.send(l);
  };
  const jogRow = h('div', { class: 'conn-row' },
    ...([[-1, 0, '←'], [1, 0, '→'], [0, 1, '↑'], [0, -1, '↓']] as const).map(([dx, dy, l]) =>
      h('button', { class: 'btn', title: t('Laserkopf verfahren'), onclick: () => jog(dx, dy) }, l)),
    jogStep,
  );
  const step2 = h('div', { class: 'cal-step' },
    h('div', { class: 'form-title' }, t('2. Markierungen anklicken')),
    head ? h('p', { class: 'note' }, t('Den Kopf so verfahren, dass die Kamera alle Markierungen gut sieht (rechts das Live-Bild), dann das Foto aufnehmen. Die Kopfposition beim Foto wird mit gespeichert.')) : '',
    head ? jogRow : '',
    h('p', { class: 'note' }, t('Foto aufnehmen, dann die Mitte jeder Markierung in der angezeigten Reihenfolge anklicken. Mausrad zoomt, rechte Maustaste verschiebt das Bild, gesetzte Punkte lassen sich ziehen.')),
    h('div', { class: 'conn-row' }, shotBtn, backBtn, skipBtn),
    h('label', { class: 'check' }, lensBox, t('Linsenverzeichnung korrigieren (ab 3 × 3)')),
    resTxt,
    h('div', { class: 'conn-row' }, checkBtn),
  );

  const saveCal = h('button', { class: 'btn primary', disabled: true }, t('Übernehmen')) as HTMLButtonElement;
  saveCal.addEventListener('click', () => {
    if (!result) return;
    s.calib = result;
    s.marks = { ...m };
    save();
    if (head) u.clear(ed);
    if (!head || headStill()) u.update(ed);
    u.setLive(ed);
    changed();
    dlg.close();
  });

  const dlg = h('dialog', { class: 'camera-dialog' },
    h('h3', {}, t('Kamera kalibrieren und ausrichten')),
    h('div', { class: 'cal-body' },
      h('div', { class: 'cal-left' }, sketch, step1, step2, info),
      h('div', { class: 'cal-right' }, view),
    ),
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
      saveCal,
    ),
  );

  // --- Ansicht des Fotos: Zoom und Verschieben ---
  const vw = { z: 1, ox: 0, oy: 0 };
  let dragPt = -1;
  let pan: { x: number; y: number; ox: number; oy: number } | null = null;
  let mouse: Pt | null = null;
  const src = () => (mode === 'check' && result ? checkCanvas() : frame);
  const fitView = () => {
    const f = src();
    const r = view.getBoundingClientRect();
    if (!f || !r.width) return;
    vw.z = Math.min(r.width / f.width, r.height / f.height);
    vw.ox = (r.width - f.width * vw.z) / 2;
    vw.oy = (r.height - f.height * vw.z) / 2;
  };
  const toImg = (e: MouseEvent): Pt => {
    const r = view.getBoundingClientRect();
    return { x: (e.clientX - r.left - vw.ox) / vw.z, y: (e.clientY - r.top - vw.oy) / vw.z };
  };
  const toScr = (p: Pt): Pt => ({ x: p.x * vw.z + vw.ox, y: p.y * vw.z + vw.oy });

  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    const sx = e.clientX - r.left,
      sy = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015);
    const z = Math.max(0.05, Math.min(40, vw.z * f));
    vw.ox = sx - ((sx - vw.ox) * z) / vw.z;
    vw.oy = sy - ((sy - vw.oy) * z) / vw.z;
    vw.z = z;
    draw();
  }, { passive: false });
  view.addEventListener('contextmenu', (e) => e.preventDefault());
  view.addEventListener('pointerdown', (e) => {
    if (!src()) return;
    view.setPointerCapture(e.pointerId);
    if (e.button === 2 || e.button === 1) {
      pan = { x: e.clientX, y: e.clientY, ox: vw.ox, oy: vw.oy };
      return;
    }
    if (mode !== 'click' || e.button !== 0) return;
    const p = toImg(e);
    // Vorhandenen Punkt greifen?
    const hit = clicks.findIndex((c) => c && Math.hypot((c.x - p.x) * vw.z, (c.y - p.y) * vw.z) < 8);
    if (hit >= 0) {
      dragPt = hit;
      return;
    }
    if (cur >= targets.length) return;
    clicks[cur] = p;
    dragPt = cur;
    cur++;
    while (cur < targets.length && clicks[cur]) cur++;
    compute();
  });
  view.addEventListener('pointermove', (e) => {
    mouse = toImg(e);
    if (pan) {
      vw.ox = pan.ox + e.clientX - pan.x;
      vw.oy = pan.oy + e.clientY - pan.y;
    } else if (dragPt >= 0) clicks[dragPt] = mouse;
    draw();
  });
  view.addEventListener('pointerup', () => {
    if (dragPt >= 0) compute();
    dragPt = -1;
    pan = null;
  });
  view.addEventListener('pointerleave', () => ((mouse = null), draw()));

  // --- Berechnung ---
  function compute() {
    const bed: Pt[] = [],
      img: Pt[] = [];
    clicks.forEach((c, i) => c && (bed.push(targets[i]), img.push(c)));
    result = frame && bed.length >= 4 ? calibrate(bed, img, frame.width, frame.height, lens, bedW, bedH) : null;
    if (result && head) result.head = shotPos ? { ...shotPos } : undefined;
    if (result && head && !result.head) result = null;
    checkCache = null;
    saveCal.disabled = !result;
    checkBtn.disabled = !result;
    if (!frame) resTxt.textContent = '';
    else if (bed.length < 4) resTxt.textContent = tn('Noch {n} Markierung bis zur ersten Berechnung.', 'Noch {n} Markierungen bis zur ersten Berechnung.', 4 - bed.length);
    else if (!result) resTxt.textContent = t('Keine Lösung: Reihenfolge der Punkte prüfen.');
    else {
      const f = (v: number) => dec(v.toFixed(2));
      const bad = result.maxErr > 1.5;
      resTxt.textContent = t('{n} Markierungen: Restfehler ⌀ {err} mm, max. {maxErr} mm.', { n: bed.length, err: f(result.err), maxErr: f(result.maxErr) }) +
        (bad ? t(' Ein Punkt liegt deutlich daneben: Reihenfolge und Klick prüfen.') : '');
      resTxt.classList.toggle('error', bad);
    }
    draw();
  }
  let checkCache: HTMLCanvasElement | null = null;
  function checkCanvas(): HTMLCanvasElement | null {
    if (checkCache) return checkCache;
    if (!frame || !result) return null;
    // Kopfkamera: nur der Sichtbereich, feste Kamera: das ganze Bett
    const area: Rect = head ? footprint(result, frame.width, frame.height) : { x0: 0, y0: 0, x1: bedW, y1: bedH };
    const aw = area.x1 - area.x0,
      ah = area.y1 - area.y0;
    const r = buildRemapRect(result, frame.width, frame.height, area, Math.max(aw, ah) / 1000);
    const c = document.createElement('canvas');
    c.width = r.w;
    c.height = r.h;
    const ctx = c.getContext('2d')!;
    const out = ctx.createImageData(r.w, r.h);
    warp(frame.getContext('2d')!.getImageData(0, 0, frame.width, frame.height), r, out);
    ctx.putImageData(out, 0, 0);
    // Sollpositionen und Bettraster einzeichnen
    const k = r.w / aw;
    const X = (x: number) => (x - area.x0) * k,
      Y = (y: number) => (area.y1 - y) * k;
    ctx.strokeStyle = 'rgba(0,160,255,0.6)';
    ctx.lineWidth = 1;
    const step = head ? 10 : 50;
    for (let x = Math.ceil(area.x0 / step) * step; x <= area.x1; x += step) (ctx.beginPath(), ctx.moveTo(X(x), 0), ctx.lineTo(X(x), r.h), ctx.stroke());
    for (let y = Math.ceil(area.y0 / step) * step; y <= area.y1; y += step) (ctx.beginPath(), ctx.moveTo(0, Y(y)), ctx.lineTo(r.w, Y(y)), ctx.stroke());
    ctx.strokeStyle = '#ff2020';
    ctx.lineWidth = 2;
    for (const t of targets) {
      ctx.beginPath();
      ctx.arc(X(t.x), Y(t.y), (m.size / 2) * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    return (checkCache = c);
  }

  // --- Zeichnen ---
  function drawSketch() {
    const c = sketch.getContext('2d')!;
    const W = sketch.width,
      H = sketch.height;
    // Kopfkamera: nur das Markierungsfeld mit etwas Rand, sonst das ganze Bett
    const mr = markRect();
    const pad = head ? m.field * 0.25 : 0;
    const A: Rect = head ? { x0: mr.x0 - pad, y0: mr.y0 - pad, x1: mr.x1 + pad, y1: mr.y1 + pad } : { x0: 0, y0: 0, x1: bedW, y1: bedH };
    const aw = A.x1 - A.x0,
      ah = A.y1 - A.y0;
    const k = Math.min((W - 20) / aw, (H - 20) / ah);
    const ox = (W - aw * k) / 2 - A.x0 * k,
      oy = (H - ah * k) / 2 - (bedH - A.y1) * k;
    c.clearRect(0, 0, W, H);
    const css = getComputedStyle(dlg);
    c.fillStyle = css.getPropertyValue('--surface-2') || '#eee';
    c.fillRect(ox + A.x0 * k, oy + (bedH - A.y1) * k, aw * k, ah * k);
    c.strokeStyle = css.getPropertyValue('--line') || '#888';
    c.strokeRect(ox + A.x0 * k, oy + (bedH - A.y1) * k, aw * k, ah * k);
    c.font = '10px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    targets.forEach((t, i) => {
      const x = ox + t.x * k,
        y = oy + (bedH - t.y) * k;
      const done = !!clicks[i],
        now = mode === 'click' && i === cur;
      c.beginPath();
      c.arc(x, y, now ? 9 : 7, 0, Math.PI * 2);
      c.fillStyle = now ? '#ff6020' : done ? '#20a040' : '#8890a0';
      c.fill();
      c.fillStyle = '#fff';
      c.fillText(String(i + 1), x, y + 0.5);
    });
    // Maschinennullpunkt
    if (head) return;
    c.fillStyle = '#e02020';
    c.fillRect(ox - 3, oy + bedH * k - 3, 6, 6);
  }

  let liveFrame = 0;
  function draw() {
    drawSketch();
    const r = view.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (view.width !== Math.round(r.width * dpr) || view.height !== Math.round(r.height * dpr)) {
      view.width = Math.round(r.width * dpr);
      view.height = Math.round(r.height * dpr);
    }
    const c = view.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, r.width, r.height);
    const f = src();
    if (!f && cam.open && cam.width) {
      // Vor dem Foto: Live-Bild, damit sich Kamera und Kopf ausrichten lassen
      const z = Math.min(r.width / cam.width, r.height / cam.height);
      c.drawImage(cam.video, (r.width - cam.width * z) / 2, (r.height - cam.height * z) / 2, cam.width * z, cam.height * z);
      skipBtn.disabled = backBtn.disabled = true;
      if (!liveFrame) liveFrame = requestAnimationFrame(() => ((liveFrame = 0), dlg.open && !frame && draw()));
      return;
    }
    if (!f) {
      c.fillStyle = getComputedStyle(dlg).getPropertyValue('--muted') || '#888';
      c.font = '13px sans-serif';
      c.textAlign = 'center';
      c.fillText(cam.open ? t('Nach dem Lasern „Foto aufnehmen“.') : t('Kamera nicht verbunden.'), r.width / 2, r.height / 2);
      skipBtn.disabled = backBtn.disabled = true;
      return;
    }
    c.imageSmoothingEnabled = vw.z < 2;
    c.drawImage(f, vw.ox, vw.oy, f.width * vw.z, f.height * vw.z);
    skipBtn.disabled = mode !== 'click' || cur >= targets.length;
    backBtn.disabled = mode !== 'click' || cur === 0;
    if (mode === 'check') {
      info.textContent = t('Entzerrtes Bild: Die roten Kreise sollten genau auf den gelaserten Markierungen liegen. „Prüfen“ schaltet zurück.');
      return;
    }
    info.textContent = cur < targets.length ? t('Markierung {cur} von {targets} anklicken.', { cur: cur + 1, targets: targets.length }) : t('Alle Markierungen gesetzt.');
    // Gesetzte Punkte
    clicks.forEach((p, i) => {
      if (!p) return;
      const q = toScr(p);
      c.strokeStyle = '#20e060';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(q.x - 7, q.y);
      c.lineTo(q.x + 7, q.y);
      c.moveTo(q.x, q.y - 7);
      c.lineTo(q.x, q.y + 7);
      c.stroke();
      c.fillStyle = '#20e060';
      c.font = 'bold 12px sans-serif';
      c.fillText(String(i + 1), q.x + 6, q.y - 6);
    });
    // Wo das Modell die Markierungen erwartet (nach der ersten Berechnung)
    if (result) {
      c.strokeStyle = 'rgba(255,60,30,0.9)';
      c.lineWidth = 1;
      targets.forEach((t) => {
        const q = toScr(bedToPixel(result!, t.x, t.y, f.width, f.height));
        c.beginPath();
        c.arc(q.x, q.y, 5, 0, Math.PI * 2);
        c.stroke();
      });
    }
    // Lupe
    if (mouse && !pan) {
      const L = 140,
        Z = Math.max(4, vw.z * 3);
      const lx = r.width - L - 10,
        ly = 10;
      c.save();
      c.beginPath();
      c.rect(lx, ly, L, L);
      c.clip();
      c.imageSmoothingEnabled = false;
      c.drawImage(f, mouse.x - L / 2 / Z, mouse.y - L / 2 / Z, L / Z, L / Z, lx, ly, L, L);
      c.strokeStyle = '#ff2020';
      c.beginPath();
      c.moveTo(lx + L / 2, ly);
      c.lineTo(lx + L / 2, ly + L);
      c.moveTo(lx, ly + L / 2);
      c.lineTo(lx + L, ly + L / 2);
      c.stroke();
      c.restore();
      c.strokeStyle = '#888';
      c.strokeRect(lx, ly, L, L);
    }
  }

  const ro = new ResizeObserver(() => {
    if (!vw.z || vw.z === 1) fitView();
    draw();
  });
  ro.observe(view);
  dlg.addEventListener('close', () => (ro.disconnect(), dlg.remove()));
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  if (s.calib) info.textContent = t('Die Kamera ist schon kalibriert. Eine neue Kalibrierung ersetzt die alte erst mit „Übernehmen“.');
  draw();
}
