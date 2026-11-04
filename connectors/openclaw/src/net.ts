/** Endpoint and socket-URL validation, shared with the other connectors. */

export class EndpointError extends Error {}

export function cloudUrl(endpoint: string): URL {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		throw new EndpointError("Yonder endpoint must be an HTTP(S) origin without credentials");
	}
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/"
	)
		throw new EndpointError("Yonder endpoint must be an HTTP(S) origin without credentials");
	if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
		throw new EndpointError("Yonder endpoint requires HTTPS outside loopback");
	return url;
}

export function deviceSocketUrl(endpoint: string): string {
	const url = cloudUrl(endpoint);
	const scheme = url.protocol === "https:" ? "wss:" : "ws:";
	return `${scheme}//${url.host}/ws/device`;
}
