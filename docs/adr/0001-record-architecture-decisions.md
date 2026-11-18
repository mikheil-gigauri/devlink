# 0001. Record architecture decisions

**Status:** Accepted · 2026-11-18

## Context

devlink is meant to be open source. Contributors arrive without the conversations that shaped it, and the
interesting parts of the design (why a registry instead of symlinks, why a daemon) are exactly the parts
that look over-engineered from the outside.

## Decision

Keep lightweight ADRs in `docs/adr`, numbered, one decision per file, in the Status / Context / Decision /
Consequences shape. A pull request that changes a recorded decision must add a superseding ADR.

## Consequences

The "why" lives next to the code and can be linked from issues and the website. Writing one costs ten
minutes; skipping one costs a confused contributor and a re-litigated design.
