import { describe, expect, it } from 'vitest';
import { yarn } from './yarn.ts';

const base = {
  cwd: '/apps/shop',
  version: '1.4.1-dev.20261118143201',
  dependencyField: 'dependencies',
  registryUrl: 'http://127.0.0.1:4873/',
} as const;

describe('yarn adapter (Yarn 2 and later)', () => {
  it('writes yarn.lock', () => {
    expect(yarn.lockfiles).toEqual(['yarn.lock']);
  });

  describe('install', () => {
    it('installs the dev build’s tarball straight from the local registry', () => {
      // Yarn takes per-scope registries only from .yarnrc.yml, which devlink does not edit, so a
      // tarball URL is the one way past a scope the project maps to its own registry.
      expect(yarn.install({ ...base, packageName: '@acme/ui' })).toEqual({
        command: 'yarn',
        args: ['add', '@acme/ui@http://127.0.0.1:4873/@acme/ui/-/ui-1.4.1-dev.20261118143201.tgz'],
        cwd: '/apps/shop',
        env: { YARN_ENABLE_IMMUTABLE_INSTALLS: 'false', YARN_UNSAFE_HTTP_WHITELIST: '127.0.0.1' },
      });
    });

    it('names an unscoped tarball after the package', () => {
      expect(yarn.install({ ...base, packageName: 'ui-kit' }).args[1]).toBe(
        'ui-kit@http://127.0.0.1:4873/ui-kit/-/ui-kit-1.4.1-dev.20261118143201.tgz',
      );
    });

    it('allows no plain-http host when the registry is served over https', () => {
      const spec = yarn.install({ ...base, packageName: '@acme/ui', registryUrl: 'https://dev.example/r' });

      expect(spec.args[1]).toBe('@acme/ui@https://dev.example/r/@acme/ui/-/ui-1.4.1-dev.20261118143201.tgz');
      expect(spec.env).toEqual({ YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' });
    });

    it.each([
      ['dependencies', undefined],
      ['devDependencies', '--dev'],
      ['optionalDependencies', '--optional'],
      ['peerDependencies', '--peer'],
    ] as const)('keeps a package declared in %s in that field', (dependencyField, flag) => {
      const args = yarn.install({ ...base, packageName: '@acme/ui', dependencyField }).args;

      expect(args.slice(2)).toEqual(flag === undefined ? [] : [flag]);
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
