import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { qk } from "../../api/keys";
import { httpApi } from "../../api/social";
import { href } from "../../shell/routes";
import { Button } from "../../ui/kit/Button";
import { toast } from "../../ui/kit/Toast";
import { Switch } from "./DeviceSheet";
import { IdentityDetail } from "./IdentityDetail";
import { socialLoadError, socialUnavailable } from "./lib/socialError";
export function ContactDetail({ id }: { id: string }) {
	const qc = useQueryClient();
	const [busy, setBusy] = useState(false);
	const actor = useQuery({
		queryKey: ["contact", id],
		queryFn: async () => {
			const resolved = await httpApi.resolve("actor", id);
			return (await httpApi.actors([resolved?.id ?? id]))[0] ?? null;
		},
	});
	const session = useQuery({ queryKey: qk.socialSession, queryFn: httpApi.session });
	const profile = useQuery({
		queryKey: ["profile", actor.data?.id],
		queryFn: () => (actor.data ? httpApi.profile(actor.data.id) : Promise.resolve(null)),
		enabled: !!actor.data && !actor.data.anonymous,
	});
	const devices = useQuery({ queryKey: ["devices"], queryFn: httpApi.devices });
	const a = actor.data;
	const mine = a?.kind === "agent" && a.ownerId === session.data?.actor.id;
	const message = async () => {
		if (!a) return;
		setBusy(true);
		try {
			const conv = await httpApi.openDm(a.id);
			location.hash = href({ tab: "chats", page: "c", session: conv.code ?? conv.id });
		} catch (e) {
			toast(e instanceof Error ? e.message : "无法打开会话", true);
			setBusy(false);
		}
	};
	const online = async (v: boolean) => {
		if (!a) return;
		try {
			await httpApi.setAgentOnline(a.id, v);
			await Promise.all([
				qc.invalidateQueries({ queryKey: ["contact", id] }),
				qc.invalidateQueries({ queryKey: ["contacts"] }),
			]);
		} catch (e) {
			toast(e instanceof Error ? e.message : "更新失败", true);
		}
	};
	const setPublic = async (v: boolean) => {
		if (!a) return;
		try {
			await httpApi.setAgentPublic(a.id, v);
			await Promise.all([
				qc.invalidateQueries({ queryKey: ["contact", id] }),
				qc.invalidateQueries({ queryKey: ["contacts"] }),
				qc.invalidateQueries({ queryKey: ["profile"] }),
			]);
		} catch (e) {
			toast(e instanceof Error ? e.message : "公开设置失败", true);
		}
	};
	const device = devices.data?.find((d) => d.id === a?.deviceId);
	return (
		<div className="flex h-full flex-col bg-ground">
			<header className="flex items-center gap-3 p-4">
				<a aria-label="返回通讯录" href={href({ tab: "contacts" })} className="rounded-full p-2 hover:bg-tone">
					<ArrowLeft size={20} />
				</a>
				<h1>资料</h1>
			</header>
			<div className="scroll-y min-h-0 flex-1">
				{actor.isPending ? (
					<p role="status" className="p-6">
						正在加载联系人…
					</p>
				) : actor.isError && socialUnavailable(actor.error) ? (
					// 网关 404（没有代理社交接口）或 fetch 直接失败：不能说成「资料不存在」。
					<div role="alert" className="p-6" data-testid="contact-unavailable">
						<p>{socialLoadError(actor.error, "加载联系人失败")}</p>
						<button type="button" className="mt-2 underline" onClick={() => void actor.refetch()}>
							重试
						</button>
					</div>
				) : actor.isError ? (
					<div role="alert" className="p-6" data-testid="contact-error">
						加载联系人失败：{socialLoadError(actor.error, "请求失败")}{" "}
						<button type="button" className="underline" onClick={() => void actor.refetch()}>
							重试
						</button>
					</div>
				) : !a ? (
					// 接口存在且返回了空结果：这个人确实找不到，和「节点没有社交服务」是两回事。
					<div className="p-6" data-testid="contact-not-found">
						<p>联系人不存在或无法访问</p>
						<a className="mt-2 inline-block underline" href={href({ tab: "contacts", page: "friends/add" })}>
							添加好友
						</a>
					</div>
				) : (
					<IdentityDetail
						actor={a}
						card={profile.data?.card}
						summary={profile.data?.summary}
						agents={profile.data?.agents}
						owner={profile.data?.owner}
						actions={
							a.id !== session.data?.actor.id && (
								<Button variant="primary" disabled={busy} onClick={() => void message()}>
									发消息
								</Button>
							)
						}
					>
						<dl className="rounded-card bg-tone px-4">
							{a.note && (
								<div className="flex gap-4 py-3">
									<dt>备注</dt>
									<dd>{a.note}</dd>
								</div>
							)}
							{device && (
								<div className="flex gap-4 py-3">
									<dt>所在设备</dt>
									<dd>
										{device.name} · {device.online ? "在线" : "离线"}
									</dd>
								</div>
							)}
							{mine && (
								<div className="flex items-center justify-between py-3">
									<dt>联网</dt>
									<dd>
										<Switch on={!!a.online} onChange={(v) => void online(v)} label={`${a.name} 联网`} />
									</dd>
								</div>
							)}
							{mine && (
								<div className="flex items-center justify-between py-3">
									<dt>公开到我的个人主页</dt>
									<dd>
										<Switch
											on={!!a.public}
											onChange={(v) => void setPublic(v)}
											label={`${a.name} 公开到我的个人主页`}
										/>
									</dd>
								</div>
							)}
						</dl>
					</IdentityDetail>
				)}
			</div>
		</div>
	);
}
