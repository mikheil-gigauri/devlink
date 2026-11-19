---
title: Frameworks and caches
description: Which build caches devlink clears after an install, and when to restart your dev server.
---

Several build tools keep a prebuilt copy of your dependencies and serve it until they notice a change.
A new version in `node_modules` is not always noticed, so after every install devlink deletes the caches
it knows about in that app:

| Detected from                           | Cache cleared                                             |
| --------------------------------------- | --------------------------------------------------------- |
| `angular.json` or `@angular/core`       | `.angular/cache`, or `cli.cache.path` from `angular.json` |
| `@angular-architects/native-federation` | `node_modules/.cache/native-federation`                   |
| `vite`                                  | `node_modules/.vite`                                      |

devlink only ever deletes folders inside the app.

## Restart the dev server

A running dev server holds the old build in memory. After a sync, restart it unless it reloaded by itself.
`devlink events` and the menu bar show when each install finished.

## Apps that run together

A Native Federation or Module Federation shell and its remotes each install the library separately. If
they end up on different dev versions, the shared copy may not be the one you just built. Save them as a
group so they are linked, synced and restored together:

```bash
devlink group save checkout ../shell ../cart ../payments
devlink link --group checkout
```

`devlink status` and the menu bar warn when the apps in a group have different versions of the same
library.
