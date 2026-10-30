import { Readability } from "@mozilla/readability";
import type { ToolContext } from "@yonder/sdk";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { fetchGithubDocument, githubTarget } from "./github.js";
import { extractPdfText, isPdf } from "./pdf.js";
import { httpGet, MAX_OUTPUT, urlValue } from "./shared.js";

const markdown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
export type PageFormat = "markdown" | "text" | "html";
export type PageResult =
	| {
			kind: "page";
			url: string;
			mime: string;
			source: "http-get" | "pdf" | "github";
			doc?: string | undefined;
			format: PageFormat;
			title?: string | undefined;
			content: string;
			truncated: boolean;
			pages?: number | undefined;
			path?: string | undefined;
	  }
	| { kind: "binary"; url: string; mime: string };

const PDF_MIME = new Set(["application/pdf", "application/x-pdf"]);

/** Bounded public GET with article, PDF and GitHub extraction; the only place that turns pages into text. */
export async function fetchPage(input: string, format: PageFormat, ctx: ToolContext): Promise<PageResult> {
	const url = urlValue(input);
	const target = githubTarget(url);
	if (target) {
		const document = await fetchGithubDocument(target, ctx);
		if (document.kind === "binary") return { kind: "binary", url: document.url, mime: document.mime };
		return {
			kind: "page",
			url: document.url,
			mime: document.mime,
			source: "github",
			doc: document.doc,
			format: "text",
			title: document.title,
			content: document.content,
			truncated: document.truncated,
			...(document.path ? { path: document.path } : {}),
		};
	}
	const response = await httpGet(url, ctx);
	if (response.kind === "binary") return { kind: "binary", url: response.url.href, mime: response.mime };
	if (PDF_MIME.has(response.mime) || isPdf(response.bytes)) {
		const extracted = extractPdfText(response.bytes);
		return {
			kind: "page",
			url: response.url.href,
			mime: PDF_MIME.has(response.mime) ? response.mime : "application/pdf",
			source: "pdf",
			doc: "pdf",
			format: "text",
			title: extracted.title,
			content: extracted.text || `PDF_TEXT_EMPTY: ${response.url.href}; the document may be scanned or encrypted`,
			truncated: extracted.truncated || response.truncated,
			pages: extracted.pages,
			...(response.path ? { path: response.path } : {}),
		};
	}
	const text = Buffer.from(response.bytes).toString("utf8");
	let content = text;
	let title: string | undefined;
	if (["text/html", "application/xhtml+xml"].includes(response.mime)) {
		const { document } = parseHTML(text);
		const base = document.createElement("base");
		base.setAttribute("href", response.url.href);
		document.head.prepend(base);
		if (
			document.querySelector('input[type="password"]') ||
			/\/(login|signin|sign-in)(\/|$)/i.test(response.url.pathname)
		)
			throw new Error(`LOGIN_REQUIRED: ${response.url.href}; use BrowserSkill with an authorized login`);
		for (const node of document.querySelectorAll("script,style,noscript,template")) node.remove();
		const visible = document.body.textContent?.trim() ?? "";
		if (
			visible.length < 200 &&
			/enable javascript|javascript (?:is )?required|loading[. …]*$|加载中|请.*javascript/i.test(visible)
		)
			throw new Error(`JS_CONTENT_UNAVAILABLE: ${response.url.href}; use explicit Tavily extract`);
		// SAFETY: Readability accepts a DOM document; this module already parsed `document` from the fetched HTML.
		const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0]).parse();
		if (!article?.textContent?.trim())
			throw new Error(`ARTICLE_UNAVAILABLE: ${response.url.href}; JS pages may use explicit Tavily extract`);
		title = article.title ?? undefined;
		content =
			format === "html"
				? (article.content ?? "")
				: format === "text"
					? article.textContent
					: markdown.turndown(article.content ?? "");
	}
	if (response.truncated)
		content = Buffer.from(content)
			.subarray(0, MAX_OUTPUT / 8)
			.toString("utf8");
	return {
		kind: "page",
		url: response.url.href,
		mime: response.mime,
		source: "http-get",
		format,
		title,
		content,
		truncated: response.truncated,
		...(response.path ? { path: response.path } : {}),
	};
}
