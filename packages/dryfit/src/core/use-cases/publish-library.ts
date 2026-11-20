import { DryfitError } from '../errors.ts';
import type { LibraryRecord, Manifest } from '../model.ts';
import { DEPENDENCY_FIELDS } from '../model.ts';
import type { CoreDeps } from '../ports.ts';
import { RUNTIME_DEPENDENCY_FIELDS } from '../project/library-graph.ts';
import { formatManifest, readManifest } from '../project/manifest.ts';
import { isRecord } from '../util/json.ts';
import { joinPath } from '../util/path.ts';
import { nextDevVersion } from '../version/dev-version.ts';
import { commandOutput, DEV_TAG, requireLibrary, runSafely, stagingDir, withLibrary } from './shared.ts';

export interface PublishLibraryInput {
  readonly library: string;
}

/** Folders never copied into the staging area. */
const NOT_PUBLISHED = ['node_modules', '.git'];

/**
 * Builds a library and publishes it to the local registry under a fresh dev version (ADR 0004).
 *
 * The version is written into a staged copy of the publish folder, never into the library's own
 * files, so the working tree and the build output stay exactly as the developer left them.
 */
export async function publishLibrary(
  deps: CoreDeps,
  { library: name }: PublishLibraryInput,
): Promise<{ version: string }> {
  const { libraries } = await deps.state.load();
  const library = requireLibrary({ libraries }, name);

  await build(deps, library);

  const { manifest, text, path } = await readManifest(deps.fs, library.publishDir);
  if (typeof manifest.version !== 'string') {
    throw new DryfitError('invalid-manifest', `${path} has no "version"`, { path });
  }
  const version = nextDevVersion({
    base: manifest.version,
    now: deps.clock.now(),
    previous: library.lastPublishedVersion,
  });

  const pinned = withSiblingPins(manifest, libraries, library.name);
  refuseWorkspaceRanges(pinned, path);

  const staging = stagingDir(deps, library.name);
  try {
    await deps.fs.remove(staging);
    await deps.fs.copyDir(library.publishDir, staging, { exclude: NOT_PUBLISHED });
    await deps.fs.writeText(
      joinPath(staging, 'package.json'),
      formatManifest(withoutPublishRegistry({ ...pinned, version }), text),
    );
    const authFiles = deps.publisher.publishAuthFiles({
      registryUrl: deps.registryUrl,
      credentials: deps.registryCredentials,
    });
    for (const [file, content] of Object.entries(authFiles)) {
      await deps.fs.writeText(joinPath(staging, file), content, { private: true });
    }

    const result = await runSafely(
      deps,
      deps.publisher.publish({
        cwd: staging,
        packageName: library.name,
        registryUrl: deps.registryUrl,
        tag: DEV_TAG,
      }),
    );
    if (result.exitCode !== 0) {
      const output = commandOutput(result);
      throw new DryfitError('publish-failed', `Publishing ${library.name}@${version} failed`, {
        library: library.name,
        version,
        output,
      });
    }
  } finally {
    await deps.fs.remove(staging);
  }

  const state = await deps.state.load();
  await deps.state.save(
    withLibrary(state, { ...requireLibrary(state, name), lastPublishedVersion: version }),
  );
  deps.events.emit({ type: 'publish:succeeded', library: library.name, version });
  return { version };
}

/**
 * Points every runtime dependency on another registered library at that library's latest dev build
 * (ADR 0014). Workspaces that pin their own packages exactly would otherwise publish dev builds that
 * demand the siblings' source versions, which neither the app nor the local registry has as dev builds.
 * Ranges are pinned too: a prerelease satisfies no ordinary range, so the sibling's dev build would be
 * skipped for a release. Siblings never published keep what the manifest says.
 */
function withSiblingPins(manifest: Manifest, libraries: readonly LibraryRecord[], self: string): Manifest {
  const devVersions = new Map(
    libraries.flatMap((library) =>
      library.name !== self && library.lastPublishedVersion !== undefined
        ? [[library.name, library.lastPublishedVersion] as const]
        : [],
    ),
  );
  let pinned = manifest;
  for (const field of RUNTIME_DEPENDENCY_FIELDS) {
    const entries = manifest[field];
    if (!isRecord(entries) || !Object.keys(entries).some((name) => devVersions.has(name))) continue;
    pinned = {
      ...pinned,
      [field]: Object.fromEntries(
        Object.entries(entries).map(([name, range]) => [name, devVersions.get(name) ?? range]),
      ),
    };
  }
  return pinned;
}

/**
 * `publishConfig.registry` and `publishConfig["@scope:registry"]` override the command line, so a dev
 * build would go to the library's real registry. The staged copy drops them; the rest of
 * `publishConfig` (access, directory, …) still applies.
 */
function withoutPublishRegistry(manifest: Manifest): Manifest {
  const { publishConfig } = manifest;
  if (!isRecord(publishConfig)) return manifest;
  const kept = Object.fromEntries(
    Object.entries(publishConfig).filter(([key]) => key !== 'registry' && !/^@[^:]+:registry$/.test(key)),
  );
  const { publishConfig: _dropped, ...rest } = manifest;
  return Object.keys(kept).length === 0 ? rest : { ...rest, publishConfig: kept };
}

/**
 * `workspace:` and `catalog:` ranges mean something only inside the library's own pnpm, Yarn or Bun
 * workspace, which rewrites them when it publishes. A staged copy has no workspace around it, so
 * they would reach consumers as-is and fail their installs.
 */
function refuseWorkspaceRanges(manifest: Manifest, path: string): void {
  const unresolved = DEPENDENCY_FIELDS.flatMap((field) => {
    const entries = manifest[field];
    return isRecord(entries)
      ? Object.entries(entries).filter(
          ([, range]) => typeof range === 'string' && /^(workspace|catalog):/.test(range),
        )
      : [];
  });
  if (unresolved.length === 0) return;
  const list = unresolved.map(([name, range]) => `${name} (${String(range)})`).join(', ');
  throw new DryfitError(
    'invalid-manifest',
    `${path} depends on ${list}, which only the library's workspace can resolve. Publish a build output whose package.json has real versions, and point dryfit at it with \`dryfit add --publish-dir\`.`,
    { path },
  );
}

async function build(deps: CoreDeps, library: LibraryRecord): Promise<void> {
  if (!library.build) return;

  deps.events.emit({ type: 'build:started', library: library.name });
  const result = await runSafely(deps, library.build);
  if (result.exitCode !== 0) {
    const output = commandOutput(result);
    deps.events.emit({ type: 'build:failed', library: library.name, output });
    throw new DryfitError('build-failed', `Building ${library.name} failed`, {
      library: library.name,
      output,
    });
  }
  deps.events.emit({ type: 'build:succeeded', library: library.name });
}
