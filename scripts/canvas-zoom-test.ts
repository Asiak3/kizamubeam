import assert from 'node:assert/strict';
import { canvasWheelFactor, installPinchGestures, pinchGestureActive } from '../src/canvasZoom';
let checks=0;
const test=(name:string,fn:()=>void)=>{fn();checks++;console.log('PASS '+name);};
test('ordinary wheel retains editor sensitivity and units; nonfinite deltas cannot poison zoom',()=>{
  for(const deltaY of [-100,100]) assert.ok(Math.abs(canvasWheelFactor({deltaY,deltaMode:0,ctrlKey:false},Math.log(1.0015))-Math.pow(1.0015,-deltaY))<1e-12);
  assert.equal(canvasWheelFactor({deltaY:NaN,deltaMode:0,ctrlKey:true},.005),1);
  assert.equal(canvasWheelFactor({deltaY:2,deltaMode:1,ctrlKey:false},.005),Math.exp(-.3));
});
test('precision pinch has the same visible sensitivity on workspace and slot preview',()=>{
  const e={deltaY:-2,deltaMode:0,ctrlKey:true};
  assert.equal(canvasWheelFactor(e,.005),canvasWheelFactor(e,Math.log(1.0015)));
  assert.ok(canvasWheelFactor(e,.005)>1.02);
  assert.ok(canvasWheelFactor({...e,deltaY:2},.005)<1);
  assert.ok(canvasWheelFactor({...e,deltaY:1e9},.005)>0);
});
const fake=()=>Object.assign(new EventTarget(),{getBoundingClientRect:()=>({left:10,top:20,width:200,height:100})}) as unknown as HTMLElement;
const gesture=(name:string,scale:number,x?:number,y?:number)=>Object.assign(new Event(name,{cancelable:true}),{scale,clientX:x,clientY:y});
test('gesture scale is incremental, pointer anchored and default browser zoom is cancelled',()=>{
  const el=fake(),calls:number[][]=[];const dispose=installPinchGestures(el,(...values)=>calls.push(values));
  const start=gesture('gesturestart',1,50,60);el.dispatchEvent(start);assert.equal(start.defaultPrevented,true);assert.equal(pinchGestureActive(el),true);
  const change=gesture('gesturechange',1.5,50,60);el.dispatchEvent(change);assert.equal(change.defaultPrevented,true);assert.deepEqual(calls[0],[1.5,40,40]);
  el.dispatchEvent(gesture('gesturechange',1.8,50,60));assert.ok(Math.abs(calls[1][0]-1.2)<1e-12);
  el.dispatchEvent(gesture('gestureend',1.8));assert.equal(pinchGestureActive(el),false);dispose();
});
test('invalid or unstarted gestures are ignored, missing coordinates use canvas centre',()=>{
  const el=fake(),calls:number[][]=[];const dispose=installPinchGestures(el,(...values)=>calls.push(values));
  el.dispatchEvent(gesture('gesturechange',2));assert.equal(calls.length,0);
  el.dispatchEvent(gesture('gesturestart',1));el.dispatchEvent(gesture('gesturechange',NaN));el.dispatchEvent(gesture('gesturechange',0));assert.equal(calls.length,0);
  el.dispatchEvent(gesture('gesturechange',2));assert.deepEqual(calls[0],[2,100,50]);dispose();
});
test('cancellation and disposal remove gesture ownership and all callbacks',()=>{
  const el=fake(),calls:number[]=[];const dispose=installPinchGestures(el,f=>calls.push(f));
  el.dispatchEvent(gesture('gesturestart',1));el.dispatchEvent(new Event('pointercancel'));assert.equal(pinchGestureActive(el),false);
  el.dispatchEvent(gesture('gesturestart',1));dispose();assert.equal(pinchGestureActive(el),false);
  el.dispatchEvent(gesture('gesturechange',2));assert.equal(calls.length,0);
});
console.log(`Canvas zoom: ${checks} checks passed (no native touchpad/hardware).`);
