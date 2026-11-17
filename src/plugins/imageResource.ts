// Images kept with the project as plugin resources (#211 stage 6): a data parameter with "resource": "image" holds
// the id of an image in the image store (images.ts); the plugin gets its pixels before it computes. Text format:
// "rgba1:<width>,<height>," + base64 of the RGBA bytes (4 per pixel, row by row from the top left), scaled down to
// at most MAX pixels on the longer side. Null while the image is not decoded yet (an opened project restores it in
// the background); the result is computed again once it is there.
import { toBase64 } from '../base64';
import { assetImage, onImageReady } from '../images';

/** Longest side handed to plugins */
export const IMAGE_RESOURCE_MAX = 1200;
const cache = new Map<string, string>();
/** Images a plugin asked for before they were decoded */
const waiting = new Set<string>();

/** Calls f when an image a plugin waited for is decoded (to compute its parts again); returns the unsubscribe */
export function onImageResourceReady(f: () => void): () => void {
  return onImageReady(() => {
    const ready = [...waiting].filter((id) => assetImage(id)?.naturalWidth);
    if (!ready.length) return;
    ready.forEach((id) => waiting.delete(id));
    f();
  });
}

export function imageResource(id: string): string | null {
  const hit = cache.get(id);
  if (hit) {
    cache.delete(id);
    cache.set(id, hit);
    return hit;
  }
  const img = assetImage(id);
  if (!img || !img.naturalWidth) {
    waiting.add(id);
    return null;
  }
  const f = Math.min(1, IMAGE_RESOURCE_MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * f));
  c.height = Math.max(1, Math.round(img.naturalHeight * f));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const out = `rgba1:${d.width},${d.height},${toBase64(d.data)}`;
  cache.set(id, out);
  while (cache.size > 4) cache.delete(cache.keys().next().value!);
  return out;
}
