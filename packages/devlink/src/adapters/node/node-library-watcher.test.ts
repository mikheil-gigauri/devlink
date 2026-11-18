import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir } from '../../testing/temp-dir.ts';
import { NodeLibraryWatcher } from './node-library-watcher.ts';

describe('NodeLibraryWatcher', () => {
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
    const watcher = new NodeLibraryWatcher({ debounceMs: 80 });
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
