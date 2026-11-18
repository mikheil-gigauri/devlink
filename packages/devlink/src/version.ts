import packageJson from '../package.json' with { type: 'json' };

/** This devlink's version. The CLI restarts a daemon whose version differs (ADR 0012). */
export const VERSION: string = packageJson.version;
