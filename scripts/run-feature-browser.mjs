// Headless Chromium runner for isolated fixtures only; never starts the application.
// Usage: node scripts/run-feature-browser.mjs <fixture-directory> [function-name]
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
const directory = resolve(process.argv[2] ?? 'artifacts/feature-browser');
const suite = process.argv[3] ?? 'runFeatureChecks';
if (!/^[A-Za-z_$][\w$]*$/.test(suite)) throw Error('Invalid fixture function');
const binary = process.env.BROWSER_BIN ?? (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : 'google-chrome');
const base = process.platform === 'win32' && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : tmpdir();
await mkdir(base, { recursive: true });
const profile = await mkdtemp(join(base, 'feature-browser-'));
const server = createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const file = resolve(directory, name);
    if (!file.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] ?? 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const chrome = spawn(binary, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--window-size=1500,1000', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const exited = new Promise(resolve => chrome.once('exit', resolve));
let spawnError; chrome.once('error', error => { spawnError = error; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket, timeout;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw spawnError;
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); }
  }
  if (!port) throw Error('Chromium did not start; set BROWSER_BIN to a Chromium executable');
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let next = 0; const pending = new Map(), pageErrors = [];
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data), item = pending.get(result.id);
    if (result.method === 'Runtime.exceptionThrown') pageErrors.push(result.params.exceptionDetails.exception?.description ?? result.params.exceptionDetails.text);
    if (item) { pending.delete(result.id); result.error ? item.reject(result.error) : item.resolve(result.result); }
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  await call('Runtime.enable');
  await call('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (pageErrors.length) throw Error(pageErrors.join('\n'));
    const result = await call('Runtime.evaluate', { expression: 'typeof window.' + suite, returnByValue: true });
    if (result.result.value === 'function') { ready = true; break; }
    await delay(100);
  }
  if (!ready) throw Error('Fixture did not expose ' + suite);
  const result = await Promise.race([
    call('Runtime.evaluate', { expression: 'window.' + suite + '()', awaitPromise: true, returnByValue: true }),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Fixture timeout')), 30000); }),
  ]);
  clearTimeout(timeout);
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? 'Fixture failed');
  const report = result.result.value;
  if (suite === 'preparePencilCheck') {
    const { x, y } = report;
    await call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 60; i++) await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + i * 3, y: y + Math.sin(i / 10) * 30, button: 'left', buttons: 1 });
    await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 180, y: y + Math.sin(6) * 30, button: 'left', buttons: 0, clickCount: 1 });
    const trusted = await call('Runtime.evaluate', { expression: 'window.checkPencilResult()', returnByValue: true });
    if (trusted.exceptionDetails) throw Error('Trusted Pencil check failed');
    Object.assign(report, trusted.result.value); delete report.x; delete report.y;
  }
  report.pageErrors = pageErrors;
  await writeFile(join(directory, suite + '-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (report.errors?.length || pageErrors.length) process.exitCode = 1;
  await call('Browser.close');
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  clearTimeout(timeout); socket?.close(); server.close(); chrome.kill();
  if (!spawnError && chrome.exitCode === null && chrome.signalCode === null) await exited;
  // Remove only the fresh profile created by this invocation, never user profiles.
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(error => console.warn('Temporary profile cleanup:', error.message));
}
