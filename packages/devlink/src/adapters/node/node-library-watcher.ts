import { type FSWatcher, watch } from 'node:fs';
import { relative, sep } from 'node:path';
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
 * Watches a library's folder recursively (FSEvents on macOS, inotify on Linux) and reports a burst of
 * changes as one, after a quiet period (ADR 0012). Changes inside the publish folder are ignored even
 * when it sits inside the library, or every build would trigger the next one.
 */
export class NodeLibraryWatcher implements LibraryWatcher {
  readonly #debounceMs: number;

  constructor(options: { readonly debounceMs?: number } = {}) {
    this.#debounceMs = options.debounceMs ?? 400;
  }

  watch(
    library: Pick<LibraryRecord, 'name' | 'root' | 'publishDir'>,
    onChange: () => void,
    onError: (error: Error) => void,
  ): () => void {
    const publishDir = relative(library.root, library.publishDir);
    const ignorePublishDir = publishDir !== '' && !publishDir.startsWith('..');
    let timer: NodeJS.Timeout | undefined;
    let watcher: FSWatcher | undefined;

    const relevant = (filename: string | null) => {
      if (filename === null) return true;
      if (ignorePublishDir && (filename === publishDir || filename.startsWith(publishDir + sep)))
        return false;
      const segments = filename.split(sep);
      return (
        !segments.some((segment) => IGNORED_FOLDERS.has(segment)) && !IGNORED_FILE.test(segments.at(-1) ?? '')
      );
    };

    let ended = false;
    const fail = (error: Error) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      watcher?.close();
      onError(error);
    };
    try {
      watcher = watch(library.root, { recursive: true }, (_event, filename) => {
        if (!relevant(filename)) return;
        clearTimeout(timer);
        timer = setTimeout(onChange, this.#debounceMs);
      });
      // A deleted or unmounted folder, or running out of file handles, ends the watch.
      watcher.on('error', fail);
    } catch (error) {
      // Reported once the caller has the stop function, as a later error would be.
      setImmediate(() => fail(error instanceof Error ? error : new Error(String(error))));
    }

    return () => {
      ended = true;
      clearTimeout(timer);
      watcher?.close();
    };
  }
}
