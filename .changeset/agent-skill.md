---
'@dryfit/cli': minor
---

`dryfit agent install` teaches Claude Code to use dryfit: it installs a skill, shipped in the package, into `~/.claude/skills` (`--project` for this project's `.claude/skills`, `--dir` for another agent's skills folder), and `dryfit agent show` prints it. Under `--json`, errors now come as JSON on stderr too, `{ "error": { "code", "message", "hint" }, "exitCode" }`, so scripts and agents can tell what failed and what to do.
