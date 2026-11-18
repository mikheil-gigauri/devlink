import { describe, expect, it } from 'vitest';
import { ADMIN, BLOG, createScenario, HOME, json, LIB, SHOP, scenarioFiles } from '../../testing/scenario.ts';
import type { DevlinkState } from '../model.ts';
import { pathSlug } from '../util/path.ts';
import { linkConsumer } from './link-consumer.ts';

const library = { name: '@acme/ui', root: LIB, publishDir: `${LIB}/dist/ui` };
const registered: DevlinkState = { libraries: [library], links: [], groups: [] };
const published: DevlinkState = {
  libraries: [{ ...library, lastPublishedVersion: '1.4.1-dev.20261118143201' }],
  links: [],
  groups: [],
};
const snapshotDir = (consumer: string) => `${HOME}/snapshots/${pathSlug(consumer)}`;

describe('linkConsumer', () => {
  it('snapshots the manifest and lockfile before anything changes', async () => {
    const { deps, fs } = createScenario({ state: registered });
    const before = fs.snapshot(SHOP);

    await linkConsumer(deps, { library: '@acme/ui', consumer: SHOP });

    const dir = snapshotDir(SHOP);
    expect(await fs.readText(`${dir}/package.json`)).toBe(before[`${SHOP}/package.json`]);
    expect(await fs.readText(`${dir}/package-lock.json`)).toBe(before[`${SHOP}/package-lock.json`]);
    expect(JSON.parse((await fs.readText(`${dir}/meta.json`)) ?? '')).toEqual({
      consumer: SHOP,
      packageManager: 'npm',
      lockfiles: ['package-lock.json'],
      createdAt: '2026-11-18T14:32:01.000Z',
    });
  });

  it('records a pending link and installs nothing while the library has never been published', async () => {
    const { deps, store, process } = createScenario({ state: registered });

    const link = await linkConsumer(deps, { library: '@acme/ui', consumer: SHOP });

    expect(link).toEqual({ library: '@acme/ui', consumer: SHOP, status: 'pending' });
    expect(store.current.links).toEqual([link]);
    expect(process.calls).toEqual([]);
  });

  it('installs the latest dev version straight away when there is one', async () => {
    const { deps, process } = createScenario({ state: published });

    const link = await linkConsumer(deps, { library: '@acme/ui', consumer: SHOP });

    expect(process.lines(SHOP)).toEqual([
      'npm install @acme/ui@1.4.1-dev.20261118143201 --save-exact --@acme:registry=http://127.0.0.1:4873/ --no-audit --no-fund',
    ]);
    expect(link).toEqual({
      library: '@acme/ui',
      consumer: SHOP,
      status: 'installed',
      installedVersion: '1.4.1-dev.20261118143201',
    });
  });

  it('records a consumer without a lockfile so restore can remove the one npm creates', async () => {
    const { deps, fs } = createScenario({ state: registered });

    await linkConsumer(deps, { library: '@acme/ui', consumer: ADMIN });

    const meta = JSON.parse((await fs.readText(`${snapshotDir(ADMIN)}/meta.json`)) ?? '');
    expect(meta.lockfiles).toEqual([]);
    expect(await fs.exists(`${snapshotDir(ADMIN)}/package-lock.json`)).toBe(false);
  });

  it('keeps the first snapshot when a second library is linked into the same consumer', async () => {
    const second = { name: '@acme/icons', root: '/repos/icons', publishDir: '/repos/icons' };
    const files = {
      ...scenarioFiles(),
      [`${SHOP}/package.json`]: json({
        name: 'shop',
        dependencies: { '@acme/ui': '^1.4.0', '@acme/icons': '^2.0.0' },
      }),
    };
    const { deps, fs } = createScenario({
      files,
      state: { libraries: [library, second], links: [], groups: [] },
    });

    await linkConsumer(deps, { library: '@acme/ui', consumer: SHOP });
    const original = await fs.readText(`${snapshotDir(SHOP)}/package.json`);
    await fs.writeText(
      `${SHOP}/package.json`,
      json({ name: 'shop', dependencies: { '@acme/ui': '1.4.1-dev.1', '@acme/icons': '^2.0.0' } }),
    );
    await linkConsumer(deps, { library: '@acme/icons', consumer: SHOP });

    expect(await fs.readText(`${snapshotDir(SHOP)}/package.json`)).toBe(original);
  });

  it('is idempotent', async () => {
    const { deps, store } = createScenario({ state: registered });

    await linkConsumer(deps, { library: '@acme/ui', consumer: SHOP });
    await linkConsumer(deps, { library: '@acme/ui', consumer: SHOP });

    expect(store.current.links).toHaveLength(1);
  });

  it('rejects an unknown library', async () => {
    const { deps } = createScenario({ state: registered });

    await expect(linkConsumer(deps, { library: '@acme/nope', consumer: SHOP })).rejects.toMatchObject({
      code: 'library-not-found',
    });
  });

  it('rejects a project that does not depend on the library', async () => {
    const { deps, fs } = createScenario({ state: registered });

    await expect(linkConsumer(deps, { library: '@acme/ui', consumer: BLOG })).rejects.toMatchObject({
      code: 'not-a-consumer',
    });
    expect(await fs.exists(snapshotDir(BLOG))).toBe(false);
  });

  it('refuses to guess between lockfiles from different package managers', async () => {
    const { deps } = createScenario({
      state: registered,
      files: { ...scenarioFiles(), [`${SHOP}/yarn.lock`]: '' },
    });

    await expect(linkConsumer(deps, { library: '@acme/ui', consumer: SHOP })).rejects.toMatchObject({
      code: 'package-manager-undetected',
    });
  });

  it('snapshots every lockfile npm may use, including npm-shrinkwrap.json', async () => {
    const files = { ...scenarioFiles(), [`${SHOP}/npm-shrinkwrap.json`]: json({ shrinkwrap: true }) };
    const { deps, fs } = createScenario({ files, state: registered });

    await linkConsumer(deps, { library: '@acme/ui', consumer: SHOP });

    const meta = JSON.parse((await fs.readText(`${snapshotDir(SHOP)}/meta.json`)) ?? '');
    expect(meta.lockfiles).toEqual(['package-lock.json', 'npm-shrinkwrap.json']);
    expect(await fs.readText(`${snapshotDir(SHOP)}/npm-shrinkwrap.json`)).toBe(json({ shrinkwrap: true }));
  });

  it('treats differently spelled paths to the same consumer as one', async () => {
    const { deps, fs, store } = createScenario({ state: registered });

    await linkConsumer(deps, { library: '@acme/ui', consumer: `${SHOP}/` });
    await linkConsumer(deps, { library: '@acme/ui', consumer: `${SHOP}/./src/..` });

    expect(store.current.links).toEqual([{ library: '@acme/ui', consumer: SHOP, status: 'pending' }]);
    expect((await fs.readDir(`${HOME}/snapshots`)).map((entry) => entry.name)).toEqual([
      pathSlug(SHOP).toString(),
    ]);
  });

  it('replaces a leftover snapshot that no link refers to, since it predates the current files', async () => {
    const files = {
      ...scenarioFiles(),
      [`${snapshotDir(SHOP)}/package.json`]: json({ name: 'shop', dependencies: { '@acme/ui': '^0.9.0' } }),
      [`${snapshotDir(SHOP)}/meta.json`]: json({ consumer: SHOP, packageManager: 'npm', lockfiles: [] }),
    };
    const { deps, fs } = createScenario({ files, state: registered });

    await linkConsumer(deps, { library: '@acme/ui', consumer: SHOP });

    expect(await fs.readText(`${snapshotDir(SHOP)}/package.json`)).toBe(files[`${SHOP}/package.json`]);
  });

  it('keeps state changes that land while the snapshot is being written', async () => {
    const { deps, store } = createScenario({ state: registered });
    const icons = { name: '@acme/icons', root: '/repos/icons', publishDir: '/repos/icons' };
    let interleaved = false;
    const fs = {
      ...deps.fs,
      readText: deps.fs.readText.bind(deps.fs),
      exists: deps.fs.exists.bind(deps.fs),
      readDir: deps.fs.readDir.bind(deps.fs),
      remove: deps.fs.remove.bind(deps.fs),
      copyDir: deps.fs.copyDir.bind(deps.fs),
      async writeText(path: string, content: string) {
        if (!interleaved && path.includes('/snapshots/')) {
          interleaved = true;
          await store.save({ ...store.current, libraries: [...store.current.libraries, icons] });
        }
        return deps.fs.writeText(path, content);
      },
    };

    await linkConsumer({ ...deps, fs }, { library: '@acme/ui', consumer: SHOP });

    expect(store.current.libraries.map((entry) => entry.name)).toEqual(['@acme/ui', '@acme/icons']);
  });

  it('rejects a package manager it has no adapter for yet', async () => {
    const { [`${SHOP}/package-lock.json`]: _npmLockfile, ...files } = scenarioFiles();
    const { deps } = createScenario({
      state: registered,
      files: { ...files, [`${SHOP}/pnpm-lock.yaml`]: '' },
    });

    await expect(linkConsumer(deps, { library: '@acme/ui', consumer: SHOP })).rejects.toMatchObject({
      code: 'unsupported-package-manager',
    });
  });
});
