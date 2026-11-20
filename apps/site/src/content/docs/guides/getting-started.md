---
title: Getting started
description: From nothing to a library change running inside your app, and back.
---

You need Node 22.12 or newer, macOS or Linux, and an app that installs your library with npm, pnpm, Yarn 2
or newer, or Bun.

## Start dryfit

Run this in the folder of the library you are working on:

```bash
npx @dryfit/cli init
```

`init` remembers where your projects live and starts dryfit's background service. By default that is the
folder above the one you are in, so a library in `~/code/ui` makes dryfit look through `~/code`. Pass
`--root` once per folder to choose others:

```bash
npx @dryfit/cli init --root ~/code --root ~/work
```

Nothing in your projects changes yet. dryfit keeps its own state in `~/.dryfit`.

## Register the library

```bash
npx @dryfit/cli add
```

dryfit works out how the library is built and what gets published. It recognises Nx and Angular CLI
libraries and packages with a `build` script. When it cannot tell, say so with `--build "<command>"` and
`--publish-dir <dir>`. [Build and publish settings](/dryfit/guides/libraries/) explains which folders to
choose.

## Find the apps that use it

```bash
npx @dryfit/cli consumers
```

This lists every project under your roots that depends on the library. It only looks.

## Link an app

```bash
npx @dryfit/cli link ../shop
```

Linking is the first time dryfit touches the app. It saves a copy of the app's `package.json` and
lockfile, installs a dev build of the library the way a release would be installed, clears the framework
caches that would hide it, and adds a [commit guard](/dryfit/guides/commit-guard/) so the dev build
cannot be committed by accident.

## Work

```bash
npx @dryfit/cli watch
```

Every time you save, dryfit builds the library, publishes a new dev version such as
`1.4.1-dev.20261119143201`, and installs it into every linked app. Restart the app's dev server if it does
not pick the change up on its own. `dryfit sync` does the same once, without watching.

## Put the app back

```bash
npx @dryfit/cli restore ../shop
```

The app's `package.json` and lockfile are written back exactly as they were, its dependencies are
reinstalled from them, and the commit guard is removed. `restore --all` does every linked app at once.

## Install it for good

`npx` works for trying dryfit. Once you use it daily, install it so `dryfit` is always on your PATH:

```bash
npm install --global @dryfit/cli
```

`dryfit daemon install` then starts dryfit when you log in, and on macOS the
[menu bar app](/dryfit/guides/menu-bar/) gives you the same controls without a terminal.
