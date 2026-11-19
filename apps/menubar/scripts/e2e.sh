#!/usr/bin/env bash
# Runs the menu's end-to-end test (EndToEndTests) against a real daemon in a throwaway sandbox:
# a library, a consumer that depends on it, and a dryfit home of their own. Touches nothing else.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
cli="$here/../../packages/dryfit/dist/dryfit.mjs"
[ -f "$cli" ] || { echo "Build the CLI first: npm run build" >&2; exit 1; }

sandbox="$(mktemp -d "${TMPDIR%/}/dryfit-e2e.XXXXXX")"
export DRYFIT_HOME="$sandbox/home"
touch "$sandbox/started"
finish() {
  status=$?
  if [ $status -ne 0 ] && [ -f "$DRYFIT_HOME/logs/daemon.log" ]; then
    echo "--- daemon log (last 40 lines) ---" >&2
    tail -40 "$DRYFIT_HOME/logs/daemon.log" >&2
  fi
  # A crash in the test process leaves only "signal code N" above; macOS's report has the stack.
  if [ $status -ne 0 ]; then
    find "$HOME/Library/Logs/DiagnosticReports" -name '*.ips' -newer "$sandbox/started" 2>/dev/null |
      while read -r report; do
        echo "--- crash report: $report ---" >&2
        python3 -c '
import json, sys
text = open(sys.argv[1]).read()
body = json.loads(text[text.index("\n") + 1:])
images = body.get("usedImages", [])
thread = body["threads"][body.get("faultingThread", 0)]
for frame in thread.get("frames", [])[:40]:
    image = images[frame["imageIndex"]].get("name", "?") if frame.get("imageIndex", -1) < len(images) else "?"
    symbol = frame.get("symbol") or hex(frame.get("imageOffset", 0))
    print(f"{image:32} {symbol}")
' "$report" >&2 || head -c 4000 "$report" >&2
      done
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

# Ports of its own, so a dryfit you already run is left alone.
mkdir -p "$DRYFIT_HOME"
printf '{"roots":["%s"],"ports":{"api":%s,"registry":%s}}\n' "$sandbox/repos" \
  "${DRYFIT_E2E_API_PORT:-4885}" "${DRYFIT_E2E_REGISTRY_PORT:-4884}" > "$DRYFIT_HOME/config.json"
node "$cli" daemon start >/dev/null
(cd "$sandbox/repos/ui" && node "$cli" add --publish-dir dist --build "node build.js" >/dev/null)
node "$cli" daemon stop >/dev/null   # the test starts it from the menu

cd "$here"
export DRYFIT_E2E_CLI="$cli" DRYFIT_E2E_LIBRARY="$sandbox/repos/ui" DRYFIT_E2E_CONSUMER="$sandbox/repos/shop"
if ! xcrun swift test --filter EndToEndTests; then
  # In CI, run it again under lldb: a crash in the test process otherwise leaves no stack at all.
  if [ -n "${CI:-}" ]; then
    helper="$(dirname "$(xcrun --find swift)")/../libexec/swift/pm/swiftpm-testing-helper"
    # One bundle for the package (Xcode 26), or one per test target (Xcode 27).
    bin="$(xcrun swift build --show-bin-path)"
    bundle="$bin/DryfitMenuBarPackageTests.xctest/Contents/MacOS/DryfitMenuBarPackageTests"
    [ -f "$bundle" ] || bundle="$bin/DryfitMenuTests.xctest/Contents/MacOS/DryfitMenuTests"
    node "$cli" daemon stop >/dev/null 2>&1 || true   # the test starts from offline
    platform="$(xcrun --show-sdk-platform-path)/Developer"
    echo "--- the test again, under lldb ---" >&2
    xcrun lldb --batch \
      -o "settings set target.env-vars DYLD_FRAMEWORK_PATH=$platform/Library/Frameworks DYLD_LIBRARY_PATH=$platform/usr/lib" \
      -o run -k "thread backtrace all" -k quit -- \
      "$helper" --test-bundle-path "$bundle" --filter EndToEndTests "$bundle" --testing-library swift-testing >&2 || true
  fi
  exit 1
fi
