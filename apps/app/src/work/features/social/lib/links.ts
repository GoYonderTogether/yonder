export function profileRoute(input: string): { page: "u" | "p"; id: string } | undefined {
	try {
		const text = input.trim();
		if (!text) return;
		const url = new URL(/^(?:https?:\/\/|\/)/.test(text) ? text : `/p/${encodeURIComponent(text)}`, location.origin);
		const path = url.hash.startsWith("#/") ? url.hash.slice(1) : url.pathname;
		const match = path.match(/^\/(u|p)\/([^/]+)\/?$/);
		if (match?.[1] && match[2]) return { page: match[1] as "u" | "p", id: decodeURIComponent(match[2]) };
	} catch {}
}
