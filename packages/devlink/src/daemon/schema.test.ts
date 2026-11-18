import { describe, expect, it } from 'vitest';
import { s, ValidationError } from './schema.ts';

const linkInput = s.object({
  library: s.string(),
  consumer: s.path(),
  guard: s.optional(s.boolean()),
  tags: s.optional(s.array(s.string())),
});

describe('schema', () => {
  it('accepts a valid value, leaving out absent optional fields', () => {
    expect(linkInput.parse({ library: '@acme/ui', consumer: '/repos/shop' })).toEqual({
      library: '@acme/ui',
      consumer: '/repos/shop',
    });
  });

  it.each([
    ['a missing field', { consumer: '/repos/shop' }, 'library: required'],
    ['a wrong type', { library: 1, consumer: '/repos/shop' }, 'library: expected a string'],
    ['an empty string', { library: '', consumer: '/repos/shop' }, 'library: must not be empty'],
    ['a relative path', { library: 'a', consumer: 'shop' }, 'consumer: expected an absolute path'],
    ['an unknown field', { library: 'a', consumer: '/s', extra: true }, 'extra: unknown field'],
    ['an inherited name', { library: 'a', consumer: '/s', toString: 'x' }, 'toString: unknown field'],
    ['a bad array item', { library: 'a', consumer: '/s', tags: ['x', 2] }, 'tags[1]: expected a string'],
    ['a non-object', 'nope', '(input): expected an object'],
  ])('rejects %s, naming where', (_, value, message) => {
    expect(() => linkInput.parse(value)).toThrow(new ValidationError(message));
  });

  it('describes itself as JSON Schema, for the menu bar app’s client', () => {
    expect(linkInput.json).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['library', 'consumer'],
      properties: {
        library: { type: 'string', minLength: 1 },
        consumer: { type: 'string', pattern: '^/' },
        guard: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
    });
  });
});
