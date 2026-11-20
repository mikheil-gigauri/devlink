import { DryfitError } from '../errors.ts';
import type { DryfitState, LinkRecord, SnapshotMeta } from '../model.ts';
import type { CoreDeps, PackageManagerAdapter, ProjectInfo } from '../ports.ts';
import { dependencyOrder, loadLibraryGraph } from '../project/library-graph.ts';
import { loadProject } from '../project/load-project.ts';
import { findDependency } from '../project/manifest.ts';
import { joinPath } from '../util/path.ts';
import { installLinks, linkedSet } from './install-link.ts';
import { publishLibrary } from './publish-library.ts';
import { adapterFor, requireLibrary, sameLink, snapshotDir, withLink } from './shared.ts';
import { publishSet, staleBuilds } from './sync-library.ts';

export interface LinkConsumerInput {
  readonly library: string;
  readonly consumer: string;
}

export interface LinkLibrariesInput {
  readonly libraries: readonly string[];
  readonly consumer: string;
}

/** Links one library into a consumer; see `linkLibraries`. */
export async function linkConsumer(deps: CoreDeps, input: LinkConsumerInput): Promise<LinkRecord> {
  const [link] = await linkLibraries(deps, { libraries: [input.library], consumer: input.consumer });
  if (!link) throw new DryfitError('invalid-request', `Linking ${input.library} returned nothing`, {});
  return link;
}

/**
 * Opts a consumer in to receiving dev versions of libraries (ADR 0005). The consumer's manifest and
 * lockfiles are snapshotted before anything changes. If any newly linked library has been published
 * before, the consumer's whole linked set is installed straight away in one run, so libraries that pin
 * each other go in together (ADR 0014); dev builds in the set that pin a sibling's old dev build are
 * published again first. Every library is checked before anything is touched.
 */
export async function linkLibraries(deps: CoreDeps, input: LinkLibrariesInput): Promise<LinkRecord[]> {
  // One spelling per folder, so `/repos/shop/` and `/repos/shop` share one link and one snapshot.
  const consumer = joinPath(input.consumer);
  const state = await deps.state.load();
  const libraries = [...new Set(input.libraries)].map((name) => requireLibrary(state, name));
  if (libraries.length === 0) throw new DryfitError('invalid-request', 'Which libraries to link?', {});

  const project = await loadProject(deps.fs, consumer);
  for (const library of libraries) {
    if (!findDependency(project.manifest, library.name)) {
      throw new DryfitError('not-a-consumer', `${consumer} does not depend on ${library.name}`, {
        consumer,
        library: library.name,
      });
    }
  }
  const adapter = adapterFor(deps, project);

  const isLinked = (name: string) => state.links.some((link) => sameLink(link, { library: name, consumer }));
  const added = libraries.filter((library) => !isLinked(library.name));

  if (added.length > 0) {
    const consumerAlreadyLinked = state.links.some((link) => link.consumer === consumer);
    if (!consumerAlreadyLinked) await takeSnapshot(deps, project, adapter);

    // Reload: the snapshot took file I/O, and another command may have saved state meanwhile.
    let latest = await deps.state.load();
    for (const library of added)
      latest = withLink(latest, { library: library.name, consumer, status: 'pending' });
    await deps.state.save(latest);

    if (added.some((library) => library.lastPublishedVersion !== undefined)) {
      latest = await republishStaleBuilds(deps, latest, consumer);
      const set = linkedSet(latest, consumer, added.find((library) => library.lastPublishedVersion)?.name);
      await installLinks(deps, { consumer, libraries: set });
    }
  }

  const { links } = await deps.state.load();
  return libraries.flatMap(
    (library) => links.find((link) => sameLink(link, { library: library.name, consumer })) ?? [],
  );
}

/**
 * Publishes again, with what depends on them, the dev builds in the consumer's set that pin a sibling's
 * old dev version, so the set installs together (ADR 0014). Returns the state to install from.
 */
async function republishStaleBuilds(
  deps: CoreDeps,
  state: DryfitState,
  consumer: string,
): Promise<DryfitState> {
  const graph = await loadLibraryGraph(deps.fs, state.libraries);
  const set = linkedSet(state, consumer).map((entry) => entry.library.name);
  const stale = staleBuilds(state, graph, set);
  if (stale.length === 0) return state;
  for (const library of dependencyOrder(graph, publishSet(state, graph, stale))) {
    await publishLibrary(deps, { library });
  }
  return deps.state.load();
}

/**
 * Taken when a consumer's first library is linked, replacing any leftover snapshot (from a restore
 * that was interrupted) because only the current files reflect what the user has committed since.
 * Later links into the same consumer must not take one: by then the files contain dryfit's edits.
 */
async function takeSnapshot(
  deps: CoreDeps,
  project: ProjectInfo,
  adapter: PackageManagerAdapter,
): Promise<void> {
  const dir = snapshotDir(deps, project.root);
  const lockfiles = adapter.lockfiles.filter((file) => project.rootFiles.includes(file));

  await deps.fs.remove(dir);
  for (const file of ['package.json', ...lockfiles]) {
    const text = await deps.fs.readText(joinPath(project.root, file));
    if (text !== undefined) await deps.fs.writeText(joinPath(dir, file), text);
  }

  const meta: SnapshotMeta = {
    consumer: project.root,
    packageManager: adapter.name,
    lockfiles,
    createdAt: deps.clock.now().toISOString(),
  };
  // meta.json is written last: its presence marks a complete snapshot.
  await deps.fs.writeText(joinPath(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
}
