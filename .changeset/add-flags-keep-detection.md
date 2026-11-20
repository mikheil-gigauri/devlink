---
'@dryfit/cli': patch
---

`dryfit add --publish-dir` now keeps the detected build command, and `dryfit add --build` keeps the
detected publish folder. Before, passing one flag left the library with no build step or publishing its
sources.
