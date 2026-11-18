import { describe, expect, it } from 'vitest';
import { LAUNCH_AGENT_LABEL, launchAgentPlist } from './launchd.ts';

describe('launchAgentPlist', () => {
  const plist = launchAgentPlist({
    node: '/Users/me/.nvm/versions/node/v24.21.0/bin/node',
    entry: '/Users/me/.npm-global/lib/node_modules/devlink/dist/devlink.mjs',
    path: '/Users/me/.nvm/versions/node/v24.21.0/bin:/usr/bin:/bin',
    log: '/Users/me/.devlink/logs/daemon.log',
    env: { DEVLINK_HOME: '/Users/me/.devlink-<test>&' },
  });

  it('runs this node and this devlink, so launchd needs no PATH lookup to start it', () => {
    expect(plist).toContain(`<key>Label</key>\n  <string>${LAUNCH_AGENT_LABEL}</string>`);
    expect(plist).toContain(
      [
        '  <array>',
        '    <string>/Users/me/.nvm/versions/node/v24.21.0/bin/node</string>',
        '    <string>/Users/me/.npm-global/lib/node_modules/devlink/dist/devlink.mjs</string>',
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
    expect(plist).toContain('<string>/Users/me/.devlink-&lt;test&gt;&amp;</string>');
  });

  it('restarts only after a crash, so `devlink daemon stop` stays stopped', () => {
    expect(plist).toContain('<key>KeepAlive</key>\n  <dict>\n    <key>SuccessfulExit</key>\n    <false/>');
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>');
  });
});
