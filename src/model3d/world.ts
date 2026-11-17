// Placing a 3D model in the world as the 3D-model generators cut it: upright, scaled to a size and centred over the
// origin. Pure computation (no texts, no DOM), so the plugin Worker can use it too (host function slice).
import type { Mesh } from './mesh';
import type { V3 } from './slice';

/** Modellkoordinaten aufrecht (Z oben), skaliert auf size (längste Seite), Mitte über dem Ursprung, Boden bei Z = 0 */
export function worldOf(mesh: Mesh, up: string, size: number): { world: (x: number, y: number, z: number) => V3; dims: V3 } {
  const upright = up === 'y' ? (x: number, y: number, z: number): V3 => [x, -z, y] : (x: number, y: number, z: number): V3 => [x, y, z];
  const min: V3 = [Infinity, Infinity, Infinity],
    max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.pos.length; i += 3) {
    const p = upright(mesh.pos[i], mesh.pos[i + 1], mesh.pos[i + 2]);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const s = size / ext;
  const c: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
  return {
    world: (x, y, z) => {
      const p = upright(x, y, z);
      return [(p[0] - c[0]) * s, (p[1] - c[1]) * s, (p[2] - c[2]) * s];
    },
    dims: [(max[0] - min[0]) * s, (max[1] - min[1]) * s, (max[2] - min[2]) * s],
  };
}
