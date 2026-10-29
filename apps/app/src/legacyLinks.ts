/** 旧的 #/… 链接（hash 路由时代）→ 新路径。无法识别的 hash 保持原样。 */
const SAME = new Set(["c", "contacts", "cards", "me", "u", "p", "g", "get", "connect", "friends"]);

export function pathOfLegacyHash(hash: string): string | undefined {
	if (!hash.startsWith("#/")) return undefined;
	const [path = "", query = ""] = hash.slice(1).split("?", 2);
	const parts = path.split("/").filter(Boolean);
	const [head, ...rest] = parts;
	const tail = rest.length ? `/${rest.join("/")}` : "";
	let next: string | undefined;
	if (!head) next = "/";
	else if (head === "s" || head === "work") next = `/work${tail}`;
	else if (head === "console" || head === "market") next = `/work/${head}`;
	else if (SAME.has(head)) next = `/${head}${tail}`;
	return next === undefined ? undefined : query ? `${next}?${query}` : next;
}

/** 启动时把 #/… 换成真实路径；base 是应用挂载路径（以 / 结尾）。 */
export function upgradeLegacyLocation(base: string): void {
	const next = pathOfLegacyHash(location.hash);
	if (next === undefined) return;
	const [path = "/", query] = next.split("?", 2);
	const search = [location.search.replace(/^\?/, ""), query].filter(Boolean).join("&");
	history.replaceState(history.state, "", `${base}${path.slice(1)}${search ? `?${search}` : ""}`);
}
