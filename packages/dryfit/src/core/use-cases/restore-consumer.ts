import { DryfitError } from '../errors.ts';
import { DEPENDENCY_FIELDS, type SnapshotMeta } from '../model.ts';
import type { CoreDeps } from '../ports.ts';
import { cachePathsFor } from '../project/cache-paths.ts';
import { loadProject } from '../project/load-project.ts';
import { isRecord, stableStringify, tryParseJson } from '../util/json.ts';
import { joinPath } from '../util/path.ts';
import { installLink } from './install-link.ts';
import { commandOutput, requireLibrary, runSafely, snapshotDir } from './shared.ts';

export interface RestoreConsumerInput {
  readonly consumer: string;
  /** Restore only this library and keep the consumer's other links. Default: every library. */
  readonly library?: string | undefined;
  /** Restore even if the manifest has changes dryfit did not make. */
  readonly force?: boolean | undefined;
}

export type RestoreResult = { readonly ok: true } | { readonly ok: false; readonly output: string };

/**
 * Returns a consumer to exactly the state it was in before its first link (ADR 0005): manifest and
 * lockfiles are written back from the snapshot, then a clean install makes node_modules match them.
 *
 * Files are restored first and unconditionally, so even if the clean install fails the repository is
 * already correct and the user only has to rerun the install. Only package.json is checked for user
 * changes; lockfile changes made while linked are reverted by design (see ADR 0005).
 *
 * With `library`, only that library goes back to its release. The consumer is restored as above,
 * then the dev builds of its other linked libraries are installed again at the versions they had, and
 * the snapshot is kept for them. One snapshot per consumer keeps the lockfile exact for the library
 * restored, at the cost of a second install.
 */
export async function restoreConsumer(deps: CoreDeps, input: RestoreConsumerInput): Promise<RestoreResult> {
  const consumer = joinPath(input.consumer);
  const dir = snapshotDir(deps, consumer);
  const metaText = await deps.fs.readText(joinPath(dir, 'meta.json'));
  const snapshotManifest = await deps.fs.readText(joinPath(dir, 'package.json'));
  if (metaText === undefined || snapshotManifest === undefined) {
    throw new DryfitError('snapshot-missing', `${consumer} has no dryfit snapshot to restore`, {
      consumer,
    });
  }
  const meta = JSON.parse(metaText) as SnapshotMeta;

  const adapter = deps.packageManagers[meta.packageManager];
  if (!adapter) {
    throw new DryfitError('unsupported-package-manager', `No adapter for ${meta.packageManager}`, {
      consumer,
    });
  }

  const state = await deps.state.load();
  const links = state.links.filter((link) => link.consumer === consumer);
  const linkedLibraries = links.map((link) => link.library);
  if (input.library !== undefined && !linkedLibraries.includes(input.library)) {
    throw new DryfitError('invalid-request', `${input.library} is not linked into ${consumer}`, {
      consumer,
      library: input.library,
    });
  }
  const kept = input.library === undefined ? [] : links.filter((link) => link.library !== input.library);

  if (!input.force) {
    const current = (await deps.fs.readText(joinPath(consumer, 'package.json'))) ?? '';
    if (userControlled(current, linkedLibraries) !== userControlled(snapshotManifest, linkedLibraries)) {
      throw new DryfitError(
        'manifest-drifted',
        `${consumer}/package.json has changes dryfit did not make. Commit or move them, or restore with force.`,
        { consumer },
      );
    }
  }

  await deps.fs.writeText(joinPath(consumer, 'package.json'), snapshotManifest);
  for (const lockfile of adapter.lockfiles) {
    const saved = meta.lockfiles.includes(lockfile)
      ? await deps.fs.readText(joinPath(dir, lockfile))
      : undefined;
    if (saved === undefined) await deps.fs.remove(joinPath(consumer, lockfile));
    else await deps.fs.writeText(joinPath(consumer, lockfile), saved);
  }

  const result = await runSafely(
    deps,
    adapter.cleanInstall({ cwd: consumer, hasLockfile: meta.lockfiles.length > 0 }),
  );
  // Some managers (Yarn Berry) write a lockfile on every install; one the consumer never had goes.
  for (const lockfile of adapter.lockfiles) {
    if (!meta.lockfiles.includes(lockfile)) await deps.fs.remove(joinPath(consumer, lockfile));
  }

  const project = await loadProject(deps.fs, consumer, deps.integrations);
  const caches = cachePathsFor(project, deps.integrations);
  for (const path of caches) await deps.fs.remove(joinPath(consumer, path));
  if (caches.length > 0) deps.events.emit({ type: 'caches:cleared', consumer, paths: caches });

  const ok = result.exitCode === 0;
  if (input.library !== undefined && kept.length > 0) {
    await relinkOthers(deps, consumer, input.library, ok);
    deps.events.emit({ type: 'consumer:restored', consumer, library: input.library, ok });
    return ok ? { ok } : { ok, output: commandOutput(result) };
  }

  const latest = await deps.state.load();
  await deps.state.save({ ...latest, links: latest.links.filter((link) => link.consumer !== consumer) });
  await deps.fs.remove(dir);

  deps.events.emit({ type: 'consumer:restored', consumer, ok });
  return ok ? { ok } : { ok, output: commandOutput(result) };
}

/**
 * After a whole-consumer restore made for one library: drops that library's link and puts the other
 * libraries' dev builds back. Their links are pending until reinstalled, since the files now hold the
 * releases; when the clean install failed they stay pending, for the next sync.
 */
async function relinkOthers(deps: CoreDeps, consumer: string, restored: string, installed: boolean) {
  const state = await deps.state.load();
  const others = state.links.filter((link) => link.consumer === consumer && link.library !== restored);
  await deps.state.save({
    ...state,
    links: [
      ...state.links.filter((link) => link.consumer !== consumer),
      ...others.map(({ installedVersion: _, ...link }) => ({ ...link, status: 'pending' as const })),
    ],
  });
  if (!installed) return;
  for (const link of others) {
    if (link.installedVersion === undefined) continue;
    const library = requireLibrary(state, link.library);
    await installLink(deps, { library, consumer, version: link.installedVersion });
  }
}

/**
 * A manifest reduced to what the user controls, for drift detection: entries for linked libraries are
 * removed (dryfit rewrote those), dependency fields left empty by that are dropped (a package manager
 * may have created them), and keys are sorted (package managers reorder them). Unparseable text is
 * compared as-is.
 */
function userControlled(text: string, libraries: readonly string[]): string {
  const manifest = tryParseJson(text);
  if (!isRecord(manifest)) return text;

  const reduced: Record<string, unknown> = { ...manifest };
  for (const field of DEPENDENCY_FIELDS) {
    const entries = manifest[field];
    if (!isRecord(entries)) continue;
    const kept = Object.entries(entries).filter(([name]) => !libraries.includes(name));
    if (kept.length === 0) delete reduced[field];
    else reduced[field] = Object.fromEntries(kept);
  }
  return stableStringify(reduced);
}
