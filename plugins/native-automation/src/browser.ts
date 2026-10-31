import { access } from "node:fs/promises";
import type { ToolContext, ToolResult } from "@yonder/sdk";
import { chromium } from "playwright-core";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { type Automation, type BrowserSession, check, closeSession, image, requireField, result } from "./common.js";

export const browserSchema = Type.Object(
	{
		action: Type.Union(
			[
				"status",
				"navigate",
				"snapshot",
				"click",
				"fill",
				"press",
				"select",
				"screenshot",
				"evaluate",
				"tabs",
				"new-tab",
				"select-tab",
				"close-tab",
				"back",
				"forward",
				"reload",
				"close",
			].map((x) => Type.Literal(x)),
		),
		url: Type.Optional(Type.String()),
		selector: Type.Optional(Type.String()),
		text: Type.Optional(Type.String()),
		key: Type.Optional(Type.String()),
		values: Type.Optional(Type.Array(Type.String())),
		expression: Type.Optional(Type.String()),
		tab: Type.Optional(Type.Integer({ minimum: 0 })),
		fullPage: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
type Args = {
	action: string;
	url?: string;
	selector?: string;
	text?: string;
	key?: string;
	values?: string[];
	expression?: string;
	tab?: number;
	fullPage?: boolean;
};
const candidates = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	chromium.executablePath(),
];
export async function detectBrowser() {
	for (const path of candidates) {
		try {
			await access(path);
			return path;
		} catch {}
	}
	return undefined;
}
async function session(state: Automation, ctx: ToolContext): Promise<BrowserSession> {
	if (state.stopping || state.closed.has(ctx.session)) throw new Error("Automation plugin/session stopping");
	let pending = state.sessions.get(ctx.session);
	if (!pending) {
		pending = (async () => {
			const executablePath = await detectBrowser();
			if (!executablePath)
				throw new Error(
					"No supported Chromium browser found. Install Google Chrome/Edge/Chromium or explicitly install Playwright Chromium with npx playwright-core install chromium. Safari is not a Chromium CDP target and is not controlled by this driver.",
				);
			ctx.signal.throwIfAborted();
			if (state.stopping || state.closed.has(ctx.session)) throw new Error("Automation plugin/session stopping");
			const browser = await chromium.launch({ executablePath, headless: true });
			if (state.stopping || state.closed.has(ctx.session) || ctx.signal.aborted) {
				await browser.close();
				throw new Error("Browser initialization cancelled");
			}
			try {
				const context = await browser.newContext({
					viewport: { width: 1280, height: 800 },
					acceptDownloads: false,
				});
				const page = await context.newPage();
				page.setDefaultTimeout(15000);
				page.setDefaultNavigationTimeout(45000);
				browser.on("disconnected", () => {
					if (state.sessions.get(ctx.session) === pending) state.sessions.delete(ctx.session);
				});
				return { browser, context, page, tail: Promise.resolve() };
			} catch (error) {
				await browser.close();
				throw error;
			}
		})();
		state.sessions.set(ctx.session, pending);
		void pending.catch(() => {
			if (state.sessions.get(ctx.session) === pending) state.sessions.delete(ctx.session);
		});
	}
	return pending;
}
export async function browserRun(state: Automation, input: unknown, ctx: ToolContext): Promise<ToolResult> {
	try {
		check(state, ctx, ["exec", "read", "write", "network", "message"]);
		if (!Value.Check(browserSchema, input)) throw new Error("Invalid native-automation_browser arguments");
		const args = input as Args;
		if (args.action === "status")
			return result({
				executable: (await detectBrowser()) ?? null,
				ownedSession: state.sessions.has(ctx.session),
				headless: true,
				scope: "isolated Yonder session, no user profile/cookies",
			});
		if (args.action === "close") {
			await closeSession(state, ctx.session);
			return result({ closed: true });
		}
		const s = await session(state, ctx);
		const previous = s.tail;
		let release: () => void = () => {};
		s.tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		// Cancelling this owned browser also terminates in-flight Playwright operations and pending navigation.
		const cancel = () => {
			void closeSession(state, ctx.session);
		};
		ctx.signal.addEventListener("abort", cancel, { once: true });
		try {
			ctx.signal.throwIfAborted();
			if (state.sessions.get(ctx.session) === undefined) throw new Error("Browser session closed");
			const page = s.page;
			let output: unknown;
			switch (args.action) {
				case "navigate": {
					const url = new URL(requireField(args.url, "url"));
					if (!["http:", "https:", "file:", "about:"].includes(url.protocol))
						throw new Error("Navigation supports HTTP(S), file and about URLs only");
					const response = await page.goto(url.href, { waitUntil: "domcontentloaded" });
					output = { url: page.url(), title: await page.title(), status: response?.status() ?? null };
					break;
				}
				case "snapshot": {
					const snapshot = await page.locator("body").ariaSnapshot();
					output = {
						url: page.url(),
						title: await page.title(),
						snapshot: snapshot.slice(0, 50000),
						truncated: snapshot.length > 50000,
					};
					break;
				}
				case "click":
					await page.locator(requireField(args.selector, "selector")).click();
					output = { clicked: args.selector, url: page.url() };
					break;
				case "fill":
					await page.locator(requireField(args.selector, "selector")).fill(requireField(args.text, "text"));
					output = { filled: args.selector };
					break;
				case "press":
					await page.locator(requireField(args.selector, "selector")).press(requireField(args.key, "key"));
					output = { pressed: args.key };
					break;
				case "select":
					output = {
						selected: await page
							.locator(requireField(args.selector, "selector"))
							.selectOption(requireField(args.values, "values")),
					};
					break;
				case "evaluate": {
					const expression = requireField(args.expression, "expression");
					output = await page.evaluate(expression);
					const serialized = JSON.stringify(output);
					if (serialized && serialized.length > 50000)
						throw new Error("Evaluate result exceeds 50000 characters; return a smaller value");
					break;
				}
				case "screenshot":
					return await image(
						state,
						await page.screenshot({ type: "png", fullPage: args.fullPage ?? false }),
						"Playwright isolated headless browser",
					);
				case "tabs":
					output = s.context.pages().map((p, index) => ({ tab: index, url: p.url(), selected: p === s.page }));
					break;
				case "new-tab":
					s.page = await s.context.newPage();
					output = { tab: s.context.pages().indexOf(s.page) };
					break;
				case "select-tab": {
					const selected = s.context.pages()[requireField(args.tab, "tab")];
					if (!selected) throw new Error("Tab does not exist in this session");
					s.page = selected;
					output = { url: selected.url() };
					break;
				}
				case "close-tab":
					await page.close();
					s.page = s.context.pages()[0] ?? (await s.context.newPage());
					output = { url: s.page.url() };
					break;
				case "back":
					await page.goBack({ waitUntil: "domcontentloaded" });
					output = { url: page.url() };
					break;
				case "forward":
					await page.goForward({ waitUntil: "domcontentloaded" });
					output = { url: page.url() };
					break;
				case "reload":
					await page.reload({ waitUntil: "domcontentloaded" });
					output = { url: page.url() };
					break;
				default:
					throw new Error("Unknown browser action");
			}
			ctx.signal.throwIfAborted();
			return result({ source: "Playwright isolated headless browser", result: output });
		} finally {
			ctx.signal.removeEventListener("abort", cancel);
			release();
		}
	} catch (error) {
		return {
			...result({
				error: String(error).slice(0, 10000),
				hint: "Inspect current page before repeating any side effect. Cancellation closes this session's browser.",
			}),
			isError: true,
		};
	}
}
