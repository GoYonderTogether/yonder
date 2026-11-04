#!/usr/bin/env bash
# release-demo.sh — 一键发布：部署 Web demo 到服务器 + 安装 Yonder Demo 到已配对 iPhone + 线上可用性检查。
#
# 用法:
#   scripts/release-demo.sh
#
# 步骤:
#   1) scripts/deploy-demo.sh   构建 apps/app 前端并原子部署到 demo 服务器
#   2) scripts/ios-device.sh    构建并安装 Yonder Demo (net.yonderbot.app.demo) 到已配对 iPhone
#                               （退出码 3 = iPhone 不在线，打印提示跳过，不算失败）
#   3) curl 检查 https://demo.zethai.cn/ （绑定 en0、解析到 47.98.126.143）必须返回 200
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$REPO_DIR/scripts/deploy-demo.sh"

set +e
"$REPO_DIR/scripts/ios-device.sh"
IOS_STATUS=$?
set -e
if [[ $IOS_STATUS -eq 3 ]]; then
  echo "iPhone 不在线，跳过安装"
elif [[ $IOS_STATUS -ne 0 ]]; then
  exit "$IOS_STATUS"
fi

HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --interface en0 --resolve demo.zethai.cn:443:47.98.126.143 https://demo.zethai.cn/)"
if [[ "$HTTP_CODE" != 200 ]]; then
  echo "错误: https://demo.zethai.cn/ 返回 $HTTP_CODE，预期 200" >&2
  exit 1
fi
echo "https://demo.zethai.cn/ 返回 200，发布完成"
