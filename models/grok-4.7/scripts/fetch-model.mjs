import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const destRoot = join(root, 'public/models/Xenova/LaMini-Flan-T5-77M');
const base = 'https://huggingface.co/Xenova/LaMini-Flan-T5-77M/resolve/main';

const files = [
  ['config.json', 1537],
  ['generation_config.json', 147],
  ['tokenizer_config.json', 2457],
  ['tokenizer.json', 2422262],
  ['onnx/encoder_model_quantized.onnx', 35759128],
  ['onnx/decoder_model_merged_quantized.onnx', 59339330],
];

async function download(rel, size) {
  const dest = join(destRoot, rel);
  if (existsSync(dest) && statSync(dest).size === size) {
    console.log(`keep ${rel}`);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  const url = `${base}/${rel}`;
  console.log(`fetch ${rel}`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
  const actual = statSync(dest).size;
  if (actual !== size) {
    throw new Error(`${rel} is ${actual} bytes, expected ${size}`);
  }
}

for (const [rel, size] of files) {
  await download(rel, size);
}
console.log('Model weights are in public/models');
