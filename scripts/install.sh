#!/bin/sh
# Yonder 一键安装（macOS / Linux）。
#
#   curl -fsSL https://github.com/GoYonderTogether/yonder/releases/latest/download/install.sh | sh
#
# 只取 GitHub 上最新的正式 Release 标签，本机构建后放进安装目录，再交给 `yonder update` 收尾
# （wrapper、current 链接、保留最近三版都由它负责，见 docs/spec/09-cli-release.md §3–§4）。
# 重复执行是幂等的：已安装的版本不会重新构建。
#
# 环境变量：
#   YONDER_INSTALL  安装目录，默认 ~/.local/share/yonder/install
#   YONDER_HOME     数据目录，默认 ~/.local/share/yonder/home
#   YONDER_VERSION  显式指定版本（X.Y.Z 或 vX.Y.Z），默认取最新正式版
#   YONDER_REPO     仓库地址，默认官方仓库
set -eu

REPO="${YONDER_REPO:-https://github.com/GoYonderTogether/yonder.git}"
INSTALL="${YONDER_INSTALL:-$HOME/.local/share/yonder/install}"
HOME_DIR="${YONDER_HOME:-$HOME/.local/share/yonder/home}"
DRY_RUN=0

for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=1 ;;
		--help | -h)
			echo "用法: install.sh [--dry-run]"
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
say "回到网页的「添加设备」→「已有设备」，把提示词发给这台机器上的 Bot 即可完成连接。"
