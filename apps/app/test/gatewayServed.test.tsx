import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { socialServiceOf } from "../src/lib/useWorkEntry";
import { $session } from "../src/store";

vi.mock("../src/work/WorkRoot", () => ({ default: () => "work-root" }));

describe("socialServiceOf", () => {
	it("is none only when the gateway is reachable and /api/session is 404", () => {
		expect(socialServiceOf({ gatewayReachable: true, sessionStatus: 404 })).toBe("none");
		expect(socialServiceOf({ gatewayReachable: true, sessionStatus: 200 })).toBe("present");
		expect(socialServiceOf({ gatewayReachable: true, sessionStatus: null })).toBe("present");
		expect(socialServiceOf({ gatewayReachable: false, sessionStatus: 404 })).toBe("present");
	});
});

let container: HTMLElement;
let root: Root;
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { href: "http://localhost/", origin: "http://localhost" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	$session.set(null);
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
});

function Path() {
	return <i id="path">{useLocation().pathname}</i>;
}

async function render(path: string) {
	const client = new QueryClient();
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={[path]}>
					<App />
					<Path />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 300));
	});
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("gateway served console", () => {
	it("lands on /work without login or prototype banner when /api/session is 404", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: URL | string) =>
				String(url).includes("api/session") ? json({ error: "unknown endpoint" }, 404) : json({ ok: true, result: {} }),
			),
		);
		for (const path of ["/", "/work", "/me"]) {
			await act(() => root.render(null));
			await render(path);
			expect(container.ownerDocument.getElementById("path")?.textContent).toBe("/work");
			expect(container.textContent).toContain("work-root");
			expect(container.textContent).not.toContain("本地原型模式");
		}
	});

	it("keeps the social login gate when the gateway is unreachable", async () => {
		const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
		vi.stubGlobal("fetch", f);
		await render("/work");
		// 没有网关：走原有的登录门，不进入网关控制台。
		expect(container.textContent).not.toContain("work-root");
		expect(f).toHaveBeenCalledTimes(1);
	});
});
