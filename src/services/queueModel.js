// Pure, immutable queue model. The playback controller owns one of these; every operation
// returns a new state so behaviour is easy to test and reason about.
//
// state = {
//   items:    [{ qid, id }]   play order (shuffled when shuffle is on)
//   original: [{ qid, id }] | null   unshuffled order, kept while shuffle is on
//   index:    number          current position in items, -1 when nothing is selected
//   shuffle:  boolean
//   repeat:   'off' | 'all' | 'one'
// }

let qidCounter = 0;
const makeItem = (id) => ({ qid: ++qidCounter, id });

export const REPEAT_MODES = ['off', 'all', 'one'];

export function createQueue(overrides = {}) {
  return { items: [], original: null, index: -1, shuffle: false, repeat: 'off', ...overrides };
}

export function shuffleArray(arr, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function currentItem(state) {
  return state.index >= 0 && state.index < state.items.length ? state.items[state.index] : null;
}

/** Replaces the queue. With shuffle on, the chosen start track plays first and the rest is shuffled. */
export function setQueue(state, trackIds, startIndex = 0, rng = Math.random) {
  const items = trackIds.map(makeItem);
  if (!items.length) return { ...state, items: [], original: null, index: -1 };
  const start = Math.min(Math.max(0, startIndex), items.length - 1);
  if (!state.shuffle) return { ...state, items, original: null, index: start };
  const first = items[start];
  const rest = shuffleArray(items.filter((_, i) => i !== start), rng);
  return { ...state, items: [first, ...rest], original: items, index: 0 };
}

/** Restores a persisted queue (keeps the stored order exactly). */
export function restoreQueue(state, trackIds, index, originalIds = null) {
  const items = trackIds.map(makeItem);
  let original = null;
  if (state.shuffle && originalIds) {
    // Re-link the original order to the same item objects (by first matching id).
    const pool = [...items];
    original = originalIds
      .map((id) => {
        const i = pool.findIndex((it) => it.id === id);
        return i >= 0 ? pool.splice(i, 1)[0] : null;
      })
      .filter(Boolean)
      .concat(pool);
  }
  return {
    ...state,
    items,
    original: state.shuffle ? original ?? [...items] : null,
    index: items.length ? Math.min(Math.max(-1, index), items.length - 1) : -1,
  };
}

export function enqueue(state, trackIds) {
  const added = trackIds.map(makeItem);
  return {
    ...state,
    items: [...state.items, ...added],
    original: state.original ? [...state.original, ...added] : null,
  };
}

/** Inserts tracks right after the current one. */
export function playNext(state, trackIds) {
  const added = trackIds.map(makeItem);
  const at = state.index + 1;
  const items = [...state.items.slice(0, at), ...added, ...state.items.slice(at)];
  let original = null;
  if (state.original) {
    const cur = currentItem(state);
    const oi = cur ? state.original.indexOf(cur) + 1 : state.original.length;
    original = [...state.original.slice(0, oi), ...added, ...state.original.slice(oi)];
  }
  return { ...state, items, original };
}

/**
 * Removes the items at the given positions. If the current item is removed, the index stays on
 * the item that slid into its place (or the new last item); currentRemoved tells the caller to reload.
 */
export function removeAt(state, positions) {
  const remove = new Set(positions.filter((p) => p >= 0 && p < state.items.length));
  if (!remove.size) return { state, currentRemoved: false };
  const removedItems = new Set([...remove].map((p) => state.items[p]));
  const items = state.items.filter((_, i) => !remove.has(i));
  const before = [...remove].filter((p) => p < state.index).length;
  const currentRemoved = remove.has(state.index);
  let index = state.index - before;
  if (!items.length) index = -1;
  else if (index >= items.length) index = items.length - 1;
  return {
    state: {
      ...state,
      items,
      original: state.original ? state.original.filter((it) => !removedItems.has(it)) : null,
      index,
    },
    currentRemoved,
  };
}

/** Moves the item at `from` to position `to` (positions in the play order). */
export function move(state, from, to) {
  const n = state.items.length;
  if (from === to || from < 0 || from >= n || to < 0 || to >= n) return state;
  const items = [...state.items];
  const [it] = items.splice(from, 1);
  items.splice(to, 0, it);
  const cur = currentItem(state);
  return { ...state, items, index: cur ? items.indexOf(cur) : state.index };
}

export function jumpTo(state, index) {
  if (index < 0 || index >= state.items.length) return state;
  return { ...state, index };
}

/**
 * Advances the queue.
 *  auto=true means the track ended naturally (repeat-one replays it).
 * Returns { state, ended } where ended=true means playback should stop.
 */
export function next(state, { auto = false } = {}) {
  const n = state.items.length;
  if (!n) return { state, ended: true };
  if (auto && state.repeat === 'one') return { state, ended: false, repeated: true };
  if (state.index + 1 < n) return { state: { ...state, index: state.index + 1 }, ended: false };
  if (state.repeat === 'all' || state.repeat === 'one') return { state: { ...state, index: 0 }, ended: false };
  return { state, ended: true };
}

export function previous(state) {
  const n = state.items.length;
  if (!n) return state;
  if (state.index > 0) return { ...state, index: state.index - 1 };
  if (state.repeat === 'all') return { ...state, index: n - 1 };
  return { ...state, index: 0 };
}

export function toggleShuffle(state, rng = Math.random) {
  const cur = currentItem(state);
  if (state.shuffle) {
    // Restore the original order, keeping the current track current.
    const items = state.original ?? state.items;
    return { ...state, shuffle: false, original: null, items, index: cur ? items.indexOf(cur) : state.index };
  }
  if (!state.items.length) return { ...state, shuffle: true, original: [] };
  const rest = shuffleArray(state.items.filter((it) => it !== cur), rng);
  const items = cur ? [cur, ...rest] : rest;
  return { ...state, shuffle: true, original: state.items, items, index: cur ? 0 : -1 };
}

export function cycleRepeat(state) {
  const i = REPEAT_MODES.indexOf(state.repeat);
  return { ...state, repeat: REPEAT_MODES[(i + 1) % REPEAT_MODES.length] };
}

/**
 * Finds the next playable position starting at `from` (inclusive), moving in `direction`.
 * Wraps around only when repeat is 'all'. Returns -1 when nothing playable remains.
 * Visits each position at most once, so a queue of unavailable tracks can't loop forever.
 */
export function findPlayable(state, from, isPlayable, direction = 1) {
  const n = state.items.length;
  if (!n) return -1;
  const wrap = state.repeat === 'all';
  let pos = from;
  for (let step = 0; step < n; step++) {
    if (pos < 0 || pos >= n) {
      if (!wrap) return -1;
      pos = (pos + n) % n;
    }
    if (isPlayable(state.items[pos].id)) return pos;
    pos += direction;
  }
  return -1;
}

export function trackIds(state) {
  return state.items.map((it) => it.id);
}
