import {
	ArrowLeft,
	ArrowRight,
	Check,
	ChevronRight,
	Play,
	Plus,
	RefreshCw,
	Search,
	SlidersHorizontal,
	Sparkles,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { hasListingImage } from "../../market/catalog";
import { CATEGORIES } from "../../market/data";
import { inferBrief, taskBrief, timeAgo } from "../../market/matching";
import { matchesOf } from "../../market/needs";
import type { AgentTask, Listing, Match, SearchBrief } from "../../market/types";
import { AgentMark, MarketDialog } from "./MarketUI";

const EXAMPLES = [
	"想买台轻便的旅行相机，3000 元以内",
	"想把手作产品拍得更好看，预算 800 元",
	"周末想学会手冲咖啡，上海，300 元以内",
];
/** 原型构建没有云端市场；需求只能存进真实的 watch_tasks。 */
const USE_REAL_MARKET = "需求需要连接真实市场服务";
export function AgentBriefDialog({
	open,
	close,
	editingTask,
	initialText,
	storageKey,
	saving,
	onSave,
}: {
	open: boolean;
	close: () => void;
	editingTask?: AgentTask;
	initialText: string;
	storageKey: string;
	saving?: boolean;
	onSave: (brief: SearchBrief, id?: string) => Promise<boolean>;
}) {
	const [step, setStep] = useState(0);
	const [text, setText] = useState("");
	const [brief, setBrief] = useState<SearchBrief>(inferBrief(""));
	const [error, setError] = useState("");
	const key = `${storageKey}:need:${editingTask?.id ?? "new"}`;
	// biome-ignore lint/correctness/useExhaustiveDependencies: 草稿只在对话框打开时恢复一次，输入变化不应重跑
	useEffect(() => {
		if (!open) return;
		let draft: { text: string; brief: SearchBrief; step: number } | undefined;
		try {
			draft = JSON.parse(localStorage.getItem(key) ?? "null");
		} catch {
			/* No saved draft. */
		}
		setText(draft?.text ?? editingTask?.text ?? initialText);
		setBrief(draft?.brief ?? (editingTask ? taskBrief(editingTask) : inferBrief(initialText)));
		setStep(draft?.step ?? (editingTask ? 1 : 0));
		setError("");
	}, [open, key]);
	const persist = (nextText: string, nextBrief: SearchBrief, nextStep: number) => {
		try {
			localStorage.setItem(key, JSON.stringify({ text: nextText, brief: nextBrief, step: nextStep }));
		} catch {
			/* Keep working in memory. */
		}
	};
	const changeBrief = (next: SearchBrief) => {
		setBrief(next);
		persist(text, next, step);
		setError("");
	};
	const clarify = () => {
		if (!text.trim()) {
			setError("说说你想找什么");
			return;
		}
		const next = inferBrief(text);
		setBrief(next);
		setStep(1);
		persist(text, next, 1);
		setError("");
	};
	const submit = async () => {
		if (!Number.isFinite(brief.budget) || brief.budget <= 0) {
			setError("请填写大于 0 的预算");
			return;
		}
		// 频率不在这个表单里：编辑时保留云端原值（Bot 的排程照旧），新建为手动检查。
		const next = {
			...brief,
			frequency: editingTask?.frequency ?? ("手动" as const),
			location: brief.location.trim() || "不限",
		};
		const saved = await onSave(next, editingTask?.id);
		// 只有云端确实保存成功才丢弃草稿；失败时用户还能直接重试。
		if (!saved) return;
		try {
			localStorage.removeItem(key);
		} catch {
			/* Storage may be unavailable. */
		}
	};
	return (
		<MarketDialog open={open} close={close} title={step === 0 ? "你在找什么？" : "确认寻找条件"}>
			<div className="mk-dialog-body">
				<div className="mk-steps">
					<span className="is-active" />
					<span className={cn(step === 1 && "is-active")} />
				</div>
				{step === 0 ? (
					<>
						<label className="mk-form-label">
							描述你的需要
							<textarea
								// biome-ignore lint/a11y/noAutofocus: 保留伙伴原版行为，打开寻找面板即聚焦输入框
								autoFocus
								rows={4}
								placeholder="想解决什么问题？预算、地点也可以一起说。"
								value={text}
								onChange={(e) => {
									setText(e.target.value);
									persist(e.target.value, brief, 0);
									setError("");
								}}
							/>
						</label>
						<div className="mk-example-list">
							{EXAMPLES.map((example) => (
								<button
									type="button"
									key={example}
									onClick={() => {
										setText(example);
										persist(example, brief, 0);
									}}
								>
									<span>{example}</span>
									<Plus size={16} />
								</button>
							))}
						</div>
					</>
				) : (
					<>
						<p className="mk-brief-quote">{text}</p>
						<div className="mk-form-grid">
							<label className="mk-form-label">
								寻找范围
								<select
									value={brief.category}
									onChange={(e) => changeBrief({ ...brief, category: e.target.value as SearchBrief["category"] })}
								>
									<option>不限</option>
									{CATEGORIES.map((c) => (
										<option key={c}>{c}</option>
									))}
								</select>
							</label>
							<label className="mk-form-label">
								预算上限（元）
								<input
									type="number"
									min="1"
									value={brief.budget || ""}
									onChange={(e) => changeBrief({ ...brief, budget: Number(e.target.value) })}
								/>
							</label>
							<label className="mk-form-label">
								优先城市
								<input value={brief.location} onChange={(e) => changeBrief({ ...brief, location: e.target.value })} />
							</label>
						</div>
						<fieldset className="mk-priority">
							<legend>更看重什么？</legend>
							<div className="mk-chip-row">
								{(["最合适", "价格优先", "同城优先"] as const).map((p) => (
									<button
										type="button"
										key={p}
										className={cn("mk-chip", brief.priority === p && "is-active")}
										aria-pressed={brief.priority === p}
										onClick={() => changeBrief({ ...brief, priority: p })}
									>
										{p}
									</button>
								))}
							</div>
						</fieldset>
					</>
				)}
				{error && (
					<p className="mk-error" role="alert">
						{error}
					</p>
				)}
				<div className="mk-form-actions">
					{step === 1 ? (
						<button
							type="button"
							className="mk-button"
							onClick={() => {
								setStep(0);
								persist(text, brief, 0);
							}}
						>
							<ArrowLeft size={16} />
							上一步
						</button>
					) : (
						<span className="mk-form-hint">输入自动保留</span>
					)}
					<button
						type="button"
						className="mk-button mk-primary"
						disabled={saving}
						onClick={step === 0 ? clarify : () => void submit()}
					>
						{step === 0 ? "下一步" : saving ? "保存中…" : editingTask ? "保存条件" : "保存需求"}
						<ArrowRight size={16} />
					</button>
				</div>
			</div>
		</MarketDialog>
	);
}

export function AgentWorkspace({
	tasks,
	loading,
	error,
	matches,
	selectedId,
	onSelect,
	onBack,
	onNew,
	onEdit,
	onDelegate,
	onToggle,
	onDelete,
	onOpen,
	onCompare,
	busy,
}: {
	tasks: AgentTask[];
	loading: boolean;
	error: Error | null;
	/** 每条需求一份只读候选（云端帖子搜索），键是任务 id。 */
	matches: Record<string, { items: Listing[]; isPending: boolean; isError: boolean; refetch: () => void }>;
	selectedId?: string;
	onDelegate: (task: AgentTask) => void;
	onSelect: (id: string) => void;
	onBack: () => void;
	onNew: () => void;
	onEdit: () => void;
	onToggle: (id: string, active: boolean) => void;
	onDelete: (task: AgentTask) => void;
	onOpen: (listing: Listing) => void;
	onCompare: (ids: string[]) => void;
	busy?: string;
}) {
	const task = tasks.find((t) => t.id === selectedId);
	const results: Match[] = task ? matchesOf(matches[task.id]?.items ?? [], task) : [];
	if (!task)
		return (
			<section className="mk-workspace mk-narrow">
				<div className="mk-section-title" style={{ justifyContent: "flex-end" }}>
					<button type="button" className="mk-button mk-primary" onClick={onNew}>
						<Plus size={18} />
						新建需求
					</button>
				</div>
				{loading && (
					<div className="mk-task-list" aria-busy="true">
						<span className="sr-only">正在加载需求</span>
						{["a", "b"].map((slot) => (
							<div key={slot} className="mk-skeleton-card" />
						))}
					</div>
				)}
				{error && (
					<div className="mk-empty" role="alert">
						<Search size={30} />
						<h3>需求暂时无法加载</h3>
						<p>{error.message === USE_REAL_MARKET ? USE_REAL_MARKET : "没能连上市场服务，请检查网络后重试。"}</p>
					</div>
				)}
				{!loading && !error && (
					<div className="mk-task-list">
						{tasks.map((t) => {
							const items = matchesOf(matches[t.id]?.items ?? [], t);
							return (
								<button type="button" key={t.id} className="mk-task-select" onClick={() => onSelect(t.id)}>
									<AgentMark />
									<div className="mk-task-copy">
										<h3>{t.title}</h3>
										<p>
											¥{t.budget.toLocaleString()} 以内 · {t.location} · {t.active ? "寻找中" : "已完成"}
										</p>
										<span>
											{items.length ? `${items.length} 个候选` : "暂无候选"}
											{t.checkedAt ? ` · Bot 上次检查 ${timeAgo(t.checkedAt)}` : ""}
										</span>
									</div>
									<div className="mk-task-thumbs">
										{items
											.filter((m) => hasListingImage(m.listing.image))
											.slice(0, 3)
											.map((m) => (
												<img key={m.listing.id} src={m.listing.image} alt="" />
											))}
									</div>
									<ChevronRight size={19} />
								</button>
							);
						})}
					</div>
				)}
				{!loading && !error && !tasks.length && (
					<div className="mk-empty">
						<Sparkles size={32} />
						<h3>还没有保存的需求</h3>
						<p>保存条件后会存到云端，换手机也不会丢。</p>
					</div>
				)}
				<p className="mk-footnote">候选来自云端市场搜索 · 只按已填写的条件筛选</p>
			</section>
		);
	const state = matches[task.id];
	const refreshing = busy === task.id || !!state?.isPending;
	return (
		<section className="mk-workspace mk-narrow">
			<button type="button" className="mk-back" onClick={onBack}>
				<ArrowLeft size={18} />
				全部需求
			</button>
			<div className="mk-section-title">
				<div>
					<h1>{task.title}</h1>
					<p>
						¥{task.budget.toLocaleString()} 以内 · {task.location} · {task.priority}
					</p>
				</div>
				<button type="button" className="mk-button" onClick={onEdit}>
					<SlidersHorizontal size={16} />
					调整条件
				</button>
			</div>
			<div className="mk-task-toolbar">
				<span>
					{state?.isPending
						? "正在搜索…"
						: state?.isError
							? "搜索失败"
							: `${task.checkedAt ? `Bot 上次检查 ${timeAgo(task.checkedAt)} · ` : ""}${results.length} 个候选`}
				</span>
				<div>
					<button
						type="button"
						className="mk-icon-button"
						aria-label="重新搜索"
						disabled={!!busy || state?.isPending}
						onClick={() => state?.refetch()}
					>
						<RefreshCw size={18} className={cn(refreshing && "mk-working")} />
					</button>
					<button
						type="button"
						className="mk-button"
						disabled={busy === task.id}
						onClick={() => onToggle(task.id, !task.active)}
					>
						{task.active ? <Check size={15} /> : <Play size={15} />}
						{task.active ? "标记完成" : "继续寻找"}
					</button>
					<button
						type="button"
						className="mk-icon-button text-danger"
						aria-label="删除需求"
						disabled={busy === task.id}
						onClick={() => onDelete(task)}
					>
						<Trash2 size={18} />
					</button>
				</div>
			</div>
			<div className={cn("mk-match-list", refreshing && "is-refreshing")} aria-busy={refreshing}>
				{results.map((m) => (
					<article className="mk-task-result" key={m.listing.id}>
						<button
							type="button"
							className="mk-task-result-image"
							aria-label={`查看${m.listing.title}`}
							onClick={() => onOpen(m.listing)}
						>
							{hasListingImage(m.listing.image) && <img src={m.listing.image} alt="" />}
						</button>
						<div>
							<span className="mk-result-kicker">{m.reasons[0]}</span>
							<button type="button" className="mk-task-result-title" onClick={() => onOpen(m.listing)}>
								{m.listing.title}
							</button>
							<p>{[m.listing.category, m.listing.location].filter(Boolean).join(" · ")}</p>
							<small>{m.tradeoff}</small>
							<p className="mk-price">
								<span>¥</span>
								{m.listing.price.toLocaleString()}
								<small>{m.listing.unit}</small>
							</p>
						</div>
						<button
							type="button"
							className="mk-icon-button mk-result-arrow"
							aria-label={`打开${m.listing.title}`}
							onClick={() => onOpen(m.listing)}
						>
							<ChevronRight size={19} />
						</button>
					</article>
				))}
			</div>
			{!results.length && !refreshing && (
				<div className="mk-empty">
					<Search size={32} />
					<h3>{state?.isError ? "搜索失败，请重试" : "暂时没有符合条件的选择"}</h3>
					<p>{state?.isError ? "没能连上市场服务。" : "调整预算或范围后再试试。"}</p>
				</div>
			)}
			{results.length >= 2 && (
				<div className="mk-task-bottom">
					<button
						type="button"
						className="mk-button mk-primary"
						onClick={() => onCompare(results.slice(0, 3).map((m) => m.listing.id))}
					>
						对比前 {Math.min(3, results.length)} 个选择
						<ArrowRight size={16} />
					</button>
				</div>
			)}
			<div className="mk-task-bottom">
				<button type="button" className="mk-button mk-primary" onClick={() => onDelegate(task)}>
					<Sparkles size={17} />和 Bot 讨论这个需求
				</button>
			</div>
			<details className="mk-disclosure">
				<summary>寻找设置与推荐依据</summary>
				<p>{task.text}</p>
				<p>
					{task.active ? "已保存寻找条件" : "已标记完成"}
					。需求保存在云端，装有市场插件的 Bot 会按它自己的排程检查新匹配；这里的候选是按同一条件做的只读搜索， 不会改变
					Bot 已通知过的结果。
				</p>
			</details>
		</section>
	);
}
