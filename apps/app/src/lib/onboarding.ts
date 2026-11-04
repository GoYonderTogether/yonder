import { atom } from "nanostores";

/** 首次引导的开关：聊天列表与任务页的「创建你的 bot」入口打开，PersonalAgentGate 挂出全屏流程。 */
export const $onboardingOpen = atom(false);

export const openOnboarding = () => $onboardingOpen.set(true);
export const closeOnboarding = () => $onboardingOpen.set(false);
