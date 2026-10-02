# Comparison

Two prototypes against the same brief: a chat turn that persists on the device, with no hosted chat API. Both are responsive web apps, not native shells. Builds were not re-run as model jobs; Kiln’s existing Vite app was rebuilt for this board (`npm run build`, succeeded). Still’s existing `dist/` was copied as-is.

## Kiln (`grok-4.7`)

- **What it is:** Vite app. LaMini-Flan-T5-77M (int8 ONNX, Transformers.js) runs in a browser worker.
- **Where inference runs:** In the tab, on the device. `local_files_only` is on and remote model downloads are off.
- **What is stored:** Threads in IndexedDB (`kiln`). Weights are static app files, not the transcript.
- **Network:** The running page is only allowed to load its own origin (`connect-src 'self'` on the Vite dev/preview server). No chat vendor, no telemetry. Fonts are bundled.
- **Honest limit:** Quality is the 77M Flan-T5. Short answers can be garbled, especially arithmetic. Context is trimmed. The WASM build is single-threaded asyncify so a static host does not need cross-origin isolation; replies are slow.
- **Weights on this board:** `public/models` is about 93 MB (largest file ~57 MB), not hundreds of MB, so the ONNX weights **are included** in the source branch and in `previews/grok-4.7/`. `public/ort/` is generated from `node_modules` at build time and is gitignored on the source branch; the built WASM is in the preview. `node_modules` is not pushed.

## Still (`gpt-6-astra`)

- **What it is:** Dependency-free static app. Default engine is a browser worker of local tools (calculator, extractive summary, task list, name lookup).
- **Where inference runs:** By default, nowhere as a model. Optional Ollama (`llama3.2:1b`) is loopback-only through the Node server, and only after the user selects it. That path is not available on a static host: the page refuses to POST a transcript unless the hostname is loopback.
- **What is stored:** Conversations in `localStorage` (`still:v1:…`), plaintext, origin-scoped. A service worker caches app files only, not transcripts.
- **Network:** Default engine does not send user text off the page. No CDN, analytics, or hosted chat API.
- **Honest limit:** Privacy and persistence are real. Default replies are deterministic local tools, not a generative model, unless the user runs Ollama locally. Real Llama generation was not exercised in the slot notes (weights were unavailable there).

## Side by side

| | Kiln | Still |
| --- | --- | --- |
| Default reply | Real 77M on-device model | Rule-based local tools |
| History | IndexedDB | localStorage |
| Optional fuller model | Not in this slice | Local Ollama, same machine only |
| Static preview | Works if the ~93 MB weights downloaded with the page | Works offline-tools path; Ollama does not |
| Build for this board | `npm run build` succeeded | `dist/index.html` already present; build script is local `node scripts/build.mjs` (no network) and was not re-run |

## Left out of both

Accounts, sync, plugins, voice, image generation, and a native app. History is not encrypted beyond the browser profile.
