import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeDeps } from '../adapters/node/node-deps.ts';
import { npmPublisher } from '../adapters/package-managers/npm.ts';
import type { VerdaccioRegistry } from '../adapters/registry/verdaccio-registry.ts';
import { DEV_VERSION_PATTERN } from '../core/guard/commit-guard.ts';
import type { CoreDeps } from '../core/ports.ts';
import { linkConsumer } from '../core/use-cases/link-consumer.ts';
import { registerLibrary } from '../core/use-cases/register-library.ts';
import { restoreConsumer } from '../core/use-cases/restore-consumer.ts';
import { syncLibrary } from '../core/use-cases/sync-library.ts';
import { RecordingEventSink } from '../testing/fakes.ts';
import { createRegistrySandbox, distTags, type RegistrySandbox } from '../testing/registry-sandbox.ts';

/**
 * The M2 exit check, end to end with nothing faked: a library is linked into two consumers, they run
 * its new code through two edit cycles, and restoring leaves both byte-identical to before.
 *
 * Two registries: `public` stands in for registry.npmjs.org, holding the released 1.0.0; dryfit's own
 * registry proxies it, exactly as on a developer's machine.
 */
const LIB = '@fixture/ui';

describe('link → edit → sync → restore, against real npm and Verdaccio', () => {
  let sandbox: RegistrySandbox;
  let publicRegistry: VerdaccioRegistry;
  let dryfitRegistry: VerdaccioRegistry;
  let deps: CoreDeps;
  const events = new RecordingEventSink();
  let shop: string;
  let admin: string;
  let libRoot: string;
  const originals = new Map<string, string | undefined>();
  const originalTrees = new Map<string, unknown>();

  const read = (path: string) => readFile(path, 'utf8').catch(() => undefined);
  const trackedFiles = (consumer: string) =>
    ['package.json', 'package-lock.json', '.npmrc'].map((file) => join(consumer, file));
  const runInConsumer = async (consumer: string) =>
    (
      await sandbox.run(process.execPath, ['-p', `require(${JSON.stringify(LIB)}).message`], consumer)
    ).stdout.trim();
  const editLibrary = (message: string) => writeFile(join(libRoot, 'src', 'message.txt'), message);
  /** Every installed package with its version and the tarball URL it came from. */
  const installedTree = async (consumer: string): Promise<unknown> =>
    JSON.parse((await sandbox.run('npm', ['ls', '--all', '--json'], consumer)).stdout);

  beforeAll(async () => {
    sandbox = await createRegistrySandbox();
    publicRegistry = sandbox.registry;
    dryfitRegistry = await sandbox.startRegistry('dryfit-registry', {
      public: { url: publicRegistry.url },
    });

    // The library: sources plus a build that writes dist/, the way ng-packagr does.
    libRoot = await sandbox.writePackage(
      join(sandbox.dir, 'repos', 'ui-lib'),
      { name: LIB, version: '1.0.0', private: true },
      {
        'src/message.txt': 'release',
        'build.mjs': [
          "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
          "mkdirSync('dist', { recursive: true });",
          "const message = readFileSync('src/message.txt', 'utf8');",
          `writeFileSync('dist/package.json', JSON.stringify({ name: '${LIB}', version: '1.0.0', main: 'index.js' }));`,
          "writeFileSync('dist/index.js', 'exports.message = ' + JSON.stringify(message) + ';');",
        ].join('\n'),
      },
    );

    // Release 1.0.0 to the public registry, as CI would have.
    await sandbox.run(process.execPath, ['build.mjs'], libRoot);
    const dist = join(libRoot, 'dist');
    for (const [file, content] of Object.entries(
      npmPublisher.publishAuthFiles({
        registryUrl: publicRegistry.url,
        credentials: publicRegistry.credentials,
      }),
    )) {
      await writeFile(join(dist, file), content);
    }
    await sandbox.run('npm', ['publish', `--registry=${publicRegistry.url}`, '--provenance=false'], dist);

    // Two consumers installed from the public registry: one with a lockfile, one without.
    const consumer = async (name: string, field: string, installArgs: string[]) => {
      const dir = await sandbox.writePackage(join(sandbox.dir, 'repos', name), {
        name,
        private: true,
        [field]: { [LIB]: '^1.0.0' },
      });
      await writeFile(join(dir, '.npmrc'), `@fixture:registry=${publicRegistry.url}\n`);
      await sandbox.run('npm', ['install', ...installArgs], dir);
      return dir;
    };
    shop = await consumer('shop', 'dependencies', []);
    admin = await consumer('admin', 'devDependencies', ['--no-package-lock']);

    for (const file of [...trackedFiles(shop), ...trackedFiles(admin)]) originals.set(file, await read(file));
    for (const dir of [shop, admin]) originalTrees.set(dir, await installedTree(dir));

    deps = createNodeDeps({
      home: join(sandbox.dir, 'dryfit-home'),
      registry: dryfitRegistry,
      events,
      process: sandbox.runner,
    });
  });
  afterAll(() => sandbox?.dispose());

  it('starts from the released library', async () => {
    expect([await runInConsumer(shop), await runInConsumer(admin)]).toEqual(['release', 'release']);
    expect(originals.get(join(admin, 'package-lock.json'))).toBeUndefined();
  });

  it('runs the library’s new code in every linked consumer after each sync', async () => {
    await registerLibrary(deps, {
      root: libRoot,
      publishDir: 'dist',
      build: { command: process.execPath, args: ['build.mjs'] },
    });
    await linkConsumer(deps, { library: LIB, consumer: shop });
    await linkConsumer(deps, { library: LIB, consumer: admin });

    await editLibrary('first edit');
    const first = await syncLibrary(deps, { library: LIB });
    expect(first.installs.map((install) => install.ok)).toEqual([true, true]);
    expect([await runInConsumer(shop), await runInConsumer(admin)]).toEqual(['first edit', 'first edit']);

    await editLibrary('second edit');
    const second = await syncLibrary(deps, { library: LIB });
    expect(second.version > first.version).toBe(true);
    expect([await runInConsumer(shop), await runInConsumer(admin)]).toEqual(['second edit', 'second edit']);
    // The comparison the restore test relies on can tell a linked tree from the released one.
    for (const [dir, tree] of originalTrees) expect(await installedTree(dir)).not.toEqual(tree);
  });

  it('never moves latest off the real release, in either registry', async () => {
    expect((await distTags(publicRegistry, LIB)).latest).toBe('1.0.0');
    expect((await distTags(dryfitRegistry, LIB)).latest).toBe('1.0.0');
  });

  it('flags the linked lockfile so it cannot be committed by accident', async () => {
    const lockfile = (await read(join(shop, 'package-lock.json'))) ?? '';

    // The commit guard's pattern, which its pre-commit hook greps staged files for.
    expect(lockfile).toMatch(new RegExp(DEV_VERSION_PATTERN));
  });

  it('restores both consumers byte for byte and reinstalls the released tree (M2 exit check)', async () => {
    expect(await restoreConsumer(deps, { consumer: shop })).toEqual({ ok: true });
    expect(await restoreConsumer(deps, { consumer: admin })).toEqual({ ok: true });

    for (const [file, content] of originals)
      expect({ file, content: await read(file) }).toEqual({ file, content });
    for (const [dir, tree] of originalTrees) expect(await installedTree(dir)).toEqual(tree);
    expect([await runInConsumer(shop), await runInConsumer(admin)]).toEqual(['release', 'release']);
    expect((await deps.state.load()).links).toEqual([]);
  });
});
