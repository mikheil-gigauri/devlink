import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNodeDeps } from '../adapters/node/node-deps.ts';
import { npmPublisher } from '../adapters/package-managers/npm.ts';
import type { VerdaccioRegistry } from '../adapters/registry/verdaccio-registry.ts';
import type { CoreDeps } from '../core/ports.ts';
import { linkConsumer } from '../core/use-cases/link-consumer.ts';
import { registerLibrary } from '../core/use-cases/register-library.ts';
import { restoreConsumer } from '../core/use-cases/restore-consumer.ts';
import { syncLibrary } from '../core/use-cases/sync-library.ts';
import { createRegistrySandbox, type RegistrySandbox } from '../testing/registry-sandbox.ts';

/**
 * One library linked into an npm, a pnpm, a Yarn and a Bun project at once, through the real
 * adapters: each runs every edit, and each is byte-identical to before once restored. Each project
 * maps the library's scope to the public registry in its own config, as a company's projects would.
 */
const LIB = '@fixture/ui';

interface Project {
  readonly name: string;
  readonly config: (registryUrl: string) => Readonly<Record<string, string>>;
  readonly install: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

const npmrc = (registryUrl: string) => ({ '.npmrc': `@fixture:registry=${registryUrl}\n` });

const PROJECTS: readonly Project[] = [
  { name: 'npm', config: npmrc, install: ['npm', 'install'] },
  { name: 'pnpm', config: npmrc, install: ['pnpm', 'install'] },
  {
    name: 'yarn',
    config: (registryUrl) => ({
      '.yarnrc.yml': [
        'nodeLinker: node-modules',
        "unsafeHttpWhitelist: ['localhost']",
        'npmScopes:',
        '  fixture:',
        `    npmRegistryServer: '${registryUrl.replace('//127.0.0.1:', '//localhost:')}'`,
        '    npmMinimalAgeGate: 0',
        '',
      ].join('\n'),
    }),
    install: ['yarn', 'install'],
    // Creating the lockfile is the point of this install; Yarn refuses to whenever CI is set.
    env: { YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' },
  },
  { name: 'bun', config: npmrc, install: ['bun', 'install'] },
];

describe('one library linked into npm, pnpm, Yarn and Bun projects', () => {
  let sandbox: RegistrySandbox;
  let publicRegistry: VerdaccioRegistry;
  let deps: CoreDeps;
  let libRoot: string;
  const consumers = new Map<string, string>();
  const originals = new Map<string, Record<string, string>>();

  /** The files directly in a project, with their contents: manifest, lockfile and config. */
  const rootFiles = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    return Object.fromEntries(
      await Promise.all(files.map(async (file) => [file, await readFile(join(dir, file), 'utf8')] as const)),
    );
  };
  const messages = async () =>
    Promise.all(
      [...consumers.values()].map(async (dir) =>
        (
          await sandbox.run(process.execPath, ['-p', `require(${JSON.stringify(LIB)}).message`], dir)
        ).stdout.trim(),
      ),
    );
  const editLibrary = (message: string) => writeFile(join(libRoot, 'src', 'message.txt'), message);

  beforeAll(async () => {
    sandbox = await createRegistrySandbox();
    publicRegistry = sandbox.registry;
    const devlinkRegistry = await sandbox.startRegistry('devlink-registry', {
      public: { url: publicRegistry.url },
    });

    libRoot = await sandbox.writePackage(
      join(sandbox.dir, 'repos', 'ui-lib'),
      { name: LIB, version: '1.0.0', private: true },
      {
        'src/message.txt': 'release',
        'build.mjs': [
          "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
          "mkdirSync('dist', { recursive: true });",
          `writeFileSync('dist/package.json', JSON.stringify({ name: '${LIB}', version: '1.0.0', main: 'index.js' }));`,
          "writeFileSync('dist/index.js', 'exports.message = ' + JSON.stringify(readFileSync('src/message.txt', 'utf8')) + ';');",
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

    for (const project of PROJECTS) {
      const dir = await sandbox.writePackage(
        join(sandbox.dir, 'repos', `${project.name}-app`),
        { name: `${project.name}-app`, version: '0.0.0', private: true, dependencies: { [LIB]: '^1.0.0' } },
        project.config(publicRegistry.url),
      );
      const [command = '', ...args] = project.install;
      await sandbox.run(command, args, dir, project.env);
      consumers.set(project.name, dir);
      originals.set(dir, await rootFiles(dir));
    }

    deps = createNodeDeps({
      home: join(sandbox.dir, 'devlink-home'),
      registry: devlinkRegistry,
      process: sandbox.runner,
    });
  }, 120_000);
  afterAll(() => sandbox?.dispose());

  it('starts from the release in every project, each with its own lockfile', async () => {
    expect(await messages()).toEqual(['release', 'release', 'release', 'release']);
    expect([...originals.values()].map((files) => Object.keys(files).filter((f) => /lock/.test(f)))).toEqual([
      ['package-lock.json'],
      ['pnpm-lock.yaml'],
      ['yarn.lock'],
      ['bun.lock'],
    ]);
  });

  it('runs each edit in every project', async () => {
    await registerLibrary(deps, {
      root: libRoot,
      publishDir: 'dist',
      build: { command: process.execPath, args: ['build.mjs'] },
    });
    for (const dir of consumers.values()) await linkConsumer(deps, { library: LIB, consumer: dir });

    for (const edit of ['first edit', 'second edit']) {
      await editLibrary(edit);
      const sync = await syncLibrary(deps, { library: LIB });
      expect(sync.installs.map((install) => [install.ok, install.ok ? '' : install.output])).toEqual(
        PROJECTS.map(() => [true, '']),
      );
      expect(await messages()).toEqual([edit, edit, edit, edit]);
    }
  });

  it('restores every project byte for byte, back on the release', async () => {
    for (const dir of consumers.values())
      expect(await restoreConsumer(deps, { consumer: dir })).toEqual({ ok: true });

    for (const [dir, files] of originals)
      expect({ dir, files: await rootFiles(dir) }).toEqual({ dir, files });
    expect(await messages()).toEqual(['release', 'release', 'release', 'release']);
  });
});
