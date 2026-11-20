import { describe, expect, it } from 'vitest';
import { installSpec } from '../../testing/install-spec.ts';
import { pnpm } from './pnpm.ts';

describe('pnpm adapter', () => {
  it('writes pnpm-lock.yaml', () => {
    expect(pnpm.lockfiles).toEqual(['pnpm-lock.yaml']);
  });

  describe('install', () => {
    it('pins the exact version, points only the scope at the local registry, and lets a fresh build in', () => {
      expect(pnpm.install(installSpec(['@acme/ui']))).toEqual({
        command: 'pnpm',
        args: [
          'add',
          '@acme/ui@1.4.1-dev.20261118143201',
          '--save-exact',
          '--config.@acme:registry=http://127.0.0.1:4873/',
          // A dev build is seconds old; pnpm's release-age gate would otherwise refuse it.
          '--config.minimumReleaseAge=0',
        ],
        cwd: '/apps/shop',
      });
    });

    it('uses the local registry for everything when the package is unscoped', () => {
      expect(pnpm.install(installSpec(['ui-kit'])).args).toContain(
        '--config.registry=http://127.0.0.1:4873/',
      );
    });

    it.each([
      ['dependencies', undefined],
      ['devDependencies', '--save-dev'],
      ['optionalDependencies', '--save-optional'],
      ['peerDependencies', '--save-peer'],
    ] as const)('keeps a package declared in %s in that field', (dependencyField, flag) => {
      const args = pnpm.install(installSpec([['@acme/ui', dependencyField]])).args;

      expect(args.filter((arg) => /^--save-(dev|optional|peer)$/.test(arg))).toEqual(
        flag === undefined ? [] : [flag],
      );
    });

    it('installs several dev builds in one run, keeping each in its field when they differ', () => {
      const args = pnpm.install(
        installSpec([
          ['@acme/common', 'dependencies'],
          ['@acme/ui', 'devDependencies'],
        ]),
      ).args;

      expect(args).toEqual([
        'add',
        '@acme/common@1.4.1-dev.20261118143201',
        '@acme/ui@1.4.1-dev.20261118143201',
        '--save-exact',
        '--config.@acme:registry=http://127.0.0.1:4873/',
        '--config.minimumReleaseAge=0',
      ]);
    });
  });

  describe('cleanInstall', () => {
    it('installs exactly from the lockfile when there is one', () => {
      expect(pnpm.cleanInstall({ cwd: '/apps/shop', hasLockfile: true })).toEqual({
        command: 'pnpm',
        args: ['install', '--frozen-lockfile'],
        cwd: '/apps/shop',
      });
    });

    it('installs without writing a lockfile when there was none', () => {
      expect(pnpm.cleanInstall({ cwd: '/apps/shop', hasLockfile: false }).args).toEqual([
        'install',
        '--config.lockfile=false',
      ]);
    });
  });
});
