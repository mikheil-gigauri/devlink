import { describe, expect, it } from 'vitest';
import type { DryfitState, LibraryRecord } from '../core/model.ts';
import { ADMIN, createScenario, LIB, SHOP } from '../testing/scenario.ts';
import type { Health } from './api.ts';
import { EventHub, type ServerEvent } from './event-hub.ts';
import {
  type CommitGuard,
  DaemonService,
  type DaemonServiceOptions,
  type LibraryWatcher,
} from './service.ts';

const library: LibraryRecord = { name: '@acme/ui', root: LIB, publishDir: `${LIB}/dist/ui` };
const registered: DryfitState = { libraries: [library], links: [], groups: [] };
const health: Health = {
  name: 'dryfit',
  version: '0.0.0-test',
  apiVersion: 1,
  pid: 42,
  registryUrl: 'http://127.0.0.1:4873/',
  startedAt: '2026-11-18T09:00:00.000Z',
};

class FakeWatcher implements LibraryWatcher {
  readonly watching = new Map<string, (paths?: readonly string[]) => void>();
  readonly failures = new Map<string, (error: Error) => void>();
  watch(
    watched: LibraryRecord,
    onChange: (paths?: readonly string[]) => void,
    onError: (error: Error) => void,
  ) {
    this.watching.set(watched.name, onChange);
    this.failures.set(watched.name, onError);
    return () => this.watching.delete(watched.name);
  }
}

class FakeGuard implements CommitGuard {
  readonly installed = new Set<string>();
  readonly broken = new Set<string>();
  installs = 0;
  async install(consumer: string) {
    if (this.broken.has(consumer)) throw new Error(`EACCES: ${consumer}/.git/hooks/pre-commit`);
    this.installs += 1;
    this.installed.add(consumer);
    return 'installed' as const;
  }
  async remove(consumer: string) {
    this.installed.delete(consumer);
  }
  /** Apps in one repository, keyed by app: they share its hook. */
  readonly repos = new Map<string, string>();
  async hookPath(consumer: string) {
    return `${this.repos.get(consumer) ?? consumer}/.git/hooks/pre-commit`;
  }
}

function setup(state: DryfitState = registered, extra: Partial<DaemonServiceOptions> = {}) {
  const scenario = createScenario({ state });
  const hub = new EventHub({ now: () => new Date('2026-11-18T10:00:00Z') });
  const events: ServerEvent[] = [];
  hub.subscribe((event) => events.push(event));
  const watcher = new FakeWatcher();
  const guard = new FakeGuard();
  let shutdowns = 0;
  let roots: readonly string[] = ['/repos'];
  let hiddenApps: readonly string[] = [];
  const service = new DaemonService({
    deps: { ...scenario.deps, events: hub },
    hub,
    health: () => health,
    roots: () => roots,
    saveRoots: async (next) => {
      roots = next;
    },
    hiddenApps: () => hiddenApps,
    saveHiddenApps: async (next) => {
      hiddenApps = next;
    },
    watcher,
    guard,
    onShutdown: () => {
      shutdowns += 1;
    },
    ...extra,
  });
  return {
    ...scenario,
    service,
    hub,
    events,
    watcher,
    guard,
    shutdowns: () => shutdowns,
    roots: () => roots,
    hiddenApps: () => hiddenApps,
  };
}

const types = (events: readonly ServerEvent[]) => events.map((event) => event.type);

describe('DaemonService', () => {
  it('reports state, coherence warnings and the daemon itself in one status call', async () => {
    const { service } = setup({
      libraries: [library],
      links: [
        {
          library: '@acme/ui',
          consumer: SHOP,
          status: 'installed',
          installedVersion: '1.4.1-dev.20261118100000',
        },
        {
          library: '@acme/ui',
          consumer: ADMIN,
          status: 'installed',
          installedVersion: '1.4.1-dev.20261118110000',
        },
      ],
      groups: [{ name: 'checkout', consumers: [SHOP, ADMIN] }],
    });

    const status = await service.call('status', {});

    expect(status.daemon).toEqual(health);
    expect(status.links).toHaveLength(2);
    expect(status.warnings).toEqual([expect.objectContaining({ group: 'checkout', library: '@acme/ui' })]);
    expect(status.jobs).toEqual({ queued: [] });
  });

  it('detects how a library builds when registered without flags', async () => {
    const { service } = setup({ libraries: [], links: [], groups: [] });

    const result = await service.call('register', { root: LIB });

    expect(result).toEqual({
      detected: 'npm-script',
      library: expect.objectContaining({
        name: '@acme/ui',
        publishDir: LIB,
        build: { command: 'npm', args: ['run', 'build'], cwd: LIB },
      }),
    });
  });

  it('uses explicit build settings as given', async () => {
    const { service } = setup({ libraries: [], links: [], groups: [] });

    const result = await service.call('register', { root: LIB, publishDir: `${LIB}/dist/ui` });

    expect(result.detected).toBe('given');
    expect(result.library.publishDir).toBe(`${LIB}/dist/ui`);
  });

  it("keeps a library's stored build settings when it is registered again without flags", async () => {
    const { service } = setup({ libraries: [], links: [], groups: [] });
    const build = { command: 'node', args: ['build.mjs'] };
    await service.call('register', { root: LIB, publishDir: `${LIB}/out`, build });

    const again = await service.call('register', { root: LIB });

    expect(again.detected).toBe('given');
    expect(again.library).toMatchObject({ publishDir: `${LIB}/out`, build: { ...build, cwd: LIB } });
  });

  it('previews what adding a library would do, without registering it', async () => {
    const { service, store } = setup({ libraries: [], links: [], groups: [] });

    const preview = await service.call('inspect', { root: `${LIB}/` });

    expect(preview).toEqual({
      name: '@acme/ui',
      version: '1.4.0',
      root: LIB,
      detected: 'npm-script',
      publishDir: LIB,
      build: { command: 'npm', args: ['run', 'build'] },
      registered: false,
    });
    expect((await store.load()).libraries).toEqual([]);
  });

  it('previews a registered library with the build settings it already has', async () => {
    const { service } = setup();

    const preview = await service.call('inspect', { root: LIB });

    expect(preview).toMatchObject({ registered: true, publishDir: `${LIB}/dist/ui` });
    expect(preview.build).toBeUndefined();
  });

  it('says why a folder cannot be added as a library', async () => {
    const { service } = setup();

    await expect(service.call('inspect', { root: '/repos/nothing' })).rejects.toMatchObject({
      code: 'invalid-manifest',
    });
  });

  it('reads and replaces the folders searched for projects', async () => {
    const { service, roots } = setup();

    expect(await service.call('roots', {})).toEqual({ roots: ['/repos'] });
    const saved = await service.call('setRoots', { roots: ['/code/b', '/code/a/', '/code/b'] });

    expect(saved).toEqual({ roots: ['/code/b', '/code/a'] });
    expect(roots()).toEqual(['/code/b', '/code/a']);
  });

  it('searches the folders holding the libraries when no folders are configured', async () => {
    const { service } = setup();
    await service.call('setRoots', { roots: [] });

    const found = await service.call('discover', {});

    expect(found.map((consumer) => consumer.root)).toEqual([ADMIN, SHOP]);
    expect(await service.call('roots', {})).toEqual({ roots: [] });
  });

  it('leaves hidden apps out of discovery until they are shown again', async () => {
    const { service, hiddenApps } = setup();
    const roots = async () => (await service.call('discover', {})).map((consumer) => consumer.root);
    expect(await roots()).toContain(SHOP);

    expect(await service.call('hideApps', { consumers: [`${SHOP}/`, SHOP], hidden: true })).toEqual({
      hiddenApps: [SHOP],
    });
    expect(hiddenApps()).toEqual([SHOP]);
    expect(await roots()).not.toContain(SHOP);
    expect(await service.call('hiddenApps', {})).toEqual({ hiddenApps: [SHOP] });

    expect(await service.call('hideApps', { consumers: [SHOP], hidden: false })).toEqual({ hiddenApps: [] });
    expect(await roots()).toContain(SHOP);
  });

  it('refuses to hide a linked app, which could then only be restored from the command line', async () => {
    const { service, hiddenApps } = setup();
    await service.call('link', { library: '@acme/ui', consumer: SHOP });

    await expect(service.call('hideApps', { consumers: [SHOP], hidden: true })).rejects.toMatchObject({
      code: 'consumer-linked',
      details: { consumers: [SHOP] },
    });
    expect(hiddenApps()).toEqual([]);
  });

  it('installs the commit guard when linking, and records it', async () => {
    const { service, guard, store } = setup();

    const result = await service.call('link', { library: '@acme/ui', consumer: SHOP });

    expect(result.guard).toBe('installed');
    // Returned with the link, so a client need not catch the caches:cleared event to say so.
    expect(result.clearedCaches).toContain('.angular/cache');
    expect(guard.installed).toEqual(new Set([SHOP]));
    expect((await store.load()).links[0]?.guard).toBe(true);
  });

  it('links several libraries in one job, guarding every link', async () => {
    const forms: LibraryRecord = { name: '@acme/forms', root: '/repos/forms', publishDir: '/repos/forms' };
    const { service, guard, store, fs } = setup({ ...registered, libraries: [library, forms] });
    await fs.writeText(
      '/repos/forms/package.json',
      JSON.stringify({ name: '@acme/forms', version: '2.0.0' }),
    );
    await fs.writeText(
      `${SHOP}/package.json`,
      JSON.stringify({ name: 'shop', dependencies: { '@acme/ui': '^1.4.0', '@acme/forms': '^2.0.0' } }),
    );

    const result = await service.call('link', {
      library: '@acme/ui',
      libraries: ['@acme/forms'],
      consumer: SHOP,
    });

    expect(result.link.library).toBe('@acme/ui');
    expect(result.links.map((link) => [link.library, link.guard])).toEqual([
      ['@acme/ui', true],
      ['@acme/forms', true],
    ]);
    expect(guard.installs).toBe(1);
    expect((await store.load()).links.map((link) => link.guard)).toEqual([true, true]);
  });

  it('leaves the hooks alone when the guard is declined', async () => {
    const { service, guard } = setup();

    const result = await service.call('link', { library: '@acme/ui', consumer: SHOP, guard: false });

    expect(result.guard).toBe('declined');
    expect(guard.installs).toBe(0);
  });

  it('re-applies the guard after every sync, since Husky regenerates its hooks on install', async () => {
    const { service, guard } = setup();
    await service.call('link', { library: '@acme/ui', consumer: SHOP });
    guard.installed.clear();

    await service.call('sync', { library: '@acme/ui' });

    expect(guard.installed).toEqual(new Set([SHOP]));
  });

  it('removes the guard when the consumer is restored', async () => {
    const { service, guard } = setup();
    await service.call('link', { library: '@acme/ui', consumer: SHOP });

    expect(await service.call('restore', { consumer: SHOP })).toEqual({ ok: true });
    expect(guard.installed.size).toBe(0);
  });

  it('keeps the guard in a hook another linked app of the same repository still needs', async () => {
    const { service, guard } = setup();
    guard.repos.set(SHOP, '/repos').set(ADMIN, '/repos');
    await service.call('link', { library: '@acme/ui', consumer: SHOP });
    await service.call('link', { library: '@acme/ui', consumer: ADMIN });

    await service.call('restore', { consumer: SHOP });

    expect(guard.installed.has(SHOP)).toBe(true);
  });

  it('reports a guard that could not be installed as a warning on a link that succeeded', async () => {
    const { service, guard, store } = setup();
    guard.broken.add(SHOP);

    const result = await service.call('link', { library: '@acme/ui', consumer: SHOP });

    expect(result).toMatchObject({
      guard: 'failed',
      message: expect.stringContaining('EACCES'),
      link: { status: 'installed' },
    });
    expect((await store.load()).links).toHaveLength(1);
  });

  it('uses the spelling a link already has for another spelling of the same folder', async () => {
    const { service, store } = setup(registered, {
      canonicalPath: (path) => (path === '/links/shop' ? SHOP : path),
    });
    await service.call('link', { library: '@acme/ui', consumer: SHOP });

    await service.call('link', { library: '@acme/ui', consumer: '/links/shop' });
    expect((await store.load()).links).toHaveLength(1);

    expect(await service.call('restore', { consumer: '/links/shop' })).toEqual({ ok: true });
    expect((await store.load()).links).toEqual([]);
  });

  it('watches a library, syncs when it changes, and remembers the choice', async () => {
    const { service, watcher, store, events } = setup();
    await service.call('link', { library: '@acme/ui', consumer: SHOP });

    const watched = await service.call('watch', { library: '@acme/ui', enabled: true });
    watcher.watching.get('@acme/ui')?.();
    await service.idle();

    expect(watched.watch).toBe(true);
    expect((await store.load()).libraries[0]?.watch).toBe(true);
    expect(types(events)).toContain('library:changed');
    expect(types(events)).toContain('publish:succeeded');
  });

  it('ignores what its own sync writes inside the library folder, so a sync never triggers the next', async () => {
    const example = `${LIB}/example`;
    const inPlace: LibraryRecord = {
      ...library,
      publishDir: LIB,
      build: { command: 'npm', args: ['run', 'build'], cwd: LIB },
    };
    const { service, watcher, events, fs } = setup({ ...registered, libraries: [inPlace] });
    await fs.writeText(
      `${LIB}/package.json`,
      JSON.stringify({
        name: '@acme/ui',
        version: '1.4.0',
        main: './lib/index.js',
        exports: { './styles.css': './src/styles.css' },
      }),
    );
    await fs.writeText(
      `${example}/package.json`,
      JSON.stringify({ name: 'example', dependencies: { '@acme/ui': '^1.4.0' } }),
    );
    await service.call('link', { library: '@acme/ui', consumer: example });
    await service.call('watch', { library: '@acme/ui', enabled: true });
    const settle = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await service.idle();
    };

    watcher.watching.get('@acme/ui')?.([
      `${example}/package.json`,
      `${example}/package-lock.json`,
      `${LIB}/lib/index.js`,
    ]);
    await settle();
    expect(types(events)).not.toContain('library:changed');

    watcher.watching.get('@acme/ui')?.([`${LIB}/lib/index.js`, `${LIB}/src/styles.css`]);
    await settle();
    expect(types(events)).toContain('library:changed');
  });

  it('stops watching when asked, and when the library is unregistered', async () => {
    const { service, watcher } = setup();
    await service.call('watch', { library: '@acme/ui', enabled: true });

    await service.call('watch', { library: '@acme/ui', enabled: false });
    expect(watcher.watching.size).toBe(0);

    await service.call('watch', { library: '@acme/ui', enabled: true });
    await service.call('unregister', { library: '@acme/ui' });
    expect(watcher.watching.size).toBe(0);
  });

  it('resumes watching remembered libraries when the daemon starts', async () => {
    const { service, watcher } = setup({ ...registered, libraries: [{ ...library, watch: true }] });

    await service.start();

    expect([...watcher.watching.keys()]).toEqual(['@acme/ui']);
  });

  it('narrates every job on the event stream, including how a failure ended', async () => {
    const { service, events } = setup();

    await expect(service.call('sync', { library: '@acme/nope' })).rejects.toMatchObject({
      code: 'library-not-found',
    });

    expect(events.filter((event) => event.type.startsWith('job:'))).toEqual([
      expect.objectContaining({
        type: 'job:queued',
        job: expect.objectContaining({ label: 'sync @acme/nope' }),
      }),
      expect.objectContaining({ type: 'job:started' }),
      expect.objectContaining({
        type: 'job:finished',
        error: { code: 'library-not-found', message: 'No library named @acme/nope is registered' },
      }),
    ]);
  });

  it('links and restores a saved group, guarding the members it linked', async () => {
    const { service, guard } = setup();
    await service.call('saveGroup', { name: 'checkout', consumers: [SHOP, ADMIN] });

    const linked = await service.call('linkGroup', { group: 'checkout', library: '@acme/ui' });
    expect(linked.map((outcome) => outcome.status)).toEqual(['done', 'done']);
    expect(guard.installed).toEqual(new Set([SHOP, ADMIN]));

    const restored = await service.call('restoreGroup', { group: 'checkout' });
    expect(restored.map((outcome) => outcome.status)).toEqual(['done', 'done']);
    expect(guard.installed.size).toBe(0);
  });

  it('reports a member whose guard could not be installed, and still guards the rest', async () => {
    const { service, guard } = setup();
    await service.call('saveGroup', { name: 'checkout', consumers: [SHOP, ADMIN] });
    guard.broken.add(SHOP);

    const linked = await service.call('linkGroup', { group: 'checkout', library: '@acme/ui' });

    expect(linked).toEqual([
      {
        consumer: SHOP,
        status: 'done',
        message: expect.stringContaining('commit guard could not be installed'),
      },
      { consumer: ADMIN, status: 'done' },
    ]);
    expect(guard.installed).toEqual(new Set([ADMIN]));
  });

  it('starts no watcher once stopped, even from a job that was already running', async () => {
    const { service, watcher } = setup();

    const watching = service.call('watch', { library: '@acme/ui', enabled: true });
    await service.stop();
    await watching;

    expect(watcher.watching.size).toBe(0);
  });

  it('turns watching off, and says so, when the watch itself fails', async () => {
    const { service, watcher, store, events } = setup();
    await service.call('watch', { library: '@acme/ui', enabled: true });

    watcher.failures.get('@acme/ui')?.(new Error('EMFILE: too many open files'));
    await service.idle();

    expect((await store.load()).libraries[0]?.watch).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'watch:failed',
        library: '@acme/ui',
        message: 'EMFILE: too many open files',
      }),
    );
  });

  it('asks the host to shut down once the reply is on its way', async () => {
    const { service, shutdowns } = setup();

    expect(await service.call('shutdown', {})).toEqual({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shutdowns()).toBe(1);
  });
});
