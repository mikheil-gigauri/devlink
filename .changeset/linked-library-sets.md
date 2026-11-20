---
"@dryfit/cli": minor
---

Libraries from one workspace that pin each other exactly, such as an Nx workspace with independent releases, now work together. `dryfit link <app> --library a --library b` links several libraries in one step, each dev build pins the other registered libraries' dev builds, a sync also republishes the libraries that depend on the one that changed, and every install into an app puts all of its linked libraries in with one package manager run. Restoring one library also restores the linked libraries tied to it. A failed install names the libraries to link along.
