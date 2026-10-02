import { cp, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const scripts = ['main.js', 'icons.js', 'storage.js', 'engine.js', 'local.worker.js', 'sw.js'];
for (const script of scripts) {
  const result = spawnSync(process.execPath, ['--check', join(root, 'app', script)], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
}
const html = await readFile(join(root, 'app/index.html'), 'utf8');
if (/\b(?:src|href)=["'](?:https?:\/\/|\/)/.test(html)) throw new Error('Assets must use relative, local paths.');
await mkdir(join(root, 'dist'), { recursive: true });
await cp(join(root, 'app'), join(root, 'dist'), { recursive: true });
console.log('Built dist/ — dependency-free, relative assets, ready for a static subpath.');
