import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = 'http://127.0.0.1:4173/';
const question = 'What is the capital of France?';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function relativeLuminance(rgb) {
  const parts = rgb.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
  const linear = parts.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);

const html = readFileSync(join(root, 'dist/index.html'), 'utf8');
assert(!/(?:src|href)="\//.test(html), `dist/index.html has a root-absolute asset URL:\n${html}`);
assert(html.includes('./assets/'), 'dist/index.html is missing relative asset URLs');

const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4173', '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
});
preview.stdout.on('data', (chunk) => process.stdout.write(chunk));
preview.stderr.on('data', (chunk) => process.stderr.write(chunk));

const stop = () => {
  if (!preview.pid) return;
  try {
    process.kill(-preview.pid, 'SIGKILL');
  } catch {
    try { preview.kill('SIGKILL'); } catch { /* already gone */ }
  }
};
process.on('exit', stop);

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const csp = response.headers.get('content-security-policy') ?? '';
        assert(csp.includes("connect-src 'self'"), `preview CSP is missing connect-src 'self': ${csp}`);
        return;
      }
    } catch {
      // server still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('Preview server did not start');
}

await waitForServer();

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

try {
  const page = await browser.newPage();
  const bad = [];
  const logs = [];
  page.on('request', (request) => {
    const target = request.url();
    if (target.startsWith('data:') || target.startsWith('blob:')) return;
    const host = new URL(target).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') bad.push(target);
  });
  page.on('console', (message) => logs.push(`${message.type()}: ${message.text()}`));
  page.on('pageerror', (error) => logs.push(`pageerror: ${error.message}`));

  await page.setViewport({ width: 1280, height: 800 });
  await page.setCacheEnabled(false);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const early = await page.$eval('#app', (el) => el.dataset.modelState);
  if (early !== 'ready') {
    const disabled = await page.$eval('#send', (el) => el.disabled);
    assert(disabled, 'Send was enabled before the local model was ready');
  }

  await page.waitForSelector('#app[data-model-state="ready"]', { timeout: 180000 });
  await page.click('#composer');
  await page.type('#composer', question);
  await page.click('#send');
  await page.waitForFunction(() => {
    const error = document.querySelector('#model-error-text')?.textContent?.trim();
    if (error) throw new Error(error);
    const node = document.querySelector('.msg.assistant .msg-body');
    if (!node) return false;
    const pending = node.closest('.msg')?.hasAttribute('data-pending');
    return !pending && (node.textContent ?? '').trim().length > 0;
  }, { timeout: 180000 });

  const reply = await page.$eval('.msg.assistant .msg-body', (el) => el.textContent ?? '');
  console.log('REPLY:', JSON.stringify(reply));
  assert(reply.trim().length > 0, 'Assistant reply was empty');
  assert(!reply.includes('empty reply'), `Model returned the empty-reply fallback: ${reply}`);

  const userBefore = await page.$eval('.msg.user .msg-body', (el) => el.textContent ?? '');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction((expected) => {
    const node = document.querySelector('.msg.user .msg-body');
    return node?.textContent === expected;
  }, { timeout: 15000 }, userBefore);
  const assistantAfter = await page.$eval('.msg.assistant .msg-body', (el) => el.textContent ?? '');
  assert(assistantAfter === reply, 'Assistant reply did not survive reload');

  await page.waitForSelector('#app[data-model-state="ready"]', { timeout: 180000 });
  await page.click('#open-privacy');
  await page.waitForSelector('#privacy[open]');
  const privacyText = await page.$eval('#privacy', (el) => el.textContent ?? '');
  assert(privacyText.includes('IndexedDB'), 'Privacy panel does not mention IndexedDB');
  assert(/hosted chat API/i.test(privacyText), 'Privacy panel does not mention the chat API boundary');
  await page.screenshot({ path: '/tmp/kiln-privacy.png' });
  await page.click('#close-privacy');

  await page.screenshot({ path: '/tmp/kiln-desktop.png' });
  const desktopContrast = await page.evaluate(() => {
    const title = getComputedStyle(document.querySelector('#room-title'));
    const room = getComputedStyle(document.querySelector('#room'));
    return { color: title.color, background: room.backgroundColor };
  });
  const desktopRatio = contrast(
    relativeLuminance(desktopContrast.color),
    relativeLuminance(desktopContrast.background),
  );
  console.log('DESKTOP CONTRAST', desktopRatio.toFixed(2), desktopContrast);
  assert(desktopRatio >= 4.5, `Desktop title contrast is ${desktopRatio.toFixed(2)}`);

  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.screenshot({ path: '/tmp/kiln-dark.png' });
  const darkContrast = await page.evaluate(() => {
    const title = getComputedStyle(document.querySelector('#room-title'));
    const room = getComputedStyle(document.querySelector('#room'));
    return { color: title.color, background: room.backgroundColor };
  });
  const darkRatio = contrast(relativeLuminance(darkContrast.color), relativeLuminance(darkContrast.background));
  console.log('DARK CONTRAST', darkRatio.toFixed(2), darkContrast);
  assert(darkRatio >= 4.5, `Dark title contrast is ${darkRatio.toFixed(2)}`);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  await page.click('#new-chat');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.thread-open')].some((node) => node.textContent === 'New chat'),
  );
  const titles = await page.$$eval('.thread-open', (nodes) => nodes.map((node) => node.textContent));
  assert(titles.includes('New chat'), `New chat was not created: ${titles.join(' | ')}`);
  assert(titles.some((title) => title?.includes('capital of France')), 'Original thread disappeared');
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.thread-open')].find((node) =>
      (node.textContent ?? '').includes('capital of France'),
    );
    if (!button) throw new Error('France thread button is missing');
    button.click();
  });
  await page.waitForFunction(() =>
    (document.querySelector('#room-title')?.textContent ?? '').includes('capital of France'),
  );

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  // Chrome reloads when the mobile viewport override is applied. History is still in IndexedDB.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.thread-open')].some((node) =>
      (node.textContent ?? '').includes('capital of France'),
    ),
  );
  const mobile = await page.evaluate(() => {
    const rail = document.querySelector('#rail').getBoundingClientRect();
    const composerBox = document.querySelector('.composer').getBoundingClientRect();
    return {
      railRight: rail.right,
      composerTop: composerBox.top,
      composerBottom: composerBox.bottom,
      height: window.innerHeight,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      backdropHidden: document.querySelector('#rail-backdrop').hidden,
    };
  });
  console.log('MOBILE', mobile);
  assert(mobile.railRight <= 0, 'Chat list should be off-screen on a phone');
  assert(mobile.backdropHidden, 'Backdrop is visible while the chat list is closed');
  assert(!mobile.overflow, 'Page scrolls sideways on a phone');
  assert(mobile.composerBottom <= mobile.height + 1, 'Composer is below the phone viewport');
  assert(mobile.composerTop > 0, 'Composer is above the phone viewport');

  await page.click('#open-threads');
  await page.waitForFunction(() => document.querySelector('#rail').getBoundingClientRect().left >= 0);
  const railOpen = await page.evaluate(() => document.querySelector('#rail').getBoundingClientRect().left);
  assert(railOpen >= 0, 'Chat list did not open');
  await page.screenshot({ path: '/tmp/kiln-mobile-drawer.png' });
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('.thread-open')].find((node) =>
      (node.textContent ?? '').includes('capital of France'),
    );
    button?.click();
  });
  await page.waitForFunction(() => {
    const rail = document.querySelector('#rail').getBoundingClientRect();
    const title = document.querySelector('#room-title')?.textContent ?? '';
    const reply = document.querySelector('.msg.assistant .msg-body')?.textContent ?? '';
    return rail.right <= 0 && title.includes('capital of France') && reply.includes('Paris');
  });
  await page.screenshot({ path: '/tmp/kiln-mobile.png' });

  assert(bad.length === 0, `Off-device requests:\n${bad.join('\n')}`);
  const serious = logs.filter((line) => /pageerror|error:/i.test(line) && !/Failed to load resource/i.test(line));
  if (serious.length) console.log('CONSOLE', serious.join('\n'));
  console.log('VERIFY OK');
} finally {
  await browser.close();
  stop();
}
