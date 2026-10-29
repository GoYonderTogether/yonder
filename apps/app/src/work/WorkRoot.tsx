import "./styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { RpcError } from "./api/client";
import { readDevtoolsEnabled, storedDevtoolsEnabled } from "./devtools/viewState";
import { UpdateNotice } from "./ui/UpdateNotice";
import { WorkApp } from "./WorkApp";

const ViewSwitcher = lazy(() => import("./devtools/ViewSwitcher").then((m) => ({ default: m.ViewSwitcher })));

/**
 * 开发/演示用视图切换浮窗：默认不渲染，?devtools=1 或 localStorage 开关才懒加载。
 * 普通访客既不下载这块代码，也看不到任何入口。
 */
function DevtoolsHost() {
	// 只读开关：?devtools=1 或 localStorage。iframe 预览带 ?devtools=0，也不会改动父页面的存储。
	const [enabled, setEnabled] = useState(() =>
		readDevtoolsEnabled({ search: location.search, stored: storedDevtoolsEnabled() }),
	);
	if (!enabled) return null;
	return (
		<Suspense fallback={null}>
			<ViewSwitcher onDisable={() => setEnabled(false)} />
		</Suspense>
	);
}

// 工作区自己的 QueryClient：网关数据与名片站（云端社交）的缓存互不相干。
const qc = new QueryClient({
	defaultOptions: {
		queries: {
			// 未登录不重试，交给登录页
			retry: (n, e) => !(e instanceof RpcError && e.code === "unauthorized") && n < 2,
			refetchOnWindowFocus: true,
		},
	},
});

/** /work/* 的入口：名片站按路由懒加载它。 */
export default function WorkRoot() {
	return (
		<QueryClientProvider client={qc}>
			<WorkApp />
			<UpdateNotice />
			<DevtoolsHost />
		</QueryClientProvider>
	);
}
