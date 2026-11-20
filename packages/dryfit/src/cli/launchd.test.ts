import { describe, expect, it } from 'vitest';
import { LAUNCH_AGENT_LABEL, launchAgentPlist } from './launchd.ts';

describe('launchAgentPlist', () => {
  const plist = launchAgentPlist({
    node: '/Users/me/.nvm/versions/node/v24.21.0/bin/node',
    entry: '/Users/me/.npm-global/lib/node_modules/@dryfit/cli/dist/dryfit.mjs',
    path: '/Users/me/.nvm/versions/node/v24.21.0/bin:/usr/bin:/bin',
    log: '/Users/me/.dryfit/logs/daemon.log',
    env: { DRYFIT_HOME: '/Users/me/.dryfit-<test>&' },
  });

  it('runs this node and this dryfit, so launchd needs no PATH lookup to start it', () => {
    expect(plist).toContain(`<key>Label</key>\n  <string>${LAUNCH_AGENT_LABEL}</string>`);
    expect(plist).toContain(
      [
        '  <array>',
        '    <string>/Users/me/.nvm/versions/node/v24.21.0/bin/node</string>',
        '    <string>/Users/me/.npm-global/lib/node_modules/@dryfit/cli/dist/dryfit.mjs</string>',
        '    <string>daemon</string>',
        '    <string>run</string>',
        '  </array>',
      ].join('\n'),
    );
  });

  it('passes the PATH that finds npm under nvm or Homebrew, and escapes values', () => {
    expect(plist).toContain(
      '<key>PATH</key>\n    <string>/Users/me/.nvm/versions/node/v24.21.0/bin:/usr/bin:/bin</string>',
    );
    expect(plist).toContain('<string>/Users/me/.dryfit-&lt;test&gt;&amp;</string>');
  });

  it('restarts only after a crash, so `dryfit daemon stop` stays stopped', () => {
    expect(plist).toContain('<key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>');
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>');
  });
});

describe('agentEnvironment', () => {
  it('keeps proxy, CA and registry settings for the login agent, but no secrets or npm-injected values', async () => {
    const { agentEnvironment } = await import('./local.ts');

    expect(
      agentEnvironment({
        PATH: '/usr/bin',
        HTTPS_PROXY: 'http://proxy:8080',
        no_proxy: 'localhost',
        NODE_EXTRA_CA_CERTS: '/etc/corp.pem',
        NPM_CONFIG_REGISTRY: 'https://npm.corp.example/',
        npm_config_registry: 'https://injected.example/',
        NPM_TOKEN: 'secret',
        DRYFIT_HOME: '/tmp/dryfit',
      }),
    ).toEqual({
      HTTPS_PROXY: 'http://proxy:8080',
      no_proxy: 'localhost',
      NODE_EXTRA_CA_CERTS: '/etc/corp.pem',
      NPM_CONFIG_REGISTRY: 'https://npm.corp.example/',
      DRYFIT_HOME: '/tmp/dryfit',
    });
  });
});
