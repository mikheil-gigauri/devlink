import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { operations } from './api.ts';
import { API_CONTRACT_DIR, apiDocuments } from './api-contract.ts';

describe('the API contract shared with the menu bar app (ADR 0013)', () => {
  const documents = apiDocuments();

  it.each(Object.keys(documents))(
    'has an up-to-date %s checked in (run `npm run api:export`)',
    async (file) => {
      const committed = await readFile(new URL(file, API_CONTRACT_DIR), 'utf8').catch(() => '(missing)');

      expect(committed).toBe(documents[file]);
    },
  );

  it('describes every operation with the JSON Schema of its input', () => {
    const schema = JSON.parse(documents['schema.json'] ?? '{}');

    expect(Object.keys(schema.operations)).toEqual(Object.keys(operations));
    expect(schema.operations.link.input).toMatchObject({
      type: 'object',
      required: ['library', 'consumer'],
      additionalProperties: false,
    });
    expect(schema.errorCodes).toContain('manifest-drifted');
    expect(schema.errorCodes).toContain('unauthorized');
    expect(schema.eventTypes).toContain('watch:failed');
  });

  it('carries a sample output for every operation and a sample of every event', () => {
    const schema = JSON.parse(documents['schema.json'] ?? '{}');
    const fixtures = JSON.parse(documents['fixtures.json'] ?? '{}');

    expect(Object.keys(fixtures.outputs)).toEqual(Object.keys(operations));
    expect(fixtures.events.map((event: { type: string }) => event.type)).toEqual(schema.eventTypes);
  });
});
