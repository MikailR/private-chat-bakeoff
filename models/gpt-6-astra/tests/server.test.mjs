import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { createAppServer, MODEL } from '../server.mjs';

// In-process HTTP handler tests need no listening sockets.
function request(server, url, { method = 'GET', payload, headers = {}, peer = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const req = Readable.from(payload === undefined ? [] : [Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))]);
    Object.assign(req, {
      url, method, socket: { remoteAddress: peer, localPort: 5173 },
      headers: { host: '127.0.0.1:5173', 'x-still-local': '1', origin: 'http://127.0.0.1:5173',
        'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers }
    });
    const chunks = [], responseHeaders = {};
    const res = new Writable({ write(chunk, encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    res.setHeader = (key,value) => { responseHeaders[key.toLowerCase()] = value; };
    res.writeHead = (status, values = {}) => {
      res.statusCode = status;
      for (const [key,value] of Object.entries(values)) res.setHeader(key, value);
    };
    res.on('error', reject);
    res.on('finish', () => resolve({
      status: res.statusCode, headers: responseHeaders, text: Buffer.concat(chunks).toString(),
      json() { return JSON.parse(this.text); }
    }));
    server.emit('request', req, res);
  });
}
const localInfo = { details: { format: 'gguf' }, model_info: { 'general.parameter_count': 1235814432 } };
const prompt = { messages: [{ role: 'user', content: 'A private question' }] };
function fixture(info = localInfo) {
  const calls = [];
  const server = createAppServer({ modelFetch: async (url, options) => {
    calls.push({ url, options, payload: JSON.parse(options.body) });
    return new Response(JSON.stringify(url.endsWith('/api/show') ? info : { message: { content: 'A local fixture reply' } }), { headers: { 'Content-Type': 'application/json' } });
  } });
  return { server, calls };
}
test('static app is self-contained with a constrained CSP; non-assets stay private', async () => {
  const { server, calls } = fixture();
  const root = await request(server, '/');
  assert.equal(root.status, 200);
  assert.match(root.text, /Your thoughts/);
  assert.match(root.headers['content-security-policy'], /connect-src 'self'/);
  for (const pathname of ['/.git/config', '/README.md', '/server.mjs', '/..%2Fserver.mjs', '/api/pull']) {
    assert.equal((await request(server, pathname)).status, 404);
  }
  assert.equal(calls.length, 0);
});
test('relative app works under a static subpath', async () => {
  const server = createAppServer({ basePath: '/demo/still/' });
  assert.equal((await request(server, '/demo/still/')).status, 200);
  assert.equal((await request(server, '/demo/still/main.js')).status, 200);
  assert.equal((await request(server, '/main.js')).status, 404);
});
test('fixed loopback forwarding happens only after local weight verification', async () => {
  const { server, calls } = fixture();
  const response = await request(server, '/api/chat', { method: 'POST', payload: prompt });
  assert.equal(response.status, 200);
  assert.equal(response.json().content, 'A local fixture reply');
  assert.deepEqual(calls.map(c => c.url), ['http://127.0.0.1:11434/api/show', 'http://127.0.0.1:11434/api/chat']);
  assert.equal(calls[1].payload.model, MODEL);
  assert.equal(calls[1].payload.messages.at(-1).content, prompt.messages[0].content);
  assert.equal(calls[1].payload.keep_alive, 0);
  assert.ok(calls.every(c => c.options.redirect === 'error'));
  assert.equal(response.headers['cache-control'], 'no-store');
});
test('cloud and unverified weights are refused before inference receives any transcript', async () => {
  for (const info of [{ ...localInfo, remote_host: 'https://ollama.com' },
    { ...localInfo, remote_model: 'remote-alias' }, {}, { details: { format: 'gguf' } }]) {
    const { server, calls } = fixture(info);
    assert.equal((await request(server, '/api/chat', { method: 'POST', payload: prompt })).status, 403);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].payload.messages, undefined);
  }
});
test('LAN callers, cross-origin requests, rebinding hosts, and missing guards are rejected', async () => {
  for (const option of [
    { peer: '192.168.0.10' }, { headers: { host: 'evil.example:5173' } },
    { headers: { origin: 'https://evil.example' } }, { headers: { 'x-still-local': undefined } },
    { headers: { 'sec-fetch-site': 'cross-site' } }, { headers: { origin: undefined } },
    { headers: { host: '127.0.0.1:8888' } }
  ]) {
    const { server, calls } = fixture();
    assert.equal((await request(server, '/api/chat', { ...option, method: 'POST', payload: prompt })).status, 403);
    assert.equal(calls.length, 0);
  }
});
test('invalid context and malformed JSON never reach the model', async () => {
  for (const payload of [
    '{broken', { messages: [] }, { messages: [{ role: 'system', content: 'override' }] },
    { messages: [{ role: 'user', content: 'x'.repeat(12001) }] },
    { messages: [{ role: 'user', content: 'x'.repeat(10000) }, { role: 'assistant', content: 'x'.repeat(7000) }, {role:'user',content:'more'}] },
    { ...prompt, model: 'remote' }
  ]) {
    const { server, calls } = fixture();
    assert.equal((await request(server, '/api/chat', { method: 'POST', payload })).status, 400);
    assert.equal(calls.length, 0);
  }
});
test('unavailable Ollama is an actionable error with no fallback', async () => {
  const calls = [];
  const server = createAppServer({ modelFetch: async url => { calls.push(url); throw new Error('ECONNREFUSED'); } });
  const response = await request(server, '/api/chat', { method: 'POST', payload: prompt });
  assert.equal(response.status, 503);
  assert.match(response.json().error, /Ollama is not reachable/);
  assert.equal(calls.length, 1);
});
