import { describe, it, expect } from 'vitest';
import * as Q from '../../src/services/queueModel.js';

const ids = (s) => Q.trackIds(s);
const cur = (s) => Q.currentItem(s)?.id ?? null;
// Deterministic RNG for shuffle tests.
const seeded = (seed = 42) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe('queue basics', () => {
  it('sets a queue and starts at the given index', () => {
    const s = Q.setQueue(Q.createQueue(), [1, 2, 3], 1);
    expect(ids(s)).toEqual([1, 2, 3]);
    expect(cur(s)).toBe(2);
  });

  it('empty queue has no current item', () => {
    const s = Q.setQueue(Q.createQueue(), [], 0);
    expect(s.index).toBe(-1);
    expect(Q.next(s).ended).toBe(true);
  });

  it('enqueue appends and playNext inserts after current', () => {
    let s = Q.setQueue(Q.createQueue(), [1, 2, 3], 0);
    s = Q.enqueue(s, [9]);
    s = Q.playNext(s, [7, 8]);
    expect(ids(s)).toEqual([1, 7, 8, 2, 3, 9]);
    expect(cur(s)).toBe(1);
  });

  it('allows the same track twice (distinct queue entries)', () => {
    const s = Q.enqueue(Q.setQueue(Q.createQueue(), [1], 0), [1]);
    expect(ids(s)).toEqual([1, 1]);
    expect(s.items[0].qid).not.toBe(s.items[1].qid);
  });
});

describe('next / previous / repeat', () => {
  it('advances and ends without repeat', () => {
    let s = Q.setQueue(Q.createQueue(), [1, 2], 0);
    let r = Q.next(s);
    expect(cur(r.state)).toBe(2);
    r = Q.next(r.state);
    expect(r.ended).toBe(true);
    expect(cur(r.state)).toBe(2);
  });

  it('wraps with repeat all', () => {
    const s = Q.setQueue(Q.createQueue({ repeat: 'all' }), [1, 2], 1);
    expect(cur(Q.next(s).state)).toBe(1);
    expect(cur(Q.previous(Q.jumpTo(s, 0)))).toBe(2);
  });

  it('repeat one replays only on natural end; manual next still advances', () => {
    const s = Q.setQueue(Q.createQueue({ repeat: 'one' }), [1, 2], 0);
    const auto = Q.next(s, { auto: true });
    expect(auto.repeated).toBe(true);
    expect(cur(auto.state)).toBe(1);
    expect(cur(Q.next(s).state)).toBe(2);
  });

  it('previous stays at start without repeat', () => {
    const s = Q.setQueue(Q.createQueue(), [1, 2], 0);
    expect(cur(Q.previous(s))).toBe(1);
  });

  it('cycles repeat modes off -> all -> one -> off', () => {
    let s = Q.createQueue();
    s = Q.cycleRepeat(s);
    expect(s.repeat).toBe('all');
    s = Q.cycleRepeat(s);
    expect(s.repeat).toBe('one');
    expect(Q.cycleRepeat(s).repeat).toBe('off');
  });
});

describe('shuffle', () => {
  it('keeps the current track first and contains every track', () => {
    let s = Q.setQueue(Q.createQueue(), [1, 2, 3, 4, 5, 6], 3);
    s = Q.toggleShuffle(s, seeded());
    expect(s.shuffle).toBe(true);
    expect(cur(s)).toBe(4);
    expect(s.index).toBe(0);
    expect([...ids(s)].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('restores original order when turned off and keeps the current track', () => {
    let s = Q.setQueue(Q.createQueue(), [1, 2, 3, 4, 5, 6], 0);
    s = Q.toggleShuffle(s, seeded(7));
    s = Q.next(s).state;
    const playing = cur(s);
    s = Q.toggleShuffle(s);
    expect(ids(s)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cur(s)).toBe(playing);
  });

  it('setQueue with shuffle on starts with the chosen track', () => {
    const s = Q.setQueue(Q.createQueue({ shuffle: true }), [10, 20, 30, 40], 2, seeded(3));
    expect(cur(s)).toBe(30);
    expect(s.original.map((i) => i.id)).toEqual([10, 20, 30, 40]);
  });

  it('enqueued tracks survive turning shuffle off', () => {
    let s = Q.toggleShuffle(Q.setQueue(Q.createQueue(), [1, 2, 3], 0), seeded());
    s = Q.enqueue(s, [4]);
    s = Q.toggleShuffle(s);
    expect(ids(s)).toEqual([1, 2, 3, 4]);
  });
});

describe('remove / move', () => {
  it('removing items before current keeps the same current track', () => {
    const s = Q.setQueue(Q.createQueue(), [1, 2, 3, 4], 2);
    const r = Q.removeAt(s, [0]);
    expect(cur(r.state)).toBe(3);
    expect(r.currentRemoved).toBe(false);
  });

  it('removing the current item flags it and points at the next item', () => {
    const s = Q.setQueue(Q.createQueue(), [1, 2, 3], 1);
    const r = Q.removeAt(s, [1]);
    expect(r.currentRemoved).toBe(true);
    expect(cur(r.state)).toBe(3);
  });

  it('removing the last current item clamps the index', () => {
    const r = Q.removeAt(Q.setQueue(Q.createQueue(), [1, 2], 1), [1]);
    expect(cur(r.state)).toBe(1);
    const empty = Q.removeAt(r.state, [0]);
    expect(empty.state.index).toBe(-1);
  });

  it('moving items keeps the current track', () => {
    let s = Q.setQueue(Q.createQueue(), [1, 2, 3, 4], 1);
    s = Q.move(s, 3, 0);
    expect(ids(s)).toEqual([4, 1, 2, 3]);
    expect(cur(s)).toBe(2);
    s = Q.move(s, 2, 3);
    expect(ids(s)).toEqual([4, 1, 3, 2]);
    expect(cur(s)).toBe(2);
  });

  it('ignores invalid moves', () => {
    const s = Q.setQueue(Q.createQueue(), [1, 2], 0);
    expect(Q.move(s, 0, 5)).toBe(s);
  });
});

describe('unavailable tracks', () => {
  const playable = (bad) => (id) => !bad.includes(id);

  it('skips unavailable tracks going forward', () => {
    const s = Q.setQueue(Q.createQueue(), [1, 2, 3, 4], 0);
    expect(Q.findPlayable(s, 1, playable([2, 3]))).toBe(3);
  });

  it('returns -1 at the end without repeat', () => {
    const s = Q.setQueue(Q.createQueue(), [1, 2, 3], 0);
    expect(Q.findPlayable(s, 1, playable([2, 3]))).toBe(-1);
  });

  it('wraps with repeat all but never loops forever when nothing is playable', () => {
    const s = Q.setQueue(Q.createQueue({ repeat: 'all' }), [1, 2, 3], 2);
    expect(Q.findPlayable(s, 3, playable([2, 3]))).toBe(0);
    expect(Q.findPlayable(s, 0, playable([1, 2, 3]))).toBe(-1);
  });

  it('searches backwards for previous', () => {
    const s = Q.setQueue(Q.createQueue(), [1, 2, 3], 2);
    expect(Q.findPlayable(s, 1, playable([2]), -1)).toBe(0);
  });
});

describe('restore', () => {
  it('restores a persisted queue including shuffle order', () => {
    const s = Q.restoreQueue(Q.createQueue({ shuffle: true }), [3, 1, 2], 1, [1, 2, 3]);
    expect(ids(s)).toEqual([3, 1, 2]);
    expect(cur(s)).toBe(1);
    const off = Q.toggleShuffle(s);
    expect(ids(off)).toEqual([1, 2, 3]);
    expect(cur(off)).toBe(1);
  });

  it('clamps an out-of-range index', () => {
    expect(Q.restoreQueue(Q.createQueue(), [1, 2], 9).index).toBe(1);
  });
});
