import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PackageManagerAdapter, PublishSpec } from '../core/ports.ts';
import { createRegistrySandbox, distTags, type RegistrySandbox } from './registry-sandbox.ts';

const LIB = '@fixture/ui';
const RELEASE = '1.0.0';
const DEV = '1.0.1-dev.20261118143201';
const FORMS = '@fixture/forms';

/**
 * What every package manager adapter must do against a real registry with the real tool (ADR 0006,
 * ADR 0009). "Supports pnpm" means this suite passes for the pnpm adapter.
 */
export function describePackageManagerContract(adapter: PackageManagerAdapter): void {
  describe(`PackageManagerAdapter contract: ${adapter.name}`, () => {
    let sandbox: RegistrySandbox;
    let consumerCount = 0;

    const exec = async (spec: { command: string; args: readonly string[]; cwd: string }) =>
      sandbox.run(spec.command, spec.args, spec.cwd);

    const publish = async (
      version: string,
      tag: string,
      code: string,
      { name = LIB, manifest = {} }: { name?: string; manifest?: object } = {},
    ) => {
      const dir = await sandbox.writePackage(
        join(sandbox.dir, `publish-${name.replace('/', '_')}-${version}`),
        { name, version, main: 'index.js', ...manifest },
        { 'index.js': `module.exports = ${code};\n` },
      );
      const spec: PublishSpec = { cwd: dir, registryUrl: sandbox.registry.url, tag };
      for (const [file, content] of Object.entries(
        adapter.publishAuthFiles({
          registryUrl: sandbox.registry.url,
          credentials: sandbox.registry.credentials,
        }),
      )) {
        await writeFile(join(dir, file), content);
      }
      await exec(adapter.publish(spec));
    };

    /** A consumer that depends on the released library, installed the way a developer would have. */
    const createConsumer = async (
      field: 'dependencies' | 'devDependencies' = 'dependencies',
      otherDependencies: Readonly<Record<string, string>> = {},
    ) => {
      const dir = await sandbox.writePackage(join(sandbox.dir, `consumer-${++consumerCount}`), {
        name: `consumer-${consumerCount}`,
        version: '0.0.0',
        private: true,
        [field]: { [LIB]: `^${RELEASE}`, ...otherDependencies },
      });
      await writeFile(join(dir, '.npmrc'), `@fixture:registry=${sandbox.registry.url}\n`);
      await sandbox.run('npm', ['install'], dir);
      return dir;
    };

    const requireLib = async (cwd: string) =>
      (await sandbox.run(process.execPath, ['-p', `require(${JSON.stringify(LIB)})`], cwd)).stdout.trim();

    const manifestOf = async (cwd: string) => JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));

    beforeAll(async () => {
      sandbox = await createRegistrySandbox();
      await publish(RELEASE, 'latest', JSON.stringify('release'));
      await publish(DEV, 'devlink', JSON.stringify('dev build'));
      // A sibling package that peers on the library, re-exporting whichever copy it resolves.
      await publish(RELEASE, 'latest', `require(${JSON.stringify(LIB)})`, {
        name: FORMS,
        manifest: { peerDependencies: { [LIB]: `^${RELEASE}` } },
      });
    });
    afterAll(() => sandbox?.dispose());

    it('publishes under the dev tag, leaving latest on the release', async () => {
      expect(await distTags(sandbox.registry, LIB)).toEqual({ latest: RELEASE, devlink: DEV });
    });

    it('installs the exact dev version, and the consumer runs its code', async () => {
      const consumer = await createConsumer();

      await exec(
        adapter.install({
          cwd: consumer,
          packageName: LIB,
          version: DEV,
          dependencyField: 'dependencies',
          registryUrl: sandbox.registry.url,
        }),
      );

      expect((await manifestOf(consumer)).dependencies).toEqual({ [LIB]: DEV });
      expect(await requireLib(consumer)).toBe('dev build');
    });

    it('keeps the package in devDependencies when it was declared there', async () => {
      const consumer = await createConsumer('devDependencies');

      await exec(
        adapter.install({
          cwd: consumer,
          packageName: LIB,
          version: DEV,
          dependencyField: 'devDependencies',
          registryUrl: sandbox.registry.url,
        }),
      );

      const manifest = await manifestOf(consumer);
      expect(manifest.devDependencies).toEqual({ [LIB]: DEV });
      expect(manifest.dependencies).toBeUndefined();
    });

    it('never ships the publish credentials, even when the package lists them in `files`', async () => {
      const leaky = `${RELEASE}-leaky.0`;
      await publish(leaky, 'devlink', '"leaky"', { manifest: { files: ['index.js', '.npmrc'] } });
      const consumer = await createConsumer();
      await exec(
        adapter.install({
          cwd: consumer,
          packageName: LIB,
          version: leaky,
          dependencyField: 'dependencies',
          registryUrl: sandbox.registry.url,
        }),
      );

      const installed = join(consumer, 'node_modules', LIB);
      expect(await readFile(join(installed, 'index.js'), 'utf8')).toContain('leaky');
      await expect(readFile(join(installed, '.npmrc'), 'utf8')).rejects.toThrow(/ENOENT/);
    });

    it('finds the dev install in the lockfile, and nothing once the lockfile is put back', async () => {
      const consumer = await createConsumer();
      const lockfileName = adapter.lockfiles[0] ?? '';
      const original = await readFile(join(consumer, lockfileName), 'utf8');
      await exec(
        adapter.install({
          cwd: consumer,
          packageName: LIB,
          version: DEV,
          dependencyField: 'dependencies',
          registryUrl: sandbox.registry.url,
        }),
      );

      const leaks = adapter.findRegistryLeaks(
        await readFile(join(consumer, lockfileName), 'utf8'),
        sandbox.registry.url,
      );
      // The fixture's release also comes from a local registry, so only check the dev version is caught.
      expect(leaks.filter((leak) => leak.reasons.includes('dev-version'))).toHaveLength(1);
      expect(adapter.findRegistryLeaks(original, 'http://127.0.0.1:1/')).toEqual([]);
    });

    it('reinstalls exactly what a restored lockfile says', async () => {
      const consumer = await createConsumer();
      const lockfileName = adapter.lockfiles[0] ?? '';
      const manifest = await readFile(join(consumer, 'package.json'), 'utf8');
      const lockfile = await readFile(join(consumer, lockfileName), 'utf8');
      await exec(
        adapter.install({
          cwd: consumer,
          packageName: LIB,
          version: DEV,
          dependencyField: 'dependencies',
          registryUrl: sandbox.registry.url,
        }),
      );

      await writeFile(join(consumer, 'package.json'), manifest);
      await writeFile(join(consumer, lockfileName), lockfile);
      await exec(adapter.cleanInstall({ cwd: consumer, hasLockfile: true }));

      expect(await requireLib(consumer)).toBe('release');
      expect(await readFile(join(consumer, lockfileName), 'utf8')).toBe(lockfile);
    });

    it('installs a dev version even when another dependency peers on a release range', async () => {
      // A prerelease never satisfies `^1.0.0` (ADR 0004). The adapter must still install it, and the
      // dependent must resolve the single dev copy rather than a second, released one.
      const consumer = await createConsumer('dependencies', { [FORMS]: `^${RELEASE}` });

      await exec(
        adapter.install({
          cwd: consumer,
          packageName: LIB,
          version: DEV,
          dependencyField: 'dependencies',
          registryUrl: sandbox.registry.url,
        }),
      );

      const viaForms = await sandbox.run(
        process.execPath,
        ['-p', `require(${JSON.stringify(FORMS)})`],
        consumer,
      );
      expect(viaForms.stdout.trim()).toBe('dev build');
      expect((await manifestOf(consumer)).overrides).toBeUndefined();
    });

    it('installs without creating a lockfile when there was none', async () => {
      const consumer = await createConsumer();
      for (const lockfile of adapter.lockfiles) await rm(join(consumer, lockfile), { force: true });

      await exec(adapter.cleanInstall({ cwd: consumer, hasLockfile: false }));

      expect(await requireLib(consumer)).toBe('release');
      for (const lockfile of adapter.lockfiles) {
        await expect(readFile(join(consumer, lockfile), 'utf8')).rejects.toThrow(/ENOENT/);
      }
    });
  });
}
