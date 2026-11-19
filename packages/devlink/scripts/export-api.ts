import { mkdir, writeFile } from 'node:fs/promises';
import { API_CONTRACT_DIR, apiDocuments } from '../src/daemon/api-contract.ts';

// Writes the API contract the menu bar app is tested against (ADR 0013).
await mkdir(API_CONTRACT_DIR, { recursive: true });
for (const [file, content] of Object.entries(apiDocuments())) {
  await writeFile(new URL(file, API_CONTRACT_DIR), content);
  process.stdout.write(`wrote api/${file}\n`);
}
