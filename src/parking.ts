// Parking: parts that lie completely outside the work area are left out of the job without a warning, as long as
// something else on the page is (at least partly) inside. So spare parts can wait next to the bed for a later job.
import { boundsOf } from './geom';
import { Layer, Obj, outputLeaves, selfOutputOff } from './model';

/** Does the top-level object put anything on a layer with output? */
export function lasers(o: Obj, layer: (i: number) => Layer): boolean {
  for (const [l] of outputLeaves([o])) if (!l.reg && layer(l.layer).output) return true;
  return false;
}

/** Top-level objects parked outside the work area (internal coordinates: bed from 0,0 to w,h) */
export function parkedObjs(objs: Obj[], bed: { w: number; h: number }, layer: (i: number) => Layer): Set<Obj> {
  const out = new Set<Obj>();
  let inside = false;
  for (const o of objs) {
    // Hidden zählt mit (Issue #217: nimmt weiter am Job teil); noLaser/showIf-falsch schließt aus
    if (selfOutputOff(o) || !lasers(o, layer)) continue;
    const b = boundsOf([o]);
    if (!b) continue;
    const away = b.x >= bed.w || b.y >= bed.h || b.x + b.w <= 0 || b.y + b.h <= 0;
    if (away) out.add(o);
    else inside = true;
  }
  return inside ? out : new Set();
}
