import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { qk } from "../../api/keys";
import { type Actor, httpApi } from "../../api/social";
import { href } from "../../shell/routes";
import { ActorAvatar } from "../../ui/kit/ActorAvatar";
import { Button } from "../../ui/kit/Button";
import { Field } from "../../ui/kit/Field";
import { toast } from "../../ui/kit/Toast";
import { Window } from "../../ui/kit/Window";
import { AccountSecurity } from "./AccountSecurity";
import { AgentPublicToggle } from "./AgentPublicToggle";
import { messageOf, socialSessionState } from "./lib/session";
import { SocialLogin } from "./SocialLogin";

const actorHref = (actor: Actor) => href({ tab: "chats", page: "p", session: actor.code ?? actor.id });

export function Profile({ accountId }: { accountId?: string }) {
	return accountId ? <PublicProfile accountId={accountId} /> : <Me />;
}

function PublicProfile({ accountId }: { accountId: string }) {
	const client = useQueryClient();
	const [expanded, setExpanded] = useState(false);
	const [busy, setBusy] = useState(false);
	const short = /^[a-z0-9]{6}$/i.test(accountId);
	const resolved = useQuery({
		queryKey: ["resolve", "actor", accountId.toUpperCase()],
		queryFn: () => httpApi.resolve("actor", accountId.toUpperCase()),
		enabled: short,
	});
	const id = short ? resolved.data?.id : accountId;
	const query = useQuery({ queryKey: ["profile", id], queryFn: () => httpApi.profile(id as string), enabled: !!id });
	const session = useQuery({ queryKey: qk.socialSession, queryFn: httpApi.session });
	const auth = socialSessionState({ data: session.data, error: session.error });
	if ((short && resolved.isPending) || (id && query.isPending) || auth.status === "unknown")
		return (
			<p role="status" className="p-6 text-small text-muted">
				正在加载资料…
			</p>
		);
	if (resolved.isError || query.isError || auth.status === "error")
		return (
			<div role="alert" className="p-6">
				<p>加载资料失败{auth.status === "error" ? `：${auth.message}` : ""}</p>
				<Button
					onClick={() => {
						if (resolved.isError) void resolved.refetch();
						if (query.isError) void query.refetch();
						if (auth.status === "error") void session.refetch();
					}}
				>
					重试
				</Button>
			</div>
		);
	const profile = query.data;
	if (!profile)
		return (
			<p role="status" className="p-6 text-muted">
				这个资料不存在或无法访问
			</p>
		);
	const { actor, card, agents, owner } = profile;
	const self = actor.id === session.data?.actor.id;
	const mine = actor.kind === "agent" && actor.ownerId === session.data?.actor.id;
	const headline = card?.face?.headline?.trim() || card?.tagline || card?.summary || profile.summary || actor.summary;
	const start = async () => {
		setBusy(true);
		try {
			if (!session.data) {
				const anonymous = await httpApi.createAnonymous();
				client.setQueryData(qk.socialSession, anonymous);
			}
			const conversation = await httpApi.openDm(actor.id);
			location.hash = href({ tab: "chats", page: "c", session: conversation.code ?? conversation.id });
		} catch (error) {
			toast(error instanceof Error ? error.message : "无法打开会话", true);
		} finally {
			setBusy(false);
		}
	};
	const addFriend = async () => {
		if (!session.data || session.data.actor.anonymous) {
			toast("注册后可加好友，聊天无需注册");
			return;
		}
		setBusy(true);
		try {
			await httpApi.addFriend(actor.ownerId ?? actor.id);
			await client.invalidateQueries({ queryKey: ["contacts"] });
			toast("已添加朋友");
		} catch (error) {
			toast(error instanceof Error ? error.message : "添加失败", true);
		} finally {
			setBusy(false);
		}
	};
	return (
		<main className="scroll-y h-full bg-ground">
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-4 lg:px-8 lg:py-6">
				<section aria-label="身份资料" className="overflow-hidden rounded-[24px] bg-raised shadow-soft">
					<div className="h-32 bg-tone lg:h-40">
						{card?.display ? (
							<iframe
								title="资料背景"
								sandbox=""
								srcDoc={
									card.display.kind === "svg"
										? `<style>html,body{margin:0;height:100%}svg{display:block;width:100%;height:100%}</style>${card.display.source}`
										: card.display.source
								}
								className="pointer-events-none h-full w-full border-0"
							/>
						) : card?.face?.sticker?.url ? (
							<img src={card.face.sticker.url} alt="" className="h-full w-full object-cover" />
						) : null}
					</div>
					<div className="relative flex flex-col gap-4 px-5 pb-5">
						<div className="flex items-start gap-4">
							<div className="-mt-7 rounded-full bg-raised p-1">
								<ActorAvatar seed={actor.id} group="bot" size={72} dot={actor.kind === "agent" && !!actor.online} />
							</div>
							<div className="min-w-0 flex-1 pt-3">
								<h1 className="break-words text-[22px] leading-tight font-semibold">{actor.name}</h1>
								{actor.code && <p className="mt-1 text-caption text-muted">ID · {actor.code}</p>}
								{actor.kind === "agent" && (
									<p className="mt-1 text-caption text-muted">Agent · {actor.online ? "在线" : "离线"}</p>
								)}
							</div>
						</div>
						{headline && <p className="break-words text-body text-muted">{headline}</p>}
						{!!card?.face?.tags?.length && (
							<div className="flex flex-wrap gap-2">
								{card.face.tags.map((tag) => (
									<span key={tag} className="rounded-full bg-tone px-3 py-1 text-caption text-muted">
										{tag}
									</span>
								))}
							</div>
						)}
						{!self && (
							<div className="flex flex-wrap gap-2">
								<Button variant="primary" disabled={busy} onClick={() => void start()}>
									开始聊天
								</Button>
								{!mine && (
									<Button disabled={busy} onClick={() => void addFriend()}>
										加好友
									</Button>
								)}
							</div>
						)}
						{mine && <AgentPublicToggle actor={actor} />}
					</div>
				</section>
				{(card?.markdown || card?.face?.section) && (
					<section aria-label="介绍" className="flex flex-col gap-4 rounded-card bg-raised p-5">
						<h2 className="text-small font-medium text-muted">介绍</h2>
						{card.face?.section && (
							<div>
								<h3 className="font-medium">{card.face.section.title}</h3>
								<p className="mt-1 whitespace-pre-wrap text-body text-muted">{card.face.section.body}</p>
							</div>
						)}
						{card.markdown && (
							<article className="break-words text-body">
								<ReactMarkdown remarkPlugins={[remarkGfm]}>{card.markdown}</ReactMarkdown>
							</article>
						)}
					</section>
				)}
				{!!agents.length && (
					<section aria-label="公开 Agent" className="overflow-hidden rounded-card bg-raised">
						<h2 className="px-5 pt-4 pb-2 text-small font-medium text-muted">公开 Agent</h2>
						<ul className="divide-y divide-hairline">
							{(expanded ? agents : agents.slice(0, 3)).map((agent) => (
								<li key={agent.id}>
									<a
										href={actorHref(agent)}
										className="press flex items-center gap-3 px-5 py-4 hover:bg-tone/60 focus-visible:outline"
									>
										<ActorAvatar seed={agent.id} group="bot" size={40} dot={!!agent.online} />
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium">{agent.name}</span>
											{agent.summary && <span className="mt-1 block text-small text-muted">{agent.summary}</span>}
										</span>
										<span className="text-caption text-muted">{agent.online ? "在线" : "离线"}</span>
									</a>
								</li>
							))}
						</ul>
						{agents.length > 3 && (
							<button
								type="button"
								aria-expanded={expanded}
								onClick={() => setExpanded(!expanded)}
								className="press w-full border-t border-hairline px-5 py-3 text-left text-small focus-visible:outline"
							>
								{expanded ? "收起" : `查看全部 ${agents.length} 位`}
							</button>
						)}
					</section>
				)}
				{owner && (
					<section className="rounded-card bg-raised px-5 py-4">
						<h2 className="mb-3 text-small font-medium text-muted">主人</h2>
						<a href={actorHref(owner)} className="press flex items-center gap-3 focus-visible:outline">
							<ActorAvatar seed={owner.id} group="bot" size={40} />
							<span className="font-medium">{owner.name}</span>
						</a>
					</section>
				)}
			</div>
		</main>
	);
}

function Me() {
	const client = useQueryClient();
	const session = useQuery({ queryKey: qk.socialSession, queryFn: httpApi.session });
	const auth = socialSessionState({ data: session.data, error: session.error });
	const contacts = useQuery({
		queryKey: ["contacts"],
		queryFn: httpApi.contacts,
		enabled: auth.status === "human",
	});
	const [settings, setSettings] = useState(false);
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState("");
	const [busy, setBusy] = useState(false);
	if (auth.status === "unknown")
		return (
			<p role="status" className="p-6">
				正在加载资料…
			</p>
		);
	if (auth.status === "error")
		return (
			<div role="alert" className="p-6">
				加载资料失败：{auth.message} <Button onClick={() => void session.refetch()}>重试</Button>
			</div>
		);
	if (auth.status === "guest")
		return (
			<main className="scroll-y h-full bg-ground">
				<div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-4 lg:px-8 lg:py-6">
					<section aria-label="登录入口" className="rounded-card bg-raised p-5">
						<h1 className="text-[22px] font-semibold">登录或注册</h1>
						<p className="mt-1 text-small text-muted">登录后可以加好友、管理 Agent 与设备。</p>
					</section>
					<SocialLogin />
				</div>
			</main>
		);
	const actor = auth.actor;
	const agents = contacts.data?.filter((a) => a.kind === "agent" && a.ownerId === actor.id) ?? [];
	const startEditing = () => {
		setName(actor.name);
		setEditing(true);
	};
	const save = async () => {
		setBusy(true);
		try {
			const updated = await httpApi.updateProfile({ name: name.trim() });
			client.setQueryData(qk.socialSession, { actor: updated });
			await client.invalidateQueries({ queryKey: ["profile"] });
			setEditing(false);
			toast("已保存");
		} catch (error) {
			toast(messageOf(error, "保存失败"), true);
		} finally {
			setBusy(false);
		}
	};
	const logout = async () => {
		setBusy(true);
		try {
			await httpApi.logout();
			client.removeQueries({ predicate: (query) => query.queryKey[0] !== qk.socialSession[0] });
			client.setQueryData(qk.socialSession, null);
			location.hash = href({ tab: "me" });
		} catch (error) {
			toast(error instanceof Error ? error.message : "退出失败，请重试", true);
		} finally {
			setBusy(false);
		}
	};
	/** 换绑手机/邮箱后服务端已撤销所有会话：本地不再调 logout，只清掉缓存回到登录入口。 */
	const logoutToLogin = () => {
		client.removeQueries({ predicate: (query) => query.queryKey[0] !== qk.socialSession[0] });
		client.setQueryData(qk.socialSession, null);
		setSettings(false);
		location.hash = href({ tab: "me" });
	};
	return (
		<main className="scroll-y h-full bg-ground">
			<div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-4 lg:px-8 lg:py-6">
				<section aria-label="我的身份" className="flex items-center gap-4 rounded-card bg-raised p-5">
					<ActorAvatar seed={actor.id} group="bot" size={64} />
					<div className="min-w-0 flex-1">
						<h1 className="text-[22px] font-semibold">{actor.name}</h1>
						{actor.code && <p className="text-small text-muted">ID · {actor.code}</p>}
					</div>
					{!actor.anonymous && (
						<Button size="sm" onClick={startEditing}>
							编辑昵称
						</Button>
					)}
				</section>
				{actor.anonymous ? (
					<>
						<section aria-label="注册引导" className="rounded-card bg-raised p-5">
							<h2 className="font-medium">注册后可加好友</h2>
							<p className="mt-1 text-small text-muted">
								你现在是访客账号，可以聊天、加入群聊；注册后还能加好友、管理 Agent 与设备，已有记录会保留。
							</p>
						</section>
						<SocialLogin />
					</>
				) : (
					<>
						<section aria-label="我的 Agent" className="overflow-hidden rounded-card bg-raised">
							<div className="flex justify-between px-5 pt-4 pb-2">
								<h2 className="text-small font-medium text-muted">我的 Agent</h2>
								<span className="text-caption text-muted">{agents.length} 位</span>
							</div>
							{contacts.isPending ? (
								<p role="status" className="px-5 py-4">
									正在加载 Agent…
								</p>
							) : contacts.isError ? (
								<div role="alert" className="px-5 py-4">
									加载 Agent 失败 <Button onClick={() => void contacts.refetch()}>重试</Button>
								</div>
							) : agents.length ? (
								<ul className="divide-y divide-hairline">
									{agents.map((agent) => (
										<li key={agent.id} className="px-5 py-4">
											<a
												href={href({ tab: "contacts", page: "contacts", session: agent.code ?? agent.id })}
												className="flex items-center gap-3 focus-visible:outline"
											>
												<ActorAvatar seed={agent.id} group="bot" size={44} dot={!!agent.online} />
												<span className="min-w-0 flex-1">
													<span className="block truncate font-medium">{agent.name}</span>
													<span className="block text-caption text-muted">
														{agent.online ? "在线" : "离线"} · {agent.public ? "公开" : "仅自己可见"}
													</span>
													{agent.summary && <span className="block text-small text-muted">{agent.summary}</span>}
												</span>
												<span>管理</span>
											</a>
											<AgentPublicToggle actor={agent} />
										</li>
									))}
								</ul>
							) : (
								<p className="px-5 py-4 text-small text-muted">连接设备后，Agent 会出现在这里</p>
							)}
						</section>
						<a href={href({ tab: "contacts" })} className="rounded-card bg-raised p-4 focus-visible:outline">
							设备
						</a>
						{!contacts.isPending && !contacts.isError && !agents.length && (
							<div className="flex gap-2">
								<a href={href({ tab: "chats", page: "connect" })} className="rounded-control bg-raised p-3">
									添加设备
								</a>
								<a href={href({ tab: "chats", page: "get" })} className="rounded-control bg-raised p-3">
									下载 Yonder
								</a>
							</div>
						)}
					</>
				)}
				<button
					type="button"
					onClick={() => setSettings(true)}
					className="rounded-card bg-raised p-4 text-left focus-visible:outline"
				>
					设置
				</button>
			</div>
			<Window open={settings && !editing} onOpenChange={setSettings} title="设置">
				<div className="flex max-h-[calc(90dvh-3rem)] flex-col gap-3 overflow-y-auto p-5">
					{!actor.anonymous && <Button onClick={startEditing}>账号昵称</Button>}
					{!actor.anonymous && (
						<section aria-label="账号与安全" className="flex flex-col gap-3">
							<h2 className="text-small font-medium text-muted">账号与安全</h2>
							<AccountSecurity actor={actor} onSignedOut={logoutToLogin} />
						</section>
					)}
					<Button disabled={busy} onClick={() => void logout()}>
						退出登录
					</Button>
				</div>
			</Window>
			<Window open={editing} onOpenChange={setEditing} title="资料">
				<div className="flex flex-col gap-4 p-5">
					<ActorAvatar seed={actor.id} group="bot" size={64} />
					<Field label="昵称" value={name} onChange={(e) => setName(e.target.value)} />
					<div className="flex gap-2">
						<Button
							variant="primary"
							disabled={busy || !name.trim() || name.trim() === actor.name}
							onClick={() => void save()}
						>
							保存
						</Button>
						<Button onClick={() => setEditing(false)}>关闭</Button>
					</div>
				</div>
			</Window>
		</main>
	);
}
