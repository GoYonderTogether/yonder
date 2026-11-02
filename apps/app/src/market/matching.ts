import type { AgentTask, Listing, Match, SearchBrief } from "./types";

export function inferBrief(text: string): SearchBrief {
	const amount =
		text.match(/(?:预算|不超过|以内|最多|上限)[^\d]{0,4}(\d+(?:\.\d+)?)\s*(千|万)?/) ??
		text.match(/(\d+(?:\.\d+)?)\s*(千|万)?\s*(?:元|块)/);
	const value = amount ? Number(amount[1]) * (amount[2] === "万" ? 10000 : amount[2] === "千" ? 1000 : 1) : 3000;
	const city = ["上海", "杭州", "苏州", "南京", "北京", "深圳", "广州", "成都"].find((c) => text.includes(c)) ?? "不限";
	const category = /拍产品|产品照|手作|网站|网页|设计/.test(text)
		? "创意服务"
		: /相机|拍照|耳机|电脑|笔记本|数码|微单/.test(text)
			? "数码好物"
			: /咖啡|手冲|学习|陪伴/.test(text)
				? "技能与陪伴"
				: /骑行|自行车|公路车|露营/.test(text)
					? "户外出行"
					: /阳台|花园|植物|租房|空间|陶杯/.test(text)
						? "生活方式"
						: "不限";
	return {
		text,
		category,
		budget: Number.isFinite(value) && value > 0 ? value : 3000,
		location: city,
		priority: "最合适",
		frequency: "每小时",
	};
}

/**
 * 候选来自云端按需求条件做的只读搜索（market/needs.ts），这里只补可核对的理由，
 * 不再在本地猜相似度：预算、同城、线上交付与待确认细节都是帖子自己的字段。
 */
export function describeMatch(listing: Listing, brief: SearchBrief): Match {
	const reasons = [`报价 ¥${listing.price.toLocaleString()}${listing.unit}，在预算内`];
	if (brief.location !== "不限" && listing.location === brief.location)
		reasons.push(`${listing.location}同城，沟通交付更方便`);
	if (listing.location === "线上") reasons.push("支持线上交付");
	return {
		listing,
		reasons,
		tradeoff: listing.missing[0] ? `${listing.missing[0]}待确认` : "交付细节需要双方确认",
	};
}

export function taskTitle(text: string) {
	return text
		.trim()
		.replace(/[。！!？?].*$/, "")
		.slice(0, 22);
}
export function taskBrief(task: AgentTask): SearchBrief {
	return {
		text: task.text,
		category: task.category,
		budget: task.budget,
		location: task.location,
		priority: task.priority,
		frequency: task.frequency,
	};
}
export function timeAgo(time: number) {
	const mins = Math.max(0, Math.floor((Date.now() - time) / 60000));
	return mins < 1
		? "刚刚"
		: mins < 60
			? `${mins} 分钟前`
			: mins < 1440
				? `${Math.floor(mins / 60)} 小时前`
				: `${Math.floor(mins / 1440)} 天前`;
}
