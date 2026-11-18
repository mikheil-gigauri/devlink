import { DevlinkError } from '../errors.ts';
import type { DevlinkState, GroupRecord } from '../model.ts';
import type { CoreDeps } from '../ports.ts';
import { joinPath } from '../util/path.ts';
import { linkConsumer } from './link-consumer.ts';
import { restoreConsumer } from './restore-consumer.ts';
import { requireLibrary } from './shared.ts';

export interface SaveGroupInput {
  readonly name: string;
  readonly consumers: readonly string[];
}

/** What happened to one member when a whole group was linked or restored. */
export interface GroupMemberOutcome {
  readonly consumer: string;
  readonly status: 'done' | 'skipped' | 'failed';
  readonly message?: string;
}

/** Saves consumers that run together under a name, replacing any group of that name (ADR 0005). */
export async function saveGroup(deps: CoreDeps, input: SaveGroupInput): Promise<GroupRecord> {
  const name = input.name.trim();
  const consumers = [...new Set(input.consumers.map((consumer) => joinPath(consumer)))];
  if (name.length === 0) throw new DevlinkError('invalid-group', 'A group needs a name', {});
  if (consumers.length === 0) {
    throw new DevlinkError('invalid-group', `Group ${name} needs at least one consumer`, { group: name });
  }

  const group: GroupRecord = { name, consumers };
  const state = await deps.state.load();
  const others = state.groups.filter((candidate) => candidate.name !== name);
  await deps.state.save({ ...state, groups: [...others, group] });
  return group;
}

export async function deleteGroup(deps: CoreDeps, { name }: { readonly name: string }): Promise<void> {
  const state = await deps.state.load();
  requireGroup(state, name);
  await deps.state.save({ ...state, groups: state.groups.filter((group) => group.name !== name) });
}

export function requireGroup(state: DevlinkState, name: string): GroupRecord {
  const group = state.groups.find((candidate) => candidate.name === name);
  if (!group) throw new DevlinkError('group-not-found', `No group named ${name} is saved`, { group: name });
  return group;
}

/**
 * Links a library into every member of a group, one at a time. A member that cannot be linked (it does
 * not use the library, or is not a project) is skipped with the reason, so one odd member does not
 * block the rest.
 */
export async function linkGroup(
  deps: CoreDeps,
  input: { readonly group: string; readonly library: string },
): Promise<GroupMemberOutcome[]> {
  const state = await deps.state.load();
  const group = requireGroup(state, input.group);
  requireLibrary(state, input.library);

  const outcomes: GroupMemberOutcome[] = [];
  for (const consumer of group.consumers) {
    try {
      await linkConsumer(deps, { library: input.library, consumer });
      outcomes.push({ consumer, status: 'done' });
    } catch (error) {
      if (!(error instanceof DevlinkError)) throw error;
      const status = error.code === 'not-a-consumer' ? 'skipped' : 'failed';
      outcomes.push({ consumer, status, message: error.message });
    }
  }
  return outcomes;
}

/** Restores every linked member of a group; members that are not linked are skipped. */
export async function restoreGroup(
  deps: CoreDeps,
  input: { readonly group: string; readonly force?: boolean | undefined },
): Promise<GroupMemberOutcome[]> {
  const state = await deps.state.load();
  const group = requireGroup(state, input.group);
  const linked = new Set(state.links.map((link) => link.consumer));

  const outcomes: GroupMemberOutcome[] = [];
  for (const consumer of group.consumers) {
    if (!linked.has(consumer)) {
      outcomes.push({ consumer, status: 'skipped', message: `${consumer} is not linked` });
      continue;
    }
    try {
      const result = await restoreConsumer(deps, { consumer, force: input.force });
      outcomes.push(
        result.ok ? { consumer, status: 'done' } : { consumer, status: 'failed', message: result.output },
      );
    } catch (error) {
      if (!(error instanceof DevlinkError)) throw error;
      outcomes.push({ consumer, status: 'failed', message: error.message });
    }
  }
  return outcomes;
}
