---
title: Getting started
description: From nothing to a library change running inside your app, and back.
---

You need Node 22.12 or newer, macOS or Linux, and an app that installs your library with npm, pnpm, Yarn 2
or newer, or Bun.

## Start devlink

Run this in the folder of the library you are working on:

```bash
npx @gigauri96/devlink init
```

`init` remembers where your projects live and starts devlink's background service. By default that is the
folder above the one you are in, so a library in `~/code/ui` makes devlink look through `~/code`. Pass
`--root` once per folder to choose others:

```bash
npx @gigauri96/devlink init --root ~/code --root ~/work
```

Nothing in your projects changes yet. devlink keeps its own state in `~/.devlink`.

## Register the library

```bash
npx @gigauri96/devlink add
```

devlink works out how the library is built and what gets published. It recognises Nx and Angular CLI
libraries and packages with a `build` script. When it cannot tell, say so with `--build "<command>"` and
`--publish-dir <dir>`.

## Find the apps that use it

```bash
npx @gigauri96/devlink consumers
```

This lists every project under your roots that depends on the library. It only looks.

## Link an app

```bash
npx @gigauri96/devlink link ../shop
```

Linking is the first time devlink touches the app. It saves a copy of the app's `package.json` and
lockfile, installs a dev build of the library the way a release would be installed, clears the framework
caches that would hide it, and adds a [commit guard](/devlink/guides/commit-guard/) so the dev build
cannot be committed by accident.

## Work

```bash
npx @gigauri96/devlink watch
```

Every time you save, devlink builds the library, publishes a new dev version such as
`1.4.1-dev.20261119143201`, and installs it into every linked app. Restart the app's dev server if it does
not pick the change up on its own. `devlink sync` does the same once, without watching.

## Put the app back

```bash
npx @gigauri96/devlink restore ../shop
```

The app's `package.json` and lockfile are written back exactly as they were, its dependencies are
reinstalled from them, and the commit guard is removed. `restore --all` does every linked app at once.

## Install it for good

`npx` works for trying devlink. Once you use it daily, install it so `devlink` is always on your PATH:

```bash
npm install --global @gigauri96/devlink
```

`devlink daemon install` then starts devlink when you log in, and on macOS the
[menu bar app](/devlink/guides/menu-bar/) gives you the same controls without a terminal.
