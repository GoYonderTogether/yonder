import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import type { Card } from "../api/types";
import { appPath } from "../lib/base";
import { copyText } from "../lib/cardActions";
import { botCards, botDraftInput, pendingBotCards } from "../lib/myCard";
import { $session } from "../store";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { toast } from "../ui/Toast";
import { QrDialog } from "./CardShare";

interface Form {
	title: string;
	tagline: string;
	markdown: string;
}

/** /me 里的「Bot 的名片」：Bot 起草的草稿和已发布的名片，网页上审核、编辑、发布或丢弃。 */
export function BotCards() {
	const me = useStore($session)?.actor;
	const qc = useQueryClient();
	const enabled = !!me && !me.anonymous;
	const cardsQuery = useQuery({ queryKey: ["cards"], queryFn: api.cards, enabled });
	const contactsQuery = useQuery({ queryKey: ["contacts"], queryFn: api.contacts, enabled });
	const [editId, setEditId] = useState<string | null>(null);
	const [form, setForm] = useState<Form>({ title: "", tagline: "", markdown: "" });
	const [busy, setBusy] = useState(false);
	const [qrId, setQrId] = useState<string | null>(null);
	if (!me || me.anonymous) return null;
	const cards = botCards(cardsQuery.data, me.id);
	if (!cards.length) return null;
	const pending = pendingBotCards(cards);
	const bot = (card: Card) => contactsQuery.data?.find((a) => a.id === card.ownerId);
	const botName = (card: Card) => bot(card)?.name ?? "Bot";
	const qrCard = cards.find((c) => c.id === qrId);
	const path = (card: Card) => appPath(`/u/${card.code ?? card.id}`);
	const url = (card: Card) => `${location.origin}${path(card)}`;
	const refresh = async () => {
		await qc.invalidateQueries({ queryKey: ["cards"] });
		void qc.invalidateQueries({ queryKey: ["contacts"] });
	};
	const run = async (task: () => Promise<void>, failure: string) => {
		setBusy(true);
		try {
			await task();
		} catch (error) {
			toast(error instanceof Error ? error.message : failure, true);
		} finally {
			setBusy(false);
		}
	};
	const open = (card: Card) => {
		setForm({ title: card.title, tagline: card.tagline ?? "", markdown: card.markdown });
		setEditId(card.id);
	};
	const save = (card: Card, publish: boolean) =>
		run(async () => {
			await api.saveDraft(card.id, botDraftInput(card, form));
			if (publish) await api.publish(card.id);
			await refresh();
			setEditId(null);
			if (publish) setQrId(card.id);
		}, "保存失败");
	const publishNow = (card: Card) =>
		run(async () => {
			await api.publish(card.id);
			await refresh();
			setQrId(card.id);
		}, "发布失败");
	const discard = (card: Card) =>
		run(async () => {
			await api.deleteCard(card.id);
			await refresh();
			setEditId(null);
		}, "丢弃失败");
	return (
		<section aria-label="Bot 的名片" className="rounded-card bg-raised p-5">
			<h2 className="text-small font-medium text-muted">Bot 的名片</h2>
			{pending.length > 0 && (
				<p role="status" className="mt-2 text-small font-medium">
					{botName(pending[0])} 起草了一张名片，去看看
					{pending.length > 1 && `（共 ${pending.length} 张待处理）`}
				</p>
			)}
			<ul className="mt-3 flex flex-col gap-4">
				{cards.map((card) => (
					<li key={card.id} className="flex flex-col gap-2 border-t border-hairline pt-3 first:border-0 first:pt-0">
						{editId === card.id ? (
							<form
								className="flex flex-col gap-3"
								onSubmit={(e) => {
									e.preventDefault();
									if (form.title.trim() && !busy) void save(card, true);
								}}
							>
								<Field
									label="名字"
									value={form.title}
									maxLength={40}
									onChange={(e) => setForm({ ...form, title: e.target.value })}
								/>
								<Field
									label="一句话介绍"
									value={form.tagline}
									onChange={(e) => setForm({ ...form, tagline: e.target.value })}
								/>
								<label className="flex flex-col gap-1.5 text-[13px] text-muted">
									给访客的介绍
									<textarea
										rows={5}
										className="field rounded-control bg-tone p-3.5 text-[15px] text-ink outline-none"
										value={form.markdown}
										onChange={(e) => setForm({ ...form, markdown: e.target.value })}
									/>
								</label>
								<div className="flex flex-wrap gap-2">
									<Button variant="primary" className="h-11" disabled={busy || !form.title.trim()}>
										保存并发布
									</Button>
									<Button
										type="button"
										className="h-11"
										disabled={busy || !form.title.trim()}
										onClick={() => void save(card, false)}
									>
										保存草稿
									</Button>
									<Button type="button" variant="ghost" className="h-11" onClick={() => setEditId(null)}>
										取消
									</Button>
								</div>
							</form>
						) : (
							<>
								<p className="font-medium">
									{card.title || "未命名名片"}
									<span className="ml-2 text-caption font-normal text-muted">
										{card.status === "draft" ? (card.publishedEver ? "有未发布的修改" : "草稿，未发布") : "已发布"} ·{" "}
										{botName(card)} 起草
									</span>
								</p>
								<p className="text-small text-muted">{card.tagline || card.summary || "还没有介绍"}</p>
								{card.status === "published" && (
									<p className="select-text break-all text-caption text-muted">{url(card)}</p>
								)}
								<div className="flex flex-wrap gap-2">
									{card.status === "draft" && (
										<Button variant="primary" className="h-11" disabled={busy} onClick={() => void publishNow(card)}>
											发布
										</Button>
									)}
									<Button className="h-11" disabled={busy} onClick={() => open(card)}>
										编辑
									</Button>
									{card.status === "published" && (
										<>
											<Button className="h-11" onClick={() => setQrId(card.id)}>
												二维码
											</Button>
											<Button className="h-11" onClick={() => void copyText(url(card))}>
												复制链接
											</Button>
										</>
									)}
									{!card.publishedEver && (
										<Button variant="ghost" className="h-11" disabled={busy} onClick={() => void discard(card)}>
											丢弃
										</Button>
									)}
								</div>
							</>
						)}
					</li>
				))}
			</ul>
			{qrCard && (
				<QrDialog
					actor={{ ...(bot(qrCard) ?? me), public: true }}
					card={qrCard}
					url={url(qrCard)}
					share={{ kind: "card", targetId: qrCard.id, path: path(qrCard) }}
					open={qrCard.status === "published"}
					onOpenChange={(o) => !o && setQrId(null)}
				/>
			)}
		</section>
	);
}
