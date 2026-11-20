import { describe, expect, it } from 'vitest';
import { ADMIN, createScenario, json, LIB, SHOP } from '../../testing/scenario.ts';
import type { DryfitState } from '../model.ts';
import { syncLibrary } from './sync-library.ts';

const VERSION = '1.4.1-dev.20261118143201';

const linked = (consumers: string[]): DryfitState => ({
  libraries: [{ name: '@acme/ui', root: LIB, publishDir: `${LIB}/dist/ui` }],
  links: consumers.map((consumer) => ({ library: '@acme/ui', consumer, status: 'pending' as const })),
  groups: [],
});

describe('syncLibrary', () => {
  it('publishes once and installs into every linked consumer, keeping each dependency field', async () => {
    const { deps, process } = createScenario({ state: linked([SHOP, ADMIN]) });

    const result = await syncLibrary(deps, { library: '@acme/ui' });

    expect(result.version).toBe(VERSION);
    expect(process.lines(SHOP)).toEqual([
      `npm install @acme/ui@${VERSION} --save-exact --@acme:registry=http://127.0.0.1:4873/ --no-audit --no-fund`,
    ]);
    expect(process.lines(ADMIN)).toEqual([
      `npm install @acme/ui@${VERSION} --save-exact --save-dev --@acme:registry=http://127.0.0.1:4873/ --no-audit --no-fund`,
    ]);
  });

  it('leaves consumers that are not linked alone', async () => {
    const { deps, process } = createScenario({ state: linked([SHOP]) });

    await syncLibrary(deps, { library: '@acme/ui' });

    expect(process.lines(ADMIN)).toEqual([]);
  });

  it('clears the caches of each detected framework after installing', async () => {
    const { deps, fs } = createScenario({ state: linked([SHOP, ADMIN]) });

    const result = await syncLibrary(deps, { library: '@acme/ui' });

    expect(await fs.exists(`${SHOP}/.angular/cache`)).toBe(false);
    expect(await fs.exists(`${SHOP}/node_modules/.cache/native-federation`)).toBe(false);
    expect(await fs.exists(`${ADMIN}/node_modules/.vite`)).toBe(false);
    expect(await fs.readText(`${SHOP}/src/main.ts`)).toBe('bootstrap();\n');
    expect(result.installs).toEqual([
      {
        consumer: SHOP,
        ok: true,
        version: VERSION,
        libraries: [{ library: '@acme/ui', version: VERSION }],
        clearedCaches: ['.angular/cache', 'node_modules/.cache/native-federation'],
      },
      {
        consumer: ADMIN,
        ok: true,
        version: VERSION,
        libraries: [{ library: '@acme/ui', version: VERSION }],
        clearedCaches: ['node_modules/.vite'],
      },
    ]);
  });

  it('marks links as installed with the version they now run', async () => {
    const { deps, store } = createScenario({ state: linked([SHOP]) });

    await syncLibrary(deps, { library: '@acme/ui' });

    expect(store.current.links).toEqual([
      { library: '@acme/ui', consumer: SHOP, status: 'installed', installedVersion: VERSION },
    ]);
  });

  it('keeps what else the link records, such as the commit guard flag', async () => {
    const state = linked([SHOP]);
    const { deps, store } = createScenario({
      state: { ...state, links: state.links.map((link) => ({ ...link, guard: true })) },
    });

    await syncLibrary(deps, { library: '@acme/ui' });

    expect(store.current.links).toEqual([
      { library: '@acme/ui', consumer: SHOP, status: 'installed', installedVersion: VERSION, guard: true },
    ]);
  });

  it('keeps going when one consumer fails, and reports which one', async () => {
    const { deps, npm, store, fs } = createScenario({ state: linked([SHOP, ADMIN]) });
    npm.failIn(SHOP);

    const result = await syncLibrary(deps, { library: '@acme/ui' });

    expect(result.installs).toEqual([
      {
        consumer: SHOP,
        ok: false,
        version: VERSION,
        libraries: [{ library: '@acme/ui', version: VERSION }],
        output: 'npm error ERESOLVE could not resolve',
      },
      {
        consumer: ADMIN,
        ok: true,
        version: VERSION,
        libraries: [{ library: '@acme/ui', version: VERSION }],
        clearedCaches: ['node_modules/.vite'],
      },
    ]);
    expect(store.current.links.map((link) => [link.consumer, link.status, link.message])).toEqual([
      [SHOP, 'failed', 'npm error ERESOLVE could not resolve'],
      [ADMIN, 'installed', undefined],
    ]);
    expect(await fs.exists(`${SHOP}/.angular/cache`)).toBe(true);
  });

  it('clears the failure message once an install into that consumer succeeds', async () => {
    const state = linked([SHOP]);
    const { deps, store } = createScenario({
      state: {
        ...state,
        links: [{ library: '@acme/ui', consumer: SHOP, status: 'failed', message: 'npm error ERESOLVE' }],
      },
    });

    await syncLibrary(deps, { library: '@acme/ui' });

    expect(store.current.links[0]?.message).toBeUndefined();
  });

  it('emits an install event per consumer between publish and the end', async () => {
    const { deps, events } = createScenario({ state: linked([SHOP]) });

    await syncLibrary(deps, { library: '@acme/ui' });

    expect(events.types()).toEqual([
      'publish:succeeded',
      'install:started',
      'install:succeeded',
      'caches:cleared',
    ]);
  });

  it('keeps going when a consumer cannot even be installed into, and reports why', async () => {
    const { deps, fs, store } = createScenario({ state: linked([SHOP, ADMIN]) });
    await fs.writeText(`${SHOP}/package.json`, json({ name: 'shop', dependencies: {} }));

    const result = await syncLibrary(deps, { library: '@acme/ui' });

    expect(result.installs).toEqual([
      {
        consumer: SHOP,
        ok: false,
        version: VERSION,
        libraries: [{ library: '@acme/ui', version: VERSION }],
        output: `${SHOP} no longer depends on @acme/ui`,
      },
      {
        consumer: ADMIN,
        ok: true,
        version: VERSION,
        libraries: [{ library: '@acme/ui', version: VERSION }],
        clearedCaches: ['node_modules/.vite'],
      },
    ]);
    expect(store.current.links.find((link) => link.consumer === SHOP)?.status).toBe('failed');
  });

  it('publishes even when nothing is linked yet', async () => {
    const { deps } = createScenario({ state: linked([]) });

    expect(await syncLibrary(deps, { library: '@acme/ui' })).toEqual({
      version: VERSION,
      published: [{ library: '@acme/ui', version: VERSION }],
      installs: [],
    });
  });

  it('installs nothing when the publish fails', async () => {
    const { deps, process } = createScenario({ state: linked([SHOP]) });
    process.on('npm publish', { exitCode: 1, stdout: '', stderr: 'E500' });

    await expect(syncLibrary(deps, { library: '@acme/ui' })).rejects.toMatchObject({
      code: 'publish-failed',
    });
    expect(process.lines(SHOP)).toEqual([]);
  });
});
