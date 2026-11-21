#!/usr/bin/env node
/**
 * Fold the Vite (IIFE) build into ONE self-contained index.html for the APK.
 *
 *   node inline-www.mjs <vite-out-dir> <dest-dir>
 *
 * The Android WebView loads the page from `file:///android_asset/www/`, an
 * opaque origin where `file://` subresource fetches are blocked (module scripts
 * and `crossorigin` stylesheets in particular). Inlining the CSS and the classic
 * script removes every subresource request, so the page works identically from a
 * web server, from `file://` and from the APK's assets.
 *
 * The script fails loudly if anything still has to be fetched, rather than
 * shipping an APK that renders bare markup.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [, , srcArg, destArg] = process.argv;
if (!srcArg || !destArg) {
  console.error('usage: node inline-www.mjs <vite-out-dir> <dest-dir>');
  process.exit(2);
}
const src = resolve(srcArg);
const dest = resolve(destArg);

let html = readFileSync(join(src, 'index.html'), 'utf8');

const used = new Set();

function readAsset(href) {
  const rel = href.replace(/^\.?\//, '');
  used.add(rel);
  return readFileSync(join(src, rel), 'utf8');
}

let css = '';
html = html.replace(
  /<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi,
  (tag) => {
    const m = tag.match(/href=["']([^"']+)["']/i);
    if (!m) return '';
    css += readAsset(m[1]) + '\n';
    return '';
  },
);

let js = '';
html = html.replace(
  /<script\b([^>]*)\bsrc=["']([^"']+)["']([^>]*)><\/script>/gi,
  (tag, before, href, after) => {
    const attrs = (before + ' ' + after).toLowerCase();
    if (/\bdefer\b/.test(attrs) || /\basync\b/.test(attrs)) {
      // a deferred script would run after DOMContentLoaded; the game expects to
      // find its DOM already there, so refuse instead of silently reordering
      throw new Error('unexpected defer/async script in the bundle: ' + tag);
    }
    js += readAsset(href) + '\n';
    return '';
  },
);

// `</script>` inside the JS (e.g. in a string) would end the inline block early
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const safeCss = css.replace(/<\/style/gi, '<\\/style');

// NB: function replacers on purpose. The bundle contains `$`-sequences
// (`` $` ``, `$&`, `$'`), which String.replace() would expand as capture-group
// references and splice the surrounding document into the JavaScript.
html = html.replace('</head>', () => `    <style>\n${safeCss}    </style>\n  </head>`);
html = html.replace('</body>', () => `    <script>\n${safeJs}    </script>\n  </body>`);

// nothing may be left to fetch at runtime
const leftover = [...html.matchAll(/\b(?:src|href)=["']([^"']*)["']/gi)]
  .map((m) => m[1])
  .filter((u) => u && !/^(?:#|data:|https?:|mailto:|javascript:)/i.test(u));
if (leftover.length) {
  console.error('error: the page still references local files: ' + leftover.join(', '));
  process.exit(1);
}
if (/type=["']module["']/i.test(html)) {
  console.error('error: a module script survived inlining (file:// would block it)');
  process.exit(1);
}
if (!/<style>/.test(html) || !/<script>/.test(html)) {
  console.error('error: inline style/script missing — nothing was inlined');
  process.exit(1);
}

// belt and braces: the inline script must still parse as a classic script
const inline = html.match(/<script>([\s\S]*?)<\/script>/);
if (!inline) {
  console.error('error: no inline script block found');
  process.exit(1);
}
if (!inline[1].includes(safeJs)) {
  console.error('error: the inline script was altered while assembling the page');
  process.exit(1);
}

const emitted = readdirSync(src, { withFileTypes: true })
  .filter((f) => f.isFile() && f.name !== 'index.html')
  .map((f) => f.name);
const unused = emitted.filter((f) => !used.has(f));
if (unused.length) {
  console.error('error: files were emitted but never inlined: ' + unused.join(', '));
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
writeFileSync(join(dest, 'index.html'), html);

const kb = (n) => (n / 1024).toFixed(1) + ' kB';
console.log(
  `inlined single page: ${join(dest, 'index.html')} ` +
    `(${kb(Buffer.byteLength(html))}: ${kb(css.length)} css + ${kb(js.length)} js)`,
);
