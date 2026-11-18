import { describe, expect, it } from 'vitest';
import { createScenario, json, LIB } from '../../testing/scenario.ts';
import { registerLibrary } from './register-library.ts';

describe('registerLibrary', () => {
  it('registers a library by its package name with a resolved publish folder and build command', async () => {
    const { deps, store } = createScenario();

    const library = await registerLibrary(deps, {
      root: LIB,
      publishDir: 'dist/ui',
      build: { command: 'npm', args: ['run', 'build'] },
    });

    expect(library).toEqual({
      name: '@acme/ui',
      root: LIB,
      publishDir: `${LIB}/dist/ui`,
      build: { command: 'npm', args: ['run', 'build'], cwd: LIB },
    });
    expect(store.current.libraries).toEqual([library]);
  });

  it('publishes the library folder itself when no publish folder is given', async () => {
    const { deps } = createScenario();

    expect((await registerLibrary(deps, { root: LIB })).publishDir).toBe(LIB);
  });

  it('accepts an absolute publish folder', async () => {
    const { deps } = createScenario();

    expect((await registerLibrary(deps, { root: LIB, publishDir: '/elsewhere/dist' })).publishDir).toBe(
      '/elsewhere/dist',
    );
  });

  it('updates an existing registration and keeps its publish history', async () => {
    const { deps, store } = createScenario({
      state: {
        libraries: [
          { name: '@acme/ui', root: LIB, publishDir: LIB, lastPublishedVersion: '1.4.1-dev.20261118143201' },
        ],
        links: [],
      },
    });

    await registerLibrary(deps, { root: LIB, publishDir: 'dist/ui' });

    expect(store.current.libraries).toEqual([
      {
        name: '@acme/ui',
        root: LIB,
        publishDir: `${LIB}/dist/ui`,
        lastPublishedVersion: '1.4.1-dev.20261118143201',
      },
    ]);
  });

  it('stores the library folder in one canonical spelling', async () => {
    const { deps } = createScenario();

    expect((await registerLibrary(deps, { root: `${LIB}/`, publishDir: './dist/ui/' })).root).toBe(LIB);
  });

  it('rejects a folder without a package.json', async () => {
    const { deps } = createScenario();

    await expect(registerLibrary(deps, { root: '/nowhere' })).rejects.toMatchObject({
      code: 'invalid-manifest',
    });
  });

  it('rejects a package.json without a name', async () => {
    const { deps } = createScenario({ files: { '/repos/anon/package.json': json({ version: '1.0.0' }) } });

    await expect(registerLibrary(deps, { root: '/repos/anon' })).rejects.toMatchObject({
      code: 'invalid-manifest',
      message: expect.stringMatching(/has no "name"/),
    });
  });
});
