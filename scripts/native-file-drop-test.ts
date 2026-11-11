import assert from 'node:assert/strict';
import { installNativeFileDrop, type NativeFileDrop, type NativeDropServices } from '../src/nativeFileDrop';
const tick=()=>new Promise<void>(r=>setImmediate(r));
let checks=0;
async function test(name:string,fn:()=>Promise<void>){await fn();checks++;console.log('PASS '+name);}
function harness(overrides:Partial<NativeDropServices>={}){
  let receive!:(e:NativeFileDrop)=>void,live=true,unlistened=0;
  const reads:string[]=[],drops:{names:string[];x:number;y:number;bytes:number[]}[]=[],errors:unknown[]=[];
  const dispose=installNativeFileDrop({
    subscribe:async fn=>{receive=fn;return()=>{unlistened++;};},
    read:async path=>{reads.push(path);return new TextEncoder().encode(path.endsWith('.svg')?'<svg/>':'PNG').buffer;},
    scaleFactor:async()=>2,captureContext:()=>()=>live,
    deliver:(files,x,y)=>drops.push({names:files.map(f=>f.name),x,y,bytes:files.map(f=>f.bytes.byteLength)}),
    error:e=>errors.push(e),...overrides,
  });
  return {emit:(e:NativeFileDrop)=>receive(e),reads,drops,errors,dispose,changeContext:()=>{live=false;},unlistened:()=>unlistened};
}
await test('SVG and image native paths become one logical-coordinate drop, duplicates import once',async()=>{
  const h=harness();h.emit({type:'drop',paths:['C:\\drawings\\frame.svg','C:\\images\\photo.png','C:\\drawings\\frame.svg'],position:{x:400,y:200}});await tick();
  assert.deepEqual(h.reads,['C:\\drawings\\frame.svg','C:\\images\\photo.png']);assert.deepEqual(h.drops,[{names:['frame.svg','photo.png'],x:200,y:100,bytes:[6,3]}]);assert.equal(h.errors.length,0);h.dispose();
});
await test('hover, cancellation and URL/text drags do not read any file',async()=>{
  const h=harness();for(const type of ['enter','over','leave'])h.emit({type,paths:['C:/test.svg'],position:{x:0,y:0}});
  h.emit({type:'drop',position:{x:1,y:1}});await tick();assert.equal(h.reads.length,0);assert.equal(h.drops.length,0);h.dispose();
});
await test('document changes while reading prevent delivery to a different document',async()=>{
  let finish!:(data:ArrayBuffer)=>void;const h=harness({read:()=>new Promise(resolve=>{finish=resolve;})});
  h.emit({type:'drop',paths:['C:/test.svg'],position:{x:10,y:10}});await tick();h.changeContext();finish(new ArrayBuffer(4));await tick();assert.equal(h.drops.length,0);h.dispose();
});
await test('read errors are reported and a subsequent drop remains usable',async()=>{
  let first=true;const h=harness({read:async()=>{if(first){first=false;throw Error('read failed');}return new ArrayBuffer(3);}});
  h.emit({type:'drop',paths:['C:/one.svg'],position:{x:10,y:10}});await tick();assert.equal(h.errors.length,1);assert.equal(h.drops.length,0);
  h.emit({type:'drop',paths:['C:/two.svg'],position:{x:10,y:10}});await tick();assert.equal(h.drops.length,1);h.dispose();
});
await test('invalid coordinates are rejected and disposal cancels an in-flight read',async()=>{
  const invalid=harness({scaleFactor:async()=>0});invalid.emit({type:'drop',paths:['C:/test.svg'],position:{x:10,y:10}});await tick();assert.equal(invalid.errors.length,1);assert.equal(invalid.reads.length,0);invalid.dispose();
  let finish!:(data:ArrayBuffer)=>void;const h=harness({read:()=>new Promise(resolve=>{finish=resolve;})});
  h.emit({type:'drop',paths:['C:/test.svg'],position:{x:10,y:10}});await tick();h.dispose();finish(new ArrayBuffer(4));await tick();assert.equal(h.drops.length,0);assert.equal(h.unlistened(),1);
});
console.log(`Native file drop: ${checks} bridge checks passed; no OS drag or application startup.`);
