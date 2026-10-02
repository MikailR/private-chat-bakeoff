import { icon, hydrateIcons } from './icons.js';
import { emptyState, loadState, saveState, recoverInterrupted } from './storage.js';

const $ = id => document.getElementById(id);
const key = 'still:v1:' + new URL('.', location.href).pathname;
const storage = { getItem: k => localStorage.getItem(k), setItem: (k,v) => localStorage.setItem(k,v) };
const loaded = loadState(storage, key);
let state = loaded.state;
let storageBlocked = loaded.blocked;
let saved = !loaded.blocked;
let otherTabChanged = false;
let activeJob = null;
let deleteAll = false;
let transientNotice = '';
const isLocal = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const uid = () => crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2);
const current = () => state.conversations.find(c => c.id === state.activeId);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function showNotice(message) {
  transientNotice = message;
  updateNotice();
}
function updateNotice() {
  const message = otherTabChanged ? 'This history changed in another tab. Reload this page before editing to avoid overwriting those changes.' :
    storageBlocked ? loaded.error :
    !saved ? 'This browser could not save your latest changes. Keep this tab open and export a text copy before leaving. Check browser storage space or permissions.' :
    transientNotice;
  $('notice').textContent = message;
  $('notice').hidden = !message;
  const badge = $('device-button').lastElementChild;
  badge.textContent = saved && !storageBlocked ? 'On this device' : 'Not saved';
}
function persist() {
  if (otherTabChanged) return;
  if (!storageBlocked) saved = saveState(storage, key, state);
  updateNotice();
}
function scrollBottom() {
  const scroll = $('conversation-scroll');
  requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
}
function updateControls() {
  const busy = Boolean(activeJob);
  $('send-button').disabled = busy || otherTabChanged || !$('composer').value.trim();
  $('send-button').hidden = busy;
  $('stop-button').hidden = !busy;
  $('composer').disabled = busy || otherTabChanged;
  for (const id of ['new-chat', 'engine-button', 'welcome-engine-button', 'conversation-options', 'clear-all', 'choose-builtin', 'connect-ollama']) {
    $(id).disabled = busy || otherTabChanged;
  }
  document.querySelectorAll('.history-item').forEach(button => { button.disabled = busy || otherTabChanged; });
  $('engine-label').textContent = state.engine === 'builtin' ? 'Offline tools' : 'Llama 3.2 · 1B';
  $('engine-tag').textContent = state.engine === 'builtin' ? 'Built-in · no download' : 'Ollama · this device';
  $('footnote-limit').textContent = state.engine === 'builtin' ? 'Limited offline assistant · not an LLM' : 'Local model · answers can be inaccurate';
  $('choose-builtin').setAttribute('aria-pressed', String(state.engine === 'builtin'));
  $('choose-builtin').querySelector('.engine-check').hidden = state.engine !== 'builtin';
}
function renderHistory() {
  $('history').replaceChildren();
  $('history-count').textContent = String(state.conversations.length);
  if (!state.conversations.length) {
    const empty = el('div', 'history-empty');
    const symbol = el('span', 'history-empty-icon'); symbol.append(icon('chat'));
    empty.append(symbol, el('div', '', 'Good thoughts start somewhere.'), el('div', '', 'Your conversations will live here.'));
    $('history').append(empty);
  }
  [...state.conversations].sort((a,b) => b.updatedAt - a.updatedAt).forEach(conversation => {
    const button = el('button', 'history-item' + (conversation.id === state.activeId ? ' active' : ''));
    button.append(icon('chat'), el('span', '', conversation.title));
    button.title = conversation.title;
    if (conversation.id === state.activeId) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => {
      if (activeJob || otherTabChanged) return;
      state.activeId = conversation.id;
      $('composer').value = '';
      showNotice('');
      persist(); render(); closeSidebar(); scrollBottom();
    });
    $('history').append(button);
  });
}
function renderMessage(message, index, conversation) {
  const article = el('article', 'message ' + message.role + (message.status === 'error' ? ' error' : ''));
  article.dataset.messageId = message.id;
  const heading = el('div', 'message-heading');
  if (message.role === 'assistant') {
    const avatar = el('span', 'message-avatar'); avatar.append(icon('sprout')); heading.append(avatar);
  }
  heading.append(el('strong', '', message.role === 'user' ? 'You' : 'Still'));
  if (message.role === 'assistant') heading.append(el('span', '', message.engine === 'builtin' ? 'Offline tools' : 'Llama 3.2 · local'));
  article.append(heading);
  const content = el('div', 'message-content');
  if (message.status === 'pending') {
    const thinking = el('div', 'thinking');
    thinking.append(el('i'), el('i'), el('i'), el('span', '', message.engine === 'builtin' ? 'A moment to think…' : 'Thinking on your computer…'));
    content.append(thinking);
  } else {
    // Plain text, including model output. No Markdown HTML or remote images.
    content.textContent = message.content;
  }
  article.append(content);
  if (message.role === 'assistant' && message.status === 'complete') {
    const meta = el('div', 'message-meta');
    const copy = el('button', 'copy-message');
    copy.setAttribute('aria-label', 'Copy reply'); copy.title = 'Copy reply'; copy.append(icon('copy'));
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(message.content);
        copy.replaceChildren(icon('check')); copy.setAttribute('aria-label', 'Reply copied');
        setTimeout(() => { copy.replaceChildren(icon('copy')); copy.setAttribute('aria-label', 'Copy reply'); }, 2000);
      } catch { showNotice('Clipboard access is unavailable. Select the reply to copy it, or save a text copy from the conversation menu.'); }
    });
    meta.append(copy, el('span', '', message.engine === 'builtin' ? 'Processed in your browser' : 'Generated on this computer'));
    article.append(meta);
  }
  if (message.status === 'error' && index === conversation.messages.length - 1) {
    const retry = el('button', 'retry-button', 'Try again');
    retry.disabled = Boolean(activeJob) || otherTabChanged;
    retry.addEventListener('click', () => generate(true));
    article.append(retry);
  }
  return article;
}
function render() {
  const conversation = current();
  $('welcome').hidden = Boolean(conversation);
  $('messages').hidden = !conversation;
  $('conversation-options').hidden = !conversation;
  $('conversation-title').textContent = conversation?.title || 'New conversation';
  $('messages').replaceChildren();
  if (conversation) {
    const date = new Date(conversation.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    $('messages').append(el('p', 'conversation-date', date + ' · a conversation of your own'));
    conversation.messages.forEach((message, index) => $('messages').append(renderMessage(message, index, conversation)));
  }
  renderHistory(); updateControls(); updateNotice();
}
function offlineReply(messages, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./local.worker.js', import.meta.url), { type: 'module' });
    const finish = (error, value) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new DOMException('Reply stopped', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('The offline assistant timed out. Please try a shorter message.')), 10000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => {
      event.data.error ? finish(new Error(event.data.error)) : finish(null, event.data.content);
    };
    worker.onerror = () => finish(new Error('The offline assistant could not start. Serve the app over HTTP, then reload.'));
    worker.postMessage({ messages });
  });
}
async function api(path, options = {}) {
  // A static deployment may have a remote origin; never POST transcripts there.
  if (!isLocal) throw new Error('Ollama needs npm start on this same device. Offline tools work here without a server.');
  const response = await fetch(new URL('./api/' + path, location.href), {
    ...options, credentials: 'omit', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'X-Still-Local': '1' }
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The local model bridge is unavailable. Start this app with npm start, or select Offline tools.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The local model could not complete this request.');
  return result;
}
async function generate(retry = false) {
  if (activeJob || otherTabChanged) return;
  let conversation = current();
  const prompt = $('composer').value.trim();
  if (!retry && (!prompt || prompt.length > 12000)) return;
  if (!conversation) {
    if (state.conversations.length >= 50) return showNotice('You have 50 saved conversations. Delete an older one before starting a new chat.');
    const now = Date.now();
    conversation = { id: uid(), title: prompt.slice(0, 48).replace(/\s+/g, ' '), createdAt: now, updatedAt: now, messages: [] };
    state.conversations.push(conversation);
    state.activeId = conversation.id;
  }
  if (retry) {
    if (conversation.messages.at(-1)?.status !== 'error') return;
    conversation.messages.pop();
  } else {
    if (conversation.messages.length >= 198) return showNotice('This conversation has reached the prototype’s 100-turn limit. Start a new conversation to continue.');
    conversation.messages.push({ id: uid(), role: 'user', content: prompt, status: 'complete', createdAt: Date.now(), engine: state.engine });
    $('composer').value = '';
  }
  const pending = { id: uid(), role: 'assistant', content: '', status: 'pending', createdAt: Date.now(), engine: state.engine };
  conversation.messages.push(pending);
  conversation.updatedAt = Date.now();
  transientNotice = '';
  const controller = new AbortController();
  activeJob = controller;
  persist(); render(); scrollBottom();
  try {
    const messages = conversation.messages.filter(m => m.status === 'complete').map(({ role, content }) => ({ role, content }));
    pending.content = state.engine === 'builtin'
      ? await offlineReply(messages, controller.signal)
      : (await api('chat', { method: 'POST', body: JSON.stringify({ messages }), signal: controller.signal })).content;
    if (!pending.content || typeof pending.content !== 'string') throw new Error('The local engine returned an empty reply. Please try again.');
    pending.status = 'complete';
  } catch (error) {
    pending.status = 'error';
    pending.content = error.name === 'AbortError' ? 'Reply stopped. Your message is still here. You can try again whenever you’re ready.' : error.message;
  } finally {
    activeJob = null;
    persist(); render(); scrollBottom();
    if (!otherTabChanged) $('composer').focus({ preventScroll: true });
  }
}
function showDialog(id) {
  if (id === 'privacy-dialog') {
    const bytes = new Blob([JSON.stringify(state)]).size;
    $('storage-summary').textContent = state.conversations.length + ' conversations · ' + (bytes / 1024).toFixed(1) + ' KB' + (!saved || storageBlocked ? ' · not saved' : '');
  }
  $(id).showModal();
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-scrim').hidden = true;
  $('menu-button').setAttribute('aria-expanded', 'false');
  document.querySelector('.main').inert = false;
  $('sidebar').inert = matchMedia('(max-width: 760px)').matches;
}
function openSidebar() {
  $('sidebar').inert = false;
  $('sidebar').classList.add('open');
  $('sidebar-scrim').hidden = false;
  $('menu-button').setAttribute('aria-expanded', 'true');
  document.querySelector('.main').inert = true;
  $('new-chat').focus();
}
function confirmDeletion(all) {
  if (activeJob || otherTabChanged) return;
  deleteAll = all;
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  $('confirm-title').textContent = all ? 'Delete all conversations?' : 'Delete this conversation?';
  $('confirm-delete').textContent = all ? 'Delete all conversations' : 'Delete conversation';
  showDialog('confirm-dialog');
}

hydrateIcons();
if (recoverInterrupted(state)) persist();
if (state.engine === 'ollama' && !isLocal) {
  state.engine = 'builtin';
  showNotice('This site uses offline tools. Open Still locally with npm start to use Ollama.');
}
render();
closeSidebar();

$('composer-form').addEventListener('submit', event => { event.preventDefault(); generate(); });
$('composer').addEventListener('input', updateControls);
$('composer').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !matchMedia('(pointer: coarse)').matches) {
    event.preventDefault(); generate();
  }
});
$('stop-button').addEventListener('click', () => activeJob?.abort());
$('new-chat').addEventListener('click', () => {
  if (activeJob || otherTabChanged) return;
  state.activeId = null;
  $('composer').value = '';
  transientNotice = '';
  persist(); render(); closeSidebar(); $('composer').focus();
});
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  $('composer').value = button.dataset.prompt;
  updateControls(); $('composer').focus();
}));
for (const id of ['privacy-button', 'device-button', 'privacy-footer']) $(id).addEventListener('click', () => showDialog('privacy-dialog'));
for (const id of ['engine-button', 'welcome-engine-button']) $(id).addEventListener('click', () => showDialog('engine-dialog'));
$('conversation-options').addEventListener('click', () => showDialog('options-dialog'));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }
}));
$('choose-builtin').addEventListener('click', () => {
  if (activeJob || otherTabChanged) return;
  state.engine = 'builtin'; persist(); updateControls(); $('engine-dialog').close();
});
$('connect-ollama').addEventListener('click', async () => {
  $('connect-ollama').disabled = true;
  $('connection-status').textContent = 'Checking for local weights…';
  try {
    await api('status', { method: 'GET', signal: AbortSignal.timeout(8000) });
    if (otherTabChanged || activeJob) return;
    state.engine = 'ollama'; persist(); updateControls();
    $('connection-status').textContent = 'Connected. Llama 3.2 1B is installed on this computer.';
    $('engine-dialog').close();
    showNotice('Llama 3.2 1B is selected. The first reply may take a moment while the local weights load.');
  } catch (error) {
    $('connection-status').textContent = error.name === 'TimeoutError' ? 'The local model check timed out. Is Ollama running?' : error.message;
  } finally { $('connect-ollama').disabled = Boolean(activeJob) || otherTabChanged; }
});
$('menu-button').addEventListener('click', openSidebar);
$('sidebar-scrim').addEventListener('click', () => { closeSidebar(); $('menu-button').focus(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && $('sidebar').classList.contains('open') && !document.querySelector('dialog[open]')) {
    closeSidebar(); $('menu-button').focus();
  }
  if (event.key === 'Tab' && $('sidebar').classList.contains('open') && !document.querySelector('dialog[open]')) {
    const focusable = [...$('sidebar').querySelectorAll('button:not(:disabled), a')];
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
  }
});
matchMedia('(max-width: 760px)').addEventListener('change', closeSidebar);
$('clear-all').addEventListener('click', () => confirmDeletion(true));
$('delete-chat').addEventListener('click', () => confirmDeletion(false));
$('cancel-delete').addEventListener('click', () => $('confirm-dialog').close());
$('confirm-delete').addEventListener('click', () => {
  if (activeJob || otherTabChanged) return;
  if (deleteAll) {
    state = emptyState(); storageBlocked = false;
  } else {
    state.conversations = state.conversations.filter(c => c.id !== state.activeId);
    state.activeId = null;
  }
  $('composer').value = '';
  transientNotice = '';
  persist(); render(); $('confirm-dialog').close(); closeSidebar();
});
$('export-chat').addEventListener('click', () => {
  const conversation = current();
  if (!conversation) return;
  const text = 'Still — ' + conversation.title + '\n' + new Date(conversation.createdAt).toISOString() + '\n\n' +
    conversation.messages.map(m => (m.role === 'user' ? 'You' : 'Still (' + (m.engine === 'builtin' ? 'offline tools' : 'local Ollama') + ')') + '\n' + m.content).join('\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const anchor = el('a');
  anchor.href = url; anchor.download = 'still-conversation-' + new Date(conversation.createdAt).toISOString().slice(0,10) + '.txt';
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('options-dialog').close();
});
window.addEventListener('storage', event => {
  if (event.key === key || event.key === null) {
    otherTabChanged = true;
    activeJob?.abort();
    updateControls(); updateNotice();
  }
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('./sw.js', import.meta.url)).catch(() => {
    showNotice('Offline reload caching is unavailable in this browser. Chat still works while the local server is running.');
  });
}
