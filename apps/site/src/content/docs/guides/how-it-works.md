---
title: How it works
description: A private registry, unique dev versions, and a snapshot of everything it changes.
---

dryfit makes a library change reach your app the same way a release would: as a package installed from a
registry by your app's own package manager. Everything else follows from that.

## A registry on your machine

dryfit runs [Verdaccio](https://verdaccio.org) inside its background service, listening on
`127.0.0.1:4874`. It holds only your dev builds. Every other package is fetched from the registry your
project already uses, so installs resolve exactly as they would without dryfit.

## A new version for every change

Each publish gets a version that has never existed before, built from the library's own version and the
time:

| Library version | Dev version                     |
| --------------- | ------------------------------- |
| `1.4.0`         | `1.4.1-dev.20261119143201`      |
| `2.0.0-rc.1`    | `2.0.0-rc.1.dev.20261119143201` |

A fresh version means no package manager, bundler or cache can mistake the new build for the old one. Dev
versions are published under the `dryfit` tag, never `latest`.

## A real install

dryfit runs your app's package manager to install the dev build, so the app gets a real copy in
`node_modules`, with its dependencies resolved and its peer dependencies shared with the app. There are no
symlinks, so your app never ends up with two copies of Angular or React.

Each package manager is driven a little differently. The
[package managers](/dryfit/guides/package-managers/) page has the details.

## Caches cleared

Some frameworks cache prebuilt dependencies and would keep serving the old build. After each install,
dryfit deletes the caches it knows about for the app. See
[frameworks and caches](/dryfit/guides/frameworks/).

## Everything it changes, saved first

Before the first install into an app, dryfit copies the app's `package.json` and lockfile into
`~/.dryfit/snapshots`. Restoring writes them back and reinstalls, so the app returns to exactly what it
was. Between the two, a git hook refuses commits that contain a dev build.

## One service, several clients

The CLI and the menu bar app are both clients of one background service, which owns the registry, the
watchers and the links. That is why `dryfit watch --detach` keeps working after you close the terminal,
and why the menu bar shows installs you started from the CLI.

The [design decisions](/dryfit/design/) explain each of these choices and what they cost.
