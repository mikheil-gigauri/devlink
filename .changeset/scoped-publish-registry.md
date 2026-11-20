---
'@dryfit/cli': patch
---

Dev builds of a scoped library now always publish to dryfit's local registry. Before, an `@scope:registry` line in your `.npmrc`, or a `registry` in the library's `publishConfig`, sent them to that registry instead, often the public npm registry.
