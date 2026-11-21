// Regression test: the packaged page must run from file:// with a null origin.
// This is exactly what the Android WebView does with
// file:///android_asset/www/index.html — before the fix, Vite's
// `type="module" crossorigin` script and `crossorigin` stylesheet were blocked
// there and the app showed bare HTML with no game.
//
//   node tests/file-protocol.mjs [path/to/index.html]
//
// Run with no extra Chromium flags on purpose: any flag that relaxes file://
// security would hide the very bug this test exists to catch.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const page_ = resolve(process.argv[2] || resolve(here, '..', 'android', 'build', 'www', 'index.html'));
const url = pathToFileURL(page_).href;

const browser = await chromium.launch();
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 800 });
  const page = await context.newPage();
  const errors = [];
  const blocked = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('requestfailed', (r) => blocked.push(`${r.url()} (${r.failure()?.errorText})`));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const tag = `${viewport.width}x${viewport.height}`;

  check(`${tag}: no blocked requests`, blocked.length === 0, blocked.join('; '));
  check(`${tag}: no console/page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));

  // stylesheet really applied: the game paints a dark body background, while an
  // unstyled page falls back to white with default black serif text
  const cssApplied = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const m = body.backgroundColor.match(/[\d.]+/g)?.map(Number) || [];
    const dark = m.length >= 3 && (m[0] * 0.299 + m[1] * 0.587 + m[2] * 0.114) < 60;
    const font = body.fontFamily;
    return { ok: dark, why: `${body.backgroundColor}, font ${font}` };
  });
  check(`${tag}: theme stylesheet applied`, cssApplied.ok, cssApplied.why);

  // the game actually booted: three.js renderer owns #scene
  const booted = await page.evaluate(() => {
    const canvas = document.querySelector('#scene');
    const title = document.querySelector('#screen-title');
    return {
      // three.js sizes the drawing buffer to the window; an untouched canvas
      // keeps its default 300x150
      canvas:
        !!canvas &&
        canvas.width >= window.innerWidth * 0.9 &&
        canvas.height >= window.innerHeight * 0.9,
      titleShown: !!title && !title.classList.contains('hidden'),
      title: document.title,
    };
  });
  check(`${tag}: three.js sized the canvas`, booted.canvas);
  check(`${tag}: title screen visible`, booted.titleShown);
  check(`${tag}: title from game`, /Touchline Vale/.test(booted.title), booted.title);

    // click through to the Quick Match setup screen, as a player would (this needs
  // the JS to be running AND the click handler to be wired up)
  const quick = page.locator('#btn-quick');
  let played = false;
  if (await quick.count()) {
    await quick.click({ force: true });
    await page.waitForTimeout(600);
    played = await page.evaluate(() => {
      const title = document.querySelector('#screen-title');
      const setup = document.querySelector('#screen-match');
      const visible = (el) => !!el && !el.classList.contains('hidden') && el.getBoundingClientRect().height > 100;
      return (
        !visible(title) &&
        visible(setup) &&
        /match length/i.test(setup.textContent) &&
        /controls/i.test(setup.textContent)
      );
    });
  }
  check(`${tag}: Quick Match setup screen opens on click`, played);

  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
