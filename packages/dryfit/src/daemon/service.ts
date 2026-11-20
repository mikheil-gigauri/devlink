import { DryfitError } from '../core/errors.ts';
import type { LibraryRecord, LinkRecord } from '../core/model.ts';
import type { CoreDeps } from '../core/ports.ts';
import { detectLibraryBuild } from '../core/project/detect-library-build.ts';
import { readManifest } from '../core/project/manifest.ts';
import { coherenceWarnings } from '../core/status/coherence.ts';
import { discoverConsumers } from '../core/use-cases/discover-consumers.ts';
import {
  deleteGroup,
  type GroupMemberOutcome,
  linkGroup,
  restoreGroup,
  saveGroup,
} from '../core/use-cases/groups.ts';
import { linkLibraries } from '../core/use-cases/link-consumer.ts';
import { registerLibrary } from '../core/use-cases/register-library.ts';
import { restoreConsumer } from '../core/use-cases/restore-consumer.ts';
import { requireLibrary, sameLink, withLibrary, withLink } from '../core/use-cases/shared.ts';
import { syncLibrary } from '../core/use-cases/sync-library.ts';
import { unregisterLibrary } from '../core/use-cases/unregister-library.ts';
import { joinPath } from '../core/util/path.ts';
import type { Health, OperationInput, OperationName, OperationOutputs } from './api.ts';
import type { EventHub } from './event-hub.ts';
import { JobQueue } from './job-queue.ts';

/** Calls back when a library's sources change. Returns a function that stops watching. */
export interface LibraryWatcher {
  /**
   * `onChange` gets the absolute paths that changed, or nothing when the platform did not say which.
   * `onError` reports a watch that has ended on its own (folder gone, out of file handles).
   */
  watch(
    library: LibraryRecord,
    onChange: (paths?: readonly string[]) => void,
    onError: (error: Error) => void,
  ): () => void;
}

/** Puts the commit guard into a consumer's pre-commit hook, or takes it out (ADR 0012). */
export interface CommitGuard {
  install(consumer: string): Promise<'installed' | 'not-a-repo'>;
  remove(consumer: string): Promise<void>;
  /** The hook file the guard goes into; apps in one repository share it. */
  hookPath(consumer: string): Promise<string | undefined>;
}

export interface DaemonServiceOptions {
  /** Core dependencies; `events` should be the hub so pipeline events reach clients. */
  readonly deps: CoreDeps;
  readonly hub: EventHub;
  readonly health: () => Health;
  /** Folders searched for consumers, read per request so a changed config applies at once. */
  readonly roots: () => readonly string[] | Promise<readonly string[]>;
  /** Replaces the folders searched for consumers in config.json. */
  readonly saveRoots: (roots: readonly string[]) => Promise<void>;
  /** Apps left out of discovery (`hiddenApps` in config.json), read per request like the roots. */
  readonly hiddenApps: () => readonly string[] | Promise<readonly string[]>;
  readonly saveHiddenApps: (apps: readonly string[]) => Promise<void>;
  readonly watcher: LibraryWatcher;
  readonly guard: CommitGuard;
  /**
   * The one spelling of a folder: symlinks resolved, and on macOS the case it has on disk. Defaults to
   * the path as given. Two spellings of one app would otherwise get two links and two snapshots.
   */
  readonly canonicalPath?: (path: string) => string;
  /** Called after a `shutdown` request has been answered. */
  readonly onShutdown: () => void;
}

type Handlers = { [K in OperationName]: (input: OperationInput<K>) => Promise<OperationOutputs[K]> };

/**
 * Everything the API can ask for, behind one `call`. Work that changes state or touches a repository
 * goes through the job queue; reads answer immediately. This is where the daemon adds what the pure
 * core does not know about: job and state events, file watching and the commit guard.
 */
export class DaemonService {
  readonly #deps: CoreDeps;
  readonly #options: DaemonServiceOptions;
  readonly #queue: JobQueue;
  readonly #watching = new Map<string, () => void>();
  /** Set by `stop`; a job still finishing must not start watchers nothing would close. */
  #stopped = false;
  readonly #handlers: Handlers;

  constructor(options: DaemonServiceOptions) {
    this.#options = options;
    this.#deps = options.deps;
    const { hub } = options;
    this.#queue = new JobQueue({
      now: () => this.#deps.clock.now(),
      listener: {
        queued: (job) => hub.emit({ type: 'job:queued', job }),
        started: (job) => hub.emit({ type: 'job:started', job }),
        finished: (job, error) => {
          hub.emit({ type: 'job:finished', job, ...(error !== undefined && { error: describe(error) }) });
          hub.emit({ type: 'state:changed' });
        },
      },
    });
    this.#handlers = this.#createHandlers();
  }

  call<K extends OperationName>(name: K, input: OperationInput<K>): Promise<OperationOutputs[K]> {
    return this.#handlers[name](input);
  }

  /** Resumes watching the libraries that were being watched when the daemon last stopped. */
  async start(): Promise<void> {
    const { libraries } = await this.#deps.state.load();
    for (const library of libraries) if (library.watch) this.#startWatching(library);
  }

  /** Resolves once no job is running or waiting. */
  idle(): Promise<void> {
    return this.#queue.idle();
  }

  /** Stops watching, drops waiting jobs and waits for the running one. */
  async stop(): Promise<void> {
    this.#stopped = true;
    for (const stopWatching of this.#watching.values()) stopWatching();
    this.#watching.clear();
    await this.#queue.close();
  }

  #createHandlers(): Handlers {
    const deps = this.#deps;
    const job = <T>(label: string, task: () => Promise<T>, key?: string) =>
      this.#queue.run(label, task, key === undefined ? {} : { key });

    return {
      status: async () => {
        const state = await deps.state.load();
        return {
          daemon: this.#options.health(),
          libraries: state.libraries,
          links: state.links,
          groups: state.groups,
          warnings: coherenceWarnings(state),
          jobs: this.#queue.snapshot(),
        };
      },

      register: (input) =>
        job(`register ${input.root}`, async () => {
          const given = input.publishDir !== undefined || input.build !== undefined;
          // Registering again without flags keeps what was set before rather than re-detecting it.
          const known = given
            ? undefined
            : (await deps.state.load()).libraries.find((entry) => entry.root === joinPath(input.root));
          const detected = given || known ? undefined : await detectLibraryBuild(deps.fs, input.root);
          const library = await registerLibrary(deps, {
            root: input.root,
            publishDir: detected?.publishDir ?? input.publishDir ?? known?.publishDir,
            build:
              detected?.build ??
              input.build ??
              (known?.build && { command: known.build.command, args: known.build.args }),
          });
          if (library.watch) this.#startWatching(library);
          return { library, detected: detected?.kind ?? 'given' };
        }),

      unregister: ({ library }) =>
        job(`unregister ${library}`, async () => {
          await unregisterLibrary(deps, { library });
          this.#stopWatching(library);
          return { ok: true };
        }),

      inspect: async ({ root }) => {
        const libraryRoot = joinPath(root);
        const { manifest } = await readManifest(deps.fs, libraryRoot);
        const detected = await detectLibraryBuild(deps.fs, libraryRoot);
        const known = (await deps.state.load()).libraries.find((entry) => entry.root === libraryRoot);
        const build = known ? known.build : detected.build;
        return {
          name: String(manifest.name ?? ''),
          version: String(manifest.version ?? ''),
          root: libraryRoot,
          detected: detected.kind,
          publishDir: known?.publishDir ?? detected.publishDir,
          ...(build && { build: { command: build.command, args: build.args } }),
          registered: known !== undefined,
        };
      },

      sync: ({ library }) =>
        job(
          `sync ${library}`,
          async () => {
            const result = await syncLibrary(deps, { library });
            await this.#reapplyGuards(result.installs.map((install) => install.consumer));
            return result;
          },
          `sync:${library}`,
        ),

      watch: ({ library: name, enabled }) =>
        job(`${enabled ? 'watch' : 'unwatch'} ${name}`, async () => {
          const state = await deps.state.load();
          const library = { ...requireLibrary(state, name), watch: enabled };
          await deps.state.save(withLibrary(state, library));
          if (enabled) this.#startWatching(library);
          else this.#stopWatching(name);
          return library;
        }),

      discover: async ({ library }) => {
        const [found, hidden] = await Promise.all([
          discoverConsumers(deps, { roots: await this.#searchRoots() }),
          this.#options.hiddenApps(),
        ]);
        const consumers = found.filter((consumer) => !hidden.includes(consumer.root));
        return library === undefined
          ? consumers
          : consumers.filter((consumer) => consumer.libraries.some((entry) => entry.name === library));
      },

      link: ({ library, libraries = [], consumer, guard = true }) =>
        job(`link ${[library, ...libraries].join(', ')} into ${consumer}`, async () => {
          const links = await linkLibraries(deps, {
            libraries: [library, ...libraries],
            consumer: await this.#spelling(consumer),
          });
          const [link] = links;
          if (!link) throw new DryfitError('invalid-request', `Linking ${library} returned nothing`, {});
          if (!guard) return { link, links, guard: 'declined' as const };
          let installed: 'installed' | 'not-a-repo';
          try {
            installed = await this.#options.guard.install(link.consumer);
          } catch (error) {
            // The app is linked by now; a guard that could not go in is a warning, not a failed link.
            const message = error instanceof Error ? error.message : String(error);
            return { link, links, guard: 'failed' as const, message };
          }
          if (installed !== 'installed') return { link, links, guard: installed };
          const guarded = [];
          for (const each of links) guarded.push(await this.#markGuarded(each));
          return { link: guarded[0] ?? link, links: guarded, guard: installed };
        }),

      restore: ({ consumer, library, force }) =>
        job(library ? `restore ${library} in ${consumer}` : `restore ${consumer}`, async () => {
          const spelled = await this.#spelling(consumer);
          return this.#restoring(() => restoreConsumer(deps, { consumer: spelled, library, force }));
        }),

      saveGroup: (input) =>
        job(`save group ${input.name}`, async () =>
          saveGroup(deps, {
            ...input,
            consumers: await Promise.all(input.consumers.map((c) => this.#spelling(c))),
          }),
        ),

      deleteGroup: ({ name }) =>
        job(`delete group ${name}`, async () => {
          await deleteGroup(deps, { name });
          return { ok: true };
        }),

      linkGroup: ({ guard = true, ...input }) =>
        job(`link ${input.library} into group ${input.group}`, async () => {
          const outcomes = await linkGroup(deps, input);
          if (!guard) return outcomes;
          const state = await deps.state.load();
          const reported: GroupMemberOutcome[] = [];
          // One at a time: marking a link as guarded rewrites the state file.
          for (const outcome of outcomes) {
            const link = state.links.find((candidate) =>
              sameLink(candidate, { library: input.library, consumer: outcome.consumer }),
            );
            if (outcome.status !== 'done' || !link) {
              reported.push(outcome);
              continue;
            }
            try {
              if ((await this.#options.guard.install(link.consumer)) === 'installed')
                await this.#markGuarded(link);
              reported.push(outcome);
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              reported.push({
                ...outcome,
                message: `linked, but the commit guard could not be installed: ${reason}`,
              });
            }
          }
          return reported;
        }),

      restoreGroup: (input) =>
        job(`restore group ${input.group}`, async () => {
          return this.#restoring(() => restoreGroup(deps, input));
        }),

      roots: async () => ({ roots: await this.#options.roots() }),

      // A job, like hideApps: both rewrite config.json, and one must not undo the other.
      setRoots: (input) =>
        job('set project folders', async () => {
          const roots = [...new Set(input.roots.map((root) => joinPath(root)))];
          await this.#options.saveRoots(roots);
          return { roots };
        }),

      hiddenApps: async () => ({ hiddenApps: await this.#options.hiddenApps() }),

      // A job, so a link cannot slip in between the check and the save.
      hideApps: ({ consumers, hidden }) =>
        job(`${hidden ? 'hide' : 'show'} ${consumers.join(', ')}`, async () => {
          const apps = await Promise.all(consumers.map((consumer) => this.#spelling(consumer)));
          const current = await this.#options.hiddenApps();
          if (hidden) {
            const { links } = await deps.state.load();
            const linked = apps.filter((app) => links.some((link) => link.consumer === app));
            if (linked.length > 0) {
              throw new DryfitError(
                'consumer-linked',
                `${linked.length === 1 ? linked[0] : `${linked.length} apps`} ${linked.length === 1 ? 'is' : 'are'} still linked; restore ${linked.length === 1 ? 'it' : 'them'} first`,
                { consumers: linked },
              );
            }
          }
          const hiddenApps = hidden
            ? [...new Set([...current, ...apps])]
            : current.filter((app) => !apps.includes(app));
          await this.#options.saveHiddenApps(hiddenApps);
          return { hiddenApps };
        }),

      shutdown: async () => {
        setTimeout(() => this.#options.onShutdown(), 0);
        return { ok: true };
      },
    };
  }

  /**
   * The configured folders, or, when there are none (`dryfit init` never ran, or the menu bar user
   * skipped choosing folders), the folders holding the registered libraries: an app next to its
   * library is the likeliest consumer, and searching nothing would look like finding nothing.
   */
  async #searchRoots(): Promise<readonly string[]> {
    const roots = await this.#options.roots();
    if (roots.length > 0) return roots;
    const { libraries } = await this.#deps.state.load();
    return [...new Set(libraries.map((library) => joinPath(library.root, '..')))];
  }

  #startWatching(library: LibraryRecord): void {
    this.#stopWatching(library.name);
    if (this.#stopped) return;
    const { name } = library;
    const stop = this.#options.watcher.watch(
      library,
      (paths) => {
        const sync = () => {
          this.#options.hub.emit({ type: 'library:changed', library: name });
          // The outcome reaches clients as job events; nothing is waiting on this promise.
          this.call('sync', { library: name }).catch(() => {});
        };
        if (paths === undefined || paths.length === 0) return sync();
        // A sync's own writes (an app inside the library folder, build output next to the sources)
        // would otherwise start the next sync, and that one the next, forever.
        void this.#writtenByDryfit(name, paths).then((ours) => {
          if (!ours) sync();
        });
      },
      (error) => {
        // Say so and record it, rather than showing a library as watched that never syncs again.
        this.#stopWatching(name);
        this.#options.hub.emit({ type: 'watch:failed', library: name, message: error.message });
        this.call('watch', { library: name, enabled: false }).catch(() => {});
      },
    );
    this.#watching.set(name, stop);
  }

  /**
   * Whether every changed path is one dryfit writes while syncing `name`: inside an app linked to it
   * (install rewrites its package.json and lockfile), or, for a library built in place, inside the
   * build output its package.json points at.
   */
  async #writtenByDryfit(name: string, paths: readonly string[]): Promise<boolean> {
    try {
      const state = await this.#deps.state.load();
      const library = state.libraries.find((entry) => entry.name === name);
      if (!library) return false;
      const consumers = [...new Set(state.links.map((link) => link.consumer))];
      const outputs =
        library.build && library.publishDir === library.root ? await this.#buildOutputs(library) : [];
      const written = [...consumers, ...outputs].filter((dir) => isInside(dir, library.root));
      return paths.every((path) => written.some((dir) => isInside(path, dir)));
    } catch {
      return false;
    }
  }

  /** The top-level folders a library built in place writes to, from its package.json's entry points. */
  async #buildOutputs(library: LibraryRecord): Promise<string[]> {
    const text = await this.#deps.fs.readText(joinPath(library.root, 'package.json'));
    if (text === undefined) return [];
    const manifest: unknown = JSON.parse(text);
    if (typeof manifest !== 'object' || manifest === null) return [];
    const targets: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') targets.push(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (typeof value === 'object' && value !== null) Object.values(value).forEach(collect);
    };
    const fields = manifest as Record<string, unknown>;
    for (const field of ['main', 'module', 'types', 'typings', 'exports', 'bin']) collect(fields[field]);
    const folders = targets.flatMap((target) => {
      const [first, ...rest] = target.replace(/^\.\//, '').split('/');
      // Only folders: a top-level file may be the source itself. Never the usual source folders,
      // which entry points sometimes name for raw assets (`./src/styles.css`).
      return rest.length > 0 && first && !first.startsWith('.') && !SOURCE_FOLDERS.has(first) ? [first] : [];
    });
    return [...new Set(folders)].map((folder) => joinPath(library.root, folder));
  }

  /**
   * The spelling to use for an app: the one its links or groups already use, when they name the same
   * folder (its snapshot is filed under that spelling), or else its canonical path.
   */
  async #spelling(path: string): Promise<string> {
    const canonical = this.#options.canonicalPath ?? ((given: string) => given);
    const wanted = canonical(joinPath(path));
    const { links, groups } = await this.#deps.state.load();
    const known = new Set([
      ...links.map((link) => link.consumer),
      ...groups.flatMap((group) => group.consumers),
    ]);
    for (const stored of known) if (stored === wanted || canonical(stored) === wanted) return stored;
    return wanted;
  }

  #stopWatching(name: string): void {
    this.#watching.get(name)?.();
    this.#watching.delete(name);
  }

  async #markGuarded(link: LinkRecord): Promise<LinkRecord> {
    const state = await this.#deps.state.load();
    const guarded = { ...link, guard: true };
    await this.#deps.state.save(withLink(state, guarded));
    return guarded;
  }

  /** Husky and friends regenerate hook files on install, so a sync may have wiped the guard. */
  async #reapplyGuards(consumers: readonly string[]): Promise<void> {
    const { links } = await this.#deps.state.load();
    const guarded = new Set(links.filter((link) => link.guard).map((link) => link.consumer));
    for (const consumer of consumers) {
      if (guarded.has(consumer)) await this.#options.guard.install(consumer).catch(() => undefined);
    }
  }

  /**
   * Runs a restore, then takes the guard out of every guarded consumer that no longer has a link. A
   * restore drops a consumer's links once its files are back, even if the clean install then fails.
   */
  async #restoring<T>(restore: () => Promise<T>): Promise<T> {
    const before = await this.#deps.state.load();
    const guarded = new Set(before.links.filter((link) => link.guard).map((link) => link.consumer));
    try {
      return await restore();
    } finally {
      const { links } = await this.#deps.state.load();
      const linked = new Set(links.map((link) => link.consumer));
      // Apps in one repository share a hook: it stays while any of them is still linked and guarded.
      const kept = new Set<string>();
      for (const link of links) {
        if (!link.guard) continue;
        const hook = await this.#options.guard.hookPath(link.consumer).catch(() => undefined);
        if (hook !== undefined) kept.add(hook);
      }
      for (const consumer of guarded) {
        if (linked.has(consumer)) continue;
        const hook = await this.#options.guard.hookPath(consumer).catch(() => undefined);
        if (hook !== undefined && kept.has(hook)) continue;
        await this.#options.guard.remove(consumer).catch(() => undefined);
      }
    }
  }
}

const SOURCE_FOLDERS = new Set(['src', 'source', 'sources', 'projects', 'packages']);

function isInside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir.endsWith('/') ? dir : `${dir}/`);
}

function describe(error: unknown): { code: string; message: string } {
  if (error instanceof DryfitError) return { code: error.code, message: error.message };
  return { code: 'internal', message: error instanceof Error ? error.message : String(error) };
}
