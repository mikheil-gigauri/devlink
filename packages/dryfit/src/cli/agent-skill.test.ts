import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installSkill, readSkill, uninstallSkill } from './agent-skill.ts';

describe('the agent skill', () => {
  let skills: string;
  beforeEach(async () => {
    skills = await mkdtemp(join(tmpdir(), 'dryfit-skills-'));
  });
  afterEach(() => rm(skills, { recursive: true, force: true }));

  it('ships as a skill Claude Code can load: named dryfit, with a description of when to use it', async () => {
    const skill = await readSkill();

    expect(skill).toMatch(/^---\nname: dryfit\ndescription: .{80,}\n---\n/);
  });

  it('installs into <skills>/dryfit/SKILL.md, and says when it was already there', async () => {
    const first = await installSkill(skills);
    const again = await installSkill(skills);

    expect(first).toEqual({ path: join(skills, 'dryfit', 'SKILL.md'), changed: true });
    expect(again.changed).toBe(false);
    expect(await readFile(first.path, 'utf8')).toBe(await readSkill());
  });

  it('uninstalls its own skill and folder, and leaves anything else alone', async () => {
    await installSkill(skills);
    const removed = await uninstallSkill(skills);
    await mkdir(join(skills, 'dryfit'));
    await writeFile(join(skills, 'dryfit', 'SKILL.md'), '---\nname: something-else\n---\n');
    const kept = await uninstallSkill(skills);

    expect(removed.changed).toBe(true);
    expect(kept.changed).toBe(false);
    expect(await readFile(join(skills, 'dryfit', 'SKILL.md'), 'utf8')).toContain('something-else');
    await rm(join(skills, 'dryfit'), { recursive: true });
    expect((await uninstallSkill(skills)).changed).toBe(false);
    await expect(stat(join(skills, 'dryfit'))).rejects.toThrow();
  });
});
