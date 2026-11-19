import type { ConsumerIntegration, ProjectInfo } from '../ports.ts';
import { joinPath } from '../util/path.ts';

/**
 * Cache folders to clear for a project: every detected integration's paths plus the user's extras.
 *
 * Every path is deleted recursively, so anything that is not strictly inside the project is dropped:
 * `.`, `..`, absolute paths, or a config value such as `"../.."` would otherwise delete the project or
 * its parent folders.
 */
export function cachePathsFor(
  project: ProjectInfo,
  integrations: readonly ConsumerIntegration[],
  extraPaths: readonly string[] = [],
): string[] {
  const detected = integrations.filter((integration) => integration.detect(project));
  const candidates = [...detected.flatMap((integration) => integration.cachePaths(project)), ...extraPaths];
  return [...new Set(candidates.filter((path) => isStrictlyInside(project.root, path)))];
}

/** True when the manifest declares any of `names` in any dependency field. */
export function dependsOnAny(project: ProjectInfo, names: readonly string[]): boolean {
  const { dependencies, devDependencies, optionalDependencies, peerDependencies } = project.manifest;
  return names.some((name) =>
    [dependencies, devDependencies, optionalDependencies, peerDependencies].some((field) => field?.[name]),
  );
}

function isStrictlyInside(root: string, relativePath: string): boolean {
  if (relativePath.startsWith('/')) return false;
  const base = joinPath(root);
  return joinPath(base, relativePath).startsWith(`${base}/`);
}
