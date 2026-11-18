import { describe, expect, it } from 'vitest';
import { type JobInfo, JobQueue } from './job-queue.ts';

/** A task that finishes only when the test says so. */
function gate<T>(value: T) {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  let runs = 0;
  return {
    task: async () => {
      runs += 1;
      await opened;
      return value;
    },
    open: () => open(),
    runs: () => runs,
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('JobQueue', () => {
  it('runs one job at a time, in the order they arrived', async () => {
    const queue = new JobQueue();
    const order: string[] = [];
    const first = gate('a');

    const a = queue.run('a', async () => {
      order.push('a started');
      const value = await first.task();
      order.push('a done');
      return value;
    });
    const b = queue.run('b', async () => {
      order.push('b started');
      return 'b';
    });
    await tick();
    expect(order).toEqual(['a started']);

    first.open();
    expect(await Promise.all([a, b])).toEqual(['a', 'b']);
    expect(order).toEqual(['a started', 'a done', 'b started']);
  });

  it('keeps going after a job throws before its first await', async () => {
    const queue = new JobQueue();
    const broken = (() => {
      throw new Error('synchronous');
    }) as unknown as () => Promise<string>;

    await expect(queue.run('broken', broken)).rejects.toThrow('synchronous');
    expect(await queue.run('next', async () => 'ran')).toBe('ran');
  });

  it('keeps going after a job fails', async () => {
    const queue = new JobQueue();

    const failing = queue.run('boom', async () => {
      throw new Error('boom');
    });
    const next = queue.run('next', async () => 'ok');

    await expect(failing).rejects.toThrow('boom');
    expect(await next).toBe('ok');
  });

  it('folds a request into a queued job with the same key instead of running it twice', async () => {
    const queue = new JobQueue();
    const blocker = gate(undefined);
    const sync = gate('synced');
    void queue.run('blocker', blocker.task);

    const first = queue.run('sync ui', sync.task, { key: 'sync:ui' });
    const second = queue.run('sync ui', sync.task, { key: 'sync:ui' });
    blocker.open();
    sync.open();

    expect(await Promise.all([first, second])).toEqual(['synced', 'synced']);
    expect(sync.runs()).toBe(1);
  });

  it('queues exactly one follow-up when the same key is already running', async () => {
    const queue = new JobQueue();
    const sync = gate('synced');

    const running = queue.run('sync ui', sync.task, { key: 'sync:ui' });
    await tick();
    const followUp = queue.run('sync ui', sync.task, { key: 'sync:ui' });
    const absorbed = queue.run('sync ui', sync.task, { key: 'sync:ui' });
    sync.open();

    await Promise.all([running, followUp, absorbed]);
    expect(sync.runs()).toBe(2);
  });

  it('reports what is running and waiting, and tells a listener as jobs move', async () => {
    const seen: string[] = [];
    const queue = new JobQueue({
      now: () => new Date('2026-11-18T10:00:00Z'),
      listener: {
        queued: (job) => seen.push(`queued ${job.label}`),
        started: (job) => seen.push(`started ${job.label}`),
        finished: (job, error) => seen.push(`finished ${job.label}${error ? ' with error' : ''}`),
      },
    });
    const first = gate(undefined);

    void queue.run('build ui', first.task, { key: 'sync:ui' });
    void queue.run('link shop', async () => undefined);
    await tick();

    expect(queue.snapshot()).toEqual({
      running: {
        id: 1,
        label: 'build ui',
        key: 'sync:ui',
        queuedAt: '2026-11-18T10:00:00.000Z',
        startedAt: '2026-11-18T10:00:00.000Z',
      },
      queued: [{ id: 2, label: 'link shop', queuedAt: '2026-11-18T10:00:00.000Z' }] satisfies JobInfo[],
    });
    first.open();
    await queue.idle();
    expect(seen).toEqual([
      'queued build ui',
      'started build ui',
      'queued link shop',
      'finished build ui',
      'started link shop',
      'finished link shop',
    ]);
  });

  it('refuses new work and drops waiting jobs once closed, letting the running one finish', async () => {
    const queue = new JobQueue();
    const running = gate('done');

    const current = queue.run('current', running.task);
    await tick();
    const waiting = queue.run('waiting', async () => 'never');
    const closing = queue.close();

    await expect(waiting).rejects.toMatchObject({ code: 'daemon-stopping' });
    await expect(queue.run('late', async () => 'never')).rejects.toMatchObject({ code: 'daemon-stopping' });
    running.open();
    expect(await current).toBe('done');
    await closing;
  });
});
