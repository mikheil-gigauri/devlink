import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** What `dryfit agent install` or `uninstall` did. */
export interface SkillChange {
  readonly path: string;
  /** False when there was nothing to do: already up to date, or nothing of dryfit's to remove. */
  readonly changed: boolean;
}

/** The skill that teaches coding agents to use dryfit: `skill/SKILL.md`, shipped in the package. */
export async function readSkill(): Promise<string> {
  // From dist/dryfit.mjs in the package, or src/cli/agent-skill.ts in the repository.
  for (const path of ['../skill/SKILL.md', '../../skill/SKILL.md']) {
    const url = new URL(path, import.meta.url);
    if (existsSync(url)) return readFile(url, 'utf8');
  }
  throw new Error('skill/SKILL.md is missing from the dryfit package');
}

/** Writes the skill to `<skillsDir>/dryfit/SKILL.md`, where Claude Code looks for skills. */
export async function installSkill(skillsDir: string): Promise<SkillChange> {
  const path = join(skillsDir, 'dryfit', 'SKILL.md');
  const skill = await readSkill();
  if ((await readIfExists(path)) === skill) return { path, changed: false };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, skill);
  return { path, changed: true };
}

/** Removes the skill, leaving a file there that is not dryfit's and a folder with anything else in it. */
export async function uninstallSkill(skillsDir: string): Promise<SkillChange> {
  const path = join(skillsDir, 'dryfit', 'SKILL.md');
  const current = await readIfExists(path);
  if (current === undefined || !/^name: dryfit$/m.test(current)) return { path, changed: false };
  await rm(path);
  await rmdir(dirname(path)).catch(() => {});
  return { path, changed: true };
}

const readIfExists = (path: string) => readFile(path, 'utf8').catch(() => undefined);
