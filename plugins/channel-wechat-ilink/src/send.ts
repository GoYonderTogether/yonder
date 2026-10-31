import { randomUUID } from "node:crypto";
import { type Delivery, type OutMessage, parseRef } from "@yonder/sdk";
import { type createClient, IlinkRequestError, type IlinkStage, type Item } from "./client.js";
import type { Config, State } from "./state.js";

/** Everything the outgoing protocol client needs from one iLink instance. */
export interface SendContext {
	id: string;
	config: Config;
	state: State;
	client: ReturnType<typeof createClient>;
	/** Pairing/state load; failures are reported as a failed delivery, not a rejection. */
	ready(): Promise<void>;
	warn(fields: object): void;
}

export async function sendMessage(
	ctx: SendContext,
	target: string,
	msg: OutMessage,
	signal?: AbortSignal,
): Promise<Delivery> {
	let attempted = false,
		sent = 0;
	let stage: IlinkStage | "preflight" = "preflight";
	const id = `yonder-wechat-${randomUUID()}`;
	try {
		await ctx.ready();
		signal?.throwIfAborted();
		const ref = parseRef(target);
		if ((ref.kind !== "acct" && ref.kind !== "conv") || ref.channel !== ctx.id)
			throw new Error("Target must belong to this iLink instance");
		const peer = ref.id;
		if (!ctx.state.peer || !ctx.state.linked || (peer !== ctx.state.peer && !ctx.config.allowedUsers?.includes(peer)))
			throw new Error("iLink target is not admitted");
		const token = ctx.state.contexts[peer];
		if (!token) throw new Error("ILINK_CONTEXT_MISSING: recipient must first message this bot");
		const outgoing: Item[] = [];
		const characters = Array.from(msg.text);
		for (let offset = 0; offset < characters.length; offset += 2000)
			outgoing.push({ type: 1, text_item: { text: characters.slice(offset, offset + 2000).join("") } });
		for (const attachment of msg.attachments ?? []) {
			stage = "attachment-read";
			outgoing.push(await ctx.client.upload(attachment, peer, signal));
		}
		if (!outgoing.length) throw new Error("Empty iLink message");
		for (let index = 0; index < outgoing.length; index++) {
			stage = "sendmessage";
			signal?.throwIfAborted();
			const item = outgoing[index]!;
			if (msg.replyTo && index === 0) Object.assign(item, { ref_msg: { svr_id: msg.replyTo } });
			attempted = true;
			await ctx.client.request(
				"ilink/bot/sendmessage",
				{
					msg: {
						from_user_id: "",
						to_user_id: peer,
						client_id: `${id}-${index + 1}`,
						message_type: 2,
						message_state: 2,
						context_token: token,
						item_list: [item],
					},
					base_info: ctx.client.baseInfo,
				},
				true,
				undefined,
				undefined,
				signal,
			);
			sent++;
		}
		return { ok: true, id };
	} catch (error) {
		// Upload preparation is not a message attempt. A confirmed earlier part must
		// remain uncertain even if a later part receives a definite rejection.
		const rejected =
			sent === 0 && error instanceof IlinkRequestError && error.stage === "sendmessage" && error.rejected;
		const diagnostic = error instanceof IlinkRequestError ? error.diagnostic : { stage };
		ctx.warn({
			...diagnostic,
			attempted,
			confirmedParts: sent,
			uncertain: attempted && !rejected,
		});
		const detail = `; ${JSON.stringify(diagnostic)}`;
		return {
			ok: false,
			...(attempted && !rejected ? { uncertain: true, id } : {}),
			error: rejected
				? `ILINK_SEND_REJECTED${detail}`
				: attempted
					? `ILINK_DELIVERY_UNCERTAIN: ${sent} parts confirmed; do not resend${detail}`
					: error instanceof Error && /^(?:ILINK_|Target |iLink |Empty )/.test(error.message)
						? error.message
						: `ILINK_SEND_FAILED${detail}`,
		};
	}
}
