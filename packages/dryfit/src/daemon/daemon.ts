import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { homedir } from 'node:os';
import { GitCommitGuard } from '../adapters/git/git-commit-guard.ts';
import type { DryfitHome } from '../adapters/node/dryfit-home.ts';
import { createNodeDeps } from '../adapters/node/node-deps.ts';
import { NodeLibraryWatcher } from '../adapters/node/node-library-watcher.ts';
import { NodeProcessRunner } from '../adapters/node/node-process-runner.ts';
import { readNpmRegistries, uplinksFrom } from '../adapters/registry/npm-uplinks.ts';
import { VerdaccioRegistry } from '../adapters/registry/verdaccio-registry.ts';
import { DryfitError } from '../core/errors.ts';
import { API_VERSION, type Health } from './api.ts';
import { EventHub } from './event-hub.ts';
import { createApiServer } from './http-server.ts';
import { DaemonService } from './service.ts';

const HOST = '127.0.0.1';

export interface StartDaemonOptions {
  readonly home: DryfitHome;
  readonly version: string;
  /** Environment for child processes and for finding the user's npm config. */
  readonly env?: NodeJS.ProcessEnv;
  readonly log: (message: string) => void;
}

export interface RunningDaemon {
  readonly url: string;
  readonly registryUrl: string;
  /** Resolves once the daemon has fully stopped, whoever asked it to. */
  readonly stopped: Promise<void>;
  stop(): Promise<void>;
}

/**
 * Starts dryfitd (ADR 0003, ADR 0012): the registry, the job queue and the HTTP API. It stops on a
 * `shutdown` request or `stop()`: the API closes, running commands are cancelled, the registry stops,
 * and `daemon.json` is removed so clients no longer find it.
 */
export async function startDaemon(options: StartDaemonOptions): Promise<RunningDaemon> {
  const { home, version } = options;
  const env = options.env ?? process.env;
  const { log } = options;

  await home.ensure();
  const config = await home.readConfig();
  const token = await home.ensureToken();
  const abort = new AbortController();
  const runner = new NodeProcessRunner({ baseEnv: env, signal: abort.signal });

  const ownRegistry = `http://${HOST}:${config.ports.registry}/`;
  const npmRegistries = await readNpmRegistries(runner, { cwd: env.HOME ?? homedir(), env });
  const registry = await VerdaccioRegistry.start({
    storage: home.paths.registry,
    port: config.ports.registry,
    uplinks: uplinksFrom({ ...npmRegistries, ownRegistry }),
    logLevel: 'warn',
  });

  const hub = new EventHub();
  // A failed install is otherwise only visible to a client that was listening at the time.
  hub.subscribe((event) => {
    if (event.type === 'install:failed')
      log(`install of ${event.library}@${event.version} into ${event.consumer} failed:\n${event.output}`);
  });
  let deps: ReturnType<typeof createNodeDeps>;
  try {
    deps = createNodeDeps({ home: home.root, registry, events: hub, process: runner });
  } catch (error) {
    await registry.stop();
    throw error;
  }
  const startedAt = new Date().toISOString();
  const health = (): Health => ({
    name: 'dryfit',
    version,
    apiVersion: API_VERSION,
    pid: process.pid,
    registryUrl: registry.url,
    startedAt,
  });

  let resolveStopped!: () => void;
  const stopped = new Promise<void>((resolve) => (resolveStopped = resolve));
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      try {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
        abort.abort();
        await service.stop();
        await registry.stop();
        await home.removeDaemonInfo(process.pid);
      } catch (error) {
        log(`stopping: ${String(error)}`);
      } finally {
        // Whatever failed, `daemon run` must still exit rather than wait forever.
        resolveStopped();
      }
    })();
    return stopping;
  };

  const service = new DaemonService({
    deps,
    hub,
    health,
    roots: async () => (await home.readConfig()).roots,
    saveRoots: async (roots) => home.writeConfig({ ...(await home.readConfig()), roots }),
    hiddenApps: async () => (await home.readConfig()).hiddenApps,
    saveHiddenApps: async (hiddenApps) => home.writeConfig({ ...(await home.readConfig()), hiddenApps }),
    watcher: new NodeLibraryWatcher(),
    guard: new GitCommitGuard(
      new NodeProcessRunner({ baseEnv: env, signal: abort.signal, timeoutMs: 30_000 }),
    ),
    onShutdown: () => void stop(),
  });
  const server = createApiServer({ token, hub, health, service, onError: (error) => log(String(error)) });

  let port: number;
  try {
    port = await listen(server, config.ports.api);
  } catch (error) {
    await registry.stop();
    throw error;
  }
  try {
    await home.writeDaemonInfo({ pid: process.pid, port, version, registryUrl: registry.url, startedAt });
    await service.start();
  } catch (error) {
    // Leave nothing half-started behind: no open ports, no record pointing at this process.
    await stop();
    throw error;
  }
  log(`dryfit ${version} listening on http://${HOST}:${port}/, registry ${registry.url}`);

  return { url: `http://${HOST}:${port}/`, registryUrl: registry.url, stopped, stop };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      const reason =
        error.code === 'EADDRINUSE'
          ? `port ${port} is already in use (change "ports.api" in config.json, or stop what uses it)`
          : error.message;
      reject(new DryfitError('daemon-failed', `The dryfit daemon could not start: ${reason}`, { port }));
    };
    server.once('error', onError);
    server.listen(port, HOST, () => {
      server.off('error', onError);
      resolve((server.address() as AddressInfo).port);
    });
  });
}
