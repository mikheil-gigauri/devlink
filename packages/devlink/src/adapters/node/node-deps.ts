import { join } from 'node:path';
import type { CoreDeps, EventSink, ProcessRunner, RegistryCredentials } from '../../core/ports.ts';
import { builtInIntegrations } from '../integrations/index.ts';
import { npm } from '../package-managers/npm.ts';
import { JsonStateStore } from './json-state-store.ts';
import { NodeFileSystem } from './node-file-system.ts';
import { NodeProcessRunner } from './node-process-runner.ts';

export interface NodeDepsOptions {
  /** devlink's data folder, e.g. `~/.devlink`. */
  readonly home: string;
  readonly registry: { readonly url: string; readonly credentials: RegistryCredentials };
  readonly events?: EventSink;
  readonly process?: ProcessRunner;
}

/** Wires the core to the real machine: Node file system, child processes, a JSON state file. */
export function createNodeDeps(options: NodeDepsOptions): CoreDeps {
  return {
    fs: new NodeFileSystem(),
    process: options.process ?? new NodeProcessRunner(),
    clock: { now: () => new Date() },
    state: new JsonStateStore(join(options.home, 'state.json')),
    events: options.events ?? { emit: () => {} },
    packageManagers: { npm },
    integrations: builtInIntegrations,
    registryUrl: options.registry.url,
    registryCredentials: options.registry.credentials,
    home: options.home,
  };
}
