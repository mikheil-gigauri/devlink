---
'@dryfit/cli': patch
---

`dryfit link` with libraries that pin each other no longer fails on dev builds that pin a sibling's old dev
build, such as those published by dryfit 0.4. It publishes them again before installing.
