import { builtInIntegrations } from '../adapters/integrations/index.ts';
import { npm } from '../adapters/package-managers/npm.ts';
import type { CommandSpec, DevlinkState, Manifest } from '../core/model.ts';
import type { CoreDeps } from '../core/ports.ts';
import { formatManifest } from '../core/project/manifest.ts';
import { isRecord } from '../core/util/json.ts';
import { joinPath } from '../core/util/path.ts';
import { FakeClock, FakeProcessRunner, failed, MemoryStateStore, ok, RecordingEventSink } from './fakes.ts';
import { InMemoryFileSystem } from './in-memory-file-system.ts';

export const REGISTRY = 'http://127.0.0.1:4873/';
export const HOME = '/home/me/.devlink';

export const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** A package-lock.json with one resolved entry per dependency, as npm would write it. */
export const lockfileFor = (name: string, packages: Record<string, string>): string =>
  json({
    name,
    lockfileVersion: 3,
    packages: {
      '': { name },
      ...Object.fromEntries(
        Object.entries(packages).map(([pkg, version]) => [
          `node_modules/${pkg}`,
          {
            version,
            resolved: `https://registry.npmjs.org/${pkg}/-/${pkg.split('/').at(-1)}-${version}.tgz`,
          },
        ]),
      ),
    },
  });

/**
 * One library and three consumers, laid out like a real machine:
 *
 * - `/repos/ui-lib`: `@acme/ui`, an Angular library built by ng-packagr into `dist/ui`.
 * - `/repos/shop`: Angular + Native Federation app depending on `@acme/ui`, with a lockfile.
 * - `/repos/admin`: Vite app with `@acme/ui` in devDependencies, no lockfile yet.
 * - `/repos/blog`: depends on nothing devlink knows about.
 */
export const LIB = '/repos/ui-lib';
export const SHOP = '/repos/shop';
export const ADMIN = '/repos/admin';
export const BLOG = '/repos/blog';

export const shopManifest: Manifest = {
  name: 'shop',
  version: '0.0.0',
  dependencies: { '@acme/ui': '^1.4.0', '@angular/core': '^20.1.0' },
  devDependencies: { '@angular-architects/native-federation': '^20.0.0' },
};

export function scenarioFiles(): Record<string, string> {
  return {
    [`${LIB}/package.json`]: json({ name: '@acme/ui', version: '1.4.0', scripts: { build: 'ng build' } }),
    [`${LIB}/dist/ui/package.json`]: json({
      name: '@acme/ui',
      version: '1.4.0',
      module: 'fesm2022/acme-ui.mjs',
    }),
    [`${LIB}/dist/ui/fesm2022/acme-ui.mjs`]: 'export const button = "v2";\n',
    [`${LIB}/dist/ui/node_modules/.cache/junk`]: 'should not be published',

    [`${SHOP}/package.json`]: json(shopManifest),
    [`${SHOP}/package-lock.json`]: lockfileFor('shop', { '@acme/ui': '1.4.0', '@angular/core': '20.1.3' }),
    [`${SHOP}/angular.json`]: json({ version: 1, projects: {} }),
    [`${SHOP}/.angular/cache/20.1.3/vite/deps/acme-ui.js`]: 'stale',
    [`${SHOP}/node_modules/.cache/native-federation/acme-ui.js`]: 'stale',
    [`${SHOP}/src/main.ts`]: 'bootstrap();\n',

    [`${ADMIN}/package.json`]: json({
      name: 'admin',
      devDependencies: { '@acme/ui': '1.4.0', vite: '^7.0.0' },
    }),
    [`${ADMIN}/node_modules/.vite/deps/acme-ui.js`]: 'stale',

    [`${BLOG}/package.json`]: json({ name: 'blog', dependencies: { lodash: '^4.17.21' } }),
    [`${BLOG}/package-lock.json`]: lockfileFor('blog', { lodash: '4.17.21' }),
  };
}

export interface ScenarioOptions {
  readonly files?: Record<string, string>;
  readonly state?: DevlinkState;
}

export function createScenario({ files = scenarioFiles(), state }: ScenarioOptions = {}) {
  const fs = InMemoryFileSystem.with(files);
  const process = new FakeProcessRunner();
  const clock = new FakeClock();
  const store = new MemoryStateStore(state);
  const events = new RecordingEventSink();
  const npmSim = new SimulatedNpm(fs);

  process.on('npm install', (spec) => npmSim.install(spec));
  process.on('npm ci', (spec) => npmSim.ci(spec));

  const deps: CoreDeps = {
    fs,
    process,
    clock,
    state: store,
    events,
    packageManagers: { npm },
    integrations: builtInIntegrations,
    registryUrl: REGISTRY,
    registryCredentials: { username: 'devlink', password: 'test-password' },
    home: HOME,
  };

  return { deps, fs, process, clock, store, events, npm: npmSim };
}

/**
 * Behaves like `npm install <pkg>@<version>` closely enough for restore tests: it rewrites the
 * manifest field and the lockfile entry. `failIn` makes it rewrite the manifest and then fail,
 * like npm does when a later step (a peer conflict, a postinstall script) blows up.
 */
export class SimulatedNpm {
  readonly #fs: InMemoryFileSystem;
  readonly #failing = new Set<string>();

  constructor(fs: InMemoryFileSystem) {
    this.#fs = fs;
  }

  failIn(cwd: string): void {
    this.#failing.add(cwd);
  }

  /** `npm ci` refuses to run without a lockfile and otherwise leaves manifest and lockfile alone. */
  async ci(spec: CommandSpec) {
    const hasLockfile =
      (await this.#fs.exists(joinPath(spec.cwd, 'package-lock.json'))) ||
      (await this.#fs.exists(joinPath(spec.cwd, 'npm-shrinkwrap.json')));
    return hasLockfile
      ? ok()
      : failed('npm error The `npm ci` command can only install with an existing package-lock.json');
  }

  async install(spec: CommandSpec) {
    const specifier = spec.args[1];
    if (spec.args[0] !== 'install') return ok();
    if (specifier === undefined || specifier.startsWith('--')) return this.#installAll(spec);

    const at = specifier.lastIndexOf('@');
    const name = specifier.slice(0, at);
    const version = specifier.slice(at + 1);
    const field = spec.args.includes('--save-dev')
      ? 'devDependencies'
      : spec.args.includes('--save-optional')
        ? 'optionalDependencies'
        : spec.args.includes('--save-peer')
          ? 'peerDependencies'
          : 'dependencies';

    const manifestPath = joinPath(spec.cwd, 'package.json');
    const manifest = JSON.parse((await this.#fs.readText(manifestPath)) ?? '{}') as Record<string, unknown>;
    const current = isRecord(manifest[field]) ? manifest[field] : {};
    manifest[field] = { ...current, [name]: version };
    await this.#fs.writeText(manifestPath, formatManifest(manifest));

    if (this.#failing.has(spec.cwd)) return failed('npm error ERESOLVE could not resolve');

    const lockPath = joinPath(spec.cwd, 'package-lock.json');
    const lock = JSON.parse(
      (await this.#fs.readText(lockPath)) ?? json({ lockfileVersion: 3, packages: {} }),
    );
    lock.packages[`node_modules/${name}`] = { version, resolved: `${REGISTRY}${name}/-/x-${version}.tgz` };
    await this.#fs.writeText(lockPath, json(lock));
    return ok();
  }

  /** A bare `npm install` writes a lockfile when there is none, unless told not to. */
  async #installAll(spec: CommandSpec) {
    const lockPath = joinPath(spec.cwd, 'package-lock.json');
    if (!spec.args.includes('--no-package-lock') && !(await this.#fs.exists(lockPath))) {
      await this.#fs.writeText(lockPath, json({ lockfileVersion: 3, packages: {} }));
    }
    return ok();
  }
}
