// 直接取具体模块而不是 api/social 的桶导出：单测常把桶模块整体 mock 掉，instanceof 需要真实的类。
import { SocialError } from "../../../api/social/http";
import { messageOf } from "./session";

/**
 * 社交后端不可达：网关没有代理社交接口（404），或者请求根本没有发出去（浏览器里 fetch 失败是 TypeError）。
 * 与「联系人不存在」区分：后者接口存在且返回了空结果，不应显示成「节点没有社交服务」。
 */
export function socialUnavailable(error: unknown): boolean {
	if (error instanceof SocialError) return error.status === 404;
	return error instanceof TypeError;
}

/** 加载失败的一句话文案：不可达时说清当前节点没有社交服务，其他错误保留原始信息。 */
export function socialLoadError(error: unknown, fallback: string): string {
	if (socialUnavailable(error)) return "当前节点没有提供社交服务";
	return messageOf(error, fallback);
}
