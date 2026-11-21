/**
 * Desktop (Electron) smoke test: launches the packaged app, checks the game
 * boots from dist/ with no page errors, then takes a screenshot of the window.
 * Usage: npm run build && xvfb-run -a node tests/desktop.mjs
 */
import { _electron as electron } from 'playwright';

const app = await electron.launch({
  args: ['.', '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  timeout: 60000,
});
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.waitForTimeout(2500);
const title = await page.title();
const hasGame = await page.evaluate(() => !!window.__PITCH_LEGENDS__?.game);
const quickVisible = await page.locator('#btn-quick').isVisible();
await page.screenshot({ path: 'docs/desktop.png' });
await page.click('#btn-quick');
await page.waitForTimeout(600);
// the quick match setup screen must be usable from the desktop shell
const setupVisible = await page.locator('#screen-match').isVisible();
await page.click('#screen-match [data-setting="controls"] button[data-value="desktop"]');
await page.click('#btn-kickoff');
await page.waitForTimeout(2500);
const state = await page.evaluate(() => window.__PITCH_LEGENDS__.game.state);
await page.screenshot({ path: 'docs/desktop-match.png' });

console.log(`title: ${title}`);
console.log(`window size: ${JSON.stringify(await page.evaluate(() => [innerWidth, innerHeight]))}`);
console.log(`game booted: ${hasGame}, quick match visible: ${quickVisible}, setup screen: ${setupVisible}`);
console.log(`match state after kickoff click: ${state}`);
console.log(`errors: ${errors.length ? errors.slice(0, 5).join(' | ') : 'none'}`);

await app.close();
if (!hasGame || !setupVisible || errors.length || state === 'idle') process.exit(1);
