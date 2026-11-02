using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows.Forms;
using Microsoft.Win32;

namespace YonderStatus;

/// <summary>
/// 托盘图标：品牌 mark + 右下角状态点。
///
/// 状态只有三种，和菜单首行一致：运行中（实心点）、空闲（无点）、未知（空心点）。
/// mark 用仓库里的 brand 资源；深色任务栏用白色，浅色任务栏用墨色（与系统主题一致）。
/// 找不到图片时退化成纯色圆点，不改变任何状态判定。
/// </summary>
internal static class TrayIcon
{
    public static Icon Create(ActivitySnapshot snapshot)
    {
        var size = Math.Max(16, SystemInformation.SmallIconSize.Width);
        using (var bitmap = new Bitmap(size, size))
        {
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.SmoothingMode = SmoothingMode.AntiAlias;
                graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
                graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
                graphics.Clear(Color.Transparent);
                DrawMark(graphics, size);
                if (!snapshot.Known) DrawDot(graphics, size, Color.FromArgb(220, 196, 64), hollow: true);
                else if (snapshot.Running > 0) DrawDot(graphics, size, Color.FromArgb(46, 168, 79), hollow: false);
            }
            // Icon.FromHandle 不接管句柄，复制一份并销毁原句柄，避免每次刷新泄漏 GDI 对象。
            var handle = bitmap.GetHicon();
            try
            {
                using (var temporary = Icon.FromHandle(handle))
                    return (Icon)temporary.Clone();
            }
            finally
            {
                NativeMethods.DestroyIcon(handle);
            }
        }
    }

    private static void DrawMark(Graphics graphics, int size)
    {
        using (var mark = LoadMark())
        {
            if (mark != null)
            {
                graphics.DrawImage(mark, new Rectangle(0, 0, size, size));
                return;
            }
        }
        using (var brush = new SolidBrush(SystemInformation.HighContrast ? SystemColors.WindowText : Color.White))
            graphics.FillEllipse(brush, 2, 2, size - 4, size - 4);
    }

    private static Bitmap? LoadMark()
    {
        try
        {
            var light = SystemUsesLightTheme();
            var path = Path.Combine(AppContext.BaseDirectory, light ? "yonder-mark.png" : "yonder-mark-white.png");
            if (!File.Exists(path)) return null;
            // Image.FromFile 会锁住文件；先读进内存，之后更新安装目录时不受影响。
            using (var stream = new MemoryStream(File.ReadAllBytes(path)))
                return new Bitmap(stream);
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static bool SystemUsesLightTheme()
    {
        try
        {
            using (var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
            {
                var value = key?.GetValue("SystemUsesLightTheme");
                return value is int theme && theme != 0;
            }
        }
        catch (Exception)
        {
            // 读不到系统主题时按常见的深色任务栏处理。
            return false;
        }
    }

    private static void DrawDot(Graphics graphics, int size, Color color, bool hollow)
    {
        var diameter = Math.Max(4, (int)Math.Round(size * 0.34));
        var bounds = new Rectangle(size - diameter, size - diameter, diameter - 1, diameter - 1);
        if (hollow)
        {
            using (var pen = new Pen(color, Math.Max(1, size / 16f)))
                graphics.DrawEllipse(pen, bounds);
        }
        else
        {
            using (var brush = new SolidBrush(color))
                graphics.FillEllipse(brush, bounds);
        }
    }

    private static class NativeMethods
    {
        [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
        public static extern bool DestroyIcon(IntPtr handle);
    }
}
