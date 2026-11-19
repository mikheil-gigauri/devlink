import { describe, expect, it } from 'vitest';
import { InMemoryFileSystem } from '../../testing/in-memory-file-system.ts';
import { json } from '../../testing/scenario.ts';
import { detectLibraryBuild } from './detect-library-build.ts';

describe('detectLibraryBuild', () => {
  it('builds an Nx library with the workspace’s nx, publishing what ng-packagr writes', async () => {
    const fs = InMemoryFileSystem.with({
      '/ws/nx.json': '{}',
      '/ws/libs/ui/package.json': json({ name: '@acme/ui' }),
      '/ws/libs/ui/project.json': json({
        name: 'shared-ui',
        targets: { build: { executor: '@nx/angular:package' } },
      }),
      '/ws/libs/ui/ng-package.json': json({ dest: '../../dist/libs/ui' }),
    });

    expect(await detectLibraryBuild(fs, '/ws/libs/ui')).toEqual({
      kind: 'nx',
      build: { command: '/ws/node_modules/.bin/nx', args: ['build', 'shared-ui'] },
      publishDir: '/ws/dist/libs/ui',
    });
  });

  it('falls back to the Nx build target’s outputPath, resolving workspace tokens', async () => {
    const fs = InMemoryFileSystem.with({
      '/ws/nx.json': '{}',
      '/ws/libs/util/package.json': json({ name: '@acme/util' }),
      '/ws/libs/util/project.json': json({
        name: 'util',
        targets: { build: { options: { outputPath: '{workspaceRoot}/dist/{projectRoot}' } } },
      }),
    });

    expect(await detectLibraryBuild(fs, '/ws/libs/util')).toMatchObject({
      kind: 'nx',
      publishDir: '/ws/dist/libs/util',
    });
  });

  it('builds an Angular CLI library by its project name in angular.json', async () => {
    const fs = InMemoryFileSystem.with({
      '/ws/angular.json': json({ projects: { app: { root: '' }, 'acme-ui': { root: 'projects/ui' } } }),
      '/ws/projects/ui/package.json': json({ name: '@acme/ui' }),
      '/ws/projects/ui/ng-package.json': json({ dest: '../../dist/ui' }),
    });

    expect(await detectLibraryBuild(fs, '/ws/projects/ui')).toEqual({
      kind: 'angular',
      build: { command: '/ws/node_modules/.bin/ng', args: ['build', 'acme-ui'] },
      publishDir: '/ws/dist/ui',
    });
  });

  it("publishes ng-packagr's default output when ng-package.json names no dest", async () => {
    const fs = InMemoryFileSystem.with({
      '/ws/angular.json': json({ projects: { 'acme-ui': { root: 'projects/ui' } } }),
      '/ws/projects/ui/package.json': json({ name: '@acme/ui' }),
      '/ws/projects/ui/ng-package.json': json({ lib: { entryFile: 'src/public-api.ts' } }),
    });

    expect(await detectLibraryBuild(fs, '/ws/projects/ui')).toMatchObject({
      kind: 'angular',
      publishDir: '/ws/projects/ui/dist',
    });
  });

  it('runs the build script of a plain package and publishes its root', async () => {
    const fs = InMemoryFileSystem.with({
      '/repos/utils/package.json': json({ name: 'utils', scripts: { build: 'tsc' } }),
    });

    expect(await detectLibraryBuild(fs, '/repos/utils')).toEqual({
      kind: 'npm-script',
      build: { command: 'npm', args: ['run', 'build'] },
      publishDir: '/repos/utils',
    });
  });

  it('publishes the sources as they are when nothing builds them', async () => {
    const fs = InMemoryFileSystem.with({ '/repos/tokens/package.json': json({ name: 'tokens' }) });

    expect(await detectLibraryBuild(fs, '/repos/tokens')).toEqual({
      kind: 'none',
      publishDir: '/repos/tokens',
    });
  });
});
