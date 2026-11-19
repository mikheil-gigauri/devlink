import { spawn } from 'node:child_process';
import type { CommandResult, ProcessRunner, RunSpec } from '../../core/ports.ts';

/** Output beyond this is dropped from the front: the end of a failed npm run holds the error. */
const MAX_OUTPUT = 1_000_000;
/** A hung install should not block every later job forever, but a cold Angular build can be slow. */
const DEFAULT_TIMEOUT_MS = 15 * 60_000;
/** How long a stopped process tree gets to exit after SIGTERM before it is killed outright. */
const KILL_GRACE_MS = 3_000;
/**
 * How long output may keep arriving after the command itself exits. Past this, whatever still holds
 * the pipes is a background process the command left behind, and waiting for it would hang the job.
 */
const OUTPUT_GRACE_MS = 1_000;

export interface NodeProcessRunnerOptions {
  /** Inherited environment; `npm_*` variables are stripped from it. Defaults to `process.env`. */
  readonly baseEnv?: NodeJS.ProcessEnv;
  /** Explicit variables applied afterwards, kept even if they start with `npm_`. */
  readonly env?: Readonly<Record<string, string>>;
  /** A command still running after this long is killed and reported as failed (exit code 124). */
  readonly timeoutMs?: number;
  /** Aborting kills every running command and refuses new ones (exit code 130). */
  readonly signal?: AbortSignal;
}

/**
 * Runs commands as child processes without a shell, so arguments can never be interpreted.
 *
 * `npm_*` variables are removed from the child's environment. When dryfit itself is started by npm
 * (`npx @dryfit/cli`, an npm script), npm exports its whole config as `npm_config_*`, which the npm that
 * dryfit runs would obey: a stray `npm_config_global` or `npm_config_registry` would install into the
 * wrong place or from the wrong registry.
 *
 * Each command leads its own process group, so a timeout or cancellation kills the whole tree: npm
 * runs lifecycle scripts and builders as grandchildren that would otherwise keep running. A command
 * is finished when it exits; background processes it leaves in its group are ended shortly after.
 */
export class NodeProcessRunner implements ProcessRunner {
  readonly #env: NodeJS.ProcessEnv;
  readonly #timeoutMs: number;
  readonly #signal: AbortSignal | undefined;

  constructor(options: NodeProcessRunnerOptions = {}) {
    const baseEnv = options.baseEnv ?? process.env;
    this.#env = {
      ...Object.fromEntries(Object.entries(baseEnv).filter(([key]) => !/^npm_/i.test(key))),
      ...options.env,
    };
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#signal = options.signal;
  }

  run(spec: RunSpec): Promise<CommandResult> {
    if (this.#signal?.aborted) {
      return Promise.resolve({ exitCode: 130, stdout: '', stderr: 'dryfit: cancelled before it started\n' });
    }
    return new Promise((resolve, reject) => {
      const child = spawn(spec.command, [...spec.args], {
        cwd: spec.cwd,
        env: spec.env === undefined ? this.#env : { ...this.#env, ...spec.env },
        shell: false,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout = new TailBuffer(MAX_OUTPUT);
      const stderr = new TailBuffer(MAX_OUTPUT);
      let stopped: { readonly exitCode: number; readonly reason: string } | undefined;
      let killTimer: NodeJS.Timeout | undefined;

      const stop = (exitCode: number, reason: string) => {
        if (stopped || child.pid === undefined) return;
        stopped = { exitCode, reason };
        killGroup(child.pid, 'SIGTERM');
        killTimer = setTimeout(() => killGroup(child.pid as number, 'SIGKILL'), KILL_GRACE_MS);
      };
      const seconds = this.#timeoutMs / 1000;
      const timeout = setTimeout(() => stop(124, `timed out after ${seconds} s`), this.#timeoutMs);
      const onAbort = () => stop(130, 'cancelled');
      this.#signal?.addEventListener('abort', onAbort, { once: true });
      const cleanUp = () => {
        clearTimeout(timeout);
        this.#signal?.removeEventListener('abort', onAbort);
      };

      child.stdout.setEncoding('utf8').on('data', (chunk: string) => stdout.append(chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => stderr.append(chunk));
      child.once('error', (error) => {
        cleanUp();
        reject(error);
      });
      let settled = false;
      let outputTimer: NodeJS.Timeout | undefined;
      const settle = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        cleanUp();
        clearTimeout(outputTimer);
        if (stopped) {
          // The leader is gone; make sure nothing it started outlives it, then stop waiting.
          if (child.pid !== undefined) killGroup(child.pid, 'SIGKILL');
          clearTimeout(killTimer);
          stderr.append(`\ndryfit: ${spec.command} ${stopped.reason}\n`);
        }
        resolve({
          exitCode: stopped?.exitCode ?? code ?? (signal === null ? 1 : 128),
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
      };
      // 'close' waits for the pipes as well as the process, so it normally carries all the output.
      child.once('close', settle);
      child.once('exit', (code, signal) => {
        outputTimer = setTimeout(() => {
          // Something the command started in the background still holds the pipes: end it, and stop
          // waiting for output that belongs to it rather than to the command.
          if (child.pid !== undefined) killGroup(child.pid, 'SIGTERM');
          child.stdout.destroy();
          child.stderr.destroy();
          settle(code, signal);
        }, OUTPUT_GRACE_MS);
      });
    });
  }
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group has already exited.
  }
}

/** Keeps the last `limit` characters of a stream without re-copying on every chunk. */
class TailBuffer {
  readonly #limit: number;
  #text = '';

  constructor(limit: number) {
    this.#limit = limit;
  }

  append(chunk: string): void {
    this.#text += chunk;
    if (this.#text.length > this.#limit * 2) this.#text = this.#text.slice(-this.#limit);
  }

  toString(): string {
    return this.#text.length > this.#limit ? this.#text.slice(-this.#limit) : this.#text;
  }
}
