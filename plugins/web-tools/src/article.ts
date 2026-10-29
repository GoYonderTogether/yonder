import { Readability } from "@mozilla/readability";
import type { ToolContext } from "@yonder/sdk";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { MAX_OUTPUT, readBody, urlValue } from "./shared.js";

const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
export type PageFormat = "markdown" | "text" | "html";
export type PageResult =
	| {
			kind: "page";
			url: string;
			mime: string;
			format: PageFormat;
			title?: string | undefined;
			content: string;
			truncated: boolean;
			path?: string | undefined;
	  }
	| { kind: "binary"; url: string; mime: string };

/** Bounded public GET with article extraction; the only place that turns HTML into text. */
export async function fetchPage(input: string, format: PageFormat, ctx: ToolContext): Promise<PageResult> {
	let url = urlValue(input);
	const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(30000)]);
	for (let redirects = 0; redirects <= 5; redirects++) {
		signal.throwIfAborted();
		const response = await fetch(url, { method: "GET", credentials: "omit", redirect: "manual", signal });
		if ([301, 302, 303, 307, 308].includes(response.status)) {
			await response.body?.cancel();
			const next = response.headers.get("location");
			if (!next) throw new Error("Redirect missing Location");
			url = urlValue(new URL(next, url).href);
			continue;
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error(
				`HTTP ${response.status} ${url.href}${[401, 403].includes(response.status) ? "; use BrowserSkill with an authorized login" : ""}`,
			);
		}
		const mime =
			response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "application/octet-stream";
		if (
			!mime.startsWith("text/") &&
			mime !== "application/xhtml+xml" &&
			mime !== "application/json" &&
			!mime.endsWith("+json")
		) {
			await response.body?.cancel();
			return { kind: "binary", url: url.href, mime };
		}
		const body = await readBody(response, ctx.cacheToolOutputStream);
		let content = body.text;
		let title: string | undefined;
		if (["text/html", "application/xhtml+xml"].includes(mime)) {
			const { document } = parseHTML(body.text);
			const base = document.createElement("base");
			base.setAttribute("href", url.href);
			document.head.prepend(base);
			if (document.querySelector('input[type="password"]') || /\/(login|signin|sign-in)(\/|$)/i.test(url.pathname))
				throw new Error(`LOGIN_REQUIRED: ${url.href}; use BrowserSkill with an authorized login`);
			for (const node of document.querySelectorAll("script,style,noscript,template")) node.remove();
			const visible = document.body.textContent?.trim() ?? "";
			if (
				visible.length < 200 &&
				/enable javascript|javascript (?:is )?required|loading[. …]*$|加载中|请.*javascript/i.test(visible)
			)
				throw new Error(`JS_CONTENT_UNAVAILABLE: ${url.href}; use explicit Tavily extract`);
			const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0]).parse();
			if (!article?.textContent?.trim())
				throw new Error(`ARTICLE_UNAVAILABLE: ${url.href}; JS pages may use explicit Tavily extract`);
			title = article.title ?? undefined;
			content =
				format === "html"
					? (article.content ?? "")
					: format === "text"
						? article.textContent
						: markdown.turndown(article.content ?? "");
		}
		if (body.truncated)
			content = Buffer.from(content)
				.subarray(0, MAX_OUTPUT / 8)
				.toString("utf8");
		return { kind: "page", url: url.href, mime, format, title, content, truncated: body.truncated, path: body.path };
	}
	throw new Error("Too many redirects (maximum 5)");
}
