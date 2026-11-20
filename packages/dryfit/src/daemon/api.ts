import type { DryfitErrorCode } from '../core/errors.ts';
import type { GroupRecord, LibraryRecord, LinkRecord } from '../core/model.ts';
import type { LibraryBuildKind } from '../core/project/detect-library-build.ts';
import type { CoherenceWarning } from '../core/status/coherence.ts';
import type { DiscoveredConsumer } from '../core/use-cases/discover-consumers.ts';
import type { GroupMemberOutcome } from '../core/use-cases/groups.ts';
import type { RestoreResult } from '../core/use-cases/restore-consumer.ts';
import type { SyncResult } from '../core/use-cases/sync-library.ts';
import type { JobInfo } from './job-queue.ts';
import { type Infer, s } from './schema.ts';

/**
 * The daemon's API contract (ADR 0012), shared by the server, the CLI and, through JSON Schema, the
 * menu bar app. Every operation is `POST /v1/<name>` with a JSON body; `GET /v1/health` and
 * `GET /v1/events` (server-sent events) complete it.
 */
export const API_VERSION = 1;

export const operations = {
  status: s.object({}),
  register: s.object({
    root: s.path(),
    publishDir: s.optional(s.path()),
    build: s.optional(s.object({ command: s.string(), args: s.array(s.string()) })),
  }),
  unregister: s.object({ library: s.string() }),
  inspect: s.object({ root: s.path() }),
  sync: s.object({ library: s.string() }),
  watch: s.object({ library: s.string(), enabled: s.boolean() }),
  discover: s.object({ library: s.optional(s.string()) }),
  link: s.object({ library: s.string(), consumer: s.path(), guard: s.optional(s.boolean()) }),
  restore: s.object({ consumer: s.path(), library: s.optional(s.string()), force: s.optional(s.boolean()) }),
  saveGroup: s.object({ name: s.string(), consumers: s.array(s.path()) }),
  deleteGroup: s.object({ name: s.string() }),
  linkGroup: s.object({ group: s.string(), library: s.string() }),
  restoreGroup: s.object({ group: s.string(), force: s.optional(s.boolean()) }),
  roots: s.object({}),
  setRoots: s.object({ roots: s.array(s.path()) }),
  hiddenApps: s.object({}),
  hideApps: s.object({ consumers: s.array(s.path()), hidden: s.boolean() }),
  shutdown: s.object({}),
} as const;

export type OperationName = keyof typeof operations;
export type OperationInput<K extends OperationName> = Infer<(typeof operations)[K]>;

export function isOperationName(name: string): name is OperationName {
  return Object.hasOwn(operations, name);
}

export interface Health {
  readonly name: 'dryfit';
  readonly version: string;
  readonly apiVersion: number;
  readonly pid: number;
  readonly registryUrl: string;
  readonly startedAt: string;
}

export interface StatusView {
  readonly daemon: Health;
  readonly libraries: readonly LibraryRecord[];
  readonly links: readonly LinkRecord[];
  readonly groups: readonly GroupRecord[];
  readonly warnings: readonly CoherenceWarning[];
  readonly jobs: { readonly running?: JobInfo; readonly queued: readonly JobInfo[] };
}

export interface RegisterResult {
  readonly library: LibraryRecord;
  /** How the build was worked out: detected from the project, or given explicitly. */
  readonly detected: LibraryBuildKind | 'given';
}

/** What registering a folder would do, so a client can show it before asking (ADR 0013). */
export interface LibraryPreview {
  readonly name: string;
  readonly version: string;
  readonly root: string;
  /** How the build was detected; for a registered library, the settings shown are the stored ones. */
  readonly detected: LibraryBuildKind;
  readonly publishDir: string;
  readonly build?: { readonly command: string; readonly args: readonly string[] };
  readonly registered: boolean;
}

/** The folders searched for projects that use a library (`roots` in config.json). */
export interface Roots {
  readonly roots: readonly string[];
}

/**
 * Apps the user hid (`hiddenApps` in config.json): `discover` leaves them out, so they stop being
 * offered for linking. Hiding never touches the app itself, and a linked app cannot be hidden.
 */
export interface HiddenApps {
  readonly hiddenApps: readonly string[];
}

export interface LinkResult {
  readonly link: LinkRecord;
  readonly guard: 'installed' | 'declined' | 'not-a-repo';
}

export interface Done {
  readonly ok: true;
}

export interface OperationOutputs {
  status: StatusView;
  register: RegisterResult;
  unregister: Done;
  inspect: LibraryPreview;
  sync: SyncResult;
  watch: LibraryRecord;
  discover: readonly DiscoveredConsumer[];
  link: LinkResult;
  restore: RestoreResult;
  saveGroup: GroupRecord;
  deleteGroup: Done;
  linkGroup: readonly GroupMemberOutcome[];
  restoreGroup: readonly GroupMemberOutcome[];
  roots: Roots;
  setRoots: Roots;
  hiddenApps: HiddenApps;
  hideApps: HiddenApps;
  shutdown: Done;
}

export type ApiErrorCode =
  | DryfitErrorCode
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'payload-too-large'
  | 'internal';

/** Every error code, at run time, for the contract export; `satisfies` keeps it complete. */
const ERROR_CODES = {
  'invalid-manifest': true,
  'library-not-found': true,
  'not-a-consumer': true,
  'package-manager-undetected': true,
  'unsupported-package-manager': true,
  'build-failed': true,
  'publish-failed': true,
  'snapshot-missing': true,
  'manifest-drifted': true,
  'state-corrupt': true,
  'registry-failed': true,
  'library-linked': true,
  'consumer-linked': true,
  'group-not-found': true,
  'invalid-group': true,
  'invalid-request': true,
  'daemon-stopping': true,
  'invalid-config': true,
  'daemon-failed': true,
  unauthorized: true,
  forbidden: true,
  'not-found': true,
  'payload-too-large': true,
  internal: true,
} as const satisfies Record<ApiErrorCode, true>;

export const API_ERROR_CODES = Object.keys(ERROR_CODES) as ApiErrorCode[];

export interface ApiErrorBody {
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly details: Readonly<Record<string, unknown>>;
  };
}
