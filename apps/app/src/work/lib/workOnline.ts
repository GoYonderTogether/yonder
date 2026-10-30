import { useSyncExternalStore } from "react";
import { activeNode } from "../api/nodes";

let devices = new Map<string, boolean>();
const listeners = new Set<() => void>();
export function setWorkDevices(next: ReadonlyArray<{ id: string; online: boolean; workProtocol?: 1 }>) {
	devices = new Map(next.map((device) => [device.id, device.online && device.workProtocol === 1]));
	for (const listener of listeners) listener();
}
export function deviceOnline(deviceId?: string): boolean {
	return !deviceId || devices.get(deviceId) === true;
}
export function useWorkOnline(): boolean {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		() => deviceOnline(activeNode().deviceId),
		() => false,
	);
}
