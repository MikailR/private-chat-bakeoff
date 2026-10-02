# Still: architecture and privacy boundary

Still is a small responsive web app, with no frontend framework, package dependencies, or remote chat API. It is a prototype of the conversation and local storage boundary, not a finished private assistant.

## Where replies and models run

There are two explicitly selected engines:

1. **Offline tools (default, working here):** JavaScript in a dedicated browser Web Worker. A recursive-descent calculator, frequency-ranked extractive summarizer, task-list planner, name lookup over this conversation, and a small bag-of-words retrieval index over bundled help text produce useful replies. This is deterministic software, **not a generative language model and not pretrained on-device weights**. Unsupported questions get a candid capability explanation, not a fabricated answer.
2. **Ollama (optional full LLM):** the browser sends the conversation to this app's Node server on loopback. Node calls only `http://127.0.0.1:11434`, using locally installed **llama3.2:1b** weights. The model computes on that computer's CPU/GPU. It is never a remote inference URL. Users explicitly check and select this engine. Failure produces an error and a retry action; it never falls back to cloud or quietly changes engines.

No model runtime or weights were installed in the build environment, and DNS/package/model downloads were unavailable. The shipped offline fallback is functional and tested; real Llama generation could not be exercised here. The optional local server integration is implemented and tested against a local protocol fixture, which is not evidence of real model quality.

~~~text
                         THIS DEVICE
┌─────────────────────────────────────────────────────────────┐
│ Browser UI ── message ──► browser worker (offline tools)       │
│     │                        │                              │
│     └──────── reply ◄────────┘                              │
│     │                                                       │
│     ├──► localStorage: conversations + selected engine       │
│     └──► Cache Storage: application code only                │
│                                                             │
│ Optional, explicitly selected local LLM:                     │
│ Browser → Node :5173 → Ollama 127.0.0.1:11434 → local weights  │
└─────────────────────────────────────────────────────────────┘
No hosted chat API. No accounts, transcript uploads, or sync.
~~~

## What is written to disk

- Browser localStorage under `still:v1:<base-path>`: versioned conversations (IDs, titles, timestamps, roles, content, completion/error status, engine), active conversation ID, and selected engine. All history stays in this device's browser profile. It is isolated by browser origin, with an additional app-path namespace.
- The user message and pending reply marker are saved **before** generation. The finished reply is saved immediately. Reload turns an unfinished marker into a visible interrupted state with retry. Unsaved composer drafts are not retained.
- Cache Storage holds only a fixed list of public application assets so a previously loaded app can reload offline on localhost or HTTPS. The service worker never caches API traffic or transcripts.
- Explicit text export creates a local plaintext download. The app itself has no backup or export upload endpoint.
- The Node process stores no transcripts on disk and writes no request or response logs. In Ollama mode it handles messages transiently in memory. Ollama stores model weights in its normal model directory; model inference requests set `keep_alive: 0`. The user's installed Ollama process, OS swap, and OS/browser backups are outside this application's control.

History is **not encrypted at rest**. Access to the browser profile, a compromised same-origin page, malicious extensions, or a compromised device can expose it. “Delete” removes browser records; it is not forensic disk erasure and cannot remove previously exported copies or backups. Private browsing, browser cleanup, storage quotas, or switching origins/ports can make history unavailable. Errors saving are shown as **Not saved**; the app does not claim successful persistence after a failed write. Unreadable saved data is left untouched until the user explicitly clears it.

A storage event from another tab stops editing and asks for reload, preventing the common cross-tab stale overwrite. This prototype is intended for one active tab; simultaneous writes in the same instant are not a transactionally supported multi-tab workflow.

## Network calls made by the running app

**Default engine:** initial/reload GET requests for its own HTML, CSS, JavaScript, SVG icon, and service worker. There are no inference fetches. User text goes to a worker by in-process messaging and to localStorage; **it is never sent to the web host or any remote chat API**. No CDN, remote fonts, images, analytics, error reporting, or telemetry.

**Optional Ollama:** only after selection/check, a same-origin GET `./api/status`; on sending, POST `./api/chat`. Node verifies local model metadata using Ollama's `/api/show` before every generation and calls its `/api/chat`. All these requests stay on loopback. The bridge is fixed to one model and one endpoint; it refuses metadata with `remote_host` or `remote_model`, missing GGUF format, or missing parameter count. HTTP redirects are refused. There is no API key or arbitrary URL field.

Start Ollama with **`OLLAMA_NO_CLOUD=1`**; this is part of the documented setup, not an environment setting the web app can enforce in an already-running third-party process. Do not replace the trusted local daemon with a forwarding proxy. The app cannot prove what a malicious daemon does. Model installation/download is a separate, user-initiated internet operation that carries no conversation. Cloud-backed aliases are unsupported. [Ollama's official local-only configuration](https://docs.ollama.com/faq#how-do-i-disable-ollama-cloud-features) documents the cloud-disable switch.

The Node server defaults to `127.0.0.1`. Its bridge validates peer IP, Host/port, Origin, fetch-site, and a custom request header, with no CORS permissions. It rejects requests arriving from another device. The frontend also refuses to POST conversations unless its own hostname is loopback. Thus a public static deployment cannot accidentally POST transcripts to its host.

Static deployment on HTTPS (including a GitHub Pages subpath) contacts that host to load app files, exposing ordinary connection metadata, not chats. Cached offline reloads work after successful service worker installation. A phone loading assets from a desktop over LAN still processes offline-tool messages **on the phone**; it cannot use that desktop's model bridge.

## Implementation and verification plan

Implemented in this slice:

1. Build a responsive, keyboard-accessible conversation UI, small-screen drawer, local history, engine/privacy dialogs, and explicit deletion/export.
2. Persist a schema-checked state snapshot before/after each turn. Recover interrupted turns; expose corruption/quota errors rather than silently resetting data.
3. Keep offline computation in a worker, support cancellation, and render user/model output as plain text so HTML, scripts, and image URLs cannot execute or fetch.
4. Add a same-device Ollama bridge with request bounds, local-weight verification, cancellation/timeouts, no redirects, no transcript logs, and no remote fallback.
5. Build by syntax-checking and copying app assets into `dist/`; all URLs are relative. The build and 17 engine/storage/server checks pass. A browser verification script covers chat/reload, offline operation, mobile layout, deletion, and observed requests; execution here was blocked by sandbox socket and Chrome startup restrictions (`EPERM`). That browser/visual verification remains for a normal Linux environment. See the exact results in NOTES.md.

## Intended on-device LLM path and intentional omissions

The future browser-native path would replace the worker adapter with a quantized small instruction model in a WebGPU/WASM runtime. Ship/version the runtime locally, require explicit one-time weight download or local import, verify hashes, and store weights in OPFS/IndexedDB. Check device memory and WebGPU support before enabling it. Chat text would stay inside the worker; no inference server would be required, including on mobile. Weight eviction, storage pressure, runtime compatibility, and model licensing need evaluation before promising this path. **It is not implemented here.**

Intentionally left out: accounts, sync, remote providers, plugins, voice, image generation, attachments, browsing, tools with side effects, a model marketplace, native shells, encryption/key management, token streaming, Markdown/HTML rendering, a persistent cross-chat memory, and production hardening. This is one coherent, inspectable conversation slice.
