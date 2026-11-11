import { lang, t } from './i18n';
import type { SubPath } from './model';
import type { PlacedSlot, SlotRecipe } from './slotPlacement';
import type { SlotReference, SlotVertex, StraightEdge, ProjectionFrame } from './straightSlots';
import type { ResolvedConstructionLine } from './slotConstruction';

export interface SlotPreviewRequest { id: number; recipe: SlotRecipe; cornerAngle: number; lang: string; visibleSlotIds?: string[] }
export interface SlotPreviewResult { subs: SubPath[]; slots: PlacedSlot[]; frames: { id: string; frame: ProjectionFrame }[]; helpers: ResolvedConstructionLine[]; edges: StraightEdge[]; vertices: SlotVertex[]; references: SlotReference[] }
export interface SlotPreviewReply { id: number; result?: SlotPreviewResult; error?: string }
export interface SlotPreviewClient {
  request(recipe: SlotRecipe, cornerAngle: number, onResult: (reply: SlotPreviewReply) => void, visibleSlotIds?: string[]): void;
  dispose(): void;
}

/** One calculation at a time; superseded calculations never update the dialog. */
export function createSlotPreviewClient(): SlotPreviewClient {
  type Pending = { message: SlotPreviewRequest; callback: (reply: SlotPreviewReply) => void };
  let worker: Worker | undefined, inflight: Pending | undefined, queued: Pending | undefined;
  let latest = 0, disposed = false, failure: string | undefined;
  const diagnostic = (detail: string) => t('Schlitzvorschau fehlgeschlagen. Dialog schließen und erneut öffnen. {detail}', { detail });
  const fail = (detail: string) => {
    failure = diagnostic(detail);
    worker?.terminate(); worker = undefined;
    const pending = queued ?? inflight;
    queued = undefined; inflight = undefined;
    if (!disposed && pending?.message.id === latest) pending.callback({ id: latest, error: failure });
  };
  const send = (pending: Pending) => {
    inflight = pending;
    try { worker!.postMessage(pending.message); }
    catch (error) { fail(error instanceof Error ? error.message : String(error)); }
  };
  const start = () => {
    worker = new Worker(new URL('./slotPreview.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<SlotPreviewReply>) => {
      if (disposed || !inflight || event.data.id !== inflight.message.id) return;
      const completed = inflight;
      inflight = undefined;
      const next = queued; queued = undefined;
      if (next) send(next);
      if (!disposed && completed.message.id === latest) completed.callback(event.data);
    };
    worker.onerror = (event) => { event.preventDefault(); if (!disposed) fail(event.message); };
    worker.onmessageerror = () => { if (!disposed) fail('Worker message could not be decoded.'); };
  };
  return {
    request(recipe, cornerAngle, callback, visibleSlotIds) {
      if (disposed) return;
      const id = ++latest;
      if (failure) { callback({ id, error: failure }); return; }
      let pending: Pending;
      try {
        // A queued request must not observe subsequent edits to the dialog's recipe.
        pending = { message: { id, recipe: structuredClone(recipe), cornerAngle, lang, visibleSlotIds: visibleSlotIds?.slice() }, callback };
      } catch (error) {
        queued = undefined;
        callback({ id, error: diagnostic(error instanceof Error ? error.message : String(error)) });
        return;
      }
      if (inflight) { queued = pending; return; }
      queued = pending;
      try { if (!worker) start(); }
      catch (error) { fail(error instanceof Error ? error.message : String(error)); return; }
      queued = undefined;
      send(pending);
    },
    dispose() {
      disposed = true;
      queued = undefined; inflight = undefined;
      worker?.terminate(); worker = undefined;
    },
  };
}
