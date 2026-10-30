export interface WorkControl {
	ready(ownerId: string): Promise<boolean>;
	request(ownerId: string, method: string, params: unknown, signal: AbortSignal): Promise<unknown>;
	open(ownerId: string, send: (frame: unknown) => void, signal: AbortSignal): Promise<{ frame(frame: unknown): void }>;
}
