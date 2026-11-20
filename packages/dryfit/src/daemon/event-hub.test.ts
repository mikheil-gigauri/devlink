import { describe, expect, it } from 'vitest';
import { EventHub, type ServerEvent } from './event-hub.ts';

const now = () => new Date('2026-11-18T10:00:00Z');
const built = (library: string) => ({ type: 'build:succeeded', library }) as const;

describe('EventHub', () => {
  it('stamps each event with an increasing id and the time, and delivers it to subscribers', () => {
    const hub = new EventHub({ now });
    const received: ServerEvent[] = [];
    hub.subscribe((event) => received.push(event));

    hub.emit(built('@acme/ui'));
    hub.emit(built('@acme/forms'));

    expect(received).toEqual([
      { id: 1, at: '2026-11-18T10:00:00.000Z', type: 'build:succeeded', library: '@acme/ui' },
      { id: 2, at: '2026-11-18T10:00:00.000Z', type: 'build:succeeded', library: '@acme/forms' },
    ]);
  });

  it('replays what a reconnecting client missed, from its last event id', () => {
    const hub = new EventHub({ now });
    for (const library of ['a', 'b', 'c']) hub.emit(built(library));
    const received: number[] = [];

    hub.subscribe((event) => received.push(event.id), { after: 1 });

    expect(received).toEqual([2, 3]);
  });

  it('replays everything to a client whose last id came from a daemon that has since restarted', () => {
    const hub = new EventHub({ now });
    for (const library of ['a', 'b']) hub.emit(built(library));
    const received: number[] = [];

    hub.subscribe((event) => received.push(event.id), { after: 940 });

    expect(received).toEqual([1, 2]);
  });

  it('keeps a bounded history, dropping the oldest events', () => {
    const hub = new EventHub({ now, capacity: 2 });
    for (const library of ['a', 'b', 'c']) hub.emit(built(library));
    const received: number[] = [];

    hub.subscribe((event) => received.push(event.id), { after: 0 });

    expect(received).toEqual([2, 3]);
  });

  it('stops delivering after unsubscribe, and one failing subscriber does not starve the others', () => {
    const hub = new EventHub({ now });
    const received: number[] = [];
    const stop = hub.subscribe((event) => received.push(event.id));
    hub.subscribe(() => {
      throw new Error('client went away');
    });

    hub.emit(built('a'));
    stop();
    hub.emit(built('b'));

    expect(received).toEqual([1]);
  });

  it('replays everything to a client whose id came from an earlier run of the daemon', () => {
    const hub = new EventHub({ firstId: 2_000_000 });
    for (let n = 0; n < 3; n++) hub.emit({ type: 'state:changed' });
    const received: number[] = [];

    hub.subscribe((event) => received.push(event.id), { after: 1_000_300 });

    expect(received).toEqual([2_000_000, 2_000_001, 2_000_002]);
  });
});
