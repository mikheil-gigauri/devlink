import { DevlinkError } from '../core/errors.ts';

export interface JobInfo {
  readonly id: number;
  /** What the job does, for people: `sync @acme/ui`. */
  readonly label: string;
  /** Jobs sharing a key are interchangeable, so a waiting one absorbs later requests. */
  readonly key?: string;
  readonly queuedAt: string;
  readonly startedAt?: string;
}

export interface JobListener {
  queued?(job: JobInfo): void;
  started?(job: JobInfo): void;
  finished?(job: JobInfo, error?: unknown): void;
}

interface Entry {
  info: JobInfo;
  readonly task: () => Promise<unknown>;
  readonly promise: Promise<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Runs the daemon's work one job at a time (ADR 0012), so two operations never write the same
 * lockfile or the state file at once. A request whose key matches a job that is still waiting joins
 * it; one that matches the running job queues a single follow-up. A burst of file saves therefore
 * costs at most two syncs.
 */
export class JobQueue {
  readonly #now: () => Date;
  readonly #listener: JobListener;
  readonly #waiting: Entry[] = [];
  readonly #idleWaiters: (() => void)[] = [];
  #running: Entry | undefined;
  #nextId = 1;
  #closed = false;

  constructor(options: { readonly now?: () => Date; readonly listener?: JobListener } = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#listener = options.listener ?? {};
  }

  run<T>(label: string, task: () => Promise<T>, options: { readonly key?: string } = {}): Promise<T> {
    if (this.#closed) return Promise.reject(stopping());
    if (options.key !== undefined) {
      const waiting = this.#waiting.find((entry) => entry.info.key === options.key);
      if (waiting) return waiting.promise as Promise<T>;
    }

    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const info: JobInfo = {
      id: this.#nextId++,
      label,
      ...(options.key !== undefined && { key: options.key }),
      queuedAt: this.#now().toISOString(),
    };
    this.#waiting.push({ info, task, promise, resolve, reject });
    this.#listener.queued?.(info);
    this.#pump();
    return promise as Promise<T>;
  }

  snapshot(): { readonly running?: JobInfo; readonly queued: readonly JobInfo[] } {
    return {
      ...(this.#running && { running: this.#running.info }),
      queued: this.#waiting.map((entry) => entry.info),
    };
  }

  /** Resolves once nothing is running or waiting. */
  idle(): Promise<void> {
    if (!this.#running && this.#waiting.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.#idleWaiters.push(resolve));
  }

  /** Refuses new jobs and drops waiting ones; resolves when the running job has finished. */
  close(): Promise<void> {
    this.#closed = true;
    for (const entry of this.#waiting.splice(0)) entry.reject(stopping());
    return this.idle();
  }

  #pump(): void {
    if (this.#running) return;
    const entry = this.#waiting.shift();
    if (!entry) {
      for (const resolve of this.#idleWaiters.splice(0)) resolve();
      return;
    }

    entry.info = { ...entry.info, startedAt: this.#now().toISOString() };
    this.#running = entry;
    this.#listener.started?.(entry.info);
    const finish = (error?: unknown) => {
      this.#running = undefined;
      this.#listener.finished?.(entry.info, error);
      this.#pump();
    };
    let task: Promise<unknown>;
    try {
      task = entry.task();
    } catch (error) {
      // A task that throws before returning its promise must not leave the queue stuck as running.
      task = Promise.reject(error);
    }
    task.then(
      (value) => {
        entry.resolve(value);
        finish();
      },
      (error: unknown) => {
        entry.reject(error);
        finish(error);
      },
    );
  }
}

function stopping(): DevlinkError {
  return new DevlinkError('daemon-stopping', 'devlink is shutting down', {});
}
