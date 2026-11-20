import type { DryfitState } from '../model.ts';
import type { CoreDeps } from '../ports.ts';
import {
  dependenciesOf,
  dependencyOrder,
  dependentsOf,
  type LibraryGraph,
  loadLibraryGraph,
} from '../project/library-graph.ts';
import { type InstallOutcome, installLinks, type LibraryVersion, linkedSet } from './install-link.ts';
import { publishLibrary } from './publish-library.ts';
import { requireLibrary } from './shared.ts';

export interface SyncLibraryInput {
  readonly library: string;
}

export interface SyncResult {
  /** The new dev version of the library asked for. */
  readonly version: string;
  /** Every library published, in the order it was, the one asked for among them (ADR 0014). */
  readonly published: readonly LibraryVersion[];
  /** One outcome per consumer linked to any published library. */
  readonly installs: readonly InstallOutcome[];
}

/**
 * One full cycle: build and publish the library, along with the registered libraries whose dev builds
 * must move with it (ADR 0014), then install each linked consumer's dev builds in one run. Consumers
 * are installed one at a time because package managers share a global cache that does not tolerate
 * concurrent writers well.
 */
export async function syncLibrary(deps: CoreDeps, { library: name }: SyncLibraryInput): Promise<SyncResult> {
  const before = await deps.state.load();
  requireLibrary(before, name);
  const graph = await loadLibraryGraph(deps.fs, before.libraries);

  const published: LibraryVersion[] = [];
  for (const library of dependencyOrder(graph, publishSet(before, graph, [name]))) {
    const { version } = await publishLibrary(deps, { library });
    published.push({ library, version });
  }

  const state = await deps.state.load();
  const touched = new Set(published.map((entry) => entry.library));
  const consumers = [
    ...new Set(state.links.filter((link) => touched.has(link.library)).map((link) => link.consumer)),
  ];

  const installs: InstallOutcome[] = [];
  for (const consumer of consumers) {
    const libraries = linkedSet(state, consumer, name);
    installs.push((await installLinks(deps, { consumer, libraries })).outcome);
  }
  const version = published.find((entry) => entry.library === name)?.version ?? '';
  return { version, published, installs };
}

/**
 * The libraries asked for, then until nothing changes: every library depending on one in the set that
 * has a dev build or is linked (its dev build pins a version about to be replaced), and every library
 * one in the set depends on that is linked but was never published (so a new set is complete at once).
 */
export function publishSet(state: DryfitState, graph: LibraryGraph, names: Iterable<string>): Set<string> {
  const linked = new Set(state.links.map((link) => link.library));
  const published = new Set(
    state.libraries.filter((library) => library.lastPublishedVersion !== undefined).map((l) => l.name),
  );
  const set = new Set(names);
  for (let size = 0; size !== set.size; ) {
    size = set.size;
    for (const member of [...set]) {
      for (const dependent of dependentsOf(graph, member)) {
        if (published.has(dependent) || linked.has(dependent)) set.add(dependent);
      }
      for (const dependency of dependenciesOf(graph, member)) {
        if (linked.has(dependency) && !published.has(dependency)) set.add(dependency);
      }
    }
  }
  return set;
}

/**
 * Those of `names` whose dev build pins a sibling's dev version other than its latest: published before
 * dryfit recorded pins, or left behind when a sync failed partway through the set. Installing one would
 * fail, because it demands a sibling version the app is not getting (ADR 0014).
 */
export function staleBuilds(state: DryfitState, graph: LibraryGraph, names: Iterable<string>): string[] {
  const latest = new Map(state.libraries.map((library) => [library.name, library.lastPublishedVersion]));
  return [...names].filter((name) => {
    const library = state.libraries.find((candidate) => candidate.name === name);
    if (library?.lastPublishedVersion === undefined) return false;
    return [...(graph.get(name) ?? [])].some((sibling) => {
      // Libraries that depend on each other in a cycle can never all pin the others' latest build:
      // whichever publishes first pins the other's previous one. That is not stale, or every link
      // would publish the whole cycle again.
      if (dependsOn(graph, sibling, name)) return false;
      const version = latest.get(sibling);
      return version !== undefined && library.pinnedSiblings?.[sibling] !== version;
    });
  });
}

/** Whether `from` depends on `target`, directly or through other libraries. */
function dependsOn(graph: LibraryGraph, from: string, target: string): boolean {
  const seen = new Set<string>();
  const queue = [from];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    for (const dependency of graph.get(next) ?? []) {
      if (dependency === target) return true;
      if (!seen.has(dependency)) {
        seen.add(dependency);
        queue.push(dependency);
      }
    }
  }
  return false;
}
