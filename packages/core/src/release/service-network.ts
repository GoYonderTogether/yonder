/** Preserve explicitly configured service networking, without inheriting unrelated shell secrets. */
export function serviceNetworkEnvironment(
	existing: NodeJS.ProcessEnv = {},
	inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const names of [
		["HTTP_PROXY", "http_proxy"],
		["HTTPS_PROXY", "https_proxy"],
		["ALL_PROXY", "all_proxy"],
		["NO_PROXY", "no_proxy"],
		["NODE_USE_ENV_PROXY"],
	]) {
		const source = names.some((name) => existing[name] !== undefined) ? existing : inherited;
		for (const name of names) if (typeof source[name] === "string") result[name] = source[name]!;
	}
	return result;
}
