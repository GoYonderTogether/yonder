import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "../src/work/api/client";
import { noGateway, WorkApp } from "../src/work/WorkApp";

vi.mock("../src/work/WorkShell", () => ({ WorkShell: () => "shell" }));
vi.mock("../src/work/features/Login", () => ({ Login: () => "login" }));

let container: HTMLElement;
let root: Root;
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { href: "http://localhost:5180/work", origin: "http://localhost:5180" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
});

async function render() {
	// 用默认重试：说明必须在第一次失败后就出现，而不是等重试结束。
	const client = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 60_000 } } });
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter>
					<WorkApp />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 10));
	});
}

describe("/work 没有网关", () => {
	it("classifies fetch failure and non-gateway responses as no gateway", () => {
		expect(noGateway(new TypeError("Failed to fetch"))).toBe(true);
		expect(noGateway(new RpcError("unavailable", "x", 200))).toBe(true);
		expect(noGateway(new RpcError("unauthorized", "x", 401))).toBe(false);
		expect(noGateway(new RpcError("internal", "x", 500))).toBe(false);
	});

	it("shows one line with a link instead of staying on 连接中…", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
		await render();
		expect(container.textContent).toContain("本页需要连接 Yonder 节点");
		expect(container.textContent).not.toContain("连接中");
		expect(container.querySelector("a")?.getAttribute("href")).toBe("/get");
	});

	it("an HTML page instead of the gateway is also no gateway", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html>", { status: 200 })));
		await render();
		expect(container.textContent).toContain("本页需要连接 Yonder 节点");
	});
});
