import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { api } from "../api";
import { PersonalAvatar } from "../components/PersonalDrawer";
import { gatewayHosted } from "../lib/base";
import { useLogout } from "../lib/useLogout";
import { $session } from "../store";
import { logout, onUnauthorized, RpcError } from "./api/client";
import { setCloudDevice, useActiveNode } from "./api/nodes";
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
	const account = useStore($session)?.actor;
	if (import.meta.env.VITE_API === "http" && !gatewayHosted())
		return account ? <CloudWorkEntry key={account.id} accountId={account.id} /> : null;
	return <LocalWorkApp />;
}

function LocalWorkApp() {
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
	return <GatewayWorkApp key={node.id} />;
}

function CloudWorkEntry({ accountId }: { accountId: string }) {
	const qc = useQueryClient();
	const navigate = useNavigate();
	const node = useActiveNode();
	const [choice, setChoice] = useState<string>();
	const previousDevice = useRef<string | undefined>(undefined);
	const devices = useQuery({ queryKey: ["account-devices", accountId], queryFn: api.devices, refetchInterval: 5000 });
	const available = (devices.data ?? []).filter((device) => device.online && device.workProtocol === 1);
	const selected =
		available.find((device) => device.id === choice) ??
		(!choice && node.id.startsWith(`account:${accountId}:device:`)
			? available.find((device) => device.id === node.deviceId)
			: undefined) ??
		(!choice && available.length === 1 ? available[0] : undefined);
	const targetId = selected && `account:${accountId}:device:${selected.id}`;
	useEffect(() => {
		if (!selected) return;
		const switched =
			(previousDevice.current !== undefined && previousDevice.current !== selected.id) ||
			(!!node.deviceId && node.id !== targetId);
		previousDevice.current = selected.id;
		if (node.id === targetId) return;
		mux.reset();
		qc.removeQueries({ predicate: (query) => query.queryKey[0] !== "account-devices" });
		if (switched) void navigate("/work", { replace: true });
		setCloudDevice(accountId, selected);
	}, [accountId, selected, targetId, node.id, node.deviceId, navigate, qc]);
	useEffect(() => {
		if (selected) return;
		mux.reset();
		qc.removeQueries({ predicate: (query) => query.queryKey[0] !== "account-devices" });
	}, [selected, qc]);
	if (selected && node.id === targetId)
		return (
			<div className="flex h-full flex-col">
				{available.length > 1 && (
					<label className="flex items-center gap-2 px-4 py-2 text-small">
						设备
						<select
							value={selected.id}
							onChange={(event) => setChoice(event.target.value)}
							className="field min-w-0 flex-1"
						>
							{available.map((device) => (
								<option key={device.id} value={device.id}>
									{device.name}
								</option>
							))}
						</select>
					</label>
				)}
				<div className="min-h-0 flex-1">
					<GatewayWorkApp key={node.id} cloud />
				</div>
			</div>
		);
	return (
		<main className="relative grid h-full place-items-center p-6">
			<div className="absolute top-0 left-0 p-4 lg:hidden">
				<PersonalAvatar />
			</div>
			<div className="w-full max-w-md text-center">
				<h1 className="text-title font-semibold">工作设备</h1>
				{devices.isPending ? (
					<p className="mt-2 text-small text-muted">正在读取设备…</p>
				) : devices.isError ? (
					<p role="alert" className="mt-2 text-small text-muted">
						无法读取设备，请检查连接后重试。
						<button type="button" className="underline" onClick={() => void devices.refetch()}>
							重试
						</button>
					</p>
				) : !devices.data?.length ? (
					<p className="mt-2 text-small text-muted">连接设备后即可开始工作。</p>
				) : (
					<ul className="mt-4 text-left">
						{devices.data.map((device) => (
							<li key={device.id} className="flex min-h-12 items-center justify-between gap-3 border-b border-hairline">
								<span>{device.name}</span>
								{device.online && device.workProtocol === 1 ? (
									<button type="button" className="underline" onClick={() => setChoice(device.id)}>
										选择
									</button>
								) : (
									<span className="text-small text-muted">{device.online ? "需要更新 Yonder" : "离线"}</span>
								)}
							</li>
						))}
					</ul>
				)}
				<div className="mt-6 flex justify-center gap-3">
					<Link to="/connect" className="rounded-full bg-accent px-4 py-2 text-small text-on-accent">
						连接设备
					</Link>
					<Link to="/get" className="rounded-full bg-tone px-4 py-2 text-small">
						安装 Yonder
					</Link>
				</div>
			</div>
		</main>
	);
}

/** 网关登录门：社交账号与网关授权无关。 */
function GatewayWorkApp({ cloud = false }: { cloud?: boolean }) {
	const qc = useQueryClient();
	const cloudLogout = useLogout();
	const facts = useFacts();
	const [authed, setAuthed] = useState<boolean | undefined>(undefined);
	useEffect(() => onUnauthorized(() => setAuthed(false)), []);
	useEffect(() => {
		if (facts.data) setAuthed(true);
		else if (facts.error instanceof RpcError && facts.error.code === "unauthorized") setAuthed(false);
	}, [facts.data, facts.error]);

	if (authed === false && cloud)
		return (
			<div role="alert" className="p-6 text-small">
				设备工作连接不可用，请检查设备状态。
			</div>
		);
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
				if (cloud) {
					void cloudLogout();
					return;
				}
				void logout().finally(() => {
					qc.clear();
					setAuthed(false);
				});
			}}
		/>
	);
}
