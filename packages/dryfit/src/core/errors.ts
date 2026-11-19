export type DryfitErrorCode =
  | 'invalid-manifest'
  | 'library-not-found'
  | 'not-a-consumer'
  | 'package-manager-undetected'
  | 'unsupported-package-manager'
  | 'build-failed'
  | 'publish-failed'
  | 'snapshot-missing'
  | 'manifest-drifted'
  | 'state-corrupt'
  | 'registry-failed'
  | 'library-linked'
  | 'group-not-found'
  | 'invalid-group'
  | 'invalid-request'
  | 'daemon-stopping'
  | 'invalid-config'
  | 'daemon-failed';

/**
 * An expected failure the user can act on. Clients map `code` to their own wording; `message` is a
 * plain-English fallback and `details` carries the data (paths, command output) behind it.
 */
export class DryfitError extends Error {
  override readonly name = 'DryfitError';
  readonly code: DryfitErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DryfitErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
