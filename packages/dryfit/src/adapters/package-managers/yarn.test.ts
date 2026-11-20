import { describe, expect, it } from 'vitest';
import { installSpec } from '../../testing/install-spec.ts';
import { yarn } from './yarn.ts';

describe('yarn adapter (Yarn 2 and later)', () => {
  it('writes yarn.lock', () => {
    expect(yarn.lockfiles).toEqual(['yarn.lock']);
  });

  describe('install', () => {
    it('installs the dev build’s tarball straight from the local registry', () => {
      // Yarn takes per-scope registries only from .yarnrc.yml, which dryfit does not edit, so a
      // tarball URL is the one way past a scope the project maps to its own registry.
      expect(yarn.install(installSpec(['@acme/ui']))).toEqual({
        command: 'yarn',
        args: ['add', '@acme/ui@http://127.0.0.1:4873/@acme/ui/-/ui-1.4.1-dev.20261118143201.tgz'],
        cwd: '/apps/shop',
        env: { YARN_ENABLE_IMMUTABLE_INSTALLS: 'false', YARN_UNSAFE_HTTP_WHITELIST: '127.0.0.1' },
      });
    });

    it('names an unscoped tarball after the package', () => {
      expect(yarn.install(installSpec(['ui-kit'])).args[1]).toBe(
        'ui-kit@http://127.0.0.1:4873/ui-kit/-/ui-kit-1.4.1-dev.20261118143201.tgz',
      );
    });

    it('allows no plain-http host when the registry is served over https', () => {
      const spec = yarn.install(installSpec(['@acme/ui'], 'https://dev.example/r'));

      expect(spec.args[1]).toBe('@acme/ui@https://dev.example/r/@acme/ui/-/ui-1.4.1-dev.20261118143201.tgz');
      expect(spec.env).toEqual({ YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' });
    });

    it.each([
      ['dependencies', undefined],
      ['devDependencies', '--dev'],
      ['optionalDependencies', '--optional'],
      ['peerDependencies', '--peer'],
    ] as const)('keeps a package declared in %s in that field', (dependencyField, flag) => {
      const args = yarn.install(installSpec([['@acme/ui', dependencyField]])).args;

      expect(args.slice(2)).toEqual(flag === undefined ? [] : [flag]);
    });

    it('installs several dev builds in one run, keeping each in its field when they differ', () => {
      const args = yarn.install(
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
      expect(yarn.cleanInstall({ cwd: '/apps/shop', hasLockfile: true })).toEqual({
        command: 'yarn',
        args: ['install', '--immutable'],
        cwd: '/apps/shop',
      });
    });

    it('installs from the manifest when there was no lockfile, even on CI', () => {
      // Yarn writes a lockfile regardless; restore removes it afterwards.
      expect(yarn.cleanInstall({ cwd: '/apps/shop', hasLockfile: false })).toEqual({
        command: 'yarn',
        args: ['install'],
        cwd: '/apps/shop',
        env: { YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' },
      });
    });
  });
});
