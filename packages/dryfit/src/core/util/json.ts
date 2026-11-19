export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses JSON, returning undefined instead of throwing on invalid input. */
export function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** JSON with object keys sorted at every level, for order-insensitive comparison. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    isRecord(nested)
      ? Object.fromEntries(Object.entries(nested).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : nested,
  );
}

/** The indentation a JSON document uses, so rewrites keep the author's formatting. */
export function detectIndent(text: string): string {
  return /^[{[]\r?\n([ \t]+)/.exec(text)?.[1] ?? '  ';
}
