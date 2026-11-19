#!/usr/bin/env bash
# Runs the menu's end-to-end test (EndToEndTests) against a real daemon in a throwaway sandbox:
# a library, a consumer that depends on it, and a devlink home of their own. Touches nothing else.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
cli="$here/../../packages/devlink/dist/devlink.mjs"
[ -f "$cli" ] || { echo "Build the CLI first: npm run build" >&2; exit 1; }

sandbox="$(mktemp -d "${TMPDIR%/}/devlink-e2e.XXXXXX")"
export DEVLINK_HOME="$sandbox/home"
finish() {
  status=$?
  if [ $status -ne 0 ] && [ -f "$DEVLINK_HOME/logs/daemon.log" ]; then
    echo "--- daemon log (last 40 lines) ---" >&2
    tail -40 "$DEVLINK_HOME/logs/daemon.log" >&2
  fi
  node "$cli" daemon stop >/dev/null 2>&1 || true
  rm -rf "$sandbox"
}
trap finish EXIT

mkdir -p "$sandbox/repos/ui" "$sandbox/repos/shop"
cat > "$sandbox/repos/ui/package.json" <<'JSON'
{ "name": "@acme/ui", "version": "1.0.0", "main": "index.js", "scripts": { "build": "node build.js" } }
JSON
cat > "$sandbox/repos/ui/build.js" <<'JS'
const fs = require('node:fs');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/package.json', fs.readFileSync('package.json'));
fs.copyFileSync('index.js', 'dist/index.js');
JS
echo "module.exports = 'v1';" > "$sandbox/repos/ui/index.js"
(cd "$sandbox/repos/ui" && npm run --silent build)
cat > "$sandbox/repos/shop/package.json" <<'JSON'
{ "name": "shop", "version": "1.0.0", "private": true, "dependencies": { "@acme/ui": "file:../ui" } }
JSON
(cd "$sandbox/repos/shop" && npm install --no-audit --no-fund --silent && git init -q && git add -A \
  && git -c user.name=e2e -c user.email=e2e@localhost commit -qm init)

# Ports of its own, so a devlink you already run is left alone.
mkdir -p "$DEVLINK_HOME"
printf '{"roots":["%s"],"ports":{"api":4885,"registry":4884}}\n' "$sandbox/repos" > "$DEVLINK_HOME/config.json"
node "$cli" daemon start >/dev/null
(cd "$sandbox/repos/ui" && node "$cli" add --publish-dir dist --build "node build.js" >/dev/null)
node "$cli" daemon stop >/dev/null   # the test starts it from the menu

cd "$here"
DEVLINK_E2E_CLI="$cli" DEVLINK_E2E_LIBRARY="$sandbox/repos/ui" DEVLINK_E2E_CONSUMER="$sandbox/repos/shop" \
  xcrun swift test --filter EndToEndTests
