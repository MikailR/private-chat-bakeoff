# Running and reviewing Still

## No-download path

Requirements: Node 20.19+ and a modern browser.

~~~sh
npm start
~~~

Visit **http://127.0.0.1:5173**. No npm install, credentials, network, or model setup is needed. Change the port with `PORT=5180 npm start`; note that a different origin/port has different browser storage.

Try a complete persisted turn:

1. Click **Work it out**. Review the inserted prompt and send it.
2. The offline worker calculates `180 * 0.15 + 24 = 51`.
3. Reload the page; both messages and the sidebar conversation remain.
4. Send `My name is Alex.`, reload, and then `What is my name?` to check local conversation context.
5. Try **Find the essentials** in a new conversation for a summary computed from the actual supplied text.

Desktop: Enter sends, Shift+Enter adds a line. On a touch device, Enter adds a line; use the send button. The stop button cancels an in-flight reply. Failed or interrupted replies have a retry button.

The default **Offline tools** engine is a deliberately limited rule-based and text-retrieval fallback, not an LLM, mock network response, hidden cloud call, or pretrained tiny model. Summaries select sentences rather than paraphrasing; plans preserve supplied task order. Arithmetic uses IEEE-754 numbers with a 12-significant-digit display and supports +, -, *, /, ^, %, and parentheses. Percentage means division by 100. This is useful for demonstrating a real local processing/persistence turn, but it is not a general ChatGPT replacement.

No model server, weights, or ML runtime existed here. DNS requests to package/model registries failed, so downloading a real on-device model was impractical. Full language-model quality is explicitly left to the optional local path below.

## Full local model path

Install [Ollama](https://ollama.com/download) separately when network access is available. Then, in one terminal, start a local-only server:

~~~sh
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1 ollama serve
~~~

If an Ollama service is already listening, stop/reconfigure it first. Setting this environment variable on a second command does not change an existing process. In another terminal:

~~~sh
ollama pull llama3.2:1b
npm start
~~~

The pull downloads weights once. Open Still on **the same computer**, choose the engine control below the composer, and click **Check local model**. Subsequent messages use the real installed Llama model. No sign-in or API key is required. Still never pulls weights automatically and never calls a hosted chat API.

Only `llama3.2:1b` at `127.0.0.1:11434` is supported. Remote/cloud metadata is rejected before sending chat content. Disable Ollama cloud features as above. The bridge caps total conversation text at 16,000 characters, uses an 8,192-token context, generates at most 512 tokens, unloads weights after a request, and times out at 120 seconds. Tokenization varies; very long or non-English context may exhaust the model window earlier. Start a new chat if a context error occurs. CPU speed, available memory, and answer quality depend on your installation.

The browser sends complete conversation context, excluding errors and pending markers, to the **same-device** Node bridge. No web search, file access, tools, or external provider fallback exists. The daemon is a trusted part of this privacy boundary. See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Static hosting and mobile

~~~sh
npm run build
npm run preview
~~~

`dist/` contains plain static files with relative URLs (equivalent to Vite `base: './'`). Upload the contents to any static subpath; no deployment is performed by this project. Serve the directory over HTTP/HTTPS, not `file://`. A Python-only option after building is `python3 -m http.server 5173 --directory dist --bind 127.0.0.1`.

Offline tools work on desktop and mobile browsers. On HTTPS/localhost, wait for the service worker to install once; the app can then reload offline and generate offline replies. App shell caching never includes API calls. On ordinary HTTP LAN origins, service workers may be unavailable; keep the static server running for reloads.

To try the responsive UI on a phone on your trusted LAN, use `HOST=0.0.0.0 npm start` and open the computer's LAN address. This exposes app assets, not a working remote-inference bridge. The phone's chat history and offline processing stay on the phone. No native iOS/Android app or cross-device sync is included.

On a public static site, the engine picker explains why Ollama is unavailable. The frontend will not POST a transcript to that site.

## Storage, limits, and failure behavior

- Up to 50 conversations, 200 messages per conversation, and 12,000 characters per message. History is a schema-versioned localStorage snapshot; local writes are synchronous and small at prototype scale.
- Conversations are plaintext, scoped to the origin/browser profile and app base path. They do not travel with you to another browser/device. Clearing browser data loses them.
- Storage failures show a warning and **Not saved**. The current tab can still work in memory. Export a text copy before closing if persistence is unavailable.
- Corrupt/unknown-version history is never silently overwritten. Explicitly deleting all history resets it. There is no migration/import UI.
- No autosaved draft; no automatic cloud backup. Export is a local text download.
- Another tab editing the same history disables this tab's editing until reload; simultaneous multi-tab writes are outside the slice.
- No guaranteed secure deletion, at-rest encryption, key management, or protection from malicious extensions/OS access.
- User/model content is rendered as text; links, remote images, and HTML do not execute. Model errors never trigger a hosted fallback.

## Validation

~~~sh
npm run build
npm test
npm run test:browser
~~~

Unit/integration tests use Node's built-in test runner. Browser tests use the installed Google Chrome executable and the Chrome DevTools Protocol over process pipes; no downloaded testing package is required. Set `CHROME_BIN` if Chrome is installed elsewhere. On a successful run, screenshots are written to `test-artifacts/`; the temporary browser profile is inside this slot and removed after testing.

The included browser suite checks a real worker reply and reload persistence, calculation and name context, fresh-chat navigation, mobile overflow and drawer, local deletion, offline reload with the static server stopped, model-unavailable errors, and network privacy. Server tests use in-process request/response streams and a deterministic Ollama protocol fixture to validate forwarding and safeguards without opening sockets.

**Results in this build environment:** the build and all 17 engine/storage/server checks passed, including a real offline reply saved and rehydrated for a follow-up. HTML IDs and asset references also passed integrity checks. Live browser verification was attempted but **blocked**, not passed: localhost socket binding returned `EPERM`, and Chrome startup was separately denied by the sandbox. There are no claimed browser screenshots or completed visual checks. Run `npm run test:browser` on a normal Linux machine to complete that verification. **Real Llama inference was also not tested because weights/runtime were unavailable.**

Intentionally omitted: accounts, sync, plugins, voice, image generation, browsing, uploads, native shells, encryption, rich Markdown, token streaming, and model discovery. No dependencies need downloading; no hosted chat API was used.
