// Read-only diagnostic: does not bootstrap the app or write the supplied project.
import './core-fixtures-env';
import { readFileSync } from 'node:fs';
import { loadDoc } from '../src/model';
import { pathIslands } from '../src/pathIslands';
const doc=loadDoc(JSON.parse(readFileSync(process.argv[3],'utf8')));
console.log(JSON.stringify(doc.objs.map(obj=>{
  const base={id:obj.id,kind:obj.shape.kind,layer:obj.layer,locked:obj.locked,hidden:obj.hidden};
  if(obj.shape.kind!=='path')return base;
  try{return {...base,subpaths:obj.shape.subs.length,nodes:obj.shape.subs.reduce((n,s)=>n+s.nodes.length,0),islands:pathIslands(obj.shape.subs,{matrix:obj.m}).length}}
  catch(error){return {...base,subpaths:obj.shape.subs.length,nodes:obj.shape.subs.reduce((n,s)=>n+s.nodes.length,0),error:String(error)}}
}),null,2));
