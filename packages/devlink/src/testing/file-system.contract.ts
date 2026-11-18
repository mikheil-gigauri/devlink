import { beforeEach, describe, expect, it } from 'vitest';
import type { FileSystem } from '../core/ports.ts';

export interface FileSystemFixture {
  readonly fs: FileSystem;
  /** An empty absolute folder the suite may write into. */
  readonly root: string;
}

/**
 * Behaviour every FileSystem adapter must share (ADR 0009). Run it against the in-memory fake and
 * the real Node adapter so the fake can never drift from reality.
 */
export function describeFileSystemContract(name: string, setup: () => Promise<FileSystemFixture>): void {
  describe(`FileSystem contract: ${name}`, () => {
    let fs: FileSystem;
    let root: string;

    beforeEach(async () => {
      ({ fs, root } = await setup());
    });

    it('reads back what it wrote', async () => {
      await fs.writeText(`${root}/a.txt`, 'hello');
      expect(await fs.readText(`${root}/a.txt`)).toBe('hello');
    });

    it('returns undefined for a missing file', async () => {
      expect(await fs.readText(`${root}/missing.txt`)).toBeUndefined();
    });

    it('creates parent folders when writing', async () => {
      await fs.writeText(`${root}/x/y/z.txt`, '1');
      expect(await fs.exists(`${root}/x/y`)).toBe(true);
    });

    it('lists folder entries sorted by name with their kind', async () => {
      await fs.writeText(`${root}/b.txt`, '');
      await fs.writeText(`${root}/a/inner.txt`, '');
      expect(await fs.readDir(root)).toEqual([
        { name: 'a', isDirectory: true },
        { name: 'b.txt', isDirectory: false },
      ]);
    });

    it('lists a missing folder as empty', async () => {
      expect(await fs.readDir(`${root}/nope`)).toEqual([]);
    });

    it('removes a folder recursively', async () => {
      await fs.writeText(`${root}/dir/one.txt`, '');
      await fs.writeText(`${root}/dir/sub/two.txt`, '');
      await fs.remove(`${root}/dir`);
      expect(await fs.exists(`${root}/dir`)).toBe(false);
    });

    it('removes a single file and leaves siblings', async () => {
      await fs.writeText(`${root}/keep.txt`, 'k');
      await fs.writeText(`${root}/drop.txt`, 'd');
      await fs.remove(`${root}/drop.txt`);
      expect(await fs.readDir(root)).toEqual([{ name: 'keep.txt', isDirectory: false }]);
    });

    it('ignores removing a path that does not exist', async () => {
      await expect(fs.remove(`${root}/never`)).resolves.toBeUndefined();
    });

    it('copies a folder, skipping excluded names at any depth', async () => {
      await fs.writeText(`${root}/src/package.json`, '{}');
      await fs.writeText(`${root}/src/lib/index.js`, 'x');
      await fs.writeText(`${root}/src/node_modules/dep/index.js`, 'skip');
      await fs.writeText(`${root}/src/lib/node_modules/dep/index.js`, 'skip');

      await fs.copyDir(`${root}/src`, `${root}/out`, { exclude: ['node_modules'] });

      expect(await fs.readText(`${root}/out/package.json`)).toBe('{}');
      expect(await fs.readText(`${root}/out/lib/index.js`)).toBe('x');
      expect(await fs.exists(`${root}/out/node_modules`)).toBe(false);
      expect(await fs.exists(`${root}/out/lib/node_modules`)).toBe(false);
    });

    it('copies empty folders too', async () => {
      await fs.writeText(`${root}/src/assets/.keep`, '');
      await fs.remove(`${root}/src/assets/.keep`);

      await fs.copyDir(`${root}/src`, `${root}/out`, { exclude: [] });

      expect(await fs.readDir(`${root}/out`)).toEqual([{ name: 'assets', isDirectory: true }]);
    });

    it('refuses to copy a folder that does not exist', async () => {
      await expect(fs.copyDir(`${root}/missing`, `${root}/out`, { exclude: [] })).rejects.toThrow();
      expect(await fs.exists(`${root}/out`)).toBe(false);
    });
  });
}
