#!/bin/bash
# iOS 真机开发安装：构建 Yonder 正式壳（Tauri v2，bundle net.yonderbot.app）并安装到本地配对的 iPhone，然后启动。
# 用途：本地高频迭代，替代 TestFlight 分发。不提交、不上传、不触发任何远程流程。
#
# 用法：
#   scripts/ios-device.sh                # 默认 origin https://yonder.zethai.cn
#   scripts/ios-device.sh <origin>       # 指定壳内打开的站点（编译期注入 YONDER_MOBILE_ORIGIN）
#   ORIGIN=... scripts/ios-device.sh     # 同上，环境变量形式
#   CONFIGURATION=Release scripts/ios-device.sh   # 默认 Debug
#   DEVICE=<UDID或名称> scripts/ios-device.sh     # 指定目标真机（默认自动选第一台在线真机）
#
# 连接方式：支持有线或同一 WiFi 下的局域网连接（Xcode 15+ 配对后默认开启
# "Connect via network"）。拔线验证：手机与 Mac 同一 WiFi、解锁手机，
# `xcrun devicectl list devices` 显示 available (paired) 即可直接跑本脚本。
#
# 前置（一次性）：
#   - iPhone 已配对（数据线连 Mac，手机上点"信任此电脑"），并开启开发者模式
#     （设置 → 隐私与安全性 → 开发者模式）。
#   - Xcode 已登录 Apple ID（团队 D4UZU32UN9，与 CI 的 IOS_TEAM_ID 一致），
#     自动签名会自动为该设备生成 Apple Development profile（-allowProvisioningUpdates）。
#
# 签名方式：apps/desktop/prepare-ios.mjs 生成的是 Manual + iPhone Distribution（App Store 用），
# 本脚本在生成工程后把签名改成 Automatic + Apple Development，仅为本地真机构建，不回写仓库文件
# （gen/ 目录不入库）。团队 ID 用 CI 同款 D4UZU32UN9。
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="$REPO/apps/desktop"
ORIGIN="${1:-${ORIGIN:-https://yonder.zethai.cn}}"
CONFIGURATION="${CONFIGURATION:-Debug}"
TEAM_ID="${IOS_TEAM_ID:-D4UZU32UN9}"   # 与 CI ios-release.yml 的 IOS_TEAM_ID secret 一致
# 与 TestFlight 同一身份：装上后覆盖手机上的正式版。显示名经 CFBundleDisplayName 写入。
BUNDLE_ID="net.yonderbot.app"
DISPLAY_NAME="Yonder"
PROJECT="$APP_DIR/src-tauri/gen/apple/yonder-desktop.xcodeproj"

log() { printf '\033[1;34m[ios-device]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[ios-device] 错误:\033[0m %s\n' "$*" >&2; exit 1; }

# 1. 找一台在线（有线或局域网）的真实设备（跳过 simulated）
DEFAULT_UDID="00008150-0006488426F2401C"   # Zoran的 17pro
log "查找在线的真机…"
list="$(xcrun devicectl list devices 2>/dev/null || true)"
select_row() {
	printf '%s\n' "$list" | grep '(UDID)' | grep -v 'simulated' \
		| grep -E 'available|connected' | head -1
}
# 匹配在线真机：DEVICE 指定时按 UDID 或名称子串匹配，否则留给后面回退逻辑
row="$(printf '%s\n' "$list" | grep '(UDID)' | grep -v 'simulated' | grep -E 'available|connected' \
	| awk -v want="${DEVICE:-}" 'want == "" || index($0, want) > 0 { print; exit }')"
# DEVICE 显式指定但未匹配时直接报错退出（退出码 3），不做兜底选择
if [ -n "${DEVICE:-}" ] && [ -z "${row:-}" ]; then
	printf '\033[1;31m[ios-device] 错误:\033[0m 指定的设备 %s 不在线（state 需为 available/connected）。\n运行 xcrun devicectl list devices 检查状态。\n' "$DEVICE" >&2
	exit 3
fi
# DEVICE 未设置时回退：优先默认 UDID，否则第一台在线真机
if [ -z "${row:-}" ]; then
	row="$(printf '%s\n' "$list" | grep '(UDID)' | grep -v 'simulated' | grep " ${DEFAULT_UDID} " || true)"
	[ -n "$row" ] || row="$(select_row)"
fi
row="${row:-$(select_row)}"
[ -n "$row" ] || { printf '\033[1;31m[ios-device] 错误:\033[0m 没有在线的真机（state 需为 available/connected）。\n请确认：手机已解锁、与 Mac 在同一 WiFi（或插线）、已信任此电脑且开发者模式已开。\n运行 xcrun devicectl list devices 检查状态；或用 DEVICE=<UDID或名称> 指定设备。\n' >&2; exit 3; }
DEVICE_UDID="$(printf '%s' "$row" | sed -E 's/.*[^0-9A-F-]([0-9A-F-]{20,}) \(UDID\).*/\1/')"
DEVICE_NAME="$(printf '%s' "$row" | sed -E 's/[[:space:]]*[0-9A-F-]{20,} \(UDID\).*//')"
TRANSPORT="$(xcrun devicectl device info details --device "$DEVICE_UDID" 2>/dev/null | sed -n 's/.*Transport Type: *//p' | head -1)"
[ -n "${TRANSPORT:-}" ] || TRANSPORT="unknown"
case "$TRANSPORT" in
	wired) TRANSPORT_DESC="有线连接" ;;
	localNetwork) TRANSPORT_DESC="局域网（WiFi）连接" ;;
	*) TRANSPORT_DESC="连接方式: $TRANSPORT" ;;
esac
log "目标设备: $DEVICE_NAME ($DEVICE_UDID)，$TRANSPORT_DESC"

# 2. 每次重新生成 iOS 工程（gen/ 不入库）。生成工程里写死了 identifier，
#    所以每次都删掉重 init，用 --config 临时 JSON 写入同一个 identifier。
TMP_CONFIG="$(mktemp /tmp/yonder-ios-config.XXXXXX.json)"
trap 'rm -f "$TMP_CONFIG"' EXIT
printf '{\n  "identifier": "%s"\n}\n' "$BUNDLE_ID" > "$TMP_CONFIG"
[ -x "$APP_DIR/node_modules/.bin/tauri" ] || (cd "$APP_DIR" && npm ci --no-audit --no-fund)
rm -rf "$APP_DIR/src-tauri/gen/apple"
log "初始化 iOS 工程（tauri ios init，identifier=${BUNDLE_ID}）…"
(cd "$APP_DIR" && ./node_modules/.bin/tauri ios init --ci --config "$TMP_CONFIG")
# Xcode 的 Build Rust Code 阶段在 gen/apple 下执行 `node tauri ios xcode-script`，
# 需要该目录存在 tauri CLI 入口（gen/ 不入库，链接指向 workspace 安装的 CLI）。
ln -sf "$APP_DIR/node_modules/@tauri-apps/cli/tauri.js" "$APP_DIR/src-tauri/gen/apple/tauri"
# 桌面显示名：identifier-only 覆盖不影响 productName，但生成的 Info.plist 没有
# CFBundleDisplayName；通过 project.yml 的 info.properties 加上后用 xcodegen 重新生成工程。
apple_dir="$APP_DIR/src-tauri/gen/apple"
sed -i '' -e 's/^        CFBundleShortVersionString:/        CFBundleDisplayName: '"$DISPLAY_NAME"'\n        CFBundleShortVersionString:/' \
	"$apple_dir/project.yml"
(cd "$apple_dir" && xcodegen generate)
node "$APP_DIR/prepare-ios.mjs"   # 重放图标等仓库约定设置
# 本地真机签名：改回 Automatic + Apple Development（prepare-ios.mjs 默认写的是分发配置）
pbx="$PROJECT/project.pbxproj"
sed -i '' -e 's/CODE_SIGN_IDENTITY = "iPhone Distribution";/CODE_SIGN_IDENTITY = "Apple Development";/' "$pbx"
sed -i '' -e 's/CODE_SIGN_STYLE = Manual;/CODE_SIGN_STYLE = Automatic;/' "$pbx"
sed -i '' -e '/PROVISIONING_PROFILE_SPECIFIER/d' "$pbx"
log "已切换为自动签名（团队 ${TEAM_ID}），bundle id=${BUNDLE_ID}，显示名=${DISPLAY_NAME}"

# 3. 构建（origin 与 CI 的 MOBILE_ORIGIN 机制一致：编译期 option_env!）
# 注：gen 工程的 Build Rust Code 阶段要求由 `tauri ios build/dev` 进程驱动
# （读取 gen/apple/.tauri/cli-options-server.json），所以不能裸跑 xcodebuild。
log "构建 (origin=$ORIGIN)…"
export YONDER_MOBILE_ORIGIN="$ORIGIN"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app}"
# PATH 上可能是 Homebrew 的 cargo（无 rust-toolchain.toml 支持、无 iOS std）。
# 优先使用 rustup 的、与 rust-toolchain.toml 钉住版本一致的工具链。
RUST_CHANNEL="$(sed -n 's/^channel *= *\"\([^\"]*\)\".*/\1/p' "$APP_DIR/rust-toolchain.toml" 2>/dev/null | head -1)"
for host in aarch64-apple-darwin x86_64-apple-darwin; do
	[ -d "$HOME/.rustup/toolchains/${RUST_CHANNEL}-${host}/bin" ] && \
		export PATH="$HOME/.rustup/toolchains/${RUST_CHANNEL}-${host}/bin:$PATH" && break
done
cargo --version
(cd "$APP_DIR" && ./node_modules/.bin/tauri ios build --ci --target aarch64 \
	--export-method debugging --config "$TMP_CONFIG") || die "tauri ios build 失败。常见原因：Xcode 未登录 Apple ID（设置→Accounts）、证书缺失（security find-identity -v -p codesigning）、iOS Rust target 未装（rustup target add aarch64-apple-ios --toolchain <钉住的版本>）。"

APP_PATH="$(find "$APP_DIR/src-tauri/gen/apple/build" -name '*.app' -path '*Applications*' 2>/dev/null | head -1)"
[ -n "$APP_PATH" ] || APP_PATH="$(find "$APP_DIR/src-tauri/gen/apple/build" -name '*.app' 2>/dev/null | head -1)"
[ -n "$APP_PATH" ] || die "构建完成但找不到 .app"
log "产物: $APP_PATH"

# 4. 安装并启动
log "安装到设备…"
xcrun devicectl device install app --device "$DEVICE_UDID" "$APP_PATH" || die "安装失败（检查手机是否解锁、是否信任此电脑）。"
log "启动 ${BUNDLE_ID}…"
xcrun devicectl device process launch --device "$DEVICE_UDID" "$BUNDLE_ID" \
	|| die "启动失败（可手动点开 App；首启动可能需要在手机上确认开发者证书：设置→通用→VPN与设备管理）。"
# 收尾：构建不应改动入库文件（gen/ 不入库）；有改动只列出，不自动还原，免得覆盖手上未提交的工作。
dirty="$(git -C "$REPO" status --porcelain --untracked-files=no)"
[ -z "$dirty" ] || { log "注意：工作区有未提交改动（可能来自构建，也可能是你手上的工作）："; printf '%s\n' "$dirty"; }
log "完成 ✔ 打开的站点: $ORIGIN"
