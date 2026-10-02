import { reply } from './engine.js';
self.onmessage = event => {
  try { self.postMessage({ content: reply(event.data.messages) }); }
  catch { self.postMessage({ error: 'The offline assistant could not finish this reply. Try a shorter message.' }); }
};
