import type { AgentTask, Listing, Match, SearchBrief } from "./types";

const concepts: { words: string[]; terms: string[] }[] = [
	{ words: ["相机", "摄影入门", "拍照", "微单"], terms: ["相机", "微单", "单反"] },
	{ words: ["拍产品", "产品照", "手作", "寄拍", "拍摄"], terms: ["照片", "摄影师", "寄拍", "精修"] },
	{ words: ["咖啡", "手冲"], terms: ["咖啡", "手冲"] },
	{ words: ["植物", "阳台", "花园", "租房", "改造"], terms: ["空间", "植物", "布局", "改造"] },
	{ words: ["网站", "网页", "小店首页"], terms: ["网站", "页面", "开发者"] },
	{ words: ["骑行", "自行车", "公路车"], terms: ["骑行", "公路车", "通勤"] },
	{ words: ["耳机", "降噪"], terms: ["耳机", "降噪"] },
	{ words: ["电脑", "笔记本", "轻薄本"], terms: ["轻薄本", "MacBook", "M1"] },
	{ words: ["杯子", "陶杯", "陶瓷"], terms: ["陶杯", "陶", "釉"] },
];

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

/** Transparent prototype ranking: explicit budget is a hard limit; text/category/location explain the rest. */
export function findMatches(listings: Listing[], brief: SearchBrief): Match[] {
	const intent = concepts.find((c) => c.words.some((w) => brief.text.includes(w)));
	return listings
		.filter(
			(l) =>
				!l.paused &&
				!l.mine &&
				l.discoverable !== false &&
				(l.kind === "item" || l.kind === "service") &&
				l.price <= brief.budget &&
				(brief.category === "不限" || l.category === brief.category),
		)
		.map((listing) => {
			const haystack = [listing.title, listing.description, ...listing.tags, ...listing.facts.map((f) => f.value)].join(
				" ",
			);
			const relevant = intent ? intent.terms.some((t) => haystack.includes(t)) : true;
			let score = 52 + (relevant ? 20 : 0);
			const reasons: string[] = [`报价 ¥${listing.price.toLocaleString()}，在预算内`];
			if (relevant) reasons.push(intent ? "用途与描述符合你的需求" : "属于你选择的供给范围");
			if (brief.location !== "不限" && listing.location === brief.location) {
				score += brief.priority === "同城优先" ? 16 : 10;
				reasons.push(`${listing.location}同城，沟通交付更方便`);
			}
			if (listing.location === "线上") {
				score += 5;
				reasons.push("支持线上交付");
			}
			if (brief.text.includes("轻") && /约 (\d+)g/.test(haystack)) {
				const grams = Number(haystack.match(/约 (\d+)g/)?.[1]);
				if (grams < 550) {
					score += 8;
					reasons.push(`含镜头约 ${grams}g，便于随身携带`);
				}
			}
			if (brief.priority === "价格优先") score += Math.round((1 - listing.price / brief.budget) * 16);
			if (listing.agent) score += 4;
			const tradeoff = !relevant
				? "品类相近，但具体用途未命中；需要进一步确认"
				: listing.missing[0]
					? `${listing.missing[0]}待确认`
					: "交付细节需要双方确认";
			return { listing, score: Math.min(score, 98), reasons, tradeoff, relevant };
		})
		.filter((m) => !intent || m.relevant)
		.sort((a, b) => b.score - a.score || a.listing.price - b.listing.price);
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
