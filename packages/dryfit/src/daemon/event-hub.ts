import type { DryfitEvent, EventSink } from '../core/ports.ts';
import type { JobInfo } from './job-queue.ts';

/** Events only the daemon produces, on top of the core's pipeline events. */
export type DaemonEvent =
  | { readonly type: 'job:queued'; readonly job: JobInfo }
  | { readonly type: 'job:started'; readonly job: JobInfo }
  | {
      readonly type: 'job:finished';
      readonly job: JobInfo;
      readonly error?: { readonly code: string; readonly message: string };
    }
  | { readonly type: 'library:changed'; readonly library: string }
  | { readonly type: 'watch:failed'; readonly library: string; readonly message: string }
  | { readonly type: 'state:changed' };

export type HubEvent = DryfitEvent | DaemonEvent;

/** What clients receive on `GET /v1/events`: the event plus a resumable id and a timestamp. */
export type ServerEvent = HubEvent & { readonly id: number; readonly at: string };

type Listener = (event: ServerEvent) => void;

/**
 * Fans events out to every connected client and keeps a bounded history, so a client that reconnects
 * with `Last-Event-ID` catches up on what it missed instead of showing stale status.
 */
export class EventHub implements EventSink {
  readonly #now: () => Date;
  readonly #capacity: number;
  readonly #history: ServerEvent[] = [];
  readonly #listeners = new Set<Listener>();
  #nextId = 1;

  constructor(options: { readonly now?: () => Date; readonly capacity?: number } = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#capacity = options.capacity ?? 500;
  }

  emit(event: HubEvent): void {
    const stamped: ServerEvent = { id: this.#nextId++, at: this.#now().toISOString(), ...event };
    this.#history.push(stamped);
    if (this.#history.length > this.#capacity) this.#history.shift();
    for (const listener of this.#listeners) deliver(listener, stamped);
  }

  /**
   * Listens for new events; with `after`, first replays the kept history newer than that id. An id
   * this hub never issued comes from a daemon that has since restarted, so all history is replayed.
   */
  subscribe(listener: Listener, options: { readonly after?: number } = {}): () => void {
    if (options.after !== undefined) {
      const after = options.after < this.#nextId ? options.after : 0;
      for (const event of this.#history) if (event.id > after) deliver(listener, event);
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

function deliver(listener: Listener, event: ServerEvent): void {
  try {
    listener(event);
  } catch {
    // One failing listener must not starve the others; its connection's own close handler unsubscribes it.
  }
}
