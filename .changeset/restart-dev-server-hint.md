---
"@dryfit/cli": minor
---

Say when to restart a dev server. When an install clears an app's framework caches, `link`, `sync` and `watch` now print which app's dev server to restart; before, `sync` and `watch` hid that line entirely. After `link`, the next step no longer suggests the build still has to be installed.
