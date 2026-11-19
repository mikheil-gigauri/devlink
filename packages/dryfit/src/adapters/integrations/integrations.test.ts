import { describe, expect, it } from 'vitest';
import type { Manifest } from '../../core/model.ts';
import type { ProjectInfo } from '../../core/ports.ts';
import { cachePathsFor } from '../../core/project/cache-paths.ts';
import { angular } from './angular.ts';
import { builtInIntegrations } from './index.ts';
import { nativeFederation } from './native-federation.ts';
import { vite } from './vite.ts';

const project = (
  manifest: Manifest,
  { rootFiles = [], configs = {} }: { rootFiles?: string[]; configs?: Record<string, unknown> } = {},
): ProjectInfo => ({
  root: '/apps/shop',
  manifest,
  rootFiles: ['package.json', ...rootFiles],
  configs: new Map(Object.entries(configs)),
});

describe('angular', () => {
  it('detects @angular/core', () => {
    expect(angular.detect(project({ dependencies: { '@angular/core': '^20.0.0' } }))).toBe(true);
  });

  it('detects an angular.json without the dependency (e.g. hoisted in a workspace)', () => {
    expect(angular.detect(project({}, { rootFiles: ['angular.json'] }))).toBe(true);
  });

  it('ignores unrelated projects', () => {
    expect(angular.detect(project({ dependencies: { react: '^19.0.0' } }))).toBe(false);
  });

  it('clears the default cache folder', () => {
    expect(angular.cachePaths(project({}, { rootFiles: ['angular.json'] }))).toEqual(['.angular/cache']);
  });

  it('honours a custom cache path from angular.json', () => {
    const custom = project({}, { configs: { 'angular.json': { cli: { cache: { path: 'tmp/ng-cache' } } } } });

    expect(angular.cachePaths(custom)).toEqual(['tmp/ng-cache']);
  });

  it('asks for angular.json to be parsed', () => {
    expect(angular.configFiles).toEqual(['angular.json']);
  });
});

describe('nativeFederation', () => {
  it.each(['@angular-architects/native-federation', '@softarc/native-federation'])('detects %s', (name) => {
    expect(nativeFederation.detect(project({ devDependencies: { [name]: '^20.0.0' } }))).toBe(true);
  });

  it('clears its shared-bundle cache', () => {
    expect(nativeFederation.cachePaths(project({}))).toEqual(['node_modules/.cache/native-federation']);
  });
});

describe('vite', () => {
  it('detects vite', () => {
    expect(vite.detect(project({ devDependencies: { vite: '^7.0.0' } }))).toBe(true);
  });

  it('clears the dependency pre-bundle cache', () => {
    expect(vite.cachePaths(project({}))).toEqual(['node_modules/.vite']);
  });
});

describe('cachePathsFor', () => {
  it('unions the cache paths of every detected integration', () => {
    const app = project(
      {
        dependencies: { '@angular/core': '^20.0.0' },
        devDependencies: { '@angular-architects/native-federation': '^20.0.0' },
      },
      { rootFiles: ['angular.json'] },
    );

    expect(cachePathsFor(app, builtInIntegrations)).toEqual([
      '.angular/cache',
      'node_modules/.cache/native-federation',
    ]);
  });

  it('adds user-configured extra paths without duplicates', () => {
    const app = project({ devDependencies: { vite: '^7.0.0' } });

    expect(cachePathsFor(app, builtInIntegrations, ['node_modules/.vite', '.turbo'])).toEqual([
      'node_modules/.vite',
      '.turbo',
    ]);
  });

  it('never returns the project itself, anything outside it, or an absolute path', () => {
    const app = project({});
    const unsafe = ['.', './', '/', '..', '../sibling', 'a/../..', 'a/..', '/tmp/cache', ''];

    expect(cachePathsFor(app, [], [...unsafe, 'tmp/cache'])).toEqual(['tmp/cache']);
  });

  it('ignores a dangerous cache path configured in angular.json', () => {
    const app = project(
      {},
      { rootFiles: ['angular.json'], configs: { 'angular.json': { cli: { cache: { path: '..' } } } } },
    );

    expect(cachePathsFor(app, builtInIntegrations)).toEqual([]);
  });
});
