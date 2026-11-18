import { DevlinkError } from '../errors.ts';
import { DEPENDENCY_FIELDS, type SnapshotMeta } from '../model.ts';
import type { CoreDeps } from '../ports.ts';
import { cachePathsFor } from '../project/cache-paths.ts';
import { loadProject } from '../project/load-project.ts';
import { isRecord, stableStringify, tryParseJson } from '../util/json.ts';
import { joinPath } from '../util/path.ts';
import { commandOutput, runSafely, snapshotDir } from './shared.ts';

export interface RestoreConsumerInput {
  readonly consumer: string;
  /** Restore even if the manifest has changes devlink did not make. */
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
 */
export async function restoreConsumer(deps: CoreDeps, input: RestoreConsumerInput): Promise<RestoreResult> {
  const consumer = joinPath(input.consumer);
  const dir = snapshotDir(deps, consumer);
  const metaText = await deps.fs.readText(joinPath(dir, 'meta.json'));
  const snapshotManifest = await deps.fs.readText(joinPath(dir, 'package.json'));
  if (metaText === undefined || snapshotManifest === undefined) {
    throw new DevlinkError('snapshot-missing', `${consumer} has no devlink snapshot to restore`, {
      consumer,
    });
  }
  const meta = JSON.parse(metaText) as SnapshotMeta;

  const adapter = deps.packageManagers[meta.packageManager];
  if (!adapter) {
    throw new DevlinkError('unsupported-package-manager', `No adapter for ${meta.packageManager}`, {
      consumer,
    });
  }

  const state = await deps.state.load();
  const linkedLibraries = state.links
    .filter((link) => link.consumer === consumer)
    .map((link) => link.library);

  if (!input.force) {
    const current = (await deps.fs.readText(joinPath(consumer, 'package.json'))) ?? '';
    if (userControlled(current, linkedLibraries) !== userControlled(snapshotManifest, linkedLibraries)) {
      throw new DevlinkError(
        'manifest-drifted',
        `${consumer}/package.json has changes devlink did not make. Commit or move them, or restore with force.`,
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

  const project = await loadProject(deps.fs, consumer, deps.integrations);
  const caches = cachePathsFor(project, deps.integrations);
  for (const path of caches) await deps.fs.remove(joinPath(consumer, path));
  if (caches.length > 0) deps.events.emit({ type: 'caches:cleared', consumer, paths: caches });

  const latest = await deps.state.load();
  await deps.state.save({ ...latest, links: latest.links.filter((link) => link.consumer !== consumer) });
  await deps.fs.remove(dir);

  const ok = result.exitCode === 0;
  deps.events.emit({ type: 'consumer:restored', consumer, ok });
  return ok ? { ok } : { ok, output: commandOutput(result) };
}

/**
 * A manifest reduced to what the user controls, for drift detection: entries for linked libraries are
 * removed (devlink rewrote those), dependency fields left empty by that are dropped (a package manager
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
