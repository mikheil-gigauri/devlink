#!/usr/bin/env bash
# The M5 exit check, rehearsed: someone who has never seen devlink runs it with npx from the packed
# package, in a home folder of their own, and gets a library's change into an app and back out again.
#
#   scripts/newcomer.sh [path/to/devlink-x.y.z.tgz]
#
# Without a tarball it builds and packs packages/devlink. It touches nothing outside a temporary
# folder: HOME, the npm cache and devlink's home all live there. Set DEVLINK_PORTS=api,registry to
# avoid the default ports when a devlink is already running on this machine.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
sandbox="$(mktemp -d "${TMPDIR:-/tmp}/devlink-newcomer.XXXXXX")"
sandbox="${sandbox%/}"

tarball="${1:-}"
if [ -z "$tarball" ]; then
  (cd "$repo" && npm run build --silent -w devlink >/dev/null)
  tarball="$(cd "$repo/packages/devlink" && npm pack --silent --pack-destination "$sandbox" | tail -1)"
  tarball="$sandbox/$tarball"
fi
tarball="$(cd "$(dirname "$tarball")" && pwd)/$(basename "$tarball")"

export HOME="$sandbox/home"
export npm_config_cache="$sandbox/npm-cache"
export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
code="$HOME/code"
devlink() { npx --yes --package="$tarball" devlink "$@"; }

finish() {
  status=$?
  if [ $status -ne 0 ]; then
    echo "--- newcomer check failed; daemon log (last 40 lines) ---" >&2
    tail -40 "$HOME/.devlink/logs/daemon.log" 2>/dev/null >&2 || true
  fi
  (cd "$code/ui" 2>/dev/null && devlink daemon stop >/dev/null 2>&1) || true
  rm -rf "$sandbox"
}
trap finish EXIT
step() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
fail() { echo "✗ $*" >&2; exit 1; }

step "A library and an app that uses it"
mkdir -p "$code/ui" "$code/shop"
cat > "$code/ui/package.json" <<'JSON'
{ "name": "@acme/ui", "version": "1.0.0", "main": "index.js" }
JSON
echo "module.exports = 'release';" > "$code/ui/index.js"
# The released 1.0.0 as a tarball, standing in for a registry the app installs from.
mkdir -p "$code/releases"
(cd "$code/ui" && npm pack --silent --pack-destination "$code/releases" >/dev/null)
cat > "$code/shop/package.json" <<'JSON'
{ "name": "shop", "version": "1.0.0", "private": true, "dependencies": { "@acme/ui": "file:../releases/acme-ui-1.0.0.tgz" } }
JSON
(cd "$code/shop" && npm install --silent && git init -q && git add -A \
  && git -c user.name=newcomer -c user.email=newcomer@localhost commit -qm init)
before_manifest="$(cat "$code/shop/package.json")"
before_lockfile="$(cat "$code/shop/package-lock.json")"

if [ -n "${DEVLINK_PORTS:-}" ]; then
  mkdir -p "$HOME/.devlink"
  printf '{"roots":[],"ports":{"api":%s,"registry":%s}}\n' "${DEVLINK_PORTS%,*}" "${DEVLINK_PORTS#*,}" \
    > "$HOME/.devlink/config.json"
fi

cd "$code/ui"
step "npx devlink init"
devlink init
step "npx devlink add"
devlink add
step "npx devlink consumers"
devlink consumers | tee "$sandbox/consumers.txt"
grep -q shop "$sandbox/consumers.txt" || fail "consumers did not find shop"
step "npx devlink link ../shop"
devlink link ../shop
step "Edit the library, then npx devlink sync"
echo "module.exports = 'edited';" > index.js
devlink sync
got="$(cd "$code/shop" && node -p "require('@acme/ui')")"
[ "$got" = edited ] || fail "shop runs '$got', not the edit"
echo "✓ shop runs the edited library"

step "A commit of the linked app is refused"
if (cd "$code/shop" && git add -A && git -c user.name=n -c user.email=n@localhost commit -qm linked 2>/dev/null); then
  fail "the commit guard let a dev build through"
fi
(cd "$code/shop" && git reset -q)
echo "✓ refused"

step "npx devlink restore --all"
devlink restore --all
[ "$(cat "$code/shop/package.json")" = "$before_manifest" ] || fail "package.json differs after restore"
[ "$(cat "$code/shop/package-lock.json")" = "$before_lockfile" ] || fail "package-lock.json differs after restore"
version="$(cd "$code/shop" && node -p "require('@acme/ui/package.json').version")"
[ "$version" = 1.0.0 ] || fail "shop still has $version installed"
echo "✓ shop is back as it was"

devlink daemon stop >/dev/null
printf '\n\033[1;32m✓ newcomer check passed\033[0m\n'
