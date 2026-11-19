import { describe, expect, it } from 'vitest';
import { ADMIN, BLOG, createScenario, LIB, SHOP } from '../../testing/scenario.ts';
import type { DryfitState } from '../model.ts';
import { deleteGroup, linkGroup, restoreGroup, saveGroup } from './groups.ts';
import { linkConsumer } from './link-consumer.ts';

const library = { name: '@acme/ui', root: LIB, publishDir: `${LIB}/dist/ui` };
const registered: DryfitState = { libraries: [library], links: [], groups: [] };
const withCheckout: DryfitState = {
  ...registered,
  groups: [{ name: 'checkout', consumers: [SHOP, ADMIN, BLOG] }],
};

describe('saveGroup', () => {
  it('saves consumers under a name, normalising paths and dropping duplicates', async () => {
    const { deps, store } = createScenario({ state: registered });

    const group = await saveGroup(deps, { name: ' checkout ', consumers: [`${SHOP}/`, ADMIN, SHOP] });

    expect(group).toEqual({ name: 'checkout', consumers: [SHOP, ADMIN] });
    expect((await store.load()).groups).toEqual([group]);
  });

  it('replaces a group saved under the same name', async () => {
    const { deps, store } = createScenario({ state: withCheckout });

    await saveGroup(deps, { name: 'checkout', consumers: [ADMIN] });

    expect((await store.load()).groups).toEqual([{ name: 'checkout', consumers: [ADMIN] }]);
  });

  it.each([
    ['an empty name', { name: '  ', consumers: [SHOP] }],
    ['no consumers', { name: 'checkout', consumers: [] }],
  ])('refuses %s', async (_, input) => {
    const { deps } = createScenario({ state: registered });

    await expect(saveGroup(deps, input)).rejects.toMatchObject({ code: 'invalid-group' });
  });
});

describe('deleteGroup', () => {
  it('forgets the group but leaves its consumers alone', async () => {
    const { deps, store, fs } = createScenario({ state: withCheckout });
    const before = fs.snapshot();

    await deleteGroup(deps, { name: 'checkout' });

    expect((await store.load()).groups).toEqual([]);
    expect(fs.snapshot()).toEqual(before);
  });

  it('reports a group that does not exist', async () => {
    const { deps } = createScenario({ state: registered });

    await expect(deleteGroup(deps, { name: 'nope' })).rejects.toMatchObject({ code: 'group-not-found' });
  });
});

describe('linkGroup', () => {
  it('links every member that depends on the library and explains the ones it skips', async () => {
    const { deps, store } = createScenario({ state: withCheckout });

    const outcomes = await linkGroup(deps, { group: 'checkout', library: '@acme/ui' });

    expect(outcomes).toEqual([
      { consumer: SHOP, status: 'done' },
      { consumer: ADMIN, status: 'done' },
      { consumer: BLOG, status: 'skipped', message: `${BLOG} does not depend on @acme/ui` },
    ]);
    expect((await store.load()).links.map((link) => link.consumer)).toEqual([SHOP, ADMIN]);
  });

  it('refuses an unknown library before touching any member', async () => {
    const { deps, fs } = createScenario({ state: withCheckout });
    const before = fs.snapshot();

    await expect(linkGroup(deps, { group: 'checkout', library: '@acme/nope' })).rejects.toMatchObject({
      code: 'library-not-found',
    });
    expect(fs.snapshot()).toEqual(before);
  });
});

describe('restoreGroup', () => {
  it('restores the linked members and skips the others', async () => {
    const { deps, store, fs } = createScenario({ state: withCheckout });
    const tracked = [`${SHOP}/package.json`, `${SHOP}/package-lock.json`];
    const before = await Promise.all(tracked.map((file) => fs.readText(file)));
    await linkConsumer(deps, { library: '@acme/ui', consumer: SHOP });

    const outcomes = await restoreGroup(deps, { group: 'checkout' });

    expect(outcomes).toEqual([
      { consumer: SHOP, status: 'done' },
      { consumer: ADMIN, status: 'skipped', message: `${ADMIN} is not linked` },
      { consumer: BLOG, status: 'skipped', message: `${BLOG} is not linked` },
    ]);
    expect(await Promise.all(tracked.map((file) => fs.readText(file)))).toEqual(before);
    expect((await store.load()).links).toEqual([]);
  });
});
