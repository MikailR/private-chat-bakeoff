# Kiln

A private chat you can run in the browser on this machine. Replies come from a small language model inside the tab. The transcript stays in this browser. Kiln does not call a hosted chat API.

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (`http://127.0.0.1:5173`). Send a message, reload, and the thread is still there. The first reply waits while the tab loads the local weights.

```bash
npm run build
npm run preview
```

The same page is the mobile and desktop UI. There is no native shell in this prototype.

`ARCHITECTURE.md` is the privacy boundary. `NOTES.md` is how the slice is limited, and how to run it if you need the longer version.
