/**
 * 应用挂载路径，以 "/" 结尾。网关托管时由它注入的 <meta name="yonder-base-path"> 给出
 * （本机 "/"，对外 "/console/"）；vite dev 与云端没有这个标签，取构建时的 BASE_URL（相对值视为 "/"）。
 */
export function appBase(): string {
	const injected = document.querySelector('meta[name="yonder-base-path"]')?.getAttribute("content");
	const base = injected ?? import.meta.env.BASE_URL;
	return base.startsWith("/") ? (base.endsWith("/") ? base : `${base}/`) : "/";
}

/** react-router 的 basename：不带尾斜杠，根路径为 "/"。 */
export const routerBasename = (): string => appBase().replace(/(.)\/$/, "$1");

/** 挂载路径下的绝对地址，供 fetch / WebSocket / Service Worker 使用，不依赖当前路由深度。 */
export const appUrl = (path: string): URL => new URL(path, new URL(appBase(), location.origin));
