import { DevlinkError } from '../errors.ts';
import type { LibraryRecord, LinkRecord } from '../model.ts';
import type { CoreDeps, PackageManagerAdapter, ProjectInfo } from '../ports.ts';
import { cachePathsFor } from '../project/cache-paths.ts';
import { loadProject } from '../project/load-project.ts';
import { type DependencyDeclaration, findDependency } from '../project/manifest.ts';
import { joinPath } from '../util/path.ts';
import { adapterFor, commandOutput, runSafely, sameLink, withLink } from './shared.ts';

export type InstallOutcome =
  | {
      readonly consumer: string;
      readonly ok: true;
      readonly version: string;
      readonly clearedCaches: readonly string[];
    }
  | { readonly consumer: string; readonly ok: false; readonly version: string; readonly output: string };

export interface InstallLinkInput {
  readonly library: LibraryRecord;
  readonly consumer: string;
  readonly version: string;
}

interface Target {
  readonly project: ProjectInfo;
  readonly declaration: DependencyDeclaration;
  readonly adapter: PackageManagerAdapter;
}

/**
 * Installs one dev version into one linked consumer, then clears the caches that would hide it
 * (ADR 0007). Every expected failure is an outcome, not an exception: a consumer that no longer
 * depends on the library, has an unsupported package manager, or whose install fails is marked
 * `failed`, and the others still get installed. The snapshot still allows a restore.
 */
export async function installLink(
  deps: CoreDeps,
  { library, consumer, version }: InstallLinkInput,
): Promise<{ readonly outcome: InstallOutcome; readonly link: LinkRecord }> {
  const fail = async (output: string) => {
    deps.events.emit({ type: 'install:failed', library: library.name, consumer, version, output });
    const link = await saveLink(deps, { library: library.name, consumer, status: 'failed' });
    return { outcome: { consumer, ok: false as const, version, output }, link };
  };

  let target: Target;
  try {
    target = await resolveTarget(deps, library, consumer);
  } catch (error) {
    if (error instanceof DevlinkError) return fail(error.message);
    throw error;
  }
  const { project, declaration, adapter } = target;

  deps.events.emit({ type: 'install:started', library: library.name, consumer, version });
  const result = await runSafely(
    deps,
    adapter.install({
      cwd: consumer,
      packageName: library.name,
      version,
      dependencyField: declaration.field,
      registryUrl: deps.registryUrl,
    }),
  );
  if (result.exitCode !== 0) return fail(commandOutput(result));

  const clearedCaches = cachePathsFor(project, deps.integrations);
  for (const path of clearedCaches) await deps.fs.remove(joinPath(consumer, path));

  deps.events.emit({ type: 'install:succeeded', library: library.name, consumer, version });
  if (clearedCaches.length > 0) deps.events.emit({ type: 'caches:cleared', consumer, paths: clearedCaches });

  const link = await saveLink(deps, {
    library: library.name,
    consumer,
    status: 'installed',
    installedVersion: version,
  });
  return { outcome: { consumer, ok: true, version, clearedCaches }, link };
}

async function resolveTarget(deps: CoreDeps, library: LibraryRecord, consumer: string): Promise<Target> {
  const project = await loadProject(deps.fs, consumer, deps.integrations);
  const declaration = findDependency(project.manifest, library.name);
  if (!declaration) {
    throw new DevlinkError('not-a-consumer', `${consumer} no longer depends on ${library.name}`, {
      consumer,
      library: library.name,
    });
  }
  return { project, declaration, adapter: adapterFor(deps, project) };
}

/** Writes a link against freshly loaded state, so concurrent edits to other records survive. */
async function saveLink(deps: CoreDeps, link: LinkRecord): Promise<LinkRecord> {
  const state = await deps.state.load();
  const previous = state.links.find((candidate) => sameLink(candidate, link));
  const merged: LinkRecord =
    link.status === 'failed' ? { ...link, installedVersion: previous?.installedVersion } : link;
  await deps.state.save(withLink(state, merged));
  return merged;
}
