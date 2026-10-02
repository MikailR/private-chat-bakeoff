import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/onnxruntime-web/dist');
const dest = join(root, 'public/ort');
const files = [
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
];

mkdirSync(dest, { recursive: true });
for (const file of files) {
  const from = join(src, file);
  if (!existsSync(from)) {
    console.error(`Missing ONNX runtime file: ${from}`);
    console.error('Run npm install, then try again.');
    process.exit(1);
  }
  copyFileSync(from, join(dest, file));
}
console.log('Copied the local ONNX runtime into public/ort');
