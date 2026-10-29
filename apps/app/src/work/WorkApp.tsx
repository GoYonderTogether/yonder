import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { logout, onUnauthorized, RpcError } from "./api/client";
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
