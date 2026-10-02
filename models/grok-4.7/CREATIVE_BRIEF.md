# Creative brief: private local-first chat prototype

## Goal
Architect and build a **prototype** (not a finished product) of a private alternative to ChatGPT that someone can try on mobile, desktop, or both.

A conversation someone can actually use:
- Send a message, get a reply, and keep that history on the device.
- Privacy by default. Run the model on-device or otherwise local-first, and be explicit about what never leaves the device.
- Include a short architecture note: where inference runs, what is stored, and what you intentionally left out.

## What "done" means
Someone can run the prototype and complete one real chat turn that persists across a reload (or app restart), without the conversation transcript being sent to a remote chat API.

## Constraints
- You choose the stack. A native app, a local web app, or a thin client around a local model are all fine.
- Prefer something a reviewer can run on this Linux machine with ordinary tools (Node, Python, a local model server, or a clearly documented fallback).
- If true on-device weights are impractical in this environment, ship a working local path (for example a local inference server, or a tiny local model) **and** document the intended on-device path. Do not silently call OpenAI, Anthropic, xAI, or any other hosted chat API for the reply.
- Mobile + desktop: a responsive local web app is acceptable if native shells are out of scope. Say so.
- Keep the slice small and coherent. Do not build accounts, sync, plugins, voice, image gen, or a model marketplace.

## Required outputs (all inside your slot directory)
1. `ARCHITECTURE.md` — coherent architecture: where inference runs, what is stored where, the privacy boundary (what never leaves the device), and an implementation plan.
2. `NOTES.md` — what you intentionally left out, how to run it, and any fallback you used instead of real on-device weights.
3. A runnable prototype whose build (if any) is green. Prefer Vite (or plain static) with `base: './'` so it can be hosted on a GitHub Pages subpath.
4. `README.md` — one screen: what this is, how to run it locally.

## Isolation
Build ONLY in the current working directory (your slot). Do not edit files outside it. Do not touch other models' directories, the repo root board, or git history outside your slot.

## Privacy bar (must be explicit in ARCHITECTURE.md)
State, in plain language:
- Where the model runs.
- What is written to disk, and that chat history stays on device.
- What network calls the running app makes (ideally none for inference).
- What you left out on purpose.
