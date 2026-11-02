// Entschlüsselung von PDF-Dateien mit dem Standard-Sicherheitsverfahren, soweit kein Kennwort zum Öffnen
// nötig ist (nur Bearbeitungsschutz; leeres Benutzerkennwort). Enthält kleine, synchrone Fassungen von MD5,
// RC4, AES (CBC) und SHA-2, weil die Web-Crypto-Schnittstelle nur asynchron arbeitet.

// ---------- MD5 ----------

const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(data: Uint8Array): Uint8Array {
  const n = data.length;
  const len = (((n + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(len);
  buf.set(data);
  buf[n] = 0x80;
  const bits = n * 8;
  for (let i = 0; i < 8; i++) buf[len - 8 + i] = Math.floor(bits / 2 ** (8 * i)) & 255;
  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < len; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = buf[off + 4 * i] | (buf[off + 4 * i + 1] << 8) | (buf[off + 4 * i + 2] << 16) | (buf[off + 4 * i + 3] << 24);
    let A = a0,
      B = b0,
      C = c0,
      D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) ((F = (B & C) | (~B & D)), (g = i));
      else if (i < 32) ((F = (D & B) | (~D & C)), (g = (5 * i + 1) & 15));
      else if (i < 48) ((F = B ^ C ^ D), (g = (3 * i + 5) & 15));
      else ((F = C ^ (B | ~D)), (g = (7 * i) & 15));
      F = (F + A + MD5_K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((v, i) => {
    for (let k = 0; k < 4; k++) out[i * 4 + k] = (v >>> (8 * k)) & 255;
  });
  return out;
}

// ---------- RC4 ----------

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 255;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + S[i]) & 255;
    [S[i], S[j]] = [S[j], S[i]];
    out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
  }
  return out;
}

// ---------- AES ----------

const SBOX = new Uint8Array(256),
  INV = new Uint8Array(256);
{
  // S-Box aus dem multiplikativen Inversen in GF(2^8) und der affinen Abbildung
  let p = 1,
    q = 1;
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
    q ^= q << 1;
    q ^= q << 2;
    q ^= q << 4;
    q &= 0xff;
    if (q & 0x80) q ^= 0x09;
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    SBOX[p] = (x ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
  for (let i = 0; i < 256; i++) INV[SBOX[i]] = i;
}
const xt = (b: number) => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;
const gm = (a: number, b: number) => {
  let r = 0;
  while (b) {
    if (b & 1) r ^= a;
    a = xt(a);
    b >>= 1;
  }
  return r;
};

function expandKey(key: Uint8Array): Uint8Array {
  const nk = key.length / 4,
    nr = nk + 6;
  const w = new Uint8Array(16 * (nr + 1));
  w.set(key);
  let rcon = 1;
  for (let i = nk; i < 4 * (nr + 1); i++) {
    let t = [w[4 * i - 4], w[4 * i - 3], w[4 * i - 2], w[4 * i - 1]];
    if (i % nk === 0) {
      t = [SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]];
      rcon = xt(rcon);
    } else if (nk > 6 && i % nk === 4) t = t.map((v) => SBOX[v]);
    for (let k = 0; k < 4; k++) w[4 * i + k] = w[4 * (i - nk) + k] ^ t[k];
  }
  return w;
}

function encryptBlock(w: Uint8Array, s: Uint8Array) {
  const nr = w.length / 16 - 1;
  for (let i = 0; i < 16; i++) s[i] ^= w[i];
  for (let r = 1; r <= nr; r++) {
    for (let i = 0; i < 16; i++) s[i] = SBOX[s[i]];
    // ShiftRows (Spalten-Reihenfolge: Index = 4·Spalte + Zeile)
    const t = s.slice();
    for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) s[4 * c + row] = t[4 * ((c + row) % 4) + row];
    if (r < nr)
      for (let c = 0; c < 4; c++) {
        const [a, b, cc, d] = [s[4 * c], s[4 * c + 1], s[4 * c + 2], s[4 * c + 3]];
        s[4 * c] = xt(a) ^ xt(b) ^ b ^ cc ^ d;
        s[4 * c + 1] = a ^ xt(b) ^ xt(cc) ^ cc ^ d;
        s[4 * c + 2] = a ^ b ^ xt(cc) ^ xt(d) ^ d;
        s[4 * c + 3] = xt(a) ^ a ^ b ^ cc ^ xt(d);
      }
    for (let i = 0; i < 16; i++) s[i] ^= w[16 * r + i];
  }
}

function decryptBlock(w: Uint8Array, s: Uint8Array) {
  const nr = w.length / 16 - 1;
  for (let i = 0; i < 16; i++) s[i] ^= w[16 * nr + i];
  for (let r = nr - 1; r >= 0; r--) {
    const t = s.slice();
    for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) s[4 * ((c + row) % 4) + row] = t[4 * c + row];
    for (let i = 0; i < 16; i++) s[i] = INV[s[i]];
    for (let i = 0; i < 16; i++) s[i] ^= w[16 * r + i];
    if (r > 0)
      for (let c = 0; c < 4; c++) {
        const [a, b, cc, d] = [s[4 * c], s[4 * c + 1], s[4 * c + 2], s[4 * c + 3]];
        s[4 * c] = gm(a, 14) ^ gm(b, 11) ^ gm(cc, 13) ^ gm(d, 9);
        s[4 * c + 1] = gm(a, 9) ^ gm(b, 14) ^ gm(cc, 11) ^ gm(d, 13);
        s[4 * c + 2] = gm(a, 13) ^ gm(b, 9) ^ gm(cc, 14) ^ gm(d, 11);
        s[4 * c + 3] = gm(a, 11) ^ gm(b, 13) ^ gm(cc, 9) ^ gm(d, 14);
      }
  }
}

/** AES-CBC verschlüsseln ohne Auffüllen (Länge muss ein Vielfaches von 16 sein) */
export function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
  const w = expandKey(key);
  const out = new Uint8Array(data.length);
  let prev = iv;
  for (let o = 0; o + 16 <= data.length; o += 16) {
    const s = new Uint8Array(16);
    for (let i = 0; i < 16; i++) s[i] = data[o + i] ^ prev[i];
    encryptBlock(w, s);
    out.set(s, o);
    prev = s;
  }
  return out;
}

/** AES-CBC entschlüsseln; pad: PKCS#7-Auffüllung entfernen */
export function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array, pad = true): Uint8Array {
  const w = expandKey(key);
  const n = data.length - (data.length % 16);
  const out = new Uint8Array(n);
  let prev = iv;
  for (let o = 0; o < n; o += 16) {
    const blk = data.slice(o, o + 16);
    const s = blk.slice();
    decryptBlock(w, s);
    for (let i = 0; i < 16; i++) out[o + i] = s[i] ^ prev[i];
    prev = blk;
  }
  if (pad && n) {
    const p = out[n - 1];
    if (p >= 1 && p <= 16) return out.subarray(0, n - p);
  }
  return out;
}

// ---------- SHA-2 ----------

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(data: Uint8Array): Uint8Array {
  const n = data.length;
  const len = (((n + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(len);
  buf.set(data);
  buf[n] = 0x80;
  const bits = n * 8;
  for (let i = 0; i < 8; i++) buf[len - 1 - i] = Math.floor(bits / 2 ** (8 * i)) & 255;
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x: number, r: number) => (x >>> r) | (x << (32 - r));
  for (let off = 0; off < len; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = (buf[off + 4 * i] << 24) | (buf[off + 4 * i + 1] << 16) | (buf[off + 4 * i + 2] << 8) | buf[off + 4 * i + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + W[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    H[0] += a;
    H[1] += b;
    H[2] += c;
    H[3] += d;
    H[4] += e;
    H[5] += f;
    H[6] += g;
    H[7] += h;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) for (let k = 0; k < 4; k++) out[4 * i + k] = (H[i] >>> (24 - 8 * k)) & 255;
  return out;
}

const K512 = [
  '428a2f98d728ae22', '7137449123ef65cd', 'b5c0fbcfec4d3b2f', 'e9b5dba58189dbbc', '3956c25bf348b538', '59f111f1b605d019', '923f82a4af194f9b', 'ab1c5ed5da6d8118',
  'd807aa98a3030242', '12835b0145706fbe', '243185be4ee4b28c', '550c7dc3d5ffb4e2', '72be5d74f27b896f', '80deb1fe3b1696b1', '9bdc06a725c71235', 'c19bf174cf692694',
  'e49b69c19ef14ad2', 'efbe4786384f25e3', '0fc19dc68b8cd5b5', '240ca1cc77ac9c65', '2de92c6f592b0275', '4a7484aa6ea6e483', '5cb0a9dcbd41fbd4', '76f988da831153b5',
  '983e5152ee66dfab', 'a831c66d2db43210', 'b00327c898fb213f', 'bf597fc7beef0ee4', 'c6e00bf33da88fc2', 'd5a79147930aa725', '06ca6351e003826f', '142929670a0e6e70',
  '27b70a8546d22ffc', '2e1b21385c26c926', '4d2c6dfc5ac42aed', '53380d139d95b3df', '650a73548baf63de', '766a0abb3c77b2a8', '81c2c92e47edaee6', '92722c851482353b',
  'a2bfe8a14cf10364', 'a81a664bbc423001', 'c24b8b70d0f89791', 'c76c51a30654be30', 'd192e819d6ef5218', 'd69906245565a910', 'f40e35855771202a', '106aa07032bbd1b8',
  '19a4c116b8d2d0c8', '1e376c085141ab53', '2748774cdf8eeb99', '34b0bcb5e19b48a8', '391c0cb3c5c95a63', '4ed8aa4ae3418acb', '5b9cca4f7763e373', '682e6ff3d6b2b8a3',
  '748f82ee5defb2fc', '78a5636f43172f60', '84c87814a1f0ab72', '8cc702081a6439ec', '90befffa23631e28', 'a4506cebde82bde9', 'bef9a3f7b2c67915', 'c67178f2e372532b',
  'ca273eceea26619c', 'd186b8c721c0c207', 'eada7dd6cde0eb1e', 'f57d4f7fee6ed178', '06f067aa72176fba', '0a637dc5a2c898a6', '113f9804bef90dae', '1b710b35131c471b',
  '28db77f523047d84', '32caab7b40c72493', '3c9ebe0a15c9bebc', '431d67c49c100d4c', '4cc5d4becb3e42b6', '597f299cfc657e2a', '5fcb6fab3ad6faec', '6c44198c4a475817',
].map((h) => BigInt('0x' + h));
const M64 = (1n << 64n) - 1n;

/** SHA-512 bzw. mit short = true SHA-384 */
export function sha512(data: Uint8Array, short = false): Uint8Array {
  const n = data.length;
  const len = (((n + 16) >> 7) + 1) << 7;
  const buf = new Uint8Array(len);
  buf.set(data);
  buf[n] = 0x80;
  const bits = n * 8;
  for (let i = 0; i < 8; i++) buf[len - 1 - i] = Math.floor(bits / 2 ** (8 * i)) & 255;
  const H = (
    short
      ? ['cbbb9d5dc1059ed8', '629a292a367cd507', '9159015a3070dd17', '152fecd8f70e5939', '67332667ffc00b31', '8eb44a8768581511', 'db0c2e0d64f98fa7', '47b5481dbefa4fa4']
      : ['6a09e667f3bcc908', 'bb67ae8584caa73b', '3c6ef372fe94f82b', 'a54ff53a5f1d36f1', '510e527fade682d1', '9b05688c2b3e6c1f', '1f83d9abfb41bd6b', '5be0cd19137e2179']
  ).map((h) => BigInt('0x' + h));
  const rotr = (x: bigint, r: bigint) => ((x >> r) | (x << (64n - r))) & M64;
  const W: bigint[] = new Array(80);
  for (let off = 0; off < len; off += 128) {
    for (let i = 0; i < 16; i++) {
      let v = 0n;
      for (let k = 0; k < 8; k++) v = (v << 8n) | BigInt(buf[off + 8 * i + k]);
      W[i] = v;
    }
    for (let i = 16; i < 80; i++) {
      const s0 = rotr(W[i - 15], 1n) ^ rotr(W[i - 15], 8n) ^ (W[i - 15] >> 7n);
      const s1 = rotr(W[i - 2], 19n) ^ rotr(W[i - 2], 61n) ^ (W[i - 2] >> 6n);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) & M64;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 80; i++) {
      const t1 = (h + (rotr(e, 14n) ^ rotr(e, 18n) ^ rotr(e, 41n)) + ((e & f) ^ (~e & M64 & g)) + K512[i] + W[i]) & M64;
      const t2 = ((rotr(a, 28n) ^ rotr(a, 34n) ^ rotr(a, 39n)) + ((a & b) ^ (a & c) ^ (b & c))) & M64;
      h = g;
      g = f;
      f = e;
      e = (d + t1) & M64;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) & M64;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => (H[i] = (H[i] + v) & M64));
  }
  const out = new Uint8Array(short ? 48 : 64);
  for (let i = 0; i < out.length / 8; i++) for (let k = 0; k < 8; k++) out[8 * i + k] = Number((H[i] >> BigInt(56 - 8 * k)) & 255n);
  return out;
}

// ---------- PDF-Sicherheitsverfahren ----------

const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c,
  0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const eqBytes = (a: Uint8Array, b: Uint8Array, n: number) => {
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Angaben aus dem /Encrypt-Eintrag (Zeichenketten als Bytes) */
export interface EncryptInfo {
  filter: string;
  v: number;
  r: number;
  length: number;
  o: Uint8Array;
  u: Uint8Array;
  oe?: Uint8Array;
  ue?: Uint8Array;
  p: number;
  id0: Uint8Array;
  encryptMetadata: boolean;
  /** Verfahren der Crypt-Filter für Streams und Zeichenketten: 'RC4', 'AESV2', 'AESV3' oder 'Identity' */
  stmMethod: 'RC4' | 'AESV2' | 'AESV3' | 'Identity';
  strMethod: 'RC4' | 'AESV2' | 'AESV3' | 'Identity';
}

/** Algorithmus 2.B (Revision 6): Schlüssel aus Kennwort, Salz und ggf. U-Eintrag */
function hash6(pw: Uint8Array, salt: Uint8Array, udata: Uint8Array): Uint8Array {
  let K = sha256(cat(pw, salt, udata));
  for (let i = 0; ; i++) {
    const one = cat(pw, K, udata);
    const K1 = new Uint8Array(one.length * 64);
    for (let k = 0; k < 64; k++) K1.set(one, k * one.length);
    const E = aesCbcEncrypt(K.subarray(0, 16), K.subarray(16, 32), K1);
    let sum = 0;
    for (let k = 0; k < 16; k++) sum += E[k];
    const m = sum % 3;
    K = m === 0 ? sha256(E) : m === 1 ? sha512(E, true) : sha512(E);
    if (i >= 63 && E[E.length - 1] <= i - 31) break;
  }
  return K.subarray(0, 32);
}

export class PdfDecryptor {
  private key: Uint8Array;
  constructor(private e: EncryptInfo) {
    if (e.filter !== 'Standard') throw new Error('filter');
    const pw = new Uint8Array(0);
    if (e.r >= 5) {
      // AES-256: Benutzerkennwort leer prüfen, dann Dateischlüssel aus UE
      const u = e.u;
      const h = (data: Uint8Array, salt: Uint8Array) => (e.r === 5 ? sha256(cat(data, salt)) : hash6(data, salt, new Uint8Array(0)));
      if (!eqBytes(h(pw, u.subarray(32, 40)), u, 32)) throw new Error('password');
      const ik = h(pw, u.subarray(40, 48));
      if (!e.ue || e.ue.length < 32) throw new Error('UE');
      this.key = aesCbcDecrypt(ik, new Uint8Array(16), e.ue.subarray(0, 32), false);
      return;
    }
    // Algorithmus 2 (RC4/AES-128) mit leerem Benutzerkennwort
    const n = e.r === 2 ? 5 : Math.max(5, Math.min(16, Math.floor((e.length || 40) / 8)));
    const p = new Uint8Array([e.p & 255, (e.p >> 8) & 255, (e.p >> 16) & 255, (e.p >>> 24) & 255]);
    let k = md5(cat(PAD, e.o.subarray(0, 32), p, e.id0, e.r >= 4 && !e.encryptMetadata ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array(0)));
    if (e.r >= 3) for (let i = 0; i < 50; i++) k = md5(k.subarray(0, n));
    this.key = k.slice(0, n);
    // Prüfen, ob das leere Kennwort passt (Algorithmus 4/5)
    let ok: boolean;
    if (e.r === 2) ok = eqBytes(rc4(this.key, PAD), e.u, 32);
    else {
      let x = rc4(this.key, md5(cat(PAD, e.id0)));
      for (let i = 1; i <= 19; i++)
        x = rc4(
          this.key.map((b) => b ^ i),
          x,
        );
      ok = eqBytes(x, e.u, 16);
    }
    if (!ok) throw new Error('password');
  }

  private objKey(num: number, gen: number, aes: boolean): Uint8Array {
    const k = this.key;
    const ext = cat(k, new Uint8Array([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255]), aes ? new Uint8Array([0x73, 0x41, 0x6c, 0x54]) : new Uint8Array(0));
    return md5(ext).subarray(0, Math.min(16, k.length + 5));
  }

  private run(method: EncryptInfo['stmMethod'], num: number, gen: number, data: Uint8Array): Uint8Array {
    if (method === 'Identity') return data;
    if (method === 'AESV3') return data.length < 16 ? new Uint8Array(0) : aesCbcDecrypt(this.key, data.subarray(0, 16), data.subarray(16));
    if (method === 'AESV2') return data.length < 16 ? new Uint8Array(0) : aesCbcDecrypt(this.objKey(num, gen, true), data.subarray(0, 16), data.subarray(16));
    return rc4(this.objKey(num, gen, false), data);
  }
  stream(num: number, gen: number, data: Uint8Array) {
    return this.run(this.e.stmMethod, num, gen, data);
  }
  string(num: number, gen: number, data: Uint8Array) {
    return this.run(this.e.strMethod, num, gen, data);
  }
}
