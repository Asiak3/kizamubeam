// Reading the compact mesh text ("kzm1:" + base64) without texts or the DOM, so the plugin Worker can use it
// (host functions slice a 3D model the app handed to a plugin). mesh.ts wraps it with error messages.
import { fromBase64 } from '../base64';
import type { Mesh } from './mesh';

/** The mesh in a "kzm1:" text; 'format' for another format, 'damaged' when the data do not fit */
export function readMeshData(s: string): Mesh | 'format' | 'damaged' {
  if (!s.startsWith('kzm1:')) return 'format';
  const bytes = fromBase64(s.slice(5));
  if (bytes.length < 8) return 'damaged';
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nv = dv.getUint32(0, true),
    nt = dv.getUint32(4, true);
  if (8 + nv * 12 + nt * 12 !== bytes.length) return 'damaged';
  const pos = new Float32Array(nv * 3);
  const tri = new Uint32Array(nt * 3);
  let o = 8;
  for (let i = 0; i < pos.length; i++, o += 4) pos[i] = dv.getFloat32(o, true);
  for (let i = 0; i < tri.length; i++, o += 4) tri[i] = dv.getUint32(o, true);
  if (tri.some((i) => i >= nv)) return 'damaged';
  return { pos, tri };
}
