import { describe, expect, it } from 'vitest';
import { failed } from '../../testing/fakes.ts';
import {
  ADMIN,
  createScenario,
  HOME,
  json,
  LIB,
  lockfileFor,
  SHOP,
  scenarioFiles,
  shopManifest,
} from '../../testing/scenario.ts';
import type { DevlinkState } from '../model.ts';
import { pathSlug } from '../util/path.ts';
import { linkConsumer } from './link-consumer.ts';
import { restoreConsumer } from './restore-consumer.ts';
import { syncLibrary } from './sync-library.ts';

const registered: DevlinkState = {
  libraries: [{ name: '@acme/ui', root: LIB, publishDir: `${LIB}/dist/ui` }],
  links: [],
};

/** Links `consumers`, publishes and installs, returning the scenario mid-development. */
async function linkedAndSynced(
  consumers: string[],
  configure?: (s: ReturnType<typeof createScenario>) => void,
) {
  const scenario = createScenario({ state: registered });
  configure?.(scenario);
  for (const consumer of consumers) await linkConsumer(scenario.deps, { library: '@acme/ui', consumer });
  await syncLibrary(scenario.deps, { library: '@acme/ui' });
  return scenario;
}

const manifestAndLock = (files: Record<string, string>, root: string) => ({
  manifest: files[`${root}/package.json`],
  lockfile: files[`${root}/package-lock.json`],
});

describe('restoreConsumer', () => {
  it('puts the manifest and lockfile back byte for byte and reinstalls from the lockfile', async () => {
    const original = createScenario().fs.snapshot(SHOP);
    const { deps, fs, process } = await linkedAndSynced([SHOP]);
    expect(await fs.readText(`${SHOP}/package.json`)).not.toBe(original[`${SHOP}/package.json`]);

    const result = await restoreConsumer(deps, { consumer: SHOP });

    expect(result).toEqual({ ok: true });
    expect(manifestAndLock(fs.snapshot(SHOP), SHOP)).toEqual(manifestAndLock(original, SHOP));
    expect(process.lines(SHOP).at(-1)).toBe('npm ci --no-audit --no-fund');
  });

  it('restores a consumer whose install failed half-way (M1 exit check)', async () => {
    const original = createScenario().fs.snapshot(SHOP);
    const { deps, fs, store } = await linkedAndSynced([SHOP], ({ npm }) => npm.failIn(SHOP));
    expect(store.current.links[0]?.status).toBe('failed');
    expect(await fs.readText(`${SHOP}/package.json`)).not.toBe(original[`${SHOP}/package.json`]);

    await restoreConsumer(deps, { consumer: SHOP });

    expect(manifestAndLock(fs.snapshot(SHOP), SHOP)).toEqual(manifestAndLock(original, SHOP));
  });

  it('removes a lockfile that npm created when the consumer had none', async () => {
    const { deps, fs, process } = await linkedAndSynced([ADMIN]);
    expect(await fs.exists(`${ADMIN}/package-lock.json`)).toBe(true);

    await restoreConsumer(deps, { consumer: ADMIN });

    expect(await fs.exists(`${ADMIN}/package-lock.json`)).toBe(false);
    expect(process.lines(ADMIN).at(-1)).toBe('npm install --no-package-lock --no-audit --no-fund');
  });

  it('restores npm-shrinkwrap.json as well as package-lock.json', async () => {
    const files = { ...scenarioFiles(), [`${SHOP}/npm-shrinkwrap.json`]: json({ shrinkwrap: 'original' }) };
    const scenario = createScenario({ files, state: registered });
    await linkConsumer(scenario.deps, { library: '@acme/ui', consumer: SHOP });
    await syncLibrary(scenario.deps, { library: '@acme/ui' });
    await scenario.fs.writeText(`${SHOP}/npm-shrinkwrap.json`, json({ shrinkwrap: 'edited by npm' }));

    await restoreConsumer(scenario.deps, { consumer: SHOP });

    expect(await scenario.fs.readText(`${SHOP}/npm-shrinkwrap.json`)).toBe(
      files[`${SHOP}/npm-shrinkwrap.json`],
    );
  });

  it('finishes cleaning up and reports the error when npm cannot even start', async () => {
    const { deps, fs, process, store, events } = await linkedAndSynced([SHOP]);
    await fs.writeText(`${SHOP}/.angular/cache/stale.js`, 'dev build');
    process.on('npm ci', () => {
      throw new Error('spawn npm ENOENT');
    });

    const result = await restoreConsumer(deps, { consumer: SHOP });

    expect(result).toEqual({ ok: false, output: 'spawn npm ENOENT' });
    expect(await fs.exists(`${SHOP}/.angular/cache`)).toBe(false);
    expect(store.current.links).toEqual([]);
    expect(events.events.at(-1)).toEqual({ type: 'consumer:restored', consumer: SHOP, ok: false });
  });

  it('does not mistake a dependency field npm created for the library as a user change', async () => {
    const PLUGIN = '/repos/plugin';
    const pluginManifest = json({ name: 'plugin', peerDependencies: { '@acme/ui': '^1.4.0' } });
    const files = {
      ...scenarioFiles(),
      [`${PLUGIN}/package.json`]: pluginManifest,
      [`${PLUGIN}/package-lock.json`]: lockfileFor('plugin', {}),
    };
    const scenario = createScenario({ files, state: registered });
    await linkConsumer(scenario.deps, { library: '@acme/ui', consumer: PLUGIN });
    await syncLibrary(scenario.deps, { library: '@acme/ui' });
    const linked = JSON.parse((await scenario.fs.readText(`${PLUGIN}/package.json`)) ?? '');
    linked.devDependencies = { '@acme/ui': '1.4.1-dev.20261118143201' };
    await scenario.fs.writeText(`${PLUGIN}/package.json`, json(linked));

    await expect(restoreConsumer(scenario.deps, { consumer: PLUGIN })).resolves.toEqual({ ok: true });
    expect(await scenario.fs.readText(`${PLUGIN}/package.json`)).toBe(pluginManifest);
  });

  it('forgets the links and the snapshot afterwards', async () => {
    const { deps, fs, store } = await linkedAndSynced([SHOP, ADMIN]);

    await restoreConsumer(deps, { consumer: SHOP });

    expect(store.current.links.map((link) => link.consumer)).toEqual([ADMIN]);
    expect(await fs.exists(`${HOME}/snapshots/${pathSlug(SHOP)}`)).toBe(false);
  });

  it('clears framework caches so the dev server stops serving the dev build', async () => {
    const { deps, fs } = await linkedAndSynced([SHOP]);
    await fs.writeText(`${SHOP}/.angular/cache/20.1.3/vite/deps/acme-ui.js`, 'dev build');

    await restoreConsumer(deps, { consumer: SHOP });

    expect(await fs.exists(`${SHOP}/.angular/cache`)).toBe(false);
  });

  it('refuses to overwrite dependency changes the user made while linked', async () => {
    const { deps, fs } = await linkedAndSynced([SHOP]);
    const current = JSON.parse((await fs.readText(`${SHOP}/package.json`)) ?? '');
    current.dependencies.rxjs = '^8.0.0';
    await fs.writeText(`${SHOP}/package.json`, json(current));

    await expect(restoreConsumer(deps, { consumer: SHOP })).rejects.toMatchObject({
      code: 'manifest-drifted',
    });
    expect(JSON.parse((await fs.readText(`${SHOP}/package.json`)) ?? '').dependencies.rxjs).toBe('^8.0.0');
  });

  it('overwrites those changes when forced', async () => {
    const { deps, fs } = await linkedAndSynced([SHOP]);
    await fs.writeText(`${SHOP}/package.json`, json({ ...shopManifest, scripts: { start: 'ng serve' } }));

    await restoreConsumer(deps, { consumer: SHOP, force: true });

    expect(JSON.parse((await fs.readText(`${SHOP}/package.json`)) ?? '')).toEqual(shopManifest);
  });

  it('does not count devlink’s own reordering of dependencies as a user change', async () => {
    const { deps, fs } = await linkedAndSynced([SHOP]);
    const current = JSON.parse((await fs.readText(`${SHOP}/package.json`)) ?? '');
    const reordered = {
      ...current,
      dependencies: Object.fromEntries(Object.entries(current.dependencies).reverse()),
    };
    await fs.writeText(`${SHOP}/package.json`, json(reordered));

    await expect(restoreConsumer(deps, { consumer: SHOP })).resolves.toEqual({ ok: true });
  });

  it('still restores the files when the clean install fails, and reports it', async () => {
    const original = createScenario().fs.snapshot(SHOP);
    const { deps, fs, process, store, events } = await linkedAndSynced([SHOP]);
    process.on('npm ci', failed('npm error network ETIMEDOUT'));

    const result = await restoreConsumer(deps, { consumer: SHOP });

    expect(result).toEqual({ ok: false, output: 'npm error network ETIMEDOUT' });
    expect(manifestAndLock(fs.snapshot(SHOP), SHOP)).toEqual(manifestAndLock(original, SHOP));
    expect(store.current.links).toEqual([]);
    expect(events.events.at(-1)).toEqual({ type: 'consumer:restored', consumer: SHOP, ok: false });
  });

  it('rejects a consumer that was never linked', async () => {
    const { deps } = createScenario({ state: registered });

    await expect(restoreConsumer(deps, { consumer: SHOP })).rejects.toMatchObject({
      code: 'snapshot-missing',
    });
  });
});
