/** Display text only: the stored optional tagline is never filled from the body. */
export function cardSummary(tagline: string | null | undefined, markdown: string): string | null {
	if (tagline?.trim()) return tagline.trim();
	const blocks = markdown
		.replace(/(^|\n) {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\2[^\n]*(?=\n|$)|$)/g, "\n")
		.split(/\n\s*\n/);
	let list: string | null = null;
	for (const block of blocks) {
		if (/^\s*(?:#{1,6}\s|<h[1-6]\b)/i.test(block) || /\n\s*(?:=+|-+)\s*$/.test(block)) continue;
		const text = block
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			.replace(/<[^>]*>/g, "")
			.replace(/^\s*(?:>\s*|[-*+]\s+|\d+[.)]\s+)/gm, "")
			.replace(/[*_`~]/g, "")
			.replace(/\\([\\`*{}[\]()#+.!_>-])/g, "$1")
			.replace(/\s+/g, " ")
			.trim();
		if (!text || /^[-=]+$/.test(text)) continue;
		if (/^\s*(?:[-*+]\s|\d+[.)]\s)/.test(block)) {
			list ??= text;
			continue;
		}
		return text;
	}
	return list;
}
