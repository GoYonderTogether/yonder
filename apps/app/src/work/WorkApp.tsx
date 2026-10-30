import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { PersonalAvatar } from "../components/PersonalDrawer";
import { gatewayHosted } from "../lib/base";
import { logout, onUnauthorized, RpcError } from "./api/client";
import { addNode, LOCAL_NODE, setActiveNode, useActiveNode, useNodes } from "./api/nodes";
import { mux } from "./api/stream";
import { Login } from "./features/Login";
import { useFacts } from "./lib/queries";
import { WorkShell } from "./WorkShell";

/** 请求没发出去（TypeError）或拿到的不是网关响应（unavailable）：这里没有网关，不是网关报错。 */
export function noGateway(error: unknown): boolean {
	return error instanceof TypeError || (error instanceof RpcError && error.code === "unavailable");
}

/** 网关登录门：未登录显示令牌登录页，已登录进入工作外壳。社交账号与此无关。 */
export function WorkApp() {
	const node = useActiveNode();
	const qc = useQueryClient();
	const navigate = useNavigate();
	const [readyNode, setReadyNode] = useState(node.id);
	const previous = useRef(node.id);
	useEffect(() => {
		if (previous.current === node.id) return;
		mux.reset();
		qc.clear();
		previous.current = node.id;
		void navigate("/work", { replace: true });
		setReadyNode(node.id);
	}, [node.id, qc, navigate]);
	if (readyNode !== node.id) return null;
	if (import.meta.env.VITE_API === "http" && !gatewayHosted() && node.id === LOCAL_NODE.id) return <WorkEntry />;
	return <GatewayWorkApp key={node.id} />;
}

function WorkEntry() {
	const nodes = useNodes().filter((node) => node.id !== LOCAL_NODE.id && node.origin);
	const [origin, setOrigin] = useState("");
	const [token, setToken] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const connect = async () => {
		setBusy(true);
		setError("");
		try {
			const node = await addNode({ origin, token });
			setToken("");
			setActiveNode(node.id);
		} catch (e) {
			setError(e instanceof Error ? e.message : "连接失败");
		} finally {
			setBusy(false);
		}
	};
	return (
		<main className="relative grid h-full place-items-center p-6">
			<div className="absolute top-0 left-0 p-4 lg:hidden">
				<PersonalAvatar />
			</div>
			<div className="w-full max-w-md text-center">
				<h1 className="text-title font-semibold">连接设备，开始工作</h1>
				<p className="mt-2 text-small text-muted">工作台需要单独授权。消息设备连接不会自动授予工作台访问权限。</p>
				<div className="mt-6 flex flex-col gap-2 text-left">
					<label>
						网关地址
						<input
							className="field w-full"
							value={origin}
							onChange={(e) => setOrigin(e.target.value)}
							placeholder="https://host/console"
						/>
					</label>
					<label>
						访问令牌
						<input
							className="field w-full"
							type="password"
							autoComplete="off"
							value={token}
							onChange={(e) => setToken(e.target.value)}
						/>
					</label>
					<button
						type="button"
						disabled={busy || !origin.trim()}
						onClick={() => void connect()}
						className="press rounded-full bg-accent px-4 py-2 text-on-accent"
					>
						{busy ? "连接中…" : "连接设备"}
					</button>
					{error && <p role="alert">{error}；跨域连接需要网关允许当前站点。</p>}
				</div>
				<div className="mt-6 flex flex-wrap justify-center gap-3">
					<a href="/console/" className="press rounded-full bg-accent px-4 py-2 text-small text-on-accent">
						连接工作台
					</a>
					<Link to="/get" className="press rounded-full bg-tone px-4 py-2 text-small">
						安装 Yonder
					</Link>
				</div>
				{nodes.length > 0 && (
					<div className="mt-6 text-left">
						<h2 className="text-small font-medium">已保存的工作台</h2>
						<ul className="mt-2 space-y-2">
							{nodes.map((node) => (
								<li key={node.id}>
									<button type="button" onClick={() => setActiveNode(node.id)} className="text-small underline">
										{node.name}
									</button>
								</li>
							))}
						</ul>
					</div>
				)}
			</div>
		</main>
	);
}

/** 网关登录门：社交账号与网关授权无关。 */
function GatewayWorkApp() {
	const qc = useQueryClient();
	const facts = useFacts();
	const [authed, setAuthed] = useState<boolean | undefined>(undefined);
	useEffect(() => onUnauthorized(() => setAuthed(false)), []);
	useEffect(() => {
		if (facts.data) setAuthed(true);
		else if (facts.error instanceof RpcError && facts.error.code === "unauthorized") setAuthed(false);
	}, [facts.data, facts.error]);

	if (authed === false)
		return (
			<Login
				onDone={() => {
					setAuthed(undefined);
					void qc.resetQueries();
				}}
			/>
		);
	// 没有网关（fetch 失败、非网关响应）时第一次失败就说明，不在重试期间一直停在「连接中…」。
	const failure = facts.error ?? facts.failureReason;
	if (authed === undefined && !facts.data && failure && noGateway(failure))
		return (
			<div role="status" className="grid h-full place-items-center p-6 text-small text-muted">
				<p>
					本页需要连接 Yonder 节点。
					<Link to="/get" className="underline hover:text-ink">
						了解如何安装和连接
					</Link>
				</p>
			</div>
		);
	if (authed === undefined)
		return (
			<div className="grid h-full place-items-center text-small text-faint">
				{facts.isError ? `无法连接网关：${facts.error.message}` : "连接中…"}
			</div>
		);
	return (
		<WorkShell
			onLogout={() => {
				mux.reset();
				void logout().finally(() => {
					qc.clear();
					setAuthed(false);
				});
			}}
		/>
	);
}
