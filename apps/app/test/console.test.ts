import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PAGES } from "../src/work/shell/registry";
import { href, PAGE_NAMES, parse } from "../src/work/shell/routes";
import { NAV } from "../src/work/shell/TabBar";
import type { NodeConfig } from "../src/work/api/nodes";
import { consoleRows, consoleTarget } from "../src/work/features/console/ConsoleSwitcher";

const local: NodeConfig = { id: "local", name: "本机" };
const studio: NodeConfig = { id: "n2", name: "书房", origin: "https://studio.test:7690/console" };
const office: NodeConfig = { id: "n3", name: "公司", origin: "https://office.test" };

describe("console 路由", () => {
	it("parses #/console under the work tab and round trips", () => {
		expect(parse("#/console")).toEqual({ tab: "work", page: "console" });
		expect(href(parse("#/console"))).toBe("#/console");
	});
	it("keeps older hashes working", () => {
		for (const hash of ["#/s/a", "#/c/a", "#/contacts/a", "#/work", "#/work/a", "#/me", "#/market", "#/friends/add"]) {
			expect(href(parse(hash))).toBe(hash);
		}
		expect(parse("#/nope")).toEqual({ tab: "chats" });
	});
	it("stays in the three-item IA", () => {
		// FE-R02 / O27：图标栏三项（消息 / 通讯录 / 工作）+ 底部头像；控制台是工作页里的入口。
		expect(NAV.map((item) => item.tab)).toEqual(["chats", "contacts", "work"]);
		expect(PAGE_NAMES).toContain("console");
		expect(PAGES.console.tab).toBe("work");
		expect(PAGES.console.load).toBeTypeOf("function");
	});
});

describe("consoleRows", () => {
	it("keeps the local node first and the added order for the rest", () => {
		expect(consoleRows([studio, local, office], "local").map((row) => row.id)).toEqual(["local", "n2", "n3"]);
	});
	it("marks the active node and which rows can be removed", () => {
		expect(consoleRows([local, studio], "n2")).toEqual([
			{
				id: "local",
				name: "本机",
				origin: "同源（当前页面）",
				remote: false,
				current: false,
				removable: false,
			},
			{
				id: "n2",
				name: "书房",
				origin: "https://studio.test:7690/console",
				remote: true,
				current: true,
				removable: true,
			},
		]);
	});
	it("falls back to the id when a node has no name", () => {
		expect(consoleRows([{ id: "n9" } as NodeConfig], "local")[0]?.name).toBe("n9");
	});
});

describe("consoleTarget", () => {
	it("opens the local console in place and remote ones externally", () => {
		expect(consoleTarget(local)?.external).toBe(false);
		expect(consoleTarget(local)?.href).toBe("/");
		expect(consoleTarget(studio)).toEqual({ href: "https://studio.test:7690/console", external: true });
	});
	it("has no target for a remote node without an address", () => {
		expect(consoleTarget({ id: "n4", name: "无名" })).toBeUndefined();
	});
});

describe("ConsoleSwitcher 渲染", () => {
	beforeEach(() => {
		vi.resetModules();
		const values = new Map<string, string>();
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
		});
		vi.stubGlobal("document", { baseURI: "http://localhost:7690/" });
	});

	it("explains it only controls this machine when no remote node is added", async () => {
		const { ConsoleSwitcher } = await import("../src/work/features/console/ConsoleSwitcher");
		const html = render(createElement(ConsoleSwitcher));
		expect(html).toContain("只控制本机");
		expect(html).toContain("添加设备");
		expect(html).toContain("打开本机控制台");
		expect(html).not.toContain("远程节点的限制");
	});

	it("lists remote nodes with the remote scope limits spelled out", async () => {
		localStorage.setItem("yonder.nodes", JSON.stringify([local, studio]));
		const { ConsoleSwitcher } = await import("../src/work/features/console/ConsoleSwitcher");
		const html = render(createElement(ConsoleSwitcher));
		expect(html).toContain("书房");
		expect(html).toContain("https://studio.test:7690/console");
		expect(html).toContain("远程节点的限制");
		expect(html).toContain("看不到 Bot 对话");
	});
});

function render(node: React.ReactElement) {
	return renderToStaticMarkup(
		createElement(
			QueryClientProvider,
			{ client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
			createElement(MemoryRouter, null, node),
		),
	);
}
