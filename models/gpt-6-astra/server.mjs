import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const MODEL = 'llama3.2:1b';
const MODEL_ORIGIN = 'http://127.0.0.1:11434';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILES = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['styles.css', 'text/css; charset=utf-8'],
  ...['main.js', 'icons.js', 'storage.js', 'engine.js', 'local.worker.js', 'sw.js'].map(p => [p, 'text/javascript; charset=utf-8']),
  ['icon.svg', 'image/svg+xml']
]);
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};
class RequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function validateMessages(data) {
  if (!data || Object.keys(data).some(k => k !== 'messages') || !Array.isArray(data.messages) ||
      !data.messages.length || data.messages.length > 199) throw new RequestError('Send a nonempty conversation.');
  if (data.messages.some(m => !m || !['user', 'assistant'].includes(m.role) ||
      typeof m.content !== 'string' || !m.content.trim() || m.content.length > 12000)) {
    throw new RequestError('Messages must contain text and a user or assistant role (up to 12,000 characters each).');
  }
  if (data.messages.at(-1).role !== 'user') throw new RequestError('The conversation must end with your message.');
  if (data.messages.reduce((n,m) => n + m.content.length, 0) > 16000) {
    throw new RequestError('This conversation is too long for the prototype’s local model context. Start a new conversation, or switch to Offline tools.');
  }
  return data.messages.map(({ role, content }) => ({ role, content }));
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new RequestError('Use application/json.', 415);
  let size = 0;
  const parts = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 200000) throw new RequestError('Request too large.', 413);
    parts.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new RequestError('Invalid JSON.'); }
}
function verifyLocalRequest(req) {
  let host;
  try { host = new URL('http://' + req.headers.host); }
  catch { throw new RequestError('Invalid local host.', 403); }
  const expectedPort = String(req.socket.localPort);
  const port = host.port || '80';
  if (!loopback(req.socket.remoteAddress) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname) || port !== expectedPort ||
      req.headers['x-still-local'] !== '1' ||
      (req.headers.origin && req.headers.origin !== host.origin) ||
      (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') ||
      (req.method === 'POST' && req.headers.origin !== host.origin)) {
    throw new RequestError('The model bridge only accepts same-origin requests from this device.', 403);
  }
}

// modelFetch is injectable for protocol tests. Runtime destination is fixed;
// no environment variable or user input can supply a remote model URL.
export function createAppServer({ root = path.join(HERE, 'app'), basePath = '/', modelFetch = fetch } = {}) {
  if (!basePath.startsWith('/') || !basePath.endsWith('/')) throw new Error('basePath must start and end with /.');
  let generating = false;
  async function ollama(endpoint, payload, signal) {
    let response;
    try {
      response = await modelFetch(MODEL_ORIGIN + endpoint, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      if (signal.aborted) throw new RequestError('The local model timed out or the reply was stopped. Try again.', 504);
      throw new RequestError('Ollama is not reachable. Start it with OLLAMA_NO_CLOUD=1, install llama3.2:1b, then try again. Offline tools are also available.', 503);
    }
    if (!response.ok) throw new RequestError('The local model is unavailable. Run ollama pull llama3.2:1b and check the Ollama server.', 503);
    return response.json();
  }
  async function verifyWeights(signal) {
    const info = await ollama('/api/show', { model: MODEL }, signal);
    // Fail closed: a cloud alias or unknown format does not qualify as local.
    if (info.remote_host || info.remote_model || info.details?.format !== 'gguf' ||
        !Object.keys(info.model_info || {}).some(k => k.endsWith('.parameter_count'))) {
      throw new RequestError('This model could not be verified as local GGUF weights. Remote and cloud models are refused.', 403);
    }
  }
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const url = new URL(req.url, 'http://still.local');
      if (!url.pathname.startsWith(basePath)) { res.writeHead(404); return res.end('Not found'); }
      const route = url.pathname.slice(basePath.length);
      if (route.startsWith('api/')) {
        verifyLocalRequest(req);
        if (route === 'api/status' && req.method === 'GET') {
          await verifyWeights(AbortSignal.timeout(5000));
          return json(res, 200, { ready: true, model: MODEL, inference: 'loopback' });
        }
        if (route === 'api/chat' && req.method === 'POST') {
          if (generating) throw new RequestError('Another local reply is still running. Try again in a moment.', 429);
          const messages = validateMessages(await body(req));
          const controller = new AbortController();
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
          res.on('close', () => controller.abort());
          generating = true;
          try {
            // Verify immediately before every inference, not just on selection.
            await verifyWeights(signal);
            const result = await ollama('/api/chat', {
              model: MODEL,
              messages: [{ role: 'system', content: 'You are Still, a helpful local assistant. Be concise and honest about uncertainty. You have no tools or internet access.' }, ...messages],
              stream: false, keep_alive: 0,
              options: { temperature: 0.6, num_ctx: 8192, num_predict: 512 }
            }, signal);
            if (typeof result.message?.content !== 'string' || !result.message.content.trim() || result.message.content.length > 40000) {
              throw new RequestError('The local model returned an empty or invalid response.', 502);
            }
            return json(res, 200, { content: result.message.content, model: MODEL });
          } finally { generating = false; }
        }
        return json(res, 404, { error: 'Unknown local API route.' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end('Method not allowed'); }
      const filename = route === '' ? 'index.html' : route;
      // An allowlist prevents exposing source notes, profiles, and dotfiles.
      if (!FILES.has(filename)) { res.writeHead(404); return res.end('Not found'); }
      const content = await readFile(path.join(root, filename));
      res.writeHead(200, { 'Content-Type': FILES.get(filename), 'Cache-Control': 'no-cache',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'" });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (res.destroyed) return;
      // Never log requests, messages, inference output, or upstream errors.
      json(res, error.status || 500, { error: error instanceof RequestError ? error.message : 'The local server could not complete this request.' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = name => {
    const index = process.argv.indexOf(name);
    if (index < 0) return undefined;
    const value = process.argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(name + ' requires a value.');
    return value;
  };
  const port = Number(option('--port') || process.env.PORT || 5173);
  const host = option('--host') || process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
  const server = createAppServer({ root: path.join(HERE, process.argv.includes('--dist') ? 'dist' : 'app') });
  server.listen(port, host, () => console.log('Still is ready at http://' + host + ':' + port + '\nOffline tools need no downloads. Press Ctrl+C to stop.'));
  server.on('error', error => { console.error('Unable to start Still: ' + error.code); process.exitCode = 1; });
}
