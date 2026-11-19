# 0004. Dev version scheme

**Status:** Accepted · 2026-11-18

## Context

Registries refuse to republish an existing version, and package managers cache tarballs by version. Reusing
a version means stale code; asking the user to bump means friction. Dev builds also must never be confused
with real releases.

## Decision

Every publish gets a fresh semver prerelease derived from the library's own version and a UTC timestamp:

| Library version | Dev version                     |
| --------------- | ------------------------------- |
| `1.4.0`         | `1.4.1-dev.20261118143201`      |
| `2.0.0-rc.1`    | `2.0.0-rc.1.dev.20261118143201` |

- A stable version is bumped one patch first, so the dev build sorts above the release it is based on.
- A prerelease keeps its identifiers and appends `dev.<stamp>`, which sorts above it as well.
- The stamp is `YYYYMMDDHHmmss` in UTC, a safe integer that sorts chronologically.
- If two publishes land in the same second, the stamp is bumped by one so versions stay strictly increasing.
- Dev versions are published under the `dryfit` dist-tag, never `latest`.

## Consequences

- Versions are unique, ordered, and readable: you can tell when a consumer's build was made.
- Prereleases do not satisfy ordinary ranges such as `^1.4.0`. Consumers install the exact version, which
  is what we want, but a _peer_ range on the library (lib A peers on lib B) will reject it. dryfit detects
  this case and pins the peer with an `overrides` entry in the consumer's snapshot-protected manifest.
- `isDevVersion` is the single source of truth for "this must not be committed" checks (ADR 0005).

## Amendment · 2026-11-18 (M2, verified against real npm)

The peer-range consequence above was wrong for npm. Measured with npm 11 and a real registry:

- Installing the exact dev version succeeds even when another dependency peers on `^1.0.0`. npm installs
  one copy, the dependent resolves it, and `npm ls` only marks the peer as "invalid". That marker exists
  only because the dev build is a prerelease; the real release would satisfy the range.
- An `overrides` entry with the exact version fails with `EOVERRIDE`, because it conflicts with the direct
  dependency. A `$`-reference override works but writes to the user's manifest only to quiet `npm ls`.

So dryfit adds no overrides for npm. The contract suite pins the required behaviour for every adapter
("installs a dev version even when another dependency peers on a release range"); package managers with
strict peer checks, such as pnpm, must meet it inside their own adapter.
