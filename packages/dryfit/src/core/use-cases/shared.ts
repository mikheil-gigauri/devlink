import { DryfitError } from '../errors.ts';
import type { CommandSpec, DryfitState, LibraryRecord, LinkRecord } from '../model.ts';
import { detectPackageManager } from '../package-manager/detect.ts';
import type { CommandResult, CoreDeps, PackageManagerAdapter, ProjectInfo } from '../ports.ts';
import { joinPath, pathSlug } from '../util/path.ts';

/** The dist-tag every dev version is published under, so `latest` is never touched (ADR 0004). */
export const DEV_TAG = 'dryfit';

export function requireLibrary(state: DryfitState, name: string): LibraryRecord {
  const library = state.libraries.find((candidate) => candidate.name === name);
  if (!library) {
    throw new DryfitError('library-not-found', `No library named ${name} is registered`, { library: name });
  }
  return library;
}

export function withLibrary(state: DryfitState, library: LibraryRecord): DryfitState {
  const others = state.libraries.filter((candidate) => candidate.name !== library.name);
  return { ...state, libraries: [...others, library] };
}

/** Inserts or replaces a link, keeping the existing order so status lists stay stable. */
export function withLink(state: DryfitState, link: LinkRecord): DryfitState {
  const index = state.links.findIndex((candidate) => sameLink(candidate, link));
  const links = index === -1 ? [...state.links, link] : state.links.with(index, link);
  return { ...state, links };
}

export function sameLink(
  a: Pick<LinkRecord, 'library' | 'consumer'>,
  b: Pick<LinkRecord, 'library' | 'consumer'>,
) {
  return a.library === b.library && a.consumer === b.consumer;
}

export function snapshotDir(deps: Pick<CoreDeps, 'home'>, consumer: string): string {
  return joinPath(deps.home, 'snapshots', pathSlug(consumer));
}

export function stagingDir(deps: Pick<CoreDeps, 'home'>, library: string): string {
  return joinPath(deps.home, 'staging', pathSlug(library));
}

/** The adapter for a project's package manager, or a DryfitError explaining why there is none. */
export function adapterFor(
  deps: Pick<CoreDeps, 'packageManagers'>,
  project: ProjectInfo,
): PackageManagerAdapter {
  const detection = detectPackageManager({ files: project.rootFiles, manifest: project.manifest });

  if (!detection.ok) {
    if (detection.reason === 'multiple-lockfiles') {
      throw new DryfitError(
        'package-manager-undetected',
        `${project.root} has lockfiles from more than one package manager (${detection.lockfiles.join(', ')}). Delete the ones you don't use.`,
        { project: project.root, lockfiles: detection.lockfiles },
      );
    }
    if (detection.reason === 'binary-lockfile') {
      throw new DryfitError(
        'unsupported-package-manager',
        `${project.root} has a binary ${detection.lockfile}, which dryfit cannot restore. Switch to the text lockfile with \`bun install --save-text-lockfile\`.`,
        { project: project.root, packageManager: 'bun' },
      );
    }
    throw new DryfitError(
      'unsupported-package-manager',
      `${project.root} uses ${detection.value}, which dryfit does not support`,
      { project: project.root, packageManager: detection.value },
    );
  }

  const adapter = deps.packageManagers[detection.name];
  if (!adapter) {
    throw new DryfitError(
      'unsupported-package-manager',
      `${project.root} uses ${detection.name}, which dryfit does not support yet`,
      { project: project.root, packageManager: detection.name },
    );
  }
  return adapter;
}

/**
 * Runs a command, turning a failure to start it (npm not on PATH, a missing cwd) into a failed result
 * so callers handle every failure the same way instead of skipping their cleanup.
 */
export async function runSafely(deps: Pick<CoreDeps, 'process'>, spec: CommandSpec): Promise<CommandResult> {
  try {
    return await deps.process.run(spec);
  } catch (error) {
    return { exitCode: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
  }
}

/** The most useful text from a failed command: stderr when there is any, else stdout. */
export function commandOutput(result: { readonly stdout: string; readonly stderr: string }): string {
  return result.stderr.trim() || result.stdout.trim();
}

/**
 * A failed command's output cut to its last lines, short enough to keep on a link. Package managers
 * end with the reason (npm's ERESOLVE report, a 404, a peer conflict), so the end is what matters.
 */
export function failureMessage(output: string, maxLines = 20, maxChars = 2000): string {
  const tail = output.trim().split('\n').slice(-maxLines).join('\n');
  return tail.length > maxChars ? `…${tail.slice(-maxChars)}` : tail;
}
