import { describe, expect, it } from 'vitest';
import { parseNpmrc, uplinksFrom } from './npm-uplinks.ts';

describe('parseNpmrc', () => {
  it('reads key=value lines, skipping comments, and expands environment references', () => {
    const npmrc = [
      '; a comment',
      '# another',
      'registry = https://registry.npmjs.org/',
      '@corp:registry=https://npm.corp.example/repository/npm/',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: npmrc syntax, which the parser expands
      '//npm.corp.example/repository/npm/:_authToken=${CORP_TOKEN}',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: npmrc syntax, which the parser expands
      '//npm.corp.example/:_authToken=${MISSING}',
    ].join('\n');

    expect(parseNpmrc(npmrc, { CORP_TOKEN: 's3cret' })).toEqual(
      new Map([
        ['registry', 'https://registry.npmjs.org/'],
        ['@corp:registry', 'https://npm.corp.example/repository/npm/'],
        ['//npm.corp.example/repository/npm/:_authToken', 's3cret'],
        ['//npm.corp.example/:_authToken', ''],
      ]),
    );
  });
});

describe('uplinksFrom', () => {
  const ownRegistry = 'http://127.0.0.1:4874/';

  it('proxies the default registry for everything and each scoped registry for its scope', () => {
    const result = uplinksFrom({
      registry: 'https://registry.npmjs.org/',
      scoped: { '@corp': 'https://npm.corp.example/repository/npm/' },
      settings: new Map([['//npm.corp.example/repository/npm/:_authToken', 's3cret']]),
      ownRegistry,
    });

    expect(result).toEqual({
      'registry.npmjs.org': { url: 'https://registry.npmjs.org/' },
      'npm.corp.example': {
        url: 'https://npm.corp.example/repository/npm/',
        auth: { type: 'bearer', token: 's3cret' },
        scopes: ['@corp'],
      },
    });
  });

  it('finds credentials set for a parent path, and accepts basic auth', () => {
    const result = uplinksFrom({
      registry: 'https://npm.corp.example/repository/npm/',
      scoped: {},
      settings: new Map([['//npm.corp.example/:_auth', 'dXNlcjpwYXNz']]),
      ownRegistry,
    });

    expect(result['npm.corp.example']?.auth).toEqual({ type: 'basic', token: 'dXNlcjpwYXNz' });
  });

  it('skips a password that is not valid base64 rather than failing to start', () => {
    const registry = 'https://npm.corp.example/';
    const settings = (password: string) =>
      new Map([
        ['//npm.corp.example/:username', 'me'],
        ['//npm.corp.example/:_password', password],
      ]);

    const broken = uplinksFrom({ registry, scoped: {}, settings: settings('not base64!'), ownRegistry });
    const valid = uplinksFrom({ registry, scoped: {}, settings: settings(btoa('pass')), ownRegistry });

    expect(broken['npm.corp.example']).toEqual({ url: registry });
    expect(valid['npm.corp.example']?.auth).toEqual({ type: 'basic', token: btoa('me:pass') });
  });

  it('shares one uplink between scopes on the same registry, and never proxies itself', () => {
    const result = uplinksFrom({
      registry: 'https://registry.npmjs.org/',
      scoped: {
        '@corp': 'https://npm.corp.example/',
        '@corp-internal': 'https://npm.corp.example/',
        '@acme': ownRegistry,
      },
      settings: new Map(),
      ownRegistry,
    });

    expect(Object.keys(result)).toEqual(['registry.npmjs.org', 'npm.corp.example']);
    expect(result['npm.corp.example']?.scopes).toEqual(['@corp', '@corp-internal']);
  });
});
