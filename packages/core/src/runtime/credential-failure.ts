import { type AssistantMessageEventStream, createAssistantMessageEventStream } from "@earendil-works/pi-ai";

const CREDENTIAL_SOURCE =
	/^(?:OAuth refresh failed|OAuth auth derivation failed|Provider is not configured|API key auth failed|Credential store)/i;
const NETWORK = /fetch failed|connection error|ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed? out/i;
const REJECTED = /\b4\d{2}\b|invalid.grant|revoked|expired.refresh|unauthorized|access.denied/i;
export const CREDENTIAL_MARK = "authentication failed (credential unavailable";

const UPSTREAM =
	/\b5\d{2}\b|server_error|overloaded|bad gateway|service unavailable|gateway timeout|no usable account|no healthy account|cooling down|daily token limit|pool exhausted|temporarily unavailable/i;
const PARAM_ERROR = /\b(?:400|422)\b|invalid.?request|invalid.?parameter|content.?policy|safety.?filter/i;
export const UPSTREAM_MARK = "rate limit (upstream unavailable, trying next model)";

/**
 * Gateway/upstream outage: 5xx, exhausted account pool, cooldown or daily-limit text. pi-durable treats such errors
 * as transient and only advances after `after` failures with backoff, so the user's turn can end first. Marking
 * them as rate-limit-style text advances the chain immediately. Parameter errors (4xx) never match.
 */
export function upstreamFailure(text: string | undefined): boolean {
	if (!text || text.includes(UPSTREAM_MARK) || text.includes(CREDENTIAL_MARK)) return false;
	return UPSTREAM.test(text) && !PARAM_ERROR.test(text);
}
/**
 * An unrecoverable credential error: refresh token rejected, key missing or rejected. A refresh that failed only
 * on the network is not one. pi-durable advances the chain only for 401/403/"authentication"-style text, so this
 * text is what lets such a run move on to the next candidate instead of stopping.
 */
export function credentialFailure(text: string | undefined): boolean {
	if (!text || text.includes(CREDENTIAL_MARK) || !CREDENTIAL_SOURCE.test(text)) return false;
	return !(NETWORK.test(text) && !REJECTED.test(text));
}
export function markCredentialFailure(provider: string, text: string): string {
	return `${CREDENTIAL_MARK}; run \`yonder login ${provider} --replace\`): ${text}`;
}
/** Rewrite a credential error so the chain treats it as an authentication failure; other events pass through. */
export function withCredentialMark(stream: AssistantMessageEventStream, provider: string): AssistantMessageEventStream {
	const out = createAssistantMessageEventStream();
	void (async () => {
		try {
			for await (const event of stream) {
				if (event.type === "error" && upstreamFailure(event.error.errorMessage)) {
					const error = { ...event.error, errorMessage: `${UPSTREAM_MARK}: ${event.error.errorMessage}` };
					out.push({ type: "error", reason: event.reason, error });
				} else if (event.type === "error" && credentialFailure(event.error.errorMessage)) {
					const error = {
						...event.error,
						errorMessage: markCredentialFailure(provider, event.error.errorMessage ?? ""),
					};
					out.push({ type: "error", reason: event.reason, error });
				} else out.push(event);
			}
		} finally {
			out.end();
		}
	})();
	return out;
}
