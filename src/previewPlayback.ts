// Reine Abspiellogik der Vorschau: Prozessarten, Glättung, Pausen und Zeitmarken.
// Bewusst ohne DOM, damit die Berechnung unabhängig prüfbar bleibt.
import { dwellSeconds, MOVE_CUT, MOVE_ENGRAVE, MOVE_TRAVEL } from './gcode';
import type { Estimate, Moves } from './gcode';

/** 0 = reine Verfahrbewegung; 1 = Gravieren (Füllen, Bild); 2 = Schneiden (Linien) */
export const PROCESS_ENGRAVE = MOVE_ENGRAVE;
export const PROCESS_CUT = MOVE_CUT;
export const PROCESS_TRAVEL = MOVE_TRAVEL;

export interface PlaybackSettings {
  /** Traditioneller Faktor für Gravieren */
  engrave: number;
  /** Traditioneller Faktor für Schneiden */
  cut: number;
  /** Prozessarten zeitlich angleichen */
  smooth: boolean;
  /** Ziel-Abspielzeit je Prozessart in Sekunden */
  target: number;
}

export interface LayerTime {
  layer: number;
  /** Sublayer-Index im Layer, -1 = Hauptbearbeitung */
  sub: number;
  seconds: number;
  share: number;
}

export interface ProcessTimes {
  engrave: number;
  cut: number;
  travel: number;
}

export interface TimelineMarker {
  /** Simulationszeit in Sekunden */
  time: number;
  layer: number;
  /** Sublayer-Index im Layer, -1 = Hauptbearbeitung */
  sub: number;
  /** Prozessart der Bearbeitung, die hier beginnt */
  process: typeof PROCESS_ENGRAVE | typeof PROCESS_CUT;
  /** Prozessart wechselt gegenüber der vorigen Bearbeitung */
  change: boolean;
}

export interface PlaybackAnalysis {
  /** Effektive Prozessart je Bewegung; Verfahrwege erben die vorige Arbeitsart */
  segmentProcess: Uint8Array;
  processTimes: ProcessTimes;
  layerTimes: LayerTime[];
  markers: TimelineMarker[];
  factors: { engrave: number; cut: number };
}

export const MAX_FACTOR = 1000;
/** Ab dieser Anzahl werden Marken zu einer einzelnen Layer-Auswahl zusammengefasst. */
export const MAX_MARKERS = 24;
export const MIN_TARGET = 1;
export const MAX_TARGET = 600;
export const DEFAULT_TARGET = 20;

const clampFactor = (v: number) => (Number.isFinite(v) ? Math.min(MAX_FACTOR, Math.max(1, v)) : 1);

/** Prozessart einer Bewegung; ältere/junction-freie Bewegungslisten gelten als Gravieren. */
export function segmentProcessAt(mv: Moves, i: number): number {
  const c = i < mv.cls.length ? mv.cls[i] : 0;
  if (c === PROCESS_CUT) return PROCESS_CUT;
  if (c === PROCESS_ENGRAVE) return PROCESS_ENGRAVE;
  return mv.s[i] > 0 ? PROCESS_ENGRAVE : PROCESS_TRAVEL;
}

export function computeFactors(processTimes: ProcessTimes, s: PlaybackSettings): { engrave: number; cut: number } {
  if (!s.smooth) return { engrave: clampFactor(s.engrave), cut: clampFactor(s.cut) };
  const target = Number.isFinite(s.target) && s.target > 0 ? s.target : DEFAULT_TARGET;
  return { engrave: clampFactor(processTimes.engrave / target), cut: clampFactor(processTimes.cut / target) };
}

/** Zeiten, Zeitmarken und Abspielfaktoren aus Bewegungen und Zeitschätzung ableiten. */
export function analyzePlayback(mv: Moves, est: Estimate, settings: PlaybackSettings): PlaybackAnalysis {
  const n = mv.n;
  const total = Math.max(0, est.total);
  const segmentProcess = new Uint8Array(n);
  const processTimes: ProcessTimes = { engrave: 0, cut: 0, travel: 0 };
  const layerMap = new Map<string, number>();
  const markers: TimelineMarker[] = [];

  let firstWorking = PROCESS_TRAVEL;
  for (let i = 0; i < n; i++) {
    const dt = Math.max(0, est.t[i] - (i ? est.t[i - 1] : 0));
    const raw = segmentProcessAt(mv, i);
    segmentProcess[i] = raw;
    if (raw === PROCESS_ENGRAVE) processTimes.engrave += dt;
    else if (raw === PROCESS_CUT) processTimes.cut += dt;
    else processTimes.travel += dt;
    if (raw !== PROCESS_TRAVEL && firstWorking === PROCESS_TRAVEL) firstWorking = raw;
  }

  // Verfahrwege vor der ersten Arbeitsbewegung gehören zur kommenden Art; spätere erben die vorige.
  let eff = firstWorking === PROCESS_TRAVEL ? PROCESS_ENGRAVE : firstWorking;
  let lastLayer = -2;
  let lastSub = -2;
  /** Erste Arbeitsklasse der zuletzt gesehenen Bearbeitung; Eilgänge davor zählen nicht. */
  let lastMarkerProcess: number | null = null;
  let groupHasWorking = false;
  let markerTime = 0;

  const subOf = (mv as { sub?: ArrayLike<number> }).sub;
  const subAt = (i: number) => (subOf && i < subOf.length ? subOf[i] : -1);

  for (let i = 0; i < n; i++) {
    const raw = segmentProcess[i];
    if (raw !== PROCESS_TRAVEL) eff = raw;
    segmentProcess[i] = eff;

    const layer = mv.layer[i];
    const sub = subAt(i);
    const dt = Math.max(0, est.t[i] - (i ? est.t[i - 1] : 0));
    if (layer >= 0) {
      const key = `${layer}:${sub}`;
      layerMap.set(key, (layerMap.get(key) ?? 0) + dt);
      if (layer !== lastLayer || sub !== lastSub) {
        lastLayer = layer;
        lastSub = sub;
        groupHasWorking = false;
        markerTime = i ? est.t[i - 1] : 0;
      }
      if (raw !== PROCESS_TRAVEL && !groupHasWorking) {
        groupHasWorking = true;
        // Eine Bearbeitung mit reinen Verfahrwegen bekommt keine Marke.
        if (markerTime > 0) {
          markers.push({
            time: markerTime,
            layer,
            sub,
            process: raw as TimelineMarker['process'],
            change: lastMarkerProcess !== null && lastMarkerProcess !== raw,
          });
        }
        lastMarkerProcess = raw;
      }
    }
  }

  // Der Bildschnitt (sub = -2) wird nach Haupt- und Sublayern desselben Layers einsortiert.
  // Zeitmarken bleiben von der Anzeigesortierung unberührt.
  const subRank = (s: number) => (s === -2 ? Number.MAX_SAFE_INTEGER : s === -1 ? 0 : s + 1);
  const layerTimes: LayerTime[] = [...layerMap.entries()]
    .map(([key, seconds]) => {
      const [layer, sub] = key.split(':').map(Number);
      return { layer, sub, seconds, share: total > 0 ? seconds / total : 0 };
    })
    .sort((a, b) => a.layer - b.layer || subRank(a.sub) - subRank(b.sub));

  return { segmentProcess, processTimes, layerTimes, markers, factors: computeFactors(processTimes, settings) };
}

const segmentAt = (mv: Moves, est: Estimate, time: number) => {
  let lo = 0,
    hi = mv.n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (est.t[mid] <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

export interface AdvanceResult {
  time: number;
  paused: boolean;
}

/** Anteil der aktuellen Bewegung für die Kopfinterpolation der Vorschau. */
export function segmentFraction(mv: Moves, est: Estimate, i: number, time: number): number {
  const t0 = i ? est.t[i - 1] : 0,
    t1 = est.t[i];
  const dw = dwellSeconds(mv, i, est);
  const tm = Math.min(t1, t0 + dw);
  return t1 > tm ? Math.min(1, Math.max(0, (time - tm) / (t1 - tm))) : time >= tm ? 1 : 0;
}

/**
 * Simulationszeit um echte Sekunden weiterrücken. Jede Bewegung läuft mit dem Faktor ihrer effektiven
 * Prozessart; mit pauseOnChange endet der Schritt genau am Wechsel der Prozessart.
 */
export function advancePlayback(
  mv: Moves,
  est: Estimate,
  analysis: PlaybackAnalysis,
  time: number,
  realSeconds: number,
  pauseOnChange: boolean,
): AdvanceResult {
  const total = Math.max(0, est.total);
  let t = Math.min(total, Math.max(0, time));
  let remaining = Math.max(0, realSeconds);
  if (!(remaining > 0) || t >= total) return { time: t, paused: false };

  const factorAt = (i: number) =>
    analysis.segmentProcess[i] === PROCESS_CUT ? analysis.factors.cut : analysis.factors.engrave;

  for (let guard = 0; remaining > 1e-9 && t < total && guard < 20000; guard++) {
    const i = segmentAt(mv, est, t);
    if (i >= mv.n) {
      t = Math.min(total, t + remaining);
      break;
    }
    const t0 = i ? est.t[i - 1] : 0;
    const t1 = Math.min(total, est.t[i]);
    if (!(t1 > t0)) {
      t = Math.max(t, t1);
      continue;
    }
    // Pause vor der Bewegung läuft in Echtzeit (Faktor 1): der Kopf steht still,
    // egal wie schnell die Vorschau die Bewegung abspielt.
    const dw = dwellSeconds(mv, i, est);
    const tDwellEnd = Math.min(t1, t0 + dw);
    if (t < tDwellEnd) {
      const needDwell = tDwellEnd - t;
      if (needDwell > remaining) {
        t += remaining;
        remaining = 0;
        break;
      }
      t = tDwellEnd;
      remaining -= needDwell;
      continue;
    }
    const f = factorAt(i);
    const needed = (t1 - t) / f;
    if (needed > remaining) {
      t += remaining * f;
      remaining = 0;
      break;
    }
    t = t1;
    remaining -= needed;
    if (pauseOnChange && i + 1 < mv.n && analysis.segmentProcess[i + 1] !== analysis.segmentProcess[i]) {
      return { time: t, paused: true };
    }
  }
  return { time: Math.min(total, t), paused: false };
}
