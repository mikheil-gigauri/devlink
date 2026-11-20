import { chmod, lstat, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { withGuard, withoutGuard } from '../../core/guard/commit-guard.ts';
import type { ProcessRunner } from '../../core/ports.ts';
import type { CommitGuard } from '../../daemon/service.ts';

/** Shells the guard's block is written for; a hook in another language would break on it. */
const SHELL_HOOK = /^#!\s*(\/usr\/bin\/env\s+)?(\S*\/)?(sh|bash|zsh|dash|ksh)(\s|$)/;

/**
 * Installs the commit guard into the hook git will actually run: `git rev-parse --git-path hooks`
 * follows `core.hooksPath` (Husky, lefthook) and worktrees, so the guard lands where it takes effect.
 *
 * It never edits a hook the repository shares: one git tracks, or a new one in a working-tree folder
 * git does not ignore (`core.hooksPath=.githooks`), since the guard would then be committed for
 * everyone. Husky's own `.husky/_` is ignored, so it is fine. A hook that was not executable gets its
 * mode back on removal.
 */
export class GitCommitGuard implements CommitGuard {
  readonly #runner: ProcessRunner;

  constructor(runner: ProcessRunner) {
    this.#runner = runner;
  }

  async install(consumer: string): Promise<'installed' | 'not-a-repo'> {
    const hook = await this.hookPath(consumer);
    if (hook === undefined) return 'not-a-repo';
    await this.#refuseShared(consumer, hook);

    const existing = await lstatOptional(hook);
    if (existing?.isSymbolicLink()) {
      throw new Error(`${hook} is a symbolic link; dryfit does not edit hooks it would have to follow`);
    }
    const current = existing === undefined ? undefined : await readFile(hook, 'utf8');
    if (current?.startsWith('#!') && !SHELL_HOOK.test(current)) {
      throw new Error(`${hook} is not a shell script, so the guard cannot be added to it`);
    }

    await mkdir(dirname(hook), { recursive: true });
    const mode = existing === undefined ? undefined : existing.mode & 0o777;
    // Remembered once, before the first install makes it executable, and put back by `remove`.
    if (mode !== undefined && (mode & 0o111) === 0 && !(await exists(modeFile(hook)))) {
      await writeFile(modeFile(hook), mode.toString(8));
    }
    await writeFile(hook, withGuard(current));
    await chmod(hook, 0o755);
    return 'installed';
  }

  async remove(consumer: string): Promise<void> {
    const hook = await this.hookPath(consumer);
    const current = hook === undefined ? undefined : await readOptional(hook);
    if (hook === undefined || current === undefined) return;

    const remaining = withoutGuard(current);
    if (remaining === undefined) await rm(hook, { force: true });
    else if (remaining !== current) await writeFile(hook, remaining);

    const saved = await readOptional(modeFile(hook));
    if (saved !== undefined) {
      if (remaining !== undefined) await chmod(hook, Number.parseInt(saved, 8));
      await rm(modeFile(hook), { force: true });
    }
  }

  /** The pre-commit hook git runs for `consumer`, or undefined outside a git repository. */
  async hookPath(consumer: string): Promise<string | undefined> {
    const result = await this.#git(consumer, ['rev-parse', '--git-path', 'hooks']);
    if (result === undefined) return undefined;
    return join(await realpathOrSelf(resolve(consumer, result.trim())), 'pre-commit');
  }

  async #refuseShared(consumer: string, hook: string): Promise<void> {
    const dirs = await this.#git(consumer, [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-common-dir',
    ]);
    const [top, common] = (dirs ?? '').trim().split('\n');
    if (!top || !common) return;
    const [workTree, gitDir] = await Promise.all([realpathOrSelf(top), realpathOrSelf(common)]);
    const inside = (dir: string) => hook.startsWith(dir + sep);
    if (!inside(workTree) || inside(gitDir)) return;
    // Exit 0 means ignored; a tracked file is never reported as ignored.
    const ignored = await this.#runner
      .run({ command: 'git', args: ['check-ignore', '-q', '--', hook], cwd: consumer })
      .catch(() => undefined);
    if (ignored?.exitCode === 0) return;
    throw new Error(
      `${hook} is part of the repository (core.hooksPath), so the guard would be committed with it; dryfit leaves it alone`,
    );
  }

  async #git(cwd: string, args: readonly string[]): Promise<string | undefined> {
    const result = await this.#runner.run({ command: 'git', args, cwd }).catch(() => undefined);
    return result?.exitCode === 0 ? result.stdout : undefined;
  }
}

const modeFile = (hook: string) => `${hook}.dryfit-mode`;

async function realpathOrSelf(path: string): Promise<string> {
  // The hooks folder may not exist yet; its parent tells the same story for symlinked temp folders.
  try {
    return await realpath(path);
  } catch {
    try {
      return join(await realpath(dirname(path)), path.slice(dirname(path).length + 1));
    } catch {
      return path;
    }
  }
}

async function lstatOptional(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

const isMissing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';
