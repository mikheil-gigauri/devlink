#!/usr/bin/env bash
# The M5 exit check, rehearsed: someone who has never seen dryfit runs it with npx from the packed
# package, in a home folder of their own, and gets a library's change into an app and back out again.
#
#   scripts/newcomer.sh [path/to/dryfit-x.y.z.tgz]
#
# Without a tarball it builds and packs packages/dryfit. It touches nothing outside a temporary
# folder: HOME, the npm cache and dryfit's home all live there. Set DRYFIT_PORTS=api,registry to
# avoid the default ports when a dryfit is already running on this machine.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
sandbox="$(mktemp -d "${TMPDIR:-/tmp}/dryfit-newcomer.XXXXXX")"
sandbox="${sandbox%/}"

tarball="${1:-}"
if [ -z "$tarball" ]; then
  (cd "$repo" && npm run build --silent -w @dryfit/cli >/dev/null)
  tarball="$(cd "$repo/packages/dryfit" && npm pack --silent --pack-destination "$sandbox" | tail -1)"
  tarball="$sandbox/$tarball"
fi
tarball="$(cd "$(dirname "$tarball")" && pwd)/$(basename "$tarball")"

export HOME="$sandbox/home"
export npm_config_cache="$sandbox/npm-cache"
export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false
code="$HOME/code"
dryfit() { npx --yes --package="$tarball" dryfit "$@"; }

finish() {
  status=$?
  if [ $status -ne 0 ]; then
    echo "--- newcomer check failed; daemon log (last 40 lines) ---" >&2
    tail -40 "$HOME/.dryfit/logs/daemon.log" 2>/dev/null >&2 || true
  fi
  (cd "$code/ui" 2>/dev/null && dryfit daemon stop >/dev/null 2>&1) || true
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

if [ -n "${DRYFIT_PORTS:-}" ]; then
  mkdir -p "$HOME/.dryfit"
  printf '{"roots":[],"ports":{"api":%s,"registry":%s}}\n' "${DRYFIT_PORTS%,*}" "${DRYFIT_PORTS#*,}" \
    > "$HOME/.dryfit/config.json"
fi

cd "$code/ui"
step "npx @dryfit/cli init"
dryfit init
step "npx @dryfit/cli add"
dryfit add
step "npx @dryfit/cli consumers"
dryfit consumers | tee "$sandbox/consumers.txt"
grep -q shop "$sandbox/consumers.txt" || fail "consumers did not find shop"
step "npx @dryfit/cli link ../shop"
dryfit link ../shop
step "Edit the library, then npx @dryfit/cli sync"
echo "module.exports = 'edited';" > index.js
dryfit sync
got="$(cd "$code/shop" && node -p "require('@acme/ui')")"
[ "$got" = edited ] || fail "shop runs '$got', not the edit"
echo "✓ shop runs the edited library"

step "A commit of the linked app is refused"
if (cd "$code/shop" && git add -A && git -c user.name=n -c user.email=n@localhost commit -qm linked 2>/dev/null); then
  fail "the commit guard let a dev build through"
fi
(cd "$code/shop" && git reset -q)
echo "✓ refused"

step "npx @dryfit/cli restore --all"
dryfit restore --all
[ "$(cat "$code/shop/package.json")" = "$before_manifest" ] || fail "package.json differs after restore"
[ "$(cat "$code/shop/package-lock.json")" = "$before_lockfile" ] || fail "package-lock.json differs after restore"
version="$(cd "$code/shop" && node -p "require('@acme/ui/package.json').version")"
[ "$version" = 1.0.0 ] || fail "shop still has $version installed"
echo "✓ shop is back as it was"

dryfit daemon stop >/dev/null
printf '\n\033[1;32m✓ newcomer check passed\033[0m\n'
