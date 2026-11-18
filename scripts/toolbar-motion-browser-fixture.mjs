import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

const out = 'artifacts/toolbar-motion-browser';
await mkdir(out, { recursive: true });
const result = await build({
  stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
import { createToolbarMotion, LAYOUT_SETTLE_MS } from './src/toolbars/motion';

window.runToolbarMotionChecks = async () => {
  const errors = [], passed = [];
  const check = (ok, name) => (ok ? passed : errors).push(name);
  const originalNodes = [...document.body.childNodes];
  const originalMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  const focus = document.activeElement;
  let reduced = false;
  const media = new EventTarget();
  const listeners = new Set();
  const addListener = media.addEventListener.bind(media);
  const removeListener = media.removeEventListener.bind(media);
  media.addEventListener = (type, listener) => { listeners.add(listener); addListener(type, listener); };
  media.removeEventListener = (type, listener) => { listeners.delete(listener); removeListener(type, listener); };
  Object.defineProperty(media, 'matches', { get: () => reduced });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => media });
  const app = document.createElement('div');
  app.className = 'toolbar-layout-app';
  app.style.cssText = 'position:fixed;left:37px;top:29px;width:700px;height:500px';
  const make = (parent, className, id, left, top, width, height) => {
    const node = document.createElement('div');
    node.className = className; node.id = id;
    node.style.cssText = 'position:absolute;left:'+left+'px;top:'+top+'px;width:'+width+'px;height:'+height+'px';
    parent.append(node); return node;
  };
  const peer = make(app, 'toolbar-layout-shell', '', 10, 10, 120, 32);
  const dragged = make(app, 'toolbar-layout-shell', '', 10, 60, 120, 32);
  const grip = make(dragged, '', '', 0, 0, 24, 24);
  const child = make(dragged, 'toolbar-layout-shell', '', 30, 0, 24, 24);
  const main = make(app, '', 'main', 150, 100, 480, 300);
  const outside = make(document.createElement('div'), 'toolbar-layout-shell', '', 0, 0, 50, 30);
  const motion = createToolbarMotion(document);
  let unrelated;
  const animations = () => [...peer.getAnimations(), ...main.getAnimations()];
  try {
    document.body.replaceChildren(app, outside.parentElement);
    check(!motion.capture(dragged).rects.has(child), 'excluded shell descendants never animate');
    const snapshot = motion.capture(grip);
    peer.style.left = '80px'; dragged.style.left = '90px';
    main.style.left = '190px'; main.style.width = '400px';
    motion.settle(snapshot);
    const active = animations();
    check(active.length === 2 && active.every(a => a.effect.getTiming().duration === 150) && LAYOUT_SETTLE_MS === 150,
      'peer and workspace use real 150 ms animations');
    check(dragged.getAnimations().length === 0 && outside.getAnimations().length === 0,
      'excluded ancestor shell follows directly; unrelated shell never animates');
    const peerFrames = peer.getAnimations()[0]?.effect.getKeyframes();
    const mainFrames = main.getAnimations()[0]?.effect.getKeyframes();
    check(peerFrames?.[0].transform.includes('scale(1, 1)') && mainFrames?.[0].transform.includes('scale(1.2, 1)'),
      'peers translate only and workspace width change scales');
    check(active.every(a => a.effect.getKeyframes().every(f =>
      Object.keys(f).every(k => ['offset','computedOffset','easing','composite','transform'].includes(k)))),
      'only transform is animated');
    check(peer.offsetLeft === 80 && main.offsetWidth === 400,
      'layout hit geometry immediately has final coordinates');
    // Headless tabs may suspend their paint clock; seek the native animation end state.
    active.forEach(a => a.finish());
    await Promise.all(active.map(a => a.finished));
    check(getComputedStyle(peer).transform === 'none' && getComputedStyle(main).transform === 'none',
      'native animation end state leaves no final transform');
    motion.settle(motion.capture(grip));
    check(animations().length === 0, 'unchanged geometry starts no animations');

    let before = motion.capture(grip);
    peer.style.left = '140px'; main.style.width = '360px'; motion.settle(before);
    const interrupted = animations();
    before = motion.capture(grip);
    check(interrupted.every(a => a.playState === 'idle') && before.rects.get(peer).left === peer.getBoundingClientRect().left &&
      before.rects.get(main).width === 360, 'capture cancels own animations before measuring actual target geometry');
    peer.style.left = '160px'; main.style.width = '320px'; motion.settle(before);
    const resumed = animations();
    resumed.forEach(a => a.finish());
    await Promise.all(resumed.map(a => a.finished));
    check(getComputedStyle(peer).transform === 'none' && main.style.transform === '',
      'interrupted layout finishes without residual transforms');

    unrelated = peer.animate([{ opacity: 0.8 }, { opacity: 1 }], { duration: 10000 });
    before = motion.capture(grip); peer.style.left = '180px'; motion.settle(before);
    motion.cancel();
    check(unrelated.playState !== 'idle' && peer.getAnimations().length === 1,
      'explicit cancel retains unrelated animation');
    before = motion.capture(grip); peer.style.left = '200px'; motion.settle(before);
    reduced = true; media.dispatchEvent(new Event('change'));
    check(peer.getAnimations().length === 1, 'live reduced-motion change cancels active owned motion');
    check(motion.capture(grip).rects.size === 0, 'reduced motion disables capture');
    reduced = false; before = motion.capture(grip); peer.style.left = '220px';
    reduced = true; motion.settle(before);
    check(peer.getAnimations().length === 1, 'reduced motion is checked again at settle');
    reduced = false;
    before = motion.capture(grip); peer.style.left = '240px'; motion.settle(before);
    motion.dispose();
    check(unrelated.playState !== 'idle' && peer.getAnimations().length === 1,
      'dispose cancels owned animation only');
    check(listeners.size === 0, 'dispose removes reduced-motion listener');
    check(motion.capture().rects.size === 0, 'disposed helper stays inert');
    const absentAPI = document.implementation.createHTMLDocument('headless');
    const fallback = createToolbarMotion(absentAPI);
    fallback.settle(fallback.capture()); fallback.dispose();
    check(true, 'document without window or animation targets is safe');
    return { errors, passed };
  } finally {
    motion.dispose(); unrelated?.cancel();
    if (originalMedia) Object.defineProperty(window, 'matchMedia', originalMedia);
    else delete window.matchMedia;
    document.body.replaceChildren(...originalNodes);
    if (focus instanceof HTMLElement) focus.focus();
  }
};
` },
  bundle: true, write: false, outfile: 'fixture.js', format: 'esm',
});
await writeFile(out + '/fixture.js', result.outputFiles[0].contents);
await writeFile(out + '/index.html', '<!doctype html><html><meta charset="utf-8"><title>Toolbar motion fixture</title><body><script type="module" src="fixture.js"></script></body></html>');
console.log(out + '/index.html — await window.runToolbarMotionChecks()');
