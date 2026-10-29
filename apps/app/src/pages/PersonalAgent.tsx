import { ArrowRight, Check, Plug, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { PageLoading } from "../components/PageLoading";
import { selectPersonalAgent, usePersonalAgent } from "../lib/personalAgent";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { toast } from "../ui/Toast";
import { AddDeviceDialog } from "./Connect";

export function PersonalAgent() {
	const { agents, agent, me, isPending, isError, refetch } = usePersonalAgent();
	const loc = useLocation();
	const nav = useNavigate();
	const [picked, setPicked] = useState<string>();
	const [mode, setMode] = useState<"create" | "connect">();
	const [connecting, setConnecting] = useState(false);
	const selected = agents.find((a) => a.id === (picked ?? agent?.id));
	const next =
		typeof loc.state?.next === "string" && /^\/(?!\/)/.test(loc.state.next) && !/[\\\r\n]/.test(loc.state.next)
			? loc.state.next
			: "/";
	const enter = () => {
		if (!me || !selected) return;
		try {
			selectPersonalAgent(me.id, selected.id);
			nav(next === "/pa" ? "/" : next, { replace: true });
		} catch {
			toast("浏览器未允许保存 PA 选择，请开启站点存储后重试", true);
		}
	};
	return (
		<main className="scroll-y h-full px-6 py-10 md:py-16">
			<div className="mx-auto max-w-lg">
				<p className="mb-3 text-small text-muted">Yonder</p>
				<h1 className="text-[28px] font-semibold tracking-tight">{agent ? "我的 PA" : "先连接你的 PA"}</h1>
				<p className="mt-3 mb-8 text-small leading-relaxed text-muted">
					你的个人 Agent。与你对话，理解需求，再协助你与人和其他 Agent 互动。
				</p>
				{isPending && <PageLoading />}
				{isError && (
					<p role="alert">
						加载失败。
						<button type="button" onClick={() => void refetch()} className="underline">
							重试
						</button>
					</p>
				)}
				{!!agents.length && (
					<>
						<p className="mb-3 text-small text-muted">选择代表你的 Agent</p>
						<fieldset className="space-y-2" aria-label="选择个人 PA">
							{agents.map((a) => (
								<button
									type="button"
									key={a.id}
									aria-pressed={selected?.id === a.id}
									onClick={() => setPicked(a.id)}
									className={`press flex w-full items-center gap-3 rounded-card p-4 text-left ${selected?.id === a.id ? "bg-tone-2" : "bg-tone/50"}`}
								>
									<Avatar actor={a} size={40} online={a.online} />
									<span className="min-w-0 flex-1">
										<strong className="block text-body font-medium">{a.name}</strong>
										<span className="text-caption text-muted">
											{a.note || a.summary || (a.online ? "已连接" : "离线，消息会保留")}
										</span>
									</span>
									{selected?.id === a.id && <Check size={18} />}
								</button>
							))}
						</fieldset>
						<Button variant="primary" className="mt-5 w-full" disabled={!selected} onClick={enter}>
							{agent ? "使用这个 PA" : "进入 Yonder"}
							<ArrowRight size={17} />
						</Button>
					</>
				)}
				<div className="mt-8 grid grid-cols-2 gap-3">
					<Button onClick={() => setMode("create")}>
						<Plus size={17} />
						新建 PA
					</Button>
					<Button
						onClick={() => {
							setMode("connect");
							setConnecting(true);
						}}
					>
						<Plug size={17} />
						接入已有 PA
					</Button>
				</div>
				{mode === "create" && (
					<section className="mt-5 rounded-card bg-tone/50 p-5">
						<h2 className="font-medium">在 Yonder Harness 中创建</h2>
						<p className="my-3 text-small leading-relaxed text-muted">
							PA 运行在你自己的设备上。先安装 Harness 并创建 Agent，再连接到此账号。网页暂不提供云端创建。
						</p>
						<div className="flex flex-wrap gap-3">
							<Link to="/get" className="press inline-flex min-h-11 items-center underline">
								查看安装与接入步骤
							</Link>
							<Button onClick={() => setConnecting(true)}>已创建，继续连接</Button>
						</div>
					</section>
				)}
				{mode === "connect" && !connecting && (
					<p role="status" className="mt-5 text-small text-muted">
						设备连接后，点击
						<button type="button" className="min-h-11 underline" onClick={() => void refetch()}>
							刷新 Agent 列表
						</button>
						，再选择你的 PA。
					</p>
				)}
				<AddDeviceDialog
					key={connecting ? "open" : "closed"}
					open={connecting}
					onOpenChange={setConnecting}
					onConnected={() => {
						setConnecting(false);
						setMode("connect");
						void refetch();
					}}
				/>
			</div>
		</main>
	);
}
