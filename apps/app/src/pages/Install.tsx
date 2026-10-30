import { Copy, RotateCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";

const TEMPLATE =
	'请把这台设备上的 Yonder 连接到我的名片服务 {ENDPOINT}。我已登录网页并发起邀请，无需再打开确认页。\n\n1. 若未安装 Yonder：按官方仓库 https://github.com/GoYonderTogether/yonder 的 README「Quick start」安装，只取该仓库已审核的正式 release 标签，不要编造安装命令或版本，不要把开发分支当作正式版。已安装则执行 yonder update --to latest 升到最新正式版。\n2. 执行 yonder start 启动本地服务；已在运行则直接返回，不要启动第二个内核。\n3. 执行 yonder channels login card --verify-code {CODE}。邀请码是十位数字，十分钟内有效且只能使用一次；过期请回网页重新生成。connected 为兑换成功并已登记 Bot；already-connected 为已连接且未再次兑换；invalid-code 请我在网页重新生成邀请码；retry-later 请稍后重试。\n4. 仅当 yonder channels list 里没有 card 时，才在 home/yonder.yaml 的 channels 中加入 card: { type: card, endpoint: "{ENDPOINT}" }，用 yonder doctor 校验后执行 yonder service restart，并再次核对 channels list。已有 card 指向其他 endpoint 时不要覆盖其令牌，请报告冲突。\n\n不要在回复或日志中回显邀请码，不要打印任何 token、凭据或私有文件内容。不要把契约测试或命令返回当作网页消息收发的真实验收。';
export const connectionPrompt = (code: string) =>
	TEMPLATE.replaceAll("{CODE}", code).replaceAll("{ENDPOINT}", location.origin);

type Tab = "prompt" | "terminal";
type Invite = { code: string; expiresAt: string };
const live = (invite?: Invite) => !!invite && Date.parse(invite.expiresAt) > Date.now();
export function Install() {
	const [tab, setTab] = useState<Tab>("prompt");
	const [invite, setInvite] = useState<Invite>();
	const [issuing, setIssuing] = useState(false);
	const code = live(invite) ? (invite as Invite).code : "__________";
	const content = tab === "prompt" ? connectionPrompt(code) : `yonder channels login card --verify-code ${code}`;
	const issue = async () => {
		setIssuing(true);
		try {
			const next = await api.createInvite();
			setInvite(next);
			return next;
		} catch (error) {
			const message = error instanceof Error ? error.message : "";
			toast(/401|unauth|登录/i.test(message) ? "请登录后再获取连接邀请码" : message || "邀请码生成失败");
			return undefined;
		} finally {
			setIssuing(false);
		}
	};
	const copy = async () => {
		const current = live(invite) ? invite : await issue();
		if (!current) return;
		try {
			await navigator.clipboard.writeText(
				tab === "prompt" ? connectionPrompt(current.code) : `yonder channels login card --verify-code ${current.code}`,
			);
			toast("已复制");
		} catch {
			toast("复制失败，请长按选中文本复制");
		}
	};
	return (
		<div className="scroll-y h-full">
			<div className="mx-auto max-w-2xl px-4 pt-10 pb-16 md:px-6 md:pt-20">
				<h1 className="display rise">拥有自己的 Bot</h1>
				<div className="mt-6 flex gap-2" role="tablist">
					{(["prompt", "terminal"] as const).map((key) => (
						<button
							type="button"
							key={key}
							role="tab"
							aria-selected={tab === key}
							onClick={() => setTab(key)}
							className={`press rounded-full px-4 py-2 text-small ${tab === key ? "bg-accent text-on-accent" : "bg-tone text-muted"}`}
						>
							{key === "prompt" ? "提示词" : "终端命令"}
						</button>
					))}
				</div>
				<details className="rise mt-5">
					<summary className="cursor-pointer text-small">查看{tab === "prompt" ? "提示词" : "命令"}</summary>
					<pre className="mt-3 max-h-[65dvh] select-text overflow-auto whitespace-pre-wrap rounded-card bg-ink p-5 font-mono text-small leading-relaxed text-ground">
						{content}
					</pre>
				</details>
				<p className="mt-3 text-small text-muted">
					{live(invite)
						? "邀请码十分钟内有效、只能使用一次；过期后请回到此页重新生成。"
						: invite
							? "邀请码已过期，请重新生成后再复制。"
							: "点击复制时会生成一次性邀请码，十分钟内有效。"}
				</p>
				<div className="rise mt-4 flex items-center gap-4">
					<Button variant="primary" onClick={copy} disabled={issuing}>
						<Copy size={15} />
						复制{tab === "prompt" ? "提示词" : "命令"}
					</Button>
					{invite && !live(invite) && (
						<Button onClick={() => void issue()} disabled={issuing}>
							<RotateCw size={15} />
							重新生成邀请码
						</Button>
					)}
					<Link to="/" className="text-small text-muted underline underline-offset-4 hover:text-ink">
						先逛逛
					</Link>
				</div>
			</div>
		</div>
	);
}
