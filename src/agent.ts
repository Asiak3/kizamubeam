// Werkzeuge für KI-Agenten (MCP). Der Rust-Teil (src-tauri/src/agent.rs) nimmt die Aufrufe entgegen, prüft Token
// und Stufe und reicht sie als Ereignis „agent-request“ hierher; hier werden sie mit dem Editor ausgeführt.
// Koordinaten nach außen sind Maschinenkoordinaten wie in der Oberfläche (Ursprung unten links, y nach oben).
import type { Editor } from './editor';
import { boundsOf, Box } from './geom';
import { IDENT } from './model';
import { library } from './materials';
import { brokenPacks, ensurePacks, installedPacks } from './packs';
import { findAssets } from './assetLibrary';
import { ASSET_CATEGORIES, AssetCategory } from './assetFormat';
import { systemFonts } from './fonts';
import { isTauri, machine } from './machine';
import { bedCheck, deviceList, jobInfo } from './laser';
import { agentLog, Args, describe, findObj, json, layerInfo, log, machineBox, onAgentLog, pageList, r3, Tier, ToolDef, ToolError } from './agentutil';
import { EDIT_TOOLS } from './agentedit';
import { GCODE_TOOLS, MACHINE_TOOLS, requestState } from './agentmachine';
import { t } from './i18n';

export { agentLog, onAgentLog };


// ---------- Werkzeuge ----------

const READ_TOOLS: ToolDef[] = [
  {
    name: 'get_document',
    title: 'Dokument lesen',
    description:
      'Überblick über das geöffnete Projekt: Bettgröße, die Seiten (page 1 … n, aktuelle Seite), alle Objekte der aktuellen Seite (oder der Seite page) mit id, Typ, Layer, Rahmen in mm, Drehung, Text, Name aus dem Objekte-Fenster, hidden/locked usw., Kreise und Bögen in Pfaden (circles: Mittelpunkt, Radius), die Auswahl der Person, die benutzten Layer mit ihren Laser-Einstellungen und die Projekt-Notizen (notes: material, setup, process; ändern mit project_notes). Layer-Einstellungen gelten für alle Seiten; bearbeitet, gelasert und exportiert wird nur die aktuelle Seite (wechseln mit switch_page). Rahmen: x/y = linke untere Ecke in Maschinenkoordinaten.',
    tier: Tier.Read,
    inputSchema: {
      type: 'object',
      properties: {
        include_paths: { type: 'boolean', description: 'Umrisse jedes Objekts als SVG-Pfad mitliefern (kann groß werden). Standard: false.' },
        page: { type: 'integer', minimum: 1, description: 'Objekte dieser Seite zeigen, ohne zu ihr zu wechseln (Standard: aktuelle Seite)' },
      },
    },
    run: (ed, a) => {
      const detail = a.include_paths === true;
      const idx = a.page === undefined || a.page === null ? ed.doc.page : Number(a.page) - 1;
      const page = ed.doc.pages[idx];
      if (!page) throw new ToolError(`Keine Seite ${a.page} (das Projekt hat ${ed.doc.pages.length})`);
      return json({
        units: 'mm',
        coordinates: 'machine: origin bottom-left, x right, y up',
        bed: ed.doc.bed,
        pages: pageList(ed),
        currentPage: ed.doc.page + 1,
        page: idx + 1,
        bounds: machineBox(ed, boundsOf(page.objs)),
        objectCount: page.objs.length,
        objects: page.objs.map((o) => describe(ed, o, IDENT, detail)),
        selection: idx === ed.doc.page ? ed.sel.map((o) => o.id) : [],
        layers: ed.usedLayers().map((i) => layerInfo(ed, i)),
        ...(ed.doc.notes ? { notes: ed.doc.notes } : {}),
      });
    },
  },
  {
    name: 'get_object',
    title: 'Objekt lesen',
    description: 'Ein Objekt (auch innerhalb von Gruppen) mit allen Angaben und seinem Umriss als SVG-Pfad in Maschinenkoordinaten (mm).',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: { id: { type: 'integer', description: 'Objekt-id aus get_document' } }, required: ['id'] },
    run: (ed, a) => {
      const hit = findObj(ed.doc.objs, Number(a.id));
      if (!hit) throw new ToolError(`Kein Objekt mit id ${a.id}`);
      return json(describe(ed, hit[0], hit[1], true));
    },
  },
  {
    name: 'list_layers',
    title: 'Layer auflisten',
    description: 'Laser-Einstellungen der Layer (Modus Linie/Füllen, Geschwindigkeit mm/min, Leistung %, Durchgänge, Kerf, Haltestege, Air Assist, Bild-Einstellungen, Material). Standard: nur benutzte Layer.',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: { all: { type: 'boolean', description: 'Alle 30 Farb-Layer statt nur der benutzten' } } },
    run: (ed, a) => {
      const idx = a.all === true ? Array.from({ length: 30 }, (_, i) => i) : ed.usedLayers();
      return json(idx.map((i) => layerInfo(ed, i)));
    },
  },
  {
    name: 'list_materials',
    title: 'Material-Bibliothek lesen',
    description: 'Einträge der Material-Bibliothek: Material, Dicke (mm), Titel (z. B. Schneiden, Gravieren) und die Layer-Einstellungen.',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: { material: { type: 'string', description: 'Nur Einträge, deren Material diesen Text enthält' } } },
    run: (_ed, a) => {
      const q = typeof a.material === 'string' ? a.material.toLowerCase() : '';
      return json(library.entries.filter((e) => !q || e.material.toLowerCase().includes(q)));
    },
  },
  {
    name: 'list_extensions',
    title: 'Erweiterungen auflisten',
    description: 'Installierte Erweiterungen (Inhaltspakete .kzp): Kennung, Version, Name und Inhalt (Gerätevorlagen, Vorlagen mit Datei „pack:…“ für new_from_template, Material-Einträge). Installieren und Entfernen geht nur in der App (Datei → Erweiterungen …).',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      await ensurePacks();
      return json({
        extensions: installedPacks().map(({ pack: p }) => ({
          id: p.id, version: p.version, name: p.name, description: p.description, author: p.author,
          devicePresets: p.devices.map((d) => ({ ...d.preset, source: d.source })),
          templates: p.templates.map((tp, i) => ({ file: `pack:${p.id}/${i + 1}`, title: tp.info.title })),
          materials: p.materials.map((m) => m.id),
        })),
        broken: brokenPacks(),
      });
    },
  },
  {
    name: 'list_assets',
    title: 'Bibliothek durchsuchen',
    description:
      'Einträge der Bibliothek (eigene Motive, Bilder, Designelemente, die aus Erweiterungen und 400 mitgelieferte, Kennung „builtin:…“): Kennung (asset, für insert_asset), Name, Art (motif, image, element), Stichwörter, Größe in mm und ggf. die Erweiterung oder builtin: true. query sucht in Name, Stichwörtern und Art (alle Wörter müssen passen, deutsch oder englisch); category filtert nach Art. Höchstens limit Treffer (Standard 100), total nennt die Gesamtzahl.',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string', enum: ASSET_CATEGORIES }, limit: { type: 'number' } } },
    run: async (_ed, a) => {
      const cat = typeof a.category === 'string' && (ASSET_CATEGORIES as string[]).includes(a.category) ? (a.category as AssetCategory) : '';
      const list = await findAssets(typeof a.query === 'string' ? a.query : '', cat);
      const limit = typeof a.limit === 'number' && a.limit > 0 ? Math.floor(a.limit) : 100;
      return json({
        total: list.length,
        assets: list.slice(0, limit).map((it) => ({
          asset: it.key, name: it.meta.name, category: it.meta.category, tags: it.meta.tags, size: { w: r3(it.meta.w), h: r3(it.meta.h) },
          ...(it.pack ? { extension: it.pack } : {}), ...(it.builtin ? { builtin: true } : {}), ...(it.broken ? { broken: it.broken } : {}),
        })),
      });
    },
  },
  {
    name: 'list_devices',
    title: 'Geräte auflisten',
    description: 'Eingerichtete Lasergeräte (Name, Firmware, Arbeitsbereich, Startposition, Job-Ursprung, Drehachse) und welches gewählt ist. Mit eingeschalteter Drehachse ist Y die Umfangsrichtung des Objekts.',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const { devices, current } = deviceList();
      return json({
        current,
        devices: devices.map((d) => ({
          id: d.id, name: d.name, firmware: d.fw, bed: { w: d.bedW, h: d.bedH }, connection: d.conn,
          startFrom: d.startFrom, jobOrigin: d.jobOrigin, cutSelectedOnly: d.cutSelected, airAssistCommand: d.airCmd,
          agentLimits: { maxPowerPercent: d.agentMaxPower, minSpeedMmPerMin: d.agentMinSpeed },
          rotary: d.rotary,
        })),
      });
    },
  },
  {
    name: 'list_fonts',
    title: 'Schriften auflisten',
    description: 'Auf dem Rechner installierte Schriftfamilien (für Text).',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: { contains: { type: 'string', description: 'Nur Namen, die diesen Text enthalten' } } },
    run: async (_ed, a) => {
      const all = (await systemFonts()) ?? [];
      const q = typeof a.contains === 'string' ? a.contains.toLowerCase() : '';
      return json(all.filter((f) => !q || f.toLowerCase().includes(q)));
    },
  },
  {
    name: 'search_google_fonts',
    title: 'Google Fonts durchsuchen',
    description:
      'Freie Schriften von Google Fonts suchen (nach Beliebtheit sortiert). installed = schon nutzbar. Laden mit install_google_font.',
    tier: Tier.Read,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Teil des Namens, z. B. "slab" oder "Lobster"' },
        category: { type: 'string', enum: ['all', 'sans', 'serif', 'display', 'handwriting', 'mono'] },
        limit: { type: 'number', description: 'Höchstens so viele Treffer (Standard 20, max. 100)' },
      },
    },
    run: async (_ed, a) => {
      const { loadCatalog } = await import('./fontManager');
      const { searchFonts, styleInfo } = await import('./fontCatalog');
      const have = new Set(((await systemFonts()) ?? []).map((f) => f.toLowerCase()));
      const hits = searchFonts(await loadCatalog(), {
        query: typeof a.query === 'string' ? a.query : '',
        category: (typeof a.category === 'string' ? a.category : 'all') as never,
      });
      const limit = Math.max(1, Math.min(100, Math.round(Number(a.limit) || 20)));
      return json({
        total: hits.length,
        fonts: hits.slice(0, limit).map((f) => ({ family: f.family, category: f.category, ...styleInfo(f), installed: have.has(f.family.toLowerCase()) })),
      });
    },
  },
  {
    name: 'install_google_font',
    title: 'Schrift von Google Fonts laden',
    description: 'Lädt eine Schriftfamilie von Google Fonts (normal, fett, kursiv, soweit vorhanden) in den Schriftordner der App. Danach als font in create_text nutzbar.',
    tier: Tier.Edit,
    inputSchema: { type: 'object', properties: { family: { type: 'string', description: 'Genauer Name wie bei Google Fonts, z. B. "Open Sans"' } }, required: ['family'] },
    run: async (_ed, a) => {
      const family = typeof a.family === 'string' ? a.family.trim() : '';
      if (!family) throw new ToolError('family fehlt');
      if (!isTauri()) throw new ToolError('Schriften laden geht nur in der Desktop-App');
      const { loadCatalog, installGoogleFont } = await import('./fontManager');
      const { findFont } = await import('./fontCatalog');
      const info = findFont(await loadCatalog().catch(() => []), family);
      const families = await installGoogleFont(info?.family ?? family, info);
      return json({ installed: families });
    },
  },
  {
    name: 'render_preview',
    title: 'Arbeitsfläche als Bild',
    description:
      'PNG der Arbeitsfläche mit Linealen in mm, so wie die Person sie sieht (Farben = Layer). Bereich: ganzes Bett, alle Objekte oder die Auswahl.',
    tier: Tier.Read,
    inputSchema: {
      type: 'object',
      properties: {
        area: { type: 'string', enum: ['bed', 'objects', 'selection'], description: 'Standard: bed' },
        size: { type: 'integer', minimum: 200, maximum: 2048, description: 'Längere Bildseite in Pixeln, Standard 1024' },
      },
    },
    run: (ed, a) => {
      const area = (a.area as string) || 'bed';
      const size = Math.max(200, Math.min(2048, Math.round(Number(a.size) || 1024)));
      let box: Box | null = { x: 0, y: 0, w: ed.doc.bed.w, h: ed.doc.bed.h };
      if (area === 'objects') box = boundsOf(ed.doc.objs);
      else if (area === 'selection') box = ed.selBounds();
      if (!box) throw new ToolError(area === 'selection' ? 'Nichts ausgewählt' : 'Das Dokument ist leer');
      const m = Math.max(box.w, box.h) * 0.04 + 1;
      if (area !== 'bed') box = { x: box.x - m, y: box.y - m, w: box.w + 2 * m, h: box.h + 2 * m };
      const url = ed.renderImage(box, size);
      return [{ type: 'image', data: url.slice(url.indexOf(',') + 1), mimeType: 'image/png' }];
    },
  },
  {
    name: 'estimate_job',
    title: 'Job abschätzen',
    description: 'Schätzt den Laser-Job der aktuellen Seite mit dem gewählten Gerät: Dauer, Laserweg, Leerweg, Bereich auf dem Bett, Warnungen. Sendet nichts an die Maschine.',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: {} },
    run: async (ed) => {
      const { job, est, device } = await jobInfo(ed);
      if (!est) return json({ empty: true, note: device.cutSelected ? 'Nur Auswahl lasern ist an, und die Auswahl ist leer.' : 'Keine Objekte auf Layern mit Ausgabe.' });
      const b = job.bounds!;
      const bed = bedCheck(ed, job);
      return json({
        device: device.name,
        durationSeconds: Math.round(est.total),
        laserPathMeters: r3(est.cutLength / 1000),
        travelMeters: r3(est.rapidLength / 1000),
        area: { x: r3(b.x0), y: r3(b.y0), w: r3(b.x1 - b.x0), h: r3(b.y1 - b.y0) },
        // null = Benutzer-Ursprung, dessen Lage die Steuerung noch nicht gemeldet hat
        insideBed: bed.kind === 'unknown' ? null : bed.kind === 'ok',
        startFrom: device.startFrom,
        cutSelectedOnly: device.cutSelected,
        airAssistLayers: job.air,
        warnings: job.warnings,
      });
    },
  },
  {
    name: 'machine_status',
    title: 'Maschinenstatus',
    description: 'Ob ein Laser verbunden ist, sein Zustand (Idle, Run, Hold, Alarm …), Position, ob gerade ein Job läuft und wie die letzte Anfrage eines Agenten (Job, Rahmen, Referenzfahrt) entschieden wurde. Nur lesend.',
    tier: Tier.Read,
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const st = machine.status;
      const p = machine.progress;
      return json({
        connected: machine.connected,
        where: machine.where || null,
        state: st.state || null,
        workPosition: st.wpos,
        machinePosition: st.mpos,
        jobRunning: machine.running,
        progress: p ? { acked: p.acked, total: p.total, errors: p.errors } : null,
        remainingSeconds: machine.remaining(),
        request: requestState(),
      });
    },
  },
];

const TOOLS: ToolDef[] = [...READ_TOOLS, ...EDIT_TOOLS, ...GCODE_TOOLS, ...MACHINE_TOOLS];

// ---------- Anbindung an den Rust-Teil ----------

interface RpcRequest {
  id: number;
  method: string;
  params: { name?: string; arguments?: Args };
}

function summarize(args: Args): string {
  const s = JSON.stringify(args ?? {});
  return s === '{}' ? '' : s.length > 120 ? s.slice(0, 117) + '…' : s;
}

async function handle(ed: Editor, req: RpcRequest): Promise<object> {
  if (req.method === 'tools/list') {
    return {
      result: {
        tools: TOOLS.map((d) => ({
          name: d.name,
          title: d.title,
          description: d.description,
          inputSchema: d.inputSchema,
          annotations: { title: d.title, readOnlyHint: d.tier === Tier.Read || d.name === 'generate_gcode', destructiveHint: false, openWorldHint: d.tier === Tier.Machine },
          _tier: d.tier,
        })),
      },
    };
  }
  if (req.method === 'tools/call') {
    const name = req.params.name ?? '';
    const args = req.params.arguments ?? {};
    const def = TOOLS.find((d) => d.name === name);
    if (!def) return { error: { code: -32602, message: `Unbekanntes Werkzeug: ${name}` } };
    try {
      // Meldungen des Editors gehören zum jeweiligen Aufruf
      if (def.tier === Tier.Edit) ed.hint = '';
      // Änderungen eines Aufrufs bilden genau einen Undo-Schritt; die übrigen Stufen ändern das Dokument nicht
      // Während des Aufrufs keine Rückfragen an den Nutzer (z. B. vor dem Umwandeln parametrischer Bauteile)
      ed.agentCall = true;
      let r: Awaited<ReturnType<ToolDef['run']>>;
      try {
        r = def.tier !== Tier.Edit || def.ownUndo ? await def.run(ed, args) : await ed.batch(() => def.run(ed, args), t('KI-Agent: {tool}', { tool: name }));
      } finally {
        ed.agentCall = false;
      }
      log({ time: new Date(), tool: name, summary: summarize(args), ok: true });
      return { result: { content: Array.isArray(r) ? r : json(r) } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log({ time: new Date(), tool: name, summary: `${summarize(args)} → ${msg}`, ok: false });
      return { result: { content: [{ type: 'text', text: msg }], isError: true } };
    }
  }
  return { error: { code: -32601, message: `Method not found: ${req.method}` } };
}

/** Beim Start der Oberfläche: Aufrufe des Agenten-Servers annehmen */
export async function startAgentBridge(ed: Editor) {
  if (!isTauri()) return;
  const { listen } = await import('@tauri-apps/api/event');
  const { invoke } = await import('@tauri-apps/api/core');
  await listen<RpcRequest>('agent-request', async (e) => {
    let response: object;
    try {
      response = await handle(ed, e.payload);
    } catch (err) {
      response = { error: { code: -32603, message: String(err) } };
    }
    await invoke('agent_respond', { id: e.payload.id, response });
  });
}

/** Für die Einstellungsseite: Namen und Stufen aller Werkzeuge */
export const toolOverview = () => TOOLS.map((d) => ({ name: d.name, title: d.title, tier: d.tier }));
