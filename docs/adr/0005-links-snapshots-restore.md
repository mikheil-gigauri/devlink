# 0005. Opt-in links, snapshots and restore

**Status:** Accepted · 2026-11-18

## Context

A library may have fifteen consumers while the developer is testing in three. Installing a dev version
rewrites the consumer's `package.json` and lockfile, and those changes must never reach a commit: the
lockfile would contain `127.0.0.1` tarball URLs that break every other machine and CI.

## Decision

- **Discovery is passive.** devlink scans configured roots and lists every project that depends on a
  registered library, but does nothing to them.
- **Links are opt-in.** Only a consumer the user explicitly links receives installs. A link persists until
  it is restored. Saved groups ("booking flow") link or restore several consumers at once.
- **Snapshot before first install.** Linking copies the consumer's manifest and lockfile into
  `~/.devlink/snapshots/<consumer-id>/`. Restore writes them back and runs a clean install, so the repo
  returns byte-for-byte to its pre-link state.
- **Commit guard.** Linking offers to install a git `pre-commit` hook (chained with existing hooks and
  Husky) that rejects staged manifests or lockfiles containing dev versions or the local registry URL.
- **Version coherence warning.** When linked consumers that run together (a federation host and its
  remotes) are on different dev versions of the same library, devlink warns.

## Consequences

- Nothing happens to a repo the user did not choose. Trust is the feature.
- Snapshots go stale if the user changes dependencies while linked. Restore detects a manifest that changed
  since linking (beyond the devlink edits) and asks instead of overwriting.
