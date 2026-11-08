// Trennwandgeometrie mit optionalem Steckspiel; Schnittfuge wird separat ergänzt.
// Koordinaten wie GenPart: Plattenmitte im Ursprung, y nach unten.
import type { SubPath } from '../model';
import { fingerboxSegments } from './fingerbox-experiment';
import { distributeGaps } from './fingerbox-distribution';

export interface DividerParams {
  width: number; depth: number; height: number; thickness: number; finger: number;
  compartmentsX: number; compartmentsY: number; ratiosX: string; ratiosY: string;
  dividerHeight: number; top?: 'open' | 'closed'; clearance?: number; slotClearance?: number;
}
export interface DividerResult {
  dividers: { key: string; outline: SubPath }[];
  holes: Record<'bottom' | 'front' | 'back' | 'left' | 'right', SubPath[]>;
  gapsX: number[]; gapsY: number[]; warnings: string[];
}
type Span = { a: number; b: number };
type Point = { x: number; y: number };

function clean(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) if (!out.length || Math.hypot(p.x-out[out.length-1].x,p.y-out[out.length-1].y)>1e-7) out.push(p);
  if (out.length > 1 && Math.hypot(out[0].x-out[out.length-1].x,out[0].y-out[out.length-1].y)<1e-7) out.pop();
  return out;
}
function loop(points: Point[], width: number, height: number, invert: boolean): SubPath {
  return { closed: true, nodes: clean(points).map((p) => ({ x: p.x-width/2, y: invert ? height/2-p.y : p.y-height/2 })) };
}
function rect(x0: number, x1: number, y0: number, y1: number, width: number, height: number, invert: boolean): SubPath {
  return loop([{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}],width,height,invert);
}

/** Zahnabschnitte zwischen Wänden und Kreuzungen: nie auf einer Kreuzungsnut. */
function bottomFingers(start: number, end: number, crossings: number[], t: number, finger: number, warnings: string[]): Span[] {
  const fields: Span[] = [];
  let cursor = start;
  for (const c of crossings) {
    const a = c-t/2, b = c+t/2;
    if (a <= cursor || b >= end) throw new Error('Trennwände überlappen oder liegen außerhalb des Innenraums.');
    fields.push({ a: cursor, b: a }); cursor = b;
  }
  fields.push({a:cursor,b:end});
  const spans: Span[] = [];
  for (const field of fields) {
    const len = field.b-field.a;
    if (crossings.length && len < 3*t-1e-9) { warnings.push('Schmales Fach ohne Bodenzinken.'); continue; }
    const n = fingerboxSegments(len, finger), step = len/n;
    for (let i=1; i<n; i+=2) spans.push({a:field.a+i*step,b:field.a+(i+1)*step});
  }
  return spans;
}

/** Unterkante mit Bodenzinken und optionalen, nach unten offenen Kreuzungsnuten. */
function bottomEdge(start: number, end: number, fingers: Span[], crossings: number[], t: number, mid: number, slotWidth = t): Point[] {
  const notches = crossings.map((c) => ({a:c-slotWidth/2,b:c+slotWidth/2}));
  const cuts = [start,end,...fingers.flatMap((s) => [s.a,s.b]),...notches.flatMap((s) => [s.a,s.b])].sort((a,b)=>a-b);
  const pts: Point[] = [];
  for (let i=0;i<cuts.length-1;i++) {
    const a=cuts[i], b=cuts[i+1]; if (b-a<1e-9) continue;
    const m=(a+b)/2;
    const y=notches.some((s)=>m>s.a && m<s.b) ? mid : fingers.some((s)=>m>s.a && m<s.b) ? 0 : t;
    pts.push({x:a,y},{x:b,y});
  }
  return clean(pts);
}
function topEdge(start: number, end: number, crossings: number[], t: number, height: number, slotWidth = t): Point[] {
  const pts: Point[] = [{x:end,y:height}];
  for (const c of [...crossings].reverse()) {
    pts.push({x:c+slotWidth/2,y:height},{x:c+slotWidth/2,y:height/2},{x:c-slotWidth/2,y:height/2},{x:c-slotWidth/2,y:height});
  }
  pts.push({x:start,y:height}); return pts;
}

export function makeDividers(p: DividerParams): DividerResult {
  const {width:W,depth:D,height:H,thickness:t,finger,dividerHeight:hd} = p;
  if (![W,D,H,t,finger,hd].every((n)=>Number.isFinite(n) && n>0) || hd>H || hd<=2*t) throw new Error('Ungültige Trennwandhöhe oder Maße.');
  if (p.top === 'closed' && hd > H-t+1e-9) throw new Error('Trennwände reichen in den Deckel.');
  const clearance = p.clearance ?? 0, slotClearance = p.slotClearance ?? clearance, slotWidth = t + slotClearance;
  if (!Number.isFinite(clearance) || !Number.isFinite(slotClearance) || slotWidth <= 0) throw new Error('Ungültiges Steckspiel.');
  const x = distributeGaps(W,t,p.compartmentsX,p.ratiosX), y = distributeGaps(D,t,p.compartmentsY,p.ratiosY);
  const nx=x.centres, ny=y.centres;
  const nh=fingerboxSegments(hd,finger), dy=hd/nh;
  if (dy<=t+1e-9) throw new Error('Zinkenabschnitte der Trennwand sind zu kurz für die Materialdicke.');
  const result: DividerResult = {dividers:[],holes:{bottom:[],front:[],back:[],left:[],right:[]},gapsX:x.gaps,gapsY:y.gaps,warnings:[]};
  const vertical: Span[] = [];
  for (let i=1;i<nh;i+=2) vertical.push({a:i*dy,b:(i+1)*dy});
  function make(axis:'x'|'y', centre:number, number:number) {
    const length=axis==='x'?D:W, crossings=axis==='x'?ny:nx;
    const fs=bottomFingers(t,length-t,crossings,t,finger,result.warnings);
    const teeth = fs.map(({a,b}) => ({a:a+clearance/2,b:b-clearance/2}));
    const vt = vertical.map(({a,b}) => ({a:a+clearance/2,b:b-clearance/2}));
    if ([...teeth,...vt].some(({a,b}) => b-a<=1e-7)) throw new Error('Das Steckspiel ist für einen Zinkenabschnitt zu groß.');
    for (const c of crossings) if (teeth.some(({a,b}) => a < c + slotWidth/2 && b > c - slotWidth/2)) throw new Error('Steckspiel führt zu überlappenden Schlitzen und Zinken.');
    const points = bottomEdge(t,length-t,teeth,axis==='y'?crossings:[],t,hd/2,slotWidth);
    for (let i=0;i<nh;i++) {
      const offset=i%2 ? t : 0, a=i===0?t:i%2 ? vt[(i-1)/2].a : vertical[(i/2)-1].b - clearance/2, b=i%2 ? vt[(i-1)/2].b : i===nh-1 ? hd : vertical[i/2].a+clearance/2;
      points.push({x:length-t+offset,y:a},{x:length-t+offset,y:b});
    }
    points.push(...topEdge(t,length-t,axis==='x'?crossings:[],t,hd,slotWidth));
    for (let i=nh-1;i>=0;i--) {
      const offset=i%2 ? t : 0, a=i===0?t:i%2 ? vt[(i-1)/2].a : vertical[(i/2)-1].b - clearance/2, b=i%2 ? vt[(i-1)/2].b : i===nh-1 ? hd : vertical[i/2].a+clearance/2;
      points.push({x:t-offset,y:b},{x:t-offset,y:a});
    }
    result.dividers.push({key:`div${axis}-${number}`,outline:loop(points,length,hd,true)});
    for (const s of fs) {
      result.holes.bottom.push(axis==='x' ? rect(centre-slotWidth/2,centre+slotWidth/2,s.a,s.b,W,D,false) : rect(s.a,s.b,centre-slotWidth/2,centre+slotWidth/2,W,D,false));
    }
    for (const s of vertical) {
      const wall=rect(centre-slotWidth/2,centre+slotWidth/2,s.a,s.b,axis==='x'?W:D,H,true);
      if (axis==='x') { result.holes.front.push(wall); result.holes.back.push(structuredClone(wall)); }
      else { result.holes.left.push(wall); result.holes.right.push(structuredClone(wall)); }
    }
  }
  nx.forEach((c,i)=>make('x',c,i+1));
  ny.forEach((c,i)=>make('y',c,i+1));
  return result;
}