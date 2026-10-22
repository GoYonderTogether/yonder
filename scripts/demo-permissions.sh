#!/bin/bash
# Research-only bundle. Never installs, edits TCC, or starts the Yonder service.
set -euo pipefail
if [[ $# -eq 0 ]]; then set -- status; fi
case "$*" in
  status|"guide accessibility"|"guide screen-recording"|"guide input-monitoring"|"guide full-disk-access") ;;
  *) echo 'Usage: demo-permissions.sh [status | guide accessibility|screen-recording|input-monitoring|full-disk-access]' >&2; exit 2 ;;
esac
[[ $(uname -s) == Darwin ]] || { echo 'Requires macOS' >&2; exit 1; }
repo=$(cd "$(dirname "$0")/.." && pwd)
package="$repo/docs/research/mac-permission-demo"
scratch=$(mktemp -d /private/tmp/yonder-permission-demo.XXXXXX)
swift build --package-path "$package" --scratch-path "$scratch/build" -j 4 >&2
bin=$(swift build --package-path "$package" --scratch-path "$scratch/build" --show-bin-path)
contents="$scratch/PermissionDemo.app/Contents"
mkdir -p "$contents/MacOS" "$contents/Resources"
cp "$bin/PermissionDemo" "$contents/MacOS/PermissionDemo"
shopt -s nullglob
for resource in "$bin"/*.bundle; do cp -R "$resource" "$contents/Resources/"; done
cat > "$contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>PermissionDemo</string>
<key>CFBundleIdentifier</key><string>dev.yonder.research.permissions</string>
<key>CFBundleName</key><string>Permission Research Demo</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$scratch/PermissionDemo.app" >&2
echo "Research bundle retained at $scratch/PermissionDemo.app (not installed)" >&2
exec "$contents/MacOS/PermissionDemo" "$@"
