// Bridge to the controller in Rust (src-tauri/src/lib.rs). Outside the desktop app there is no
// machine; the window then only shows a notice.

export type Flavor = 'grbl' | 'fluidnc';

export interface Config {
  flavor: Flavor;
  bedW: number;
  bedH: number;
  maxRate: number;
  accel: number;
  junctionDev: number;
  arcTolerance: number;
  sMax: number;
  laserMode: boolean;
  homing: boolean;
  mustHome: boolean;
  homingRate: number;
  softLimits: boolean;
  hardLimits: boolean;
  rxBuffer: number;
  plannerBlocks: number;
  statusMask: number;
  telnetEnabled: boolean;
  telnetPort: number;
  wsEnabled: boolean;
  wsPort: number;
  lan: boolean;
  /** optical laser power at 100 % in W (for burning the virtual material) */
  laserWatts: number;
  /** virtual camera: HTTP server with MJPEG stream and single images */
  cameraEnabled: boolean;
  cameraPort: number;
  cameraMount: 'fixed' | 'head';
  cameraWidth: number;
  cameraHeight: number;
  cameraFps: number;
  /** barrel distortion: shift at the image corner in % of the half diagonal */
  cameraLens: number;
}

export interface Snapshot {
  state: string;
  mpos: [number, number, number];
  wpos: [number, number, number];
  wco: [number, number, number];
  head: [number, number];
  feed: number;
  s: number;
  spindle: 'M3' | 'M4' | 'M5';
  laserOn: boolean;
  power: number;
  ovr: [number, number, number];
  flood: boolean;
  mist: boolean;
  outputs: number;
  plannerUsed: number;
  plannerSize: number;
  homed: boolean;
  alarm: number | null;
  jobTime: number;
  running: boolean;
}

export type VmEvent =
  | { type: 'console'; client: number; dir: 'in' | 'out' | 'rt'; text: string; status: boolean }
  | { type: 'warning'; code: 'rxOverflow' | 'frameHit'; client: number | null; x: number; y: number }
  | { type: 'alarm'; code: number }
  | { type: 'configChanged' };

export interface ClientInfo {
  id: number;
  kind: 'telnet' | 'ws';
  addr: string;
}

export interface Poll {
  snapshot: Snapshot;
  events: VmEvent[];
  /** 7 numbers per segment: x0, y0, x1, y1, power, duration, rapid */
  segments: number[];
  clients: ClientInfo[];
  /** someone watches the camera, so images should be rendered */
  cameraWanted: boolean;
  cameraViewers: number;
}

type Res = { Ok: string } | { Err: string } | null;
export interface ServerInfo {
  telnet: Res;
  ws: Res;
  camera: Res;
}

export const hasNative = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown> | Uint8Array): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export const api = {
  poll: () => invoke<Poll>('vm_poll'),
  config: () => invoke<Config>('vm_config'),
  setConfig: (config: Config) => invoke<ServerInfo>('vm_set_config', { config }),
  serverInfo: () => invoke<ServerInfo>('vm_server_info'),
  restartServers: () => invoke<ServerInfo>('vm_restart_servers'),
  send: (line: string) => invoke<void>('vm_send', { line }),
  realtime: (byte: number) => invoke<void>('vm_realtime', { byte }),
  powerCycle: () => invoke<void>('vm_power_cycle'),
  lanAddresses: () => invoke<string[]>('vm_lan_addresses'),
  /** camera image as JPEG (sent as raw body) */
  cameraFrame: (jpeg: Uint8Array) => invoke<void>('vm_camera_frame', jpeg),
};
