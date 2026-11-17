// Dreiecksnetze (3D-Modelle) lesen, verschweißen, prüfen und kompakt speichern. Ohne DOM, damit es auch in den
// Node-Tests läuft. Einheiten wie in der Datei (STL kennt keine; meist mm).
import { t } from '../i18n';
import { toBase64 } from '../base64';
import { readMeshData } from './meshData';

export interface Mesh {
  /** Eckpunkte x, y, z hintereinander */
  pos: Float32Array;
  /** Dreiecke als Indizes in pos (je drei) */
  tri: Uint32Array;
}

export interface MeshInfo {
  vertices: number;
  triangles: number;
  min: [number, number, number];
  max: [number, number, number];
  /** Kanten, die nur zu einem Dreieck gehören (Löcher im Netz) */
  openEdges: number;
}

export class MeshError extends Error {}

// ---------- Lesen ----------

/** STL binär oder als Text */
export function parseStl(buf: ArrayBuffer): Mesh {
  const bytes = new Uint8Array(buf);
  if (bytes.length >= 84) {
    const dv = new DataView(buf);
    const n = dv.getUint32(80, true);
    if (84 + n * 50 === bytes.length) {
      const pos = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) {
        const o = 84 + i * 50 + 12;
        for (let k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(o + k * 4, true);
      }
      return weld(pos);
    }
  }
  const text = new TextDecoder().decode(bytes);
  if (!/^\s*solid/i.test(text) || !/vertex/i.test(text)) throw new MeshError(t('Keine gültige STL-Datei.'));
  const out: number[] = [];
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(Number(m[1]), Number(m[2]), Number(m[3]));
  if (out.length % 9 || out.some((v) => !isFinite(v))) throw new MeshError(t('Keine gültige STL-Datei.'));
  return weld(Float32Array.from(out));
}

/** Wavefront OBJ: Ecken (v) und Flächen (f, auch Vielecke und negative Indizes); Texturen und Normalen werden ignoriert */
export function parseObj(text: string): Mesh {
  const v: number[] = [];
  const tri: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('v ')) {
      const p = line.slice(2).trim().split(/\s+/).slice(0, 3).map(Number);
      if (p.length < 3 || p.some((x) => !isFinite(x))) throw new MeshError(t('Fehlerhafte Ecke in der OBJ-Datei.'));
      v.push(p[0], p[1], p[2]);
    } else if (line.startsWith('f ')) {
      const n = v.length / 3;
      const ids = line.slice(2).trim().split(/\s+/).map((w) => {
        const i = parseInt(w.split('/')[0], 10);
        return i < 0 ? n + i : i - 1;
      });
      if (ids.some((i) => !(i >= 0 && i < n))) throw new MeshError(t('Fehlerhafte Fläche in der OBJ-Datei.'));
      for (let k = 1; k + 1 < ids.length; k++) tri.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  if (!tri.length) throw new MeshError(t('Die OBJ-Datei enthält keine Flächen.'));
  const pos = new Float32Array(tri.length * 3);
  tri.forEach((i, k) => {
    pos[k * 3] = v[i * 3];
    pos[k * 3 + 1] = v[i * 3 + 1];
    pos[k * 3 + 2] = v[i * 3 + 2];
  });
  return weld(pos);
}

/** Datei nach Endung lesen (.stl, .obj) */
export function parseMeshFile(name: string, buf: ArrayBuffer): Mesh {
  const ext = name.toLowerCase().split('.').pop();
  const mesh = ext === 'obj' ? parseObj(new TextDecoder().decode(new Uint8Array(buf))) : parseStl(buf);
  if (!mesh.tri.length) throw new MeshError(t('Das Modell enthält keine Dreiecke.'));
  return mesh;
}

// ---------- Verschweißen und Prüfen ----------

/**
 * Lose Dreiecke (je drei Ecken hintereinander) zu einem Netz mit gemeinsamen Ecken. Ecken, die näher als
 * tol beieinander liegen (relativ zur Modellgröße), werden eins. Entartete Dreiecke fallen weg.
 */
export function weld(soup: Float32Array, tolRel = 1e-6): Mesh {
  let ext = 0;
  for (let i = 0; i < soup.length; i++) ext = Math.max(ext, Math.abs(soup[i]));
  const q = 1 / Math.max(1e-12, ext * tolRel);
  const map = new Map<string, number>();
  const pos: number[] = [];
  const idx = new Uint32Array(soup.length / 3);
  for (let i = 0; i < idx.length; i++) {
    const x = soup[i * 3],
      y = soup[i * 3 + 1],
      z = soup[i * 3 + 2];
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      map.set(key, id);
      pos.push(x, y, z);
    }
    idx[i] = id;
  }
  const tri: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i],
      b = idx[i + 1],
      c = idx[i + 2];
    if (a !== b && b !== c && a !== c) tri.push(a, b, c);
  }
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}

export function meshInfo(m: Mesh): MeshInfo {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i += 3)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], m.pos[i + k]);
      max[k] = Math.max(max[k], m.pos[i + k]);
    }
  const edges = new Map<number, number>();
  const nv = m.pos.length / 3;
  for (let i = 0; i < m.tri.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const a = m.tri[i + k],
        b = m.tri[i + ((k + 1) % 3)];
      const key = Math.min(a, b) * nv + Math.max(a, b);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  let open = 0;
  for (const c of edges.values()) if (c === 1) open++;
  return { vertices: nv, triangles: m.tri.length / 3, min, max, openEdges: open };
}

// ---------- Kompakt speichern ----------
// Aufbau: "kzm1:" + Base64 von [Anzahl Ecken u32, Anzahl Dreiecke u32, Ecken f32…, Indizes u32…] (little endian).
// In der Projektdatei steht das Modell so einmal, auch wenn viele Teile es benutzen.

export function encodeMesh(m: Mesh): string {
  const nv = m.pos.length / 3,
    nt = m.tri.length / 3;
  const buf = new ArrayBuffer(8 + m.pos.length * 4 + m.tri.length * 4);
  const dv = new DataView(buf);
  dv.setUint32(0, nv, true);
  dv.setUint32(4, nt, true);
  let o = 8;
  for (const v of m.pos) dv.setFloat32(o, v, true), (o += 4);
  for (const v of m.tri) dv.setUint32(o, v, true), (o += 4);
  return 'kzm1:' + toBase64(new Uint8Array(buf));
}

export function decodeMesh(s: string): Mesh {
  const m = readMeshData(s);
  if (m === 'format') throw new MeshError(t('Unbekanntes Modellformat.'));
  if (m === 'damaged') throw new MeshError(t('Die Modelldaten sind beschädigt.'));
  return m;
}

/** Kurze Kennung aus den Daten (FNV-1a, zwei Läufe), gleiche Modelle ergeben dieselbe */
export function meshId(data: string): string {
  let h1 = 0x811c9dc5,
    h2 = 0x01000193;
  for (let i = 0; i < data.length; i++) {
    h1 = Math.imul(h1 ^ data.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ data.charCodeAt(data.length - 1 - i), 2246822519);
  }
  return 'm' + (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
