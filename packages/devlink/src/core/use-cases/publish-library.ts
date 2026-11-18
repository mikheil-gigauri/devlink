import { DevlinkError } from '../errors.ts';
import type { LibraryRecord } from '../model.ts';
import type { CoreDeps } from '../ports.ts';
import { loadProject } from '../project/load-project.ts';
import { formatManifest, readManifest } from '../project/manifest.ts';
import { joinPath } from '../util/path.ts';
import { nextDevVersion } from '../version/dev-version.ts';
import {
  adapterFor,
  commandOutput,
  DEV_TAG,
  requireLibrary,
  runSafely,
  stagingDir,
  withLibrary,
} from './shared.ts';

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
  const library = requireLibrary(await deps.state.load(), name);

  await build(deps, library);

  const { manifest, text, path } = await readManifest(deps.fs, library.publishDir);
  if (typeof manifest.version !== 'string') {
    throw new DevlinkError('invalid-manifest', `${path} has no "version"`, { path });
  }
  const version = nextDevVersion({
    base: manifest.version,
    now: deps.clock.now(),
    previous: library.lastPublishedVersion,
  });

  const adapter = adapterFor(deps, await loadProject(deps.fs, library.root));
  const staging = stagingDir(deps, library.name);
  try {
    await deps.fs.remove(staging);
    await deps.fs.copyDir(library.publishDir, staging, { exclude: NOT_PUBLISHED });
    await deps.fs.writeText(
      joinPath(staging, 'package.json'),
      formatManifest({ ...manifest, version }, text),
    );
    const authFiles = adapter.publishAuthFiles({
      registryUrl: deps.registryUrl,
      credentials: deps.registryCredentials,
    });
    for (const [file, content] of Object.entries(authFiles)) {
      await deps.fs.writeText(joinPath(staging, file), content, { private: true });
    }

    const result = await runSafely(
      deps,
      adapter.publish({ cwd: staging, registryUrl: deps.registryUrl, tag: DEV_TAG }),
    );
    if (result.exitCode !== 0) {
      const output = commandOutput(result);
      throw new DevlinkError('publish-failed', `Publishing ${library.name}@${version} failed`, {
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

async function build(deps: CoreDeps, library: LibraryRecord): Promise<void> {
  if (!library.build) return;

  deps.events.emit({ type: 'build:started', library: library.name });
  const result = await runSafely(deps, library.build);
  if (result.exitCode !== 0) {
    const output = commandOutput(result);
    deps.events.emit({ type: 'build:failed', library: library.name, output });
    throw new DevlinkError('build-failed', `Building ${library.name} failed`, {
      library: library.name,
      output,
    });
  }
  deps.events.emit({ type: 'build:succeeded', library: library.name });
}
