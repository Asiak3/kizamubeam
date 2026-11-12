// Read-only local diagnostics. Never writes the project or starts the application.
import './core-fixtures-env';
import { readFileSync } from 'node:fs';
const { loadDoc, defaultLayer } = await import('../src/model');
const { checkDesign, DEFAULT_CHECK } = await import('../src/check');
const doc = loadDoc(JSON.parse(readFileSync(process.argv[3], 'utf8')));
const layer = (i: number) => doc.layers[i] ?? defaultLayer(i);
const issues = checkDesign({ objs: doc.objs, layer, bed: doc.bed, settings: DEFAULT_CHECK });
const cutsOnly = checkDesign({ objs: doc.objs.filter((o) => layer(o.layer).mode === 'line'), layer, bed: doc.bed, settings: DEFAULT_CHECK });
console.log(JSON.stringify({ objects: doc.objs.map((o) => ({ id: o.id, layer: o.layer, kind: o.shape.kind, name: o.name })),
  sameCutFindingsWithoutFill: JSON.stringify(issues.filter((x) => x.kind === 'web' || x.kind === 'double').map((x) => [x.key,x.msg])) ===
    JSON.stringify(cutsOnly.filter((x) => x.kind === 'web' || x.kind === 'double').map((x) => [x.key,x.msg])),
  counts: issues.reduce((acc, x) => { const k = `${x.kind}:${x.level}`; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {} as Record<string, number>),
  issues: issues.map((x) => ({ key: x.key, kind: x.kind, level: x.level, msg: x.msg,
    objects: x.objs.map((o) => ({ id: o.id, layer: o.layer, mode: layer(o.layer).mode })),
    fix: x.fix?.kind, lineCount: x.lines.length, firstLines: x.lines.slice(0, 2),
    shortestCrossings: x.kind === 'web' ? [...x.lines].sort((a,b) => Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)-Math.hypot(b[0].x-b[1].x,b[0].y-b[1].y)).slice(0,2) : undefined })) }, null, 2));
