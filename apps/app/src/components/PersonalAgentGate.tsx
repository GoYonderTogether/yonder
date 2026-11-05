import { useStore } from "@nanostores/react";
import type { ReactNode } from "react";
import { $onboardingOpen, closeOnboarding } from "../lib/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";

/**
 * 登录用户的守门：不再自动创建默认 Bot。
 * 账号还没有自己的 Bot 时，聊天列表与任务页显示「创建你的 bot」入口，
 * 打开这里挂着的全屏引导（OnboardingFlow）；已有 Bot 的账号不经过引导。
 */
export function PersonalAgentGate({ children }: { children: ReactNode }) {
	const open = useStore($onboardingOpen);
	return (
		<>
			{children}
			{open && (
				<div className="full-top-safe fixed inset-0 z-50 bg-ground">
					<OnboardingFlow onDone={closeOnboarding} />
				</div>
			)}
		</>
	);
}
