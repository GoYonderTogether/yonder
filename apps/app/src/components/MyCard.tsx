import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { api } from "../api";
import { appPath } from "../lib/base";
import { copyText } from "../lib/cardActions";
import { canSaveCard, draftInput, formFromCard, type MyCardForm, pickMyCard } from "../lib/myCard";
import { $session } from "../store";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { toast } from "../ui/Toast";
import { QrDialog } from "./CardShare";

/** /me 里的「我的名片」：名字、一句话、开场白三项，保存即发布，发布后直接给二维码和链接。 */
export function MyCard() {
	const me = useStore($session)?.actor;
	const qc = useQueryClient();
	const [params] = useSearchParams();
	const query = useQuery({ queryKey: ["cards"], queryFn: api.cards, enabled: !!me && !me.anonymous });
	const [editing, setEditing] = useState(params.get("card") === "new");
	const [draft, setDraft] = useState<MyCardForm | null>(null);
	const [busy, setBusy] = useState(false);
	const [qr, setQr] = useState(false);
	if (!me || me.anonymous) return null;
	const card = pickMyCard(query.data, me.id);
	// 未改动时跟随服务端数据，所以从 ?card=new 直接进来也能带出当前名字和介绍
	const form = draft ?? formFromCard(card, me.name);
	const setForm = setDraft;
	const ready = !!query.data;
	const code = card?.code ?? card?.id;
	const path = code ? appPath(`/u/${code}`) : "";
	const url = code ? `${location.origin}${path}` : "";
	const edit = () => {
		setDraft(null);
		setEditing(true);
	};
	const save = async () => {
		setBusy(true);
		try {
			const base = card ?? (await api.createCard());
			const name = form.name.trim();
			if (name !== me.name) $session.set({ actor: await api.updateProfile({ name }) });
			await api.saveDraft(base.id, draftInput(form));
			await api.publish(base.id);
			await qc.invalidateQueries({ queryKey: ["cards"] });
			void qc.invalidateQueries({ queryKey: ["profile"] });
			setEditing(false);
			setQr(true);
		} catch (error) {
			toast(error instanceof Error ? error.message : "保存失败", true);
		} finally {
			setBusy(false);
		}
	};
	return (
		<section aria-label="我的名片" className="rounded-card bg-raised p-5">
			<h2 className="text-small font-medium text-muted">我的名片</h2>
			{editing ? (
				<form
					className="mt-3 flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (canSaveCard(form)) void save();
					}}
				>
					<Field
						label="名字"
						value={form.name}
						maxLength={40}
						onChange={(e) => setForm({ ...form, name: e.target.value })}
					/>
					<Field
						label="一句话介绍"
						value={form.tagline}
						onChange={(e) => setForm({ ...form, tagline: e.target.value })}
					/>
					<Field
						label="给访客的开场白（可选）"
						value={form.greeting}
						onChange={(e) => setForm({ ...form, greeting: e.target.value })}
					/>
					<div className="flex gap-2">
						<Button variant="primary" className="h-11" disabled={busy || !canSaveCard(form)}>
							保存并发布
						</Button>
						<Button type="button" variant="ghost" className="h-11" onClick={() => setEditing(false)}>
							取消
						</Button>
					</div>
				</form>
			) : (
				<div className="mt-2 flex flex-col gap-3">
					{card && (
						<p className="text-small text-muted">
							{card.tagline || card.summary || "还没有介绍"}
							{card.status === "draft" && "（草稿，未发布）"}
						</p>
					)}
					{card?.status === "published" && <p className="select-text break-all text-caption text-muted">{url}</p>}
					<div className="flex flex-wrap gap-2">
						<Button variant="primary" className="h-11" disabled={!ready} onClick={edit}>
							{card ? "编辑名片" : "建我的名片"}
						</Button>
						{card?.status === "published" && (
							<>
								<Button className="h-11" onClick={() => setQr(true)}>
									二维码
								</Button>
								<Button className="h-11" onClick={() => void copyText(url)}>
									复制链接
								</Button>
							</>
						)}
					</div>
				</div>
			)}
			{card && (
				<QrDialog
					actor={me}
					card={card}
					url={url}
					share={{ kind: "card", targetId: card.id, path }}
					open={qr && card.status === "published"}
					onOpenChange={setQr}
				/>
			)}
		</section>
	);
}
