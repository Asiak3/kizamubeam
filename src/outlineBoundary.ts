// Restore a detected polygon from its contributing exact source intervals.
// Never refit a curve or replace an untraceable edge with an invented chord.
import type { Path } from './clip';
import type { OutlineNetwork, NetworkPoint, NetworkSpan } from './outlineNetwork';
import type { SubPath } from './model';
import { extract, reverseSub, piecesOf, intersectPieces, type Piece } from './pathtools';
import { bezierPt } from './curves';

const key = (p: NetworkPoint) => `${p.X}:${p.Y}`;
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const fail = (reason = 'unknown') => Object.assign(new Error('outline-boundary'), { cause: reason });
type Step = { to: NetworkPoint; refs: NetworkSpan[] };
const contexts=new WeakMap<OutlineNetwork,{edges:OutlineNetwork['edges'];outgoing:Map<string,Step[]>;vertices:Map<string,NetworkPoint>;pieces:(Piece[]|undefined)[]}>();

function boundaryContext(network:OutlineNetwork){
  const cached=contexts.get(network);if(cached?.edges===network.edges)return cached;
  const outgoing=new Map<string,Step[]>(),vertices=new Map<string,NetworkPoint>();
  for(const edge of network.edges)for(const forward of [true,false]){
    const from=forward?edge.a:edge.b,to=forward?edge.b:edge.a,k=key(from);
    vertices.set(k,from);
    const refs=forward?edge.sources:edge.sources.map(s=>({path:s.path,u0:s.u1,u1:s.u0}));
    const list=outgoing.get(k);if(list)list.push({to,refs});else outgoing.set(k,[{to,refs}]);
  }
  const result={edges:network.edges,outgoing,vertices,pieces:network.paths.map(p=>p.world?piecesOf(p.world):undefined)};
  contexts.set(network,result);return result;
}

export function outlineBoundary(polygon: Path, network: OutlineNetwork, junctionConnections: SubPath[] = []): SubPath {
  const {outgoing,vertices,pieces}=boundaryContext(network);
  const pointAt=(path:number,u:number)=>{
    const ps=pieces[path];if(!ps?.length)throw fail();
    const k=Math.min(ps.length-1,Math.max(0,Math.floor(u))),p=ps[k],t=Math.min(1,Math.max(0,u-k));
    return p.curve?bezierPt(p.a,p.c1,p.c2,p.b,t):{x:p.a.x+(p.b.x-p.a.x)*t,y:p.a.y+(p.b.y-p.a.y)*t};
  };
  const vertex = (p: NetworkPoint) => {
    if (vertices.has(key(p))) return vertices.get(key(p))!;
    const near: NetworkPoint[] = [];
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) {
      const v = vertices.get(`${p.X + x}:${p.Y + y}`); if (v) near.push(v);
    }
    if (near.length !== 1) throw fail(`vertex:${near.length}`);
    return near[0];
  };
  let work = 0;
  const spans: NetworkSpan[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = vertex(polygon[i]), b = vertex(polygon[(i + 1) % polygon.length]);
    const dx = b.X - a.X, dy = b.Y - a.Y, len = Math.hypot(dx, dy);
    const progress = (p: NetworkPoint) => (p.X - a.X) * dx + (p.Y - a.Y) * dy;
    const graph = new Map<string, { point: NetworkPoint; steps: Step[] }>(), pending = [a];
    while (pending.length) {
      const point = pending.pop()!, k = key(point); if (graph.has(k)) continue;
      if (++work > 1000000) throw fail();
      const steps = k === key(b) ? [] : (outgoing.get(k) ?? []).filter(s =>
        progress(s.to) > progress(point) && progress(s.to) <= progress(b) + 1e-6 &&
        Math.abs((s.to.X - a.X) * dy - (s.to.Y - a.Y) * dx) <= len * 1.5);
      graph.set(k, { point, steps }); steps.forEach(s => pending.push(s.to));
    }
    const routes = new Map<string, number>([[key(b), 1]]);
    for (const g of [...graph.values()].sort((u, v) => progress(v.point) - progress(u.point))) {
      if (key(g.point) !== key(b)) routes.set(key(g.point), Math.min(2, g.steps.reduce((n, s) => n + (routes.get(key(s.to)) ?? 0), 0)));
    }
    if (routes.get(key(a)) !== 1) throw fail(`routes:${routes.get(key(a)) ?? 0}`);
    let at = a;
    while (key(at) !== key(b)) {
      const choices = graph.get(key(at))!.steps.filter(s => (routes.get(key(s.to)) ?? 0) > 0);
      if (choices.length !== 1) throw fail();
      const step = choices[0], ref = step.refs[0], path = network.paths[ref.path].world;
      if (!path) throw fail();
      // Coincident source definitions are harmless only when they describe the
      // same geometric interval, including its interior, in this traversal.
      for (const other of step.refs.slice(1)) for (const t of [0, .25, .5, .75, 1]) {
        const q = network.paths[other.path].world;
        if (!q || distance(pointAt(ref.path, ref.u0 + t * (ref.u1 - ref.u0)), pointAt(other.path, other.u0 + t * (other.u1 - other.u0))) > .00001) throw fail('coincident-source-ambiguity');
      }
      const last = spans.at(-1);
      if (last && last.path === ref.path && Math.abs(last.u1 - ref.u0) < 1e-8 && (last.u1 - last.u0) * (ref.u1 - ref.u0) > 0) last.u1 = ref.u1;
      else spans.push({ ...ref });
      at = step.to;
    }
  }
  // A polygon's arbitrary starting vertex must not split an otherwise exact
  // source segment into extra editable edges.
  if (spans.length > 1) {
    const first = spans[0], last = spans.at(-1)!;
    if (first.path === last.path && Math.abs(last.u1 - first.u0) < 1e-8 && (last.u1 - last.u0) * (first.u1 - first.u0) > 0) {
      last.u1 = first.u1; spans.shift();
    }
  }
  // Refine polygonal crossings on the actual source curves. Only a unique
  // nearby crossing may replace the estimated intersection parameters.
  for (let i = 0; i < spans.length; i++) {
    const a = spans[i], b = spans[(i + 1) % spans.length], A = network.paths[a.path], B = network.paths[b.path];
    if (A.connection || B.connection || a.path === b.path) continue;
    const pa = pointAt(a.path, a.u1), pb = pointAt(b.path, b.u0);
    if (distance(pa, pb) < 1e-8) continue;
    const ap = pieces[a.path]!, bp = pieces[b.path]!;
    // A polygonal estimate can fall just across a source-node boundary.
    const indices = (u: number, n: number) => [Math.floor(u)-1,Math.floor(u),Math.floor(u)+1].filter(k => k >= 0 && k < n);
    const hits: { u: number; v: number; d: number }[] = [];
    for (const x of indices(a.u1, ap.length)) for (const y of indices(b.u0, bp.length)) {
      for (const seed of intersectPieces(ap[x], bp[y])) {
        let [u, v] = seed;
        const tangent = (p: typeof ap[number], t: number) => p.curve ? {
          x: 3 * ((1-t)**2 * (p.c1.x-p.a.x) + 2*(1-t)*t*(p.c2.x-p.c1.x) + t*t*(p.b.x-p.c2.x)),
          y: 3 * ((1-t)**2 * (p.c1.y-p.a.y) + 2*(1-t)*t*(p.c2.y-p.c1.y) + t*t*(p.b.y-p.c2.y)),
        } : { x: p.b.x-p.a.x, y: p.b.y-p.a.y };
        for (let step=0;step<12;step++) {
          const p=pointAt(a.path,x+u),q=pointAt(b.path,y+v),d={x:q.x-p.x,y:q.y-p.y};
          if (Math.hypot(d.x,d.y)<1e-10) break;
          const ta=tangent(ap[x],u),tb=tangent(bp[y],v),den=ta.x*tb.y-ta.y*tb.x;
          if (Math.abs(den)<1e-12) break;
          const du=(d.x*tb.y-d.y*tb.x)/den,dv=(d.x*ta.y-d.y*ta.x)/den;
          if (u+du<0||u+du>1||v+dv<0||v+dv>1) break;
          u+=du;v+=dv;
        }
        const p = pointAt(a.path, x + u), q = pointAt(b.path, y + v);
        const d = Math.max(distance(p, pa), distance(q, pb));
        if (d <= .005 && distance(p, q) < 1e-8 && Math.abs(x + u - a.u1) < .1 && Math.abs(y + v - b.u0) < .1)
          hits.push({ u: x + u, v: y + v, d });
      }
    }
    hits.sort((a, b) => a.d - b.d);
    if (hits.length && !hits.some(h => Math.abs(h.d - hits[0].d) < 1e-8 && (Math.abs(h.u - hits[0].u) > 1e-6 || Math.abs(h.v - hits[0].v) > 1e-6))) {
      a.u1 = hits[0].u; b.u0 = hits[0].v;
    }
  }
  // Integer-grid detection can omit a genuine sub-micron source segment.
  // Restore that exact interval instead of inventing a closing line or deleting
  // the short span. Only a contiguous, consistently oriented source gap qualifies.
  for(let i=0;i<spans.length;i++) {
    const a=spans[i],b=spans[(i+1)%spans.length];
    if(a.path!==b.path||Math.abs(a.u1-b.u0)<1e-8||Math.abs(a.u1-b.u0)>1.001||
      (a.u1-a.u0)*(b.u0-a.u1)<=0||(b.u1-b.u0)*(b.u0-a.u1)<=0)continue;
    const path=network.paths[a.path].world!,gap=extract(path,Math.min(a.u1,b.u0),Math.max(a.u1,b.u0));
    if(gap.nodes.length<2||gap.nodes.some(n=>[n,n.cin,n.cout].some(p=>p&&distance(p,gap.nodes[0])>.003)))continue;
    spans.splice(i+1,0,{path:a.path,u0:a.u1,u1:b.u0});i++;
  }
  const chunks = spans.map(s => {
    const path = network.paths[s.path].world!, reversed = s.u1 < s.u0;
    const chunk = extract(path, Math.min(s.u0, s.u1), Math.max(s.u0, s.u1));
    if (reversed) reverseSub(chunk);
    if (chunk.nodes.length < 2) throw fail('collapsed-source-interval');
    return chunk;
  });
  // Only declared tolerance connectors may bridge different source positions.
  // Align their quantized endpoints to the unchanged exact source endpoints;
  // never insert an unreported microscopic closing chord between source curves.
  const joins=new Set<number>();
  for (let i=0;i<chunks.length;i++) {
    const j=(i+1)%chunks.length,a=chunks[i].nodes.at(-1)!,b=chunks[j].nodes[0];
    const gap=distance(a,b);if(gap<1e-8)continue;
    if(gap>.003)throw fail(`source-gap:${gap}`);
    if(network.paths[spans[i].path].connection){a.x=b.x;a.y=b.y;}
    else if(network.paths[spans[j].path].connection){b.x=a.x;b.y=a.y;}
    else if(gap<=(network.tolerance??0)) {
      // A quantized junction can join two exact curves which narrowly miss.
      // Preserve both and explicitly report this short tolerance connection;
      // never silently move either source endpoint to the polygonal crossing.
      joins.add(i);junctionConnections.push({closed:false,nodes:[{x:a.x,y:a.y},{x:b.x,y:b.y}]});
    } else throw fail(`unresolved-exact-intersection:${gap}:${spans[i].path}/${spans[i].u1}:${spans[j].path}/${spans[j].u0}`);
  }
  for(let i=0;i<chunks.length;i++) if(network.paths[spans[i].path].connection &&
    distance(chunks[i].nodes[0],chunks[i].nodes.at(-1)!)>(network.tolerance??0)+.002)throw fail('connection-outside-tolerance');
  const nodes: SubPath['nodes'] = [];
  for (const [index,chunk] of chunks.entries()) {
    if (chunk.nodes.length < 2) throw fail('collapsed-source-interval');
    if (!nodes.length) nodes.push(...chunk.nodes);
    else {
      const previous = nodes.at(-1)!, first = chunk.nodes[0], gap = distance(previous, first);
      if (gap >= 1e-8) {
        if(!joins.has(index-1))throw fail('unresolved-exact-intersection');
        nodes.push(...chunk.nodes);
      } else {previous.cout = first.cout; nodes.push(...chunk.nodes.slice(1));}
    }
  }
  if (nodes.length < 3 || (distance(nodes[0], nodes.at(-1)!) >= 1e-8&&!joins.has(chunks.length-1))) throw fail('closure-gap');
  if (distance(nodes[0], nodes.at(-1)!) < 1e-8) {
    nodes[0].cin = nodes.at(-1)!.cin; nodes.pop();
  }
  return { closed: true, nodes };
}
