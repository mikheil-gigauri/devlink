import { describe, expect, it } from 'vitest';
import { detectPackageManager } from './detect.ts';

describe('detectPackageManager', () => {
  it.each([
    ['package-lock.json', 'npm'],
    ['npm-shrinkwrap.json', 'npm'],
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
  ] as const)('detects %s as %s', (lockfile, name) => {
    expect(detectPackageManager({ files: ['package.json', lockfile], manifest: {} })).toEqual({
      ok: true,
      name,
      source: 'lockfile',
    });
  });

  it('prefers the packageManager field over the lockfile', () => {
    const result = detectPackageManager({
      files: ['package-lock.json'],
      manifest: { packageManager: 'pnpm@10.4.1+sha512.abc' },
    });

    expect(result).toEqual({ ok: true, name: 'pnpm', source: 'packageManager-field' });
  });

  it('falls back to npm when there is neither a field nor a lockfile', () => {
    expect(detectPackageManager({ files: ['package.json'], manifest: {} })).toEqual({
      ok: true,
      name: 'npm',
      source: 'default',
    });
  });

  it('refuses to guess when lockfiles from different managers are present', () => {
    const result = detectPackageManager({
      files: ['yarn.lock', 'package-lock.json'],
      manifest: {},
    });

    expect(result).toEqual({
      ok: false,
      reason: 'multiple-lockfiles',
      lockfiles: ['package-lock.json', 'yarn.lock'],
    });
  });

  it('treats two lockfiles of the same manager as one', () => {
    expect(detectPackageManager({ files: ['bun.lock', 'bun.lockb'], manifest: {} })).toEqual({
      ok: true,
      name: 'bun',
      source: 'lockfile',
    });
  });

  it('reports a packageManager field it does not support', () => {
    expect(detectPackageManager({ files: [], manifest: { packageManager: 'deno@2.1.0' } })).toEqual({
      ok: false,
      reason: 'unsupported-package-manager',
      value: 'deno@2.1.0',
    });
  });

  it('ignores lockfiles in nested paths', () => {
    expect(
      detectPackageManager({ files: ['packages/a/yarn.lock', 'package-lock.json'], manifest: {} }),
    ).toEqual({ ok: true, name: 'npm', source: 'lockfile' });
  });
});
