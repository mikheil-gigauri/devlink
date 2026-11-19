---
"devlink": minor
---

First release. devlink publishes a library to a local registry and installs it into the projects that
use it, with npm, pnpm, Yarn (2 and later) or Bun, and restores each project byte for byte afterwards.
It comes with a daemon that rebuilds and reinstalls on every change, a CLI, a pre-commit guard that
keeps dev builds out of commits, and a macOS menu bar app.
