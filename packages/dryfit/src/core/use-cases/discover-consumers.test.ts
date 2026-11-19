import { describe, expect, it } from 'vitest';
import { ADMIN, createScenario, json, LIB, SHOP, scenarioFiles } from '../../testing/scenario.ts';
import type { DryfitState } from '../model.ts';
import { discoverConsumers } from './discover-consumers.ts';

const registered: DryfitState = {
  libraries: [{ name: '@acme/ui', root: LIB, publishDir: `${LIB}/dist/ui` }],
  links: [],
  groups: [],
};

describe('discoverConsumers', () => {
  it('finds every project under the roots that depends on a registered library', async () => {
    const { deps } = createScenario({ state: registered });

    expect(await discoverConsumers(deps, { roots: ['/repos'] })).toEqual([
      {
        root: ADMIN,
        name: 'admin',
        packageManager: { ok: true, name: 'npm', source: 'default' },
        libraries: [{ name: '@acme/ui', field: 'devDependencies', range: '1.4.0' }],
      },
      {
        root: SHOP,
        name: 'shop',
        packageManager: { ok: true, name: 'npm', source: 'lockfile' },
        libraries: [{ name: '@acme/ui', field: 'dependencies', range: '^1.4.0' }],
      },
    ]);
  });

  it('finds nothing when no library is registered', async () => {
    const { deps } = createScenario();

    expect(await discoverConsumers(deps, { roots: ['/repos'] })).toEqual([]);
  });

  it('skips node_modules, hidden folders and the libraries themselves', async () => {
    const dependent = json({ name: 'x', dependencies: { '@acme/ui': '1.4.0' } });
    const { deps } = createScenario({
      state: registered,
      files: {
        ...scenarioFiles(),
        [`${SHOP}/node_modules/some-pkg/package.json`]: dependent,
        '/repos/.trash/old-app/package.json': dependent,
        [`${LIB}/package.json`]: json({ name: '@acme/ui', devDependencies: { '@acme/ui': '1.0.0' } }),
      },
    });

    const roots = (await discoverConsumers(deps, { roots: ['/repos'] })).map((consumer) => consumer.root);

    expect(roots).toEqual([ADMIN, SHOP]);
  });

  it('stops at the first package.json, since that folder owns the install', async () => {
    const dependent = json({ name: 'nested', dependencies: { '@acme/ui': '1.4.0' } });
    const { deps } = createScenario({
      state: registered,
      files: { ...scenarioFiles(), [`${SHOP}/projects/widget/package.json`]: dependent },
    });

    const roots = (await discoverConsumers(deps, { roots: ['/repos'] })).map((consumer) => consumer.root);

    expect(roots).not.toContain(`${SHOP}/projects/widget`);
  });

  it('does not search deeper than maxDepth', async () => {
    const dependent = json({ name: 'deep', dependencies: { '@acme/ui': '1.4.0' } });
    const { deps } = createScenario({ state: registered, files: { '/code/a/b/c/package.json': dependent } });

    expect(await discoverConsumers(deps, { roots: ['/code'], maxDepth: 2 })).toEqual([]);
    expect(await discoverConsumers(deps, { roots: ['/code'], maxDepth: 3 })).toHaveLength(1);
  });

  it('reports a project whose package manager cannot be determined instead of hiding it', async () => {
    const { deps } = createScenario({
      state: registered,
      files: {
        '/code/app/package.json': json({ name: 'app', dependencies: { '@acme/ui': '1.4.0' } }),
        '/code/app/package-lock.json': '{}',
        '/code/app/yarn.lock': '',
      },
    });

    const [app] = await discoverConsumers(deps, { roots: ['/code'] });

    expect(app?.packageManager).toEqual({
      ok: false,
      reason: 'multiple-lockfiles',
      lockfiles: ['package-lock.json', 'yarn.lock'],
    });
  });

  it('skips folders with an unreadable package.json', async () => {
    const { deps } = createScenario({ state: registered, files: { '/code/broken/package.json': '{ nope' } });

    expect(await discoverConsumers(deps, { roots: ['/code'] })).toEqual([]);
  });
});
