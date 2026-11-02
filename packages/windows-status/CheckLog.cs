using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace YonderStatus;

/// <summary>
/// 冒烟/自检输出。这个程序是 WinExe（托盘不需要控制台窗口），直接写 Console 在由控制台启动时
/// 看不到任何东西。所以：尽力附加到父控制台，同时把同样的行写进 `--log`（缺省
/// `%TEMP%\yonder-status-check.log`）——CI 用退出码判定，用日志文件说明失败原因。
/// </summary>
internal sealed class CheckLog
{
    private readonly StreamWriter? file;

    public CheckLog(string logPath)
    {
        try
        {
            AttachConsole(-1);
            file = new StreamWriter(logPath, append: false, new UTF8Encoding(false)) { AutoFlush = true };
        }
        catch (Exception)
        {
            file = null;
        }
    }

    public int Failures { get; private set; }

    public void Line(string line)
    {
        Console.WriteLine(line);
        try { file?.WriteLine(line); } catch (Exception) { /* 日志不可写不影响退出码 */ }
    }

    public void Expect(bool condition, string name)
    {
        Line((condition ? "PASS " : "FAIL ") + name);
        if (!condition) Failures += 1;
    }

    public void Dispose()
    {
        try { file?.Dispose(); } catch (Exception) { /* 已关闭 */ }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(int processId);
}
