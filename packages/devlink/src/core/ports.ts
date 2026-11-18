import type { CommandSpec, DependencyField, DevlinkState, Manifest } from './model.ts';
import type { PackageManagerName } from './package-manager/detect.ts';

/** File system access. Paths are absolute and POSIX-style. */
export interface FileSystem {
  /** Returns undefined when the file does not exist. */
  readText(path: string): Promise<string | undefined>;
  /** Creates missing parent folders. */
  writeText(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Entries directly inside a folder, sorted by name. Empty when the folder does not exist. */
  readDir(path: string): Promise<readonly DirEntry[]>;
  /** Removes a file or a folder recursively. Does nothing when the path does not exist. */
  remove(path: string): Promise<void>;
  /** Copies a folder recursively, skipping entries whose name is in `exclude` at any depth. */
  copyDir(from: string, to: string, options: { readonly exclude: readonly string[] }): Promise<void>;
}

export interface DirEntry {
  readonly name: string;
  readonly isDirectory: boolean;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessRunner {
  run(spec: CommandSpec): Promise<CommandResult>;
}

export interface Clock {
  now(): Date;
}

export interface StateStore {
  load(): Promise<DevlinkState>;
  save(state: DevlinkState): Promise<void>;
}

export interface InstallSpec {
  readonly cwd: string;
  readonly packageName: string;
  readonly version: string;
  /** Keeps the package in the manifest field it was already declared in. */
  readonly dependencyField: DependencyField;
  readonly registryUrl: string;
}

export interface PublishSpec {
  readonly cwd: string;
  readonly registryUrl: string;
  readonly tag: string;
}

export interface CleanInstallSpec {
  readonly cwd: string;
  /** Whether a lockfile exists to install from exactly. */
  readonly hasLockfile: boolean;
}

export interface RegistryLeak {
  /** Where the leak is, e.g. the lockfile key `node_modules/@acme/ui`. */
  readonly location: string;
  readonly reasons: readonly ('local-registry-url' | 'dev-version')[];
}

/** Everything devlink needs from a package manager (ADR 0006). Implementations are pure. */
export interface PackageManagerAdapter {
  readonly name: PackageManagerName;
  /** Lockfile names this manager writes, most common first. */
  readonly lockfiles: readonly string[];
  install(spec: InstallSpec): CommandSpec;
  cleanInstall(spec: CleanInstallSpec): CommandSpec;
  publish(spec: PublishSpec): CommandSpec;
  findRegistryLeaks(lockfile: string, registryUrl: string): readonly RegistryLeak[];
}

export type PackageManagerAdapters = Readonly<Partial<Record<PackageManagerName, PackageManagerAdapter>>>;

/** What integrations and use cases know about a project folder. */
export interface ProjectInfo {
  readonly root: string;
  readonly manifest: Manifest;
  /** Names of the entries directly inside `root`. */
  readonly rootFiles: readonly string[];
  /** Parsed contents of the config files integrations asked for, keyed by file name. */
  readonly configs: ReadonlyMap<string, unknown>;
}

/** Framework knowledge about caches that hide a freshly installed library (ADR 0007). */
export interface ConsumerIntegration {
  readonly id: string;
  /** Root-level JSON files this integration wants parsed into `ProjectInfo.configs`. */
  readonly configFiles?: readonly string[];
  detect(project: ProjectInfo): boolean;
  /** Cache folders relative to the project root. */
  cachePaths(project: ProjectInfo): readonly string[];
}

export type DevlinkEvent =
  | { readonly type: 'build:started'; readonly library: string }
  | { readonly type: 'build:succeeded'; readonly library: string }
  | { readonly type: 'build:failed'; readonly library: string; readonly output: string }
  | { readonly type: 'publish:succeeded'; readonly library: string; readonly version: string }
  | {
      readonly type: 'install:started';
      readonly library: string;
      readonly consumer: string;
      readonly version: string;
    }
  | {
      readonly type: 'install:succeeded';
      readonly library: string;
      readonly consumer: string;
      readonly version: string;
    }
  | {
      readonly type: 'install:failed';
      readonly library: string;
      readonly consumer: string;
      readonly version: string;
      readonly output: string;
    }
  | { readonly type: 'caches:cleared'; readonly consumer: string; readonly paths: readonly string[] }
  | { readonly type: 'consumer:restored'; readonly consumer: string; readonly ok: boolean };

export interface EventSink {
  emit(event: DevlinkEvent): void;
}

/** Everything a use case may touch. Assembled by the daemon, or by fakes in tests. */
export interface CoreDeps {
  readonly fs: FileSystem;
  readonly process: ProcessRunner;
  readonly clock: Clock;
  readonly state: StateStore;
  readonly events: EventSink;
  readonly packageManagers: PackageManagerAdapters;
  readonly integrations: readonly ConsumerIntegration[];
  /** The local registry's base URL, e.g. `http://127.0.0.1:4873/`. */
  readonly registryUrl: string;
  /** devlink's own data folder, e.g. `~/.devlink`. */
  readonly home: string;
}
