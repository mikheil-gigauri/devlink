import type { DependencyField } from '../../core/model.ts';
import type { InstallPackage } from '../../core/ports.ts';

/**
 * The save flag for a set of packages: the one for their field when they share it, else none, which
 * makes npm, pnpm, Yarn and Bun keep each package in the field it is already declared in (ADR 0014).
 */
export function saveFlag(
  packages: readonly InstallPackage[],
  flags: Readonly<Record<DependencyField, string | undefined>>,
): string[] {
  const fields = new Set(packages.map((pkg) => pkg.dependencyField));
  const [field] = fields;
  const flag = fields.size === 1 && field !== undefined ? flags[field] : undefined;
  return flag === undefined ? [] : [flag];
}

export function scopeOf(packageName: string): string | undefined {
  return /^(@[^/]+)\//.exec(packageName)?.[1];
}

/**
 * Registry settings that send these packages to the local registry: one per scope, leaving every
 * other dependency on the user's normal registry, or the whole install when any package is unscoped
 * (the local registry proxies everything it does not hold, ADR 0002). `key` formats one setting.
 */
export function registrySettings(
  packages: readonly InstallPackage[],
  registryUrl: string,
  key: (scope: string | undefined) => string,
): string[] {
  const scopes = packages.map((pkg) => scopeOf(pkg.name));
  if (scopes.includes(undefined)) return [`${key(undefined)}=${registryUrl}`];
  return [...new Set(scopes)].map((scope) => `${key(scope)}=${registryUrl}`);
}
