using System;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace YonderStatus;

/// <summary>
/// CI 冒烟入口。真实托盘外观在 runner 上无法断言，这里只证明：解析器把真实字段映射成固定文案；
/// 读不到状态时显示“未知”；托盘宿主能在无交互桌面的会话里启动、保持存活并干净退出。
/// 每个检查打印一行 PASS/FAIL 并写入 <c>--log</c> 指定的文件，任一失败以非 0 退出。
/// </summary>
internal static class Check
{
    /// <summary>`--check`：解析器与失败路径的离线自检，不启动托盘。</summary>
    public static int ReadingCapability(string logPath)
    {
        using (var log = new CheckLog(logPath))
        {
            log.Expect(!ActivitySnapshot.Parse("").Known, "empty output is unknown");
            log.Expect(!ActivitySnapshot.Parse("not json").Known, "invalid json is unknown");
            log.Expect(!ActivitySnapshot.Parse("{\"ready\":false,\"agents\":[]}").Known, "not-ready is unknown");
            log.Expect(!ActivitySnapshot.Parse("{\"ready\":true}").Known, "missing agents is unknown");
            log.Expect(
                !ActivitySnapshot.Parse("{\"ready\":true,\"agents\":[{\"tasks\":[{\"state\":7}]}]}").Known,
                "non-string task state is unknown");
            log.Expect(
                ActivitySnapshot.Parse("{\"ready\":true,\"agents\":[{\"tasks\":[{\"state\":\"running\"}]}]}").Running == 1,
                "running task counted");
            var mixed = ActivitySnapshot.Parse(
                "{\"ready\":true,\"agents\":[{\"tasks\":[{\"state\":\"running\"},{\"state\":\"waiting\"}]},{\"tasks\":[]}]}");
            log.Expect(mixed.Known && mixed.Running == 1 && mixed.Waiting == 1, "running and waiting counted together");
            log.Expect(mixed.Title == "服务运行中 · 运行 1 · 等你 1", "title matches the macOS skeleton");
            log.Expect(ActivitySnapshot.Parse("{\"ready\":true,\"agents\":[]}").Title == "服务运行中 · 空闲", "idle title");
            log.Expect(ActivitySnapshot.Unknown.Title == "服务未就绪 · 状态未知", "unknown title");
            log.Expect(
                StatusContext.UpdateResult("{\"current\":\"0.1.0\",\"latest\":\"0.2.0\",\"updateAvailable\":true}")
                == "有新版 0.2.0（仅检查）",
                "update result shows the newer release");
            log.Expect(StatusContext.UpdateResult("{}") == "检查失败：命令没有返回版本", "update result failure text");

            // 缺少安装目录时读取必须失败，状态栏因此显示未知，而不是编造在线。
            var outcome = YonderCommand.Run(
                Path.Combine(Path.GetTempPath(), "yonder-status-missing-" + Guid.NewGuid().ToString("N")),
                Path.GetTempPath(),
                new[] { "service", "info" },
                5000);
            log.Expect(!outcome.Ok, "missing install reports failure");
            log.Line(log.Failures == 0 ? "Passed: reading capability." : "Failed: " + log.Failures + " check(s).");
            return log.Failures == 0 ? 0 : 1;
        }
    }

    /// <summary>`--print-status`：打印真实 CLI 结果与解析出的菜单首行，供 runner 日志核对。</summary>
    public static int PrintStatus(string logPath)
    {
        using (var log = new CheckLog(logPath))
        {
            var install = Program.InstallDirectory();
            var home = Program.HomeDirectory();
            var outcome = YonderCommand.Run(install, home, new[] { "service", "info" }, 20000);
            var snapshot = outcome.Ok ? ActivitySnapshot.Parse(outcome.Stdout) : ActivitySnapshot.Unknown;
            log.Line("install=" + install);
            log.Line("home=" + home);
            log.Line("ok=" + outcome.Ok);
            log.Line("title=" + snapshot.Title);
            log.Line(outcome.Ok ? "stdout=" + outcome.Stdout.Trim() : "reason=" + outcome.Reason);
            return 0;
        }
    }

    /// <summary>
    /// `--smoke`：在没有桌面交互的 runner 会话里启动真实托盘宿主，确认图标已挂上、首行是未知，
    /// 然后走正常退出路径。只断言进程与状态文字——托盘外观不在断言范围。
    /// </summary>
    public static int TraySmoke(string logPath)
    {
        using (var log = new CheckLog(logPath))
        {
            var home = Program.HomeDirectory();
            var install = Program.InstallDirectory();
            var title = "";
            var visible = false;
            var exited = true;
            var thread = new Thread(() =>
            {
                Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
                Application.EnableVisualStyles();
                using (var context = new StatusContext(install, home))
                {
                    // 状态读取在后台线程：留出一次完整命令行往返（失败也要等超时之外的时间）再看首行。
                    var inspect = new System.Windows.Forms.Timer { Interval = 15000 };
                    inspect.Tick += (_, _) =>
                    {
                        inspect.Stop();
                        title = context.StatusTitle;
                        visible = context.TrayVisible;
                        log.Line("tray-visible=" + visible);
                        log.Line("status-title=" + title);
                        context.RequestExitForCheck();
                    };
                    inspect.Start();
                    Application.Run(context);
                    inspect.Dispose();
                }
            });
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            exited = thread.Join(60000);
            if (!exited) log.Line("FAIL tray host did not exit within 60s");
            log.Expect(visible, "tray icon is registered");
            log.Expect(title == "服务未就绪 · 状态未知", "missing service shows unknown in the fixed first line");
            log.Line(log.Failures == 0 ? "Passed: tray smoke." : "Failed: " + log.Failures + " check(s).");
            return log.Failures == 0 ? 0 : 1;
        }
    }
}
