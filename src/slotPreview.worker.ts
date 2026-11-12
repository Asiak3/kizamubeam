// Type-only imports are essential: model/i18n must not run before bootstrap.
import type { SlotPreviewReply, SlotPreviewRequest } from './slotPreviewClient';

let geometry: Promise<{
  placement: typeof import('./slotPlacement');
  straight: typeof import('./straightSlots');
}> | undefined;
let baseKey = '', cachedBase: import('./model').SubPath[] | undefined;

function loadGeometry(lang: string) {
  if (!geometry) {
    // Worker-local shims only. No window, native bridge, storage or hardware access.
    Object.defineProperty(globalThis, 'document', { value: { documentElement: { lang } }, configurable: true });
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (key: string) => key === 'kizamubeam.lang' ? lang : null, setItem: () => {} },
      configurable: true,
    });
    geometry = Promise.all([import('./slotPlacement'), import('./straightSlots')])
      .then(([placement, straight]) => ({ placement, straight }));
  }
  return geometry;
}

globalThis.onmessage = async (event: MessageEvent<SlotPreviewRequest>) => {
  const { id, recipe, cornerAngle, lang, visibleSlotIds } = event.data;
  let reply: SlotPreviewReply;
  try {
    const { placement, straight } = await loadGeometry(lang);
    const key = JSON.stringify(recipe.base);
    if (key === baseKey && cachedBase) recipe.base = cachedBase;
    else { baseKey = key; cachedBase = recipe.base; }
    const { edges, vertices, references } = straight.straightGeometry(recipe.base, placement.recipeCornerAngle(recipe, cornerAngle));
    try {
      // Visibility is preview-only. Validate the complete output first so hiding
      // cannot conceal invalid dependencies, collisions or unsafe geometry.
      const complete = placement.cutSlots(recipe), { slots, helpers } = placement.resolvedFeatureGeometry(recipe);
      const subs = visibleSlotIds ? placement.cutSlots(recipe, new Set(visibleSlotIds)) : complete;
      const frames = slots.flatMap(slot => slot.projection ? [{ id: slot.id!, frame: placement.projectionFrame(recipe.base, slot) }] : []);
      reply = { id, result: { subs, slots, frames, helpers, edges, vertices, references } };
    } catch (error) {
      reply = { id, error: error instanceof Error ? error.message : String(error), result: { subs: recipe.base, slots: [], frames: [], helpers: [], edges, vertices, references } };
    }
  } catch (error) {
    reply = { id, error: error instanceof Error ? error.message : String(error) };
  }
  globalThis.postMessage(reply);
};
