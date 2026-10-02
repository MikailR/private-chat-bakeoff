# Still — a space of your own

A responsive, local-first chat **prototype** for desktop and mobile. Send a message, get an offline reply, and reload: the conversation stays in this browser.

**Run with Node 20.19+; no dependencies or install step:**

~~~sh
npm start
~~~

Open **http://127.0.0.1:5173**. Choose **Work it out**, then send the message. The reply is **51**. Reload to verify both messages are saved.

The default **Offline tools** engine runs entirely in a browser worker. It handles calculations, extractive summaries, simple task plans, and limited conversation context. **It is a rule-based fallback, not an LLM.** For a full language model, the app also includes a loopback-only Ollama bridge. Setup and limitations are in [NOTES.md](./NOTES.md).

~~~sh
npm run build         # writes a portable, relative-path static app to dist/
npm test              # offline engine, storage, and local bridge checks
npm run test:browser  # Chrome: real chat, reload, offline, mobile, privacy
~~~

No hosted chat APIs, telemetry, accounts, or sync. History is local **plain text**, not encrypted. View or delete it through **Privacy & storage**.

[Architecture and privacy boundary](./ARCHITECTURE.md) · [Setup, fallback, and scope](./NOTES.md)
