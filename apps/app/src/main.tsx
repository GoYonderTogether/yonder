import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { RpcError } from "./transport/client";

const qc = new QueryClient({
	defaultOptions: {
		queries: {
			// 未登录不重试，交给登录页
			retry: (n, e) => !(e instanceof RpcError && e.code === "unauthorized") && n < 2,
			refetchOnWindowFocus: true,
		},
	},
});

const root = document.getElementById("root");
if (root)
	createRoot(root).render(
		<StrictMode>
			<QueryClientProvider client={qc}>
				<App />
			</QueryClientProvider>
		</StrictMode>,
	);
