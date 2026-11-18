import { spawn } from 'node:child_process';
import type { CommandSpec } from '../../core/model.ts';
import type { CommandResult, ProcessRunner } from '../../core/ports.ts';

/** Output beyond this is dropped from the front: the end of a failed npm run holds the error. */
const MAX_OUTPUT = 1_000_000;

/**
 * Runs commands as child processes without a shell, so arguments can never be interpreted.
 *
 * `npm_*` variables are removed from the child's environment. When devlink itself is started by npm
 * (`npx devlink`, an npm script), npm exports its whole config as `npm_config_*`, which the npm that
 * devlink runs would obey: a stray `npm_config_global` or `npm_config_registry` would install into the
 * wrong place or from the wrong registry.
 */
export class NodeProcessRunner implements ProcessRunner {
  readonly #env: NodeJS.ProcessEnv;

  /**
   * @param baseEnv inherited environment; `npm_*` variables are stripped from it.
   * @param extraEnv explicit variables applied afterwards, kept even if they start with `npm_`.
   */
  constructor(baseEnv: NodeJS.ProcessEnv = process.env, extraEnv: Readonly<Record<string, string>> = {}) {
    this.#env = {
      ...Object.fromEntries(Object.entries(baseEnv).filter(([key]) => !/^npm_/i.test(key))),
      ...extraEnv,
    };
  }

  run(spec: CommandSpec): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(spec.command, [...spec.args], {
        cwd: spec.cwd,
        env: this.#env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdout = new TailBuffer(MAX_OUTPUT);
      const stderr = new TailBuffer(MAX_OUTPUT);

      child.stdout.setEncoding('utf8').on('data', (chunk: string) => stdout.append(chunk));
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => stderr.append(chunk));
      child.once('error', reject);
      child.once('close', (code, signal) => {
        resolve({
          exitCode: code ?? (signal === null ? 1 : 128),
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
      });
    });
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
