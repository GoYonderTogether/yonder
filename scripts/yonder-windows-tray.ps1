# Loaded by the service runner with a base64 JSON $config; no model-supplied commands.
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$env:PSModulePath=Join-Path $PSHOME Modules
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$identity=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($config.home)).Replace('/','_').Replace('+','-')
$mutex=[Threading.Mutex]::new($false,"Local\YonderTray-$identity")
if(!$mutex.WaitOne(0)){exit 0}
function Cli([string[]]$Arguments) {
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=$config.node
    $all=@($config.cli)+$Arguments+@('--home',$config.home,'--json')
    # Standard Windows argv quoting, including trailing backslashes and quotes.
    $start.Arguments=($all | ForEach-Object {'"'+([regex]::Replace($_,'(\\*)"','$1$1\"') -replace '(\\+)$','$1$1')+'"'}) -join ' '
    $start.UseShellExecute=$false;$start.CreateNoWindow=$true
    $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
    $p=[Diagnostics.Process]::Start($start)
    try {
        $read=$p.StandardOutput.ReadToEndAsync();$errorRead=$p.StandardError.ReadToEndAsync()
        if(!$p.WaitForExit(10000)){$p.Kill();throw 'CLI timeout; outcome unknown'}
        if($p.ExitCode -ne 0){throw $errorRead.Result}
        return ($read.Result | ConvertFrom-Json)
    } finally {$p.Dispose()}
}
$icon=[Windows.Forms.NotifyIcon]::new()
$icon.Icon=[Drawing.SystemIcons]::Application
$icon.Text='Yonder · 正在读取状态'
$menu=[Windows.Forms.ContextMenuStrip]::new()
$status=$menu.Items.Add('正在读取运行状态…');$status.Enabled=$false
$activity=[Windows.Forms.ToolStripMenuItem]::new('Agent 运行概览')
[void]$menu.Items.Add($activity)
$overview=[Windows.Forms.Form]::new();$overview.Text='Yonder · 运行概览';$overview.Size=[Drawing.Size]::new(440,400);$overview.TopMost=$true
$text=[Windows.Forms.TextBox]::new();$text.Multiline=$true;$text.ReadOnly=$true;$text.Dock='Fill';$text.ScrollBars='Vertical';$overview.Controls.Add($text)
$overview.Add_FormClosing({param($sender,$event);if($event.CloseReason -eq 'UserClosing'){$event.Cancel=$true;$sender.Hide()}})
$ball=[Windows.Forms.Form]::new();$ball.Text='Yonder';$ball.FormBorderStyle='None';$ball.Size=[Drawing.Size]::new(48,48);$ball.TopMost=$true;$ball.ShowInTaskbar=$false
$button=[Windows.Forms.Button]::new();$button.Text='Y';$button.Dock='Fill';$button.AccessibleName='Yonder 运行概览';$ball.Controls.Add($button)
$ball.StartPosition='Manual';$area=[Windows.Forms.Screen]::PrimaryScreen.WorkingArea;$ball.Location=[Drawing.Point]::new(($area.Right-70),($area.Bottom-90))
$button.Add_Click({$overview.Show();$overview.Activate()})
$activity.Add_Click({$overview.Show();$overview.Activate()})
$pin=[Windows.Forms.ToolStripMenuItem]::new('固定桌面入口');$pin.CheckOnClick=$true
$pin.Add_CheckedChanged({if($pin.Checked){$ball.Show()}else{$ball.Hide()}});[void]$menu.Items.Add($pin)
function Companion {
    $file=Join-Path $config.home '.yonder/plugins/ui-companion/desktop.json'
    $endpoint=[IO.File]::ReadAllText($file) | ConvertFrom-Json
    $uri=[Uri]$endpoint.url
    if($uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1' -or $uri.Port -lt 1 -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -notmatch '^/[0-9a-f-]{36}/$'){throw 'Invalid local companion endpoint'}
    [void](Get-Process -Id $endpoint.pid -ErrorAction Stop)
    Start-Process $uri.AbsoluteUri
}
$open=$menu.Items.Add('打开交互与历史');$open.Add_Click({try{Companion}catch{$status.Text='交互插件未就绪'}})
[void]$menu.Items.Add([Windows.Forms.ToolStripSeparator]::new())
$awake=[Windows.Forms.ToolStripMenuItem]::new('保持唤醒');[void]$menu.Items.Add($awake)
foreach($mode in @('off','tasks','always')) {
    $entry=[Windows.Forms.ToolStripMenuItem]::new(@{off='关闭';tasks='任务期间';always='始终保持唤醒'}[$mode]);$entry.Tag=$mode
    $entry.Add_Click({param($sender);try{[void](Cli -Arguments @('awake','set',$sender.Tag))}catch{$status.Text=$_.Exception.Message}})
    [void]$awake.DropDownItems.Add($entry)
}
$update=$menu.Items.Add('检查更新');$update.Add_Click({try{$r=Cli -Arguments @('update','--check');$status.Text="当前 $($r.current) · 最新 $($r.latest)"}catch{$status.Text='检查更新失败'}})
$quit=$menu.Items.Add('停止服务并退出');$quit.Add_Click({try{[void](Cli -Arguments @('stop'));[Windows.Forms.Application]::Exit()}catch{$status.Text='停止服务失败'}})
$icon.ContextMenuStrip=$menu
# Both buttons open the same menu, matching the macOS status host.
$icon.Add_MouseClick({param($sender,$event);if($event.Button -eq 'Left'){$menu.Show([Windows.Forms.Cursor]::Position)}})
$timer=[Windows.Forms.Timer]::new();$timer.Interval=3000
$timer.Add_Tick({
    try {
        $info=Cli -Arguments @('service','info')
        if(!$info.ready){throw 'Service is not ready'}
        $status.Text="服务运行中 · $($info.version)"
        $icon.Text=$(if($info.active -gt 0){'Yonder · 任务运行中'}else{'Yonder · 空闲'})
        $lines=[Collections.Generic.List[string]]::new()
        foreach($agent in $info.agents){
            $lines.Add("$($agent.name) · $($agent.state)")
            foreach($task in $agent.tasks){$lines.Add("  $($task.summary) · $($task.detail)");if($task.text){$lines.Add([string]$task.text)}}
        }
        $text.Text=$lines -join "`r`n"
    } catch {$status.Text='服务未就绪 · 运行状态未知';$icon.Text='Yonder · 状态未知'}
})
try {
    $icon.Visible=$true;$timer.Start()
    if($config.receipt){[IO.File]::WriteAllText($config.receipt,(@{pid=$PID;started=$true} | ConvertTo-Json -Compress))}
    [Windows.Forms.Application]::Run()
} finally {$timer.Stop();$timer.Dispose();$icon.Visible=$false;$icon.Dispose();$overview.Dispose();$ball.Dispose();$mutex.ReleaseMutex();$mutex.Dispose()}
