# 0014. Libraries that pin each other

**Status:** Accepted · 2026-11-20

## Context

Workspaces with independent releases (Nx release, changesets with `fixed` off) often pin their own
packages exactly: `libs/ui/package.json` declares `"@acme/common": "19.24.0"`, and the release tool
rewrites that pin to the version it is releasing. Released packages carry the same exact pins: `ui@19.50.1`
peers on `common@"19.33.0"`.

Until now dryfit treated every library on its own, which breaks that workspace three ways:

- Linking `common` alone installs: npm lets the app's own dependency override the released `ui`'s exact
  peer, and only marks it invalid. Every later install into that app then fails with `ERESOLVE`, because
  nothing overrides the conflict any more. Linking `ui` alone fails at once: its dev build peers on a
  `common` the app does not have.
- Linking them one at a time fails for the same reason: each install is a separate package manager run,
  and between runs the tree is inconsistent.
- Even installed together, each dev build's manifest still pins its siblings' _source_ versions
  (`common@19.24.0`), which is neither the release the app has nor the dev build dryfit just published.

## Decision

**A dev build pins its siblings' dev builds.** When dryfit stages a library for publishing, every entry
in `dependencies`, `peerDependencies` and `optionalDependencies` that names another registered library
with a published dev version is rewritten to exactly that version, whatever range it had. `devDependencies`
is left alone, since consumers never install it. Like the version itself (ADR 0004), the rewrite happens
in the staged copy only. A `workspace:` range on such a sibling is resolved by the same rewrite, so it is
no longer refused; one on any other package still is.

Rewriting ranges as well as exact pins is deliberate: a prerelease does not satisfy `^19.0.0`, so a
package manager would quietly install a nested release of the sibling and the dev build would run against
the wrong code.

**The dependency graph comes from source manifests.** Edges are read from each registered library's
`package.json` in its folder and in its publish folder, in the three fields above. Nothing new is stored:
the graph follows the workspace as the developer edits it.

**A consumer's dev builds are installed together.** Every install into a consumer is one package manager
run that installs the dev build of each library linked into it, at that library's latest dev version.
Each package stays in the dependency field it is already declared in: when they differ, no save flag is
passed, and npm, pnpm, Yarn and Bun all keep each package where it is (checked by the adapter contract
suite).

**A sync publishes the set, in dependency order.** Syncing a library publishes, dependencies first:

1. the library itself,
2. every registered library that depends on it, directly or not, and already has a dev build or is
   linked somewhere, since that dev build pins a version that is about to be replaced,
3. every registered library that one of those depends on and that is linked somewhere but has never
   been published, so the set is complete on its first sync.

Then every consumer linked to any of them gets its one combined install. Cycles, which Nx refuses anyway,
are published in name order after everything else.

**Linking takes several libraries.** `dryfit link <app> --library common --library ui` links them in one
step: one snapshot, then one install. Linking one at a time still works: a link whose install failed stays
in the consumer's set, so the next link installs both together.

**Linking republishes stale dev builds.** Each publish records, as `pinnedSiblings`, the dev version it
pinned for every registered library it depends on directly. Before installing, `link` publishes again
every dev build in the consumer's set whose recorded pin is not its sibling's latest dev version, with
what depends on it, as a sync would. That covers dev builds published before pins were recorded, and those
left behind when a sync failed partway through the set. A build that fails here fails the link before
anything is installed. (Added after 0.5.0, whose first link of the syniotec workspace reused 0.4 builds.)

**Restoring one library restores what it is tied to.** `dryfit restore <app> --library ui` restores every
library linked into the app that is connected to `ui` in the graph, in either direction, because the dev
builds left behind would pin, or be pinned by, a dev build that is gone. The others are reinstalled
together, as before. A whole-consumer restore is unchanged: the snapshot puts everything back exactly.

## Consequences

- The Nx workspace works end to end: link the libraries the app uses together, sync any of them, restore.
- A change to a library at the bottom of the graph rebuilds everything above it that has a dev build.
  With Angular libraries that can take minutes per sync. Re-staging a dependent's existing build output
  with new pins, without rebuilding, would be faster but risks publishing stale output; it is left for
  later.
- A library linked alone into an app whose released packages pin it exactly still fails, at once or on
  the next install, because that is what the app's own packages say. A failed install now names the
  registered libraries tied to it that the app also uses, so the fix is one command away. When npm
  accepts the lone install instead, dryfit says nothing yet; warning there is left for later.
- A failing install now marks every library in it failed, not just the one that triggered the run. That
  is accurate: none of them were installed.
- `SyncResult` gains `published` (every library and version published, in order) and each install
  outcome gains `libraries` (what went in together). `link` takes `libraries` alongside `library` and
  returns `links`. All additions are optional, so existing clients keep working.
