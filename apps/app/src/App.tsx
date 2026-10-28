import { useQueryClient } from "@tanstack/react-query";
import { Suspense, useEffect, useState } from "react";
import { logout, onUnauthorized, RpcError } from "./api/client";
import { mux } from "./api/stream";
import { Login } from "./features/Login";
import { useFacts } from "./lib/queries";
import { useRoute } from "./lib/useHash";
import { PAGES, pageComponent } from "./shell/registry";
import { Shell } from "./shell/Shell";

export function App() {
	const route = useRoute();
	const qc = useQueryClient();
	const facts = useFacts();
	const [authed, setAuthed] = useState<boolean | undefined>(undefined);
	useEffect(() => onUnauthorized(() => setAuthed(false)), []);
	useEffect(() => {
		if (facts.data) setAuthed(true);
		else if (facts.error instanceof RpcError && facts.error.code === "unauthorized") setAuthed(false);
	}, [facts.data, facts.error]);

	const PublicPage = route.page && PAGES[route.page].public ? pageComponent(route.page) : undefined;
	if (PublicPage)
		return (
			<Suspense fallback={null}>
				<PublicPage id={route.session ?? ""} />
			</Suspense>
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
	if (authed === undefined)
		return (
			<div className="grid h-dvh place-items-center text-small text-faint">
				{facts.isError ? `无法连接网关：${facts.error.message}` : "连接中…"}
			</div>
		);
	return (
		<Shell
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
