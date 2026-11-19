/** The launchd agent that starts dryfitd at login (ADR 0012). */
export const LAUNCH_AGENT_LABEL = 'dev.dryfit.daemon';

export interface LaunchAgentInput {
  /** Absolute path of the node binary to run. */
  readonly node: string;
  /** Absolute path of the dryfit entry script. */
  readonly entry: string;
  /** PATH for the daemon. launchd's default cannot find npm installed by nvm or Homebrew. */
  readonly path: string;
  readonly log: string;
  /** Extra variables, such as DRYFIT_HOME. */
  readonly env?: Readonly<Record<string, string>>;
}

export function launchAgentPlist(input: LaunchAgentInput): string {
  const env = { PATH: input.path, ...input.env };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${[input.node, input.entry, 'daemon', 'run'].map((arg) => `    <string>${xml(arg)}</string>`).join('\n')}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env)
  .map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`)
  .join('\n')}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(input.log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(input.log)}</string>
</dict>
</plist>
`;
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
