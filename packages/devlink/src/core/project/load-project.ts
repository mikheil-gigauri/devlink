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
