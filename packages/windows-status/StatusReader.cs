using System;
using System.Text.Json;

namespace YonderStatus;

/// <summary>
/// 服务状态与活动计数的唯一快照。读取失败一律是未知，绝不把“没读到”当成在线。
/// 与 macOS 状态栏同一套文案：运行中 / 空闲 / 服务未就绪 · 状态未知。
/// </summary>
internal sealed class ActivitySnapshot
{
    public static readonly ActivitySnapshot Unknown = new ActivitySnapshot(false, 0, 0);

    private ActivitySnapshot(bool known, int running, int waiting)
    {
        Known = known;
        Running = running;
        Waiting = waiting;
    }

    public bool Known { get; }

    public int Running { get; }

    public int Waiting { get; }

    public string Title
    {
        get
        {
            if (!Known) return "服务未就绪 · 状态未知";
            if (Running == 0 && Waiting == 0) return "服务运行中 · 空闲";
            var title = "服务运行中 · 运行 " + Running.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (Waiting > 0)
                title += " · 等你 " + Waiting.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return title;
        }
    }

    /// <summary>
    /// 只读 `yonder service info` 的 ready 与 agents[].tasks[].state：running/等待数来自原生任务状态，
    /// 不读会话内容、任务摘要或回复片段。字段缺失或类型不符时整份快照记为未知。
    /// </summary>
    public static ActivitySnapshot Parse(string json)
    {
        if (string.IsNullOrEmpty(json)) return Unknown;
        try
        {
            using (var document = JsonDocument.Parse(json))
            {
                var root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object) return Unknown;
                if (!root.TryGetProperty("ready", out var ready) || ready.ValueKind != JsonValueKind.True)
                    return Unknown;
                if (!root.TryGetProperty("agents", out var agents) || agents.ValueKind != JsonValueKind.Array)
                    return Unknown;
                var running = 0;
                var waiting = 0;
                foreach (var agent in agents.EnumerateArray())
                {
                    if (agent.ValueKind != JsonValueKind.Object) return Unknown;
                    if (!agent.TryGetProperty("tasks", out var tasks) || tasks.ValueKind != JsonValueKind.Array)
                        return Unknown;
                    foreach (var task in tasks.EnumerateArray())
                    {
                        if (task.ValueKind != JsonValueKind.Object) return Unknown;
                        if (!task.TryGetProperty("state", out var state) || state.ValueKind != JsonValueKind.String)
                            return Unknown;
                        var value = state.GetString();
                        if (value == "running") running += 1;
                        else if (value == "waiting") waiting += 1;
                    }
                }
                return new ActivitySnapshot(true, running, waiting);
            }
        }
        catch (JsonException)
        {
            return Unknown;
        }
    }
}
