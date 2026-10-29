import type { Tool } from "@yonder/sdk";

// Code-intel results carry their own budget so the model sees one bounded payload
// with an explicit truncation signal, independent of the runtime's 50 KiB cache bound.
export const MAX_RESULT_BYTES = 40 * 1024;
const FOOTER_RESERVE_BYTES = 128;

function bound(text: string, budget: number): { text: string; truncated: boolean } {
	if (Buffer.byteLength(text, "utf8") <= budget) return { text, truncated: false };
	let keep = Math.max(0, Math.floor((budget / Buffer.byteLength(text, "utf8")) * text.length));
	for (;;) {
		const head = Math.floor(keep / 2);
		const tail = keep - head;
		const marker = `\n[truncated: ${text.length - keep} characters omitted]\n`;
		const candidate = `${text.slice(0, head)}${marker}${tail > 0 ? text.slice(text.length - tail) : ""}`;
		if (keep === 0 || Buffer.byteLength(candidate, "utf8") <= budget) return { text: candidate, truncated: true };
		keep = Math.floor(keep * 0.9);
	}
}

// pi-lens MCP results may already end with this contract; like upstream, do not stamp twice.
const FOOTER_RE = /\nusage tokens=\d+ elapsed-ms=\d+ bytes=\d+ truncated=(?:true|false)$/;

export function withResultContract(tool: Tool): Tool {
	return {
		...tool,
		async execute(value, ctx) {
			const started = Date.now();
			const result = await tool.execute(value, ctx);
			if (FOOTER_RE.test(result.text) && Buffer.byteLength(result.text, "utf8") <= MAX_RESULT_BYTES) return result;
			const bounded = bound(result.text.replace(FOOTER_RE, ""), MAX_RESULT_BYTES - FOOTER_RESERVE_BYTES);
			const bytes = Buffer.byteLength(bounded.text, "utf8");
			const footer = `usage tokens=${Math.ceil(bytes / 4)} elapsed-ms=${Date.now() - started} bytes=${bytes} truncated=${bounded.truncated}`;
			return { ...result, text: `${bounded.text}\n${footer}` };
		},
	};
}
