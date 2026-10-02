# Notes

## How to run

Requirements: Node 20+ and a current Chrome, Firefox, or Safari. The review machine used Node 20 and Chrome.

```bash
npm install
npm run dev
```

Vite serves `http://127.0.0.1:5173`. `npm run build` then `npm run preview` serves the production build at `http://127.0.0.1:4173`.

The first visit reads about 95MB of weights from that local server into the tab. The status line shows load progress. After it says "On this device", send a message. Reload the page. The thread is still in the list. History is in IndexedDB, so it survives the reload even while the model is loading again.

`npm run verify` builds the app and drives Chrome through one real turn, a reload, the privacy panel, and a narrow viewport. It needs `/usr/bin/google-chrome`.

If `public/models/` is missing, run `npm run fetch-model` once. That script is the only Hugging Face download, and the page does not call it. `public/ort/` is recreated from `node_modules` by `predev`, `prebuild`, and `prepreview`.

## The model, and the fallback

The reply path is the real 77M model. There is no template bot behind it, and there is no hosted model behind it. If WebAssembly fails to start, the page shows the error and leaves the send button off. It does not invent a reply and it does not call an API.

LaMini-Flan-T5-77M is a small instruction model (MBZUAI, Apache-2.0; ONNX weights packaged by Xenova for Transformers.js). It can answer a short question, make a short list, or greet you. It also wanders: arithmetic and some explanations come out garbled, and a long chat gets trimmed to the latest turns. That is the model, not a silent failure. The privacy panel names it so the limit is visible.

The runtime is single-threaded `asyncify` WASM. That build runs without cross-origin isolation, which a static host such as GitHub Pages cannot easily add. It is slower than a threaded build on a tuned desktop. A short reply can take a few seconds in native CPU and longer in the tab. The status line stays on "Writing a reply…" until the worker finishes.

## Intended on-device path beyond this slice

The boundary above is the one to keep: weights and the transcript stay on the device, and the reply is computed there.

On a phone or a stronger desktop, the same page would load a larger instruct model (SmolLM2 or Llama 3.2 1B class) with WebGPU when the browser has it, and fall inside the device to a native runtime rather than to a chat API. A thin native shell (a web view, or a small desktop wrapper) would be packaging only. It is not in this prototype. The responsive layout is the mobile and desktop UI.

## Left out on purpose

- Accounts, passwords, and profiles
- Cloud sync, backup, and multi-device history
- Plugins, tools, browsing, and file uploads
- Voice, image generation, and image understanding
- A model picker or a download store inside the app
- Sharing, collaboration, and public links
- A native iOS or Android shell, and an installable PWA
- Export, search across chats, and rename
- Encryption beyond what the browser profile already provides
- Stop-generation. A reply runs to at most 48 new tokens, then the composer unlocks

The slice is one private room: threads on this device, a reply from the local model, and a plain statement of what stays here.
