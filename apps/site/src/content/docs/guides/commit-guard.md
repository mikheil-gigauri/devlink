---
title: The commit guard
description: A git hook that keeps dev builds out of your commits while an app is linked.
---

While an app is linked, its `package.json` and lockfile name a dev build that exists only on your machine.
Committing them would break the app for everyone else, so linking adds a git `pre-commit` hook that
refuses such a commit:

```text
dryfit: these staged files point at a local dev build:
  package-lock.json
Run `dryfit restore` in this project first, or commit with --no-verify if you are sure.
```

The hook looks at the staged manifest and lockfiles for a dev version, which always ends in `dev.`
followed by a 14-digit timestamp. It is installed wherever git actually runs hooks, so it works with
`core.hooksPath`, Husky, lefthook and worktrees, and it keeps any `pre-commit` hook you already had.

Restoring the app removes the guard and leaves your own hook as it was. Link with `--no-guard` to skip it.
