import { describe, expect, it } from 'vitest';
import type { DryfitState, LibraryRecord } from '../core/model.ts';
import { ADMIN, createScenario, LIB, SHOP } from '../testing/scenario.ts';
import type { Health } from './api.ts';
import { EventHub, type ServerEvent } from './event-hub.ts';
import { type CommitGuard, DaemonService, type LibraryWatcher } from './service.ts';

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
  readonly watching = new Map<string, () => void>();
  readonly failures = new Map<string, (error: Error) => void>();
  watch(watched: LibraryRecord, onChange: () => void, onError: (error: Error) => void) {
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
}

function setup(state: DryfitState = registered) {
  const scenario = createScenario({ state });
  const hub = new EventHub({ now: () => new Date('2026-11-18T10:00:00Z') });
  const events: ServerEvent[] = [];
  hub.subscribe((event) => events.push(event));
  const watcher = new FakeWatcher();
  const guard = new FakeGuard();
  let shutdowns = 0;
  let roots: readonly string[] = ['/repos'];
  const service = new DaemonService({
    deps: { ...scenario.deps, events: hub },
    hub,
    health: () => health,
    roots: () => roots,
    saveRoots: async (next) => {
      roots = next;
    },
    watcher,
    guard,
    onShutdown: () => {
      shutdowns += 1;
    },
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

  it('installs the commit guard when linking, and records it', async () => {
    const { service, guard, store } = setup();

    const result = await service.call('link', { library: '@acme/ui', consumer: SHOP });

    expect(result.guard).toBe('installed');
    expect(guard.installed).toEqual(new Set([SHOP]));
    expect((await store.load()).links[0]?.guard).toBe(true);
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
