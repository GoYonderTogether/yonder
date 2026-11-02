// The request shape belongs to the send tool's port (tools/delivery-port.ts, L2). Delivery implements that port,
// so it imports the type from there instead of the tools importing a delivery type upward.
export type { MessageRequest } from "../tools/delivery-port.js";
