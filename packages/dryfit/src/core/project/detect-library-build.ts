import type { FileSystem } from '../ports.ts';
import { isRecord, tryParseJson } from '../util/json.ts';
import { joinPath, relativeInside, resolvePath } from '../util/path.ts';
import { readManifest } from './manifest.ts';

export type LibraryBuildKind = 'nx' | 'angular' | 'npm-script' | 'none';

export interface DetectedLibraryBuild {
  readonly kind: LibraryBuildKind;
  /** Runs in the library root. Workspace CLIs are called by absolute path so npx never downloads one. */
  readonly build?: { readonly command: string; readonly args: readonly string[] };
  readonly publishDir: string;
}

/** How far up from a library to look for an Nx or Angular workspace. */
const MAX_WORKSPACE_DEPTH = 6;

/**
 * Works out how a library is built and what gets published, so `dryfit add` needs no flags for the
 * common cases: an Nx library, an Angular CLI library (both usually ng-packagr), or a package with a
 * `build` script. Flags passed by the user always win over this.
 */
export async function detectLibraryBuild(fs: FileSystem, root: string): Promise<DetectedLibraryBuild> {
  const libraryRoot = joinPath(root);
  const { manifest } = await readManifest(fs, libraryRoot);
  const ngPackage = await readJson(fs, joinPath(libraryRoot, 'ng-package.json'));
  // ng-packagr writes to `dist` beside ng-package.json unless `dest` says otherwise.
  const ngDest =
    ngPackage === undefined
      ? undefined
      : resolvePath(libraryRoot, typeof ngPackage.dest === 'string' ? ngPackage.dest : 'dist');

  const project = await readJson(fs, joinPath(libraryRoot, 'project.json'));
  const nxRoot = project && (await findUp(fs, libraryRoot, 'nx.json'));
  if (project && nxRoot !== undefined) {
    const name = typeof project.name === 'string' ? project.name : String(manifest.name);
    const projectRoot = relativeInside(nxRoot, libraryRoot) ?? '';
    return {
      kind: 'nx',
      build: { command: joinPath(nxRoot, 'node_modules/.bin/nx'), args: ['build', name] },
      publishDir: ngDest ?? nxOutputPath(project, nxRoot, projectRoot) ?? libraryRoot,
    };
  }

  const angularRoot = await findUp(fs, libraryRoot, 'angular.json');
  if (angularRoot !== undefined) {
    const workspace = await readJson(fs, joinPath(angularRoot, 'angular.json'));
    const relative = relativeInside(angularRoot, libraryRoot);
    const projects = isRecord(workspace?.projects) ? workspace.projects : {};
    const match = Object.entries(projects).find(
      ([, config]) =>
        isRecord(config) &&
        typeof config.root === 'string' &&
        joinPath('/', config.root) === joinPath('/', relative ?? '-'),
    );
    if (match) {
      return {
        kind: 'angular',
        build: { command: joinPath(angularRoot, 'node_modules/.bin/ng'), args: ['build', match[0]] },
        publishDir: ngDest ?? libraryRoot,
      };
    }
  }

  const scripts = isRecord(manifest.scripts) ? manifest.scripts : {};
  if (typeof scripts.build === 'string') {
    return { kind: 'npm-script', build: { command: 'npm', args: ['run', 'build'] }, publishDir: libraryRoot };
  }
  return { kind: 'none', publishDir: libraryRoot };
}

function nxOutputPath(
  project: Record<string, unknown>,
  workspace: string,
  projectRoot: string,
): string | undefined {
  const targets = isRecord(project.targets) ? project.targets : {};
  const build = isRecord(targets.build) ? targets.build : {};
  const options = isRecord(build.options) ? build.options : {};
  if (typeof options.outputPath !== 'string') return undefined;
  const path = options.outputPath
    .replaceAll('{workspaceRoot}', workspace)
    .replaceAll('{projectRoot}', projectRoot);
  return resolvePath(workspace, path);
}

async function findUp(fs: FileSystem, from: string, file: string): Promise<string | undefined> {
  let dir = from;
  for (let depth = 0; depth <= MAX_WORKSPACE_DEPTH; depth += 1) {
    if (await fs.exists(joinPath(dir, file))) return dir;
    if (dir === '/') return undefined;
    dir = joinPath(dir, '..');
  }
  return undefined;
}

async function readJson(fs: FileSystem, path: string): Promise<Record<string, unknown> | undefined> {
  const text = await fs.readText(path);
  const parsed = text === undefined ? undefined : tryParseJson(text);
  return isRecord(parsed) ? parsed : undefined;
}
