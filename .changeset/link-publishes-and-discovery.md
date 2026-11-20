---
'@dryfit/cli': patch
---

Linking a library that was never published now builds and publishes it, then installs it into the app,
instead of recording a link that changed nothing; a failed build is reported and leaves the link pending.
Finding apps no longer stops at a folder whose package.json uses none of your libraries (such as a stray
`~/package.json`), and with no project folders configured the daemon searches the folders that hold your
libraries.
