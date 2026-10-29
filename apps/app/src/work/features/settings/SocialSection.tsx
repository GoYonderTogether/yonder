import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { rpc } from "../../api/client";
import { useBotNames } from "../../lib/queries";
import { Button } from "../../ui/kit/Button";
import { toast } from "../../ui/kit/Toast";

/** 群的两个维度标签（QA C2/C3）：对主人的价值与消息节奏；网关没给值时按缺省显示。 */
export interface SocialTags {
	value?: string;
	rhythm?: string;
}
/** social.groups 的行：listGroups 返回 conv/title/lastActiveAt/mode/tags。 */
export interface SocialGroupRow {
	conv: string;
	title?: string;
	mode: string;
	tags: SocialTags;
	lastActiveAt: string;
}
interface SocialPolicyView {
	mode?: string;
	tags?: SocialTags;
	judge?: { preset?: string; maxCallsPerHour?: number };
}
/** social.inspect：生效策略 + 每个键的来源（会话覆盖还是群默认）。 */
export interface SocialInspectResult {
	policy: SocialPolicyView;
	sources: Record<string, string>;
	revision: string;
	capabilityGaps?: string[];
}
interface SocialUpdateResult {
	before: SocialPolicyView;
	after: SocialPolicyView;
	affected: string[];
	revision: string;
}

/** policy.mode 的取值（packages/core/src/config/social-schema.ts）。 */
const MODES = [
	{ value: "mention", label: "只看 @" },
	{ value: "batch", label: "打包合并" },
	{ value: "record", label: "只记录" },
	{ value: "direct", label: "直接回复" },
	{ value: "folded", label: "折叠" },
	{ value: "mute", label: "静音" },
] as const;
const VALUES = [
	{ value: "high", label: "高" },
	{ value: "medium", label: "中" },
	{ value: "low", label: "低" },
] as const;
const RHYTHMS = [
	{ value: "high", label: "快" },
	{ value: "normal", label: "正常" },
	{ value: "low", label: "慢" },
] as const;
const NO_VALUE = "";

const labelOf = (list: readonly { value: string; label: string }[], value?: string) =>
	value ? (list.find((item) => item.value === value)?.label ?? value) : "未设置";

const tagsText = (tags?: SocialTags) => `价值 ${labelOf(VALUES, tags?.value)} · 节奏 ${labelOf(RHYTHMS, tags?.rhythm)}`;

const activeText = (iso: string) => {
	const at = Date.parse(iso);
	return Number.isFinite(at) ? new Date(at).toLocaleString("zh-CN", { hour12: false }) : iso;
};

/**
 * 社交分区（O51、QA C2/C3、E2E-13）：默认 Bot 的群设置是默认层，点开单个群是这台 Bot
 * 会话级的覆盖层。列表走 social.groups，明细走 social.inspect（生效策略 + 每个键的来源），
 * 修改走 social.update：先 dryRun 预览 before/after，再带 expectedRevision 与 reason 真正写入。
 */
export function SocialSection() {
	const names = useBotNames();
	const bots = [...names.entries()];
	const [picked, setPicked] = useState<string>();
	const [open, setOpen] = useState<string>();
	const agent = picked ?? bots[0]?.[0];
	const label = agent ? (names.get(agent) ?? agent) : "";
	const groups = useQuery({
		queryKey: ["social-groups", agent],
		queryFn: () => rpc<SocialGroupRow[]>("social.groups", { agent }),
		enabled: !!agent && open === undefined,
		retry: false,
	});
	return (
		<section className="mx-4 mt-3 rounded-card bg-raised p-4" data-testid="settings-social">
			<h2 className="mb-1 text-body font-medium">社交</h2>
			<p className="mb-2 text-caption text-faint">
				上面一层是 Bot 的默认群设置，点开单个群看这台 Bot 的会话级覆盖，改之前先预览再确认。
			</p>
			{bots.length === 0 && <p className="text-small text-faint">没有可管理的 Bot（需要 owner 权限）</p>}
			{bots.length > 1 && (
				<div className="mb-2 flex flex-wrap gap-1.5">
					{bots.map(([id, name]) => (
						<Button
							key={id}
							size="sm"
							variant={id === agent ? "primary" : "secondary"}
							aria-pressed={id === agent}
							onClick={() => {
								setPicked(id);
								setOpen(undefined);
							}}
						>
							{name}
						</Button>
					))}
				</div>
			)}
			{agent && open === undefined && (
				<>
					<p className="mb-1 text-small">默认层 · {label} 收到的群</p>
					{groups.isLoading && <p className="text-small text-faint">加载中…</p>}
					{groups.isError && <p className="text-small text-danger">{groups.error.message}</p>}
					<ul className="flex flex-col gap-1">
						{groups.data?.map((row) => (
							<li key={row.conv}>
								<button
									type="button"
									onClick={() => setOpen(row.conv)}
									className="press flex w-full items-center gap-2 rounded-control py-1.5 text-left"
								>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-small">{row.title ?? row.conv}</span>
										<span className="block truncate text-caption text-faint">
											{labelOf(MODES, row.mode)} · {tagsText(row.tags)} · {activeText(row.lastActiveAt)}
										</span>
									</span>
								</button>
							</li>
						))}
					</ul>
					{groups.data?.length === 0 && <p className="text-small text-faint">这个 Bot 还没收到过群消息</p>}
				</>
			)}
			{agent && open !== undefined && (
				<GroupDetail agent={agent} conv={open} onBack={() => setOpen(undefined)} names={names} />
			)}
		</section>
	);
}

/**
 * 单个群的覆盖层：social.inspect 的 policy 是生效值，sources 说明每个键来自会话覆盖还是群默认；
 * 保存只提交改动过的键，并强制要求 reason，dryRun 预览通过后再确认写入。
 */
function GroupDetail({
	agent,
	conv,
	names,
	onBack,
}: {
	agent: string;
	conv: string;
	names: ReadonlyMap<string, string>;
	onBack(): void;
}) {
	const client = useQueryClient();
	const inspect = useQuery({
		queryKey: ["social-inspect", agent, conv],
		queryFn: () => rpc<SocialInspectResult>("social.inspect", { agent, conv }),
		retry: false,
	});
	const [mode, setMode] = useState<string>(NO_VALUE);
	const [value, setValue] = useState<string>(NO_VALUE);
	const [rhythm, setRhythm] = useState<string>(NO_VALUE);
	const [reason, setReason] = useState("");
	const [preview, setPreview] = useState<SocialUpdateResult>();
	const [busy, setBusy] = useState(false);
	const policy = inspect.data?.policy;
	const source = (key: string) =>
		inspect.data?.sources[key] === "conversation" ? "会话覆盖" : `默认（${inspect.data?.sources[key] ?? "未知"}）`;
	// 标签两个维度独立：只改一个时把另一个的生效值一起带上，避免覆盖层丢掉另一半。
	const patch = () => {
		const nextValue = value || policy?.tags?.value;
		const nextRhythm = rhythm || policy?.tags?.rhythm;
		return {
			...(mode ? { mode } : {}),
			...((value || rhythm) && {
				tags: { ...(nextValue ? { value: nextValue } : {}), ...(nextRhythm ? { rhythm: nextRhythm } : {}) },
			}),
		};
	};
	const changed = Object.keys(patch()).length > 0;
	const submit = async (dryRun: boolean) => {
		setBusy(true);
		try {
			const result = await rpc<SocialUpdateResult>("social.update", {
				agent,
				conv,
				expectedRevision: inspect.data?.revision,
				patch: patch(),
				reason: reason.trim(),
				dryRun,
			});
			if (dryRun) {
				setPreview(result);
				return;
			}
			setPreview(undefined);
			setMode(NO_VALUE);
			setValue(NO_VALUE);
			setRhythm(NO_VALUE);
			setReason("");
			await client.invalidateQueries({ queryKey: ["social-groups", agent] });
			await inspect.refetch();
			toast("社交设置已保存");
		} catch (error) {
			toast(error instanceof Error ? error.message : "保存失败", true);
		} finally {
			setBusy(false);
		}
	};
	return (
		<div data-testid="social-detail">
			<button type="button" onClick={onBack} className="press mb-2 flex items-center gap-1 text-small text-muted">
				<ArrowLeft size={15} aria-hidden /> 返回群列表
			</button>
			<p className="text-small">
				{names.get(agent) ?? agent} · {conv}
			</p>
			{inspect.isLoading && <p className="text-small text-faint">加载中…</p>}
			{inspect.isError && <p className="text-small text-danger">{inspect.error.message}</p>}
			{policy && (
				<dl className="mt-1 grid grid-cols-[5em_1fr] gap-y-1 text-small">
					<dt className="text-muted">监听模式</dt>
					<dd>
						{labelOf(MODES, policy.mode)} · {source("mode")}
					</dd>
					<dt className="text-muted">群标签</dt>
					<dd>
						{tagsText(policy.tags)} · {source("tags")}
					</dd>
					<dt className="text-muted">判定模型</dt>
					<dd>{policy.judge?.preset ? `预设 ${policy.judge.preset}` : "网关未返回"}</dd>
					<dt className="text-muted">token 额度</dt>
					<dd className="text-faint">网关未返回额度字段</dd>
				</dl>
			)}
			{policy && (
				<div className="mt-2 flex flex-col gap-2">
					<div className="flex flex-wrap gap-1.5">
						{MODES.map((item) => (
							<Button
								key={item.value}
								size="sm"
								variant={mode === item.value ? "primary" : "secondary"}
								aria-pressed={mode === item.value}
								onClick={() => {
									setMode(mode === item.value ? NO_VALUE : item.value);
									setPreview(undefined);
								}}
							>
								{item.label}
							</Button>
						))}
					</div>
					<div className="flex flex-wrap gap-1.5">
						{VALUES.map((item) => (
							<Button
								key={`value-${item.value}`}
								size="sm"
								variant={value === item.value ? "primary" : "secondary"}
								aria-pressed={value === item.value}
								onClick={() => {
									setValue(value === item.value ? NO_VALUE : item.value);
									setPreview(undefined);
								}}
							>
								价值 {item.label}
							</Button>
						))}
						{RHYTHMS.map((item) => (
							<Button
								key={`rhythm-${item.value}`}
								size="sm"
								variant={rhythm === item.value ? "primary" : "secondary"}
								aria-pressed={rhythm === item.value}
								onClick={() => {
									setRhythm(rhythm === item.value ? NO_VALUE : item.value);
									setPreview(undefined);
								}}
							>
								节奏 {item.label}
							</Button>
						))}
					</div>
					<label className="flex flex-col gap-1 text-caption text-muted">
						修改原因（必填，写进审计）
						<input
							value={reason}
							onChange={(event) => {
								setReason(event.target.value);
								setPreview(undefined);
							}}
							placeholder="例如：这个群只该在 @ 我时提醒"
							className="field h-10 rounded-control bg-tone px-3 text-small text-ink outline-none placeholder:text-faint"
						/>
					</label>
					<div className="flex gap-1.5">
						<Button size="sm" disabled={busy || !changed || !reason.trim()} onClick={() => void submit(true)}>
							预览改动
						</Button>
						<Button size="sm" variant="primary" disabled={busy || !preview} onClick={() => void submit(false)}>
							确认应用
						</Button>
					</div>
					{preview && (
						<p className="text-caption text-faint" data-testid="social-preview">
							预览：{labelOf(MODES, preview.before.mode)} / {tagsText(preview.before.tags)} →{" "}
							{labelOf(MODES, preview.after.mode)} / {tagsText(preview.after.tags)}
						</p>
					)}
				</div>
			)}
		</div>
	);
}
