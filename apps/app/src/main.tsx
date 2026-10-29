import { useStore } from "@nanostores/react";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { api } from "./api";
import {
	ACCOUNT_KEY,
	CACHE_GC_TIME,
	CACHE_MAX_AGE,
	CACHE_PREFIX,
	CACHE_SCHEMA,
	clearPersistedCache,
	readCachedSession,
	selectAccount,
} from "./cache";
import { upgradeLegacyLocation } from "./legacyLinks";
import { appBase, routerBasename } from "./lib/base";
import { $session } from "./store";
import { registerConsoleWorker } from "./work/pwa";
import "./styles.css";

const qc = new QueryClient({
	defaultOptions: {
		queries: { staleTime: 0, gcTime: CACHE_GC_TIME, refetchOnWindowFocus: false, refetchOnReconnect: true },
	},
});
const cachedQueries = new Set([
	"convs",
	"msgs",
	"actors",
	"actor",
	"cards",
	"card",
	"contacts",
	"devices",
	"session",
	"profile",
	"conv-detail",
]);

function PersistenceProvider({ children }: { children: React.ReactNode }) {
	const session = useStore($session);
	const accountId = session?.actor.id ?? "guest";
	const persister = useMemo(
		() =>
			createSyncStoragePersister({
				storage: window.localStorage,
				key: `${CACHE_PREFIX}${accountId}`,
				throttleTime: 1000,
			}),
		[accountId],
	);
	return (
		<PersistQueryClientProvider
			key={accountId}
			client={qc}
			persistOptions={{
				persister,
				maxAge: CACHE_MAX_AGE,
				buster: CACHE_SCHEMA,
				dehydrateOptions: {
					shouldDehydrateQuery: (query) =>
						query.state.data !== undefined && cachedQueries.has(String(query.queryKey[0])),
				},
			}}
		>
			{children}
		</PersistQueryClientProvider>
	);
}

upgradeLegacyLocation(appBase());
$session.set(readCachedSession());

function Bootstrap() {
	const session = useStore($session);
	const [attempt, setAttempt] = useState(0);
	const [error, setError] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt 变化时重试加载
	useEffect(() => {
		let active = true;
		const initial = $session.get();
		setError(false);
		void api
			.session()
			.then((current) => {
				if (!active || $session.get() !== initial) return;
				selectAccount(current?.actor.id ?? null, qc);
				$session.set(current);
			})
			.catch(() => {
				if (active && $session.get() === initial) setError(true);
			});
		return () => {
			active = false;
		};
	}, [attempt]);
	useEffect(() => {
		const changed = (event: StorageEvent) => {
			if (event.key === null || event.key === ACCOUNT_KEY) location.reload();
		};
		const unauthorized = () => {
			clearPersistedCache(qc);
			$session.set(null);
		};
		window.addEventListener("yonder:unauthorized", unauthorized);
		window.addEventListener("storage", changed);
		return () => {
			window.removeEventListener("storage", changed);
			window.removeEventListener("yonder:unauthorized", unauthorized);
		};
	}, []);
	const retry = (
		<button type="button" className="underline" onClick={() => setAttempt((n) => n + 1)}>
			重试
		</button>
	);
	if (session === undefined)
		return (
			<div role="status" className="flex h-full items-center justify-center gap-2 text-muted">
				{error ? <>连接失败，{retry}</> : "正在加载…"}
			</div>
		);
	return (
		<>
			<PersistenceProvider>
				<BrowserRouter basename={routerBasename()}>
					<App />
				</BrowserRouter>
			</PersistenceProvider>
			{error && (
				<div
					role="status"
					className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 gap-2 rounded-control bg-raised px-4 py-2 text-small shadow-float"
				>
					暂时无法同步，正在显示缓存。{retry}
				</div>
			)}
		</>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<QueryClientProvider client={qc}>
			<Bootstrap />
		</QueryClientProvider>
	</StrictMode>,
);

registerConsoleWorker();
