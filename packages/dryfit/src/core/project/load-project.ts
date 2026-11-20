import type { ConsumerIntegration, FileSystem, ProjectInfo } from '../ports.ts';
import { tryParseJson } from '../util/json.ts';
import { joinPath } from '../util/path.ts';
import { readManifest } from './manifest.ts';

/**
 * Gathers what integrations and use cases need to know about a project folder in one pass: its
 * manifest, root entries, and any root config files the given integrations asked for.
 */
export async function loadProject(
  fs: FileSystem,
  root: string,
  integrations: readonly ConsumerIntegration[] = [],
): Promise<ProjectInfo> {
  const [{ manifest }, entries] = await Promise.all([readManifest(fs, root), fs.readDir(root)]);
  const rootFiles = entries.map((entry) => entry.name);

  const wanted = new Set(integrations.flatMap((integration) => integration.configFiles ?? []));
  const configs = new Map<string, unknown>();
  for (const file of wanted) {
    if (!rootFiles.includes(file)) continue;
    const text = await fs.readText(joinPath(root, file));
    const parsed = text === undefined ? undefined : tryParseJson(text);
    if (parsed !== undefined) configs.set(file, parsed);
  }

  return { root, manifest, rootFiles, configs };
}

/** Whether a folder is the root of an npm, Yarn, Bun or pnpm workspace. */
export function isWorkspaceRoot(project: Pick<ProjectInfo, 'manifest' | 'rootFiles'>): boolean {
  return project.manifest.workspaces !== undefined || project.rootFiles.includes('pnpm-workspace.yaml');
}

/**
 * The workspace root above `dir`, when `dir` is one of its packages without a lockfile of its own:
 * installing there rewrites the root's lockfile, which a snapshot of `dir` would not cover.
 */
export async function enclosingWorkspace(fs: FileSystem, dir: string): Promise<string | undefined> {
  let current = joinPath(dir);
  while (current !== '/') {
    current = joinPath(current, '..');
    const text = await fs.readText(joinPath(current, 'package.json'));
    const manifest = text === undefined ? undefined : tryParseJson(text);
    const workspaces =
      typeof manifest === 'object' &&
      manifest !== null &&
      'workspaces' in manifest &&
      manifest.workspaces !== undefined;
    if (workspaces || (await fs.readText(joinPath(current, 'pnpm-workspace.yaml'))) !== undefined)
      return current;
  }
  return undefined;
}
