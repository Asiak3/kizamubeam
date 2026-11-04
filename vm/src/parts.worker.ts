// Runs the cut-out analysis (parts.ts) off the main thread; a large piece takes about half a second.
import { analyze, type MapData } from './parts';

self.onmessage = (e: MessageEvent<{ id: string; version: number; map: MapData }>) => {
  const { id, version, map } = e.data;
  (self as unknown as Worker).postMessage({ id, version, analysis: analyze(map) });
};
