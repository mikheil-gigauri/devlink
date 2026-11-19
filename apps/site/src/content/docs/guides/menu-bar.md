---
title: Menu bar app
description: devlink on macOS without a terminal, from the menu bar and its own window.
---

On macOS, devlink has an app: a menu in the menu bar for what you do all day, and a window for setting
things up. Everything the CLI does day to day can be done there, without a terminal. It needs macOS 26
or newer and talks to the same background service as the CLI, so you can use both.

![The devlink window: @acme/ui linked into shop (npm) and admin (pnpm), with its build settings below](/devlink/menu/window-library.light.png)

## The window

Open it from the menu with **Open**. The first time the app starts, it opens by itself and walks you
through three steps: choose the folders where your apps live, add a library, and link it to an app.

- **Add Library** (the **+** button at the bottom of the sidebar, or ⌘O) asks for the library's folder,
  then shows how devlink will build it and which folder it publishes. Change either before adding it,
  or later with **Change…**.
- A library's page lists the apps it is linked into, with the version each one runs, and below them the
  apps in your project folders that use the library, each with a **Link** button. **Choose App…** links
  an app from anywhere else.
- **Apps** in the sidebar lists every app that uses one of your libraries, found in your project
  folders. An app's page shows each of those libraries as a **Dev build** or a **Release**, with
  **Link** for the ones still on their release. **Add App…** (⇧⌘O) adds an app from outside your
  project folders. You can also drop a folder on the window: an app opens its page, a library opens the
  form that adds it.
- **Sync Now** builds, publishes and installs into every linked app. Turn on **Auto-sync** to do that
  every time you save a change in the library.
- **Restore** on a linked app puts that app back on the release of that one library and keeps its
  other libraries linked. **Restore All** on an app's page puts every library back. When the app's
  `package.json` changed after linking, devlink asks before overwriting the change.
- **New Group** (⇧⌘N) saves apps you test together, so a library can be linked into, or restored from,
  all of them at once.

## The menu

![The devlink menu: a failed install at the top, two libraries with their linked apps, and a group](/devlink/menu/online.light.png)

From the menu you can:

- turn Auto-sync on or off for each library, or sync it once;
- link a library to more apps, and restore an app;
- see each app's installed version, and why an install failed, with the full output a click away;
- link and restore saved groups, and see when a group's apps disagree on a version;
- start or stop devlink, and open its log.

It also tells you, in a notification, when an install fails while the menu is closed.

## Settings

**Settings** (⌘,) holds the folders devlink searches for apps, devlink's service with its log, and
**Open at login**.

## Install

```bash
brew install --cask mikheil-gigauri/devlink/devlink
```

The app runs devlink's command-line tool in the background. If it is not installed, the app offers to
install it with npm (`npm install --global devlink`), which needs Node.js.
