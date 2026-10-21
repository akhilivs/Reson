# Reson

A desktop music player, forked from Brook.

*Your music lives on.* An offline-first Windows music player for the music on your own disks.

No account, no server, no internet. Reson reads the folders you choose, never modifies your files, and keeps the library, playlists and listening history in a local SQLite database.

## Run it

```bash
npm install
npm run dev        # Vite + Electron with hot reload
npm start          # production build, then launch
npm test           # unit + integration tests (Vitest)
npm run test:e2e   # end-to-end tests against the real Electron app (muted, no visible windows)
npm run pack       # unpacked Windows build in release/win-unpacked
npm run dist       # NSIS installer in release/
```

`npm run fixtures` regenerates the test library (real FLAC/MP3/WAV files with tags and artwork). `npm run brand` regenerates the app icon, tray icon and in-app logo from `build/brand/logo-source.webp`.

## Architecture

```
electron/                    main process (Node, filesystem, database)
  main.js                    lifecycle, single-instance lock, sessions/CSP, tray
  preload.cjs                narrow contextBridge API (window.vela), no Node exposure
  ipc/handlers.js            every IPC endpoint: sender check, validation, error mapping
  ipc/validators.js          argument + settings schemas
  windows/                   main + mini-player windows, geometry persistence
  services/
    database.js, migrations.js   node:sqlite (bundled with Electron), versioned migrations, FTS5
    libraryRepo.js               all SQL (parameterized, whitelisted sorts)
    libraryScanner.js            async, cancellable indexing; missing files kept; move detection
    fileWatcher.js               recursive fs.watch, debounced and batched
    metadataService.js           music-metadata + LRC lyrics
    artworkService.js, palette.js  artwork cache + deterministic accent extraction
    protocols.js                 app://, vela-media:// (Range streaming), vela-art://
src/                         renderer (React, plain CSS)
  services/playbackController.js   the single playback engine
  services/queueModel.js           pure, immutable queue logic
  app/ components/ features/ styles/
```

**One engine.** The `<audio>` element and queue live in the main window's renderer. Closing the main window hides it (it is never destroyed), so playback continues. The mini-player and tray are remote controls: they receive state snapshots and send commands through the main process and own no audio.

**No arbitrary file access.** The renderer only knows track IDs. Audio is streamed via `vela-media://track/<id>` and artwork via `vela-art://thumb|full/<sha1>`, both resolved through the database in the main process.

**Stable identity.** Tracks have a UUID and a content fingerprint (size plus the first and last 32 KB). A file that is moved or renamed inside the library keeps its playlists, favorites and history. Files that disappear, including on unplugged drives, are marked unavailable rather than deleted.

## Design

A "hi-fi editorial" language: warm graphite surfaces separated by hairlines; Instrument Serif for display, Geist for UI and Geist Mono for numbers and labels (all bundled, so it works offline). The neutral theme is monochrome. Colour comes only from the current album art, through the progress line, the playing marker and one soft ambient field, and is clamped to stay readable (WCAG contrast of at least 4.5 against the background). Glass is used only for floating layers. Reduced motion and reduced transparency are both supported.

## Formats

Playback uses Chromium's media engine (HTMLAudioElement) as shipped in Electron 44.

| Format | Status |
| --- | --- |
| MP3, FLAC, WAV (PCM) | Verified by E2E playback of real files |
| AAC/M4A, Ogg Vorbis, Opus | Engine reports supported (`canPlayType`); no fixture played yet |
| ALAC (Apple Lossless) in M4A | Chromium can't decode it, so Reson converts it to FLAC with the bundled ffmpeg on first play: lossless (verified bit-identical in tests) and cached (2 GB LRU cap). Originals are never modified |

Corrupt files are indexed with a clear "unsupported" state; if one is reached during playback, Reson shows an error and skips it (configurable).

**Bundled ffmpeg.** `ffmpeg-static` (GPL-3.0) is shipped unpacked from the asar and run with an argument array (no shell). It adds about 80 MB to the install. If Reson is ever distributed, account for the GPL.

## Deliberately not implemented

- **Gapless playback and crossfade.** A single HTMLAudioElement can't do these reliably across formats.
- **Equalizer.** Possible with Web Audio, but it changes the output path; deferred.
- **Online metadata, artist images, lyrics download.** Offline by design. Lyrics come from a sidecar `.lrc` or `.txt` file, or from embedded tags.

## Testing

- `tests/unit`: queue model, shuffle/repeat, playback controller (fake audio), palette, metadata normalization, IPC/settings validation, migrations, playlists, search, and the real scanner over generated audio (missing, moved, unreachable-drive and overlapping-folder cases).
- `tests/e2e/run-e2e.mjs`: launches the built app with an isolated profile. Covers playback per format, seeking, queue, corrupt-file handling, accent extraction, lyrics, favorites and playlists through the UI, mini-player sync, hide-to-tray lifecycle, restart persistence, quit, and the security boundaries (no Node in the renderer, file:// blocked, invalid IPC rejected, external navigation blocked).

E2E runs set `VELA_QUIET=1`: windows stay hidden, audio is muted and media-key integration is disabled.

**Not yet verified by automation:** hardware media keys and the Windows media overlay (SMTC) with real keys, tray menu clicks, the NSIS installer UI, and behaviour on very large libraries (10k+ tracks).

## License

[MIT](LICENSE) © 2026 Akhil IVS.

The bundled `ffmpeg` binary (via `ffmpeg-static`) is licensed separately under GPL-3.0; see the note under Formats.
