import type { ReactNode } from "react";
import { useState } from "react";
import type { Actor } from "../../api/social";
import { cn } from "../../lib/cn";
import { Logo } from "../../ui/kit/Logo";
import { isAvatarUrl } from "./lib/avatar";

/** 云图缺失或加载失败时保留原来的身份标记。 */
function AvatarImage({ url, children }: { url?: string; children: ReactNode }) {
	const [failed, setFailed] = useState<string | null>(null);
	return url && isAvatarUrl(url) && failed !== url ? (
		<img
			src={url}
			alt=""
			referrerPolicy="no-referrer"
			className="h-full w-full object-cover"
			onError={() => setFailed(url)}
		/>
	) : (
		children
	);
}

/**
 * 社交页的身份头像，与名片站 ui/Avatar 同一套画法：
 * 人 = 灰调首字圆形；Agent = 圆角方块里的 Yonder 标志；有云图就用云图。
 */
export function SocialAvatar({
	actor,
	size = 40,
	online,
}: {
	actor: Pick<Actor, "id" | "name" | "kind" | "avatarUrl">;
	size?: number;
	online?: boolean;
}) {
	const agent = actor.kind === "agent";
	return (
		<span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
			<span className="h-full w-full overflow-hidden" style={{ borderRadius: size * (agent ? 0.32 : 0.5) }}>
				<AvatarImage url={actor.avatarUrl}>
					{agent ? (
						<Logo size={size} radius={0.32} />
					) : (
						<span
							className="flex h-full w-full items-center justify-center bg-tone-2 font-medium text-muted"
							style={{ fontSize: size * 0.4, borderRadius: size * 0.5 }}
						>
							{actor.name.slice(0, 1)}
						</span>
					)}
				</AvatarImage>
			</span>
			{online !== undefined && <Status online={online} className="absolute -right-0.5 -bottom-0.5 ring-2 ring-rail" />}
		</span>
	);
}

/** 状态规范：绿色在线，灰色离线；没有状态就不渲染。 */
export function Status({ online, className }: { online: boolean; className?: string }) {
	return (
		<span className={cn("inline-block h-2.5 w-2.5 rounded-full", online ? "bg-online" : "bg-offline", className)} />
	);
}
