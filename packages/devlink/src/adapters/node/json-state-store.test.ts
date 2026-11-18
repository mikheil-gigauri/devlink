import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DevlinkState } from '../../core/model.ts';
import { createTempDir } from '../../testing/temp-dir.ts';
import { JsonStateStore } from './json-state-store.ts';

const state: DevlinkState = {
  libraries: [{ name: '@acme/ui', root: '/repos/ui', publishDir: '/repos/ui/dist' }],
  links: [{ library: '@acme/ui', consumer: '/repos/shop', status: 'pending' }],
};

describe('JsonStateStore', () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ path: dir, cleanup } = await createTempDir());
  });
  afterEach(() => cleanup());

  it('starts empty when there is no state file yet', async () => {
    expect(await new JsonStateStore(join(dir, 'state.json')).load()).toEqual({ libraries: [], links: [] });
  });

  it('reads back what it saved, creating the folder if needed', async () => {
    const store = new JsonStateStore(join(dir, 'nested', 'state.json'));

    await store.save(state);

    expect(await store.load()).toEqual(state);
  });

  it('writes a versioned, readable file', async () => {
    const path = join(dir, 'state.json');
    await new JsonStateStore(path).save(state);

    const { readFile } = await import('node:fs/promises');
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 1, ...state });
  });

  it('replaces the file atomically, leaving no temporary files behind', async () => {
    const store = new JsonStateStore(join(dir, 'state.json'));

    await Promise.all([store.save(state), store.save({ libraries: [], links: [] })]);

    expect(await readdir(dir)).toEqual(['state.json']);
  });

  it('refuses a corrupt state file instead of silently starting over', async () => {
    const path = join(dir, 'state.json');
    await writeFile(path, '{ "version": 1, "libraries": ');

    await expect(new JsonStateStore(path).load()).rejects.toMatchObject({ code: 'state-corrupt' });
  });

  it('refuses a state file from a newer devlink', async () => {
    const path = join(dir, 'state.json');
    await writeFile(path, JSON.stringify({ version: 2, libraries: [], links: [] }));

    await expect(new JsonStateStore(path).load()).rejects.toMatchObject({ code: 'state-corrupt' });
  });

  it.each([
    ['a library that is not an object', { libraries: [42], links: [] }],
    ['a library without a publish folder', { libraries: [{ name: '@acme/ui', root: '/lib' }], links: [] }],
    ['a link without a consumer', { libraries: [], links: [{ library: '@acme/ui', status: 'installed' }] }],
    [
      'a link with an unknown status',
      { libraries: [], links: [{ library: 'a', consumer: '/c', status: 'odd' }] },
    ],
  ])('refuses a state file with %s', async (_, state) => {
    const path = join(dir, 'state.json');
    await writeFile(path, JSON.stringify({ version: 1, ...state }));

    await expect(new JsonStateStore(path).load()).rejects.toMatchObject({ code: 'state-corrupt' });
  });
});
