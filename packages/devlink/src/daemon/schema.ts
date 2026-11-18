/**
 * A deliberately small validator for the daemon's request bodies. Each schema parses `unknown` into a
 * typed value and describes itself as JSON Schema, so the Swift client (M4) is checked against the
 * same definitions the daemon enforces. Objects reject unknown fields: a typo should fail loudly.
 */

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface Schema<T> {
  parse(value: unknown, path?: string): T;
  readonly json: JsonSchema;
}

interface OptionalSchema<T> extends Schema<T | undefined> {
  readonly optional: true;
}

export type Infer<S> = S extends Schema<infer T> ? T : never;

type Shape = Readonly<Record<string, Schema<unknown>>>;
type RequiredKeys<S extends Shape> = {
  [K in keyof S]: S[K] extends OptionalSchema<unknown> ? never : K;
}[keyof S];
type OptionalKeys<S extends Shape> = Exclude<keyof S, RequiredKeys<S>>;
type Flatten<T> = { [K in keyof T]: T[K] };
export type ObjectOf<S extends Shape> = Flatten<
  { readonly [K in RequiredKeys<S>]: Infer<S[K]> } & { readonly [K in OptionalKeys<S>]?: Infer<S[K]> }
>;

export class ValidationError extends Error {
  override readonly name = 'ValidationError';
}

const fail = (path: string, problem: string): never => {
  throw new ValidationError(`${path || '(input)'}: ${problem}`);
};

const string = (): Schema<string> => ({
  json: { type: 'string', minLength: 1 },
  parse(value, path = '') {
    if (typeof value !== 'string') return fail(path, 'expected a string');
    if (value.length === 0) return fail(path, 'must not be empty');
    return value;
  },
});

const path = (): Schema<string> => ({
  json: { type: 'string', pattern: '^/' },
  parse(value, at = '') {
    if (typeof value !== 'string') return fail(at, 'expected a string');
    if (!value.startsWith('/')) return fail(at, 'expected an absolute path');
    return value;
  },
});

const boolean = (): Schema<boolean> => ({
  json: { type: 'boolean' },
  parse(value, path = '') {
    return typeof value === 'boolean' ? value : fail(path, 'expected true or false');
  },
});

const array = <T>(item: Schema<T>): Schema<T[]> => ({
  json: { type: 'array', items: item.json },
  parse(value, path = '') {
    if (!Array.isArray(value)) return fail(path, 'expected a list');
    return value.map((entry, index) => item.parse(entry, `${path}[${index}]`));
  },
});

const optional = <T>(schema: Schema<T>): OptionalSchema<T> => ({
  optional: true,
  json: schema.json,
  parse: (value, path) => (value === undefined ? undefined : schema.parse(value, path)),
});

const object = <S extends Shape>(shape: S): Schema<ObjectOf<S>> => {
  const required = Object.entries(shape)
    .filter(([, schema]) => !('optional' in schema))
    .map(([key]) => key);
  return {
    json: {
      type: 'object',
      additionalProperties: false,
      required,
      properties: Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, schema.json])),
    },
    parse(value, path = '') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(path, 'expected an object');
      }
      const at = (key: string) => (path ? `${path}.${key}` : key);
      const record = value as Record<string, unknown>;
      for (const key of Object.keys(record)) if (!Object.hasOwn(shape, key)) fail(at(key), 'unknown field');

      const result: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(shape)) {
        if (record[key] === undefined && required.includes(key)) fail(at(key), 'required');
        const parsed = schema.parse(record[key], at(key));
        if (parsed !== undefined) result[key] = parsed;
      }
      return result as ObjectOf<S>;
    },
  };
};

export const s = { string, path, boolean, array, optional, object };
