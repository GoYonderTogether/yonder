import type { Delivery, SessionInfo, YEvent } from "@yonder/sdk";

/**
 * What channel slash commands need from delivery: send the command's own result back to its source conversation.
 * Commands are L3 routing like delivery, but the dependency still points downward through a declared port, so the
 * kernel injects the real delivery service.
 */
export interface CommandDeliveryPort {
	sendCommand(session: SessionInfo, event: YEvent, text: string): Promise<Delivery>;
}
