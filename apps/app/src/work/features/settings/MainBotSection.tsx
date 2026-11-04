import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, Laptop } from "lucide-react";
import { api } from "../../../api";
import type { MainBot } from "../../../api/types";
import { cn } from "../../../lib/cn";
import { Button } from "../../../ui/Button";
import { toast } from "../../../ui/Toast";

/**
 * 运行位置：主 Bot 默认在云端（云端额度），可指到自己名下某台设备上的既有 Bot。
 * 警告文案说明真实的运维事实：那台设备离线时没有本机 Bot 可用，消息会由云端 Bot 接手。
 */
export function MainBotSection() {
	const client = useQueryClient();
	const query = useQuery({ queryKey: ["main-bot"], queryFn: api.mainBot, retry: 1 });
	const contacts = useQuery({ queryKey: ["contacts"], queryFn: api.contacts });
	const move = useMutation({
		mutationFn: (input: { location: "cloud" } | { location: "device"; botId: string }) => api.setMainBot(input),
		onSuccess: (result: MainBot) => {
			client.setQueryData(["main-bot"], result);
			toast(result.location === "cloud" ? "主 Bot 已放回云端" : `主 Bot 已移到 ${result.device?.name ?? "设备"}`);
		},
		onError: (error: Error) => toast(error.message || "移动失败", true),
	});
	if (query.isPending) return <p className="mx-4 mt-3 text-small text-muted">正在读取运行位置…</p>;
	if (query.isError)
		return (
			<div className="mx-4 mt-3 rounded-card bg-raised p-4" role="alert">
				<p className="text-danger">运行位置读取失败：{query.error.message}</p>
				<Button className="mt-3 h-9" onClick={() => void query.refetch()}>
					重试
				</Button>
			</div>
		);
	const state = query.data;
	const deviceBots = (contacts.data ?? []).filter((actor) => actor.kind === "agent" && actor.deviceId);
	const cloud = state.location === "cloud";
	return (
		<section className="mx-4 mt-3 flex flex-col gap-3 rounded-card bg-raised p-4" aria-label="运行位置">
			<div className="flex items-center gap-3">
				{cloud ? (
					<Cloud size={18} className="text-muted" aria-hidden />
				) : (
					<Laptop size={18} className="text-muted" aria-hidden />
				)}
				<div className="min-w-0 flex-1">
					<p className="text-body">{cloud ? "云端" : (state.device?.name ?? "设备")}</p>
					<p className="mt-0.5 text-caption text-muted">
						{cloud
							? `${state.botName ?? "主 Bot"} 在云端运行，用云端额度`
							: `${state.botName ?? "主 Bot"} 运行在这台设备上${state.device?.online ? "，当前在线" : "，当前离线"}`}
					</p>
				</div>
				{!cloud && (
					<Button className="h-9" disabled={move.isPending} onClick={() => move.mutate({ location: "cloud" })}>
						放回云端
					</Button>
				)}
			</div>
			{!cloud && !state.device?.online && (
				<p role="status" className="rounded-bubble bg-tone-2 px-3 py-2 text-small text-muted">
					设备离线期间这里没有本机 Bot 可用，消息会由云端 Bot 自动接手。
					{state.fallback ? `接手的 Bot 是 ${state.fallback.botName}。` : ""}
				</p>
			)}
			{cloud && (
				<div className="flex flex-col gap-2">
					<p className="text-caption text-muted">移到某台设备上的 Bot</p>
					{deviceBots.length === 0 && <p className="text-small text-muted">还没有设备上的 Bot。先连接一台设备。</p>}
					{deviceBots.map((actor) => (
						<button
							key={actor.id}
							type="button"
							disabled={move.isPending || state.botId === actor.id}
							onClick={() => move.mutate({ location: "device", botId: actor.id })}
							className={cn(
								"press flex min-h-12 items-center gap-3 rounded-card border border-hairline px-3 text-left",
								state.botId === actor.id ? "bg-tone-2" : "hover:bg-tone",
							)}
						>
							<Laptop size={16} className="text-muted" aria-hidden />
							<span className="min-w-0 flex-1 truncate">{actor.name}</span>
							<span className="text-caption text-muted">{state.botId === actor.id ? "当前" : "移到这里"}</span>
						</button>
					))}
					<p className="text-caption text-muted">
						移到设备后，那台设备离线时这里没有本机 Bot 可用，消息会由云端 Bot 自动接手。
					</p>
				</div>
			)}
		</section>
	);
}
