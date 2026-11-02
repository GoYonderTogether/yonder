using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace YonderStatus;

/// <summary>
/// 只读调用已安装的 `yonder` CLI，不自行实现控制面协议。
///
/// 为什么走 CLI 而不是直接连命名管道：管道名由 core 按规范化 home 的 sha256 派生，
/// 协议是一行 JSON 一问一答，两者都是内核内部约定。照 macOS 状态栏的做法调用安装 bin 下的入口，
/// 状态栏就永远与 CLI 看到同一个 home、同一个端点、同一份 `service.info` 字段，不复制实现。
/// Windows 没有可执行位的 shell 脚本，`yonder.cmd` 只能经 cmd.exe 启动，所以命令行走
/// `cmd /d /s /c ""<yonder.cmd>" …"`（与 service-windows.ts 注册任务时相同的形状）；
/// 用户数据（home）只经环境变量进入命令行，安装路径里不允许引号或换行。
/// </summary>
internal static class YonderCommand
{
    public static string Executable(string install) => Path.Combine(install, "bin", "yonder.cmd");

    /// <summary>运行 `yonder <arguments> --json`，返回退出码与输出；失败或超时都只返回结果，由调用方显示未知。</summary>
    public static CommandOutcome Run(string install, string home, string[] arguments, int timeoutMs)
    {
        var executable = Executable(install);
        // 与 status-windows.ts 的启动脚本同一套限制：这些字符会改变 cmd 的解析，不猜引用方式。
        if (executable.IndexOf('"') >= 0 || executable.IndexOf('%') >= 0 || executable.IndexOf('^') >= 0
            || executable.IndexOf('&') >= 0 || executable.IndexOf('|') >= 0 || executable.IndexOf('<') >= 0
            || executable.IndexOf('>') >= 0 || executable.IndexOf('\r') >= 0 || executable.IndexOf('\n') >= 0)
            return CommandOutcome.Failed("安装路径含 cmd 特殊字符");
        if (!File.Exists(executable)) return CommandOutcome.Failed("找不到 " + executable);

        // 外层引号让 cmd /c 把整条命令当一个 token：`""<path>" <args>"` 的写法与 service-windows.ts
        // 注册服务任务时一致。安装路径已在上面拒绝引号、换行；参数只来自本程序的固定字面量。
        var line = new StringBuilder();
        line.Append("/d /s /c \"\"");
        line.Append(executable);
        line.Append('"');
        foreach (var argument in arguments)
        {
            line.Append(' ');
            line.Append(argument);
        }
        // home 走环境变量：cmd 在引号内展开时保留空格，也不会把值里的 % 当成变量。
        line.Append(" --home \"%YONDER_HOME%\" --json\"");

        var start = new ProcessStartInfo("cmd.exe")
        {
            Arguments = line.ToString(),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            // home 可能还没建好（服务从未成功启动过）；那时用临时目录，读取仍会如实失败。
            WorkingDirectory = Directory.Exists(home) ? home : Path.GetTempPath(),
        };
        start.Environment["YONDER_HOME"] = home;
        start.Environment["YONDER_INSTALL"] = install;
        try
        {
            using (var process = Process.Start(start))
            {
                if (process == null) return CommandOutcome.Failed("无法启动 cmd.exe");
                var output = process.StandardOutput.ReadToEndAsync();
                var error = process.StandardError.ReadToEndAsync();
                if (!process.WaitForExit(timeoutMs))
                {
                    try { process.Kill(true); } catch (Exception) { /* 已经退出 */ }
                    return CommandOutcome.Failed("命令超时");
                }
                // 读取在超时等待之后才收尾：管道里可能还有未取走的内容。
                var stdout = output.GetAwaiter().GetResult();
                var stderr = error.GetAwaiter().GetResult();
                return new CommandOutcome(process.ExitCode == 0, stdout, stderr, null);
            }
        }
        catch (Exception exception)
        {
            return CommandOutcome.Failed(exception.Message);
        }
    }
}

internal sealed class CommandOutcome
{
    internal CommandOutcome(bool ok, string stdout, string stderr, string? failure)
    {
        Ok = ok;
        Stdout = stdout;
        Stderr = stderr;
        Failure = failure;
    }

    public bool Ok { get; }

    public string Stdout { get; }

    public string Stderr { get; }

    /// <summary>本地失败原因（启动失败、超时）；与 CLI 自己的 stderr 分开保存。</summary>
    public string? Failure { get; }

    public static CommandOutcome Failed(string reason) => new CommandOutcome(false, "", "", reason);

    /// <summary>单行、给菜单与 tooltip 用的失败原因，先 CLI stderr 再本地原因。</summary>
    public string Reason
    {
        get
        {
            var text = Stderr.Trim();
            if (text.Length == 0) text = Failure ?? "命令没有返回状态";
            var line = text.Split('\n')[0].Trim();
            return line.Length == 0 ? "命令没有返回状态" : line;
        }
    }
}
