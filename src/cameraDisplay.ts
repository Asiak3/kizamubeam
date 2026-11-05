import type { CameraImageAdjustments } from './cameraProfile';
import { adjustCameraPixels } from './cameraImageProcessing';

export function cameraImageIsIdentity(image: CameraImageAdjustments): boolean {
  return image.brightness === 1 && image.contrast === 1 && image.saturation === 1 && image.gamma === 1 && !image.grayscale;
}

/** Software-only preview. Never acquires a camera; preserves image geometry. */
export function drawCameraPreview(canvas: HTMLCanvasElement, source: HTMLVideoElement | HTMLCanvasElement,
  image: CameraImageAdjustments, maxWidth = 800) {
  const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!(width > 0 && height > 0)) return;
  const scale = Math.min(1, maxWidth / width);
  const w = Math.max(1, Math.round(width * scale)), hh = Math.max(1, Math.round(height * scale));
  if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, hh);
  if (cameraImageIsIdentity(image)) return;
  const pixels = ctx.getImageData(0, 0, w, hh);
  adjustCameraPixels(pixels.data, image);
  ctx.putImageData(pixels, 0, 0);
}
