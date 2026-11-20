import { Device, fireLines } from './gcode';
import { t } from './i18n';

/** Single source for the Fire lock message: every blocked action cites the same text. */
export const fireLockMessage = () =>
  t('Testfeuer ungeklärt. Laser am Gerät prüfen und Abschaltung bestätigen.');

export interface FireRequest {
  lines: string[];
  seconds: number;
  deviceId: string;
}

/** Fail closed, including legacy unlimited-duration settings. No silent input clamping. */
export function fireRequest(d: Device, power: number, seconds: number): FireRequest | null {
  const positive = (n: number, max: number) => Number.isFinite(n) && n > 0 && n <= max;
  if (d.fireEnabled !== true || d.conn === 'remote' ||
      !['grbl', 'grblhal', 'fluidnc', 'marlin', 'smoothie'].includes(d.fw) ||
      !positive(d.fireMaxPower, 100) || !positive(d.fireMaxSeconds, 600) ||
      !positive(power, d.fireMaxPower) || !positive(seconds, d.fireMaxSeconds) ||
      !positive(d.sMax, Number.MAX_SAFE_INTEGER)) return null;
  return { lines: fireLines(d, power), seconds, deviceId: d.id };
}

interface FireTransport {
  send(line: string): Promise<void>;
  stop(): Promise<void>;
  now(): number;
  schedule(fn: () => void, ms: number): () => void;
  changed(): void;
}

/** Software best effort only: neither a queued stop nor elapsed time proves physical shutdown. */
export class FireSession {
  state: 'idle' | 'starting' | 'firing' | 'unknown' = 'idle';
  deviceId = '';
  private generation = 0;
  private pending = 0;
  private deadline = 0;
  private cancel: (() => void) | null = null;
  constructor(private readonly io: FireTransport) {}
  get locked() { return this.state !== 'idle'; }
  get canConfirm() { return this.state === 'unknown' && this.pending === 0; }
  get remaining() { return Math.max(0, Math.ceil((this.deadline - this.io.now()) / 1000)); }

  async start(request: FireRequest) {
    if (this.locked) return;
    const generation = ++this.generation;
    this.deviceId = request.deviceId;
    this.state = 'starting';
    this.deadline = this.io.now() + request.seconds * 1000;
    this.pending++;
    this.io.changed();
    const tick = () => {
      if (generation !== this.generation) return;
      if (this.io.now() >= this.deadline) { void this.stop(); return; }
      this.io.changed();
      this.cancel = this.io.schedule(tick, Math.min(200, this.deadline - this.io.now()));
    };
    tick();
    try {
      for (const line of request.lines) {
        if (generation !== this.generation) return;
        if (this.io.now() >= this.deadline) { await this.stop(); return; }
        await this.io.send(line);
      }
      if (generation === this.generation) this.state = 'firing';
    } catch {
      await this.stop();
    } finally {
      // A pending write may finish after stop: send stop again, never a remaining start line.
      if (generation !== this.generation) await this.attemptStop();
      this.pending--;
      this.io.changed();
    }
  }

  private async attemptStop() {
    try { await this.io.stop(); } catch { /* State stays unknown; operator must check at the device. */ }
  }

  /** Teardown must cancel native activation and close before resolving, not merely enqueue close. */
  async stop(teardown?: () => Promise<void>) {
    if (!this.locked) return;
    ++this.generation;
    this.cancel?.();
    this.cancel = null;
    this.state = 'unknown';
    this.pending++;
    this.io.changed();
    try { if (teardown) await teardown(); else await this.attemptStop(); }
    finally { this.pending--; this.io.changed(); }
  }

  /** Called only by an explicit local acknowledgement after physically checking shutdown. */
  confirmOff(): boolean {
    if (!this.canConfirm) return false;
    this.state = 'idle';
    this.deviceId = '';
    this.io.changed();
    return true;
  }
}
