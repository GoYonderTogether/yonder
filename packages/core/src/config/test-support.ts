import { presetProfile as basePresetProfile, resolveProfile as baseResolveProfile } from "./index.js";

/** 测试用的真实默认模型（CONTRIBUTING）；生产代码不含任何模型常量。 */
export const testModel = "openai/gpt-6-luna";

export const resolveProfile = (...[profile, defaults, env]: Parameters<typeof baseResolveProfile>) =>
	baseResolveProfile(profile, defaults, env, testModel);

export const presetProfile = (...args: Parameters<typeof basePresetProfile>) => {
	const [preset, env, capabilities, inherit, channelInstances] = args;
	return basePresetProfile(preset, env, capabilities, inherit, channelInstances, args[5] ?? testModel);
};
