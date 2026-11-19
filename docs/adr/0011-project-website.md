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

## Amendment · 2026-11-19 (M5, as built)

- Astro 7 and Starlight 0.43, served at `/dryfit/` on GitHub Pages by `.github/workflows/site.yml`.
- `apps/site/scripts/generate.ts` writes three things before each build, all gitignored: the CLI
  reference from the CLI's exported `USAGE` text, the ADRs with their links rewritten into site links,
  and the menu bar app's latest snapshot images, which the landing page shows.
- The landing page is custom Astro with one small script and no client framework: a diagram where
  "Edit the library" sends a dev version, in the real scheme, down the wires to three apps, and
  "Restore" brings them back. It respects reduced motion and follows the docs' theme choice.
- Astro 7 needs Node 22.23.4 or newer, above dryfit's own floor of 22.12, so CI builds the site only on
  its Node 24 legs. The site declares `cookie@2` itself because Verdaccio's Express hoists `cookie@0.7`
  to the root, where Astro's prerender bundle would otherwise resolve it.

## Amendment · 2026-11-20

- The site no longer publishes the ADRs. They explain the design to contributors, not how to use dryfit,
  and they crowded the docs' sidebar next to the guides. They stay in `docs/adr`, where GitHub renders
  them, and the landing page and "How it works" link there. `generate.ts` now writes the CLI reference
  and the menu bar screenshots only.
