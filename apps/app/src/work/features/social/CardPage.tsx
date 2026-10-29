import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeCanvas } from "qrcode.react";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { qk } from "../../api/keys";
import { type Actor, type Card, httpApi } from "../../api/social";
import { href, useRoute } from "../../shell/routes";
import { Button } from "../../ui/kit/Button";
import { CardFaceView } from "./card/CardFace";
import { renderCardImage } from "./card/image";
import { THEMES } from "./card/themes";
import { rememberShareToken, shareLinkKey, shareLinkUrl } from "./lib/shareLinks";
import { ShareLinks } from "./ShareLinks";

function CardContent({
	card,
	actor,
	publicView = false,
	showFace = true,
}: {
	card?: Card;
	actor: Actor;
	publicView?: boolean;
	showFace?: boolean;
}) {
	const client = useQueryClient();
	const [sharing, setSharing] = useState(false);
	const qr = useRef<HTMLCanvasElement>(null);
	const [image, setImage] = useState("");
	const [message, setMessage] = useState("");
	const canShare = (!card || card.status === "published") && (actor.kind !== "agent" || actor.public === true);
	const base = `${location.origin}${location.pathname}`;
	const hash = href({
		tab: "chats",
		page: actor.kind === "agent" || !card ? "p" : "u",
		session: actor.kind === "agent" || !card ? (actor.code ?? actor.id) : (card.code ?? card.id),
	});
	const plainUrl = `${base}${hash}`;
	/**
	 * 分享二维码/链接优先用服务端生成的分享链接（`?share=<token>`），访客凭它登录时服务端才计配额。
	 * 只有自己的名片（含自己 Agent 的名片，即 card.mine）能生成；别人的名片、访客身份退回普通地址。
	 */
	const [share, setShare] = useState<{ id: string; url: string }>();
	const link = useMutation({
		mutationFn: async () => {
			if (!card?.mine) return "";
			const session = await httpApi.session();
			if (!session || session.actor.anonymous) return "";
			const created = await httpApi.createShareLink({ kind: "card", targetId: card.id });
			rememberShareToken(shareLinkKey("card", card.id), created.token);
			return shareLinkUrl(created, hash, base);
		},
		onSuccess: (generated) => {
			if (generated) setShare({ id: card?.id ?? actor.id, url: generated });
		},
		onError: () => setMessage("分享链接生成失败，已改用普通链接"),
	});
	const url = share?.id === (card?.id ?? actor.id) ? share.url : plainUrl;
	const toggleSharing = () => {
		const next = !sharing;
		setSharing(next);
		// 每次打开分享都请求一次：服务端对同一名片会复用未过期的链接，不会每次都新增配额。
		if (next) link.mutate();
	};
	const start = useMutation({
		mutationFn: async () => {
			if (!(await httpApi.session())) {
				const anonymous = await httpApi.createAnonymous();
				client.setQueryData(qk.socialSession, anonymous);
			}
			return card ? httpApi.startFromCard(card.id, "link") : httpApi.openDm(actor.id);
		},
		onSuccess: (conversation) => {
			for (const key of ["cards", "contacts", "convs", "social", "conversations"])
				void client.invalidateQueries({ queryKey: [key] });
			location.hash = href({ tab: "chats", page: "c", session: conversation.code ?? conversation.id });
		},
		onError: () => setMessage("无法开始聊天"),
	});
	return (
		<>
			{showFace && <CardFaceView actor={actor} card={card} />}
			<div className="mt-4 flex flex-wrap justify-center gap-2">
				{publicView && (
					<Button variant="primary" disabled={start.isPending} onClick={() => start.mutate()}>
						开始聊天
					</Button>
				)}
				{canShare && <Button onClick={toggleSharing}>分享名片</Button>}
			</div>
			{message && (
				<p role="alert" className="mt-2 text-center">
					{message}
				</p>
			)}
			{sharing && (
				<section
					aria-label="分享名片"
					className="mt-4 flex flex-col items-center gap-3 rounded-2xl bg-white p-5 text-black"
				>
					<QRCodeCanvas ref={qr} value={url} size={180} />
					<Button
						onClick={() => {
							if (qr.current)
								void renderCardImage({
									name: actor.name,
									avatarUrl: actor.avatarUrl,
									agent: actor.kind === "agent",
									online: actor.online,
									headline: card?.tagline ?? card?.summary,
									face: card?.face,
									qr: qr.current,
								}).then(setImage, () => setMessage("二维码名片生成失败"));
						}}
					>
						生成二维码名片
					</Button>
					{image && (
						<a href={image} download={`${actor.name}-二维码名片.png`}>
							保存二维码名片
						</a>
					)}
					<p className="break-all text-sm">{url}</p>
					<Button
						onClick={() => {
							void navigator.clipboard.writeText(url).then(
								() => setMessage("链接已复制"),
								() => setMessage("复制失败，请长按链接复制"),
							);
						}}
					>
						复制链接
					</Button>
					{card?.mine && <ShareLinks kind="card" targetId={card.id} label={actor.name} hash={hash} />}
				</section>
			)}
		</>
	);
}

function PublicCard({ reference }: { reference: string }) {
	const short = /^[a-z0-9]{6}$/i.test(reference);
	const resolved = useQuery({
		queryKey: ["resolve", "card", reference.toUpperCase()],
		queryFn: () => httpApi.resolve("card", reference.toUpperCase()),
		enabled: short,
	});
	const cardId = short ? resolved.data?.id : reference;
	const card = useQuery({
		queryKey: ["card", cardId],
		queryFn: () => httpApi.card(cardId ?? ""),
		enabled: !!cardId,
	});
	const session = useQuery({ queryKey: qk.socialSession, queryFn: httpApi.session });
	const [friendMessage, setFriendMessage] = useState("");
	const client = useQueryClient();
	const friend = useMutation({
		mutationFn: (id: string) => httpApi.addFriend(id),
		onSuccess: () => {
			void client.invalidateQueries({ queryKey: ["contacts"] });
			setFriendMessage("已添加朋友");
		},
		onError: () => setFriendMessage("添加失败"),
	});
	const profile = useQuery({
		queryKey: ["profile", card.data?.ownerId],
		queryFn: () => httpApi.profile(card.data?.ownerId ?? ""),
		enabled: !!card.data,
	});
	if (
		(short && resolved.isPending) ||
		(cardId && card.isPending) ||
		(card.data && profile.isPending) ||
		session.isPending
	)
		return (
			<p role="status" className="p-6">
				正在加载资料…
			</p>
		);
	if (resolved.isError || card.isError || profile.isError || session.isError)
		return (
			<div role="alert" className="p-6">
				<p>加载资料失败</p>
				<Button
					onClick={() => {
						if (resolved.isError) void resolved.refetch();
						if (card.isError) void card.refetch();
						if (profile.isError) void profile.refetch();
						if (session.isError) void session.refetch();
					}}
				>
					重试
				</Button>
			</div>
		);
	if (!card.data || !profile.data)
		return (
			<p role="status" className="p-6">
				这个资料不存在或无法访问
			</p>
		);
	const actor = profile.data.actor;
	return (
		<main className="mx-auto w-full max-w-3xl p-5">
			<section aria-label="身份资料" className="overflow-hidden rounded-[24px] bg-raised shadow-lg">
				<div
					className="h-32 overflow-hidden lg:h-40"
					style={{
						background: `linear-gradient(120deg, ${THEMES[card.data.face?.theme ?? "mist"].from}, ${THEMES[card.data.face?.theme ?? "mist"].to})`,
					}}
				>
					{card.data.display ? (
						<iframe
							title="资料背景"
							sandbox=""
							srcDoc={
								card.data.display.kind === "svg"
									? `<style>html,body{margin:0;height:100%}svg{width:100%;height:100%}</style>${card.data.display.source}`
									: card.data.display.source
							}
							className="pointer-events-none h-full w-full border-0"
						/>
					) : (
						card.data.face?.sticker?.url && (
							<img src={card.data.face.sticker.url} alt="" className="h-full w-full object-cover" />
						)
					)}
				</div>
				<div className="px-5 pb-5">
					<h1 className="pt-4 text-[22px] font-semibold">{actor.name}</h1>
					{actor.code && <p className="text-caption text-muted">ID · {actor.code}</p>}
					<p className="mt-3 text-muted">
						{card.data.face?.headline || card.data.tagline || card.data.summary || profile.data.summary}
					</p>
					{card.data.face?.tags && (
						<ul className="mt-3 flex flex-wrap gap-2">
							{card.data.face.tags.map((tag) => (
								<li key={tag} className="rounded-full bg-tone px-3 py-1 text-caption">
									{tag}
								</li>
							))}
						</ul>
					)}
					<CardContent
						card={card.data}
						actor={actor}
						publicView={actor.id !== session.data?.actor.id}
						showFace={false}
					/>
				</div>
			</section>
			{actor.id !== session.data?.actor.id && (!actor.ownerId || actor.ownerId !== session.data?.actor.id) && (
				<Button
					className="mt-4"
					onClick={() => {
						if (!session.data || session.data.actor.anonymous) setFriendMessage("注册后可加好友，聊天无需注册");
						else friend.mutate(actor.ownerId ?? actor.id);
					}}
				>
					加好友
				</Button>
			)}
			{friendMessage && <p role="status">{friendMessage}</p>}
			{card.data.markdown && (
				<section aria-label="介绍" className="mt-5 rounded-card bg-raised p-5">
					<h2>介绍</h2>
					<article className="break-words">
						<ReactMarkdown>{card.data.markdown}</ReactMarkdown>
					</article>
				</section>
			)}
			{profile.data.agents.length > 0 && (
				<section aria-label="公开 Agent" className="mt-5 rounded-card bg-raised p-5">
					<h2>公开 Agent</h2>
					<ul>
						{profile.data.agents.map((agent) => (
							<li key={agent.id}>
								<a className="block py-3" href={href({ tab: "chats", page: "p", session: agent.code ?? agent.id })}>
									{agent.name}
								</a>
							</li>
						))}
					</ul>
				</section>
			)}
			{profile.data.owner && (
				<a
					className="mt-5 block"
					href={href({ tab: "chats", page: "p", session: profile.data.owner.code ?? profile.data.owner.id })}
				>
					主人 · {profile.data.owner.name}
				</a>
			)}
		</main>
	);
}

function Wallet({ focus }: { focus?: string }) {
	const [selected, setSelected] = useState(focus);
	const session = useQuery({ queryKey: qk.socialSession, queryFn: httpApi.session });
	const cards = useQuery({ queryKey: ["cards"], queryFn: httpApi.cards });
	const contacts = useQuery({ queryKey: ["contacts"], queryFn: httpApi.contacts });
	if (session.isError || cards.isError || contacts.isError)
		return (
			<div role="alert" className="p-6">
				<p>加载名片失败</p>
				<Button
					onClick={() => {
						if (session.isError) void session.refetch();
						if (cards.isError) void cards.refetch();
						if (contacts.isError) void contacts.refetch();
					}}
				>
					重试
				</Button>
			</div>
		);
	if (session.isPending || cards.isPending || contacts.isPending)
		return (
			<p role="status" className="p-6">
				正在加载名片…
			</p>
		);
	const actors = [session.data?.actor, ...(contacts.data ?? [])].filter((actor): actor is Actor => !!actor);
	const items: { card?: Card; actor: Actor }[] = (cards.data ?? [])
		.filter((card) => card.mine)
		.flatMap((card) => {
			const actor = actors.find((item) => item.id === card.ownerId);
			return actor ? [{ card, actor }] : [];
		});
	if (
		session.data?.actor &&
		!items.some(({ card }) => card?.kind === "default" && card.ownerId === session.data?.actor.id)
	)
		items.unshift({ actor: session.data.actor, card: undefined });
	for (const actor of actors) {
		if (
			actor.kind === "agent" &&
			actor.ownerId === session.data?.actor.id &&
			!items.some((item) => item.actor.id === actor.id)
		)
			items.push({ actor, card: undefined });
	}
	if (!items.length)
		return (
			<p role="status" className="p-6">
				暂无名片
			</p>
		);
	const index = Math.max(
		0,
		items.findIndex(
			({ card, actor }) =>
				card?.id === selected || card?.code === selected || actor.id === selected || actor.code === selected,
		),
	);
	const current = items[index];
	if (!current) return null;
	return (
		/* 与名片站 wallet/CardStack 同一副牌：内容列 380、卡片区 300、叠卡位移 8px/旋转 2°。 */
		<main className="mx-auto flex w-full max-w-[380px] flex-col items-center gap-4 px-4 py-5">
			<header className="flex w-full items-center justify-between gap-3 text-small">
				<h1 className="font-semibold">我的名片</h1>
				<span aria-live="polite" className="text-muted">
					{index + 1} / {items.length}
				</span>
			</header>
			<div className="relative mt-4 aspect-[3/4.3] w-full max-w-[300px]">
				{items.slice(1, 3).map(({ card, actor }, i) => (
					<div
						key={card?.id ?? actor.id}
						aria-hidden="true"
						className="absolute inset-0 origin-bottom bg-tone shadow-soft"
						style={{
							borderRadius: "8% / 5.58%",
							transform: `translateY(${-8 * (i + 1)}px) rotate(${2 * (i + 1)}deg) scale(${1 - Math.min(i + 1, 2) * 0.035})`,
						}}
					/>
				))}
				<div className="relative">
					{items.length > 1 && (
						<button
							type="button"
							aria-label="查看下一张名片"
							className="absolute inset-0 z-10 rounded-[24px] outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
							onClick={() =>
								setSelected(items[(index + 1) % items.length]?.card?.id ?? items[(index + 1) % items.length]?.actor.id)
							}
						/>
					)}
					<CardContent card={current.card} actor={current.actor} />
				</div>
			</div>
			<p className="max-w-full truncate text-small font-medium">
				{current.card?.title || current.actor.name}
				{current.card?.kind === "persona" ? " · 历史身份卡" : ""}
			</p>
			{items.length > 1 && <p className="text-caption text-muted">点名片翻到下一张</p>}
			<div className="flex flex-wrap justify-center gap-2">
				<a
					className="press inline-flex h-11 items-center justify-center rounded-full bg-tone px-4 text-small font-medium text-ink hover:bg-tone-2"
					href={href({ tab: "contacts", page: "contacts", session: current.actor.code ?? current.actor.id })}
				>
					查看详情
				</a>
				{items.length > 1 && (
					<Button
						className="h-11"
						onClick={() =>
							setSelected(items[(index + 1) % items.length]?.card?.id ?? items[(index + 1) % items.length]?.actor.id)
						}
					>
						下一张名片
					</Button>
				)}
			</div>
		</main>
	);
}

export function CardPage({ id }: { id?: string }) {
	const route = useRoute();
	return route.page === "u" ? (
		id || route.session ? (
			<PublicCard reference={id ?? route.session ?? ""} />
		) : (
			<p role="status" className="p-6">
				这个资料不存在或无法访问
			</p>
		)
	) : (
		<Wallet focus={id || route.session} />
	);
}
