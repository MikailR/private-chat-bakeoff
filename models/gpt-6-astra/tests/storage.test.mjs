import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, loadState, saveState, recoverInterrupted } from '../app/storage.js';
import { reply } from '../app/engine.js';
const fixture = () => {
  const state = emptyState();
  state.activeId = 'chat';
  state.conversations.push({ id: 'chat', title: 'Test', createdAt: 1, updatedAt: 2, messages: [
    { id: 'u', role: 'user', content: '2+2', status: 'complete', engine: 'builtin', createdAt: 1 },
    { id: 'a', role: 'assistant', content: '2+2 = 4', status: 'complete', engine: 'builtin', createdAt: 2 }
  ] });
  return state;
};
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value) };
}
test('full conversation snapshot survives storage reload', () => {
  const storage = memoryStorage(), state = fixture();
  assert.equal(saveState(storage, 'still', state), true);
  const loaded = loadState(storage, 'still');
  assert.equal(loaded.blocked, false);
  assert.deepEqual(loaded.state, state);
});
test('unreadable and future-version history is preserved, never silently reset on disk', () => {
  for (const raw of ['{broken', JSON.stringify({ version: 8 }), JSON.stringify({ ...fixture(), conversations: [null] })]) {
    const storage = memoryStorage();
    storage.setItem('still', raw);
    const loaded = loadState(storage, 'still');
    assert.equal(loaded.blocked, true);
    assert.match(loaded.error, /not been overwritten/);
    assert.equal(storage.getItem('still'), raw);
  }
});
test('quota or denied storage is surfaced as a failed save', () => {
  const denied = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('QuotaExceeded'); } };
  assert.equal(loadState(denied, 'still').blocked, true);
  assert.equal(saveState(denied, 'still', fixture()), false);
});
test('interrupted generation retains the user turn and offers a recoverable state', () => {
  const state = fixture();
  state.conversations[0].messages[1].status = 'pending';
  assert.equal(recoverInterrupted(state), true);
  assert.equal(state.conversations[0].messages[0].content, '2+2');
  assert.equal(state.conversations[0].messages[1].status, 'error');
  assert.match(state.conversations[0].messages[1].content, /interrupted/);
  assert.equal(recoverInterrupted(state), false);
});

test('real offline reply persists and a follow-up uses rehydrated conversation context', () => {
  const storage = memoryStorage(), state = fixture();
  const messages = state.conversations[0].messages;
  messages[0].content = 'My name is Alex.';
  messages[1].content = reply([messages[0]]);
  assert.match(messages[1].content, /Nice to meet you, Alex/);
  assert.equal(saveState(storage, 'still', state), true);
  const restored = loadState(storage, 'still').state;
  assert.match(reply([...restored.conversations[0].messages, { role: 'user', content: 'What is my name?' }]), /name is Alex/);
});
