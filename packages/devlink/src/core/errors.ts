export type DevlinkErrorCode =
  | 'invalid-manifest'
  | 'library-not-found'
  | 'not-a-consumer'
  | 'package-manager-undetected'
  | 'unsupported-package-manager'
  | 'build-failed'
  | 'publish-failed'
  | 'snapshot-missing'
  | 'manifest-drifted';

/**
 * An expected failure the user can act on. Clients map `code` to their own wording; `message` is a
 * plain-English fallback and `details` carries the data (paths, command output) behind it.
 */
export class DevlinkError extends Error {
  override readonly name = 'DevlinkError';
  readonly code: DevlinkErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DevlinkErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
