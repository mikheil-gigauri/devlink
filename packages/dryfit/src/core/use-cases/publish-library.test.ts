import { describe, expect, it } from 'vitest';
import { failed } from '../../testing/fakes.ts';
import { createScenario, HOME, LIB } from '../../testing/scenario.ts';
import type { DryfitState } from '../model.ts';
import { publishLibrary } from './publish-library.ts';

const withBuild: DryfitState = {
  libraries: [
    {
      name: '@acme/ui',
      root: LIB,
      publishDir: `${LIB}/dist/ui`,
      build: { command: 'npm', args: ['run', 'build'], cwd: LIB },
    },
  ],
  links: [],
  groups: [],
};

describe('publishLibrary', () => {
  it('builds, then publishes a staged copy under a fresh dev version', async () => {
    const { deps, process, store } = createScenario({ state: withBuild });

    const { version } = await publishLibrary(deps, { library: '@acme/ui' });

    expect(version).toBe('1.4.1-dev.20261118143201');
    expect(process.calls.map((call) => [call.cwd, call.command, ...call.args].join(' '))).toEqual([
      `${LIB} npm run build`,
      expect.stringMatching(
        new RegExp(
          `^${HOME}/staging/acme_ui-[0-9a-f]{8} npm publish --registry=http://127.0.0.1:4873/ --tag=dryfit`,
        ),
      ),
    ]);
    expect(store.current.libraries[0]?.lastPublishedVersion).toBe(version);
  });

  it('publishes the dev version without touching the library or its build output', async () => {
    const { deps, fs, process } = createScenario({ state: withBuild });
    const before = fs.snapshot(LIB);
    let staged: Record<string, string> = {};
    process.on('npm publish', (spec) => {
      staged = fs.snapshot(spec.cwd);
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await publishLibrary(deps, { library: '@acme/ui' });

    const stagedFiles = Object.keys(staged).map((path) => path.replace(/^.*\/staging\/[^/]+/, ''));
    expect(stagedFiles).toEqual(['/.npmrc', '/fesm2022/acme-ui.mjs', '/package.json']);
    const stagedManifest = Object.entries(staged).find(([path]) => path.endsWith('/package.json'))?.[1] ?? '';
    expect(JSON.parse(stagedManifest)).toEqual({
      name: '@acme/ui',
      version: '1.4.1-dev.20261118143201',
      module: 'fesm2022/acme-ui.mjs',
    });
    expect(fs.snapshot(LIB)).toEqual(before);
  });

  it('hands npm the registry credentials through the staged .npmrc only', async () => {
    const { deps, fs, process } = createScenario({ state: withBuild });
    let npmrc: string | undefined;
    let isPrivate = false;
    process.on('npm publish', async (spec) => {
      npmrc = await fs.readText(`${spec.cwd}/.npmrc`);
      isPrivate = fs.isPrivate(`${spec.cwd}/.npmrc`);
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    await publishLibrary(deps, { library: '@acme/ui' });

    const auth = btoa('dryfit:test-password');
    expect(npmrc).toBe(`//127.0.0.1:4873/:_auth=${auth}\n`);
    expect(isPrivate).toBe(true);
    expect(process.lines().join(' ')).not.toMatch(new RegExp(`test-password|${auth}`));
  });

  it('removes the staging folder afterwards', async () => {
    const { deps, fs } = createScenario({ state: withBuild });

    await publishLibrary(deps, { library: '@acme/ui' });

    expect(await fs.readDir(`${HOME}/staging`)).toEqual([]);
  });

  it('keeps versions strictly increasing across quick successive publishes', async () => {
    const { deps } = createScenario({ state: withBuild });

    const first = await publishLibrary(deps, { library: '@acme/ui' });
    const second = await publishLibrary(deps, { library: '@acme/ui' });

    expect([first.version, second.version]).toEqual(['1.4.1-dev.20261118143201', '1.4.1-dev.20261118143202']);
  });

  it('skips the build when none is configured', async () => {
    const { deps, process } = createScenario({
      state: {
        libraries: [{ name: '@acme/ui', root: LIB, publishDir: `${LIB}/dist/ui` }],
        links: [],
        groups: [],
      },
    });

    await publishLibrary(deps, { library: '@acme/ui' });

    expect(process.lines()).toEqual([expect.stringMatching(/^npm publish /)]);
  });

  it('stops with the build output when the build fails, publishing nothing', async () => {
    const { deps, process, events, store } = createScenario({ state: withBuild });
    process.on('npm run build', failed('src/button.ts:3:7 - error TS2322'));

    await expect(publishLibrary(deps, { library: '@acme/ui' })).rejects.toMatchObject({
      code: 'build-failed',
      details: { output: 'src/button.ts:3:7 - error TS2322' },
    });
    expect(process.lines().some((line) => line.startsWith('npm publish'))).toBe(false);
    expect(events.types()).toEqual(['build:started', 'build:failed']);
    expect(store.current.libraries[0]?.lastPublishedVersion).toBeUndefined();
  });

  it('reports a failed publish and leaves the publish history and staging clean', async () => {
    const { deps, process, fs, store } = createScenario({ state: withBuild });
    process.on('npm publish', failed('E403 Forbidden'));

    await expect(publishLibrary(deps, { library: '@acme/ui' })).rejects.toMatchObject({
      code: 'publish-failed',
      details: { output: 'E403 Forbidden' },
    });
    expect(store.current.libraries[0]?.lastPublishedVersion).toBeUndefined();
    expect(await fs.readDir(`${HOME}/staging`)).toEqual([]);
  });

  it('emits build and publish events in order', async () => {
    const { deps, events } = createScenario({ state: withBuild });

    await publishLibrary(deps, { library: '@acme/ui' });

    expect(events.events).toEqual([
      { type: 'build:started', library: '@acme/ui' },
      { type: 'build:succeeded', library: '@acme/ui' },
      { type: 'publish:succeeded', library: '@acme/ui', version: '1.4.1-dev.20261118143201' },
    ]);
  });

  it('rejects an unknown library', async () => {
    const { deps } = createScenario({ state: withBuild });

    await expect(publishLibrary(deps, { library: '@acme/nope' })).rejects.toMatchObject({
      code: 'library-not-found',
    });
  });

  it('publishes with npm whichever package manager the library itself uses', async () => {
    // The staged folder is a plain package, and npm ships with every Node that runs dryfit.
    const { deps, fs, process } = createScenario({ state: withBuild });
    await fs.writeText(`${LIB}/pnpm-lock.yaml`, "lockfileVersion: '9.0'\n");

    await publishLibrary(deps, { library: '@acme/ui' });

    expect(process.lines().at(-1)).toMatch(/^npm publish /);
  });

  it.each(['workspace:^', 'catalog:'])(
    'refuses a manifest that still has %s ranges, which only its own workspace can resolve',
    async (range) => {
      const { deps, fs, process } = createScenario({ state: withBuild });
      await fs.writeText(
        `${LIB}/dist/ui/package.json`,
        JSON.stringify({ name: '@acme/ui', version: '1.4.0', dependencies: { '@acme/tokens': range } }),
      );

      await expect(publishLibrary(deps, { library: '@acme/ui' })).rejects.toMatchObject({
        code: 'invalid-manifest',
        message: expect.stringContaining('@acme/tokens'),
      });
      expect(process.lines().some((line) => line.startsWith('npm publish'))).toBe(false);
    },
  );

  it('rejects build output whose package.json is missing', async () => {
    const { deps, fs } = createScenario({ state: withBuild });
    await fs.remove(`${LIB}/dist`);

    await expect(publishLibrary(deps, { library: '@acme/ui' })).rejects.toMatchObject({
      code: 'invalid-manifest',
    });
  });
});
