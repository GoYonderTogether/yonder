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
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { CATEGORIES } from "../../market/data";
import { findMatches, inferBrief, taskBrief, timeAgo } from "../../market/matching";
import type { AgentTask, Listing, SearchBrief } from "../../market/types";
import { AgentMark, MarketDialog } from "./MarketUI";

const EXAMPLES = [
	"想买台轻便的旅行相机，3000 元以内",
	"想把手作产品拍得更好看，预算 800 元",
	"周末想学会手冲咖啡，上海，300 元以内",
];
export function AgentBriefDialog({
	open,
	close,
	editingTask,
	initialText,
	storageKey,
	onSave,
}: {
	open: boolean;
	close: () => void;
	editingTask?: AgentTask;
	initialText: string;
	storageKey: string;
	onSave: (brief: SearchBrief, id?: string) => void;
}) {
	const [step, setStep] = useState(0);
	const [text, setText] = useState("");
	const [brief, setBrief] = useState<SearchBrief>(inferBrief(""));
	const [error, setError] = useState("");
	const key = `${storageKey}:need:${editingTask?.id ?? "new"}`;
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: 与 autoFocus 等价，只在进入第一步时聚焦一次，ref 不进依赖
	useEffect(() => {
		const node = textareaRef.current;
		if (open && step === 0) node?.focus();
	}, [open, step]);
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
	const submit = () => {
		if (!Number.isFinite(brief.budget) || brief.budget <= 0) {
			setError("请填写大于 0 的预算");
			return;
		}
		const next = { ...brief, frequency: "手动" as const, location: brief.location.trim() || "不限" };
		try {
			localStorage.removeItem(key);
		} catch {
			/* Storage may be unavailable. */
		}
		onSave(next, editingTask?.id);
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
								ref={textareaRef}
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
						<p className="mk-form-hint">按条件整理本机候选。需要进一步澄清时，可以把需求带入 PA 对话。</p>
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
					<button type="button" className="mk-button mk-primary" onClick={step === 0 ? clarify : submit}>
						{step === 0 ? "下一步" : editingTask ? "保存条件" : "查看候选"}
						<ArrowRight size={16} />
					</button>
				</div>
			</div>
		</MarketDialog>
	);
}

export function AgentWorkspace({
	tasks,
	listings,
	selectedId,
	onSelect,
	onBack,
	onNew,
	onEdit,
	onDelegate,
	onToggle,
	onRefresh,
	refreshing,
	onOpen,
	onCompare,
}: {
	tasks: AgentTask[];
	onDelegate: (task: AgentTask) => void;
	listings: Listing[];
	selectedId?: string;
	onSelect: (id: string) => void;
	onBack: () => void;
	onNew: () => void;
	onEdit: () => void;
	onToggle: (id: string) => void;
	onRefresh: (id: string) => void;
	refreshing?: string;
	onOpen: (listing: Listing) => void;
	onCompare: (ids: string[]) => void;
}) {
	const task = tasks.find((t) => t.id === selectedId);
	const matches = task ? findMatches(listings, task) : [];
	if (!task)
		return (
			<section className="mk-workspace mk-narrow">
				<div className="mk-section-title" style={{ justifyContent: "flex-end" }}>
					<button type="button" className="mk-button mk-primary" onClick={onNew}>
						<Plus size={18} />
						新建需求
					</button>
				</div>
				<div className="mk-task-list">
					{tasks.map((t) => {
						const found = findMatches(listings, t);
						return (
							<button type="button" key={t.id} className="mk-task-select" onClick={() => onSelect(t.id)}>
								<AgentMark />
								<div className="mk-task-copy">
									<h3>{t.title}</h3>
									<p>
										¥{t.budget.toLocaleString()} 以内 · {t.location} · {t.active ? "寻找中" : "已完成"}
									</p>
									<span>
										{found.length ? `${found.length} 个候选` : "暂无候选"} · {timeAgo(t.checkedAt)}
									</span>
								</div>
								<div className="mk-task-thumbs">
									{found.slice(0, 3).map((m) => (
										<img key={m.listing.id} src={m.listing.image} alt="" />
									))}
								</div>
								<ChevronRight size={19} />
							</button>
						);
					})}
				</div>
				{!tasks.length && (
					<div className="mk-empty">
						<Sparkles size={32} />
						<h3>还没有保存的需求</h3>
						<p>保存条件，下次继续比较。</p>
					</div>
				)}
				<p className="mk-footnote">本机候选 · 按已填写的条件筛选</p>
			</section>
		);
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
					{refreshing === task.id ? "正在重新筛选…" : `${timeAgo(task.checkedAt)}更新 · ${matches.length} 个候选`}
				</span>
				<div>
					<button
						type="button"
						className="mk-icon-button"
						aria-label="重新寻找"
						disabled={!!refreshing}
						onClick={() => onRefresh(task.id)}
					>
						<RefreshCw size={18} className={cn(refreshing === task.id && "mk-working")} />
					</button>
					<button type="button" className="mk-button" onClick={() => onToggle(task.id)}>
						{task.active ? <Check size={15} /> : <Play size={15} />}
						{task.active ? "标记完成" : "继续寻找"}
					</button>
				</div>
			</div>
			<div
				className={cn("mk-match-list", refreshing === task.id && "is-refreshing")}
				aria-busy={refreshing === task.id}
			>
				{matches.map((m, i) => (
					<article className="mk-task-result" key={m.listing.id}>
						<button
							type="button"
							className="mk-task-result-image"
							aria-label={`查看${m.listing.title}`}
							onClick={() => onOpen(m.listing)}
						>
							<img src={m.listing.image} alt="" />
						</button>
						<div>
							<span className="mk-result-kicker">
								{i === 0 ? "最符合条件" : "其他候选"} · {m.score}% 条件匹配
							</span>
							<button type="button" className="mk-task-result-title" onClick={() => onOpen(m.listing)}>
								{m.listing.title}
							</button>
							<p>{m.reasons.slice(1, 3).join(" · ")}</p>
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
			{!matches.length && (
				<div className="mk-empty">
					<Search size={32} />
					<h3>暂时没有符合条件的选择</h3>
					<p>调整预算或范围后再试试。</p>
				</div>
			)}
			{matches.length >= 2 && (
				<div className="mk-task-bottom">
					<button
						type="button"
						className="mk-button mk-primary"
						onClick={() => onCompare(matches.slice(0, 3).map((m) => m.listing.id))}
					>
						对比前 {Math.min(3, matches.length)} 个选择
						<ArrowRight size={16} />
					</button>
				</div>
			)}
			<div className="mk-task-bottom">
				<button type="button" className="mk-button mk-primary" onClick={() => onDelegate(task)}>
					<Sparkles size={17} />和 PA 讨论这个需求
				</button>
			</div>
			<details className="mk-disclosure">
				<summary>寻找设置与推荐依据</summary>
				<p>{task.text}</p>
				<p>
					{task.active ? "已保存寻找条件" : "已标记完成"}
					。当前为本机条件筛选，尚未接入后台轮询。匹配分数表示条件符合程度，不代表质量或信用。
				</p>
			</details>
		</section>
	);
}
