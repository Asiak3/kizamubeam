// Einstellungen für KI-Agenten (MCP): Zugang ein/aus, Stufe, Token, Einrichtung der Clients und Protokoll.
import type { Editor } from './editor';
import { h } from './dom';
import { isTauri } from './machine';
import { agentLog, onAgentLog, toolOverview } from './agent';
import { Tier } from './agentutil';
import { locale, t, tBackend } from './i18n';

interface AgentInfo {
  enabled: boolean;
  port: number;
  token: string;
  level: number;
  max_level: number;
  url: string;
  exe: string;
  running: boolean;
  error: string | null;
  machine_log: string;
}

const LEVELS: [Tier, string][] = [
  [Tier.Read, t('Nur lesen (Dokument, Layer, Vorschau, Schätzung)')],
  [Tier.Edit, t('Lesen und entwerfen (Änderungen lassen sich rückgängig machen)')],
  [Tier.GCode, t('Zusätzlich G-Code erzeugen (ohne Senden an die Maschine)')],
  [Tier.Machine, t('Zusätzlich Laser bedienen (nur nach deiner Bestätigung, bis zum Beenden der App)')],
];

const stateListeners = new Set<(i: AgentInfo) => void>();
async function call(cmd: string, args: Record<string, unknown> = {}): Promise<AgentInfo> {
  const { invoke } = await import('@tauri-apps/api/core');
  const info = await invoke<AgentInfo>(cmd, args);
  stateListeners.forEach((f) => f(info));
  return info;
}

/** Hinweis in der Statusleiste, solange der Zugang an ist; Klick öffnet die Einstellungen */
export function agentStatus(ed: Editor): HTMLElement {
  const el = h('button', { class: 'agent-status', hidden: true, title: t('Zugang für KI-Agenten ist eingeschaltet'), onclick: () => openAgentDialog(ed) }, t('KI-Agenten an'));
  stateListeners.add((i) => {
    el.hidden = !i.enabled;
    el.classList.toggle('error', !!i.error);
    el.classList.toggle('machine', i.level >= Tier.Machine);
    el.textContent = i.level >= Tier.Machine ? t('KI-Agenten an · Laser') : t('KI-Agenten an');
    el.title = i.level >= Tier.Machine ? t('KI-Agenten dürfen den Laser bedienen (jede Fahrt und jeder Job nur nach deiner Bestätigung)') : t('Zugang für KI-Agenten ist eingeschaltet');
  });
  let timer = 0;
  onAgentLog(() => {
    el.classList.add('busy');
    clearTimeout(timer);
    timer = window.setTimeout(() => el.classList.remove('busy'), 1500);
  });
  if (isTauri()) call('agent_info').catch(() => {});
  return el;
}

export async function openAgentDialog(_ed: Editor) {
  if (!isTauri()) {
    alert(t('Den Zugang für KI-Agenten gibt es nur in der Desktop-App.'));
    return;
  }
  let info = await call('agent_info');

  const enabled = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const level = h('select', {}, ...LEVELS.map(([v, label]) => h('option', { value: String(v) }, label))) as HTMLSelectElement;
  const port = h('input', { type: 'number', min: '1024', max: '65535' }) as HTMLInputElement;
  const state = h('div', { class: 'agent-state' });
  const token = h('input', { type: 'password', readOnly: true, class: 'agent-token' }) as HTMLInputElement;
  const configs = h('div', { class: 'agent-configs' });
  const logBox = h('div', { class: 'agent-log' });
  const machineNote = h('p', { class: 'note agent-machine-note' });

  const apply = async () => {
    try {
      info = await call('agent_configure', { enabled: enabled.checked, level: Number(level.value), port: Number(port.value) || 47800 });
    } catch (e) {
      alert(tBackend(String(e)));
    }
    fill();
  };
  enabled.onchange = level.onchange = port.onchange = apply;

  const copyBtn = (text: () => string) => {
    const b = h('button', { class: 'btn' }, t('Kopieren'));
    b.onclick = async () => {
      await navigator.clipboard.writeText(text());
      b.textContent = t('Kopiert');
      setTimeout(() => (b.textContent = t('Kopieren')), 1500);
    };
    return b;
  };
  const snippet = (title: string, where: string, text: string) =>
    h('div', { class: 'agent-snippet' },
      h('div', { class: 'agent-snippet-head' }, h('b', {}, title), h('span', { class: 'note' }, where), copyBtn(() => text)),
      h('pre', {}, text),
    );

  const fill = () => {
    enabled.checked = info.enabled;
    level.value = String(info.level);
    machineNote.hidden = info.level < Tier.Machine;
    machineNote.textContent = t('Laser-Stufe: Der Agent kann verbinden, Stopp und Pause auslösen und Job, Rahmen und Referenzfahrt anfordern. Jede Anfrage zeigt dir einen Dialog, nur dein Klick startet sie. Grenzen für Leistung und Geschwindigkeit stellst du je Gerät in den Geräteeinstellungen ein. Beim nächsten Start der App ist die Stufe wieder auf „G-Code“. Protokoll: {path}', { path: info.machine_log });
    port.value = String(info.port);
    token.value = info.token;
    state.textContent = info.error
      ? tBackend(info.error)
      : info.enabled
        ? t('Läuft auf {url} (nur von diesem Rechner erreichbar).', { url: info.url })
        : t('Aus. Kein Agent kann auf KizamuBeam zugreifen.');
    state.classList.toggle('error', !!info.error);
    const exe = info.exe;
    const quoted = /[\s"']/.test(exe) ? `"${exe.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : exe;
    configs.replaceChildren(
      snippet('Claude Code', t('im Terminal ausführen'), `claude mcp add kizamubeam -- ${quoted} --mcp-stdio`),
      snippet('Claude Desktop', t('in claude_desktop_config.json unter „mcpServers“ eintragen'),
        JSON.stringify({ mcpServers: { kizamubeam: { command: exe, args: ['--mcp-stdio'] } } }, null, 2)),
      snippet('Codex', t('in ~/.codex/config.toml eintragen'), `[mcp_servers.kizamubeam]\ncommand = '${exe}'\nargs = ["--mcp-stdio"]`),
      snippet(t('Andere Clients (HTTP)'), t('Adresse und Kopfzeile'), `${info.url}\nAuthorization: Bearer ${info.token}`),
    );
  };

  const fillLog = () => {
    const rows = agentLog.slice(-60).reverse();
    logBox.replaceChildren(
      ...(rows.length
        ? rows.map((e) => h('div', { class: e.ok ? '' : 'error' },
            h('span', { class: 'time' }, e.time.toLocaleTimeString(locale)), ' ', h('b', {}, e.tool), e.summary ? ` ${e.summary}` : ''))
        : [h('div', { class: 'note' }, t('Noch keine Aufrufe.'))]),
    );
  };
  const offLog = onAgentLog(fillLog);

  const tools = toolOverview();
  const dlg = h('dialog', { class: 'agent-dialog' },
    h('h3', {}, t('KI-Agenten (MCP)')),
    h('p', { class: 'note' }, t('KI-Werkzeuge wie Claude oder Codex können KizamuBeam über das Model Context Protocol bedienen. Du siehst jede Änderung live. Den Laser startet ein Agent nie selbst: Jeden Job, jeden Rahmen und jede Referenzfahrt bestätigst du in KizamuBeam.')),
    h('label', { class: 'check' }, enabled, t('Zugang für KI-Agenten einschalten')),
    state,
    h('div', { class: 'form' },
      h('label', {}, t('Erlaubt')), level,
      h('label', {}, t('Port')), port,
      h('label', {}, t('Token')),
      h('span', { class: 'agent-token-row' }, token,
        h('button', { class: 'btn', title: t('Token anzeigen'), onclick: () => (token.type = token.type === 'password' ? 'text' : 'password') }, '👁'),
        h('button', { class: 'btn', title: t('Neues Token erzeugen: bisher eingerichtete HTTP-Clients verlieren den Zugang'), onclick: async () => {
          if (!confirm(t('Neues Token erzeugen? Clients, die das alte Token direkt verwenden, verlieren den Zugang.'))) return;
          info = await call('agent_new_token');
          fill();
        } }, t('Neu'))),
    ),
    machineNote,
    h('p', { class: 'note' }, t('Werkzeuge: {list}', { list: tools.map((x) => x.name).join(', ') })),
    h('h3', {}, t('Einrichten')),
    h('p', { class: 'note' }, t('Die Clients starten KizamuBeam als Brücke (--mcp-stdio); die App muss dazu laufen und der Zugang eingeschaltet sein. Das Token liest die Brücke selbst.')),
    configs,
    h('h3', {}, t('Protokoll')),
    logBox,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn primary', onclick: () => dlg.close() }, t('Schließen'))),
  );
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  dlg.addEventListener('close', () => {
    offLog();
    dlg.remove();
  });
  document.body.append(dlg);
  fill();
  fillLog();
  dlg.showModal();
}
