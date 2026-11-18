import { describe, expect, it } from 'vitest';
import { createScenario, HOME, LIB, SHOP } from '../../testing/scenario.ts';
import type { DevlinkState } from '../model.ts';
import { stagingDir } from './shared.ts';
import { unregisterLibrary } from './unregister-library.ts';

const library = { name: '@acme/ui', root: LIB, publishDir: `${LIB}/dist/ui` };

describe('unregisterLibrary', () => {
  it('forgets the library and its staging folder', async () => {
    const { deps, store, fs } = createScenario({ state: { libraries: [library], links: [], groups: [] } });
    await fs.writeText(`${stagingDir(deps, '@acme/ui')}/package.json`, '{}');

    await unregisterLibrary(deps, { library: '@acme/ui' });

    expect((await store.load()).libraries).toEqual([]);
    expect(fs.snapshot(`${HOME}/staging`)).toEqual({});
  });

  it('refuses while consumers are still linked, so none is left without a way back', async () => {
    const state: DevlinkState = {
      libraries: [library],
      links: [{ library: '@acme/ui', consumer: SHOP, status: 'installed' }],
      groups: [],
    };
    const { deps } = createScenario({ state });

    await expect(unregisterLibrary(deps, { library: '@acme/ui' })).rejects.toMatchObject({
      code: 'library-linked',
      details: { consumers: [SHOP] },
    });
  });

  it('reports a library that is not registered', async () => {
    const { deps } = createScenario();

    await expect(unregisterLibrary(deps, { library: '@acme/ui' })).rejects.toMatchObject({
      code: 'library-not-found',
    });
  });
});
