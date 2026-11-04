// Window of the KizamuBeam Virtual Machine: bed with traces, state, connections, notices and console.
// The window fetches data from the controller about 30 times per second (api.poll).

import './style.css';
import { api, hasNative, type ClientInfo, type Config, type ServerInfo, type Snapshot, type VmEvent } from './api';
import { t } from './i18n';
import { BedView } from './view';

const VERSION = '0.1.0';
const CONSOLE_MAX = 3000;

type Attrs = Record<string, unknown>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c !== null && c !== false) el.append(c);
  return el;
}

const app = document.getElementById('app')!;

if (!hasNative()) {
  app.append(h('div', { class: 'nonative' }, h('h1', {}, 'KizamuBeam Virtual Machine'), h('p', {}, t('Die virtuelle Maschine läuft nur in der Desktop-App „KizamuBeam Virtual Machine“.'))));
} else {
  start();
}

function fmt(n: number, d = 3) {
  const s = n.toFixed(d);
  return s === `-${(0).toFixed(d)}` ? (0).toFixed(d) : s;
}

function time(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

async function start() {
  let cfg = await api.config();
  let info = await api.serverInfo();

  // ---------- header ----------
  const badge = h('span', { class: 'badge' }, '…');
  const chips = h('div', { class: 'chips' });
  const header = h('header', { class: 'top' },
    h('div', { class: 'title' }, h('strong', {}, 'KizamuBeam Virtual Machine'), h('span', { class: 'muted' }, t('Version {v}', { v: VERSION }))),
    badge,
    chips,
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn', title: t('Gefahrene Wege und Brennspuren auf dem Bett entfernen'), onclick: () => view.resetLayers() }, t('Spuren löschen')),
    h('button', { class: 'btn', title: t('Steuerung zurücksetzen (Strg-X): hält an und leert alle Puffer'), onclick: () => api.realtime(0x18) }, t('Zurücksetzen')),
    h('button', { class: 'btn', title: t('Maschine aus- und wieder einschalten: Der Kopf bleibt stehen, die Position beginnt dort bei 0'), onclick: () => api.powerCycle() }, t('Aus/Ein')),
    h('button', { class: 'btn primary', onclick: () => openSettings() }, t('Einstellungen')));

  // ---------- bed ----------
  const stage = h('section', { class: 'stage' });
  const rapidBox = h('input', { type: 'checkbox', checked: true, onchange: () => ((view.showRapids = rapidBox.checked), view.invalidate()) });
  const overlay = h('div', { class: 'overlay' },
    h('label', {}, rapidBox, ' ', t('Eilgänge zeigen')),
    h('button', { class: 'btn small', onclick: () => view.fit() }, t('Ansicht einpassen (Doppelklick)')));
  stage.append(overlay);
  const view = new BedView(stage);
  view.setBed(cfg.bedW, cfg.bedH);

  // ---------- sidebar ----------
  const status = h('dl', { class: 'status' });
  const clientsBox = h('div', { class: 'clients' });
  const hint = h('p', { class: 'hint' }, t('Aus KizamuBeam: Laser → Geräte → Neues Gerät → Vorlage „KizamuBeam Virtual Machine“. Andere Programme: als GRBL- bzw. FluidNC-Gerät über das Netzwerk (Telnet) mit dieser Adresse.'));
  const notices = h('ul', { class: 'notices' });
  const log = h('div', { class: 'log' });
  const showStatus = h('input', { type: 'checkbox', onchange: () => log.classList.toggle('show-status', showStatus.checked) });
  const input = h('input', { type: 'text', placeholder: t('Befehl senden, z. B. $$ oder G0 X10'), spellcheck: false });
  const history: string[] = [];
  let hpos = 0;
  const sendLine = () => {
    const l = input.value.trim();
    if (!l) return;
    if (l === '?') api.realtime(0x3f);
    else if (l === '!') api.realtime(0x21);
    else if (l === '~') api.realtime(0x7e);
    else api.send(l);
    history.push(l);
    hpos = history.length;
    input.value = '';
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendLine();
    else if (e.key === 'ArrowUp' && hpos > 0) input.value = history[--hpos];
    else if (e.key === 'ArrowDown' && hpos < history.length) input.value = history[++hpos] ?? '';
  });
  const quick = (label: string, fn: () => void) => h('button', { class: 'btn small', onclick: fn }, label);
  const side = h('aside', { class: 'side' },
    h('section', { class: 'card' }, status),
    h('section', { class: 'card' }, h('h3', {}, t('Hier verbinden')), hint, h('h3', {}, t('Verbindungen')), clientsBox),
    h('section', { class: 'card notices-card' }, h('h3', {}, t('Hinweise')), notices),
    h('section', { class: 'card console' },
      h('div', { class: 'row' }, h('h3', {}, t('Konsole')), h('label', { class: 'small' }, showStatus, ' ', t('Statusabfragen zeigen'))),
      log,
      h('div', { class: 'row quick' }, quick('?', () => api.realtime(0x3f)), quick('!', () => api.realtime(0x21)), quick('~', () => api.realtime(0x7e)), quick('$H', () => api.send('$H')), quick('$X', () => api.send('$X')), quick('$$', () => api.send('$$'))),
      h('div', { class: 'row' }, input, h('button', { class: 'btn', onclick: sendLine }, t('Senden')))));

  app.append(header, h('main', { class: 'main' }, stage, side));

  // ---------- rendering ----------
  const renderChips = () => {
    chips.replaceChildren();
    const chip = (label: string, r: ServerInfo['telnet'], prefix = '') => {
      if (!r) return h('span', { class: 'chip off' }, `${label}: ${t('ausgeschaltet')}`);
      if ('Err' in r) return h('span', { class: 'chip err', title: r.Err }, `${label}: ${r.Err}`);
      return h('span', { class: 'chip ok', title: r.Ok }, `${label}: ${prefix}${r.Ok}`);
    };
    chips.append(chip(t('Telnet'), info.telnet), chip(t('WebSocket'), info.ws, 'ws://'));
  };
  renderChips();

  const row = (k: string, v: string, cls = '') => [h('dt', {}, k), h('dd', { class: cls }, v)];
  let lastStatus = '';
  const renderStatus = (s: Snapshot) => {
    const off = Math.hypot(s.head[0] - s.mpos[0], s.head[1] - s.mpos[1]) > 0.001;
    const laser = s.spindle === 'M5' ? t('aus') : `${s.spindle} S${fmt(s.s, 0)}${s.laserOn ? ` · ${Math.round(s.power * 100)} %` : ''}`;
    const items = [
      ...row(t('Zustand'), s.state, s.alarm !== null ? 'bad' : ''),
      ...row(t('Maschine (MPos)'), `X ${fmt(s.mpos[0])}  Y ${fmt(s.mpos[1])}  Z ${fmt(s.mpos[2])}`, 'mono'),
      ...row(t('Werkstück (WPos)'), `X ${fmt(s.wpos[0])}  Y ${fmt(s.wpos[1])}  Z ${fmt(s.wpos[2])}`, 'mono'),
      ...(off ? row(t('Kopf tatsächlich'), `X ${fmt(s.head[0])}  Y ${fmt(s.head[1])}`, 'mono bad') : []),
      ...row(t('Vorschub'), `${Math.round(s.feed)} mm/min`, 'mono'),
      ...row(t('Laser'), laser, s.laserOn ? 'hot' : ''),
      ...row(t('Overrides'), `F ${s.ovr[0]} %  R ${s.ovr[1]} %  S ${s.ovr[2]} %`, 'mono'),
      ...row(t('Planer'), `${s.plannerUsed} / ${s.plannerSize}`, 'mono'),
      ...row(t('Air Assist'), [s.flood ? 'M8' : '', s.mist ? 'M7' : ''].filter(Boolean).join(' + ') || t('aus')),
      ...(s.outputs ? row(t('Ausgänge'), Array.from({ length: 64 }, (_, i) => i).filter((i) => (BigInt(s.outputs) >> BigInt(i)) & 1n).join(', ')) : []),
      ...row(t('Referenziert'), s.homed ? t('ja') : t('nein')),
      ...row(t('Laufzeit'), time(s.jobTime), 'mono'),
    ];
    const key = items.map((e) => e.textContent + e.className).join('|');
    if (key === lastStatus) return;
    lastStatus = key;
    status.replaceChildren(...items);
    badge.textContent = s.state;
    badge.className = `badge ${s.alarm !== null ? 'alarm' : s.state === 'Idle' ? 'idle' : s.state.startsWith('Hold') ? 'hold' : 'run'}`;
  };

  let lastClients = '';
  const renderClients = (list: ClientInfo[]) => {
    const key = JSON.stringify(list);
    if (key === lastClients) return;
    lastClients = key;
    clientsBox.replaceChildren(
      ...(list.length ? list.map((c) => h('div', { class: 'client' }, h('span', { class: 'tag' }, `#${c.id}`), ` ${c.kind === 'ws' ? 'WebSocket' : 'Telnet'} · ${c.addr}`)) : [h('p', { class: 'muted' }, t('Noch keine Verbindung.'))]),
    );
  };

  const notice = (text: string, cls = '') => {
    const now = new Date();
    notices.prepend(h('li', { class: cls }, h('span', { class: 'muted' }, now.toLocaleTimeString()), ' ', text));
    while (notices.children.length > 30) notices.lastElementChild!.remove();
  };

  const alarmText = (code: number) =>
    code === 1 ? t('ALARM:1 – Endschalter während der Fahrt ausgelöst')
      : code === 2 ? t('ALARM:2 – Ziel außerhalb des Fahrwegs (weiche Grenzen)')
        : code === 3 ? t('ALARM:3 – während der Bewegung zurückgesetzt, Position evtl. verloren')
          : t('ALARM:{n}', { n: code });

  const handle = (e: VmEvent) => {
    if (e.type === 'console') {
      const who = e.client === 0xffffffff ? '*' : e.client === 0 ? '·' : `#${e.client}`;
      const el = h('div', { class: `l ${e.dir}${e.status ? ' st' : ''}` }, h('span', { class: 'who' }, who), e.text);
      log.append(el);
    } else if (e.type === 'warning') {
      if (e.code === 'rxOverflow') notice(t('Verbindung #{c} hat mehr gesendet, als in den Empfangspuffer ({n} Bytes) passt. Eine echte Steuerung würde Zeichen verlieren.', { c: e.client ?? '?', n: cfg.rxBuffer }), 'warn');
      else notice(t('Der Kopf ist bei X {x} / Y {y} gegen den Rahmen gefahren. Eine echte Maschine verliert dabei Schritte; die gemeldete Position stimmt danach nicht mehr.', { x: fmt(e.x, 1), y: fmt(e.y, 1) }), 'warn');
    } else if (e.type === 'alarm') {
      notice(alarmText(e.code), 'bad');
    } else if (e.type === 'configChanged') {
      api.config().then((c) => {
        cfg = c;
        view.setBed(c.bedW, c.bedH);
      });
    }
  };

  // ---------- polling ----------
  let busy = false;
  let lastPoll = 0;
  const frame = async (ts: number) => {
    requestAnimationFrame(frame);
    view.draw();
    if (busy || ts - lastPoll < 30) return;
    busy = true;
    lastPoll = ts;
    try {
      const p = await api.poll();
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
      for (const e of p.events) handle(e);
      while (log.childElementCount > CONSOLE_MAX) log.firstElementChild!.remove();
      if (atBottom) log.scrollTop = log.scrollHeight;
      view.addSegments(p.segments);
      view.update(p.snapshot);
      renderStatus(p.snapshot);
      renderClients(p.clients);
    } catch (err) {
      console.error(err);
    } finally {
      busy = false;
    }
  };
  requestAnimationFrame(frame);

  // ---------- settings ----------
  async function openSettings() {
    const c: Config = { ...cfg };
    const lan = await api.lanAddresses().catch(() => [] as string[]);
    const num = (label: string, key: keyof Config, step = 1, min = 0) => {
      const el = h('input', { type: 'number', step, min, value: String(c[key]) });
      el.addEventListener('change', () => ((c as unknown as Record<string, number>)[key] = Number(el.value)));
      return [h('label', {}, label), el];
    };
    const check = (label: string, key: keyof Config) => {
      const el = h('input', { type: 'checkbox', checked: Boolean(c[key]) });
      el.addEventListener('change', () => ((c as unknown as Record<string, boolean>)[key] = el.checked));
      return h('label', { class: 'check' }, el, ' ', label);
    };
    const flavor = h('select', {}, h('option', { value: 'fluidnc' }, 'FluidNC 3.7'), h('option', { value: 'grbl' }, 'GRBL 1.1h'));
    flavor.value = c.flavor;
    flavor.addEventListener('change', () => (c.flavor = flavor.value as Config['flavor']));
    const bedW = h('input', { type: 'number', min: 10, step: 1, value: String(c.bedW) });
    const bedH = h('input', { type: 'number', min: 10, step: 1, value: String(c.bedH) });
    bedW.addEventListener('change', () => (c.bedW = Number(bedW.value)));
    bedH.addEventListener('change', () => (c.bedH = Number(bedH.value)));
    const mpos = h('input', { type: 'checkbox', checked: (c.statusMask & 1) === 1 });
    const bf = h('input', { type: 'checkbox', checked: (c.statusMask & 2) === 2 });
    const note = h('p', { class: 'note' });
    const dlg = h('dialog', { class: 'settings' },
      h('h2', {}, t('Einstellungen')),
      h('h3', {}, t('Steuerung')),
      h('div', { class: 'grid' },
        h('label', {}, t('Firmware')), flavor,
        h('label', {}, t('Fahrweg (mm)')), h('div', { class: 'pair' }, bedW, '×', bedH),
        ...num(t('Höchstgeschwindigkeit (mm/min)'), 'maxRate', 100, 60),
        ...num(t('Beschleunigung (mm/s²)'), 'accel', 50, 10),
        ...num(t('Junction Deviation (mm)'), 'junctionDev', 0.001, 0.001),
        ...num(t('S-Wert für 100 %'), 'sMax', 1, 1),
        ...num(t('Empfangspuffer (Bytes)'), 'rxBuffer', 1, 64),
        ...num(t('Plätze im Planer'), 'plannerBlocks', 1, 4)),
      check(t('Laser-Modus ($32): Laser nur bei G1/G2/G3 an, M4 passt die Leistung an'), 'laserMode'),
      check(t('Endschalter vorhanden (Referenzfahrt $H)'), 'homing'),
      check(t('Nach dem Einschalten erst referenzieren (must_home)'), 'mustHome'),
      check(t('Weiche Grenzen ($20)'), 'softLimits'),
      check(t('Harte Grenzen ($21)'), 'hardLimits'),
      h('label', { class: 'check' }, mpos, ' ', t('Status mit Maschinenkoordinaten (MPos)')),
      h('label', { class: 'check' }, bf, ' ', t('Pufferstand im Status (Bf)')),
      h('h3', {}, t('Netzwerk')),
      h('div', { class: 'grid' },
        check(t('Telnet-Port'), 'telnetEnabled'), h('input', { type: 'number', min: 1, max: 65535, value: String(c.telnetPort), onchange: (e: Event) => (c.telnetPort = Number((e.target as HTMLInputElement).value)) }),
        check(t('WebSocket-Port'), 'wsEnabled'), h('input', { type: 'number', min: 1, max: 65535, value: String(c.wsPort), onchange: (e: Event) => (c.wsPort = Number((e.target as HTMLInputElement).value)) })),
      check(t('Auch aus dem Netzwerk erreichbar (sonst nur von diesem Rechner)'), 'lan'),
      lan.length ? h('p', { class: 'muted small' }, t('Adresse im Netzwerk: {ip}', { ip: lan.join(', ') })) : null,
      h('p', { class: 'muted small' }, t('Ports unter 1024 brauchen auf macOS und Linux Administratorrechte.')),
      note,
      h('div', { class: 'buttons' },
        h('button', { class: 'btn', onclick: () => dlg.close() }, t('Abbrechen')),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            c.statusMask = (mpos.checked ? 1 : 0) | (bf.checked ? 2 : 0);
            for (const p of [c.telnetPort, c.wsPort]) {
              if (!Number.isInteger(p) || p < 1 || p > 65535) return void (note.textContent = t('Port {p} ist ungültig.', { p }));
            }
            if (c.telnetEnabled && c.wsEnabled && c.telnetPort === c.wsPort) return void (note.textContent = t('Telnet und WebSocket brauchen verschiedene Ports.'));
            info = await api.setConfig(c);
            cfg = await api.config();
            view.setBed(cfg.bedW, cfg.bedH);
            renderChips();
            dlg.close();
          },
        }, t('Speichern'))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }
}
