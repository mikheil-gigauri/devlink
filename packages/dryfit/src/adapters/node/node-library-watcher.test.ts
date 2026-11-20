import { watch as fsWatch } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir } from '../../testing/temp-dir.ts';
import { NodeLibraryWatcher, type WatchStrategy } from './node-library-watcher.ts';

describe.each<WatchStrategy>(['recursive', 'walk'])('NodeLibraryWatcher (%s)', (strategy) => {
  let root: string;
  let cleanup: () => Promise<void>;
  let stop: (() => void) | undefined;

  beforeEach(async () => {
    ({ path: root, cleanup } = await createTempDir());
    for (const dir of ['src', 'node_modules/dep', 'dist/ui', '.git', '.angular/cache']) {
      await mkdir(join(root, dir), { recursive: true });
    }
    await sleep(100); // let FSEvents settle so setup writes are not reported as changes
  });
  afterEach(async () => {
    stop?.();
    await cleanup();
  });

  const watch = (at = root, onError: (error: Error) => void = () => {}) => {
    let changes = 0;
    const watcher = new NodeLibraryWatcher({ debounceMs: 80, strategy });
    stop = watcher.watch(
      { name: 'lib', root: at, publishDir: join(at, 'dist/ui') },
      () => {
        changes += 1;
      },
      onError,
    );
    return () => changes;
  };

  it('reports a burst of source edits as one change', async () => {
    const changes = watch();

    for (const n of [1, 2, 3]) await writeFile(join(root, 'src', `file${n}.ts`), `export const n = ${n};`);
    await sleep(500);

    expect(changes()).toBe(1);
  });

  it("says which files changed, so the daemon can tell its own writes from the user's", async () => {
    const reported: (readonly string[] | undefined)[] = [];
    const watcher = new NodeLibraryWatcher({ debounceMs: 80, strategy });
    stop = watcher.watch(
      { name: 'lib', root, publishDir: join(root, 'dist/ui') },
      (paths) => reported.push(paths),
      () => {},
    );

    await writeFile(join(root, 'src/a.ts'), 'x');
    await sleep(500);

    expect(reported.at(-1)).toContain(join(root, 'src/a.ts'));
  });

  it('fails the watch once the library folder is gone', async () => {
    let failed: Error | undefined;
    const lib = join(root, 'src');
    const changes = watch(lib, (error) => {
      failed = error;
    });
    await sleep(100);

    await rm(lib, { recursive: true, force: true });
    await sleep(600);

    expect(failed?.message).toMatch(/gone|ENOENT|no such/i);
    expect(changes()).toBe(0);
  });

  it('ignores dependencies, build output, VCS and caches', async () => {
    const changes = watch();

    await writeFile(join(root, 'node_modules/dep/index.js'), 'x');
    await writeFile(join(root, 'dist/ui/index.js'), 'x');
    await writeFile(join(root, '.git/index'), 'x');
    await writeFile(join(root, '.angular/cache/x'), 'x');
    await sleep(500);
    expect(changes()).toBe(0);

    // Proves the watch was live all along, so the zero above means "ignored", not "not watching".
    await writeFile(join(root, 'src/real.ts'), 'x');
    await sleep(500);
    expect(changes()).toBe(1);
  });

  it('reports a watch that cannot start instead of failing silently', async () => {
    const errors: Error[] = [];

    watch(join(root, 'gone'), (error) => errors.push(error));
    await sleep(10);

    expect(errors).toEqual([expect.objectContaining({ code: 'ENOENT' })]);
  });

  it('stops reporting once stopped', async () => {
    const changes = watch();
    stop?.();

    await writeFile(join(root, 'src/late.ts'), 'x');
    await sleep(400);

    expect(changes()).toBe(0);
  });
});

/**
 * Linux's recursive watch puts an inotify watch on every folder, node_modules included, before
 * dryfit can filter anything, which exhausts the limit on large repositories. The walk strategy
 * watches folder by folder and never enters an ignored one.
 */
describe('NodeLibraryWatcher (walk)', () => {
  let root: string;
  let cleanup: () => Promise<void>;
  let stop: (() => void) | undefined;
  let watched: string[];

  beforeEach(async () => {
    ({ path: root, cleanup } = await createTempDir());
    for (const dir of ['src/button', 'node_modules/dep/lib', 'dist/ui', '.git/objects']) {
      await mkdir(join(root, dir), { recursive: true });
    }
    await sleep(100);
    watched = [];
  });
  afterEach(async () => {
    stop?.();
    await cleanup();
  });

  const watch = (onError: (error: Error) => void = () => {}) => {
    let changes = 0;
    const watcher = new NodeLibraryWatcher({
      debounceMs: 80,
      strategy: 'walk',
      fsWatch: ((path: string, listener: Parameters<typeof fsWatch>[1]) => {
        watched.push(relative(root, path));
        return fsWatch(path, listener as never);
      }) as typeof fsWatch,
    });
    stop = watcher.watch(
      { name: 'lib', root, publishDir: join(root, 'dist/ui') },
      () => {
        changes += 1;
      },
      onError,
    );
    return () => changes;
  };

  it('opens watchers only on folders that can hold sources', async () => {
    watch();
    await sleep(100);

    expect([...watched].sort()).toEqual(['', 'src', 'src/button']);
  });

  it('watches a folder created after the watch began', async () => {
    const changes = watch();
    await mkdir(join(root, 'src/forms'));
    await sleep(300);
    const afterMkdir = changes();

    await writeFile(join(root, 'src/forms/input.ts'), 'x');
    await sleep(300);

    expect(changes()).toBe(afterMkdir + 1);
  });

  it('keeps watching the rest when a folder is deleted', async () => {
    const errors: Error[] = [];
    const changes = watch((error) => errors.push(error));
    await rm(join(root, 'src/button'), { recursive: true });
    await sleep(300);
    const afterDelete = changes();

    await writeFile(join(root, 'src/index.ts'), 'x');
    await sleep(300);

    expect(changes()).toBe(afterDelete + 1);
    expect(errors).toEqual([]);
  });
});
