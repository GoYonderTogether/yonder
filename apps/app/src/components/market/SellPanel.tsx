import {
	ArrowLeft,
	ArrowRight,
	Briefcase,
	ChartNoAxesColumn,
	Check,
	HandHelping,
	Heart,
	Lightbulb,
	Package,
	Pencil,
	Plus,
	Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { compactCount, hasListingImage, kindLabel, priceLabel, viewCount } from "../../market/catalog";
import { CATEGORIES } from "../../market/data";
import type { Listing, ListingKind } from "../../market/types";
import { ListingCard } from "./ListingCard";
import { MarketDialog } from "./MarketUI";

const BLANK = {
	kind: "item" as ListingKind,
	category: CATEGORIES[0],
	title: "",
	description: "",
	price: "",
	unit: "",
	location: "上海",
	delivery: "",
	discoverable: true,
	image: "",
};
export function PublishDialog({
	open,
	close,
	editing,
	storageKey,
	onPublish,
}: {
	open: boolean;
	close: () => void;
	editing?: Listing;
	storageKey: string;
	onPublish: (listing: Listing) => Promise<boolean>;
}) {
	const [form, setForm] = useState(BLANK);
	const [step, setStep] = useState(0);
	const openEnded = form.kind === "idea" || form.kind === "job";
	const [error, setError] = useState("");
	const [publishing, setPublishing] = useState(false);
	const draftKey = `${storageKey}:publish:${editing?.id ?? "new"}`;
	// biome-ignore lint/correctness/useExhaustiveDependencies: 草稿只在对话框打开时恢复一次，输入变化不应重跑
	useEffect(() => {
		if (!open) return;
		let draft: { form: typeof BLANK; step: number } | undefined;
		try {
			draft = JSON.parse(localStorage.getItem(draftKey) ?? "null");
		} catch {
			/* Start without a draft. */
		}
		setForm(
			draft?.form ??
				(editing
					? {
							kind: editing.kind,
							category: editing.category,
							title: editing.title,
							description: editing.description,
							price: String(editing.price),
							unit: editing.unit,
							location: editing.location,
							delivery: editing.delivery,
							discoverable: editing.discoverable !== false,
							image: editing.image,
						}
					: { ...BLANK }),
		);
		setStep(draft?.step ?? (editing ? 1 : 0));
		setError("");
		setPublishing(false);
	}, [open, draftKey]);
	const persist = (next: typeof BLANK, nextStep = step) => {
		setForm(next);
		setError("");
		try {
			localStorage.setItem(draftKey, JSON.stringify({ form: next, step: nextStep }));
		} catch {
			setError("草稿存储空间不足，可换一张较小的图片");
		}
	};
	const go = (next: number) => {
		setStep(next);
		persist(form, next);
	};
	const update = <K extends keyof typeof BLANK>(key: K, value: (typeof BLANK)[K]) => persist({ ...form, [key]: value });
	const next = () => {
		if (step === 1 && (!form.title.trim() || !form.description.trim())) {
			setError("请填写标题和描述");
			return;
		}
		if (step === 2) {
			if (
				(!openEnded && !form.price) ||
				!Number.isFinite(Number(form.price)) ||
				(openEnded ? Number(form.price) < 0 : Number(form.price) <= 0)
			) {
				setError(openEnded ? "金额不能为负数" : "请填写大于 0 的价格");
				return;
			}
			if (!form.location.trim() || !form.delivery.trim()) {
				setError("请填写地点和交付方式");
				return;
			}
		}
		go(step + 1);
	};
	const publish = async () => {
		if (publishing) return;
		const listing: Listing = {
			id: editing?.id ?? crypto.randomUUID(),
			kind: form.kind,
			category: form.category,
			title: form.title.trim(),
			description: form.description.trim(),
			price: Number(form.price),
			unit: form.unit.trim(),
			location: form.location.trim(),
			delivery: form.delivery.trim(),
			image: !editing && !hasListingImage(form.image) ? "" : form.image,
			seller: "我",
			sellerRole: "个人" + kindLabel(form.kind),
			tags: ["个人发布"],
			agent: editing?.agent ?? false,
			discoverable: form.discoverable,
			mine: true,
			facts: editing?.facts.map((f) =>
				f.label === "交付"
					? { ...f, value: form.delivery.trim() }
					: f.label === "分类"
						? { ...f, value: form.category }
						: f,
			) ?? [{ label: "分类", value: form.category }],
			missing: editing?.missing ?? ["具体细节与时间安排"],
			createdAt: editing?.createdAt ?? Date.now(),
			metricSource: editing?.metricSource,
			metrics: editing?.metrics ?? { agentViews: 0, shortlists: 0, humanViews: 0, inquiries: 0 },
			paused: editing?.paused,
		};
		setPublishing(true);
		let published = false;
		try {
			published = await onPublish(listing);
		} catch {
			published = false;
		}
		setPublishing(false);
		// 发布失败时保留草稿（B1）：只有服务端确认写入后才清掉本地草稿。
		if (!published) return;
		try {
			localStorage.removeItem(draftKey);
		} catch {
			/* No stored draft. */
		}
	};
	return (
		<MarketDialog
			open={open}
			close={close}
			title={["发布什么？", "让人一眼了解", openEnded ? "安排与费用" : "价格与交付", "确认发布"][step]}
		>
			<form
				className="mk-publish-form"
				onSubmit={(e) => {
					e.preventDefault();
					if (step < 3) next();
					else void publish();
				}}
			>
				<div className="mk-dialog-body">
					<div className="mk-steps">
						{[0, 1, 2, 3].map((i) => (
							<span key={i} className={cn(i <= step && "is-active")} />
						))}
					</div>
					{step === 0 && (
						<div className="mk-kind-options">
							{(
								[
									{ kind: "item", label: "闲置好物", desc: "把用不上的，交给用得上的人", icon: Package },
									{ kind: "service", label: "个人服务", desc: "让你的手艺和经验被找到", icon: Sparkles },
									{ kind: "idea", label: "分享创意", desc: "分享一个想法，找到一起做的人", icon: Lightbulb },
									{ kind: "job", label: "寻找伙伴", desc: "发布招聘、兼职或合作机会", icon: Briefcase },
									{ kind: "request", label: "发布求助", desc: "公开一个需要，等合适的人回应", icon: HandHelping },
								] as const
							).map(({ kind, label, desc, icon: Icon }) => (
								<button
									type="button"
									key={kind}
									aria-pressed={form.kind === kind}
									className={cn(form.kind === kind && "is-active")}
									onClick={() =>
										persist({
											...form,
											kind,
											category:
												kind === "service" || kind === "idea"
													? "创意服务"
													: kind === "job"
														? "技能与陪伴"
														: form.category,
											unit: kind === "service" ? "/ 次" : kind === "request" ? "预算" : "",
										})
									}
								>
									<Icon size={24} />
									<span>
										<strong>{label}</strong>
										<small>{desc}</small>
									</span>
									{form.kind === kind ? <Check size={19} /> : <Plus size={19} />}
								</button>
							))}
						</div>
					)}
					{step === 1 && (
						<>
							<label className="mk-form-label">
								标题（必填）
								<input
									maxLength={60}
									placeholder={
										openEnded
											? "例如：找人一起做一场小型展览"
											: form.kind === "service"
												? "例如：帮你拍一组有质感的产品照"
												: "品牌、型号，或者你能提供的帮助"
									}
									aria-required="true"
									value={form.title}
									onChange={(e) => update("title", e.target.value)}
								/>
							</label>
							<label className="mk-form-label">
								描述（必填）
								<textarea
									rows={4}
									placeholder={
										openEnded
											? "你的想法是什么？希望找到什么样的人？"
											: form.kind === "service"
												? "你能提供什么？交付内容、所需时间和费用包含哪些？"
												: form.kind === "request"
													? "想解决什么问题？期待的结果和时间要求是什么？"
													: "使用情况、配件、瑕疵，尽量说清楚。"
									}
									aria-required="true"
									value={form.description}
									onChange={(e) => update("description", e.target.value)}
								/>
							</label>
							<label className="mk-form-label">
								分类
								<select
									value={form.category}
									onChange={(e) => update("category", e.target.value as typeof form.category)}
								>
									{CATEGORIES.map((c) => (
										<option key={c}>{c}</option>
									))}
								</select>
							</label>
						</>
					)}
					{step === 2 && (
						<>
							<div className="mk-form-grid">
								<label className="mk-form-label">
									{openEnded
										? "金额（可留空，面议）"
										: form.kind === "request"
											? "预算（元，必填）"
											: "价格（元，必填）"}
									<input
										type="number"
										min={openEnded ? "0" : "0.01"}
										step="0.01"
										placeholder={openEnded ? "面议" : "0.00"}
										aria-required={!openEnded}
										value={form.price}
										onChange={(e) => update("price", e.target.value)}
									/>
								</label>
								<label className="mk-form-label">
									计价方式
									<input
										placeholder="例如：/ 次、/ 小时"
										value={form.unit}
										onChange={(e) => update("unit", e.target.value)}
									/>
								</label>
							</div>
							<label className="mk-form-label">
								所在城市（必填）
								<input
									placeholder="城市或线上"
									aria-required="true"
									value={form.location}
									onChange={(e) => update("location", e.target.value)}
								/>
							</label>
							<label className="mk-form-label">
								{openEnded ? "参与方式（必填）" : "交付方式（必填）"}
								<input
									placeholder={openEnded ? "例如：线上交流、到店面谈" : "例如：同城面交、邮寄、线上交付"}
									aria-required="true"
									value={form.delivery}
									onChange={(e) => update("delivery", e.target.value)}
								/>
							</label>
							<label className="mk-toggle-row">
								<span>
									<strong>允许 Bot 发现</strong>
									<small>让合适的需求主动找到你</small>
								</span>
								<input
									type="checkbox"
									role="switch"
									aria-checked={form.discoverable}
									checked={form.discoverable}
									onChange={(e) => update("discoverable", e.target.checked)}
								/>
							</label>
						</>
					)}
					{step === 3 && (
						<div className="mk-publish-review">
							{hasListingImage(form.image) && <img src={form.image} alt="发布封面" />}
							<p className="mk-muted">
								{form.category} · {form.location}
							</p>
							<h2>{form.title}</h2>
							<p className="mk-price">{priceLabel({ ...form, price: Number(form.price) })}</p>
							<p className="mk-description">{form.description}</p>
							<div className="mk-review-delivery">
								{form.delivery}
								<span>{form.discoverable ? "Bot 可发现" : "不参与 Bot 匹配"}</span>
							</div>
						</div>
					)}
					{error && (
						<p role="alert" className="mk-error">
							{error}
						</p>
					)}
				</div>
				<div className="mk-wizard-footer">
					{step > 0 ? (
						<button type="button" className="mk-button" onClick={() => go(step - 1)}>
							<ArrowLeft size={16} />
							上一步
						</button>
					) : (
						<span className="mk-form-hint">草稿自动保留</span>
					)}
					<button type="submit" className="mk-button mk-primary" disabled={publishing}>
						{publishing ? "发布中…" : step === 3 ? (editing ? "保存修改" : "确认发布") : "下一步"}
						{step === 3 ? <Check size={16} /> : <ArrowRight size={16} />}
					</button>
				</div>
			</form>
		</MarketDialog>
	);
}

export function SellerWorkspace({
	listings,
	saved,
	tab,
	onTab,
	onEdit,
	onToggle,
	onOpen,
	onSave,
	onStats,
	onBrowse,
}: {
	listings: Listing[];
	saved: string[];
	tab: string;
	onTab: (tab: string) => void;
	onEdit: (l: Listing) => void;
	onToggle: (id: string) => void;
	onOpen: (l: Listing) => void;
	onSave: (id: string) => void;
	onStats: (l: Listing) => void;
	onBrowse: () => void;
}) {
	const [confirmPause, setConfirmPause] = useState<Listing | null>(null);
	const mine = listings.filter((l) => l.mine);
	const items =
		tab === "saved"
			? listings.filter((l) => saved.includes(l.id))
			: mine.filter((l) => (tab === "paused" ? l.paused : !l.paused));
	return (
		<section className="mk-workspace mk-narrow">
			<div className="mk-personal-tabs">
				{[
					{ id: "published", label: "已发布", count: mine.filter((l) => !l.paused).length },
					{ id: "paused", label: "已下架", count: mine.filter((l) => l.paused).length },
				].map((t) => (
					<button
						type="button"
						key={t.id}
						aria-pressed={tab === t.id}
						className={cn(tab === t.id && "is-active")}
						onClick={() => onTab(t.id)}
					>
						{t.label}
						<span>{t.count}</span>
					</button>
				))}
			</div>
			{tab === "saved" ? (
				<div className="mk-feed-grid mk-saved-grid">
					{items.map((l) => (
						<div key={l.id}>
							<ListingCard listing={l} saved onOpen={() => onOpen(l)} onSave={() => onSave(l.id)} />
							{l.paused && <p className="mk-form-hint">已下架</p>}
						</div>
					))}
				</div>
			) : (
				<div className="mk-my-listings">
					{items.map((l) => (
						<article key={l.id}>
							<button
								type="button"
								className="mk-my-listing-image"
								aria-label={`查看${l.title}`}
								onClick={() => onOpen(l)}
							>
								{hasListingImage(l.image) && <img src={l.image} alt="" />}
							</button>
							<div className="mk-my-listing-info">
								<button type="button" onClick={() => onOpen(l)}>
									{l.title}
								</button>
								<p className="mk-price">{priceLabel(l)}</p>
								<p className="mk-muted">
									{kindLabel(l.kind)} · {l.location} · {compactCount(viewCount(l))} 浏览
								</p>
							</div>
							<div className="mk-my-listing-actions">
								<button type="button" className="mk-button" onClick={() => onStats(l)}>
									<ChartNoAxesColumn size={16} />
									数据
								</button>
								<button type="button" className="mk-button" onClick={() => onEdit(l)}>
									<Pencil size={15} />
									编辑
								</button>
								<button
									type="button"
									className="mk-button"
									onClick={() => (l.paused ? onToggle(l.id) : setConfirmPause(l))}
								>
									{l.paused ? "重新上架" : "下架"}
								</button>
							</div>
						</article>
					))}
				</div>
			)}
			{!items.length && (
				<div className="mk-empty">
					{tab === "saved" ? <Heart size={32} /> : <Package size={32} />}
					<h3>{tab === "saved" ? "喜欢的，先留下来" : tab === "paused" ? "没有下架的发布" : "还没有发布"}</h3>
					<p>
						{tab === "saved"
							? "收藏好物和服务，之后在这里继续看。"
							: "点击右上角「发布」，分享物品、服务、创意或机会。"}
					</p>
					{tab === "saved" && (
						<button type="button" className="mk-button" onClick={onBrowse}>
							去市场看看
							<ArrowRight size={16} />
						</button>
					)}
				</div>
			)}
			<MarketDialog open={!!confirmPause} close={() => setConfirmPause(null)} title="确认下架？">
				<div className="mk-dialog-body">
					<p>{confirmPause?.title}</p>
					<div className="mk-my-listing-actions">
						<button type="button" className="mk-button" onClick={() => setConfirmPause(null)}>
							取消
						</button>
						<button
							type="button"
							className="mk-button mk-primary"
							onClick={() => {
								if (confirmPause) onToggle(confirmPause.id);
								setConfirmPause(null);
							}}
						>
							确认下架
						</button>
					</div>
				</div>
			</MarketDialog>
		</section>
	);
}
