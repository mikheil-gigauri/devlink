import semver from 'semver';
import { describe, expect, it } from 'vitest';
import { isDevVersion, nextDevVersion } from './dev-version.ts';

const at = (iso: string) => new Date(iso);

describe('nextDevVersion', () => {
  it('bumps a stable version by one patch and appends a UTC timestamp', () => {
    expect(nextDevVersion({ base: '1.4.0', now: at('2026-11-18T14:32:01.789Z') })).toBe(
      '1.4.1-dev.20261118143201',
    );
  });

  it('appends to an existing prerelease without bumping', () => {
    expect(nextDevVersion({ base: '2.0.0-rc.1', now: at('2026-11-18T14:32:01Z') })).toBe(
      '2.0.0-rc.1.dev.20261118143201',
    );
  });

  it('drops build metadata from the base', () => {
    expect(nextDevVersion({ base: '1.4.0+sha.abc', now: at('2026-11-18T14:32:01Z') })).toBe(
      '1.4.1-dev.20261118143201',
    );
  });

  it('formats the stamp in UTC regardless of the given offset', () => {
    expect(nextDevVersion({ base: '1.0.0', now: at('2026-01-01T01:30:00+04:00') })).toBe(
      '1.0.1-dev.20251231213000',
    );
  });

  it('sorts above the base it was derived from', () => {
    for (const base of ['0.0.1', '1.4.0', '2.0.0-rc.1', '3.1.0-beta']) {
      const dev = nextDevVersion({ base, now: at('2026-11-18T14:32:01Z') });
      expect(semver.gt(dev, base), `${dev} > ${base}`).toBe(true);
    }
  });

  it('stays strictly increasing when two publishes land in the same second', () => {
    const now = at('2026-11-18T14:32:01Z');
    const first = nextDevVersion({ base: '1.4.0', now });
    const second = nextDevVersion({ base: '1.4.0', now, previous: first });

    expect(second).toBe('1.4.1-dev.20261118143202');
    expect(semver.gt(second, first)).toBe(true);
  });

  it('stays strictly increasing when the clock moves backwards', () => {
    const previous = '1.4.1-dev.20261118143201';
    const next = nextDevVersion({ base: '1.4.0', now: at('2026-11-18T14:00:00Z'), previous });

    expect(next).toBe('1.4.1-dev.20261118143202');
  });

  it('ignores a previous dev version that belongs to a different base', () => {
    const previous = '1.3.1-dev.20991231235959';

    expect(nextDevVersion({ base: '1.4.0', now: at('2026-11-18T14:32:01Z'), previous })).toBe(
      '1.4.1-dev.20261118143201',
    );
  });

  it('rejects a base that is not valid semver', () => {
    expect(() => nextDevVersion({ base: 'latest', now: at('2026-11-18T14:32:01Z') })).toThrow(
      /not a valid semver version: "latest"/,
    );
  });

  it('rejects a base that is already a dev version', () => {
    expect(() =>
      nextDevVersion({ base: '1.4.1-dev.20261118143201', now: at('2026-11-18T14:32:01Z') }),
    ).toThrow(/already a dev version/);
  });
});

describe('isDevVersion', () => {
  it.each(['1.4.1-dev.20261118143201', '2.0.0-rc.1.dev.20261118143201'])('recognises %s', (version) => {
    expect(isDevVersion(version)).toBe(true);
  });

  it.each([
    '1.4.0',
    '1.4.0-dev',
    '1.4.0-dev.1',
    '1.4.0-devtools.20261118143201',
    '1.4.0-dev.20261118143201.1',
    'not-a-version',
  ])('rejects %s', (version) => {
    expect(isDevVersion(version)).toBe(false);
  });
});
