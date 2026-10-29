/** 公共图片 URL：只在浏览器里加载，绝不经过 API 服务端。与名片站同一份校验。 */
export function isAvatarUrl(value: unknown): value is string {
	if (typeof value !== "string") return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			!url.port &&
			/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname) &&
			!/(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example|onion)$|\.home\.arpa$/i.test(url.hostname)
		);
	} catch {
		return false;
	}
}
