using System;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace YonderStatus;

/// <summary>
/// Windows 常驻状态栏图标。菜单骨架固定（与 spec 09 §6.1 的 macOS 状态栏对齐）：
/// 首行服务状态 → 检查更新 → 停止服务并退出。不列 Agent、会话、任务摘要，不放交互窗口，不发系统通知。
///
/// 状态只来自 `yonder service info --json`（真实控制面），失败一律显示“状态未知”，不读磁盘版本冒充在线。
/// 只有一个状态栏宿主：同 home 用文件锁互斥，与 macOS 的 status-ui.lock 同一位置、同一语义。
/// </summary>
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (Array.IndexOf(args, "--check") >= 0) return Check.ReadingCapability(CheckLogPath());
        if (Array.IndexOf(args, "--print-status") >= 0) return Check.PrintStatus(CheckLogPath());
        if (Array.IndexOf(args, "--smoke") >= 0) return Check.TraySmoke(CheckLogPath());

        var home = HomeDirectory();
        var install = InstallDirectory();
        var lockPath = Path.Combine(home, ".yonder", "status-ui.lock");
        FileStream? single = null;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(lockPath)!);
            // FileShare.None 让第二个实例在打开时直接抛 IOException。
            single = new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        }
        catch (IOException)
        {
            // 另一个状态栏宿主正在运行：不启动第二个。
            return 0;
        }

        using (single)
        {
            Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            using (var context = new StatusContext(install, home))
                Application.Run(context);
        }
        return 0;
    }

    /// <summary>
    /// install 时由自启动任务的启动脚本写入；`service install` 把 --install/--home 存为任务调用的参数，
    /// 用户环境变量缺失时仍落在安装时选定的 home，而不是猜一个默认目录。
    /// </summary>
    internal static string HomeDirectory() =>
        Argument("--home")
        ?? Environment.GetEnvironmentVariable("YONDER_HOME")
        ?? Path.Combine(LocalAppData(), "YonderHarness", "home");

    internal static string InstallDirectory() =>
        Argument("--install")
        ?? Environment.GetEnvironmentVariable("YONDER_INSTALL")
        ?? Path.Combine(LocalAppData(), "YonderHarness", "install");

    private static string LocalAppData() =>
        Environment.GetEnvironmentVariable("LOCALAPPDATA")
        ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "AppData", "Local");

    /// <summary>检查输出同时写进这个文件：WinExe 不保证父控制台可见，CI 用文件说明失败原因。</summary>
    private static string CheckLogPath() =>
        Argument("--log") ?? Path.Combine(Path.GetTempPath(), "yonder-status-check.log");

    private static string? Argument(string name)
    {
        var args = Environment.GetCommandLineArgs();
        for (var index = 1; index < args.Length - 1; index += 1)
            if (args[index] == name && args[index + 1].Length > 0) return args[index + 1];
        return null;
    }
}

internal sealed class StatusContext : ApplicationContext
{
    private const int StatusTimeoutMs = 20000;
    private const int UpdateTimeoutMs = 60000;
    private const int StopTimeoutMs = 120000;

    private readonly string install;
    private readonly string home;
    private readonly NotifyIcon tray = new NotifyIcon();
    private readonly ContextMenuStrip menu = new ContextMenuStrip();
    /// <summary>没有窗口的宿主：只借它的句柄把后台结果送回 UI 线程。</summary>
    private readonly Control dispatcher = new Control();
    private readonly ToolStripMenuItem statusItem = new ToolStripMenuItem("服务未就绪 · 状态未知");
    private readonly ToolStripMenuItem updateItem = new ToolStripMenuItem("检查更新");
    private readonly ToolStripMenuItem quitItem = new ToolStripMenuItem("停止服务并退出");
    private readonly Timer poll = new Timer();
    private Icon? icon;
    private ActivitySnapshot snapshot = ActivitySnapshot.Unknown;
    private string? unknownReason = "正在读取服务状态…";
    private bool busy;
    private bool quitting;
    private bool disposed;
    private int generation;

    public StatusContext(string install, string home)
    {
        this.install = install;
        this.home = home;
        _ = dispatcher.Handle;
        BuildMenu();
        tray.ContextMenuStrip = menu;
        tray.MouseClick += (_, args) =>
        {
            if (args.Button == MouseButtons.Left) ShowMenu();
        };
        Render();
        tray.Visible = true;
        poll.Interval = 5000;
        poll.Tick += (_, _) => Refresh();
        poll.Start();
        Refresh();
    }

    /// <summary>固定骨架：启动后只改文字与可用性，从不增删菜单项（与 macOS 一致）。</summary>
    private void BuildMenu()
    {
        menu.ShowImageMargin = false;
        menu.ShowItemToolTips = true;
        statusItem.Enabled = false;
        updateItem.Click += (_, _) => CheckUpdate();
        quitItem.Click += (_, _) => StopServiceAndExit();
        menu.Items.Add(statusItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(updateItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(quitItem);
    }

    private void ShowMenu()
    {
        // 打开菜单时读取一次权威状态；托盘图标获得焦点后，菜单不会抢走别的窗口的输入。
        Refresh();
        menu.Show(Cursor.Position);
    }

    /// <summary>冒烟检查只读这两个事实：图标已挂上、首行文字是当前状态。</summary>
    internal string StatusTitle => statusItem.Text;

    internal bool TrayVisible => tray.Visible;

    /// <summary>冒烟检查用的正常退出路径：等同于用户选择“停止服务并退出”之后的宿主收尾。</summary>
    internal void RequestExitForCheck()
    {
        quitting = true;
        tray.Visible = false;
        ExitThread();
    }

    private void Refresh()
    {
        if (quitting) return;
        var ticket = ++generation;
        Run(
            () => YonderCommand.Run(install, home, new[] { "service", "info" }, StatusTimeoutMs),
            outcome =>
            {
                if (ticket != generation) return;
                snapshot = outcome.Ok ? ActivitySnapshot.Parse(outcome.Stdout) : ActivitySnapshot.Unknown;
                unknownReason = snapshot.Known
                    ? null
                    : (outcome.Ok ? "命令没有返回可识别的服务状态" : outcome.Reason);
                Render();
            },
        );
    }

    private void Render()
    {
        statusItem.Text = snapshot.Title;
        statusItem.ToolTipText = snapshot.Known ? null : unknownReason ?? "读取不到本机服务状态";
        tray.Text = !snapshot.Known
            ? "Yonder · 运行状态未知"
            : snapshot.Running > 0 ? "Yonder · 任务运行中" : "Yonder · 空闲";
        var next = TrayIcon.Create(snapshot);
        tray.Icon = next;
        // 先换上新图标再释放旧句柄，任务栏不会出现空图标。
        icon?.Dispose();
        icon = next;
        // 更新结果保留到下一次检查（与 macOS 一致）；这里只同步可用性。
        updateItem.Enabled = !busy;
        quitItem.Enabled = !quitting;
    }

    private void CheckUpdate()
    {
        if (busy || quitting) return;
        busy = true;
        updateItem.Enabled = false;
        updateItem.Text = "正在检查更新…";
        Run(
            () => YonderCommand.Run(install, home, new[] { "update", "--check" }, UpdateTimeoutMs),
            outcome =>
            {
                busy = false;
                updateItem.Enabled = true;
                updateItem.Text = outcome.Ok ? UpdateResult(outcome.Stdout) : "检查失败：" + outcome.Reason;
            },
        );
    }

    /// <summary>只查询并显示当前/可用版本；不安装、不改配置、不发消息。</summary>
    internal static string UpdateResult(string json)
    {
        try
        {
            using (var document = System.Text.Json.JsonDocument.Parse(json))
            {
                var root = document.RootElement;
                var current = ReadString(root, "current");
                var latest = ReadString(root, "latest");
                if (current == null || latest == null) return "检查失败：命令没有返回版本";
                var available = root.TryGetProperty("updateAvailable", out var value)
                                && value.ValueKind == System.Text.Json.JsonValueKind.True;
                return available ? "有新版 " + latest + "（仅检查）" : "本机 " + current + " · 正式版 " + latest;
            }
        }
        catch (System.Text.Json.JsonException)
        {
            return "检查失败：命令没有返回有效版本";
        }
    }

    private static string? ReadString(System.Text.Json.JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == System.Text.Json.JsonValueKind.String
            ? value.GetString()
            : null;

    private void StopServiceAndExit()
    {
        if (quitting || busy) return;
        quitting = true;
        busy = true;
        quitItem.Enabled = false;
        quitItem.Text = "正在停止服务…";
        Run(
            () => YonderCommand.Run(install, home, new[] { "service", "stop" }, StopTimeoutMs),
            outcome =>
            {
                busy = false;
                if (outcome.Ok)
                {
                    // 停止成功才退出；保留服务定义、版本与数据，下次登录仍自启。
                    tray.Visible = false;
                    ExitThread();
                    return;
                }
                // 停止失败：显示实际错误并保留图标（与 macOS 一致）。
                quitting = false;
                quitItem.Enabled = true;
                quitItem.Text = "停止服务并退出";
                unknownReason = "停止失败：" + outcome.Reason;
                statusItem.Text = unknownReason;
                statusItem.ToolTipText = unknownReason;
            },
        );
    }

    /// <summary>后台执行 CLI，结果回到 UI 线程；调用方永远拿到一个结果，失败不会静默吞掉。</summary>
    private void Run(Func<CommandOutcome> work, Action<CommandOutcome> done)
    {
        Task.Run(work).ContinueWith(
            task =>
            {
                var outcome = task.Status == TaskStatus.RanToCompletion
                    ? task.Result
                    : CommandOutcome.Failed(task.Exception?.GetBaseException().Message ?? "命令失败");
                if (disposed || dispatcher.IsDisposed || !dispatcher.IsHandleCreated) return;
                try
                {
                    dispatcher.BeginInvoke(new Action(() =>
                    {
                        if (!disposed) done(outcome);
                    }));
                }
                catch (InvalidOperationException)
                {
                    // 句柄已经销毁：进程正在退出，没有要更新的界面。
                }
            },
            TaskScheduler.Default,
        );
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !disposed)
        {
            disposed = true;
            quitting = true;
            poll.Stop();
            poll.Dispose();
            tray.Visible = false;
            tray.Dispose();
            icon?.Dispose();
            menu.Dispose();
            dispatcher.Dispose();
        }
        base.Dispose(disposing);
    }
}
