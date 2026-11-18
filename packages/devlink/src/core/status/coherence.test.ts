import { describe, expect, it } from 'vitest';
import type { DevlinkState, LinkRecord } from '../model.ts';
import { coherenceWarnings } from './coherence.ts';

const link = (consumer: string, installedVersion?: string, library = '@acme/ui'): LinkRecord => ({
  library,
  consumer,
  status: installedVersion ? 'installed' : 'pending',
  installedVersion,
});
const state = (links: LinkRecord[]): DevlinkState => ({
  libraries: [],
  links,
  groups: [{ name: 'checkout', consumers: ['/repos/host', '/repos/cart'] }],
});

describe('coherenceWarnings', () => {
  it('warns when consumers that run together are on different dev versions of a library', () => {
    const warnings = coherenceWarnings(
      state([
        link('/repos/host', '1.0.1-dev.20261118100000'),
        link('/repos/cart', '1.0.1-dev.20261118110000'),
      ]),
    );

    expect(warnings).toEqual([
      {
        group: 'checkout',
        library: '@acme/ui',
        versions: [
          { consumer: '/repos/host', version: '1.0.1-dev.20261118100000' },
          { consumer: '/repos/cart', version: '1.0.1-dev.20261118110000' },
        ],
      },
    ]);
  });

  it('is quiet when the group agrees, and ignores pending links and consumers outside the group', () => {
    const v1 = '1.0.1-dev.20261118100000';

    expect(
      coherenceWarnings(
        state([
          link('/repos/host', v1),
          link('/repos/cart', v1),
          link('/repos/cart', undefined, '@acme/forms'),
          link('/repos/elsewhere', '1.0.1-dev.20261118120000'),
        ]),
      ),
    ).toEqual([]);
  });
});
