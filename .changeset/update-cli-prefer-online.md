---
'@dryfit/cli': patch
---

The menu bar app's Update button no longer fails with `ETARGET` right after a release: it asks npm to check
the registry again instead of trusting its cached list of versions.
