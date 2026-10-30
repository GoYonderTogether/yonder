# Yonder 一键安装（Windows，PowerShell 5.1 及以上）。
#
#   irm https://github.com/GoYonderTogether/yonder/releases/latest/download/install.ps1 | iex
#
# 只取 GitHub 上最新的正式 Release 标签，本机构建后放进安装目录，再交给 `yonder update` 收尾
# （wrapper、current junction、保留最近三版都由它负责，见 docs/spec/09-cli-release.md §3–§4）。
# 重复执行是幂等的：已安装的版本不会重新构建。
#
# 环境变量：
#   YONDER_INSTALL  安装目录，默认 %LOCALAPPDATA%\YonderHarness\install
#   YONDER_HOME     数据目录，默认 %LOCALAPPDATA%\YonderHarness\home
#   YONDER_VERSION  显式指定版本（X.Y.Z 或 vX.Y.Z），默认取最新正式版
#   YONDER_REPO     仓库地址，默认官方仓库
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'

$Repo = if ($env:YONDER_REPO) { $env:YONDER_REPO } else { 'https://github.com/GoYonderTogether/yonder.git' }
$Install = if ($env:YONDER_INSTALL) { $env:YONDER_INSTALL } else { Join-Path $env:LOCALAPPDATA 'YonderHarness\install' }
$HomeDir = if ($env:YONDER_HOME) { $env:YONDER_HOME } else { Join-Path $env:LOCALAPPDATA 'YonderHarness\home' }

function Say($Message) { Write-Host $Message }
function Die($Message) { Write-Error "安装失败：$Message"; exit 1 }
function Step($Message) { Write-Host "`n== $Message" }

Step '检查环境'
foreach ($tool in @('git', 'npm', 'node')) {
	if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
		Die "缺少 $tool。请先安装 Git（https://git-scm.com）与 Node.js 22.19 或更新版本（https://nodejs.org）。"
	}
}
$NodeVersion = (& node -p 'process.versions.node').Trim()
$NodeMajor = [int]($NodeVersion.Split('.')[0])
if ($NodeMajor -lt 22) { Die "Node.js 版本为 $NodeVersion，需要 22.19 或更新版本。" }
Say "Node.js $NodeVersion"

Step '确定版本'
if ($env:YONDER_VERSION) {
	$Version = $env:YONDER_VERSION -replace '^v', ''
} else {
	$tags = & git ls-remote --tags --refs $Repo 2>$null
	if ($LASTEXITCODE -ne 0 -or -not $tags) {
		Die "无法从 $Repo 读取正式版本标签；请确认网络，或用 YONDER_VERSION 指定版本。"
	}
	$versions = $tags |
		ForEach-Object { ($_ -split 'refs/tags/v')[-1] } |
		Where-Object { $_ -match '^\d+\.\d+\.\d+$' }
	if (-not $versions) { Die "无法从 $Repo 读取正式版本标签。" }
	$Version = ($versions | Sort-Object { [version]$_ })[-1]
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Die "版本号无效：$Version" }
$Tag = "v$Version"
$Dir = Join-Path $Install "versions\$Version"
Say "目标版本 $Tag"
Say "安装目录 $Install"
Say "数据目录 $HomeDir"

if ($DryRun) {
	Step 'dry run：以下步骤不会执行'
	Say "git clone --depth 1 --branch $Tag $Repo $Dir.tmp"
	Say "npm ci && npm run build（在 $Dir.tmp）"
	Say "node $Dir\packages\cli\dist\index.js update --to $Version --repo $Repo"
	Say "$Install\bin\yonder.cmd init $HomeDir --model openai/gpt-6-luna（$HomeDir\yonder.yaml 不存在时）"
	exit 0
}

Step "准备 $Tag"
New-Item -ItemType Directory -Force -Path (Join-Path $Install 'versions') | Out-Null
if (Test-Path $Dir) {
	Say "已安装 $Tag，跳过构建"
} else {
	$Tmp = "$Dir.tmp"
	if (Test-Path $Tmp) { Remove-Item -Recurse -Force $Tmp }
	Say "下载 $Tag"
	& git clone --depth 1 --branch $Tag $Repo $Tmp
	if ($LASTEXITCODE -ne 0) { Die "无法下载 $Tag；请确认网络和 git 凭据。" }
	$built = (& node -p "require('$($Tmp -replace '\\','/')/packages/cli/package.json').version").Trim()
	if ($built -ne $Version) {
		Remove-Item -Recurse -Force $Tmp
		Die "标签 $Tag 的包版本是 $built，与标签不一致。"
	}
	Say '安装依赖并构建（首次通常需要几分钟）'
	Push-Location $Tmp
	try {
		& npm ci --no-audit --no-fund
		if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败' }
		& npm run build
		if ($LASTEXITCODE -ne 0) { throw 'npm run build 失败' }
	} catch {
		Pop-Location
		Remove-Item -Recurse -Force $Tmp
		Die "$($_.Exception.Message)，已清理 $Tmp。"
	}
	$Commit = (& git rev-parse HEAD).Trim()
	Pop-Location
	# 不带 BOM：Windows PowerShell 5.1 的 Set-Content -Encoding utf8 会写入 BOM，Node 的 JSON.parse 会因此失败。
	$record = @{
		repository = $Repo
		tag = $Tag
		commit = $Commit
		version = $Version
	} | ConvertTo-Json
	[System.IO.File]::WriteAllText((Join-Path $Tmp '.yonder-install.json'), $record, (New-Object System.Text.UTF8Encoding($false)))
	Remove-Item -Recurse -Force (Join-Path $Tmp '.git')
	if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
	Move-Item $Tmp $Dir
	Say "已构建 $Tag（$Commit）"
}

Step '写入安装入口'
$env:YONDER_INSTALL = $Install
& node (Join-Path $Dir 'packages\cli\dist\index.js') update --to $Version --repo $Repo
if ($LASTEXITCODE -ne 0) { Die '写入安装入口失败。' }
$YonderCmd = Join-Path $Install 'bin\yonder.cmd'
if (-not (Test-Path $YonderCmd)) { Die "没有生成 $YonderCmd。" }

Step '初始化数据目录'
if (Test-Path (Join-Path $HomeDir 'yonder.yaml')) {
	Say "$HomeDir 已有配置，保持不变"
} else {
	New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
	& $YonderCmd init $HomeDir --model openai/gpt-6-luna
	if ($LASTEXITCODE -ne 0) { Die "初始化 $HomeDir 失败。" }
	Say "已初始化 $HomeDir"
}

Step '完成'
Say "把下面一行加进用户环境变量 PATH 后重开终端："
Say ''
Say "  $Install\bin"
Say ''
Say '然后：'
Say ''
Say '  yonder login openai      # 登录模型供应商'
Say '  yonder service install   # 装成后台任务，登录时自启'
Say '  yonder                   # 进入终端界面'
Say ''
Say '回到网页的「添加设备」→「已有设备」，把提示词发给这台机器上的 Bot 即可完成连接。'
