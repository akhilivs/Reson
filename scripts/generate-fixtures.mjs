// Generates a small but realistic music library for tests: real FLAC, MP3 and WAV files with
// tags, embedded artwork, multi-disc albums, Unicode names, a sidecar LRC and a corrupt file.
// Usage: node scripts/generate-fixtures.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mp3Encoder } from '@breezystack/lamejs';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { encodePng, render } from './png.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] ?? path.join(root, 'tests', 'fixtures', 'generated', 'library'));
const RATE = 44100;

// ---------- audio synthesis ----------
function tone(seconds, freqs, rate = RATE) {
  const n = Math.round(seconds * rate);
  const left = new Int16Array(n);
  const right = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t * 8, (seconds - t) * 8);
    let s = 0;
    freqs.forEach((f, k) => (s += Math.sin(2 * Math.PI * f * t) / (k + 1.5)));
    left[i] = Math.round(s * 9000 * env);
    right[i] = Math.round(s * 8000 * env);
  }
  return { left, right, rate };
}

// ---------- WAV ----------
function wav({ left, right, rate }) {
  const n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(left[i], 44 + i * 4);
    buf.writeInt16LE(right[i], 46 + i * 4);
  }
  return buf;
}

// ---------- FLAC (verbatim subframes; valid, uncompressed) ----------
function crc8(bytes) {
  let c = 0;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
}
function crc16(bytes) {
  let c = 0;
  for (const b of bytes) {
    c ^= b << 8;
    for (let i = 0; i < 8; i++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}
function utf8Num(n) {
  if (n < 0x80) return [n];
  if (n < 0x800) return [0xc0 | (n >> 6), 0x80 | (n & 0x3f)];
  if (n < 0x10000) return [0xe0 | (n >> 12), 0x80 | ((n >> 6) & 0x3f), 0x80 | (n & 0x3f)];
  return [0xf0 | (n >> 18), 0x80 | ((n >> 12) & 0x3f), 0x80 | ((n >> 6) & 0x3f), 0x80 | (n & 0x3f)];
}
function metaBlock(type, data, last) {
  const h = Buffer.alloc(4);
  h[0] = (last ? 0x80 : 0) | type;
  h.writeUIntBE(data.length, 1, 3);
  return Buffer.concat([h, data]);
}
function flac({ left, right, rate }, tags, picture) {
  const BLOCK = 4096;
  const total = left.length;
  const si = Buffer.alloc(34);
  si.writeUInt16BE(BLOCK, 0);
  si.writeUInt16BE(BLOCK, 2);
  // sample rate (20) | channels-1 (3) | bps-1 (5) | total samples (36)
  const big = (BigInt(rate) << 44n) | (1n << 41n) | (15n << 36n) | BigInt(total);
  si.writeBigUInt64BE(big, 10);
  const vendor = Buffer.from('Brook fixture');
  const comments = Object.entries(tags).map(([k, v]) => Buffer.from(`${k}=${v}`, 'utf8'));
  const vc = Buffer.alloc(8 + vendor.length + comments.reduce((s, c) => s + 4 + c.length, 0));
  let o = 0;
  vc.writeUInt32LE(vendor.length, o); o += 4;
  vendor.copy(vc, o); o += vendor.length;
  vc.writeUInt32LE(comments.length, o); o += 4;
  for (const c of comments) { vc.writeUInt32LE(c.length, o); o += 4; c.copy(vc, o); o += c.length; }
  const blocks = [metaBlock(0, si, false), metaBlock(4, vc, !picture)];
  if (picture) {
    const mime = Buffer.from('image/png');
    const p = Buffer.alloc(32 + mime.length + picture.data.length);
    let q = 0;
    p.writeUInt32BE(3, q); q += 4;
    p.writeUInt32BE(mime.length, q); q += 4;
    mime.copy(p, q); q += mime.length;
    p.writeUInt32BE(0, q); q += 4;
    p.writeUInt32BE(picture.size, q); q += 4;
    p.writeUInt32BE(picture.size, q); q += 4;
    p.writeUInt32BE(32, q); q += 4;
    p.writeUInt32BE(0, q); q += 4;
    p.writeUInt32BE(picture.data.length, q); q += 4;
    picture.data.copy(p, q);
    blocks.push(metaBlock(6, p, true));
  }
  const frames = [];
  for (let start = 0, num = 0; start < total; start += BLOCK, num++) {
    const size = Math.min(BLOCK, total - start);
    const rateCode = rate === 44100 ? 0x9 : 0xa; // 44.1k / 48k
    // Block-size code 0111: (blocksize-1) follows as a 16-bit value.
    const header = [0xff, 0xf8, (0x7 << 4) | rateCode, (0x1 << 4) | (0x4 << 1), ...utf8Num(num), (size - 1) >> 8, (size - 1) & 0xff];
    header.push(crc8(header));
    const body = Buffer.alloc(2 + size * 4);
    let b = 0;
    for (const ch of [left, right]) {
      body[b++] = 0x02; // verbatim subframe
      for (let i = 0; i < size; i++) { body.writeInt16BE(ch[start + i], b); b += 2; }
    }
    const frame = Buffer.concat([Buffer.from(header), body]);
    const crc = Buffer.alloc(2);
    crc.writeUInt16BE(crc16(frame));
    frames.push(frame, crc);
  }
  return Buffer.concat([Buffer.from('fLaC'), ...blocks, ...frames]);
}

// ---------- MP3 with ID3v2.3 ----------
function syncsafe(n) {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}
function id3Frame(id, data) {
  const h = Buffer.alloc(10);
  h.write(id, 0, 'ascii');
  h.writeUInt32BE(data.length, 4);
  return Buffer.concat([h, data]);
}
function textFrame(id, text) {
  const utf16 = Buffer.from('﻿' + text, 'utf16le');
  return id3Frame(id, Buffer.concat([Buffer.from([1]), utf16]));
}
function id3(tags, picture) {
  const frames = [];
  const map = { title: 'TIT2', artist: 'TPE1', album: 'TALB', albumartist: 'TPE2', track: 'TRCK', disc: 'TPOS', year: 'TYER', genre: 'TCON' };
  for (const [k, v] of Object.entries(tags)) if (map[k]) frames.push(textFrame(map[k], String(v)));
  if (picture) {
    frames.push(id3Frame('APIC', Buffer.concat([Buffer.from([0]), Buffer.from('image/png\0', 'latin1'), Buffer.from([3, 0]), picture.data])));
  }
  const body = Buffer.concat(frames);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), syncsafe(body.length), body]);
}
function mp3(pcm, tags, picture) {
  const enc = new Mp3Encoder(2, pcm.rate, 160);
  const parts = [];
  for (let i = 0; i < pcm.left.length; i += 1152) {
    const out = enc.encodeBuffer(pcm.left.subarray(i, i + 1152), pcm.right.subarray(i, i + 1152));
    if (out.length) parts.push(Buffer.from(out));
  }
  parts.push(Buffer.from(enc.flush()));
  return Buffer.concat([id3(tags, picture), ...parts]);
}

// ---------- artwork ----------
function artwork(c1, c2, size = 300) {
  const px = render(size, (x, y) => {
    const t = (x + y) / 2;
    const ring = Math.abs(Math.hypot(x - 0.5, y - 0.5) - 0.28) < 0.04 ? 1 : 0;
    const c = c1.map((v, i) => v + (c2[i] - v) * t);
    return ring ? [1, 1, 1, 1] : [...c, 1];
  }, 1);
  return { data: encodePng(size, size, px), size };
}

// ---------- library layout ----------
fs.rmSync(OUT, { recursive: true, force: true });
const write = (rel, data) => {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, data);
};

const aurora = artwork([0.42, 0.25, 0.85], [0.1, 0.65, 0.7]);
const ember = artwork([0.95, 0.45, 0.15], [0.55, 0.08, 0.12]);
const grey = artwork([0.5, 0.5, 0.5], [0.2, 0.2, 0.2]);

const A = { artist: 'Nova Atlas', albumartist: 'Nova Atlas', album: 'Aurora Lines', date: '2024', genre: 'Ambient' };
write('Nova Atlas/Aurora Lines/1-01 First Light.flac',
  flac(tone(14, [220, 330]), { ...A, title: 'First Light', tracknumber: '1', tracktotal: '2', discnumber: '1', disctotal: '2' }, aurora));
write('Nova Atlas/Aurora Lines/1-02 Polar Drift.flac',
  flac(tone(12, [247, 370]), { ...A, title: 'Polar Drift', tracknumber: '2', tracktotal: '2', discnumber: '1', disctotal: '2' }, aurora));
write('Nova Atlas/Aurora Lines/2-01 Night Bloom.flac',
  flac(tone(10, [196, 294]), { ...A, title: 'Night Bloom', tracknumber: '1', discnumber: '2', disctotal: '2' }, aurora));
write('Nova Atlas/Aurora Lines/1-01 First Light.lrc',
  '[ar:Nova Atlas]\n[ti:First Light]\n[00:00.50]Morning arrives\n[00:02.00]Colours wake\n[00:03.20]Light again\n');

const E = { artist: 'Kiln', albumartist: 'Kiln', album: 'Ember', year: '2019', genre: 'Electronic' };
write('Kiln - Ember/01 Spark.mp3', mp3(tone(16, [262, 392]), { ...E, title: 'Spark', track: '1/2' }, ember));
write('Kiln - Ember/02 Café Ünïcode 夜.mp3', mp3(tone(12, [294, 440]), { ...E, title: 'Café Ünïcode — 夜', track: '2/2' }, ember));

// Untagged files rely on file name + folder artwork.
write('Loose/07 - untagged_tone.wav', wav(tone(10, [330])));
write('Loose/cover.png', grey.data);

// Corrupt file: valid extension, garbage content.
write('Broken/corrupt.mp3', Buffer.from('this is not really an mp3 file '.repeat(40)));

// ALAC (Apple Lossless) in M4A, encoded with the bundled ffmpeg. Kept in a sibling folder so the
// main fixture library stays stable; tests add it explicitly.
const ALAC_DIR = path.join(path.dirname(OUT), 'alac');
fs.rmSync(ALAC_DIR, { recursive: true, force: true });
fs.mkdirSync(ALAC_DIR, { recursive: true });
const wavTmp = path.join(ALAC_DIR, 'source.wav');
fs.writeFileSync(wavTmp, wav(tone(8, [277, 415])));
execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', wavTmp, '-c:a', 'alac',
  '-metadata', 'title=Soul King Ballad', '-metadata', 'artist=Brook', '-metadata', 'album=Lossless Tests',
  path.join(ALAC_DIR, '01 Soul King Ballad.m4a')]);
fs.rmSync(wavTmp);

console.log('Fixtures written to', OUT, 'and', ALAC_DIR);
