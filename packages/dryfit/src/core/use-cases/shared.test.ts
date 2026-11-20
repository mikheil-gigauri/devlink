import { describe, expect, it } from 'vitest';
import { failureMessage } from './shared.ts';

describe('failureMessage', () => {
  it('keeps the last lines, where package managers put the reason', () => {
    const output = ['npm error code ERESOLVE', ...Array.from({ length: 30 }, (_, i) => `line ${i}`)].join(
      '\n',
    );

    expect(failureMessage(output, 3)).toBe('line 27\nline 28\nline 29');
  });

  it('cuts very long lines from the front, marking the cut', () => {
    expect(failureMessage(`${'x'.repeat(50)}END`, 20, 10)).toBe(`…${'x'.repeat(7)}END`);
  });

  it('returns short output whole, trimmed', () => {
    expect(failureMessage('\n  npm error 404 Not Found  \n')).toBe('npm error 404 Not Found');
  });
});
