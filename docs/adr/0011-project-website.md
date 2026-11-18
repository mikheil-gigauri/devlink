# 0011. Project website

**Status:** Accepted · 2026-11-18

## Context

The project needs a landing page that explains the problem in ten seconds, plus documentation that stays in
sync with the code.

## Decision

Astro with Starlight, in `apps/site`, deployed to GitHub Pages from CI.

- The landing page is custom Astro, not a template: a live-looking demo of the link → publish → install
  cycle and a short comparison with symlinks, yalc and copying.
- Docs are Starlight pages. The ADRs are published as-is under "Design", and CLI reference pages are
  generated from the CLI's command definitions so they cannot drift.
- Static output, no client framework except small islands where interaction earns it.

## Consequences

- Docs live in the same pull request as the change they describe.
- A custom domain can be added later without changing the setup.
