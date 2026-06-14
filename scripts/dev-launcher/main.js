// Electron main process for the Blissful Dev Launcher. All process/port
// logic lives in lib/manager.cjs; this file owns the window, IPC and the
// quit-safety net (nothing the launcher started may outlive it).
//
// Flags: --smoke[=out.png]  render, screenshot, exit (used by checks)
//        --devtools         open detached devtools

'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { DevManager } = require('./lib/manager.cjs');

// Brand mark shared with the Android app (transparent 1024px PNG).
const ICON_PATH = path.join(
  __dirname,
  '..',
  '..',
  'apps',
  'android-blissful',
  'assets',
  'blissful-small-logo.png',
);

const smokeArg = process.argv.find((a) => a.startsWith('--smoke'));
const smokePath = smokeArg
  ? path.resolve(smokeArg.includes('=') ? smokeArg.split('=')[1] : 'launcher-smoke.png')
  : null;

// Smoke runs never need focus-forwarding and must not silently no-op when
// a real launcher window happens to be open — skip the lock entirely.
const gotLock = smokePath ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('Blissful Dev Launcher is already running — focused the existing window.');
  app.quit();
} else {
  main();
}

function main() {
  const manager = new DevManager();
  let win = null;
  let quitting = false;

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  function createWindow() {
    win = new BrowserWindow({
      width: 1000,
      height: 680,
      minWidth: 900,
      minHeight: 600,
      backgroundColor: '#070b11',
      show: false,
      title: 'Blissful Dev',
      icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#070b11', symbolColor: '#bccdd2', height: 46 },
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    win.once('ready-to-show', () => win.show());
    if (process.argv.includes('--devtools')) {
      win.webContents.openDevTools({ mode: 'detach' });
    }

    win.on('close', (e) => {
      if (quitting || smokePath) return;
      const n = manager.managedCount();
      if (n === 0) return;
      e.preventDefault();
      const choice = dialog.showMessageBoxSync(win, {
        type: 'warning',
        title: 'Quit Blissful Dev',
        message:
          n === 1 ? 'One dev process is still running' : `${n} dev processes are still running`,
        detail: 'Quitting stops every process the launcher started.',
        buttons: ['Stop everything and quit', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (choice === 0) {
        quitting = true;
        manager.killAllSync();
        win.destroy();
      }
    });

    win.on('closed', () => {
      win = null;
    });
  }

  ipcMain.handle('launcher:state', () => ({
    envs: manager.snapshot(),
    logs: manager.allLogs(),
  }));
  ipcMain.handle('launcher:start', (_e, id) => {
    manager.start(String(id)).catch((err) => console.error('start failed:', err.message));
  });
  ipcMain.handle('launcher:stop', (_e, id) => {
    manager.stop(String(id)).catch((err) => console.error('stop failed:', err.message));
  });
  ipcMain.handle('launcher:open', (_e, url) => {
    if (typeof url === 'string' && /^http:\/\/(localhost|127\.0\.0\.1):\d{2,5}\/?$/.test(url)) {
      void shell.openExternal(url);
    }
  });

  manager.on('state', (snap) => {
    if (win && !win.isDestroyed()) win.webContents.send('launcher:state-changed', snap);
  });
  manager.on('log', (payload) => {
    if (win && !win.isDestroyed()) win.webContents.send('launcher:log', payload);
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    manager.startPolling();

    if (smokePath) {
      win.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          let ok = false;
          try {
            const img = await win.webContents.capturePage();
            fs.writeFileSync(smokePath, img.toPNG());
            console.log(`smoke screenshot written: ${smokePath}`);
            ok = true;
          } catch (err) {
            console.error('smoke capture failed:', err);
          }
          quitting = true;
          manager.killAllSync();
          app.exit(ok ? 0 : 1);
        }, 1800);
      });
    }
  });

  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => {
    quitting = true;
    manager.dispose();
    manager.killAllSync();
  });
}
