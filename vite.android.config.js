/**
 * Vite config for the Android (and file://) build.
 *
 * A WebView that loads `file:///android_asset/www/index.html` has an opaque
 * ("null") origin, so Chromium refuses two kinds of subresource there:
 *   - `<script type="module" crossorigin>` — modules require a CORS fetch,
 *   - `<link rel="stylesheet" crossorigin>` — same check for the stylesheet.
 * Vite's default web build emits both, which is why the APK showed unstyled
 * HTML with no game running. The web/Electron build keeps that shape; this
 * config instead produces ONE classic (IIFE) script and one CSS file, which
 * `android/inline-www.mjs` then inlines into a single index.html with no
 * subresource requests at all — nothing left for CORS to block.
 */
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.js';

export default mergeConfig(
  base,
  defineConfig({
    build: {
      outDir: 'build/www-iife',
      emptyOutDir: true,
      // same ES2017 target: Android 5/6 WebViews are the oldest clients
      target: ['es2017', 'chrome61', 'safari11', 'firefox60'],
      cssCodeSplit: false,
      // inline every asset as a data: URI so the page stays a single file
      assetsInlineLimit: Number.MAX_SAFE_INTEGER,
      modulePreload: false,
      rollupOptions: {
        output: {
          format: 'iife',
          inlineDynamicImports: true,
          entryFileNames: 'index.js',
          assetFileNames: 'index[extname]',
        },
      },
    },
  }),
);
