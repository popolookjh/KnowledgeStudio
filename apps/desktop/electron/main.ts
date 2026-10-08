import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { registerVaultIpc } from './ipc.js';

const DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

/**
 * Creates the main window with the hardened renderer configuration:
 * sandbox on, context isolation on, Node integration off. All privileged
 * work stays in the main process behind the IPC contracts in
 * `shared/ipc-contract.ts`.
 */
function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1216',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  // The renderer is a single local page: never open new windows or navigate
  // away (e.g. clicking a link from clipped or imported content).
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  win.once('ready-to-show', () => {
    void win.show();
  });

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(import.meta.dirname, '..', '..', 'dist', 'index.html'));
  }

  return win;
}

void app.whenReady().then(() => {
  // No web permission (camera, microphone, geolocation, notifications, …) is ever granted.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const win = createMainWindow();
  registerVaultIpc(win);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
