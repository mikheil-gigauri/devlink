import type { CoreDeps } from '../ports.ts';
import { type InstallOutcome, installLink } from './install-link.ts';
import { publishLibrary } from './publish-library.ts';
import { requireLibrary } from './shared.ts';

export interface SyncLibraryInput {
  readonly library: string;
}

export interface SyncResult {
  readonly version: string;
  readonly installs: readonly InstallOutcome[];
}

/**
 * One full cycle: build and publish the library once, then install that version into every linked
 * consumer in turn. Consumers are installed one at a time because package managers share a global
 * cache that does not tolerate concurrent writers well.
 */
export async function syncLibrary(deps: CoreDeps, { library: name }: SyncLibraryInput): Promise<SyncResult> {
  const { version } = await publishLibrary(deps, { library: name });

  const state = await deps.state.load();
  const library = requireLibrary(state, name);
  const consumers = state.links.filter((link) => link.library === name).map((link) => link.consumer);

  const installs: InstallOutcome[] = [];
  for (const consumer of consumers) {
    installs.push((await installLink(deps, { library, consumer, version })).outcome);
  }
  return { version, installs };
}
