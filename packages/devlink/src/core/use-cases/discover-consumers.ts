import { DevlinkError } from '../errors.ts';
import type { DependencyField } from '../model.ts';
import { detectPackageManager, type PackageManagerDetection } from '../package-manager/detect.ts';
import type { CoreDeps, ProjectInfo } from '../ports.ts';
import { loadProject } from '../project/load-project.ts';
import { findDependency } from '../project/manifest.ts';
import { joinPath } from '../util/path.ts';

export interface DiscoverConsumersInput {
  /** Folders to search, such as `~/Repositories`. */
  readonly roots: readonly string[];
  /** How many folder levels below each root to search. Defaults to 3. */
  readonly maxDepth?: number;
}

export interface DiscoveredConsumer {
  readonly root: string;
  readonly name: string | undefined;
  readonly packageManager: PackageManagerDetection;
  readonly libraries: readonly {
    readonly name: string;
    readonly field: DependencyField;
    readonly range: string;
  }[];
}

const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', 'build', 'coverage']);

/**
 * Lists projects that depend on a registered library (ADR 0005). Read-only: it never changes a
 * project. The search stops at the first package.json in a branch, because that folder owns the
 * lockfile and is where an install has to run.
 */
export async function discoverConsumers(
  deps: CoreDeps,
  { roots, maxDepth = 3 }: DiscoverConsumersInput,
): Promise<DiscoveredConsumer[]> {
  const { libraries } = await deps.state.load();
  if (libraries.length === 0) return [];

  const libraryRoots = new Set(libraries.map((library) => library.root));
  const found: DiscoveredConsumer[] = [];

  const visit = async (dir: string, depth: number): Promise<void> => {
    const entries = await deps.fs.readDir(dir);

    if (entries.some((entry) => entry.name === 'package.json' && !entry.isDirectory)) {
      if (libraryRoots.has(dir)) return;
      const project = await tryLoadProject(deps, dir);
      const consumer = project && asConsumer(project, libraries);
      if (consumer) found.push(consumer);
      return;
    }

    if (depth >= maxDepth) return;
    for (const entry of entries) {
      if (entry.isDirectory && !entry.name.startsWith('.') && !SKIPPED_FOLDERS.has(entry.name)) {
        await visit(joinPath(dir, entry.name), depth + 1);
      }
    }
  };

  for (const root of roots) await visit(joinPath(root), 0);
  return found.sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
}

async function tryLoadProject(deps: CoreDeps, dir: string): Promise<ProjectInfo | undefined> {
  try {
    return await loadProject(deps.fs, dir);
  } catch (error) {
    if (error instanceof DevlinkError && error.code === 'invalid-manifest') return undefined;
    throw error;
  }
}

function asConsumer(
  project: ProjectInfo,
  libraries: readonly { readonly name: string }[],
): DiscoveredConsumer | undefined {
  const used = libraries.flatMap(({ name }) => {
    const declaration = findDependency(project.manifest, name);
    return declaration ? [{ name, ...declaration }] : [];
  });
  if (used.length === 0) return undefined;

  return {
    root: project.root,
    name: project.manifest.name,
    packageManager: detectPackageManager({ files: project.rootFiles, manifest: project.manifest }),
    libraries: used,
  };
}
