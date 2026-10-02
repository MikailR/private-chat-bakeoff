import '@fontsource/fraunces/latin-400.css';
import '@fontsource/fraunces/latin-600.css';
import '@fontsource/outfit/latin-400.css';
import '@fontsource/outfit/latin-500.css';
import './styles.css';
import { deleteThread, listThreads, saveThread } from './db';
import { buildPrompt, cleanReply, titleFrom } from './prompt';
import type { ChatMessage, ModelPhase, ProgressDetail, Thread } from './types';

interface Draft {
  threadId: string;
  runId: string;
  text: string;
}

const app = document.querySelector<HTMLElement>('#app');
const rail = document.querySelector<HTMLElement>('#rail');
const backdrop = document.querySelector<HTMLButtonElement>('#rail-backdrop');
const threadList = document.querySelector<HTMLElement>('#thread-list');
const transcript = document.querySelector<HTMLElement>('#transcript');
const composer = document.querySelector<HTMLTextAreaElement>('#composer');
const send = document.querySelector<HTMLButtonElement>('#send');
const status = document.querySelector<HTMLElement>('#status');
const roomTitle = document.querySelector<HTMLElement>('#room-title');
const loadbar = document.querySelector<HTMLElement>('#loadbar');
const loadbarFill = document.querySelector<HTMLElement>('#loadbar-fill');
const modelError = document.querySelector<HTMLElement>('#model-error');
const modelErrorText = document.querySelector<HTMLElement>('#model-error-text');
const retry = document.querySelector<HTMLButtonElement>('#retry-model');
const privacy = document.querySelector<HTMLDialogElement>('#privacy');

if (
  !app || !rail || !backdrop || !threadList || !transcript || !composer || !send ||
  !status || !roomTitle || !loadbar || !loadbarFill || !modelError || !modelErrorText ||
  !retry || !privacy
) {
  throw new Error('Kiln is missing part of its page.');
}

const ui = {
  app, rail, backdrop, threadList, transcript, composer, send, status, roomTitle,
  loadbar, loadbarFill, modelError, modelErrorText, retry, privacy,
};

const state = {
  threads: [] as Thread[],
  activeId: null as string | null,
  model: 'loading' as ModelPhase,
  status: 'Loading the on-device model…',
  progress: null as number | null,
  error: null as string | null,
  notice: null as string | null,
  pendingDeleteId: null as string | null,
  draft: null as Draft | null,
};

const fileProgress = new Map<string, { loaded: number; total: number }>();
const mobileQuery = window.matchMedia('(max-width: 839px)');
let worker: Worker | null = null;
let workerEpoch = 0;
let sending = false;

function publicPath(relative: string): string {
  // Origin path, not a full URL. Transformers.js treats an http(s) localModelPath
  // as remote and then skips it, because remote models are disabled. A path still
  // includes the site subpath (for example /kiln/models) via BASE_URL.
  const root = new URL(import.meta.env.BASE_URL, window.location.href);
  const url = new URL(relative.endsWith('/') ? relative : `${relative}/`, root);
  return url.pathname.replace(/\/$/, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function currentThread(): Thread | null {
  return state.threads.find((thread) => thread.id === state.activeId) ?? null;
}

function blankThread(): Thread {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(timestamp);
}

function fitComposer() {
  ui.composer.style.height = 'auto';
  ui.composer.style.height = `${Math.min(ui.composer.scrollHeight, 136)}px`;
}

function syncRail() {
  const mobile = mobileQuery.matches;
  const open = document.body.classList.contains('rail-open');
  ui.rail.inert = mobile && !open;
  ui.backdrop.hidden = !(mobile && open);
  if (!mobile) document.body.classList.remove('rail-open');
}

function openRail() {
  document.body.classList.add('rail-open');
  syncRail();
  document.querySelector<HTMLButtonElement>('#new-chat')?.focus();
}

function closeRail() {
  document.body.classList.remove('rail-open');
  syncRail();
}

function renderThreads() {
  ui.threadList.replaceChildren();
  if (state.threads.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'thread-empty';
    empty.textContent = 'No chats yet.';
    ui.threadList.append(empty);
    return;
  }
  for (const thread of state.threads) {
    const row = document.createElement('div');
    row.className = 'thread';
    row.setAttribute('role', 'listitem');
    if (thread.id === state.activeId) row.classList.add('is-active');

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'thread-open';
    open.textContent = thread.title;
    if (thread.id === state.activeId) open.setAttribute('aria-current', 'true');
    open.addEventListener('click', () => selectThread(thread.id));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'thread-delete';
    const confirming = state.pendingDeleteId === thread.id;
    remove.textContent = confirming ? 'Delete' : '×';
    if (confirming) remove.dataset.confirming = 'true';
    remove.setAttribute(
      'aria-label',
      confirming ? `Confirm delete ${thread.title}` : `Delete ${thread.title}`,
    );
    remove.addEventListener('click', () => {
      void onDelete(thread.id);
    });

    row.append(open, remove);
    ui.threadList.append(row);
  }
}

function emptyState(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  const kicker = document.createElement('p');
  kicker.className = 'empty-kicker';
  kicker.textContent = 'Private room';
  const title = document.createElement('h2');
  title.textContent = 'This chat stays here.';
  const body = document.createElement('p');
  body.textContent = 'Kiln runs a small model in this tab and keeps the transcript in this browser. Nothing is sent to a chat service.';
  wrap.append(kicker, title, body);
  return wrap;
}

function messageNode(message: ChatMessage, pending = false): HTMLElement {
  const article = document.createElement('article');
  article.className = `msg ${message.role}`;
  article.dataset.role = message.role;
  article.dataset.messageId = message.id;
  if (pending) article.dataset.pending = 'true';

  if (message.role === 'assistant') {
    const kicker = document.createElement('p');
    kicker.className = 'msg-kicker';
    kicker.textContent = 'Kiln';
    article.append(kicker);
  }

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = message.content;
  const time = document.createElement('time');
  time.dateTime = new Date(message.createdAt).toISOString();
  time.textContent = formatTime(message.createdAt);
  article.append(body, time);
  return article;
}

function renderTranscript() {
  const pinned = ui.transcript.scrollHeight - ui.transcript.scrollTop - ui.transcript.clientHeight < 96;
  ui.transcript.replaceChildren();
  const thread = currentThread();
  const draft = state.draft && thread && state.draft.threadId === thread.id ? state.draft : null;
  const messages = thread?.messages ?? [];

  if (!thread || (messages.length === 0 && !draft)) {
    ui.transcript.append(emptyState());
  } else {
    for (const message of messages) ui.transcript.append(messageNode(message));
    if (draft) {
      ui.transcript.append(messageNode({
        id: 'draft',
        role: 'assistant',
        content: draft.text || '…',
        createdAt: Date.now(),
      }, true));
    }
  }

  if (state.notice) {
    const note = document.createElement('p');
    note.className = 'note';
    note.setAttribute('role', 'status');
    note.textContent = state.notice;
    ui.transcript.append(note);
  }

  if (pinned) ui.transcript.scrollTop = ui.transcript.scrollHeight;
}

function renderChrome() {
  ui.app.dataset.modelState = state.model;
  const thread = currentThread();
  ui.roomTitle.textContent = thread?.title ?? 'New chat';
  document.title = thread && thread.title !== 'New chat' ? `${thread.title} · Kiln` : 'Kiln';
  ui.status.textContent = state.status;
  ui.send.disabled = state.model !== 'ready' || ui.composer.value.trim() === '';
  ui.transcript.setAttribute('aria-busy', state.model === 'generating' ? 'true' : 'false');
  ui.loadbar.hidden = state.model !== 'loading';
  if (state.progress == null) {
    ui.loadbar.dataset.indeterminate = 'true';
    ui.loadbarFill.style.width = '';
  } else {
    delete ui.loadbar.dataset.indeterminate;
    ui.loadbarFill.style.width = `${state.progress}%`;
  }
  if (state.error) {
    ui.modelError.hidden = false;
    ui.modelErrorText.textContent = state.error;
  } else {
    ui.modelError.hidden = true;
    ui.modelErrorText.textContent = '';
  }
  ui.retry.hidden = state.model !== 'error';
  ui.composer.placeholder = state.model === 'loading'
    ? 'The model is loading on this device…'
    : state.model === 'error'
      ? 'The model did not start.'
      : 'Write a message. It stays on this device.';
}

function render() {
  renderThreads();
  renderTranscript();
  renderChrome();
}

function selectThread(id: string) {
  state.activeId = id;
  state.pendingDeleteId = null;
  state.notice = null;
  closeRail();
  render();
  ui.composer.focus();
}

async function onDelete(id: string) {
  if (state.pendingDeleteId !== id) {
    state.pendingDeleteId = id;
    renderThreads();
    return;
  }
  try {
    await deleteThread(id);
  } catch (error) {
    state.error = errorMessage(error);
    state.pendingDeleteId = null;
    render();
    return;
  }
  state.threads = state.threads.filter((thread) => thread.id !== id);
  if (state.draft?.threadId === id) state.draft = null;
  if (state.activeId === id) state.activeId = state.threads[0]?.id ?? null;
  state.pendingDeleteId = null;
  render();
}

async function newChat() {
  const current = currentThread();
  if (current && current.messages.length === 0) {
    closeRail();
    ui.composer.focus();
    return;
  }
  const thread = blankThread();
  const previousId = state.activeId;
  state.threads.unshift(thread);
  state.activeId = thread.id;
  state.notice = null;
  state.pendingDeleteId = null;
  closeRail();
  render();
  ui.composer.focus();
  try {
    await saveThread(thread);
  } catch (error) {
    state.threads = state.threads.filter((item) => item.id !== thread.id);
    state.activeId = previousId;
    state.error = errorMessage(error);
    render();
  }
}

function onProgress(detail: ProgressDetail) {
  if (detail.file && detail.loaded != null && detail.total) {
    fileProgress.set(detail.file, { loaded: detail.loaded, total: detail.total });
  }
  let loaded = 0;
  let total = 0;
  for (const file of fileProgress.values()) {
    loaded += file.loaded;
    total += file.total;
  }
  const percent = total > 0
    ? Math.min(100, Math.round((loaded / total) * 100))
    : detail.progress;
  state.progress = percent;
  state.status = percent == null
    ? 'Loading the on-device model…'
    : `Loading the on-device model · ${percent}%`;
  renderChrome();
}

function startWorker() {
  workerEpoch += 1;
  const epoch = workerEpoch;
  worker?.terminate();
  fileProgress.clear();
  state.model = 'loading';
  state.progress = null;
  state.error = null;
  state.status = 'Loading the on-device model…';
  if (state.draft) {
    state.notice = 'The reply was interrupted while the model reloaded.';
    state.draft = null;
    sending = false;
  }
  render();
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent) => {
    if (epoch !== workerEpoch) return;
    void onWorker(event.data as Record<string, unknown>);
  };
  worker.onerror = (event) => {
    if (epoch !== workerEpoch) return;
    state.model = 'error';
    state.status = 'The model did not start';
    state.error = event.message || 'The model worker stopped.';
    state.draft = null;
    sending = false;
    render();
  };
  worker.postMessage({
    type: 'init',
    modelBase: publicPath('models'),
    wasmBase: publicPath('ort'),
  });
}

async function onWorker(message: Record<string, unknown>) {
  if (message.type === 'progress' && state.model === 'loading') {
    onProgress(message.detail as ProgressDetail);
    return;
  }
  if (message.type === 'ready') {
    state.model = 'ready';
    state.status = 'On this device';
    state.progress = 100;
    state.error = null;
    render();
    return;
  }
  if (message.type === 'token' && state.draft && state.draft.runId === message.id) {
    state.draft.text = String(message.text ?? '');
    state.status = 'Writing a reply…';
    renderTranscript();
    renderChrome();
    return;
  }
  if (message.type === 'done') {
    await finishReply(String(message.id ?? ''), String(message.text ?? ''));
    return;
  }
  if (message.type === 'error') {
    const text = String(message.message ?? 'The local model stopped.');
    state.draft = null;
    sending = false;
    if (message.phase === 'init') {
      state.model = 'error';
      state.status = 'The model did not start';
      state.error = text;
    } else {
      state.model = 'ready';
      state.status = 'On this device';
      state.error = text;
      state.notice = 'The local model stopped before it finished. Your message is still saved here.';
    }
    render();
  }
}

async function finishReply(id: string, text: string) {
  const draft = state.draft;
  if (!draft || draft.runId !== id) {
    if (state.model === 'generating') {
      state.model = 'ready';
      state.status = 'On this device';
    }
    sending = false;
    render();
    return;
  }
  const thread = state.threads.find((item) => item.id === draft.threadId);
  const cleaned = cleanReply(text);
  if (thread) {
    thread.messages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: cleaned || 'The local model returned an empty reply. Try a shorter message.',
      createdAt: Date.now(),
    });
    thread.updatedAt = Date.now();
    state.threads.sort((a, b) => b.updatedAt - a.updatedAt);
    try {
      await saveThread(thread);
    } catch (error) {
      state.error = errorMessage(error);
    }
  }
  state.draft = null;
  state.model = 'ready';
  state.status = 'On this device';
  sending = false;
  render();
}

async function submit() {
  if (sending || state.model !== 'ready') return;
  const text = ui.composer.value.trim();
  if (!text) return;
  sending = true;
  state.model = 'generating';
  state.status = 'Writing a reply…';
  state.error = null;
  state.notice = null;
  state.pendingDeleteId = null;
  ui.composer.value = '';
  fitComposer();

  let thread = currentThread();
  const created = !thread;
  if (!thread) {
    thread = blankThread();
    state.threads.unshift(thread);
    state.activeId = thread.id;
  }
  const previousTitle = thread.title;
  thread.messages.push({
    id: crypto.randomUUID(),
    role: 'user',
    content: text,
    createdAt: Date.now(),
  });
  const userCount = thread.messages.filter((message) => message.role === 'user').length;
  if (userCount === 1) thread.title = titleFrom(text);
  thread.updatedAt = Date.now();
  state.threads.sort((a, b) => b.updatedAt - a.updatedAt);
  const runId = crypto.randomUUID();
  state.draft = { threadId: thread.id, runId, text: '' };
  render();

  try {
    await saveThread(thread);
  } catch (error) {
    thread.messages.pop();
    thread.title = previousTitle;
    if (created) {
      state.threads = state.threads.filter((item) => item.id !== thread?.id);
      state.activeId = state.threads[0]?.id ?? null;
    }
    state.draft = null;
    state.model = 'ready';
    state.status = 'On this device';
    state.error = errorMessage(error);
    sending = false;
    ui.composer.value = text;
    render();
    return;
  }

  worker?.postMessage({
    type: 'generate',
    id: runId,
    prompt: buildPrompt(thread.messages),
  });
}

document.querySelector('#new-chat')?.addEventListener('click', () => {
  void newChat();
});
document.querySelector('#open-threads')?.addEventListener('click', openRail);
ui.backdrop.addEventListener('click', () => {
  closeRail();
  document.querySelector<HTMLButtonElement>('#open-threads')?.focus();
});
document.querySelector('#open-privacy')?.addEventListener('click', () => {
  ui.privacy.showModal();
});
document.querySelector('#close-privacy')?.addEventListener('click', () => {
  ui.privacy.close();
});
ui.privacy.addEventListener('click', (event) => {
  if (event.target === ui.privacy) ui.privacy.close();
});
ui.retry.addEventListener('click', startWorker);
ui.send.addEventListener('click', () => {
  void submit();
});
ui.composer.addEventListener('input', () => {
  fitComposer();
  renderChrome();
});
ui.composer.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void submit();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.body.classList.contains('rail-open')) {
    closeRail();
    document.querySelector<HTMLButtonElement>('#open-threads')?.focus();
  }
});
mobileQuery.addEventListener('change', syncRail);

async function boot() {
  try {
    state.threads = await listThreads();
    state.activeId = state.threads[0]?.id ?? null;
  } catch (error) {
    state.error = errorMessage(error);
  }
  syncRail();
  render();
  startWorker();
}

void boot();
