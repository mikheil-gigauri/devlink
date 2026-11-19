import { describe, expect, it } from 'vitest';
import { npm, npmPublisher } from './npm.ts';

const registryUrl = 'http://127.0.0.1:4873/';

describe('npm adapter', () => {
  describe('install', () => {
    const base = {
      cwd: '/apps/shop',
      version: '1.4.1-dev.20261118143201',
      dependencyField: 'dependencies',
      registryUrl,
    } as const;

    it('pins the exact version and points only the package scope at the local registry', () => {
      expect(npm.install({ ...base, packageName: '@acme/ui' })).toEqual({
        command: 'npm',
        args: [
          'install',
          '@acme/ui@1.4.1-dev.20261118143201',
          '--save-exact',
          '--@acme:registry=http://127.0.0.1:4873/',
          '--no-audit',
          '--no-fund',
        ],
        cwd: '/apps/shop',
      });
    });

    it('uses the local registry for everything when the package is unscoped', () => {
      expect(npm.install({ ...base, packageName: 'ui-kit' }).args).toContain(
        '--registry=http://127.0.0.1:4873/',
      );
    });

    it.each([
      ['dependencies', undefined],
      ['devDependencies', '--save-dev'],
      ['optionalDependencies', '--save-optional'],
      ['peerDependencies', '--save-peer'],
    ] as const)('keeps a package declared in %s in that field', (dependencyField, flag) => {
      const args = npm.install({ ...base, packageName: '@acme/ui', dependencyField }).args;
      const saveFlags = args.filter((arg) => /^--save-(dev|optional|peer)$/.test(arg));

      expect(saveFlags).toEqual(flag === undefined ? [] : [flag]);
    });
  });

  describe('cleanInstall', () => {
    it('installs exactly from the lockfile when there is one', () => {
      expect(npm.cleanInstall({ cwd: '/apps/shop', hasLockfile: true })).toEqual({
        command: 'npm',
        args: ['ci', '--no-audit', '--no-fund'],
        cwd: '/apps/shop',
      });
    });

    it('falls back to a plain install when there is no lockfile', () => {
      expect(npm.cleanInstall({ cwd: '/apps/shop', hasLockfile: false }).args).toEqual([
        'install',
        '--no-package-lock',
        '--no-audit',
        '--no-fund',
      ]);
    });
  });

  describe('publish', () => {
    it('publishes to the local registry under the given dist-tag, never with provenance', () => {
      expect(npmPublisher.publish({ cwd: '/staging/ui', registryUrl, tag: 'devlink' })).toEqual({
        command: 'npm',
        args: ['publish', '--registry=http://127.0.0.1:4873/', '--tag=devlink', '--provenance=false'],
        cwd: '/staging/ui',
      });
    });

    const credentials = { username: 'devlink', password: 's3cret' };

    it('authenticates through an .npmrc in the staging folder, keeping credentials out of the process list', () => {
      // base64('devlink:s3cret'): npm sends it as HTTP Basic auth.
      expect(npmPublisher.publishAuthFiles({ registryUrl, credentials })).toEqual({
        '.npmrc': '//127.0.0.1:4873/:_auth=ZGV2bGluazpzM2NyZXQ=\n',
      });
    });

    it('scopes the credentials to the registry host and path', () => {
      expect(
        npmPublisher.publishAuthFiles({ registryUrl: 'http://127.0.0.1:4873/sub', credentials }),
      ).toEqual({
        '.npmrc': '//127.0.0.1:4873/sub/:_auth=ZGV2bGluazpzM2NyZXQ=\n',
      });
    });
  });
});
