import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { logout, onUnauthorized, RpcError } from "./api/client";
import { mux } from "./api/stream";
import { Login } from "./features/Login";
import { useFacts } from "./lib/queries";
import { WorkShell } from "./WorkShell";

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
