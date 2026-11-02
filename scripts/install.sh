#!/bin/sh
# Yonder 一键安装（macOS / Linux）。
#
#   curl -fsSL https://github.com/GoYonderTogether/yonder/releases/latest/download/install.sh | sh
#   curl -fsSL https://github.com/GoYonderTogether/yonder/releases/latest/download/install.sh | sh -s -- --desktop
#
# 只取 GitHub 上最新的正式 Release 标签，本机构建后放进安装目录，再交给 `yonder update` 收尾
# （wrapper、current 链接、保留最近三版都由它负责，见 docs/spec/09-cli-release.md §3–§4）。
# 重复执行是幂等的：已安装的版本不会重新构建。
#
# `--desktop` 在核心装好之后，再把同版本的桌面应用装进 /Applications，并把核心装成后台服务；
# 不带时只装核心，桌面应用与后台服务仍由脚本打印的下一步手动完成。
#
# 环境变量：
#   YONDER_INSTALL       安装目录，默认 ~/.local/share/yonder/install
#   YONDER_HOME          数据目录，默认 ~/.local/share/yonder/home
#   YONDER_VERSION       显式指定版本（X.Y.Z 或 vX.Y.Z），默认取最新正式版
#   YONDER_REPO          仓库地址，默认官方仓库
#   YONDER_DESKTOP_URL   显式指定桌面安装包地址，默认取同一 Release 的 dmg
set -eu

REPO="${YONDER_REPO:-https://github.com/GoYonderTogether/yonder.git}"
INSTALL="${YONDER_INSTALL:-$HOME/.local/share/yonder/install}"
HOME_DIR="${YONDER_HOME:-$HOME/.local/share/yonder/home}"
RELEASES="https://github.com/GoYonderTogether/yonder/releases/download"
DRY_RUN=0
WANT_DESKTOP=0

for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=1 ;;
		--desktop) WANT_DESKTOP=1 ;;
		--help | -h)
			echo "用法: install.sh [--desktop] [--dry-run]"
			exit 0
			;;
		*)
			echo "未知参数: $arg" >&2
			exit 2
			;;
	esac
done

say() { printf '%s\n' "$*"; }
die() {
	printf '安装失败：%s\n' "$*" >&2
	exit 1
}
step() { printf '\n== %s\n' "$*"; }

CLOUD="https://yonderbot.net/"

# 桌面安装包与 desktop-release.yml 的产物命名一致：Yonder_<version>_<arch>.dmg（Tauri 2 默认）。
desktop_url() {
	# 只发布 macOS arm64 桌面包；Intel 与 Linux 没有产物，明确拒绝而不是给一个 404 地址。
	case "$(uname -s):$(uname -m)" in
		Darwin:arm64) DESKTOP_ARCH="aarch64" ;;
		*)
			die "桌面应用目前只发布 macOS（Apple Silicon）与 Windows x64 安装包；这台机器（$(uname -s) $(uname -m)）没有桌面包。不加 --desktop 可只装核心。"
			;;
	esac
	DESKTOP_URL="${YONDER_DESKTOP_URL:-$RELEASES/v$VERSION/Yonder_${VERSION}_${DESKTOP_ARCH}.dmg}"
	say "桌面安装包 $DESKTOP_URL"
}

# 挂载 dmg → 拷到 /Applications。已存在时先退出旧进程再整体替换，避免把正在运行的 .app 写到一半。
install_desktop() {
	desktop_url
	TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/yonder-desktop.XXXXXX")" || die "无法创建临时目录。"
	MOUNT="$TMP_DIR/mnt"
	DMG="$TMP_DIR/desktop.dmg"
	unmount() {
		[ -n "${MOUNTED:-}" ] || return 0
		if command -v diskutil >/dev/null 2>&1; then
			diskutil eject "$MOUNT" >/dev/null 2>&1 && return 0
		fi
		hdiutil detach "$MOUNT" >/dev/null 2>&1 || true
	}
	cleanup() {
		unmount
		rm -rf "$TMP_DIR"
	}
	trap cleanup EXIT INT TERM
	say "下载桌面应用"
	curl -fL --retry 3 --retry-delay 2 -o "$DMG" "$DESKTOP_URL" || die "无法下载 $DESKTOP_URL"
	mkdir -p "$MOUNT"
	# 新版 macOS 推荐 diskutil image attach（hdiutil 已弃用），旧版只有 hdiutil attach。
	if diskutil image attach --mountOptions nobrowse --readOnly --mountPoint "$MOUNT" "$DMG" >/dev/null 2>&1 ||
		hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MOUNT" >/dev/null 2>&1; then
		MOUNTED=1
	fi
	[ "${MOUNTED:-}" = 1 ] || die "无法挂载桌面安装包。"
	APP_SRC="$MOUNT/Yonder.app"
	[ -d "$APP_SRC" ] || die "安装包里没有 Yonder.app。"
	APP_DST="/Applications/Yonder.app"
	if [ -d "$APP_DST" ]; then
		say "已安装旧版本，先退出 Yonder"
		osascript -e 'tell application "Yonder" to quit' >/dev/null 2>&1 || true
		for _ in 1 2 3 4 5 6 7 8 9 10; do
			pgrep -x Yonder >/dev/null 2>&1 || break
			sleep 0.5
		done
		pkill -x Yonder >/dev/null 2>&1 || true
		rm -rf "$APP_DST" || die "无法删除旧的 $APP_DST（可能需要管理员权限）。"
	fi
	ditto "$APP_SRC" "$APP_DST" || die "无法写入 $APP_DST（可能需要管理员权限）。"
	# CI 用 ad-hoc 签名、不公证；去掉隔离标记后同一用户的 GUI 应用不会触发 Gatekeeper 二次确认。
	xattr -dr com.apple.quarantine "$APP_DST" >/dev/null 2>&1 || true
	# 卸载与临时目录清理留给 EXIT trap（成功与失败都走同一条路径）。
	say "已安装 $APP_DST"
}

need() {
	command -v "$1" >/dev/null 2>&1 || die "缺少 $1。$2"
}

step "检查环境"
need git "请先安装 git（macOS: xcode-select --install；Debian/Ubuntu: apt install git）。"
need npm "请先安装 Node.js 22.19 或更新版本（https://nodejs.org）。"
need node "请先安装 Node.js 22.19 或更新版本（https://nodejs.org）。"
NODE_VERSION="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_VERSION%%.*}"
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js 版本为 $NODE_VERSION，需要 22.19 或更新版本。"
say "Node.js $NODE_VERSION"

step "确定版本"
if [ -n "${YONDER_VERSION:-}" ]; then
	VERSION="${YONDER_VERSION#v}"
else
	TAGS="$(git ls-remote --tags --refs "$REPO" 2>/dev/null | sed 's#.*refs/tags/v##' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' || true)"
	[ -n "$TAGS" ] || die "无法从 $REPO 读取正式版本标签；请确认网络，或用 YONDER_VERSION 指定版本。"
	VERSION="$(printf '%s\n' "$TAGS" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)"
fi
case "$VERSION" in
	[0-9]*.[0-9]*.[0-9]*) ;;
	*) die "版本号无效：$VERSION" ;;
esac
TAG="v$VERSION"
DIR="$INSTALL/versions/$VERSION"
say "目标版本 $TAG"
say "安装目录 $INSTALL"
say "数据目录 $HOME_DIR"

if [ "$DRY_RUN" = 1 ]; then
	step "dry run：以下步骤不会执行"
	say "git clone --depth 1 --branch $TAG $REPO $DIR.tmp"
	say "npm ci && npm run build（在 $DIR.tmp）"
	say "node $DIR/packages/cli/dist/index.js update --to $VERSION --repo $REPO"
	say "$INSTALL/bin/yonder init $HOME_DIR --model openai/gpt-6-luna（$HOME_DIR/yonder.yaml 不存在时）"
	if [ "$WANT_DESKTOP" = 1 ]; then
		desktop_url
		say "curl -fL -o <临时目录>/desktop.dmg $DESKTOP_URL"
		say "挂载 dmg，把 Yonder.app 拷到 /Applications/Yonder.app（已存在则先退出旧进程）"
		say "$INSTALL/bin/yonder service install --home $HOME_DIR"
	fi
	exit 0
fi

step "准备 $TAG"
mkdir -p "$INSTALL/versions"
if [ -d "$DIR" ]; then
	say "已安装 $TAG，跳过构建"
else
	TMP="$DIR.tmp"
	rm -rf "$TMP"
	say "下载 $TAG"
	git clone --depth 1 --branch "$TAG" "$REPO" "$TMP" >/dev/null 2>&1 ||
		die "无法下载 $TAG；请确认网络和 git 凭据。"
	BUILT_VERSION="$(node -p "require('$TMP/packages/cli/package.json').version" 2>/dev/null || true)"
	[ "$BUILT_VERSION" = "$VERSION" ] || die "标签 $TAG 的包版本是 ${BUILT_VERSION:-未知}，与标签不一致。"
	say "安装依赖并构建（首次通常需要几分钟）"
	(cd "$TMP" && npm ci --no-audit --no-fund && npm run build) || {
		rm -rf "$TMP"
		die "构建失败，已清理 $TMP。"
	}
	COMMIT="$(cd "$TMP" && git rev-parse HEAD)"
	cat >"$TMP/.yonder-install.json" <<JSON
{
  "repository": "$REPO",
  "tag": "$TAG",
  "commit": "$COMMIT",
  "version": "$VERSION"
}
JSON
	rm -rf "$TMP/.git"
	rm -rf "$DIR"
	mv "$TMP" "$DIR"
	say "已构建 $TAG（$COMMIT）"
fi

step "写入安装入口"
YONDER_INSTALL="$INSTALL" node "$DIR/packages/cli/dist/index.js" update --to "$VERSION" --repo "$REPO" ||
	die "写入安装入口失败。"
[ -x "$INSTALL/bin/yonder" ] || die "没有生成 $INSTALL/bin/yonder。"

step "初始化数据目录"
if [ -f "$HOME_DIR/yonder.yaml" ]; then
	say "$HOME_DIR 已有配置，保持不变"
else
	mkdir -p "$HOME_DIR"
	"$INSTALL/bin/yonder" init "$HOME_DIR" --model openai/gpt-6-luna || die "初始化 $HOME_DIR 失败。"
	say "已初始化 $HOME_DIR"
fi

step "完成"
if [ "$WANT_DESKTOP" = 1 ]; then
	step "安装桌面应用"
	install_desktop
	step "装成后台服务"
	# 关掉桌面窗口后核心仍在运行（状态栏图标也还在）；这是「关掉桌面应用就等于只装了核心」的前提。
	"$INSTALL/bin/yonder" service install --home "$HOME_DIR" || die "装成后台服务失败；可稍后手动运行 yonder service install。"
	say "核心已作为后台服务运行，关闭桌面应用不会停止它"
	say "桌面应用在「应用程序」里的 Yonder；本机核心不可用时它会回落到 $CLOUD"
	say ""
	say "还没登录模型供应商的话，先运行："
	say ""
	say "  $INSTALL/bin/yonder login openai"
else
	say "把下面一行加进 shell 配置（~/.zshrc 或 ~/.bashrc）后重开终端："
	say ""
	say "  export PATH=\"$INSTALL/bin:\$PATH\""
	say ""
	say "然后："
	say ""
	say "  yonder login openai      # 登录模型供应商"
	say "  yonder service install   # 装成后台服务，开机自启"
	say "  yonder                   # 进入终端界面"
	say ""
	say "想要桌面应用：重新运行本脚本并加上 --desktop，它会装好桌面应用并把核心装成后台服务："
	say ""
	say "  curl -fsSL https://github.com/GoYonderTogether/yonder/releases/latest/download/install.sh | sh -s -- --desktop"
	say ""
fi
say "回到网页的「添加设备」→「已有设备」，把提示词发给这台机器上的 Bot 即可完成连接。"
