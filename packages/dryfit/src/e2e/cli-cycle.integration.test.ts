import { chmod, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DryfitHome } from '../adapters/node/dryfit-home.ts';
import { NodeProcessRunner } from '../adapters/node/node-process-runner.ts';
import { npmPublisher } from '../adapters/package-managers/npm.ts';
import type { StatusView } from '../daemon/api.ts';
import { createRegistrySandbox, type RegistrySandbox } from '../testing/registry-sandbox.ts';

/**
 * The M3 exit check without the week of use: a full working session driven only through the `dryfit`
 * binary, against a real daemon process, real Verdaccio, real npm and real git.
 */
const LIB = '@fixture/ui';
const BIN = fileURLToPath(new URL('../cli/bin.ts', import.meta.url));
/** A hook the project already had (Husky-style, no trailing newline), which must survive linking. */
const OWN_HOOK = '#!/usr/bin/env sh\necho "lint-staged ran" >&2';

// The binary runs from source, which needs a Node that strips types (22.18+, or a flag before that).
describe.skipIf(!process.features.typescript)('a working session through the dryfit CLI', () => {
  let sandbox: RegistrySandbox;
  let home: DryfitHome;
  let cli: NodeProcessRunner;
  let git: NodeProcessRunner;
  let repos: string;
  let libRoot: string;
  let shop: string;
  let admin: string;
  const originals = new Map<string, string | undefined>();
  const originalTrees = new Map<string, unknown>();

  const dryfit = async (args: string[], cwd = repos) => {
    const result = await cli.run({ command: process.execPath, args: [BIN, ...args], cwd });
    return { ...result, json: () => JSON.parse(result.stdout) as unknown };
  };
  const read = (path: string) => readFile(path, 'utf8').catch(() => undefined);
  const tracked = (consumer: string) =>
    ['package.json', 'package-lock.json', '.npmrc'].map((file) => join(consumer, file));
  const message = async (consumer: string) =>
    (
      await sandbox.run(process.execPath, ['-p', `require(${JSON.stringify(LIB)}).message`], consumer)
    ).stdout.trim();
  const installedTree = async (consumer: string) =>
    JSON.parse((await sandbox.run('npm', ['ls', '--all', '--json'], consumer)).stdout) as unknown;
  const editLibrary = (text: string) => writeFile(join(libRoot, 'src', 'message.txt'), text);

  beforeAll(async () => {
    sandbox = await createRegistrySandbox();
    const publicRegistry = sandbox.registry;
    repos = join(sandbox.dir, 'repos');
    const userHome = join(sandbox.dir, 'user');
    home = new DryfitHome(join(userHome, '.dryfit'));

    // The developer's machine: npm points at the "public" registry, dryfit uses random ports.
    await sandbox.writePackage(
      userHome,
      { name: 'user-home', private: true },
      { '.npmrc': `registry=${publicRegistry.url}\n` },
    );
    await home.writeConfig({ roots: [], hiddenApps: [], ports: { api: 0, registry: 0 } });
    const env = { ...process.env, HOME: userHome, DRYFIT_HOME: home.root, NO_COLOR: '1' };
    cli = new NodeProcessRunner({ baseEnv: env, timeoutMs: 180_000 });
    git = new NodeProcessRunner({
      baseEnv: env,
      env: {
        GIT_AUTHOR_NAME: 'dryfit test',
        GIT_AUTHOR_EMAIL: 'test@dryfit.invalid',
        GIT_COMMITTER_NAME: 'dryfit test',
        GIT_COMMITTER_EMAIL: 'test@dryfit.invalid',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });

    libRoot = await sandbox.writePackage(
      join(repos, 'ui-lib'),
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

    const consumer = async (name: string, field: string, installArgs: string[]) => {
      const dir = await sandbox.writePackage(join(repos, name), {
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
    await git.run({ command: 'git', args: ['init', '-q'], cwd: shop });
    await writeFile(join(shop, '.git/hooks/pre-commit'), OWN_HOOK);
    await chmod(join(shop, '.git/hooks/pre-commit'), 0o755);

    for (const file of [...tracked(shop), ...tracked(admin)]) originals.set(file, await read(file));
    for (const dir of [shop, admin]) originalTrees.set(dir, await installedTree(dir));
  });

  afterAll(async () => {
    await dryfit(['daemon', 'stop']).catch(() => undefined);
    await sandbox?.dispose();
  });

  it('sets up: init starts the daemon, add registers the library, consumers finds both apps', async () => {
    const init = await dryfit(['init', '--root', repos]);
    expect(init.exitCode, init.stderr).toBe(0);
    expect(init.stdout).toContain('dryfit is ready');

    const add = await dryfit(
      ['add', '--build', `${process.execPath} build.mjs`, '--publish-dir', 'dist'],
      libRoot,
    );
    expect(add.exitCode, add.stderr).toBe(0);
    expect(add.stdout).toContain(`Registered ${LIB}`);

    const consumers = await dryfit(['consumers', '--json']);
    expect((consumers.json() as { root: string }[]).map((found) => found.root).sort()).toEqual([admin, shop]);
  });

  it('links a saved group, guarding the member that is a git repository', async () => {
    expect((await dryfit(['group', 'save', 'checkout', 'shop', 'admin'])).exitCode).toBe(0);

    const link = await dryfit(['link', '--group', 'checkout'], libRoot);

    expect(link.exitCode, link.stderr).toBe(0);
    expect(link.stdout).toContain(`Linked ${LIB} into`);
    const hook = await read(join(shop, '.git/hooks/pre-commit'));
    expect(hook).toContain('dryfit commit guard');
    expect(hook).toContain('lint-staged ran');
  });

  it('syncs: every member runs the new code, and the group agrees on one version', async () => {
    await editLibrary('first edit');

    const sync = await dryfit(['sync'], libRoot);

    expect(sync.exitCode, sync.stdout + sync.stderr).toBe(0);
    expect(sync.stdout).toContain(`Published ${LIB}@1.0.1-dev.`);
    expect([await message(shop), await message(admin)]).toEqual(['first edit', 'first edit']);
    const status = (await dryfit(['status', '--json'])).json() as StatusView;
    expect(status.links.map((link) => link.status)).toEqual(['installed', 'installed']);
    expect(status.warnings).toEqual([]);
  });

  it('refuses to commit the linked manifest and lockfile', async () => {
    await git.run({ command: 'git', args: ['add', 'package.json', 'package-lock.json'], cwd: shop });

    const commit = await git.run({ command: 'git', args: ['commit', '-m', 'oops'], cwd: shop });

    expect(commit.exitCode).toBe(1);
    expect(commit.stderr).toContain('point at a local dev build');
    await git.run({ command: 'git', args: ['reset', '-q'], cwd: shop });
  });

  it('watches: saving a library file reaches every linked consumer on its own', async () => {
    expect((await dryfit(['watch', '--detach'], libRoot)).exitCode).toBe(0);
    await sleep(300);

    await editLibrary('saved while watching');
    const deadline = Date.now() + 90_000;
    // Mid-sync the package is briefly missing from node_modules, so a failed require means "not yet".
    const settled = () => message(admin).catch(() => undefined);
    while (Date.now() < deadline && (await settled()) !== 'saved while watching') await sleep(500);

    expect([await message(shop), await message(admin)]).toEqual([
      'saved while watching',
      'saved while watching',
    ]);
    expect((await dryfit(['unwatch'], libRoot)).exitCode).toBe(0);
  });

  it('restores the group byte for byte, takes the guard out, and stops cleanly (M3 exit check)', async () => {
    const restore = await dryfit(['restore', '--group', 'checkout']);
    expect(restore.exitCode, restore.stdout + restore.stderr).toBe(0);

    for (const [file, content] of originals)
      expect({ file, content: await read(file) }).toEqual({ file, content });
    for (const [dir, tree] of originalTrees) expect(await installedTree(dir)).toEqual(tree);
    expect([await message(shop), await message(admin)]).toEqual(['release', 'release']);
    expect(await read(join(shop, '.git/hooks/pre-commit'))).toBe(OWN_HOOK);

    const info = await home.readDaemonInfo();
    expect((await dryfit(['daemon', 'stop'])).exitCode).toBe(0);
    expect(await home.readDaemonInfo()).toBeUndefined();
    expect(() => process.kill(info?.pid ?? 0, 0)).toThrow();
  });
});
