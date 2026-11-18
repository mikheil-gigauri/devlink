import { describe, expect, it } from 'vitest';
import { joinPath, pathSlug } from './path.ts';

describe('joinPath', () => {
  it.each([
    [['/a', 'b', 'c'], '/a/b/c'],
    [['/a/', '/b/'], '/a/b'],
    [['/repo/projects/ui', '../../dist/ui'], '/repo/dist/ui'],
    [['/a', '.', 'b'], '/a/b'],
    [['/a', '/b/..', 'c'], '/a/c'],
    [['/', '..'], '/'],
    [['a', 'b'], 'a/b'],
    [['a', '../..'], '..'],
  ])('joins %j into %s', (parts, expected) => {
    const [first = '', ...rest] = parts;
    expect(joinPath(first, ...rest)).toBe(expected);
  });

  it('treats later absolute segments as relative', () => {
    expect(joinPath('/home', '/etc')).toBe('/home/etc');
  });
});

describe('pathSlug', () => {
  it('keeps the value readable and adds a short hash', () => {
    expect(pathSlug('/Users/me/Personal Repos/app')).toMatch(/^Users_me_Personal_Repos_app-[0-9a-f]{8}$/);
  });

  it('is stable for the same input', () => {
    expect(pathSlug('/a/b')).toBe(pathSlug('/a/b'));
  });

  it('keeps paths distinct even when their readable parts collide', () => {
    expect(pathSlug('/a/b_c')).not.toBe(pathSlug('/a/b/c'));
  });

  it('handles scoped package names', () => {
    expect(pathSlug('@acme/ui')).toMatch(/^acme_ui-[0-9a-f]{8}$/);
  });
});
