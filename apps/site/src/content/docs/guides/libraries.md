---
title: Build and publish settings
description: Which folder to add, how dryfit builds a library, and which folder it publishes.
---

Every library dryfit knows has three settings: its folder, a build command and a publish folder. `dryfit
add` and **Add Library** in the [menu bar app](/dryfit/guides/menu-bar/) fill them in for you, and you
can change them before the library is added or later. This page says what each one means and what dryfit
picks.

## The library folder

This is the folder that holds the library's own `package.json`. In an Nx or Angular CLI workspace, that is
the project's folder, such as `libs/ui` or `projects/ui`, not the workspace root. dryfit reads the
library's name from that `package.json`, runs the build command there, and watches it for changes.

## The build command

dryfit runs this command in the library folder before every publish. Leave it empty if the library is
published from its sources without a build step.

The command is split on spaces and run directly, without a shell. Pipes, `&&` and quoted arguments do
not work, so put anything more complex in a `package.json` script and use `npm run <script>`.

## The publish folder

This folder is what gets published and installed into your apps, so it must hold the `package.json`
consumers should see. dryfit copies it without `node_modules` and `.git`, gives the copy a dev version, and
publishes it with npm, which applies the `files` field and `.npmignore` as a real release would. Your own
files are never changed.

For a library built with ng-packagr, the publish folder is the build output, such as `dist/libs/ui`,
because ng-packagr writes the `package.json` that is released. For a package that ships a `dist` folder
listed in its `files`, it is the library folder itself.

## What dryfit detects

dryfit checks for these in order and uses the first match:

| Library                            | Build command     | Publish folder                                                                               |
| ---------------------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| Nx (`project.json` and `nx.json`)  | `nx build <name>` | `dest` from `ng-package.json`, else the build target's `outputPath`, else the library folder |
| Angular CLI (`angular.json`)       | `ng build <name>` | `dest` from `ng-package.json`, else the library folder                                       |
| A `build` script in `package.json` | `npm run build`   | The library folder                                                                           |
| Anything else                      | None              | The library folder                                                                           |

When `ng-package.json` has no `dest`, ng-packagr writes to `dist` beside it, and dryfit assumes the same.
Nx and Angular are called from the workspace's own `node_modules`, so the workspace must be installed.

## Setting them yourself

From the command line, pass the settings to `dryfit add`:

```bash
dryfit add libs/ui --build "npm run build:lib" --publish-dir ../../dist/libs/ui
```

Each flag changes only its own setting. The other one is detected for a new library, or kept as it is for
a library already added, so `dryfit add --publish-dir ../../dist/libs/ui` keeps the detected
`nx build`. Without flags, `dryfit add` on a library already added keeps both settings and prints them.

A relative `--publish-dir` is resolved from the library folder, not from where you run the command or
from the workspace root. In a workspace, the output usually sits a few levels up, as in the example above.
An absolute path always works.

In the menu bar app, **Add Library** shows the detected settings before anything is added. Edit the
command, or choose **Choose…** next to the publish folder. For a library already added, use **Change…** on
its page.

## Watching

`dryfit watch` and **Auto-sync** rebuild when a file in the library folder changes. They ignore the publish
folder when it is inside the library folder, along with `node_modules`, `dist`, `.angular`, `.nx`,
`coverage` and similar build folders, so a build never sets off the next one.

## When it goes wrong

- **The app gets the library's sources instead of the build.** The publish folder is the library folder,
  but the build writes elsewhere. Point the publish folder at the build output.
- **Publishing fails with `workspace:` or `catalog:` ranges.** The publish folder holds the workspace's
  `package.json`, not the one the build writes. See
  [Workspaces](/dryfit/guides/package-managers/#workspaces).
- **The app gets an old build.** The build command is empty or builds a different project. Run
  `dryfit add` in the library folder to see its settings, or open its page in the app.
