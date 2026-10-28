const legacyRoutes = [/^\/(?:u|p|g|c|contacts|cards)\/[^/]+$/, /^\/(?:get|connect|me|friends\/add)$/];

export function upgradeLegacyLocation(): void {
	if (location.hash) return;
	const consolePrefix = location.pathname.startsWith("/console/");
	let path = consolePrefix ? location.pathname.slice("/console".length) : location.pathname;
	if (path === "/login") path = "/me";
	else path = path.replace(/^(\/cards\/[^/]+)\/edit$/, "$1");
	if (!legacyRoutes.some((route) => route.test(path))) return;
	history.replaceState(history.state, "", `${consolePrefix ? "/console/" : "/"}${location.search}#${path}`);
}
