import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths so the same build works from a web server and from
  // the desktop (Electron file://) shell
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow preview hosts (sandbox/proxy domains) to reach the dev server
    allowedHosts: true,
    strictPort: false,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
  build: {
    // ES2017 keeps the bundle parseable by older Android WebView builds (the
    // universal APK targets Android 5.0+), while modern browsers/Electron are
    // unaffected. Optional chaining and nullish coalescing are down-levelled.
    target: ['es2017', 'chrome61', 'safari11', 'firefox60'],
    chunkSizeWarningLimit: 1200,
  },
});
