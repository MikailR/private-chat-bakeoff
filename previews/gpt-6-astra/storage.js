export const VERSION = 1;
export function emptyState() {
  return { version: VERSION, engine: 'builtin', activeId: null, conversations: [] };
}
export function validState(state) {
  return state && state.version === VERSION &&
    ['builtin', 'ollama'].includes(state.engine) &&
    (state.activeId === null || typeof state.activeId === 'string') &&
    Array.isArray(state.conversations) && state.conversations.length <= 50 &&
    state.conversations.every(c => typeof c.id === 'string' && typeof c.title === 'string' &&
      Number.isFinite(c.createdAt) && Number.isFinite(c.updatedAt) &&
      Array.isArray(c.messages) && c.messages.length <= 200 &&
      c.messages.every(m => typeof m.id === 'string' && ['user', 'assistant'].includes(m.role) &&
        typeof m.content === 'string' && m.content.length <= 40000 &&
        ['complete', 'pending', 'error'].includes(m.status) &&
        Number.isFinite(m.createdAt) && ['builtin', 'ollama'].includes(m.engine)));
}
export function loadState(storage, key) {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { state: emptyState(), blocked: false, error: '' };
    const state = JSON.parse(raw);
    if (!validState(state)) throw new Error('Invalid stored history');
    return { state, blocked: false, error: '' };
  } catch {
    return {
      state: emptyState(), blocked: true,
      error: 'Saved history could not be opened. It has not been overwritten. Check browser storage permissions, or use Privacy & storage to delete it and start again.'
    };
  }
}
export function saveState(storage, key, state) {
  try {
    storage.setItem(key, JSON.stringify(state));
    return true;
  } catch { return false; }
}
export function recoverInterrupted(state) {
  let changed = false;
  for (const conversation of state.conversations) {
    for (const message of conversation.messages) {
      if (message.status === 'pending') {
        message.status = 'error';
        message.content = 'This reply was interrupted when the page closed. Your message was saved. You can try again.';
        changed = true;
      }
    }
  }
  return changed;
}
