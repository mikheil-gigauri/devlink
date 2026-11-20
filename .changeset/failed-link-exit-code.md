---
'@dryfit/cli': patch
---

`dryfit link` now exits 1 when the install into a consumer fails, with `--json` too, and `link --group`
reports that member as failed instead of done. A failed link keeps the end of the package manager's
output as `message`, so `link --json`, `status --json` and `dryfit status` show why (such as npm's
`ERESOLVE`) without rerunning the install, and the daemon log records it.
