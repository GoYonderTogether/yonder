import type { ProviderStreams } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { azureOpenAIResponsesApi } from "@earendil-works/pi-ai/api/azure-openai-responses.lazy";
import { bedrockConverseStreamApi } from "@earendil-works/pi-ai/api/bedrock-converse-stream.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { googleVertexApi } from "@earendil-works/pi-ai/api/google-vertex.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { piMessagesApi } from "@earendil-works/pi-ai/api/pi-messages.lazy";

export const protocols: Record<string, () => ProviderStreams> = {
	"anthropic-messages": anthropicMessagesApi,
	"openai-completions": openAICompletionsApi,
	"openai-responses": openAIResponsesApi,
	"openai-codex-responses": openAICodexResponsesApi,
	"azure-openai-responses": azureOpenAIResponsesApi,
	"google-generative-ai": googleGenerativeAIApi,
	"google-vertex": googleVertexApi,
	"bedrock-converse-stream": bedrockConverseStreamApi,
	"mistral-conversations": mistralConversationsApi,
	"pi-messages": piMessagesApi,
};
