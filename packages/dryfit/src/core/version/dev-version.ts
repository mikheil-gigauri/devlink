import semver from 'semver';

/** Prerelease identifier that marks a version as published by dryfit (ADR 0004). */
const DEV_IDENTIFIER = 'dev';

/** `YYYYMMDDHHmmss`: 14 digits, a safe integer that sorts chronologically. */
const STAMP_PATTERN = /^\d{14}$/;

export interface NextDevVersionInput {
  /** The library's own version from its package.json. */
  readonly base: string;
  readonly now: Date;
  /** The last dev version dryfit published for this library, if any. */
  readonly previous?: string | undefined;
}

/**
 * Derives a unique, strictly increasing dev version for one publish.
 *
 * `1.4.0` becomes `1.4.1-dev.<stamp>`, so the dev build sorts above the release it came from;
 * `2.0.0-rc.1` becomes `2.0.0-rc.1.dev.<stamp>`. When the clock would produce a stamp that is not
 * newer than `previous`, the stamp continues from `previous + 1` instead. The stamp is then an
 * ordering key rather than a valid time, which is fine: it only has to sort.
 */
export function nextDevVersion({ base, now, previous }: NextDevVersionInput): string {
  const parsed = semver.parse(base);
  if (!parsed) {
    throw new Error(`Library version is not a valid semver version: "${base}"`);
  }
  if (isDevVersion(parsed.version)) {
    throw new Error(
      `"${base}" is already a dev version. Dev versions are derived from the library's own version.`,
    );
  }

  const prefix = devPrefix(parsed);
  const clockStamp = utcStamp(now);
  const previousStamp = previous === undefined ? undefined : stampAfterPrefix(previous, prefix);
  const stamp = previousStamp !== undefined && clockStamp <= previousStamp ? previousStamp + 1 : clockStamp;

  return `${prefix}${stamp}`;
}

/** True only for versions in dryfit's own scheme, i.e. ending in `dev.<14-digit stamp>`. */
export function isDevVersion(version: string): boolean {
  const prerelease = semver.parse(version)?.prerelease ?? [];
  const identifier = prerelease.at(-2);
  const stamp = prerelease.at(-1);

  return identifier === DEV_IDENTIFIER && STAMP_PATTERN.test(String(stamp));
}

function devPrefix({ major, minor, patch, prerelease }: semver.SemVer): string {
  if (prerelease.length === 0) {
    return `${major}.${minor}.${patch + 1}-${DEV_IDENTIFIER}.`;
  }
  return `${major}.${minor}.${patch}-${prerelease.join('.')}.${DEV_IDENTIFIER}.`;
}

function stampAfterPrefix(version: string, prefix: string): number | undefined {
  if (!version.startsWith(prefix)) return undefined;
  const rest = version.slice(prefix.length);
  return STAMP_PATTERN.test(rest) ? Number(rest) : undefined;
}

function utcStamp(date: Date): number {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp =
    String(date.getUTCFullYear()) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds());

  return Number(stamp);
}
