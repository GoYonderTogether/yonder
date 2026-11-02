import { allowsChannelInstance as sdkAllows, assertChannelInstance as sdkAssert } from "@yonder/sdk";

/**
 * Reserved channel identity (spec 02 §1.1). These are pure facts about configuration and references, so they
 * live at L0: delivery, routing and tools all need them, and none may import the kernel composition root.
 */
export const CONSOLE = "console";
/** Reserved binding id of the implicit console binding; agent config validation rejects it (config/index.ts). */
export const CONSOLE_BINDING = "@console";

type InstanceScope = { channelInstances?: readonly string[] };
/** Console is always authorized for delivery; every other instance still honours `channelInstances`. */
export const allowsChannelInstance = (scope: InstanceScope, instance: string) =>
	instance === CONSOLE || sdkAllows(scope, instance);
export const assertChannelInstance = (scope: InstanceScope, instance: string) => {
	if (instance !== CONSOLE) sdkAssert(scope, instance);
};
