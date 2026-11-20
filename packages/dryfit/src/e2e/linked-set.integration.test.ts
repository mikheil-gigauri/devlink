import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeDeps } from '../adapters/node/node-deps.ts';
import { npmPublisher } from '../adapters/package-managers/npm.ts';
import type { VerdaccioRegistry } from '../adapters/registry/verdaccio-registry.ts';
import type { CoreDeps } from '../core/ports.ts';
import { linkConsumer, linkLibraries } from '../core/use-cases/link-consumer.ts';
import { registerLibrary } from '../core/use-cases/register-library.ts';
import { restoreConsumer } from '../core/use-cases/restore-consumer.ts';
import { syncLibrary } from '../core/use-cases/sync-library.ts';
import { RecordingEventSink } from '../testing/fakes.ts';
import { createRegistrySandbox, type RegistrySandbox } from '../testing/registry-sandbox.ts';

/**
 * ADR 0014 end to end with nothing faked: two libraries from one workspace, where `ui` peers on
 * `common` exactly, the way Nx release pins them. Released `ui@1.0.0` pins `common@"1.0.0"`, so a dev
 * build of either cannot be installed into an app on its own, and each dev build has to pin the
 * other's.
 */
const COMMON = '@fixture/common';
const UI = '@fixture/ui';

/** Writes dist/ like a library build: the manifest with its pins as in source, and code using the message. */
const BUILD = [
  "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
  "const { name, version, peerDependencies } = JSON.parse(readFileSync('package.json', 'utf8'));",
  "const message = readFileSync('src/message.txt', 'utf8');",
  "mkdirSync('dist', { recursive: true });",
  "writeFileSync('dist/package.json', JSON.stringify({ name, version, main: 'index.js', peerDependencies }));",
  "const common = name === '@fixture/ui' ? \" + ' on ' + require('@fixture/common').message\" : '';",
  "const code = 'exports.message = ' + JSON.stringify(message) + common + ';';",
  "writeFileSync('dist/index.js', code);",
].join('\n');

describe('libraries that pin each other exactly, against real npm and Verdaccio', () => {
  let sandbox: RegistrySandbox;
  let publicRegistry: VerdaccioRegistry;
  let deps: CoreDeps;
  const events = new RecordingEventSink();
  let commonRoot: string;
  let uiRoot: string;
  let shop: string;
  let admin: string;
  const originals = new Map<string, string | undefined>();
  const originalTrees = new Map<string, unknown>();

  const read = (path: string) => readFile(path, 'utf8').catch(() => undefined);
  const run = async (consumer: string) =>
    (
      await sandbox.run(process.execPath, ['-p', `require(${JSON.stringify(UI)}).message`], consumer)
    ).stdout.trim();
  const installedTree = async (consumer: string): Promise<unknown> =>
    JSON.parse((await sandbox.run('npm', ['ls', '--all', '--json'], consumer)).stdout);
  const installedManifest = async (consumer: string, name: string) =>
    JSON.parse((await read(join(consumer, 'node_modules', name, 'package.json'))) ?? '{}');
  const edit = (root: string, message: string) => writeFile(join(root, 'src', 'message.txt'), message);

  beforeAll(async () => {
    sandbox = await createRegistrySandbox();
    publicRegistry = sandbox.registry;
    const dryfitRegistry = await sandbox.startRegistry('dryfit-registry', {
      public: { url: publicRegistry.url },
    });

    const library = (dir: string, manifest: object) =>
      sandbox.writePackage(
        join(sandbox.dir, 'ws', 'libs', dir),
        { version: '1.0.0', private: true, ...manifest },
        {
          'src/message.txt': 'release',
          'build.mjs': BUILD,
        },
      );
    commonRoot = await library('common', { name: COMMON });
    uiRoot = await library('ui', { name: UI, peerDependencies: { [COMMON]: '1.0.0' } });

    // Release both to the public registry, as the workspace's CI would have.
    for (const root of [commonRoot, uiRoot]) {
      await sandbox.run(process.execPath, ['build.mjs'], root);
      const dist = join(root, 'dist');
      const auth = npmPublisher.publishAuthFiles({
        registryUrl: publicRegistry.url,
        credentials: publicRegistry.credentials,
      });
      for (const [file, content] of Object.entries(auth)) await writeFile(join(dist, file), content);
      await sandbox.run('npm', ['publish', `--registry=${publicRegistry.url}`, '--provenance=false'], dist);
    }

    const app = async (name: string) => {
      const dir = await sandbox.writePackage(join(sandbox.dir, 'repos', name), {
        name,
        private: true,
        dependencies: { [COMMON]: '1.0.0', [UI]: '1.0.0' },
      });
      await writeFile(join(dir, '.npmrc'), `@fixture:registry=${publicRegistry.url}\n`);
      await sandbox.run('npm', ['install'], dir);
      for (const file of ['package.json', 'package-lock.json', '.npmrc']) {
        originals.set(join(dir, file), await read(join(dir, file)));
      }
      originalTrees.set(dir, await installedTree(dir));
      return dir;
    };
    shop = await app('shop');
    admin = await app('admin');

    deps = createNodeDeps({
      home: join(sandbox.dir, 'dryfit-home'),
      registry: dryfitRegistry,
      events,
      process: sandbox.runner,
    });
    for (const root of [commonRoot, uiRoot]) {
      await registerLibrary(deps, {
        root,
        publishDir: 'dist',
        build: { command: process.execPath, args: ['build.mjs'] },
      });
    }
  });
  afterAll(() => sandbox?.dispose());

  it('starts from the released pair', async () => {
    expect(await run(shop)).toBe('release on release');
  });

  it('leaves a tree npm refuses to build on when common is installed alone, as in the Nx workspace', async () => {
    await linkConsumer(deps, { library: COMMON, consumer: shop });
    await edit(commonRoot, 'common edit');

    const result = await syncLibrary(deps, { library: COMMON });

    // npm lets the root's own dependency override ui's exact peer once, then refuses every later install.
    expect(result.installs.map((install) => install.ok)).toEqual([true]);
    const later = await sandbox.runner.run({ command: 'npm', args: ['install'], cwd: shop });
    expect(later.exitCode).not.toBe(0);
    expect(later.stderr).toMatch(/ERESOLVE[\s\S]*peer @fixture\/common@"1\.0\.0" from @fixture\/ui@1\.0\.0/);
  });

  it('installs both together once ui is linked too, with ui’s dev build pinning common’s', async () => {
    await linkConsumer(deps, { library: UI, consumer: shop });
    await edit(uiRoot, 'ui edit');

    const result = await syncLibrary(deps, { library: UI });

    expect(result.installs.map((install) => install.ok)).toEqual([true]);
    expect(await run(shop)).toBe('ui edit on common edit');
    const common = (await installedManifest(shop, COMMON)).version;
    expect((await installedManifest(shop, UI)).peerDependencies).toEqual({ [COMMON]: common });
    // npm ls exits non-zero on an invalid peer, and a plain install is accepted again.
    await installedTree(shop);
    await sandbox.run('npm', ['install'], shop);
  });

  it('republishes ui when common changes, so the pair stays pinned to each other', async () => {
    await edit(commonRoot, 'second common edit');

    const result = await syncLibrary(deps, { library: COMMON });

    expect(result.published.map((entry) => entry.library)).toEqual([COMMON, UI]);
    expect(result.installs.map((install) => install.ok)).toEqual([true]);
    expect(await run(shop)).toBe('ui edit on second common edit');
    expect((await installedManifest(shop, UI)).peerDependencies).toEqual({ [COMMON]: result.version });
    await installedTree(shop);
    // Only the staged copy was pinned; the build output keeps the workspace's own pin.
    expect(await read(join(uiRoot, 'dist', 'package.json'))).toContain(`"${COMMON}":"1.0.0"`);
  });

  it('refuses ui alone in another app with npm’s reason, and names the library to link with it', async () => {
    const link = await linkConsumer(deps, { library: UI, consumer: admin });

    expect(link.status).toBe('failed');
    const failure = events.events.findLast((event) => event.type === 'install:failed');
    const output = failure && 'output' in failure ? failure.output : '';
    expect(output).toMatch(/ERESOLVE/);
    expect(output).toContain(`dryfit link ${admin} --library ${UI} --library ${COMMON}`);
    expect(await run(admin)).toBe('release on release');
  });

  it('installs the pair into that app once they are linked together', async () => {
    const links = await linkLibraries(deps, { libraries: [COMMON, UI], consumer: admin });

    expect(links.map((link) => link.status)).toEqual(['installed', 'installed']);
    expect(await run(admin)).toBe('ui edit on second common edit');
    await installedTree(admin);
  });

  it('restores both apps byte for byte and reinstalls the released tree', async () => {
    expect(await restoreConsumer(deps, { consumer: shop })).toEqual({ ok: true });
    expect(await restoreConsumer(deps, { consumer: admin, library: UI })).toEqual({
      ok: true,
      libraries: [UI, COMMON],
    });

    for (const [file, content] of originals)
      expect({ file, content: await read(file) }).toEqual({ file, content });
    for (const [dir, tree] of originalTrees) expect(await installedTree(dir)).toEqual(tree);
    expect([await run(shop), await run(admin)]).toEqual(['release on release', 'release on release']);
    expect((await deps.state.load()).links).toEqual([]);
  });
});
