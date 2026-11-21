/**
 * Touchline Vale — desktop shell.
 *
 * Loads the Vite production build (`dist/`) straight off disk, so the desktop
 * build needs no server and no network connection. Run with:
 *   npm run desktop            (after npm run build)
 *   npm run desktop:package    (produces a standalone executable)
 */
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const INDEX = path.join(ROOT, 'dist', 'index.html');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#070c16',
    title: 'Touchline Vale',
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // the game is a single local page; no remote content is ever loaded
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Never navigate away from the packaged game
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!fs.existsSync(INDEX)) {
    win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<body style="font:16px/1.5 system-ui;background:#070c16;color:#eef4ff;padding:48px">
             <h1 style="color:#c9ff4a">Touchline Vale</h1>
             <p>The game files were not found. Build them first:</p>
             <pre style="background:#101a2c;padding:16px;border-radius:8px">npm install
npm run build
npm run desktop</pre>
           </body>`
        )
    );
    return win;
  }

  win.loadFile(INDEX);
  return win;
}

// Simple, game-appropriate menu: quit / reload / fullscreen only.
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Game',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: (_i, win) => win?.reload() },
        { label: 'Toggle Full Screen', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', click: (_i, win) => win?.setFullScreen(!win.isFullScreen()) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
