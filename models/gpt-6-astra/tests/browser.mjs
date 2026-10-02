import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createAppServer } from '../server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '.test-browser');
const artifacts = path.join(root, 'test-artifacts');
let chrome, profile, server, session;
let buffer = '', nextId = 1, stderr = '';
const pending = new Map(), listeners = new Map();
function command(method, params = {}, sessionId = session) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method + '\n' + stderr.slice(-1000))); }, 15000);
    pending.set(id, { resolve, reject, timeout });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
function receive(data) {
  buffer += data.toString();
  let split;
  while ((split = buffer.indexOf('\0')) >= 0) {
    const raw = buffer.slice(0, split); buffer = buffer.slice(split + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    if (message.id) {
      const request = pending.get(message.id);
      if (request) {
        clearTimeout(request.timeout); pending.delete(message.id);
        message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result);
      }
    } else for (const fn of listeners.get(message.method) || []) fn(message.params);
  }
}
function on(method, fn) {
  if (!listeners.has(method)) listeners.set(method, []);
  listeners.get(method).push(fn);
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
  return result.result.value;
}
async function until(expression, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error('Timed out waiting for: ' + expression);
}
async function click(id) { await evaluate('document.getElementById(' + JSON.stringify(id) + ').click()'); }
async function send(text) {
  await evaluate('document.getElementById("composer").value=' + JSON.stringify(text) + ';document.getElementById("composer").dispatchEvent(new Event("input"));document.getElementById("composer-form").requestSubmit()');
  await until('document.getElementById("stop-button").hidden && document.querySelector(".message.assistant") !== null');
}
async function screenshot(name) {
  const shot = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(artifacts, name + '.png'), Buffer.from(shot.data, 'base64'));
}

try {
  await mkdir(scratch, { recursive: true });
  await mkdir(artifacts, { recursive: true });
  profile = await mkdtemp(path.join(scratch, 'run-'));
  await mkdir(path.join(profile, 'tmp'));
  // Predictable unavailable-model behavior; this suite never uses a hosted API.
  server = createAppServer({ modelFetch: async () => { throw new Error('Local model intentionally absent in UI fixture'); } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  chrome = spawn(process.env.CHROME_BIN || '/usr/bin/google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-extensions',
    '--disable-features=MediaRouter,OptimizationHints', '--disable-crashpad-for-testing',
    '--remote-debugging-pipe', '--user-data-dir=' + path.join(profile, 'profile'),
    '--disk-cache-dir=' + path.join(profile, 'cache'), 'about:blank'
  ], {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    env: { ...process.env, TMPDIR: path.join(profile, 'tmp'), XDG_CONFIG_HOME: path.join(profile, 'config'), XDG_CACHE_HOME: path.join(profile, 'cache') }
  });
  chrome.on('error', error => {
    for (const p of pending.values()) { clearTimeout(p.timeout); p.reject(error); }
    pending.clear();
  });
  chrome.stderr.on('data', data => { stderr += data; });
  chrome.stdio[3].on('error', () => {});
  chrome.stdio[4].on('error', () => {});
  chrome.stdio[4].on('data', receive);
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId: session } = await command('Target.attachToTarget', { targetId, flatten: true }, null));
  const requests = [], exceptions = [];
  on('Network.requestWillBeSent', data => requests.push(data.request));
  on('Runtime.exceptionThrown', data => exceptions.push(data.exceptionDetails));
  await command('Network.enable'); await command('Page.enable'); await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: origin + '/' });
  await until('document.querySelector(".history-empty") !== null');
  await screenshot('desktop-welcome');

  await evaluate('document.querySelectorAll("[data-prompt]")[2].click()');
  await click('send-button');
  await until('document.querySelector(".message.assistant .message-content")?.textContent.includes("= 51")');
  assert.equal(await evaluate('document.querySelectorAll(".message").length'), 2);
  await command('Page.reload');
  await until('document.querySelector(".message.assistant .message-content")?.textContent.includes("= 51")');
  console.log('PASS: worker calculation and full turn persist across reload');

  await send('My name is Alex.');
  await command('Page.reload');
  await until('document.querySelectorAll(".message").length === 4');
  await send('What is my name?');
  assert.match(await evaluate('document.querySelectorAll(".message.assistant .message-content")[2].textContent'), /name is Alex/);
  await screenshot('desktop-conversation');
  console.log('PASS: follow-up reads persisted local context');

  await click('engine-button'); await click('connect-ollama');
  await until('document.getElementById("connection-status").textContent.includes("not reachable")');
  assert.equal(await evaluate('document.getElementById("engine-label").textContent'), 'Offline tools');
  await evaluate('document.getElementById("engine-dialog").close()');
  console.log('PASS: unavailable model is visible and does not change engines');

  assert.ok(requests.every(r => r.url.startsWith(origin + '/') || r.url.startsWith('data:')));
  assert.ok(!requests.some(r => r.method === 'POST'));
  assert.ok(!requests.some(r => /Alex|proposal|180/.test(r.url)));
  console.log('PASS: no external requests or transcript POSTs in default mode');

  await evaluate('navigator.serviceWorker.ready');
  await until('Boolean(navigator.serviceWorker.controller)');
  const savedPort = server.address().port;
  await new Promise(resolve => server.close(resolve));
  await command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await command('Page.reload');
  await until('document.querySelectorAll(".message").length === 6');
  await send('21 * 2');
  assert.match(await evaluate('document.querySelectorAll(".message.assistant .message-content")[3].textContent'), /= 42/);
  console.log('PASS: cached shell reloads and replies with network disabled');
  await command('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(savedPort, '127.0.0.1', resolve); });

  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await click('menu-button');
  assert.equal(await evaluate('document.getElementById("menu-button").getAttribute("aria-expanded")'), 'true');
  await click('new-chat');
  assert.equal(await evaluate('document.getElementById("welcome").hidden'), false);
  await screenshot('mobile-welcome');
  await send('Summarize: The prototype stores messages on this device. It has no cloud sync. The next test will happen on Friday.');
  assert.match(await evaluate('document.querySelector(".message.assistant .message-content").textContent'), /extractive summary/);
  await screenshot('mobile-conversation');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  console.log('PASS: mobile layout, drawer, new chat, and real summary');

  await click('conversation-options'); await click('delete-chat'); await click('confirm-delete');
  assert.equal(await evaluate('document.querySelectorAll(".history-item").length'), 1);
  await click('device-button'); await click('clear-all'); await click('confirm-delete');
  await command('Page.reload');
  await until('document.querySelector(".history-empty") !== null');
  assert.equal(await evaluate('document.querySelectorAll(".history-item").length'), 0);
  assert.deepEqual(exceptions, []);
  console.log('PASS: deletion survives reload; no uncaught browser errors');
  console.log('Browser checks passed. Screenshots: test-artifacts/');
} catch (error) {
  if (error.code === 'EPERM' || error.code === 'EACCES') {
    console.error('Browser verification BLOCKED: this environment forbids localhost sockets or browser startup (' + error.code + '). Run npm run test:browser on a machine that allows them.');
  } else console.error(error.stack);
  process.exitCode = 1;
} finally {
  if (chrome) {
    chrome.kill('SIGTERM');
    await new Promise(resolve => { if (chrome.exitCode !== null) resolve(); else { chrome.once('exit', resolve); setTimeout(resolve, 2000).unref(); } });
  }
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (profile) await rm(profile, { recursive: true, force: true });
  for (const p of pending.values()) clearTimeout(p.timeout);
}
