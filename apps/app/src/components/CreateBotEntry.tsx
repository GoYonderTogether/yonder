import { openOnboarding } from "../lib/onboarding";
import { useNeedsBot } from "../lib/useOnboarding";
import { Button } from "../ui/Button";

/** 「创建你的 bot」：账号还没有自己的 Bot 时，聊天列表与任务页显示的唯一入口。 */
export function CreateBotEntry({ className }: { className?: string }) {
	if (!useNeedsBot()) return null;
	return (
		<Button variant="primary" className={className} onClick={openOnboarding}>
			创建你的 bot
		</Button>
	);
}
