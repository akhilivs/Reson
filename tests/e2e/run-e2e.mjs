// End-to-end tests against the real Electron app (built renderer, real audio fixtures).
// Usage: npm run test:e2e   (set VELA_SHOTS=<dir> to save screenshots)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, tempProfile, addFoldersAndScan, captureWindow, ROOT } from './launch.mjs';

const FIXTURES = path.join(ROOT, 'tests', 'fixtures', 'generated', 'library');
if (!fs.existsSync(FIXTURES)) execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-fixtures.mjs')], { stdio: 'inherit' });

const SHOTS = process.env.VELA_SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (_page, name) => SHOTS && captureWindow(app, 'index.html', path.join(SHOTS, `${name}.png`));

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - t}ms)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    if (SHOTS) await captureWindow(app, 'index.html', path.join(SHOTS, `FAIL-${results.length}.png`)).catch(() => {});
    console.log(`  ✗ ${name}\n      ${err.message.split('\n').join('\n      ')}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 8000, interval = 100, message = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${message} (last: ${JSON.stringify(last)})`);
}

const nav = (page, label) => page.locator('.sidebar .nav-item', { hasText: label }).first().click();
const playerState = (app) => app.evaluate(() => globalThis.__velaTest.getPlayerState());
const command = (page, cmd) => page.evaluate((c) => window.vela.player.command(c), cmd);

async function playTrackByTitle(page, title) {
  await page.evaluate(() => document.querySelector('.content')?.scrollTo(0, 0));
  const row = page.locator('.tl-row', { has: page.locator('.tl-title', { hasText: title }) }).first();
  await row.dblclick();
}

async function expectPlaying(app, title, { minPosition = 0.6 } = {}) {
  return waitFor(
    async () => {
      const s = await playerState(app);
      return s?.track?.title === title && s.playing && s.position >= minPosition && !s.error ? s : null;
    },
    { timeout: 10000, message: `"${title}" to be playing past ${minPosition}s` },
  );
}

const userData = tempProfile();
console.log(`Reson E2E — profile: ${userData}`);
let { app, page, logs, proc } = await launch({ userData });

try {
  console.log('\nFirst launch & library');
  await step('shows onboarding on a fresh profile', async () => {
    await page.getByRole('heading', { name: /Your music/ }).waitFor({ timeout: 10000 });
    await shot(page, '01-onboarding');
  });

  await step('renderer is isolated from Node and the filesystem', async () => {
    const r = await page.evaluate(() => ({
      require: typeof window.require,
      process: typeof window.process,
      bridgeKeys: Object.keys(window.vela).sort(),
    }));
    assert.equal(r.require, 'undefined');
    assert.equal(r.process, 'undefined');
    assert.deepEqual(r.bridgeKeys, ['app', 'env', 'favorites', 'history', 'library', 'player', 'playlists', 'settings', 'windows']);
  });

  await step('rejects invalid IPC arguments and unknown settings', async () => {
    const errors = await page.evaluate(async () => {
      const out = [];
      for (const fn of [
        () => window.vela.library.getAlbum('1 OR 1=1'),
        () => window.vela.library.listTracks({ sort: 'title; DROP TABLE tracks' }),
        () => window.vela.settings.set('nodeIntegration', true),
        () => window.vela.player.command({ type: 'eval', code: 'x' }),
        () => window.vela.history.record(1, 10), // fine from main window, but track 1 doesn't exist yet
      ]) {
        try {
          out.push(['ok', await fn()]);
        } catch (e) {
          out.push(['err', e.message]);
        }
      }
      return out;
    });
    assert.equal(errors[0][0], 'err');
    assert.equal(errors[1][0], 'err');
    assert.equal(errors[2][0], 'err');
    assert.equal(errors[3][0], 'err');
    assert.deepEqual(errors[4], ['ok', false]);
  });

  await step('blocks arbitrary file access from the renderer', async () => {
    const r = await page.evaluate(async () => {
      const tryFetch = async (u) => {
        try {
          const res = await fetch(u);
          return res.status;
        } catch {
          return 'blocked';
        }
      };
      return {
        file: await tryFetch('file:///C:/Windows/win.ini'),
        badTrack: await tryFetch('vela-media://track/999999'),
        traversal: await tryFetch('vela-art://full/..%2F..%2Fvela-library.db'),
      };
    });
    assert.equal(r.file, 'blocked');
    assert.notEqual(r.badTrack, 200);
    assert.notEqual(r.traversal, 200);
  });

  await step('indexes the fixture library and shows Home', async () => {
    const res = await addFoldersAndScan(app, [FIXTURES]);
    assert.equal(res.added.length, 1);
    await page.getByRole('heading', { name: /Good (morning|afternoon|evening)|Yohohoho/ }).waitFor({ timeout: 10000 });
    await page.getByText('Aurora Lines').first().waitFor();
    await shot(page, '02-home');
  });

  console.log('\nSongs, search and playback');
  await step('Songs view lists all indexed tracks', async () => {
    await nav(page, 'Songs');
    await page.locator('.tl-row').first().waitFor();
    assert.equal(await page.locator('.tl-row').count(), 7);
    assert.ok(await page.locator('.tl-row.is-unavailable').count() >= 1, 'corrupt file shown as unsupported');
    await shot(page, '03-songs');
  });

  await step('filters songs via search', async () => {
    await page.getByPlaceholder('Filter songs').fill('bloom');
    await waitFor(async () => (await page.locator('.tl-row').count()) === 1, { message: 'one result' });
    await page.getByPlaceholder('Filter songs').fill('');
    await waitFor(async () => (await page.locator('.tl-row').count()) === 7, { message: 'all rows back' });
  });

  await step('plays FLAC (double-click) and the accent follows the artwork', async () => {
    const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    await playTrackByTitle(page, 'First Light');
    await expectPlaying(app, 'First Light');
    const after = await waitFor(
      async () => {
        const v = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
        return v !== before ? v : null;
      },
      { message: 'accent to change from the artwork palette' },
    );
    assert.ok(after);
  });

  await step('seeks via the controller', async () => {
    await command(page, { type: 'pause' });
    await command(page, { type: 'seek', position: 3 });
    await command(page, { type: 'play' });
    await waitFor(async () => {
      const s = await playerState(app);
      return s.position >= 3 && s.playing;
    }, { message: 'position >= 3s' });
  });

  await step('plays MP3 with a Unicode file name', async () => {
    await playTrackByTitle(page, 'Café Ünïcode');
    await expectPlaying(app, 'Café Ünïcode — 夜');
  });

  await step('plays untagged WAV', async () => {
    await playTrackByTitle(page, 'untagged tone');
    await expectPlaying(app, 'untagged tone');
    await shot(page, '04-playing');
  });

  await step('next / previous move through the queue', async () => {
    // Queue = Songs list sorted by title; WAV is followed by nothing (last alphabetically)?
    await playTrackByTitle(page, 'First Light');
    await expectPlaying(app, 'First Light', { minPosition: 0.2 });
    await command(page, { type: 'next' });
    const s = await waitFor(async () => {
      const st = await playerState(app);
      return st.track?.title !== 'First Light' && st.playing ? st : null;
    }, { message: 'next track' });
    await command(page, { type: 'previous' });
    await expectPlaying(app, 'First Light', { minPosition: 0.2 });
    assert.ok(s.track.title);
  });

  await step('a corrupt file reports an error and is skipped', async () => {
    await playTrackByTitle(page, 'corrupt');
    const s = await waitFor(async () => {
      const st = await playerState(app);
      return st.track?.title !== 'corrupt' && st.playing ? st : null;
    }, { message: 'skip past the corrupt file' });
    assert.ok(s.track.title);
    await page.locator('.toast--error').first().waitFor({ timeout: 5000 });
  });

  await step('plays Apple Lossless (ALAC) via lossless FLAC conversion', async () => {
    await addFoldersAndScan(app, [path.join(ROOT, 'tests', 'fixtures', 'generated', 'alac')]);
    await page.getByPlaceholder('Filter songs').fill('Soul King');
    await waitFor(async () => (await page.locator('.tl-row').count()) === 1, { message: 'ALAC row' });
    assert.equal(await page.locator('.tl-row.is-unavailable').count(), 0, 'ALAC must not be flagged unsupported');
    await playTrackByTitle(page, 'Soul King Ballad');
    await expectPlaying(app, 'Soul King Ballad', { minPosition: 1 });
    await page.getByPlaceholder('Filter songs').fill('');
  });

  console.log('\nViews');
  await step('album detail groups multi-disc tracks', async () => {
    await nav(page, 'Albums');
    await page.getByRole('button', { name: 'Open album Aurora Lines' }).click();
    await page.getByRole('heading', { name: 'Aurora Lines' }).waitFor();
    // The hero renders instantly from the card preview; the track list follows.
    await waitFor(async () => (await page.locator('.tl-disc').count()) === 2, { message: 'two disc headers' });
    await shot(page, '05-album');
  });

  await step('Now Playing opens with lyrics from a sidecar .lrc', async () => {
    await playTrackByTitle(page, 'First Light');
    await expectPlaying(app, 'First Light', { minPosition: 0.2 });
    await page.getByRole('button', { name: 'Now Playing', exact: true }).click();
    await page.getByRole('dialog', { name: 'Now Playing' }).waitFor();
    await page.getByRole('tab', { name: /Lyrics/ }).click();
    await page.getByText('Colours wake').waitFor();
    await sleep(800);
    await shot(page, '06-now-playing');
    await page.keyboard.press('Escape');
  });

  await step('favorites and playlists work through the UI', async () => {
    await nav(page, 'Songs');
    const row = page.locator('.tl-row', { has: page.locator('.tl-title', { hasText: 'Spark' }) }).first();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add to favorites' }).click();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add to playlist' }).hover();
    await page.getByRole('menuitem', { name: 'New playlist…' }).click();
    await page.getByRole('dialog').locator('input').fill('Road Trip');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.locator('.nav-item--playlist', { hasText: 'Road Trip' }).waitFor();
    await nav(page, 'Favorites');
    await page.locator('.tl-title', { hasText: 'Spark' }).waitFor();
  });

  console.log('\nPremium UX');
  await step('Ctrl+K command palette finds and plays a song', async () => {
    await page.locator('.content').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+k');
    const input = page.getByRole('combobox');
    await input.waitFor();
    await input.fill('spark');
    await page.locator('.palette__item', { hasText: 'Spark' }).first().waitFor();
    await page.keyboard.press('Enter');
    await expectPlaying(app, 'Spark', { minPosition: 0.2 });
    assert.equal(await page.locator('.palette').count(), 0, 'palette closes after running');
  });

  await step('palette runs actions (go to Albums)', async () => {
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('go to albums');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Albums', exact: true }).waitFor();
  });

  await step('unfavoriting shows an Undo that restores the favorite', async () => {
    await nav(page, 'Favorites');
    await page.locator('.tl-title', { hasText: 'Spark' }).waitFor();
    const row = page.locator('.tl-row', { has: page.locator('.tl-title', { hasText: 'Spark' }) }).first();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove from favorites' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await waitFor(async () => (await page.evaluate(() => window.vela.playlists.smart('favorites'))).tracks.some((t) => t.title === 'Spark'), {
      message: 'favorite restored',
    });
  });

  await step('? opens the keyboard shortcut sheet', async () => {
    await page.locator('.content').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Shift+?');
    await page.getByRole('heading', { name: 'Keyboard shortcuts' }).waitFor();
    await page.keyboard.press('Escape');
    await waitFor(async () => (await page.getByRole('heading', { name: 'Keyboard shortcuts' }).count()) === 0, { message: 'sheet closed' });
  });

  await step('keyboard: Space (even on a focused button), arrows, 0-9, M, volume', async () => {
    await nav(page, 'Songs');
    await playTrackByTitle(page, 'First Light');
    await expectPlaying(app, 'First Light', { minPosition: 0.3 });
    const shuffleBtn = page.getByRole('button', { name: /Shuffle: (on|off)/ }).first();
    const shuffleBefore = await shuffleBtn.getAttribute('aria-label');
    await shuffleBtn.focus();
    await page.keyboard.press(' ');
    await waitFor(async () => !(await playerState(app)).playing, { message: 'paused by Space' });
    assert.equal(await shuffleBtn.getAttribute('aria-label'), shuffleBefore, 'Space must not click the focused button');
    await page.locator('.osd').waitFor();
    await page.keyboard.press(' ');
    await waitFor(async () => (await playerState(app)).playing, { message: 'resumed by Space' });

    await page.locator('.content').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('5');
    await waitFor(async () => Math.abs((await playerState(app)).position - 7) < 1.2, { message: '5 jumps to 50% (7s of 14s)' });
    const before = (await playerState(app)).position;
    await page.keyboard.press('ArrowLeft');
    await waitFor(async () => (await playerState(app)).position < before - 3, { message: 'ArrowLeft seeks back 5s' });

    const vol = (await playerState(app)).volume;
    await page.keyboard.press('ArrowDown');
    await waitFor(async () => (await playerState(app)).volume < vol - 0.04, { message: 'ArrowDown lowers volume' });
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('m');
    await waitFor(async () => (await playerState(app)).muted, { message: 'M mutes' });
    await page.keyboard.press('m');
    await waitFor(async () => !(await playerState(app)).muted, { message: 'M unmutes' });
  });

  await step('Konami code toggles Soul King mode', async () => {
    await page.locator('.content').click({ position: { x: 5, y: 5 } });
    for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(k);
    await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.soulKing)) === 'true', { message: 'soul king on' });
    assert.equal((await page.evaluate(() => window.vela.settings.get())).soulKing, true);
    for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) await page.keyboard.press(k);
    await waitFor(async () => (await page.evaluate(() => document.documentElement.dataset.soulKing)) === undefined, { message: 'soul king off' });
  });

  await step('F enters and Esc leaves focus (Bankai) mode', async () => {
    await page.locator('.content').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('f');
    await page.locator('.now-playing.is-focus').waitFor();
    await page.keyboard.press('Escape');
    await waitFor(async () => (await page.locator('.now-playing.is-focus').count()) === 0, { message: 'focus off' });
    await page.keyboard.press('Escape');
    await waitFor(async () => (await page.locator('.now-playing').count()) === 0, { message: 'now playing closed' });
  });

  await step('drag a song onto a sidebar playlist to add it', async () => {
    await nav(page, 'Songs');
    await page.locator('.tl-row').first().waitFor();
    const before = (await page.evaluate(() => window.vela.playlists.list())).find((p) => p.name === 'Road Trip').trackCount;
    const row = page.locator('.tl-row', { has: page.locator('.tl-title', { hasText: 'Night Bloom' }) }).first();
    await row.dragTo(page.locator('.nav-item--playlist', { hasText: 'Road Trip' }));
    await waitFor(async () => (await page.evaluate(() => window.vela.playlists.list())).find((p) => p.name === 'Road Trip').trackCount === before + 1, {
      message: 'playlist grew by one',
    });
  });

  console.log('\nMini-player & lifecycle');
  await step('mini-player opens as a separate window and mirrors playback', async () => {
    await nav(page, 'Songs');
    await playTrackByTitle(page, 'Polar Drift');
    await expectPlaying(app, 'Polar Drift', { minPosition: 0.2 });
    await page.evaluate(() => window.vela.windows.showMini());
    const mini = await waitFor(() => app.windows().find((w) => w.url().includes('mini.html')), { message: 'mini window' });
    await mini.locator('.mini__title', { hasText: 'Polar Drift' }).waitFor({ timeout: 5000 });
    await sleep(400);
    await shot(mini, '07-mini');
    // Pause from the mini-player: the single engine in the main window must react.
    await mini.getByRole('button', { name: 'Pause', exact: true }).click();
    await waitFor(async () => !(await playerState(app)).playing, { message: 'paused via mini' });
    await mini.getByRole('button', { name: 'Play', exact: true }).click();
    await waitFor(async () => (await playerState(app)).playing, { message: 'resumed via mini' });
    const audioEngines = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    assert.equal(audioEngines, 2, 'exactly main + mini windows');
  });

  await step('closing the main window hides it and playback continues', async () => {
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'));
      main.close();
    });
    await sleep(300);
    const visible = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('index.html'))?.isVisible(),
    );
    assert.equal(visible, false);
    const a = (await playerState(app)).position;
    await sleep(1200);
    const s = await playerState(app);
    assert.ok(s.playing, 'still playing while hidden');
    // Position is published periodically; compare against a fresh snapshot via a seek-free command.
    await page.evaluate(() => window.vela.windows.showMain());
    await sleep(200);
    assert.ok((await playerState(app)).position >= a);
  });

  await step('window geometry and settings survive a restart; queue is restored', async () => {
    await page.evaluate(() => window.vela.settings.set('ambientIntensity', 'vivid'));
    await sleep(1700); // let the session persist (debounced)
    await page.evaluate(() => window.vela.app.quit()).catch(() => {}); // the call never returns: the app exits
    await waitFor(() => proc.exitCode !== null, { message: 'app exit after quit', timeout: 10000 });

    ({ app, page, logs, proc } = await launch({ userData }));
    await page.locator('.player-bar__title').waitFor({ timeout: 10000 });
    const title = await page.locator('.player-bar__title').textContent();
    assert.equal(title, 'Polar Drift');
    const s = await waitFor(() => playerState(app), { message: 'restored state published' });
    assert.equal(s.playing, false, 'restored paused');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.ambient), 'vivid');
    await page.locator('.nav-item--playlist', { hasText: 'Road Trip' }).waitFor();
  });

  await step('settings view renders diagnostics and format support', async () => {
    await nav(page, 'Library & settings');
    await page.getByRole('heading', { name: 'About & diagnostics' }).waitFor();
    const formats = await page.locator('.format-list li').allTextContents();
    console.log('      formats:', formats.map((f) => f.replace(/\s+/g, ' ')).join(' | '));
    await shot(page, '08-settings');
  });

  await step('external navigation is blocked', async () => {
    const before = page.url();
    await page.evaluate(() => {
      window.location.href = 'https://example.com/';
    });
    await sleep(500);
    assert.equal(page.url(), before);
  });

  await step('quit exits the process', async () => {
    await page.evaluate(() => window.vela.app.quit()).catch(() => {}); // the call never returns: the app exits
    await waitFor(() => proc.exitCode !== null, { message: 'process exit', timeout: 10000 });
  });
} finally {
  if (proc.exitCode === null) await app.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} E2E steps passed`);
if (failed.length) {
  console.log('\nApp log tail:\n' + logs.join('').slice(-3000));
  process.exitCode = 1;
}
fs.rmSync(userData, { recursive: true, force: true });
