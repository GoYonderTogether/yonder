import { useStore } from "@nanostores/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { api } from "../api";
import { PersonalAvatar } from "../components/PersonalDrawer";
import { gatewayHosted } from "../lib/base";
import { useLogout } from "../lib/useLogout";
import { $session } from "../store";
import { logout, onUnauthorized, RpcError } from "./api/client";
import { activeNode, setCloudDevice, useActiveNode } from "./api/nodes";
import { mux } from "./api/stream";
import { Login } from "./features/Login";
import {
	hasWorkCache,
	reconcileWorkDevices,
	reconcileWorkSessions,
	removeWorkDevice,
	restoreAllWork,
	restoreWorkQueries,
	saveAllWork,
	saveWorkQueries,
	updateStoredWork,
} from "./lib/offlineCache";
import { useFacts } from "./lib/queries";
import { setWorkDevices } from "./lib/workOnline";
import { useBreakpoint } from "./shell/useBreakpoint";
import { useWorkRoute, workPath } from "./shell/workRoutes";
import { AllWorkList } from "./ui/AllWorkList";
import { WorkToolbar } from "./ui/WorkToolbar";
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
	const breakpoint = useBreakpoint();
	const qc = useQueryClient();
	const navigate = useNavigate();
	const node = useActiveNode();
	const route = useWorkRoute();
	const [choice, setChoice] = useState("all");
	const devices = useQuery({ queryKey: ["account-devices", accountId], queryFn: api.devices, refetchInterval: 5000 });
	const available = (devices.data ?? []).filter((device) => device.online && device.workProtocol === 1);
	const knownDevices = useRef<string[]>([]);
	useEffect(() => {
		if (!devices.data) return;
		setWorkDevices(devices.data);
		for (const id of knownDevices.current)
			if (!devices.data.some((device) => device.id === id)) removeWorkDevice(accountId, id);
		knownDevices.current = devices.data.map((device) => device.id);
		reconcileWorkDevices(accountId, knownDevices.current);
		restoreAllWork(qc, accountId, knownDevices.current);
	}, [accountId, devices.data, qc]);
	useEffect(
		() =>
			qc.getQueryCache().subscribe((event) => {
				const key = event.query.queryKey;
				if (key[0] !== "all-work" || key[1] !== accountId) return;
				saveAllWork(qc, accountId);
				if (event.type !== "updated" || event.action.type !== "success" || typeof key[2] !== "string") return;
				if (key[3] === "sessions") {
					const sessions = event.query.state.data as { id: string }[] | undefined;
					if (sessions) {
						updateStoredWork(accountId, key[2], "sessions", sessions);
						reconcileWorkSessions(
							accountId,
							key[2],
							sessions.map((item) => item.id),
						);
					}
				} else if (key[3] === "agents") {
					const agents = event.query.state.data as { key: string }[] | undefined;
					if (agents) {
						updateStoredWork(accountId, key[2], "agents", agents);
						reconcileWorkSessions(
							accountId,
							key[2],
							undefined,
							agents.map((item) => item.key),
						);
					}
				}
			}),
		[accountId, qc],
	);
	const legacySession = !!route.session && !route.deviceId;
	const wanted =
		route.deviceId ?? (choice === "all" && node.id.startsWith(`account:${accountId}:device:`) ? node.deviceId : choice);
	const selected =
		(devices.data ?? []).find(
			(device) =>
				device.id === wanted && (device.workProtocol === 1 || (!device.online && hasWorkCache(accountId, device.id))),
		) ?? (choice === "all" && !route.deviceId && (!legacySession || available.length === 1) ? available[0] : undefined);
	const targetId = selected && `account:${accountId}:device:${selected.id}`;
	useEffect(() => {
		if (!selected) return;
		if (node.id === targetId) return;
		mux.reset();
		setCloudDevice(accountId, selected);
		void qc.cancelQueries({
			predicate: (query) => query.queryKey[0] !== "account-devices" && query.queryKey[0] !== "all-work",
		});
		qc.removeQueries({
			predicate: (query) => query.queryKey[0] !== "account-devices" && query.queryKey[0] !== "all-work",
		});
		restoreWorkQueries(qc, accountId, selected.id);
	}, [accountId, selected, targetId, node.id, qc]);
	useEffect(() => {
		if (!selected || node.id !== targetId) return;
		return qc.getQueryCache().subscribe((event) => {
			if (activeNode().id !== targetId) return;
			saveWorkQueries(qc, accountId, selected.id);
			if (event.type !== "updated" || event.action.type !== "success") return;
			if (event.query.queryKey[0] === "sessions" && event.query.queryKey[1] === "work") {
				const sessions = event.query.state.data as { id: string }[] | undefined;
				if (sessions)
					reconcileWorkSessions(
						accountId,
						selected.id,
						sessions.map((session) => session.id),
					);
			} else if (event.query.queryKey[0] === "device-agents" && event.query.queryKey[1] === targetId) {
				const agents = event.query.state.data as { key: string }[] | undefined;
				if (agents)
					reconcileWorkSessions(
						accountId,
						selected.id,
						undefined,
						agents.map((agent) => agent.key),
					);
			}
		});
	}, [accountId, selected, node.id, targetId, qc]);
	useEffect(() => {
		if (selected) return;
		mux.reset();
		qc.removeQueries({
			predicate: (query) => query.queryKey[0] !== "account-devices" && query.queryKey[0] !== "all-work",
		});
	}, [selected, qc]);
	const open = (device: { id: string; name: string }, session: string) => {
		if (node.deviceId !== device.id) {
			mux.reset();
			setCloudDevice(accountId, device);
			void qc.cancelQueries({
				predicate: (query) => query.queryKey[0] !== "account-devices" && query.queryKey[0] !== "all-work",
			});
			qc.removeQueries({
				predicate: (query) => query.queryKey[0] !== "account-devices" && query.queryKey[0] !== "all-work",
			});
			restoreWorkQueries(qc, accountId, device.id);
		}
		void navigate(workPath({ deviceId: device.id, session }));
	};
	const list = <AllWorkList accountId={accountId} devices={devices.data ?? []} onOpen={open} />;
	const selector = !!devices.data?.length && (
		<DropdownMenu.Root modal={false}>
			<DropdownMenu.Trigger
				className="press flex min-h-11 max-w-36 items-center gap-1 rounded-control px-2 text-small"
				aria-label="选择设备"
			>
				<span className="truncate">
					{choice === "all" ? "全部设备" : (devices.data.find((device) => device.id === choice)?.name ?? "选择设备")}
				</span>
				<ChevronDown size={14} aria-hidden />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					align="end"
					sideOffset={6}
					className="z-50 min-w-40 rounded-card bg-raised p-1.5 shadow-float outline-none"
				>
					<DropdownMenu.RadioGroup value={choice}>
						{[{ id: "all", name: "全部设备", online: true }, ...devices.data].map((device) => (
							<DropdownMenu.RadioItem
								value={device.id}
								key={device.id}
								className="press flex min-h-11 cursor-pointer items-center rounded-control px-3 text-small outline-none data-[highlighted]:bg-tone"
								onSelect={() => {
									setChoice(device.id);
									void navigate(
										legacySession && !selected && device.id !== "all" && route.session
											? workPath({ deviceId: device.id, session: route.session })
											: "/work",
									);
								}}
							>
								<DropdownMenu.ItemIndicator className="mr-2">✓</DropdownMenu.ItemIndicator>
								{device.name}
								{device.online ? "" : "（离线）"}
							</DropdownMenu.RadioItem>
						))}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
	if (route.page === "settings") return <Navigate to="/me/settings" replace />;
	if (selected && node.id === targetId)
		return <GatewayWorkApp key={node.id} cloud allWork={choice === "all" ? list : undefined} device={selector} />;
	if (choice === "all" && devices.data?.length && !route.deviceId && !legacySession)
		return (
			<div className="flex h-full flex-col">
				<WorkToolbar phone={breakpoint === "phone"} leading={<PersonalAvatar />} title="工作" device={selector} />
				<div className="min-h-0 flex-1">{list}</div>
			</div>
		);
	return (
		<div className="flex h-full flex-col">
			<WorkToolbar phone={breakpoint === "phone"} leading={<PersonalAvatar />} title="工作" device={selector} />
			<main className="grid min-h-0 flex-1 place-items-center p-6">
				<div className="w-full max-w-md text-center">
					<h1 className="text-title font-semibold">工作设备</h1>
					{legacySession && available.length > 1 && !selected && (
						<p className="mt-2 text-small text-muted">请选择这个会话所在的设备。</p>
					)}
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
								<li
									key={device.id}
									className="flex min-h-12 items-center justify-between gap-3 border-b border-hairline"
								>
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
		</div>
	);
}

/** 网关登录门：社交账号与网关授权无关。 */
function GatewayWorkApp({
	cloud = false,
	allWork,
	device,
}: {
	cloud?: boolean;
	allWork?: ReactNode;
	device?: ReactNode;
}) {
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
			allWork={allWork}
			device={device}
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
