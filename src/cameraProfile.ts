import type { CameraCalib, CameraMount } from './camera';
import type { Pt } from './model';

export interface CameraFineTune {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface CameraImageAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  grayscale: boolean;
}

export const DEFAULT_FINE_TUNE: Readonly<CameraFineTune> = Object.freeze({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 });
export const DEFAULT_IMAGE_ADJUSTMENTS: Readonly<CameraImageAdjustments> = Object.freeze({ brightness: 1, contrast: 1, saturation: 1, gamma: 1, grayscale: false });
export const CAMERA_PROFILE_SCHEMA = 'kizamubeam.camera-profile';
export const CAMERA_PROFILE_VERSION = 1;
export const MAX_CAMERA_PROFILE_BYTES = 256 * 1024;

export interface CameraProfileInput {
  mount: CameraMount;
  name: string;
  cameraLabel: string;
  width: number;
  height: number;
  calib: CameraCalib;
  fineTune: CameraFineTune;
  image: CameraImageAdjustments;
}

export interface CameraProfile extends CameraProfileInput {
  schema: typeof CAMERA_PROFILE_SCHEMA;
  version: typeof CAMERA_PROFILE_VERSION;
}

type RecordValue = Record<string, unknown>;

export class CameraProfileError extends Error {
  constructor(readonly field: string) { super(`Invalid camera profile: ${field}`); }
}

function invalid(field: string): never {
  throw new CameraProfileError(field);
}

function record(value: unknown, field: string): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value as RecordValue;
}

// Only inspect known own data properties: never walk prototypes or invoke getters.
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function number(value: unknown, min: number, max: number, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(field);
  return value;
}

function text(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || value.length > max) invalid(field);
  return value;
}

const tuneRanges = { offsetX: [-10000, 10000], offsetY: [-10000, 10000], scaleX: [0.1, 10], scaleY: [0.1, 10], rotation: [-180, 180] } as const;
const imageRanges = { brightness: [0, 3], contrast: [0, 3], saturation: [0, 3], gamma: [0.1, 5] } as const;

function readFineTune(value: unknown, strict: boolean): CameraFineTune {
  if (strict) record(value, 'fineTune');
  const result = { ...DEFAULT_FINE_TUNE };
  for (const key of Object.keys(tuneRanges) as (keyof CameraFineTune)[]) {
    const v = own(value, key);
    const [min, max] = tuneRanges[key];
    if (strict) result[key] = number(v, min, max, `fineTune.${key}`);
    else if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) result[key] = v;
  }
  return result;
}

function readImage(value: unknown, strict: boolean): CameraImageAdjustments {
  if (strict) record(value, 'image');
  const result = { ...DEFAULT_IMAGE_ADJUSTMENTS };
  for (const key of Object.keys(imageRanges) as (keyof typeof imageRanges)[]) {
    const v = own(value, key);
    const [min, max] = imageRanges[key];
    if (strict) result[key] = number(v, min, max, `image.${key}`);
    else if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) result[key] = v;
  }
  const grayscale = own(value, 'grayscale');
  if (strict && typeof grayscale !== 'boolean') invalid('image.grayscale');
  if (typeof grayscale === 'boolean') result.grayscale = grayscale;
  return result;
}

/** Invalid locally stored fields independently fall back to identity defaults. */
export function normalizeFineTune(value: unknown): CameraFineTune {
  return readFineTune(value, false);
}

export function normalizeImageAdjustments(value: unknown): CameraImageAdjustments {
  return readImage(value, false);
}

function dimension(value: unknown, field: string): number {
  const result = number(value, 1, 100000, field);
  if (!Number.isInteger(result)) invalid(field);
  return result;
}

function calibration(value: unknown, mount: CameraMount): CameraCalib {
  const c = record(value, 'calib');
  const sourceH = own(c, 'H');
  if (!Array.isArray(sourceH) || sourceH.length !== 9) invalid('calib.H');
  const H = Array.from({ length: 9 }, (_, i) => number(own(sourceH, String(i)), -1e12, 1e12, 'calib.H'));
  // Normalize magnitude before computing the determinant to avoid overflow.
  const magnitude = Math.max(...H.map(Math.abs));
  if (!magnitude) invalid('calib.H is singular');
  const [a, b, c0, d, e, f, g, h, i] = H.map((v) => v / magnitude);
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c0 * (d * h - e * g);
  if (!Number.isFinite(det) || det === 0) invalid('calib.H is singular');
  const result: CameraCalib = {
    w: dimension(own(c, 'w'), 'calib.w'),
    h: dimension(own(c, 'h'), 'calib.h'),
    k1: number(own(c, 'k1'), -100, 100, 'calib.k1'),
    k2: number(own(c, 'k2'), -100, 100, 'calib.k2'),
    H,
    err: number(own(c, 'err'), 0, 100000, 'calib.err'),
    maxErr: number(own(c, 'maxErr'), 0, 100000, 'calib.maxErr'),
    bedW: number(own(c, 'bedW'), Number.MIN_VALUE, 100000, 'calib.bedW'),
    bedH: number(own(c, 'bedH'), Number.MIN_VALUE, 100000, 'calib.bedH'),
    date: text(own(c, 'date'), 128, 'calib.date'),
  };
  const head = own(c, 'head');
  if (mount === 'fixed' && head !== undefined) invalid('fixed mount cannot have calib.head');
  if (mount === 'head') {
    record(head, 'calib.head');
    result.head = {
      x: number(own(head, 'x'), -100000, 100000, 'calib.head.x'),
      y: number(own(head, 'y'), -100000, 100000, 'calib.head.y'),
    };
  }
  return result;
}

function profile(value: unknown, requireSchema: boolean): CameraProfile {
  const p = record(value, 'profile');
  if (requireSchema && (own(p, 'schema') !== CAMERA_PROFILE_SCHEMA || own(p, 'version') !== CAMERA_PROFILE_VERSION)) invalid('unsupported schema or version');
  const mount = own(p, 'mount');
  if (mount !== 'fixed' && mount !== 'head') invalid('mount');
  return {
    schema: CAMERA_PROFILE_SCHEMA,
    version: CAMERA_PROFILE_VERSION,
    mount,
    name: text(own(p, 'name'), 256, 'name'),
    cameraLabel: text(own(p, 'cameraLabel'), 1024, 'cameraLabel'),
    width: dimension(own(p, 'width'), 'width'),
    height: dimension(own(p, 'height'), 'height'),
    calib: calibration(own(p, 'calib'), mount),
    fineTune: readFineTune(own(p, 'fineTune'), true),
    image: readImage(own(p, 'image'), true),
  };
}

function checkSize(text: string): void {
  // Cheap precheck avoids allocating a huge UTF-8 encoding for oversized input.
  if (text.length > MAX_CAMERA_PROFILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_CAMERA_PROFILE_BYTES) invalid('file exceeds 256 KiB');
}

/** Validate and deep-copy portable calibration data only; never applies it. */
export function parseCameraProfile(text: string): CameraProfile {
  if (typeof text !== 'string') invalid('text');
  checkSize(text);
  return profile(JSON.parse(text), true);
}

/** Whitelist, validate and copy before serialization; identifiers/connections are omitted. */
export function serializeCameraProfile(input: CameraProfileInput): string {
  const result = JSON.stringify(profile(input, false), null, 2);
  checkSize(result);
  return result;
}

/** Scale about the bed center, rotate counterclockwise (Cartesian Y up), then offset. */
export function fineTunePoint(point: Pt, tune: CameraFineTune, bedW: number, bedH: number): Pt {
  const x = (point.x - bedW / 2) * tune.scaleX;
  const y = (point.y - bedH / 2) * tune.scaleY;
  const angle = tune.rotation * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: bedW / 2 + x * c - y * s + tune.offsetX, y: bedH / 2 + x * s + y * c + tune.offsetY };
}

export function inverseFineTunePoint(point: Pt, tune: CameraFineTune, bedW: number, bedH: number): Pt {
  const x = point.x - bedW / 2 - tune.offsetX;
  const y = point.y - bedH / 2 - tune.offsetY;
  const angle = tune.rotation * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: bedW / 2 + (x * c + y * s) / tune.scaleX, y: bedH / 2 + (-x * s + y * c) / tune.scaleY };
}
