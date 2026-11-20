# Architecture decision records

Each record captures one decision: the context that forced it, what we chose, and what it costs us.
Records are immutable once accepted. To change a decision, write a new record that supersedes the old one
and update the old one's status line.

| #    | Decision                                                                                   | Status   |
| ---- | ------------------------------------------------------------------------------------------ | -------- |
| 0001 | [Record architecture decisions](0001-record-architecture-decisions.md)                     | Accepted |
| 0002 | [Embedded Verdaccio as the local registry](0002-embedded-verdaccio.md)                     | Accepted |
| 0003 | [A daemon with thin clients](0003-daemon-with-thin-clients.md)                             | Accepted |
| 0004 | [Dev version scheme](0004-dev-version-scheme.md)                                           | Accepted |
| 0005 | [Opt-in links, snapshots and restore](0005-links-snapshots-restore.md)                     | Accepted |
| 0006 | [Package manager adapters](0006-package-manager-adapters.md)                               | Accepted |
| 0007 | [Consumer integrations for cache invalidation](0007-consumer-integrations.md)              | Accepted |
| 0008 | [Repository layout and tooling](0008-repository-layout-and-tooling.md)                     | Accepted |
| 0009 | [Testing strategy](0009-testing-strategy.md)                                               | Accepted |
| 0010 | [Native menu bar app](0010-native-menu-bar-app.md)                                         | Accepted |
| 0011 | [Project website](0011-project-website.md)                                                 | Accepted |
| 0012 | [Daemon runtime, API contract and CLI](0012-daemon-runtime-api-and-cli.md)                 | Accepted |
| 0013 | [Menu bar app structure and API contract](0013-menu-bar-app-structure-and-api-contract.md) | Accepted |
| 0014 | [Libraries that pin each other](0014-libraries-that-pin-each-other.md)                     | Accepted |

Template: Status, Context, Decision, Consequences. Keep each under a page.
