import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTempDir } from '../../testing/temp-dir.ts';
import { NodeProcessRunner } from './node-process-runner.ts';

const node = process.execPath;

describe('NodeProcessRunner', () => {
  let cwd: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ path: cwd, cleanup } = await createTempDir());
  });
  afterEach(() => cleanup());

  it('captures stdout, stderr and the exit code', async () => {
    const runner = new NodeProcessRunner();
    const script = 'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)';

    expect(await runner.run({ command: node, args: ['-e', script], cwd })).toEqual({
      exitCode: 3,
      stdout: 'out',
      stderr: 'err',
    });
  });

  it('runs in the given folder', async () => {
    const result = await new NodeProcessRunner().run({ command: node, args: ['-p', 'process.cwd()'], cwd });

    expect(result.stdout.trim()).toBe(cwd);
  });

  it('passes arguments verbatim, without a shell', async () => {
    const tricky = '$HOME; echo injected && `whoami`';
    const result = await new NodeProcessRunner().run({
      command: node,
      args: ['-p', 'process.argv[1]', tricky],
      cwd,
    });

    expect(result.stdout.trim()).toBe(tricky);
  });

  it('strips npm_* variables so an outer npm cannot reconfigure the npm devlink runs', async () => {
    const runner = new NodeProcessRunner({
      baseEnv: {
        PATH: process.env.PATH ?? '',
        npm_config_registry: 'https://wrong.example/',
        npm_lifecycle_event: 'dev',
        NPM_CONFIG_GLOBAL: 'true',
        KEEP_ME: 'yes',
      },
    });
    const script = 'console.log(JSON.stringify(Object.keys(process.env).filter(k => /npm|KEEP/i.test(k))))';

    const result = await runner.run({ command: node, args: ['-e', script], cwd });

    expect(JSON.parse(result.stdout)).toEqual(['KEEP_ME']);
  });

  it('applies explicit extra variables after stripping, so callers can still configure npm', async () => {
    const runner = new NodeProcessRunner({
      baseEnv: { PATH: process.env.PATH ?? '', npm_config_cache: '/inherited' },
      env: { npm_config_cache: '/explicit' },
    });

    const result = await runner.run({ command: node, args: ['-p', 'process.env.npm_config_cache'], cwd });

    expect(result.stdout.trim()).toBe('/explicit');
  });

  it('rejects when the command cannot be started', async () => {
    await expect(
      new NodeProcessRunner().run({ command: 'devlink-no-such-command', args: [], cwd }),
    ).rejects.toThrow(/ENOENT/);
  });

  it('keeps only the tail of very long output', async () => {
    const script = 'process.stdout.write("x".repeat(3_000_000) + "END")';
    const result = await new NodeProcessRunner().run({ command: node, args: ['-e', script], cwd });

    expect(result.stdout.length).toBeLessThanOrEqual(1_000_000);
    expect(result.stdout.endsWith('END')).toBe(true);
  });

  /** A command whose child writes `marker` after a delay, while the command itself never ends. */
  const hangingTree = (marker: string) => [
    '-e',
    [
      "const { spawn } = require('node:child_process');",
      `spawn(process.execPath, ['-e', 'setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "x"), 800)'], { stdio: 'ignore' });`,
      'setInterval(() => {}, 1000);',
    ].join('\n'),
  ];

  it('finishes when the command exits, even if something it started in the background holds its output', async () => {
    const started = Date.now();

    const result = await new NodeProcessRunner().run({
      command: 'sh',
      args: ['-c', 'sleep 20 & echo built'],
      cwd,
    });

    expect(result).toMatchObject({ exitCode: 0, stdout: 'built\n' });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('kills a command that outlives its timeout, together with its children', async () => {
    const marker = join(cwd, 'child-survived');
    const runner = new NodeProcessRunner({ timeoutMs: 300 });

    const result = await runner.run({ command: node, args: hangingTree(marker), cwd });
    await sleep(1200);

    expect(result.exitCode).toBe(124);
    expect(result.stderr).toContain('timed out after 0.3 s');
    expect(existsSync(marker)).toBe(false);
  });

  it('cancels a running command, together with its children, when the signal aborts', async () => {
    const marker = join(cwd, 'child-survived');
    const controller = new AbortController();
    const runner = new NodeProcessRunner({ signal: controller.signal });

    const running = runner.run({ command: node, args: hangingTree(marker), cwd });
    setTimeout(() => controller.abort(), 300);
    const result = await running;
    await sleep(1200);

    expect(result.exitCode).toBe(130);
    expect(result.stderr).toContain('cancelled');
    expect(existsSync(marker)).toBe(false);
  });

  it('does not start anything once cancelled', async () => {
    const marker = join(cwd, 'started');
    const controller = new AbortController();
    controller.abort();
    const runner = new NodeProcessRunner({ signal: controller.signal });

    const script = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`;
    const result = await runner.run({ command: node, args: ['-e', script], cwd });

    expect(result.exitCode).toBe(130);
    expect(existsSync(marker)).toBe(false);
  });
});
