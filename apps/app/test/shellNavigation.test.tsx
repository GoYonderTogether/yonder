import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it } from "vitest";
import { Shell } from "../src/components/Shell";

it("始终按消息、工作、市场、通讯录排列主导航", () => {
	Object.assign(globalThis, { location: { pathname: "/" } });
	const html = renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<MemoryRouter>
				<Routes>
					<Route element={<Shell />}>
						<Route path="/" element={<div />} />
					</Route>
				</Routes>
			</MemoryRouter>
		</QueryClientProvider>,
	);
	const mobile = html.slice(html.lastIndexOf('<nav aria-label="主导航"'));
	expect([...mobile.matchAll(/aria-label="(消息|工作|市场|通讯录|我)"/g)].map((match) => match[1])).toEqual([
		"消息",
		"工作",
		"市场",
		"通讯录",
	]);
});
