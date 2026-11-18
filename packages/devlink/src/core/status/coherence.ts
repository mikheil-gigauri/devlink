import type { DevlinkState } from '../model.ts';

export interface CoherenceWarning {
  readonly group: string;
  readonly library: string;
  readonly versions: readonly { readonly consumer: string; readonly version: string }[];
}

/**
 * Consumers saved in one group run together, such as a federation host and its remotes. If they run
 * different dev versions of one library, what you see in the browser is a mix of both (ADR 0005).
 * Only installed links count: a pending or failed one has no version to compare yet.
 */
export function coherenceWarnings(state: DevlinkState): CoherenceWarning[] {
  const warnings: CoherenceWarning[] = [];
  for (const group of state.groups) {
    const members = new Set(group.consumers);
    const byLibrary = new Map<string, { consumer: string; version: string }[]>();

    for (const link of state.links) {
      if (!members.has(link.consumer) || link.status !== 'installed' || !link.installedVersion) continue;
      const versions = byLibrary.get(link.library) ?? [];
      versions.push({ consumer: link.consumer, version: link.installedVersion });
      byLibrary.set(link.library, versions);
    }

    for (const [library, versions] of byLibrary) {
      if (new Set(versions.map((entry) => entry.version)).size > 1) {
        warnings.push({ group: group.name, library, versions });
      }
    }
  }
  return warnings;
}
