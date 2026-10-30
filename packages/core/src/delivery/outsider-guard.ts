/**
 * 外人（访客、登录外人、好友）对话的出口与入口闸门：能力白名单、每轮输出与网页搜索次数上限、
 * 提示词/工具清单防泄漏、以及「转发给别的模型 / 批量生成」这类代理用法的轮次限流。
 * 只管判定与改写，不负责发消息；调用方拿到结果后自行发送或拒绝。
 */

/** 缺省上限：单轮回复字数、每轮网页搜索次数、单条输入字数、被判定为代理用法的每小时轮次、泄漏判定片段长度。 */
export const outsiderGuardDefaults = {
	maxReplyChars: 2_000,
	maxWebSearches: 5,
	maxInputChars: 4_000,
	maxTaskRoundsPerHour: 3,
	fragment: 40,
};

export type OutsiderGuardReason = "input_too_long" | "task_rounds" | "tool_denied" | "web_search_limit";

export type OutsiderVerdict = { ok: true } | { message: string; ok: false; reason: OutsiderGuardReason };

export interface OutsiderGuardOptions {
	/** `outsiders.capabilities`：chat / web_search / public_docs，白名单外的能力一律没有。 */
	capabilities?: readonly string[];
	/** `outsiders.publicDocs`：主人公开的资料，缺省为空。 */
	publicDocs?: readonly string[];
	/** 允许调用的工具名；缺省只有网页搜索（能力里有 `web_search` 时）。 */
	tools?: readonly string[];
	/** 需要防止泄漏的系统提示词原文。 */
	systemPrompt?: string;
	/** 需要防止泄漏的工具清单或其 JSON schema 原文。 */
	toolSchema?: string;
	maxReplyChars?: number;
	maxWebSearches?: number;
	maxInputChars?: number;
	maxTaskRoundsPerHour?: number;
	now?: () => number;
}

export interface OutsiderGuard {
	/** 公开资料全文，没有时是空串。 */
	docs(): string;
	/** 调用前检查一条外来输入；拒绝时带原因与引导语。 */
	checkInput(input: { text: string; hasContext?: boolean }): OutsiderVerdict;
	/** 调用前检查一个工具调用；`turn.webSearches` 是本轮已经用掉的网页搜索次数。 */
	allowTool(name: string, turn?: { webSearches?: number }): OutsiderVerdict;
	/** 调用后处理模型回复：泄漏内部信息整段换掉，过长截断。 */
	output(text: string): { redacted: boolean; text: string };
}

const deniedMessage = "这个工具对访客不可用。访客只能聊天、按需搜索公开网页和查看公开资料。";
const truncatedReply = "这段回复涉及内部配置，已按访客规则截断。换个问法，我只按公开信息回答。";
/** 明确是代理用法的措辞：把对话当成别的模型的输入，或要求批量生成。 */
const proxyPattern = /批量生成|逐条生成|逐条改写|转发给|转发到|另一个模型|其他模型|扮演|从现在起|以后你就/i;
/** 像任务指令而不像提问的开头：没有对话上下文时，这类输入按代理用法计次。 */
const directivePattern = /^(请|帮我|把|翻译|改写|总结|生成|写一)/;
const questionPattern = /[?？]|怎么|什么|如何|为什么|是否|能不能|吗/;

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/** 判断回复里是否出现受保护文本的长片段（连续 `fragment` 个字符），逐字不相等即算没泄漏。 */
function leaks(reply: string, protectedText: string, size: number): boolean {
	const source = normalize(protectedText);
	if (!source) return false;
	const text = normalize(reply);
	if (source.length <= size) return text.includes(source);
	for (let index = 0; index + size <= text.length; index++) {
		if (source.includes(text.slice(index, index + size))) return true;
	}
	return false;
}

export function createOutsiderGuard(options: OutsiderGuardOptions = {}): OutsiderGuard {
	const capabilities = options.capabilities ?? ["chat"];
	const docs = (options.publicDocs ?? []).map((doc) => doc.trim()).filter(Boolean);
	const tools = new Set(
		options.tools ?? (capabilities.includes("web_search") ? ["web_search", "web-tools_search"] : []),
	);
	const maxReplyChars = options.maxReplyChars ?? outsiderGuardDefaults.maxReplyChars;
	const maxWebSearches = options.maxWebSearches ?? outsiderGuardDefaults.maxWebSearches;
	const maxInputChars = options.maxInputChars ?? outsiderGuardDefaults.maxInputChars;
	const maxTaskRounds = options.maxTaskRoundsPerHour ?? outsiderGuardDefaults.maxTaskRoundsPerHour;
	const fragmentSize = outsiderGuardDefaults.fragment;
	const now = options.now ?? (() => Date.now());
	const protectedText = [options.systemPrompt, options.toolSchema].filter(Boolean).join("\n");
	const rounds: number[] = [];

	/** 代理用法（转发、批量生成）按小时计次，超过上限就拒绝。 */
	function countTaskRound(): OutsiderVerdict {
		const at = now();
		for (let index = rounds.length - 1; index >= 0; index--)
			if (at - rounds[index]! >= 3_600_000) rounds.splice(index, 1);
		if (rounds.length >= maxTaskRounds)
			return {
				message: "访客每小时只能提几次这种转发或批量生成的请求，这一轮没有回复。",
				ok: false,
				reason: "task_rounds",
			};
		rounds.push(at);
		return { ok: true };
	}

	return {
		docs: () => docs.join("\n\n"),
		checkInput: ({ text, hasContext }) => {
			const body = text.trim();
			if (body.length > maxInputChars)
				return {
					message: `访客单条消息最多 ${maxInputChars} 个字符，这条太长没有回复。`,
					ok: false,
					reason: "input_too_long",
				};
			const directive = !hasContext && directivePattern.test(body) && !questionPattern.test(body);
			return proxyPattern.test(body) || directive ? countTaskRound() : { ok: true };
		},
		allowTool: (name, turn = {}) => {
			if (!tools.has(name)) return { message: deniedMessage, ok: false, reason: "tool_denied" };
			if ((turn.webSearches ?? 0) >= maxWebSearches)
				return {
					message: `访客每轮最多搜索 ${maxWebSearches} 次，先按已经查到的内容回答。`,
					ok: false,
					reason: "web_search_limit",
				};
			return { ok: true };
		},
		output: (text) => {
			if (leaks(text, protectedText, fragmentSize)) return { redacted: true, text: truncatedReply };
			if (text.length <= maxReplyChars) return { redacted: false, text };
			return { redacted: false, text: `${text.slice(0, maxReplyChars)}\n\n（回复太长，已截断）` };
		},
	};
}
