import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { request } from "../../../api/http";
import type { CloudRuntime } from "../../api/session-options";
import type { Connection } from "./ModelConnections";

export function RuntimeSettings() {
	const qc = useQueryClient();
	const runtimes = useQuery({
		queryKey: ["runtimes", "settings"],
		queryFn: () => request<{ runtimes: (CloudRuntime & { state: string })[]; cloudAvailable: boolean }>("/runtimes"),
		retry: false,
		refetchInterval: 5000,
	});
	const models = useQuery({
		queryKey: ["cloud-model-connections"],
		queryFn: () => request<{ connections: Connection[] }>("/model-connections"),
		retry: false,
	});
	const [model, setModel] = useState("");
	const [busy, setBusy] = useState("");
	const [error, setError] = useState("");
	const action = async (path: string, body: object = {}) => {
		setBusy(path);
		setError("");
		try {
			await request(path, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			await qc.invalidateQueries({ queryKey: ["runtimes"] });
			await qc.invalidateQueries({ queryKey: ["account-devices"] });
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : "运行位置操作失败");
		} finally {
			setBusy("");
		}
	};
	return (
		<section className="mx-4 mt-3 rounded-card bg-raised p-4">
			<h2 className="font-medium">运行位置</h2>
			<p className="mt-1 text-caption text-muted">
				云端 Agent 和会话记录由云端保存；已连接设备可运行自己的 Agent，也可提供工具。
			</p>
			{runtimes.isLoading && <p className="mt-3 text-small">读取运行位置…</p>}
			{runtimes.error && (
				<p role="alert" className="mt-3 text-small text-danger">
					{runtimes.error.message}
					<button type="button" className="ml-2 underline" onClick={() => void runtimes.refetch()}>
						重试
					</button>
				</p>
			)}
			{runtimes.data?.runtimes.map((runtime) => (
				<div key={runtime.id} className="mt-3 flex items-center gap-3 border-t border-hairline pt-3">
					<div className="min-w-0 flex-1">
						<p className="truncate text-small font-medium">{runtime.name}</p>
						<p className="text-caption text-faint">
							{runtime.kind === "cloud" ? "云端" : "设备"} ·{" "}
							{runtime.online ? "在线" : runtime.state === "stopped" ? "已停止" : "不可用"}
						</p>
					</div>
					{runtime.kind === "cloud" && (
						<button
							type="button"
							disabled={!!busy || !runtimes.data.cloudAvailable}
							className="press min-h-11 rounded-control bg-tone px-3 text-small disabled:opacity-40"
							onClick={() =>
								void action(
									`/runtimes/${encodeURIComponent(runtime.id)}/${runtime.state === "running" ? "stop" : "start"}`,
								)
							}
						>
							{runtime.state === "running" ? "停止" : "启动"}
						</button>
					)}
				</div>
			))}
			{runtimes.data && !runtimes.data.runtimes.some((runtime) => runtime.kind === "cloud") && (
				<div className="mt-4 border-t border-hairline pt-3">
					{runtimes.data.cloudAvailable ? (
						<>
							<label className="text-small">
								云端 Agent 默认模型（可稍后配置）
								<select
									className="field mt-2 w-full rounded-control border border-hairline bg-ground px-3 py-2 text-small"
									value={model}
									onChange={(event) => setModel(event.target.value)}
								>
									<option value="">稍后配置模型</option>
									{models.data?.connections
										.filter((connection) => connection.enabled)
										.flatMap((connection) =>
											connection.models.map((item) => (
												<option key={`${connection.id}/${item.id}`} value={`cloud-${connection.id}/${item.id}`}>
													{connection.name} · {item.name}
												</option>
											)),
										)}
								</select>
							</label>
							<button
								type="button"
								disabled={!!busy}
								className="press mt-3 min-h-11 rounded-control bg-accent px-4 text-small text-on-accent disabled:opacity-40"
								onClick={() => void action("/runtimes/cloud", model ? { model } : {})}
							>
								{busy ? "正在创建…" : "创建云端运行位置"}
							</button>
						</>
					) : (
						<p className="text-small text-muted">云端运行服务尚未开放，此处只显示真实已接入的设备。</p>
					)}
				</div>
			)}
			{models.error && <p className="mt-3 text-caption text-danger">读取云端模型失败：{models.error.message}</p>}
			{error && (
				<p role="alert" className="mt-3 text-small text-danger">
					{error}
				</p>
			)}
			<div className="mt-3 flex gap-4 text-small text-accent-ink">
				<Link to="/me/settings/models" className="py-2">
					管理云端模型
				</Link>
				<Link to="/connect" className="py-2">
					连接设备
				</Link>
			</div>
		</section>
	);
}
