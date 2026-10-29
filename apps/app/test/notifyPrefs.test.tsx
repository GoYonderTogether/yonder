import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotifySection } from "../src/work/features/settings/NotifySection";

let container: HTMLElement;
let root: Root;
let stored: Map<string, string>;
let calls: Array<{ method: string; params: unknown }>;

beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { href: "http://localhost:5180/work", origin: "http://localhost:5180" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	stored = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => stored.get(key) ?? null,
		setItem: (key: string, value: string) => stored.set(key, value),
	});
	calls = [];
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
});

/** 只替换 fetch：rpc 仍按真实实现打 api/rpc/<method>，断言的是网关收到的形状。 */
function serve(result: unknown) {
	const fetchMock = vi.fn(async (input: unknown, init?: { body?: string }) => {
		const method = new URL(String(input)).pathname.replace("/api/rpc/", "");
		calls.push({ method, params: JSON.parse(init?.body ?? "null") });
		return { status: 200, json: async () => ({ ok: true, result }) };
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

async function render() {
	await act(async () =>
		root.render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<NotifySection />
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 10));
	});
}

function toggle(label: string): HTMLButtonElement {
	const found = [...container.querySelectorAll("button")].find((el) => el.textContent?.startsWith(label));
	if (!found) throw new Error(`switch missing: ${label}`);
	return found;
}

async function click(el: HTMLButtonElement) {
	await act(async () => el.dispatchEvent(new window.Event("click", { bubbles: true })));
}

const prefs = (level: "all" | "mentions" | "mute") => ({
	default: level,
	conversations: {},
	sources: { default: "yaml", conversations: {} },
});

describe("通知偏好走网关", () => {
	it("进入页面读 notifications.prefs.get，并用节点上的值决定开关状态", async () => {
		serve(prefs("mute"));
		await render();
		expect(calls[0]).toEqual({ method: "notifications.prefs.get", params: {} });
		expect(toggle("通知").getAttribute("aria-checked")).toBe("false");
		expect(container.textContent).toContain("通知开关存在节点上");
		expect(container.textContent).not.toContain("只保存在这台设备的浏览器里");
	});

	it("改成免打扰时调 notifications.prefs.set，写默认值 *", async () => {
		serve(prefs("all"));
		await render();
		expect(toggle("通知").getAttribute("aria-checked")).toBe("true");
		await click(toggle("通知"));
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		expect(calls.filter((call) => call.method === "notifications.prefs.set")).toEqual([
			{ method: "notifications.prefs.set", params: { conv: "*", level: "mute" } },
		]);
		expect(toggle("通知").getAttribute("aria-checked")).toBe("false");
	});

	it("连不上节点时退回本地存储，不发 set", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new TypeError("Failed to fetch");
			}),
		);
		await render();
		expect(container.textContent).toContain("还没连上节点");
		const before = toggle("通知").getAttribute("aria-checked");
		await click(toggle("通知"));
		expect(JSON.parse(stored.get("yonder.prefs") ?? "{}").notify.enabled).toBe(before !== "true");
		expect(calls).toEqual([]);
		expect(toggle("通知").getAttribute("aria-checked")).toBe(String(before !== "true"));
	});
});
