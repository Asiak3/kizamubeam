// Local diagnostic map only; generated geometry stays in artifacts, never committed.
import {readFile,writeFile} from 'node:fs/promises';
const bytes=await readFile(process.argv[2]);
const report=JSON.parse(bytes.toString(bytes[0]===255&&bytes[1]===254?'utf16le':'utf8').replace(/^\uFEFF/,''));
const d=(ps,closed)=>ps.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' ')+(closed?'Z':'');
const all=report.sourcePaths.flatMap(p=>p.points),x0=Math.min(...all.map(p=>p.x)),y0=Math.min(...all.map(p=>p.y)),x1=Math.max(...all.map(p=>p.x)),y1=Math.max(...all.map(p=>p.y));
const paths=report.sourcePaths.map(p=>`<path d="${d(p.points,p.closed)}" fill="none" stroke="#444" stroke-width="0.04"/>`).join('');
const contours=report.contours.map(c=>{
 const color=c.blocked?'#b00020':c.single==='ok'?'#007f60':'#ed7b00';
 const center={x:(c.bounds.x0+c.bounds.x1)/2,y:(c.bounds.y0+c.bounds.y1)/2};
 return `<path d="${d(c.polygon,true)}" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="0.04"/><text x="${center.x}" y="${center.y}" text-anchor="middle" fill="${color}" font-size="0.65" font-family="sans-serif">${c.index}</text>`;
}).join('');
await writeFile(process.argv[3],`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="700" viewBox="${x0-1} ${y0-1} ${x1-x0+2} ${y1-y0+2}"><rect x="${x0-1}" y="${y0-1}" width="${x1-x0+2}" height="${y1-y0+2}" fill="white"/>${paths}${contours}</svg>`);
