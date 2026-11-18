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
      PATH: process.env.PATH ?? '',
      npm_config_registry: 'https://wrong.example/',
      npm_lifecycle_event: 'dev',
      NPM_CONFIG_GLOBAL: 'true',
      KEEP_ME: 'yes',
    });
    const script = 'console.log(JSON.stringify(Object.keys(process.env).filter(k => /npm|KEEP/i.test(k))))';

    const result = await runner.run({ command: node, args: ['-e', script], cwd });

    expect(JSON.parse(result.stdout)).toEqual(['KEEP_ME']);
  });

  it('applies explicit extra variables after stripping, so callers can still configure npm', async () => {
    const runner = new NodeProcessRunner(
      { PATH: process.env.PATH ?? '', npm_config_cache: '/inherited' },
      { npm_config_cache: '/explicit' },
    );

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
});
