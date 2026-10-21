// Argument validation for every IPC entry point. The renderer is treated as untrusted:
// anything that does not match the expected shape is rejected before touching the DB or filesystem.

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const fail = (msg) => {
  throw new ValidationError(msg);
};

export function id(value, name = 'id') {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${name} must be a positive integer`);
  return value;
}

export function idList(value, { max = 100000, name = 'ids', min = 0 } = {}) {
  if (!Array.isArray(value)) fail(`${name} must be an array`);
  if (value.length > max) fail(`${name} has too many items`);
  if (value.length < min) fail(`${name} must contain at least ${min} item(s)`);
  return value.map((v) => id(v, name));
}

export function string(value, { max = 1000, min = 0, name = 'value', trim = true } = {}) {
  if (typeof value !== 'string') fail(`${name} must be a string`);
  const s = trim ? value.trim() : value;
  if (s.length < min) fail(`${name} is too short`);
  if (s.length > max) fail(`${name} is too long`);
  return s;
}

export function optionalString(value, opts) {
  return value == null ? '' : string(value, opts);
}

export function oneOf(value, allowed, name = 'value') {
  if (!allowed.includes(value)) fail(`${name} must be one of: ${allowed.join(', ')}`);
  return value;
}

export function bool(value, name = 'value') {
  if (typeof value !== 'boolean') fail(`${name} must be a boolean`);
  return value;
}

export function number(value, { min = -Infinity, max = Infinity, name = 'value' } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${name} must be a number between ${min} and ${max}`);
  }
  return value;
}

export function plainObject(value, name = 'options') {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

export function trackQuery(value) {
  const o = plainObject(value);
  return {
    search: optionalString(o.search, { max: 200, name: 'search' }),
    sort: o.sort == null ? 'title' : oneOf(o.sort, ['title', 'artist', 'album', 'duration', 'dateAdded', 'year'], 'sort'),
    dir: o.dir == null ? 'asc' : oneOf(o.dir, ['asc', 'desc'], 'dir'),
    includeUnavailable: o.includeUnavailable == null ? true : bool(o.includeUnavailable, 'includeUnavailable'),
  };
}

export function albumQuery(value) {
  const o = plainObject(value);
  return {
    search: optionalString(o.search, { max: 200, name: 'search' }),
    sort: o.sort == null ? 'title' : oneOf(o.sort, ['title', 'artist', 'year', 'dateAdded'], 'sort'),
  };
}

export function playlistName(value) {
  return string(value, { min: 1, max: 120, name: 'Playlist name' });
}

export const SMART_KEYS = ['favorites', 'recentlyPlayed', 'recentlyAdded', 'mostPlayed'];

// ---------- Settings ----------

const hexColor = (v, name) => {
  if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) fail(`${name} must be a hex color`);
  return v.toLowerCase();
};

/** Every persisted setting, its default, and its validator. Unknown keys are rejected. */
export const SETTINGS_SCHEMA = {
  dynamicAccent: { default: true, validate: (v, k) => bool(v, k) },
  accentColor: { default: '#ecebe6', validate: hexColor },
  ambientIntensity: { default: 'subtle', validate: (v, k) => oneOf(v, ['off', 'subtle', 'vivid'], k) },
  reduceTransparency: { default: false, validate: (v, k) => bool(v, k) },
  reducedMotion: { default: 'system', validate: (v, k) => oneOf(v, ['system', 'on', 'off'], k) },
  volume: { default: 0.8, validate: (v, k) => number(v, { min: 0, max: 1, name: k }) },
  muted: { default: false, validate: (v, k) => bool(v, k) },
  shuffle: { default: false, validate: (v, k) => bool(v, k) },
  repeat: { default: 'off', validate: (v, k) => oneOf(v, ['off', 'all', 'one'], k) },
  outputDeviceId: { default: 'default', validate: (v, k) => string(v, { max: 300, name: k }) },
  playbackRate: { default: 1, validate: (v, k) => number(v, { min: 0.5, max: 2, name: k }) },
  doubleClickBehavior: { default: 'playContext', validate: (v, k) => oneOf(v, ['playContext', 'playSingle', 'enqueue'], k) },
  resumeOnLaunch: { default: true, validate: (v, k) => bool(v, k) },
  missingTrackBehavior: { default: 'skip', validate: (v, k) => oneOf(v, ['skip', 'stop'], k) },
  showUnavailable: { default: true, validate: (v, k) => bool(v, k) },
  closeToTray: { default: true, validate: (v, k) => bool(v, k) },
  miniAlwaysOnTop: { default: true, validate: (v, k) => bool(v, k) },
  watchFolders: { default: true, validate: (v, k) => bool(v, k) },
  onboardingDismissed: { default: false, validate: (v, k) => bool(v, k) },
  sidebarCollapsed: { default: false, validate: (v, k) => bool(v, k) },
  // Hidden theme, unlocked with the Konami code. Yohohoho.
  soulKing: { default: false, validate: (v, k) => bool(v, k) },
  soulKingUnlocked: { default: false, validate: (v, k) => bool(v, k) },
  songsSort: {
    default: { sort: 'title', dir: 'asc' },
    validate: (v) => {
      const o = plainObject(v, 'songsSort');
      return {
        sort: oneOf(o.sort, ['title', 'artist', 'album', 'duration', 'dateAdded', 'year'], 'sort'),
        dir: oneOf(o.dir, ['asc', 'desc'], 'dir'),
      };
    },
  },
  albumsSort: { default: 'title', validate: (v, k) => oneOf(v, ['title', 'artist', 'year', 'dateAdded'], k) },
  // Persisted queue: written by the playback controller, restored on launch.
  playbackSession: {
    default: null,
    validate: (v) => {
      if (v === null) return null;
      const o = plainObject(v, 'playbackSession');
      return {
        trackIds: idList(o.trackIds, { max: 20000, name: 'trackIds' }),
        originalTrackIds: o.originalTrackIds == null ? null : idList(o.originalTrackIds, { max: 20000, name: 'originalTrackIds' }),
        index: Number.isSafeInteger(o.index) && o.index >= -1 ? o.index : -1,
        position: number(o.position ?? 0, { min: 0, max: 1e7, name: 'position' }),
      };
    },
  },
};

export function settingKey(key) {
  if (typeof key !== 'string' || !Object.hasOwn(SETTINGS_SCHEMA, key)) fail('Unknown setting');
  return key;
}

export function settingValue(key, value) {
  return SETTINGS_SCHEMA[settingKey(key)].validate(value, key);
}

export function settingsWithDefaults(stored) {
  const out = {};
  for (const [key, def] of Object.entries(SETTINGS_SCHEMA)) {
    let value = def.default;
    if (Object.hasOwn(stored, key)) {
      try {
        value = def.validate(stored[key], key);
      } catch {
        value = def.default;
      }
    }
    out[key] = value;
  }
  return out;
}

// ---------- Player commands (mini-player / tray -> playback controller) ----------

const PLAYER_COMMANDS = ['toggle', 'play', 'pause', 'next', 'previous', 'seek', 'setVolume', 'toggleShuffle', 'cycleRepeat', 'toggleFavorite'];

export function playerCommand(value) {
  const o = plainObject(value, 'command');
  const type = oneOf(o.type, PLAYER_COMMANDS, 'command type');
  if (type === 'seek') return { type, position: number(o.position, { min: 0, max: 1e7, name: 'position' }) };
  if (type === 'setVolume') return { type, volume: number(o.volume, { min: 0, max: 1, name: 'volume' }) };
  return { type };
}

/** Snapshot published by the playback controller; bounded so a broken renderer can't flood memory. */
export function playerState(value) {
  const o = plainObject(value, 'state');
  const json = JSON.stringify(o);
  if (json.length > 20000) fail('state too large');
  return JSON.parse(json);
}
