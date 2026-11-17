// Base64 without atob/btoa: the same code runs in browsers, Node and plugin engines (QuickJS has neither)
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes as base64; written out here because the same code runs in Node, browsers and QuickJS */
export function toBase64(b: Uint8Array | Uint8ClampedArray): string {
  const out: string[] = [];
  let line = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    line += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
    if (line.length >= 8192) (out.push(line), (line = ''));
  }
  out.push(line);
  return out.join('');
}

/** Base64 as bytes */
export function fromBase64(s: string): Uint8ClampedArray {
  const map = new Uint8Array(128);
  for (let i = 0; i < 64; i++) map[B64.charCodeAt(i)] = i;
  const n = s.replace(/=+$/, '').length;
  const out = new Uint8ClampedArray(Math.floor((n * 3) / 4));
  let j = 0;
  for (let i = 0; i < n; i += 4) {
    const v = (map[s.charCodeAt(i)] << 18) | (map[s.charCodeAt(i + 1)] << 12) | ((i + 2 < n ? map[s.charCodeAt(i + 2)] : 0) << 6) | (i + 3 < n ? map[s.charCodeAt(i + 3)] : 0);
    out[j++] = v >> 16;
    if (j < out.length) out[j++] = (v >> 8) & 255;
    if (j < out.length) out[j++] = v & 255;
  }
  return out;
}
