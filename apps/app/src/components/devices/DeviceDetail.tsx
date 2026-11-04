import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../../api";
import type { Actor, Device, DeviceGrant } from "../../api/types";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { toast } from "../../ui/Toast";
import { deviceSessions } from "../../work/api/work";
import { titleOf } from "../../work/lib/identity";
import { workPath } from "../../work/shell/workRoutes";
import { useDeviceGrants, useRevokeGrant } from "./queries";
import {
	activeGrant,
	DEVICE_KIND_WORD,
	DEVICE_STATE_WORD,
	deviceState,
	EXECUTOR_WORD,
	executorState,
	lastActivity,
	protocolWord,
} from "./state";

/**
 * 设备详情（research/04 §4 流程 2）：设备状态、它的 Bot、它的工作会话、执行端、这台设备上的全部授权。
 * 同一份内容给 /me/devices/:id 与 /work/devices/:id；改名/解绑复用既有的 DeviceSheet，由调用方挂。
 */
export function DeviceDetail({
	device,
	accountId,
	workBase,
}: {
	device: Device;
	accountId: string;
	/** 会话链接的入口前缀；给了才渲染会话列表 */
	workBase?: "/work/device";
}) {
	const bots = useQuery({ queryKey: ["contacts"], queryFn: api.contacts, enabled: !!accountId });
	const mine = (bots.data ?? []).filter((actor) => actor.kind === "agent" && actor.deviceId === device.id);
	const state = deviceState(device, false);
	const executor = executorState(device);
	const activity = lastActivity(device);
	const protocol = protocolWord(device);
	return (
		<div className="flex flex-col gap-4">
			<section aria-label="设备状态" className="rounded-card bg-raised p-4">
				<dl className="flex flex-col gap-2 text-small">
					<div className="flex gap-3">
						<dt className="w-16 shrink-0 text-muted">类型</dt>
						<dd>{DEVICE_KIND_WORD[device.kind]}</dd>
					</div>
					<div className="flex gap-3">
						<dt className="w-16 shrink-0 text-muted">状态</dt>
						<dd>
							{DEVICE_STATE_WORD[state]}
							{protocol && <span className="ml-2 text-faint">{protocol}</span>}
						</dd>
					</div>
					{activity && (
						<div className="flex gap-3">
							<dt className="w-16 shrink-0 text-muted">活动</dt>
							<dd>{activity.label}</dd>
						</div>
					)}
					<div className="flex gap-3">
						<dt className="w-16 shrink-0 text-muted">执行端</dt>
						<dd className={executor === "unregistered" ? "text-danger" : undefined}>
							{EXECUTOR_WORD[executor]}
							{device.executor && (
								<span className="mt-1 block break-all font-mono text-caption text-faint">
									{device.executor.deviceId}
								</span>
							)}
						</dd>
					</div>
					{device.code && (
						<div className="flex gap-3">
							<dt className="w-16 shrink-0 text-muted">设备码</dt>
							<dd className="select-text break-all font-mono text-caption">{device.code}</dd>
						</div>
					)}
				</dl>
			</section>

			<section aria-label="这台设备的 Bot" className="overflow-hidden rounded-card bg-raised">
				<h2 className="px-4 pt-4 pb-2 text-small font-medium text-muted">Bot</h2>
				{bots.isPending ? (
					<p role="status" className="px-4 pb-4 text-small text-muted">
						正在读取 Bot…
					</p>
				) : bots.isError ? (
					<p role="alert" className="px-4 pb-4 text-small text-danger">
						无法读取 Bot 列表。
					</p>
				) : mine.length ? (
					<div className="divide-y divide-hairline/60">
						{mine.map((bot) => (
							<BotRow key={bot.id} bot={bot} deviceId={device.id} workable={state === "online"} />
						))}
					</div>
				) : (
					<p className="px-4 pb-4 text-small text-muted">
						{device.online ? "这台设备还没有登记 Bot。" : "设备离线，无法确认它登记了哪些 Bot。"}
					</p>
				)}
			</section>

			{workBase && <Sessions deviceId={device.id} workable={state === "online"} />}

			<Grants deviceId={device.id} />
		</div>
	);
}

function BotRow({ bot, deviceId, workable }: { bot: Actor; deviceId: string; workable: boolean }) {
	// 联系人页是社交身份，工作会话是工作身份；两者是同一个账号，这里都给。
	const sessions = useSessions(workable ? deviceId : undefined);
	const main = sessions.data?.find((session) => session.agent && session.mode === "main");
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<Avatar actor={bot} size={36} online={!!bot.online} />
			<div className="min-w-0 flex-1">
				<Link to={`/contacts/${bot.code ?? bot.id}`} className="press block truncate text-body hover:underline">
					{bot.name}
				</Link>
				<p className="text-caption text-muted">{bot.online ? "在线" : "离线"}</p>
			</div>
			{main && (
				<Link to={workPath({ deviceId, session: main.id })} className="press text-small text-accent-ink">
					主会话
				</Link>
			)}
		</div>
	);
}

/** 会话按设备取；离线设备不查，避免把缓存当成实时事实。 */
function useSessions(deviceId: string | undefined) {
	return useQuery({
		queryKey: ["device-detail-sessions", deviceId],
		enabled: !!deviceId,
		queryFn: () => deviceSessions(deviceId!),
		retry: false,
		staleTime: 10_000,
	});
}

function Sessions({ deviceId, workable }: { deviceId: string; workable: boolean }) {
	const sessions = useSessions(workable ? deviceId : undefined);
	return (
		<section aria-label="这台设备的会话" className="overflow-hidden rounded-card bg-raised">
			<h2 className="px-4 pt-4 pb-2 text-small font-medium text-muted">会话</h2>
			{!workable ? (
				<p className="px-4 pb-4 text-small text-muted">设备离线或工作台未就绪，无法列出会话。</p>
			) : sessions.isPending ? (
				<p role="status" className="px-4 pb-4 text-small text-muted">
					正在读取会话…
				</p>
			) : sessions.isError ? (
				<p role="alert" className="px-4 pb-4 text-small text-danger">
					无法读取会话：{sessions.error.message}
				</p>
			) : sessions.data.length ? (
				<div className="divide-y divide-hairline/60">
					{sessions.data.map((session) => (
						<Link
							key={session.id}
							to={workPath({ deviceId, session: session.id })}
							className="press block truncate px-4 py-3 text-small hover:bg-tone/60"
						>
							{titleOf(session)}
						</Link>
					))}
				</div>
			) : (
				<p className="px-4 pb-4 text-small text-muted">这台设备还没有会话。</p>
			)}
		</section>
	);
}

function Grants({ deviceId }: { deviceId: string }) {
	const query = useDeviceGrants(deviceId);
	return (
		<section aria-label="这台设备的授权" className="overflow-hidden rounded-card bg-raised">
			<h2 className="px-4 pt-4 pb-1 text-small font-medium text-muted">授权</h2>
			<p className="px-4 pb-2 text-caption text-faint">
				执行端上报的回读，仅供查看；是否放行始终由设备上的执行端决定。
			</p>
			{query.isPending ? (
				<p role="status" className="px-4 pb-4 text-small text-muted">
					正在读取授权…
				</p>
			) : query.isError ? (
				<p role="alert" className="px-4 pb-4 text-small text-danger">
					无法读取授权：{query.error.message}
				</p>
			) : !query.data.observed ? (
				<p className="px-4 pb-4 text-small text-muted">
					这台设备的执行端还没有上报过授权。这不等于没有授权，等它连上后再看。
				</p>
			) : query.data.grants.length ? (
				<div className="divide-y divide-hairline/60">
					{query.data.grants.map((grant) => (
						<GrantRow key={grant.grantId} grant={grant} deviceId={deviceId} />
					))}
				</div>
			) : (
				<p className="px-4 pb-4 text-small text-muted">这台设备当前没有发给任何 Bot 的授权。</p>
			)}
		</section>
	);
}

function GrantRow({ grant, deviceId }: { grant: DeviceGrant; deviceId: string }) {
	const revoke = useRevokeGrant(deviceId);
	const [busy, setBusy] = useState(false);
	// 「生效中」只在未撤销且未过期时成立；其他情况不猜原因。
	const live = !grant.revokedAt && activeGrant(grant, grant.botId ?? grant.principalId);
	const remove = async () => {
		if (busy) return;
		setBusy(true);
		try {
			const result = await revoke(grant.grantId);
			// pending 表示设备离线、撤销已排队：不能显示成已生效（19 §10）。
			toast(result.pending ? "设备离线，撤销已排队，重连后生效" : "已撤销");
		} catch (error) {
			toast(error instanceof Error ? error.message : "撤销失败", true);
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="px-4 py-3 text-small">
			<div className="flex items-baseline gap-2">
				<span className="min-w-0 flex-1 truncate">{grant.botLabel ?? "未知控制端"}</span>
				<span className="shrink-0 text-caption text-faint">
					{grant.revokedAt ? "已撤销" : live ? "生效中" : "已过期"}
				</span>
			</div>
			<p className="mt-1 break-words text-caption text-muted">
				{grant.capabilities.join(" · ") || "无能力"}
				{grant.targetIds.length ? ` · ${grant.targetIds.join(" · ")}` : ""}
			</p>
			<p className="mt-1 text-caption text-faint">
				第 {grant.revision} 版 · {grant.source === "manual" ? "手工配对" : "云端介绍"} ·{" "}
				{new Date(grant.issuedAt).toLocaleString()}
			</p>
			{!grant.revokedAt && (
				<Button size="sm" className="mt-2 text-danger" disabled={busy} onClick={() => void remove()}>
					{busy ? "撤销中…" : "撤销"}
				</Button>
			)}
		</div>
	);
}
