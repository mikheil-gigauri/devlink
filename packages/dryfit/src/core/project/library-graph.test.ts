import { describe, expect, it } from 'vitest';
import { InMemoryFileSystem } from '../../testing/in-memory-file-system.ts';
import { json } from '../../testing/scenario.ts';
import type { LibraryRecord } from '../model.ts';
import {
  connectedTo,
  dependenciesOf,
  dependencyOrder,
  dependentsOf,
  type LibraryGraph,
  loadLibraryGraph,
} from './library-graph.ts';

const library = (name: string): LibraryRecord => ({
  name: `@ws/${name}`,
  root: `/ws/libs/${name}`,
  publishDir: `/ws/dist/libs/${name}`,
});

const graphOf = (edges: Record<string, string[]>): LibraryGraph =>
  new Map(Object.entries(edges).map(([name, deps]) => [name, new Set(deps)]));

describe('loadLibraryGraph', () => {
  it('reads edges to other registered libraries from runtime fields of both manifests', async () => {
    const fs = InMemoryFileSystem.with({
      '/ws/libs/ui/package.json': json({
        name: '@ws/ui',
        peerDependencies: { '@ws/common': '19.24.0', '@angular/core': '^20.0.0' },
        devDependencies: { '@ws/assets': '1.0.0' },
      }),
      // ng-packagr adds what the build found, so the publish folder's manifest counts too.
      '/ws/dist/libs/ui/package.json': json({ name: '@ws/ui', dependencies: { '@ws/core': '2.0.0' } }),
      '/ws/libs/core/package.json': json({
        name: '@ws/core',
        optionalDependencies: { '@ws/common': '^19.0.0' },
      }),
      '/ws/libs/common/package.json': json({ name: '@ws/common', dependencies: { '@ws/common': '1.0.0' } }),
    });

    const graph = await loadLibraryGraph(fs, ['ui', 'core', 'common', 'assets'].map(library));

    expect(Object.fromEntries([...graph].map(([name, edges]) => [name, [...edges].sort()]))).toEqual({
      '@ws/ui': ['@ws/common', '@ws/core'],
      '@ws/core': ['@ws/common'],
      '@ws/common': [],
      '@ws/assets': [],
    });
  });

  it('adds no edges for a manifest that is missing or not JSON', async () => {
    const fs = InMemoryFileSystem.with({ '/ws/libs/ui/package.json': '{ not json' });

    const graph = await loadLibraryGraph(fs, [library('ui'), library('common')]);

    expect([...graph.values()].map((edges) => edges.size)).toEqual([0, 0]);
  });
});

describe('graph queries', () => {
  // ui → core → common, assets on its own.
  const graph = graphOf({ ui: ['core'], core: ['common'], common: [], assets: [] });

  it('follows dependents and dependencies transitively', () => {
    expect([...dependentsOf(graph, 'common')].sort()).toEqual(['core', 'ui']);
    expect([...dependenciesOf(graph, 'ui')].sort()).toEqual(['common', 'core']);
    expect(dependentsOf(graph, 'assets').size).toBe(0);
  });

  it('finds everything tied to a library in either direction', () => {
    expect([...connectedTo(graph, 'core')].sort()).toEqual(['common', 'core', 'ui']);
    expect([...connectedTo(graph, 'assets')]).toEqual(['assets']);
  });

  it('orders libraries after the ones they depend on', () => {
    expect(dependencyOrder(graph, ['ui', 'assets', 'common', 'core'])).toEqual([
      'assets',
      'common',
      'core',
      'ui',
    ]);
  });

  it('orders only the libraries asked for, ignoring dependencies outside them', () => {
    expect(dependencyOrder(graph, ['ui', 'core'])).toEqual(['core', 'ui']);
  });

  it('puts libraries in a cycle last, in name order, rather than looping', () => {
    const cyclic = graphOf({ a: ['b'], b: ['a'], c: [] });

    expect(dependencyOrder(cyclic, ['b', 'a', 'c'])).toEqual(['c', 'a', 'b']);
  });
});
