import { type Dirent, existsSync, type FSWatcher, statSync, watch } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { LibraryRecord } from '../../core/model.ts';
import type { LibraryWatcher } from '../../daemon/service.ts';

/** Folders whose changes never mean the library's sources changed. */
const IGNORED_FOLDERS = new Set([
  'node_modules',
  '.git',
  '.angular',
  '.nx',
  '.cache',
  '.turbo',
  'coverage',
  'dist',
  'out-tsc',
  'tmp',
]);
/** Editor droppings and build bookkeeping. */
const IGNORED_FILE = /(^\.DS_Store$|\.swp$|\.swx$|~$|^4913$|\.tsbuildinfo$)/;

/**
 * How a library's folder is watched:
 * - `recursive`: one recursive watch (FSEvents on macOS), filtered as events arrive.
 * - `walk`: one watch per folder, never entering an ignored one. Linux needs it: its recursive watch
 *   places an inotify watch on every folder, node_modules included, and runs out on large repositories.
 */
export type WatchStrategy = 'recursive' | 'walk';

export interface NodeLibraryWatcherOptions {
  readonly debounceMs?: number;
  /** Defaults to `walk` on Linux and `recursive` elsewhere. */
  readonly strategy?: WatchStrategy;
  /** For tests: the `fs.watch` to use. */
  readonly fsWatch?: typeof watch;
}

/**
 * Watches a library's folder and reports a burst of changes as one, after a quiet period (ADR 0012).
 * Changes inside the publish folder are ignored even when it sits inside the library, or every build
 * would trigger the next one.
 */
export class NodeLibraryWatcher implements LibraryWatcher {
  readonly #debounceMs: number;
  readonly #strategy: WatchStrategy;
  readonly #fsWatch: typeof watch;

  constructor(options: NodeLibraryWatcherOptions = {}) {
    this.#debounceMs = options.debounceMs ?? 400;
    this.#strategy = options.strategy ?? (process.platform === 'linux' ? 'walk' : 'recursive');
    this.#fsWatch = options.fsWatch ?? watch;
  }

  watch(
    library: Pick<LibraryRecord, 'name' | 'root' | 'publishDir'>,
    onChange: (paths?: readonly string[]) => void,
    onError: (error: Error) => void,
  ): () => void {
    const publishDir = relative(library.root, library.publishDir);
    const ignorePublishDir = publishDir !== '' && !publishDir.startsWith('..');
    let timer: NodeJS.Timeout | undefined;
    let close = () => {};
    /** The changed paths since the last report; undefined once an event named none. */
    let pending: Set<string> | undefined = new Set();

    /** Whether a path relative to the root can hold the library's sources. */
    const relevant = (filename: string | null) => {
      if (filename === null || filename === '') return true;
      if (ignorePublishDir && (filename === publishDir || filename.startsWith(publishDir + sep)))
        return false;
      const segments = filename.split(sep);
      return (
        !segments.some((segment) => IGNORED_FOLDERS.has(segment)) && !IGNORED_FILE.test(segments.at(-1) ?? '')
      );
    };
    const report = () => {
      // A deleted or moved library folder ends an FSEvents watch with one last change, not an error.
      if (!existsSync(library.root)) {
        fail(new Error(`${library.root} is gone`));
        return;
      }
      const paths = pending === undefined ? undefined : [...pending];
      pending = new Set();
      onChange(paths);
    };
    const changed = (filename: string | null) => {
      if (filename === null || filename === '') pending = undefined;
      else pending?.add(join(library.root, filename));
      clearTimeout(timer);
      timer = setTimeout(report, this.#debounceMs);
    };

    let ended = false;
    const fail = (error: Error) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      close();
      onError(error);
    };
    try {
      close =
        this.#strategy === 'walk'
          ? this.#walk(library.root, relevant, changed, fail)
          : this.#recursive(library.root, relevant, changed, fail);
    } catch (error) {
      // Reported once the caller has the stop function, as a later error would be.
      setImmediate(() => fail(error instanceof Error ? error : new Error(String(error))));
    }

    return () => {
      ended = true;
      clearTimeout(timer);
      close();
    };
  }

  #recursive(
    root: string,
    relevant: (filename: string | null) => boolean,
    changed: (filename: string | null) => void,
    fail: (error: Error) => void,
  ): () => void {
    const watcher = this.#fsWatch(root, { recursive: true }, (_event, filename) => {
      if (relevant(filename)) changed(filename);
    });
    // A deleted or unmounted folder, or running out of file handles, ends the watch.
    watcher.on('error', fail);
    return () => watcher.close();
  }

  #walk(
    root: string,
    relevant: (filename: string | null) => boolean,
    changed: (filename: string | null) => void,
    fail: (error: Error) => void,
  ): () => void {
    /** Keyed by folder relative to the root, '' being the root itself. */
    const watchers = new Map<string, FSWatcher>();
    /** The inode each watched folder had, to tell a folder deleted and created again from the same one. */
    const inodes = new Map<string, number>();
    let closed = false;

    const forget = (folder: string) => {
      for (const [key, watcher] of watchers) {
        if (key === folder || key.startsWith(folder + sep)) {
          watcher.close();
          watchers.delete(key);
          inodes.delete(key);
        }
      }
    };

    /** Starts watching one folder. Throws when it cannot be watched, e.g. because it is gone. */
    const watchFolder = (folder: string) => {
      // The listener adds a folder created later, and forgets one that was deleted.
      const watcher = this.#fsWatch(join(root, folder), (_event, filename) => {
        const entry = filename === null ? folder : join(folder, filename);
        if (!relevant(entry)) return;
        changed(filename === null ? null : entry);
        if (filename === null) return;
        // inotify reports a deleted folder only as a rename in its parent, never as an error on its
        // own watch; one created again under the same name must be watched afresh.
        if (watchers.has(entry) && inodeOf(join(root, entry)) !== inodes.get(entry)) forget(entry);
        void add(entry);
      });
      watcher.on('error', (error) => {
        if (folder === '') fail(error);
        else forget(folder);
      });
      watchers.set(folder, watcher);
      const inode = inodeOf(join(root, folder));
      if (inode !== undefined) inodes.set(folder, inode);
    };

    /** Watches the folders below one already watched, listing it after its watch starts so nothing is missed. */
    const addChildren = async (folder: string): Promise<void> => {
      let entries: Dirent[];
      try {
        entries = await readdir(join(root, folder), { withFileTypes: true });
      } catch (error) {
        if (folder === '') fail(error instanceof Error ? error : new Error(String(error)));
        else forget(folder);
        return;
      }
      for (const entry of entries) {
        const child = join(folder, entry.name);
        // Symbolic links are not followed, so a link back up the tree cannot loop.
        if (entry.isDirectory() && relevant(child)) await add(child);
      }
    };

    /** Watches a folder and the relevant folders below it; a name that is a file or gone is ignored. */
    const add = async (folder: string): Promise<void> => {
      if (closed || watchers.has(folder)) return;
      try {
        watchFolder(folder);
      } catch {
        return;
      }
      await addChildren(folder);
    };

    watchFolder(''); // throws, like the recursive watch, when the root itself cannot be watched
    void addChildren('');

    return () => {
      closed = true;
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    };
  }
}

function inodeOf(path: string): number | undefined {
  try {
    return statSync(path).ino;
  } catch {
    return undefined;
  }
}
