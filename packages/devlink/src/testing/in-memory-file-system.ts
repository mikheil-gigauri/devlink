import type { DirEntry, FileSystem } from '../core/ports.ts';
import { joinPath } from '../core/util/path.ts';

/** A FileSystem held in memory. Passes the same contract suite as the real adapter. */
export class InMemoryFileSystem implements FileSystem {
  readonly #files = new Map<string, string>();
  readonly #dirs = new Set<string>(['/']);

  /** Seeds files in one call: `{ '/repo/package.json': '{...}' }`. */
  static with(files: Readonly<Record<string, string>>): InMemoryFileSystem {
    const fs = new InMemoryFileSystem();
    for (const [path, content] of Object.entries(files)) fs.#write(path, content);
    return fs;
  }

  /** Every file under a folder, keyed by absolute path. Handy for byte-for-byte assertions. */
  snapshot(under = '/'): Record<string, string> {
    const prefix = under === '/' ? '/' : `${normalize(under)}/`;
    return Object.fromEntries([...this.#files].filter(([path]) => path.startsWith(prefix)).sort());
  }

  async readText(path: string): Promise<string | undefined> {
    return this.#files.get(normalize(path));
  }

  async writeText(path: string, content: string): Promise<void> {
    this.#write(path, content);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalize(path);
    return this.#files.has(normalized) || this.#dirs.has(normalized);
  }

  async readDir(path: string): Promise<readonly DirEntry[]> {
    const dir = normalize(path);
    const prefix = dir === '/' ? '/' : `${dir}/`;
    const entries = new Map<string, boolean>();

    for (const file of this.#files.keys()) {
      const name = childName(file, prefix);
      if (name !== undefined) entries.set(name, entries.get(name) === true || file !== prefix + name);
    }
    for (const sub of this.#dirs) {
      const name = childName(sub, prefix);
      if (name !== undefined) entries.set(name, true);
    }

    return [...entries]
      .map(([name, isDirectory]) => ({ name, isDirectory }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async remove(path: string): Promise<void> {
    const target = normalize(path);
    const prefix = `${target}/`;
    for (const file of [...this.#files.keys()]) {
      if (file === target || file.startsWith(prefix)) this.#files.delete(file);
    }
    for (const dir of [...this.#dirs]) {
      if (dir === target || dir.startsWith(prefix)) this.#dirs.delete(dir);
    }
  }

  async copyDir(from: string, to: string, options: { readonly exclude: readonly string[] }): Promise<void> {
    const source = normalize(from);
    const prefix = `${source}/`;
    this.#mkdirs(normalize(to));

    for (const [file, content] of [...this.#files]) {
      if (!file.startsWith(prefix)) continue;
      const relative = file.slice(prefix.length);
      if (relative.split('/').some((segment) => options.exclude.includes(segment))) continue;
      this.#write(joinPath(to, relative), content);
    }
  }

  #write(path: string, content: string): void {
    const normalized = normalize(path);
    this.#mkdirs(parentOf(normalized));
    this.#files.set(normalized, content);
  }

  #mkdirs(dir: string): void {
    for (let current = dir; current !== '/'; current = parentOf(current)) this.#dirs.add(current);
  }
}

function normalize(path: string): string {
  return joinPath('/', path);
}

function parentOf(path: string): string {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

function childName(path: string, prefix: string): string | undefined {
  if (!path.startsWith(prefix) || path === prefix) return undefined;
  return path.slice(prefix.length).split('/')[0];
}
