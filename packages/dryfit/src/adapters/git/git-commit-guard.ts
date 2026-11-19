import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { withGuard, withoutGuard } from '../../core/guard/commit-guard.ts';
import type { ProcessRunner } from '../../core/ports.ts';
import type { CommitGuard } from '../../daemon/service.ts';

/**
 * Installs the commit guard into the hook git will actually run: `git rev-parse --git-path hooks`
 * follows `core.hooksPath` (Husky, lefthook) and worktrees, so the guard lands where it takes effect.
 */
export class GitCommitGuard implements CommitGuard {
  readonly #runner: ProcessRunner;

  constructor(runner: ProcessRunner) {
    this.#runner = runner;
  }

  async install(consumer: string): Promise<'installed' | 'not-a-repo'> {
    const hook = await this.#hookPath(consumer);
    if (hook === undefined) return 'not-a-repo';
    await mkdir(join(hook, '..'), { recursive: true });
    await writeFile(hook, withGuard(await readOptional(hook)));
    await chmod(hook, 0o755);
    return 'installed';
  }

  async remove(consumer: string): Promise<void> {
    const hook = await this.#hookPath(consumer);
    const current = hook === undefined ? undefined : await readOptional(hook);
    if (hook === undefined || current === undefined) return;

    const remaining = withoutGuard(current);
    if (remaining === undefined) await rm(hook, { force: true });
    else if (remaining !== current) await writeFile(hook, remaining);
  }

  async #hookPath(consumer: string): Promise<string | undefined> {
    const result = await this.#runner
      .run({ command: 'git', args: ['rev-parse', '--git-path', 'hooks'], cwd: consumer })
      .catch(() => undefined);
    if (result?.exitCode !== 0) return undefined;
    return join(resolve(consumer, result.stdout.trim()), 'pre-commit');
  }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
