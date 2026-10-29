import { ArrowLeft, ArrowRight, ChevronRight, MessageCircle, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { messagesFor } from "../../market/flows";
import { timeAgo } from "../../market/matching";
import type { Inquiry, Listing } from "../../market/types";
import { SellerAvatar } from "./MarketUI";

export function MarketInbox({
	listings,
	inquiries,
	selected,
	storageKey,
	onSelect,
	onBack,
	onOpen,
	onBrowse,
	onSend,
}: {
	listings: Listing[];
	inquiries: Inquiry[];
	selected?: Listing;
	storageKey: string;
	onSelect: (l: Listing) => void;
	onBack: () => void;
	onOpen: (l: Listing) => void;
	onBrowse: () => void;
	onSend: (l: Listing, body: string) => void;
}) {
	if (selected)
		return (
			<Conversation
				key={selected.id}
				listing={selected}
				inquiry={inquiries.find((i) => i.listingId === selected.id)}
				storageKey={storageKey}
				onBack={onBack}
				onOpen={() => onOpen(selected)}
				onSend={(body) => onSend(selected, body)}
			/>
		);
	return (
		<section className="mk-workspace mk-narrow">
			<div className="mk-section-title">
				<div>
					<h1>消息</h1>
					<p>每一段沟通，都从一个具体的需要开始。</p>
				</div>
			</div>
			<div className="mk-conversation-list">
				{inquiries.map((i) => {
					const listing = listings.find((l) => l.id === i.listingId);
					return (
						listing && (
							<button type="button" key={i.id} className="mk-conversation-row" onClick={() => onSelect(listing)}>
								<SellerAvatar name={i.seller} />
								<div>
									<div>
										<strong>{i.seller}</strong>
										<time>{timeAgo(i.createdAt)}</time>
									</div>
									<p>{i.title}</p>
									<span>{i.body}</span>
								</div>
								<img src={listing.image} alt="" />
								<ChevronRight size={17} />
							</button>
						)
					);
				})}
			</div>
			{!inquiries.length && (
				<div className="mk-empty">
					<MessageCircle size={34} />
					<h3>还没有开始的对话</h3>
					<p>遇到心动的商品或服务，点「聊一聊」。</p>
					<button type="button" className="mk-button mk-primary" onClick={onBrowse}>
						去市场看看
						<ArrowRight size={16} />
					</button>
				</div>
			)}
		</section>
	);
}
function Conversation({
	listing,
	inquiry,
	storageKey,
	onBack,
	onOpen,
	onSend,
}: {
	listing: Listing;
	inquiry?: Inquiry;
	storageKey: string;
	onBack: () => void;
	onOpen: () => void;
	onSend: (body: string) => void;
}) {
	const key = `${storageKey}:message:${listing.id}`;
	const [draft, setDraft] = useState(() => {
		try {
			return localStorage.getItem(key) ?? "";
		} catch {
			return "";
		}
	});
	const [assist, setAssist] = useState(false);
	const endRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const messages = inquiry ? messagesFor(inquiry) : [];
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在新消息到达时滚到底部，历史替换不滚动
	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "nearest" });
	}, [messages.length]);
	const update = (text: string) => {
		setDraft(text);
		try {
			localStorage.setItem(key, text);
		} catch {
			/* Keep the composer usable. */
		}
	};
	const send = () => {
		if (!draft.trim()) return;
		onSend(draft.trim());
		update("");
		setAssist(false);
		textareaRef.current?.focus();
	};
	const addQuestion = (question: string) => {
		update(draft.trim() ? `${draft.trim()}\n${question}` : question);
		textareaRef.current?.focus();
	};
	return (
		<section className="mk-conversation mk-narrow">
			<header className="mk-chat-heading">
				<button type="button" className="mk-icon-button" aria-label="返回消息" onClick={onBack}>
					<ArrowLeft size={20} />
				</button>
				<SellerAvatar name={listing.seller} />
				<div>
					<h1>{listing.seller}</h1>
					<p>{listing.sellerRole}</p>
				</div>
			</header>
			<button type="button" className="mk-chat-product" onClick={onOpen}>
				<img src={listing.image} alt="" />
				<span>
					<strong>{listing.title}</strong>
					<small>
						¥{listing.price.toLocaleString()}
						{listing.unit}
					</small>
				</span>
				<ChevronRight size={18} />
			</button>
			<div className="mk-chat-scroll">
				<p className="mk-chat-notice">预览会话 · 消息仅保存在此浏览器，不会发送给卖家</p>
				{!messages.length && (
					<div className="mk-chat-intro">
						<MessageCircle size={27} />
						<p>打个招呼，或让 Bot 整理想问的问题。</p>
					</div>
				)}
				{messages.map((m) => (
					<article className="mk-chat-message" key={m.id}>
						<p>{m.body}</p>
						<span>
							{new Date(m.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · 已保存在本机
						</span>
					</article>
				))}
				<div ref={endRef} />
			</div>
			<div className="mk-chat-compose">
				{assist && (
					<div className="mk-question-choices">
						<p>点选要问的问题，发送前可以编辑</p>
						{[...listing.missing.map((m) => `想确认一下：${m}？`), `${listing.delivery}，具体时间可以怎么安排？`].map(
							(q) => (
								<button type="button" key={q} onClick={() => addQuestion(q)}>
									{q}
									<PlusIcon />
								</button>
							),
						)}
					</div>
				)}
				<button type="button" className="mk-assist-toggle" aria-expanded={assist} onClick={() => setAssist((v) => !v)}>
					<Sparkles size={16} />
					帮我问清楚
				</button>
				<form
					className="mk-composer"
					onSubmit={(e) => {
						e.preventDefault();
						send();
					}}
				>
					<textarea
						ref={textareaRef}
						aria-label="消息内容"
						rows={2}
						value={draft}
						onChange={(e) => update(e.target.value)}
						placeholder="想了解什么？"
						onKeyDown={(e) => {
							if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !e.nativeEvent.isComposing) {
								e.preventDefault();
								send();
							}
						}}
					/>
					<button type="button" className="mk-send" aria-label="保存消息" disabled={!draft.trim()}>
						<Send size={19} />
					</button>
				</form>
			</div>
		</section>
	);
}
function PlusIcon() {
	return <span aria-hidden="true">+</span>;
}
