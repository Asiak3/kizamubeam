// Text code of a German source text: stable as long as the text stays the same, short and safe as a manifest key.
// Used by the plugin wrapper (in QuickJS) and by the build script (in Node), so both agree.
export function codeOf(de: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < de.length; i++) {
    h ^= de.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 't' + h.toString(16).padStart(8, '0');
}
