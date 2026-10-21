// Shared helpers to launch Reson under Playwright with an isolated profile.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const ROOT = path.resolve(import.meta.dirname, '..', '..');

export function tempProfile(prefix = 'vela-e2e-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export async function launch({ userData, env = {}, executablePath, args } = {}) {
  const app = await electron.launch({
    executablePath: executablePath ?? require('electron'),
    args: args ?? [ROOT],
    // VELA_QUIET: no visible windows, muted audio, no media-key capture.
    env: { ...process.env, VELA_USER_DATA: userData, VELA_E2E: '1', VELA_QUIET: '1', ...env },
    timeout: 60000,
  });
  const proc = app.process();
  const logs = [];
  app.process().stdout?.on('data', (d) => logs.push(String(d)));
  app.process().stderr?.on('data', (d) => logs.push(String(d)));
  const page = await app.firstWindow();
  page.on('console', (m) => logs.push(`[renderer:${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.waitForLoadState('domcontentloaded');
  return { app, page, logs, proc };
}

/** Adds folders through the test hook (bypasses the native picker) and waits for the scan. */
export async function addFoldersAndScan(app, folders) {
  return app.evaluate(async (_electron, dirs) => {
    const res = await globalThis.__velaTest.addFolders(dirs);
    await new Promise((r) => setTimeout(r, 50));
    await globalThis.__velaTest.waitForScan();
    return res;
  }, folders);
}

/**
 * Screenshot via Electron's capturePage. Works for hidden (quiet-mode) windows, where Playwright's
 * screenshot would wait forever for a new frame.
 */
export async function captureWindow(app, urlPart, file) {
  const b64 = await app.evaluate(async ({ BrowserWindow }, part) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(part));
    if (!win) return null;
    // Hidden windows repaint lazily: force a paint and give it a moment before capturing.
    win.webContents.invalidate();
    await new Promise((r) => setTimeout(r, 250));
    await win.webContents.capturePage();
    win.webContents.invalidate();
    await new Promise((r) => setTimeout(r, 250));
    const img = await win.webContents.capturePage();
    return img.toPNG().toString('base64');
  }, urlPart);
  if (b64) (await import('node:fs')).writeFileSync(file, Buffer.from(b64, 'base64'));
  return !!b64;
}
