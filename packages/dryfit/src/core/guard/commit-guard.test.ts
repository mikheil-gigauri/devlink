import { describe, expect, it } from 'vitest';
import { hasGuard, withGuard, withoutGuard } from './commit-guard.ts';

const husky = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n';

describe('commit guard hook text', () => {
  it('creates a POSIX sh hook when there is none', () => {
    const hook = withGuard(undefined);

    expect(hook.startsWith('#!/bin/sh\n')).toBe(true);
    expect(hasGuard(hook)).toBe(true);
  });

  it('runs first in an existing hook and keeps the hook intact', () => {
    const hook = withGuard(husky);
    const lines = hook.split('\n');

    expect(lines[0]).toBe('#!/usr/bin/env sh');
    expect(lines[1]).toBe('# >>> dryfit commit guard >>>');
    expect(hook.endsWith('. "$(dirname "$0")/h"\n')).toBe(true);
  });

  it('can be applied repeatedly without stacking up', () => {
    expect(withGuard(withGuard(husky))).toBe(withGuard(husky));
  });

  it('removes itself cleanly, leaving the original hook byte for byte', () => {
    expect(withoutGuard(withGuard(husky))).toBe(husky);
    expect(withoutGuard(withGuard('#!/bin/sh\necho hi'))).toBe('#!/bin/sh\necho hi');
  });

  it('asks for the hook file to be deleted when the guard was all it held', () => {
    expect(withoutGuard(withGuard(undefined))).toBeUndefined();
  });

  it('gives back an empty or shebang-only hook it joined, instead of asking for it to be deleted', () => {
    for (const original of ['', '#!/bin/sh\n', '\n', '#!/usr/bin/env sh\n\n'])
      expect(withoutGuard(withGuard(original))).toBe(original);
  });

  it("keeps the user's own lines when the end marker has been edited away", () => {
    const damaged = withGuard(husky).replace('# <<< dryfit commit guard <<<\n', '');

    const rest = withoutGuard(damaged) ?? '';

    expect(rest).toContain('. "$(dirname "$0")/h"');
    expect(hasGuard(rest)).toBe(false);
  });

  it('leaves a hook without the guard untouched', () => {
    expect(hasGuard(husky)).toBe(false);
    expect(withoutGuard(husky)).toBe(husky);
  });
});
