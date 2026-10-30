/** 访客额度用尽时待发的消息：存进 sessionStorage，刷新、跳转登录页再回来后还能补发。 */
const key = (convId: string) => `yonder:pending-send:${convId}`;

export function savePendingSend(convId: string, body: string): void {
	try {
		sessionStorage.setItem(key(convId), body);
	} catch {}
}

/** 取出并删除，保证只补发一次。 */
export function takePendingSend(convId: string): string {
	try {
		const body = sessionStorage.getItem(key(convId)) ?? "";
		sessionStorage.removeItem(key(convId));
		return body;
	} catch {
		return "";
	}
}

export function clearPendingSend(convId: string): void {
	try {
		sessionStorage.removeItem(key(convId));
	} catch {}
}
