export type KernelLog = (level: "info" | "warn" | "error", message: string, data?: object) => void;
