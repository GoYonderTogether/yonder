/**
 * 注册控制台唯一的 Service Worker。脚本地址按网关注入的 <base href> 解析，
 * 因此本机 "/" 与云端 "/console/" 都不需要硬编码路径；SW 的 scope 就是脚本所在目录。
 *
 * 更新不循环：worker 不接管导航、不缓存 index.html，也从不 reload 或跳转页面。
 * 新版本由 UpdateNotice 依据 version.json 提示，用户自己点刷新；这里只在注册失败时记一条警告，
 * 不让注册过程阻塞渲染或抛到调用方。
 */
export function registerConsoleWorker(): void {
	if (!("serviceWorker" in navigator)) return;
	const failed = (error: unknown) => console.warn("控制台缓存注册失败，下次打开时重试", error);
	try {
		const script = new URL("yonder-sw.js", document.baseURI);
		navigator.serviceWorker
			.register(script, { scope: new URL("./", script).pathname, updateViaCache: "none" })
			.catch(failed);
	} catch (error) {
		failed(error);
	}
}
