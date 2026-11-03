import { redactError } from "./model-notice.js";

/** Cloud channels expose one final result, including a truthful sanitized failure. */
export function cloudFailure(reason: string): string {
	const clean = redactError(reason)
		.replace(/https?:\/\/\S+/g, "[上游地址]")
		.replace(/\s+/g, " ")
		.slice(0, 300);
	const admission = clean.indexOf("云端额度");
	if (admission >= 0) return clean.slice(admission);
	if (clean.includes("已达到云端 Bot 每小时回复上限")) return "已达到云端 Bot 每小时回复上限";
	const status = clean.match(/\b(?:HTTP\s*)?([45]\d\d)\b/i)?.[1];
	if (status) return `云端模型调用失败：上游返回 HTTP ${status}`;
	if (/timeout|timed out|deadline|超时/i.test(clean)) return `云端模型调用超时：${clean}`;
	return `云端模型调用失败：${clean || "没有返回可见内容"}`;
}
