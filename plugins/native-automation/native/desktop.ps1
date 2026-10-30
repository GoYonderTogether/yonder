$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$env:PSModulePath = Join-Path $PSHOME Modules
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms, System.Drawing, UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class YonderDesktop {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint f,bool i,uint a);
  [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr d);
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint n, INPUT[] data,int size);
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int x,y; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT m; [FieldOffset(0)] public KEYBDINPUT k; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  public static bool Interactive() { var d=OpenInputDesktop(0,false,1); if(d==IntPtr.Zero)return false; CloseDesktop(d); return Environment.UserInteractive; }
  public static void Key(ushort key,bool up) { Send(new INPUT {type=1,u=new UNION {k=new KEYBDINPUT {vk=key,flags=up?2u:0u}}}); }
  public static void Text(string text) { foreach(char c in text) { Send(new INPUT {type=1,u=new UNION {k=new KEYBDINPUT {scan=c,flags=4}}}); Send(new INPUT {type=1,u=new UNION {k=new KEYBDINPUT {scan=c,flags=6}}}); } }
  public static void Mouse(bool right,bool up) { Send(new INPUT {type=0,u=new UNION {m=new MOUSEINPUT {flags=right?(up?16u:8u):(up?4u:2u)}}}); }
  static void Send(INPUT input) { if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(INPUT)))!=1)throw new InvalidOperationException("SendInput rejected; observe current desktop/UIPI before repeating"); }
}
'@
[void][YonderDesktop]::SetProcessDPIAware()
$interactive = [YonderDesktop]::Interactive()
function Metadata($item) {
    @{ name=$item.Name; type=$(if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){'symlink'}elseif($item.PSIsContainer){'directory'}else{'file'}); size=$(if($item.PSIsContainer){$null}else{$item.Length}); creationDate=$item.CreationTimeUtc.ToString('o'); modificationDate=$item.LastWriteTimeUtc.ToString('o') }
}
function AbsolutePath([string]$path) {
    if (!$path -or ![IO.Path]::IsPathRooted($path) -or $path.Contains([char]0) -or ($path -split '[\\/]') -contains '..') { throw 'Expected absolute path without NUL or ..' }
    return [IO.Path]::GetFullPath($path)
}
function Permission([string]$kind) {
    @{ kind=$kind; state='unobservable'; lastCheckedAt=[DateTime]::UtcNow.ToString('o'); responsibleIdentity=@{path=(Get-Process -Id $PID).Path; sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; pid=$PID}; nextStep='Windows has no equivalent global macOS TCC grant. Actual operations are checked by Windows ACL/UIPI and the active desktop; status does not grant access.'; raw=@{interactiveDesktop=$interactive} }
}
$kinds = @('accessibility','screen-recording','input-monitoring','camera','microphone','notifications','automation','full-disk-access','files-and-folders')
switch ($request.action) {
    {$_ -in 'status','permissions'} {
        $result = @{ platform='win32'; screenCapture=$interactive; interactiveDesktop=$interactive; coordinateSpace='physical desktop pixels'; permissions=@($kinds | ForEach-Object { Permission $_ }) }
    }
    {$_ -in 'permission-request','permission-guide','permission-watch'} {
        if ($request.kind -notin $kinds) { throw 'Invalid permission kind' }
        $permission = Permission $request.kind
        $settings = @{camera='ms-settings:privacy-webcam'; microphone='ms-settings:privacy-microphone'; notifications='ms-settings:notifications'; 'files-and-folders'='ms-settings:privacy-broadfilesystemaccess'}
        $opened = $false
        if ($request.action -ne 'permission-watch' -and $settings.ContainsKey($request.kind)) {
            Start-Process $settings[$request.kind]
            $permission.lastRequestedAt = [DateTime]::UtcNow.ToString('o')
            $opened = $true
        }
        $result = @{ outcome='unobservable'; permission=$permission; settingsOpened=$opened; exitCode=1 }
    }
    'file-list' {
        $path = AbsolutePath $request.path
        $item = Get-Item -LiteralPath $path -Force
        if (!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Source must be a real directory' }
        $result = @{path=$path; entries=@(Get-ChildItem -LiteralPath $path -Force | ForEach-Object { Metadata $_ })}
    }
    'file-export' {
        $path = AbsolutePath $request.path
        $target = AbsolutePath $request.destination
        $item = Get-Item -LiteralPath $path -Force
        if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Source must be a regular file, not a symlink' }
        [IO.File]::Copy($path,$target,$false)
        $result = @{path=$target; size=$item.Length; metadata=(Metadata $item)}
    }
    'snapshot' {
        if (!$interactive) { throw 'No interactive desktop available' }
        $root = [Windows.Automation.AutomationElement]::FromHandle([YonderDesktop]::GetForegroundWindow())
        $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
        $nodes = [Collections.Generic.List[object]]::new()
        $errors = [Collections.Generic.List[string]]::new()
        $queue = [Collections.Generic.Queue[object]]::new()
        $queue.Enqueue(@($root,0))
        while ($queue.Count -gt 0 -and $nodes.Count -lt 500) {
            $entry=$queue.Dequeue(); $node=$entry[0]; $depth=$entry[1]
            try {
                $c=$node.Current; $r=$c.BoundingRectangle
                $nodes.Add(@{name=$c.Name; role=$c.ControlType.ProgrammaticName; automationId=$c.AutomationId; enabled=$c.IsEnabled; bounds=@{x=$r.X;y=$r.Y;width=$r.Width;height=$r.Height};depth=$depth})
                if ($depth -lt 8) { $child=$walker.GetFirstChild($node); while($child){$queue.Enqueue(@($child,($depth+1)));$child=$walker.GetNextSibling($child)} }
            } catch { $errors.Add($_.Exception.Message) }
        }
        $result=@{nodes=$nodes.ToArray();truncated=($queue.Count -gt 0);errors=$errors.ToArray();coordinateSpace='physical desktop pixels'}
    }
    'screenshot' {
        if (!$interactive) { throw 'No interactive desktop available' }
        $path=AbsolutePath $request.path
        $bounds=[Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bitmap=[Drawing.Bitmap]::new($bounds.Width,$bounds.Height)
        $graphics=[Drawing.Graphics]::FromImage($bitmap)
        try { $graphics.CopyFromScreen($bounds.Location,[Drawing.Point]::Empty,$bounds.Size);$bitmap.Save($path,[Drawing.Imaging.ImageFormat]::Png) }
        finally {$graphics.Dispose();$bitmap.Dispose()}
        $result=@{path=$path;bounds=@{x=$bounds.X;y=$bounds.Y;width=$bounds.Width;height=$bounds.Height};coordinateSpace='physical desktop pixels'}
    }
    {$_ -in 'move','click','drag','type','key'} {
        if (!$interactive) { throw 'No interactive desktop available' }
        $mods=@{ 'command down'=91; 'control down'=17; 'option down'=18; 'shift down'=16 }
        $pressed=[Collections.Generic.List[int]]::new()
        try {
            foreach($modifier in $request.modifiers) { if(!$mods.ContainsKey($modifier)){throw 'Invalid modifier'};[YonderDesktop]::Key($mods[$modifier],$false);$pressed.Add($mods[$modifier]) }
            if($request.action -eq 'type') { [YonderDesktop]::Text($request.text) }
            elseif($request.action -eq 'key') { [YonderDesktop]::Key($request.keyCode,$false);[YonderDesktop]::Key($request.keyCode,$true) }
            else {
                if(![YonderDesktop]::SetCursorPos($request.x,$request.y)){throw 'Pointer move rejected'}
                if($request.action -ne 'move') {
                    $right=$request.button -eq 'right'
                    [YonderDesktop]::Mouse($right,$false)
                    try { if($request.action -eq 'drag'){Start-Sleep -Milliseconds 100;if(![YonderDesktop]::SetCursorPos($request.toX,$request.toY)){throw 'Pointer drag rejected'}} }
                    finally { [YonderDesktop]::Mouse($right,$true) }
                }
            }
        } finally { for($i=$pressed.Count-1;$i -ge 0;$i--){[YonderDesktop]::Key($pressed[$i],$true)} }
        $result=@{completed=$true;action=$request.action;coordinateSpace='physical desktop pixels'}
    }
    default { throw 'Unknown desktop action' }
}
$result | ConvertTo-Json -Depth 12 -Compress
