import { defineConfig } from 'vite';

const csp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-src 'none'",
].join('; ');

const headers = {
  'Content-Security-Policy': csp,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    headers,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    headers,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
  worker: {
    format: 'es',
  },
});
