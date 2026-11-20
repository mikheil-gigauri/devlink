import { describe, expect, it } from 'vitest';
import { installSpec } from '../../testing/install-spec.ts';
import { bun } from './bun.ts';

describe('bun adapter', () => {
  it('writes the text bun.lock', () => {
    expect(bun.lockfiles).toEqual(['bun.lock']);
  });

  describe('install', () => {
    it('installs the dev build’s tarball straight from the local registry', () => {
      // `--registry` does not override a scope mapped in .npmrc or bunfig.toml; a tarball URL does.
      expect(bun.install(installSpec(['@acme/ui']))).toEqual({
        command: 'bun',
        args: ['add', '@acme/ui@http://127.0.0.1:4873/@acme/ui/-/ui-1.4.1-dev.20261118143201.tgz'],
        cwd: '/apps/shop',
      });
    });

    it.each([
      ['dependencies', undefined],
      ['devDependencies', '--dev'],
      ['optionalDependencies', '--optional'],
      ['peerDependencies', '--peer'],
    ] as const)('keeps a package declared in %s in that field', (dependencyField, flag) => {
      const args = bun.install(installSpec([['@acme/ui', dependencyField]])).args;

      expect(args.slice(2)).toEqual(flag === undefined ? [] : [flag]);
    });

    it('installs several dev builds in one run, keeping each in its field when they differ', () => {
      const args = bun.install(
        installSpec([
          ['@acme/common', 'dependencies'],
          ['@acme/ui', 'devDependencies'],
        ]),
      ).args;

      expect(args).toEqual([
        'add',
        '@acme/common@http://127.0.0.1:4873/@acme/common/-/common-1.4.1-dev.20261118143201.tgz',
        '@acme/ui@http://127.0.0.1:4873/@acme/ui/-/ui-1.4.1-dev.20261118143201.tgz',
      ]);
    });
  });

  describe('cleanInstall', () => {
    it('installs exactly from the lockfile when there is one', () => {
      expect(bun.cleanInstall({ cwd: '/apps/shop', hasLockfile: true })).toEqual({
        command: 'bun',
        args: ['install', '--frozen-lockfile'],
        cwd: '/apps/shop',
      });
    });

    it('installs without writing a lockfile when there was none', () => {
      expect(bun.cleanInstall({ cwd: '/apps/shop', hasLockfile: false }).args).toEqual([
        'install',
        '--no-save',
      ]);
    });
  });
});
