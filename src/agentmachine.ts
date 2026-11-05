// Werkzeuge der Stufen 3 (G-Code) und 4 (Maschine) für KI-Agenten.
// Sicherheitsregeln: Ein Agent sendet nie rohen G-Code. Job, Rahmen und Referenzfahrt fordert er nur an; los geht es
// erst, wenn die Person in KizamuBeam im Bestätigungsdialog klickt. Jobs von Agenten müssen im Arbeitsbereich liegen
// und die Grenzen des Geräts (höchste Leistung, kleinste Geschwindigkeit) einhalten, die nur die Person einstellt.
// Anhalten und Stoppen gehen immer. Jede Maschinenaktion landet zusätzlich in einer Protokolldatei.
import type { Editor } from './editor';
import { h } from './dom';
import { estimate, formatDuration, frameGCode, FIRMWARES, Job, prepareGCode, rotaryOn, writeGCode } from './gcode';
import { isTauri, machine } from './machine';
import { bedCheck, bedProblem, device, laserNotify, makeJob, runBlocker, runGCode } from './laser';
import { layerLabel, Pt } from './model';
import { Args, Content, json, log, r3, Tier, ToolDef, ToolError } from './agentutil';
import { locale, t } from './i18n';

// ---------- Protokolldatei ----------

function machineLog(text: string) {
  log({ time: new Date(), tool: t('Maschine'), summary: text, ok: true });
  if (!isTauri()) return;
  import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('agent_machine_log', { line: `${new Date().toISOString()} ${text}` }))
    .catch(() => {});
}

// ---------- Auswertung des Jobs ----------

interface LayerStats {
  maxPower: number;
  minSpeed: number;
  maxSpeed: number;
  length: number;
}

/** Leistung und Geschwindigkeit je Layer, so wie sie an die Maschine gehen */
function layerStats(job: Job): Map<number, LayerStats> {
  const mv = job.moves;
  const out = new Map<number, LayerStats>();
  let px = mv.x0,
    py = mv.y0;
  for (let i = 0; i < mv.n; i++) {
    const x = mv.x[i],
      y = mv.y[i];
    if (mv.f[i] > 0 && mv.s[i] > 0) {
      let st = out.get(mv.layer[i]);
      if (!st) out.set(mv.layer[i], (st = { maxPower: 0, minSpeed: Infinity, maxSpeed: 0, length: 0 }));
      st.maxPower = Math.max(st.maxPower, mv.s[i]);
      st.minSpeed = Math.min(st.minSpeed, mv.f[i]);
      st.maxSpeed = Math.max(st.maxSpeed, mv.f[i]);
      st.length += Math.hypot(x - px, y - py);
    }
    px = x;
    py = y;
  }
  return out;
}

const layerName = (ed: Editor, i: number) => `${layerLabel(i)} ${ed.layer(i).name}`.trim();

/** Verstöße gegen die Grenzen des Geräts für Agenten-Jobs */
function limitProblems(ed: Editor, stats: Map<number, LayerStats>): string[] {
  const out: string[] = [];
  for (const [i, st] of stats) {
    const p = st.maxPower * 100;
    if (p > device.agentMaxPower + 1e-6)
      out.push(t('Layer {layer}: {p} % Leistung, für Agenten erlaubt sind höchstens {max} %.', { layer: layerName(ed, i), p: r3(p), max: device.agentMaxPower }));
    if (device.agentMinSpeed > 0 && st.minSpeed < device.agentMinSpeed - 1e-6)
      out.push(t('Layer {layer}: {f} mm/min, für Agenten erlaubt sind mindestens {min} mm/min.', { layer: layerName(ed, i), f: Math.round(st.minSpeed), min: device.agentMinSpeed }));
  }
  return out;
}

/** Liegt der Job samt Überfahrwegen außerhalb des Bettes? (null = nein oder beim Benutzer-Ursprung nicht feststellbar) */
function outsideBed(ed: Editor, job: Job): string | null {
  const c = bedCheck(ed, job);
  return c.kind === 'out' ? bedProblem(ed, job, c)!.replace(/\n/g, ' ') : null;
}

async function buildJob(ed: Editor): Promise<Job> {
  const job = await makeJob(ed, false);
  if (!job.moves.n)
    throw new ToolError(device.cutSelected ? 'Nichts zu lasern: „Nur Auswahl“ ist an, und die Auswahl ist leer oder liegt auf Layern ohne Ausgabe.' : 'Nichts zu lasern: keine Objekte auf Layern mit Ausgabe.');
  return job;
}

function jobSummary(ed: Editor, job: Job) {
  const est = estimate(job.moves, device);
  const b = job.bounds!;
  const stats = layerStats(job);
  const problems = limitProblems(ed, stats);
  const outside = outsideBed(ed, job);
  return {
    est,
    stats,
    problems,
    outside,
    data: {
      device: device.name,
      firmware: FIRMWARES[device.fw].label,
      durationSeconds: Math.round(est.total),
      laserPathMeters: r3(est.cutLength / 1000),
      travelMeters: r3(est.rapidLength / 1000),
      area: { x: r3(b.x0), y: r3(b.y0), w: r3(b.x1 - b.x0), h: r3(b.y1 - b.y0) },
      startFrom: device.startFrom,
      rotary: rotaryOn(device) ? { ...device.rotary } : null,
      layers: [...stats].map(([i, st]) => ({
        layer: i, name: ed.layer(i).name, maxPowerPercent: r3(st.maxPower * 100),
        speedMmPerMin: st.minSpeed === st.maxSpeed ? Math.round(st.minSpeed) : [Math.round(st.minSpeed), Math.round(st.maxSpeed)],
        laserPathMeters: r3(st.length / 1000),
      })),
      agentLimits: { maxPowerPercent: device.agentMaxPower, minSpeedMmPerMin: device.agentMinSpeed },
      withinAgentLimits: !problems.length,
      limitProblems: problems,
      // null = beim Benutzer-Ursprung nicht prüfbar, solange die Steuerung den Ursprung nicht gemeldet hat
      insideBed: bedCheck(ed, job).kind === 'unknown' ? null : !outside,
      warnings: job.warnings,
    },
  };
}

// ---------- Anfragen an die Person ----------

type Kind = 'job' | 'frame' | 'home';
type State = 'waiting' | 'started' | 'declined' | 'expired' | 'failed';

interface Request {
  id: number;
  kind: Kind;
  state: State;
  message: string;
  at: Date;
  settled: Promise<void>;
  cancel: (message: string) => void;
}

let current: Request | null = null;
let nextId = 1;
/** So lange bleibt ein Bestätigungsdialog offen, danach gilt die Anfrage als abgelehnt */
const EXPIRE_MS = 5 * 60_000;

export const requestState = () =>
  current && { id: current.id, kind: current.kind, state: current.state, message: current.message, requestedAt: current.at.toISOString() };

const KIND_LABEL: Record<Kind, string> = { job: 'Job', frame: 'Rahmen', home: 'Referenzfahrt' };

interface View {
  title: string;
  content: (HTMLElement | string)[];
  confirm: string;
  /** Führt die Aktion aus; Rückgabe: Fehlertext oder null */
  action: () => Promise<string | null>;
  started: string;
}

function ask(kind: Kind, summary: string, v: View): Request {
  if (current?.state === 'waiting') throw new ToolError(`Es wartet bereits eine Anfrage (${KIND_LABEL[current.kind]}) auf die Person.`);
  let done!: () => void;
  const r: Request = {
    id: nextId++, kind, state: 'waiting', message: 'Wartet auf die Bestätigung der Person in KizamuBeam.', at: new Date(),
    settled: new Promise<void>((res) => (done = res)),
    cancel: () => {},
  };
  current = r;
  machineLog(`#${r.id} ${KIND_LABEL[kind]} angefordert: ${summary}`);

  let timer = 0;
  const finish = (state: State, message: string) => {
    if (r.state !== 'waiting') return;
    r.state = state;
    r.message = message;
    clearTimeout(timer);
    machineLog(`#${r.id} ${KIND_LABEL[kind]}: ${message}`);
    done();
    if (dlg.open) dlg.close();
  };
  r.cancel = (m) => finish('declined', m);
  let acting = false;
  const okBtn = h('button', {
    class: 'btn primary',
    onclick: async () => {
      if (acting || r.state !== 'waiting') return;
      acting = true;
      okBtn.disabled = true;
      const err = await v.action().catch((e) => String(e));
      if (err) {
        laserNotify(err, true);
        finish('failed', `Bestätigt, aber nicht ausführbar: ${err}`);
      } else finish('started', v.started);
    },
  }, v.confirm) as HTMLButtonElement;
  const dlg = h('dialog', { class: 'agent-confirm' },
    h('h3', {}, v.title),
    h('p', { class: 'agent-confirm-who' }, t('Von einem KI-Agenten angefordert. Es passiert nichts, bevor du bestätigst.')),
    ...v.content,
    h('div', { class: 'dialog-buttons' },
      h('button', { class: 'btn', onclick: () => finish('declined', 'Von der Person abgelehnt.') }, t('Ablehnen')),
      okBtn,
    ),
  );
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => {
    finish('declined', 'Von der Person abgelehnt.');
    dlg.remove();
  });
  document.body.append(dlg);
  dlg.showModal();
  // Mit Enter nicht versehentlich bestätigen: Fokus auf „Ablehnen“
  (dlg.querySelector('.dialog-buttons .btn') as HTMLElement).focus();
  timer = window.setTimeout(() => finish('expired', 'Keine Entscheidung innerhalb von 5 Minuten, Anfrage verfallen.'), EXPIRE_MS);
  attention();
  return r;
}

/** Fenster nach vorne holen bzw. in der Taskleiste/im Dock blinken lassen */
async function attention() {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow, UserAttentionType } = await import('@tauri-apps/api/window');
    await getCurrentWindow().requestUserAttention(UserAttentionType.Critical);
  } catch {
    /* nicht erlaubt oder nicht unterstützt */
  }
}

const waitArg = {
  wait_seconds: { type: 'integer', minimum: 0, maximum: 110, description: 'So lange auf die Entscheidung warten (Standard 45). Danach weiter mit wait_for_confirmation.' },
};
const waitSeconds = (a: Args) => Math.max(0, Math.min(110, Math.round(Number(a.wait_seconds ?? 45))));

async function waitFor(r: Request, seconds: number): Promise<Content[]> {
  await Promise.race([r.settled, new Promise((res) => setTimeout(res, seconds * 1000))]);
  const st = requestState()!;
  return json({
    ...st,
    ...(r.state === 'waiting' ? { hint: 'Die Person hat noch nicht entschieden. Mit wait_for_confirmation weiter warten.' } : {}),
  });
}

// ---------- Vorschau im Dialog ----------

function jobCanvas(ed: Editor, job: Job, outline?: Pt[]): HTMLCanvasElement {
  const W = 440,
    H = 300,
    dpr = window.devicePixelRatio || 1;
  const cv = h('canvas', { class: 'agent-confirm-preview' }) as HTMLCanvasElement;
  cv.width = W * dpr;
  cv.height = H * dpr;
  cv.style.width = `${W}px`;
  cv.style.height = `${H}px`;
  const c = cv.getContext('2d')!;
  c.scale(dpr, dpr);
  const bed = ed.doc.bed,
    tb = job.travel;
  const x0 = Math.min(0, tb?.x0 ?? 0),
    y0 = Math.min(0, tb?.y0 ?? 0),
    x1 = Math.max(bed.w, tb?.x1 ?? 0),
    y1 = Math.max(bed.h, tb?.y1 ?? 0);
  const z = Math.min((W - 20) / (x1 - x0), (H - 20) / (y1 - y0));
  const ox = (W - (x1 - x0) * z) / 2,
    oy = (H - (y1 - y0) * z) / 2;
  const sx = (x: number) => ox + (x - x0) * z,
    sy = (y: number) => H - oy - (y - y0) * z;
  const css = getComputedStyle(document.documentElement);
  c.fillStyle = css.getPropertyValue('--surface').trim() || '#fff';
  c.fillRect(sx(0), sy(bed.h), bed.w * z, bed.h * z);
  c.strokeStyle = css.getPropertyValue('--line').trim() || '#ccc';
  c.lineWidth = 1;
  c.strokeRect(sx(0), sy(bed.h), bed.w * z, bed.h * z);
  const mv = job.moves;
  const paths = new Map<number, Path2D>();
  let px = mv.x0,
    py = mv.y0;
  for (let i = 0; i < mv.n; i++) {
    if (mv.f[i] > 0 && mv.s[i] > 0) {
      let p = paths.get(mv.layer[i]);
      if (!p) paths.set(mv.layer[i], (p = new Path2D()));
      p.moveTo(sx(px), sy(py));
      p.lineTo(sx(mv.x[i]), sy(mv.y[i]));
    }
    px = mv.x[i];
    py = mv.y[i];
  }
  c.lineWidth = 1;
  for (const [l, p] of paths) {
    c.strokeStyle = ed.layerDrawColor(l);
    c.stroke(p);
  }
  if (outline?.length) {
    c.strokeStyle = '#e02020';
    c.setLineDash([4, 3]);
    c.beginPath();
    outline.forEach((q, i) => (i ? c.lineTo(sx(q.x), sy(q.y)) : c.moveTo(sx(q.x), sy(q.y))));
    c.closePath();
    c.stroke();
  }
  return cv;
}

const stat = (k: string, v: string) => [h('dt', {}, k), h('dd', {}, v)];

function layerTable(ed: Editor, stats: Map<number, LayerStats>): HTMLElement {
  return h('table', { class: 'agent-confirm-layers' },
    h('tr', {}, h('th', {}, t('Layer')), h('th', {}, t('Leistung')), h('th', {}, t('Geschwindigkeit')), h('th', {}, t('Laserweg'))),
    ...[...stats].map(([i, st]) =>
      h('tr', {},
        h('td', {}, h('span', { class: 'swatch', style: `background:${ed.layerDrawColor(i)}` }), layerName(ed, i)),
        h('td', {}, t('bis {p} %', { p: (st.maxPower * 100).toLocaleString(locale, { maximumFractionDigits: 1 }) })),
        h('td', {}, st.minSpeed === st.maxSpeed ? `${Math.round(st.minSpeed)} mm/min` : `${Math.round(st.minSpeed)} … ${Math.round(st.maxSpeed)} mm/min`),
        h('td', {}, `${(st.length / 1000).toLocaleString(locale, { maximumFractionDigits: 2 })} m`),
      )),
  );
}

function agentNote(a: Args): HTMLElement[] {
  const m = typeof a.message === 'string' ? a.message.trim().slice(0, 500) : '';
  return m ? [h('div', { class: 'agent-confirm-note' }, h('b', {}, t('Nachricht des Agenten:')), ' ', m)] : [];
}

// ---------- Werkzeuge ----------

const desktopOnly = () => {
  if (!isTauri()) throw new ToolError('Nur in der Desktop-App');
};

export const GCODE_TOOLS: ToolDef[] = [
  {
    name: 'generate_gcode',
    title: 'G-Code erzeugen',
    description:
      'Erzeugt den G-Code der aktuellen Seite für das gewählte Gerät, genau wie „G-Code speichern“, und liefert eine Zusammenfassung (Dauer, Bereich, Leistung und Geschwindigkeit je Layer, ob der Job in den Grenzen für Agenten-Jobs liegt) plus die ersten Zeilen. Sendet nichts an die Maschine.',
    tier: Tier.GCode,
    inputSchema: {
      type: 'object',
      properties: { max_lines: { type: 'integer', minimum: 0, maximum: 20000, description: 'So viele G-Code-Zeilen mitliefern (Standard 200, 0 = nur Zusammenfassung)' } },
    },
    run: async (ed, a) => {
      const job = await buildJob(ed);
      const s = jobSummary(ed, job);
      const g = writeGCode(job, device, s.est);
      const n = Math.max(0, Math.min(20000, Math.round(Number(a.max_lines ?? 200))));
      const out: Content[] = json({ ...s.data, lineCount: g.lines.length, linesIncluded: Math.min(n, g.lines.length) });
      if (n) out.push({ type: 'text', text: g.lines.slice(0, n).join('\n') + (g.lines.length > n ? `\n; … ${g.lines.length - n} weitere Zeilen` : '') });
      return out;
    },
  },
  {
    name: 'save_gcode',
    title: 'G-Code speichern',
    description: 'Speichert den G-Code des Dokuments für das gewählte Gerät als Datei (absoluter Pfad, Endung .gcode oder .nc). Sendet nichts an die Maschine.',
    tier: Tier.GCode,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absoluter Pfad, endet auf .gcode oder .nc' },
        overwrite: { type: 'boolean', description: 'Vorhandene Datei ersetzen (Standard: false)' },
      },
      required: ['path'],
    },
    run: async (ed, a) => {
      const path = String(a.path ?? '');
      if (!/\.(gcode|nc)$/i.test(path)) throw new ToolError('Der Pfad muss auf .gcode oder .nc enden');
      desktopOnly();
      const job = await buildJob(ed);
      const s = jobSummary(ed, job);
      const g = writeGCode(job, device, s.est);
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        await invoke('agent_write_file', { path, contents: g.lines.join('\n') + '\n', overwrite: a.overwrite === true });
      } catch (e) {
        throw new ToolError(String(e));
      }
      return { saved: path, lineCount: g.lines.length, durationSeconds: Math.round(s.est.total), device: device.name };
    },
  },
];

export const MACHINE_TOOLS: ToolDef[] = [
  {
    name: 'machine_connect',
    title: 'Mit dem Laser verbinden',
    description: 'Verbindet mit dem gewählten Gerät (Anschluss aus dessen Einstellungen). Bewegt nichts, auch keine Referenzfahrt.',
    tier: Tier.Machine,
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      desktopOnly();
      if (!machine.connected) {
        let lastError = '';
        const off = machine.on((e) => e.type === 'line' && e.dir === 'error' && (lastError = e.line));
        try {
          await machine.connect(device, false);
        } finally {
          off();
        }
        if (!machine.connected) throw new ToolError(lastError || 'Verbindung fehlgeschlagen');
        machineLog(`Verbunden mit ${machine.where} (${device.name})`);
      }
      return { connected: true, where: machine.where, device: device.name, state: machine.status.state || null };
    },
  },
  {
    name: 'machine_home',
    title: 'Referenzfahrt anfordern',
    description: 'Fordert eine Referenzfahrt (Home) an. KizamuBeam zeigt der Person einen Dialog; nur ihr Klick startet sie. Liefert den Stand der Anfrage (waiting, started, declined, expired, failed).',
    tier: Tier.Machine,
    inputSchema: { type: 'object', properties: { message: { type: 'string', description: 'Kurze Begründung für die Person' }, ...waitArg } },
    run: async (_ed, a) => {
      desktopOnly();
      if (!machine.connected) throw new ToolError('Nicht verbunden (machine_connect).');
      if (machine.running) throw new ToolError('Es läuft gerade ein Auftrag.');
      if (device.limitSwitches === 'no') throw new ToolError('Das Gerät hat laut Geräteeinstellungen keine Endschalter; eine Referenzfahrt würde bis zum Anschlag fahren.');
      const fw = FIRMWARES[device.fw];
      const r = ask('home', device.name, {
        title: t('KI-Agent möchte eine Referenzfahrt starten'),
        content: [
          h('p', {}, t('Der Laserkopf fährt zu den Endschaltern von „{name}“. Achte darauf, dass nichts im Weg liegt.', { name: device.name })),
          ...agentNote(a),
        ],
        confirm: t('Referenzfahrt starten'),
        started: 'Referenzfahrt gestartet.',
        action: async () => {
          if (!machine.connected) return t('Nicht verbunden.');
          if (machine.running) return t('Es läuft bereits ein Auftrag.');
          await machine.send(fw.home);
          return null;
        },
      });
      return waitFor(r, waitSeconds(a));
    },
  },
  {
    name: 'machine_frame',
    title: 'Rahmen fahren anfordern',
    description:
      'Fordert eine Rahmenfahrt um den Job an (Rechteck oder Kontur), damit die Person die Lage auf dem Material prüfen kann. KizamuBeam zeigt einen Dialog mit Vorschau; nur der Klick der Person startet die Fahrt. Liefert den Stand der Anfrage.',
    tier: Tier.Machine,
    inputSchema: {
      type: 'object',
      properties: { contour: { type: 'boolean', description: 'Umriss (konvexe Hülle) statt Rechteck' }, message: { type: 'string', description: 'Kurze Begründung für die Person' }, ...waitArg },
    },
    run: async (ed, a) => {
      desktopOnly();
      const blocker = runBlocker();
      if (blocker) throw new ToolError(blocker);
      const contour = a.contour === true;
      const job = await buildJob(ed);
      const lines = frameGCode(job, device, contour)!;
      const outside = outsideBed(ed, job);
      if (outside) throw new ToolError(outside);
      if (device.frameLaser && device.framePower > device.agentMaxPower)
        throw new ToolError(`Der Rahmen läuft mit ${device.framePower} % Laserleistung, für Agenten erlaubt sind höchstens ${device.agentMaxPower} %.`);
      const b = job.bounds!;
      const outline = contour && job.hull.length >= 3 ? job.hull : [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
      const area = `X ${b.x0.toFixed(1)} … ${b.x1.toFixed(1)}, Y ${b.y0.toFixed(1)} … ${b.y1.toFixed(1)} mm`;
      const r = ask('frame', `${contour ? 'Kontur' : 'Rechteck'}, ${area}`, {
        title: t('KI-Agent möchte den Rahmen fahren'),
        content: [
          jobCanvas(ed, job, outline),
          h('dl', { class: 'preview-stats' },
            ...stat(t('Gerät'), device.name),
            ...stat(t('Form'), contour ? t('Kontur') : t('Rechteck')),
            ...stat(t('Bereich'), area),
            ...stat(t('Laser'), device.frameLaser ? t('an, {p} %', { p: device.framePower }) : t('aus')),
          ),
          ...agentNote(a),
        ],
        confirm: t('Rahmen fahren'),
        started: 'Rahmenfahrt gestartet.',
        action: async () => {
          const why = runBlocker();
          if (why) return why;
          await machine.runJob(lines, null, true);
          return machine.running ? null : t('Start fehlgeschlagen, Details in der Konsole.');
        },
      });
      return waitFor(r, waitSeconds(a));
    },
  },
  {
    name: 'request_job',
    title: 'Job anfordern',
    description:
      'Fordert an, den Laser-Job der aktuellen Seite zu starten. Der Job muss im Arbeitsbereich liegen und die Grenzen des Geräts für Agenten-Jobs einhalten (siehe generate_gcode). KizamuBeam zeigt der Person Vorschau, Layer, Leistung, Dauer und Gerät; nur ihr Klick auf „Job starten“ startet den Laser, und zwar genau den gezeigten Stand. Liefert den Stand der Anfrage (waiting, started, declined, expired, failed); den Fortschritt zeigt machine_status.',
    tier: Tier.Machine,
    inputSchema: { type: 'object', properties: { message: { type: 'string', description: 'Kurze Erklärung für die Person, was gelasert wird' }, ...waitArg } },
    run: async (ed, a) => {
      desktopOnly();
      const blocker = runBlocker();
      if (blocker) throw new ToolError(blocker);
      const job = await buildJob(ed);
      const s = jobSummary(ed, job);
      if (s.outside) throw new ToolError(s.outside);
      if (s.problems.length) throw new ToolError(`Außerhalb der Grenzen für Agenten-Jobs (nur die Person kann sie in den Geräteeinstellungen ändern):\n${s.problems.join('\n')}`);
      // Genau dieser Stand läuft nach der Bestätigung, auch wenn das Dokument danach geändert wird
      const g = await prepareGCode(job, device, s.est);
      const d = s.data;
      const area = `X ${d.area.x} … ${r3(d.area.x + d.area.w)}, Y ${d.area.y} … ${r3(d.area.y + d.area.h)} mm`;
      const r = ask('job', `${formatDuration(s.est.total)}, ${area}, ${g.count} Zeilen`, {
        title: t('KI-Agent möchte einen Job starten'),
        content: [
          jobCanvas(ed, job),
          h('dl', { class: 'preview-stats' },
            ...stat(t('Gerät'), `${device.name} (${machine.where})`),
            ...stat(t('Geschätzte Dauer'), formatDuration(s.est.total)),
            ...stat(t('Bereich'), `${d.area.w} × ${d.area.h} mm`),
            ...stat(t('Laserweg'), `${d.laserPathMeters} m`),
          ),
          layerTable(ed, s.stats),
          ...(job.warnings.length ? [h('div', { class: 'note' }, ...job.warnings.map((w) => h('div', {}, w)))] : []),
          ...(bedCheck(ed, job).kind === 'unknown' ? [h('div', { class: 'note error' }, bedProblem(ed, job)!)] : []),
          ...agentNote(a),
          h('p', { class: 'note' }, t('Es läuft der Stand von eben, auch wenn du das Dokument jetzt noch änderst.')),
        ],
        confirm: t('Job starten'),
        started: 'Job gestartet.',
        action: async () => {
          const why = runBlocker();
          if (why) return why;
          laserNotify(t('Job gestartet (von einem KI-Agenten angefordert), geschätzt {total}.', { total: formatDuration(s.est.total) }));
          return (await runGCode(g)) && machine.running ? null : t('Start fehlgeschlagen, Details in der Konsole.');
        },
      });
      return waitFor(r, waitSeconds(a));
    },
  },
  {
    name: 'wait_for_confirmation',
    title: 'Auf Entscheidung warten',
    description: 'Wartet, bis die Person die offene Anfrage (Job, Rahmen, Referenzfahrt) bestätigt oder ablehnt, höchstens so viele Sekunden. Liefert den Stand der Anfrage.',
    tier: Tier.Machine,
    inputSchema: { type: 'object', properties: { seconds: { type: 'integer', minimum: 1, maximum: 110, description: 'Höchstens so lange warten (Standard 45)' } } },
    run: async (_ed, a) => {
      if (!current) throw new ToolError('Es gibt keine Anfrage.');
      return waitFor(current, Math.max(1, Math.min(110, Math.round(Number(a.seconds ?? 45)))));
    },
  },
  {
    name: 'machine_pause',
    title: 'Job anhalten',
    description: 'Hält den laufenden Job an (Feed Hold). Weiter geht es nur durch die Person in der App.',
    tier: Tier.Machine,
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      if (!machine.connected) throw new ToolError('Nicht verbunden.');
      if (!machine.running) throw new ToolError('Es läuft kein Job.');
      await machine.pause();
      machineLog('Angehalten');
      laserNotify(t('Ein KI-Agent hat den Job angehalten.'));
      return { paused: true };
    },
  },
  {
    name: 'machine_stop',
    title: 'Stopp',
    description: 'Bricht den laufenden Job oder die Fahrt sofort ab und verwirft eine offene Anfrage. Ist immer erlaubt.',
    tier: Tier.Machine,
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      if (current?.state === 'waiting') current.cancel('Vom Agenten zurückgezogen (Stopp).');
      if (machine.connected) {
        await machine.stop();
        machineLog('Gestoppt');
        laserNotify(t('Ein KI-Agent hat den Laser gestoppt.'), true);
      }
      return { stopped: machine.connected, connected: machine.connected };
    },
  },
];
