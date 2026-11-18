import { DevlinkError } from '../errors.ts';
import type { LinkRecord, SnapshotMeta } from '../model.ts';
import type { CoreDeps, PackageManagerAdapter, ProjectInfo } from '../ports.ts';
import { loadProject } from '../project/load-project.ts';
import { findDependency } from '../project/manifest.ts';
import { joinPath } from '../util/path.ts';
import { installLink } from './install-link.ts';
import { adapterFor, requireLibrary, sameLink, snapshotDir, withLink } from './shared.ts';

export interface LinkConsumerInput {
  readonly library: string;
  readonly consumer: string;
}

/**
 * Opts a consumer in to receiving dev versions of a library (ADR 0005). The consumer's manifest and
 * lockfiles are snapshotted before anything changes; if the library has been published before, its
 * latest dev version is installed straight away.
 */
export async function linkConsumer(deps: CoreDeps, input: LinkConsumerInput): Promise<LinkRecord> {
  // One spelling per folder, so `/repos/shop/` and `/repos/shop` share one link and one snapshot.
  const consumer = joinPath(input.consumer);
  const state = await deps.state.load();
  const library = requireLibrary(state, input.library);

  const project = await loadProject(deps.fs, consumer);
  if (!findDependency(project.manifest, library.name)) {
    throw new DevlinkError('not-a-consumer', `${consumer} does not depend on ${library.name}`, {
      consumer,
      library: library.name,
    });
  }
  const adapter = adapterFor(deps, project);

  const existing = state.links.find((link) => sameLink(link, { library: library.name, consumer }));
  if (existing) return existing;

  const consumerAlreadyLinked = state.links.some((link) => link.consumer === consumer);
  if (!consumerAlreadyLinked) await takeSnapshot(deps, project, adapter);

  const link: LinkRecord = { library: library.name, consumer, status: 'pending' };
  // Reload: the snapshot took file I/O, and another command may have saved state meanwhile.
  await deps.state.save(withLink(await deps.state.load(), link));

  if (library.lastPublishedVersion === undefined) return link;
  const installed = await installLink(deps, { library, consumer, version: library.lastPublishedVersion });
  return installed.link;
}

/**
 * Taken when a consumer's first library is linked, replacing any leftover snapshot (from a restore
 * that was interrupted) because only the current files reflect what the user has committed since.
 * Later links into the same consumer must not take one: by then the files contain devlink's edits.
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
