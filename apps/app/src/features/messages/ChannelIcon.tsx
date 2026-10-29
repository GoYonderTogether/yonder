import {
	Bot,
	Clock,
	Cpu,
	GitBranch,
	IdCard,
	type LucideIcon,
	MessageCircle,
	MessageSquare,
	MessageSquareText,
	MessagesSquare,
	Monitor,
	Plug,
	Terminal,
} from "lucide-react";
import { channelType } from "../../lib/chat";

/**
 * 渠道色块：中性圆角方块 + 单色字形。只表达「哪个渠道」，不用任何品牌 logo
 * （C3 §2.4：图标许可未核实）。键是渠道类型；实例 id（qq-main、feishu-main…）先归一。
 */
const GLYPHS: Record<string, LucideIcon> = {
	cli: Terminal,
	console: Monitor,
	card: IdCard,
	wechat: MessageCircle,
	"wechat-ilink": MessageCircle,
	qq: MessagesSquare,
	feishu: MessageSquareText,
	github: GitBranch,
	mcp: Plug,
	agent: Bot,
	cron: Clock,
	pi: Cpu,
};

/** 未知渠道用中性对话字形，不猜品牌；没有渠道就是控制台。 */
export function channelGlyph(channel?: string): LucideIcon {
	return GLYPHS[channelType(channel) ?? "console"] ?? MessageSquare;
}

export function ChannelIcon({ channel, size = 16 }: { channel?: string; size?: number }) {
	const Icon = channelGlyph(channel);
	return (
		<span
			aria-hidden
			data-testid="channel-icon"
			data-channel={channelType(channel) ?? "console"}
			className="inline-flex shrink-0 items-center justify-center rounded-[5px] bg-tone text-muted"
			style={{ width: size, height: size }}
		>
			<Icon size={Math.round(size * 0.68)} />
		</span>
	);
}
