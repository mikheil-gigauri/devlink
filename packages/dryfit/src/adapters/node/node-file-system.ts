import { access, chmod, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { DirEntry, FileSystem } from '../../core/ports.ts';

/** The real file system. Must pass the same contract suite as the in-memory fake (ADR 0009). */
export class NodeFileSystem implements FileSystem {
  async readText(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return undefined;
      throw error;
    }
  }

  async writeText(path: string, content: string, options?: { readonly private?: boolean }): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    if (!options?.private) return writeFile(path, content, 'utf8');
    // `mode` only applies when the file is created, so tighten an existing one before writing to it.
    await chmod(path, 0o600).catch((error: unknown) => {
      if (!hasCode(error, 'ENOENT')) throw error;
    });
    await writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async readDir(path: string): Promise<readonly DirEntry[]> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      // Symlinked folders report isDirectory false, so discovery never follows a link into a loop.
      return entries
        .map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch (error) {
      if (hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR')) return [];
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    await rm(path, { recursive: true, force: true });
  }

  async copyDir(from: string, to: string, options: { readonly exclude: readonly string[] }): Promise<void> {
    await cp(from, to, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => source === from || !options.exclude.includes(basename(source)),
    });
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
