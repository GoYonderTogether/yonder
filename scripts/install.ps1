# Yonder 一键安装（Windows，PowerShell 5.1 及以上）。
#
#   irm https://github.com/GoYonderTogether/yonder/releases/latest/download/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://github.com/GoYonderTogether/yonder/releases/latest/download/install.ps1))) -Desktop
#
# 只取 GitHub 上最新的正式 Release 标签，本机构建后放进安装目录，再交给 `yonder update` 收尾
# （wrapper、current junction、保留最近三版都由它负责，见 docs/spec/09-cli-release.md §3–§4）。
# 重复执行是幂等的：已安装的版本不会重新构建。
#
# -Desktop 在核心装好之后，再静默安装同版本的桌面应用，并把核心装成后台登录任务；
# 不带时只装核心，桌面应用与后台服务仍由脚本打印的下一步手动完成。
#
# 环境变量：
#   YONDER_INSTALL       安装目录，默认 %LOCALAPPDATA%\YonderHarness\install
#   YONDER_HOME          数据目录，默认 %LOCALAPPDATA%\YonderHarness\home
#   YONDER_VERSION       显式指定版本（X.Y.Z 或 vX.Y.Z），默认取最新正式版
#   YONDER_REPO          仓库地址，默认官方仓库
#   YONDER_DESKTOP_URL   显式指定桌面安装包地址，默认取同一 Release 的 setup.exe
param([switch]$DryRun, [switch]$Desktop)

$ErrorActionPreference = 'Stop'

$Repo = if ($env:YONDER_REPO) { $env:YONDER_REPO } else { 'https://github.com/GoYonderTogether/yonder.git' }
$Install = if ($env:YONDER_INSTALL) { $env:YONDER_INSTALL } else { Join-Path $env:LOCALAPPDATA 'YonderHarness\install' }
$HomeDir = if ($env:YONDER_HOME) { $env:YONDER_HOME } else { Join-Path $env:LOCALAPPDATA 'YonderHarness\home' }
$Releases = 'https://github.com/GoYonderTogether/yonder/releases/download'

function Say($Message) { Write-Host $Message }
function Die($Message) { Write-Error "安装失败：$Message"; exit 1 }
function Step($Message) { Write-Host "`n== $Message" }

# 桌面安装包与 desktop-release.yml 的产物命名一致：Yonder_<version>_x64-setup.exe（Tauri 2 默认）。
function Install-Desktop {
	$arch = if ($env:PROCESSOR_ARCHITECTURE) { $env:PROCESSOR_ARCHITECTURE } else { 'unknown' }
	if ($arch -ne 'AMD64') {
		Die "桌面应用目前只发布 Windows x64 安装包（当前架构 $arch）。不加 -Desktop 可只装核心。"
	}
	$Url = if ($env:YONDER_DESKTOP_URL) { $env:YONDER_DESKTOP_URL } else { "$Releases/v$Version/Yonder_${Version}_x64-setup.exe" }
	Say "桌面安装包 $Url"
	$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("yonder-desktop-" + [guid]::NewGuid().ToString('N'))
	New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
	try {
		$Setup = Join-Path $TempDir 'Yonder-setup.exe'
		Say '下载桌面应用'
		if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
			& curl.exe -fL --retry 3 --retry-delay 2 -o $Setup $Url
			if ($LASTEXITCODE -ne 0) { Die "无法下载 $Url" }
		} else {
			[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
			Invoke-WebRequest -Uri $Url -OutFile $Setup -UseBasicParsing
		}
		if (-not (Test-Path $Setup)) { Die "无法下载 $Url" }
		# 关闭正在运行的桌面应用，让安装器能替换文件；核心服务不受影响。
		Get-Process -Name Yonder -ErrorAction SilentlyContinue | Stop-Process -Force
		Say '静默安装桌面应用'
		$process = Start-Process -FilePath $Setup -ArgumentList '/S' -Wait -PassThru
		if ($process.ExitCode -ne 0) { Die "桌面应用安装器退出码 $($process.ExitCode)。" }
	} finally {
		Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
	}
	Say '已安装桌面应用'
}

Step '检查环境'
foreach ($tool in @('git', 'npm.cmd', 'node')) {
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
	Say "git clone --depth 1 --branch $Tag $Repo $Dir"
	Say "npm ci && npm run build（在 $Dir）"
	Say "node $Dir\packages\cli\dist\index.js update --to $Version --repo $Repo"
	Say "$Install\bin\yonder.cmd init $HomeDir --model openai/gpt-6-luna（$HomeDir\yonder.yaml 不存在时）"
	if ($Desktop) {
		Say '下载并静默安装桌面应用（Yonder_<version>_x64-setup.exe /S）'
		Say "$Install\bin\yonder.cmd service install --home $HomeDir"
	}
	exit 0
}

Step "准备 $Tag"
New-Item -ItemType Directory -Force -Path (Join-Path $Install 'versions') | Out-Null
# npm installs workspace packages as junctions whose targets are absolute paths. Renaming the build directory
# afterwards would leave every `node_modules/@yonder/*` junction dangling, so build in the final location and
# treat the install record as the "done" marker: an interrupted build is rebuilt on the next run.
$RecordPath = Join-Path $Dir '.yonder-install.json'
if (Test-Path $RecordPath) {
	Say "已安装 $Tag，跳过构建"
} else {
	if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
	Say "下载 $Tag"
	& git clone --depth 1 --branch $Tag $Repo $Dir
	if ($LASTEXITCODE -ne 0) {
		if (Test-Path $Dir) { Remove-Item -Recurse -Force $Dir }
		Die "无法下载 $Tag；请确认网络和 git 凭据。"
	}
	$built = (& node -p "require('$($Dir -replace '\\','/')/packages/cli/package.json').version").Trim()
	if ($built -ne $Version) {
		Remove-Item -Recurse -Force $Dir
		Die "标签 $Tag 的包版本是 $built，与标签不一致。"
	}
	Say '安装依赖并构建（首次通常需要几分钟）'
	Push-Location $Dir
	try {
		# npm.ps1 reparses "& npm" as "pm" in npm 10.9.3; use the Windows command shim.
		& npm.cmd ci --no-audit --no-fund
		if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败' }
		& npm.cmd run build
		if ($LASTEXITCODE -ne 0) { throw 'npm run build 失败' }
		$Commit = (& git rev-parse HEAD).Trim()
	} catch {
		Pop-Location
		Remove-Item -Recurse -Force $Dir
		Die "$($_.Exception.Message)，已清理 $Dir。"
	}
	Pop-Location
	# 不带 BOM：Windows PowerShell 5.1 的 Set-Content -Encoding utf8 会写入 BOM，Node 的 JSON.parse 会因此失败。
	# PowerShell 变量名不区分大小写：这里不能用 $record，否则会覆盖上面的 $RecordPath。
	$recordJson = @{
		repository = $Repo
		tag = $Tag
		commit = $Commit
		version = $Version
	} | ConvertTo-Json
	[System.IO.File]::WriteAllText($RecordPath, $recordJson, (New-Object System.Text.UTF8Encoding($false)))
	Remove-Item -Recurse -Force (Join-Path $Dir '.git')
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
if ($Desktop) {
	Step '安装桌面应用'
	Install-Desktop
	Step '装成后台任务'
	# 关掉桌面窗口后核心仍在运行；这是「关掉桌面应用就等于只装了核心」的前提。
	& $YonderCmd service install --home $HomeDir
	if ($LASTEXITCODE -ne 0) { Die '装成后台任务失败；可稍后手动运行 yonder service install。' }
	Say '核心已作为后台任务运行，关闭桌面应用不会停止它'
	Say '桌面应用在开始菜单里的 Yonder；本机核心不可用时它会回落到 https://yonderbot.net/'
	Say ''
	Say '还没登录模型供应商的话，先运行：'
	Say ''
	Say "  $YonderCmd login openai"
} else {
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
	Say '想要桌面应用：重新运行本脚本并加上 -Desktop，它会装好桌面应用并把核心装成后台任务：'
	Say ''
	Say '  & ([scriptblock]::Create((irm https://github.com/GoYonderTogether/yonder/releases/latest/download/install.ps1))) -Desktop'
}
Say ''
Say '回到网页的「添加设备」→「已有设备」，把提示词发给这台机器上的 Bot 即可完成连接。'
