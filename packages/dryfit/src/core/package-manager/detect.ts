export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;

export type PackageManagerName = (typeof PACKAGE_MANAGERS)[number];

/** Lockfiles that identify a package manager when found at the project root. */
const LOCKFILES: Readonly<Record<string, PackageManagerName>> = {
  'package-lock.json': 'npm',
  'npm-shrinkwrap.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
};

/** Lockfiles dryfit cannot snapshot and restore, because they are not text. */
const BINARY_LOCKFILES = ['bun.lockb'];

export interface DetectPackageManagerInput {
  /** File names at the project root. Nested paths are ignored. */
  readonly files: readonly string[];
  readonly manifest: { readonly packageManager?: string | undefined };
}

export type PackageManagerDetection =
  | {
      readonly ok: true;
      readonly name: PackageManagerName;
      readonly source: 'packageManager-field' | 'lockfile' | 'default';
    }
  | { readonly ok: false; readonly reason: 'multiple-lockfiles'; readonly lockfiles: readonly string[] }
  | { readonly ok: false; readonly reason: 'unsupported-package-manager'; readonly value: string }
  | { readonly ok: false; readonly reason: 'binary-lockfile'; readonly lockfile: string };

/**
 * Decides which package manager owns a project (ADR 0006): the `packageManager` field wins, then a
 * single lockfile, then npm. Lockfiles from different managers are ambiguous, so detection refuses to
 * guess rather than risk rewriting the wrong lockfile.
 */
export function detectPackageManager({
  files,
  manifest,
}: DetectPackageManagerInput): PackageManagerDetection {
  const field = manifest.packageManager;
  if (field !== undefined) {
    const [name, version = ''] = field.split('@');
    // Yarn 1 shares the name but not the commands or the lockfile format of Yarn 2 and later.
    const yarnClassic = name === 'yarn' && /^1\./.test(version);
    return isPackageManagerName(name) && !yarnClassic
      ? { ok: true, name, source: 'packageManager-field' }
      : { ok: false, reason: 'unsupported-package-manager', value: field };
  }

  const lockfiles = files.filter((file) => file in LOCKFILES).sort();
  const managers = new Set(lockfiles.map((file) => LOCKFILES[file]));
  const [only, ...others] = managers;

  if (only === undefined) return { ok: true, name: 'npm', source: 'default' };
  if (others.length > 0) return { ok: false, reason: 'multiple-lockfiles', lockfiles };
  const textLockfiles = lockfiles.filter((file) => !BINARY_LOCKFILES.includes(file));
  if (textLockfiles.length === 0)
    return { ok: false, reason: 'binary-lockfile', lockfile: lockfiles[0] ?? '' };
  return { ok: true, name: only, source: 'lockfile' };
}

function isPackageManagerName(value: string | undefined): value is PackageManagerName {
  return PACKAGE_MANAGERS.some((name) => name === value);
}
