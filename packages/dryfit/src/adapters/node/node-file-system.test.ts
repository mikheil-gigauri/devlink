import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { describeFileSystemContract } from '../../testing/file-system.contract.ts';
import { createTempDir } from '../../testing/temp-dir.ts';
import { NodeFileSystem } from './node-file-system.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describeFileSystemContract('NodeFileSystem', async () => {
  const dir = await createTempDir();
  cleanups.push(dir.cleanup);
  return { fs: new NodeFileSystem(), root: dir.path };
});

describe('NodeFileSystem private files', () => {
  const mode = async (path: string) => (await stat(path)).mode & 0o777;

  it('makes a private file readable by its owner only', async () => {
    const dir = await createTempDir();
    cleanups.push(dir.cleanup);
    const path = join(dir.path, 'nested', '.npmrc');

    await new NodeFileSystem().writeText(path, 'secret', { private: true });

    expect(await mode(path)).toBe(0o600);
  });

  it('tightens a file that already existed with looser permissions', async () => {
    const dir = await createTempDir();
    cleanups.push(dir.cleanup);
    const path = join(dir.path, '.npmrc');
    await writeFile(path, 'old', { mode: 0o644 });

    await new NodeFileSystem().writeText(path, 'secret', { private: true });

    expect(await mode(path)).toBe(0o600);
  });
});
