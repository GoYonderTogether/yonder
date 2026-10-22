# decision-routing (optional; disabled by default)

Registered SDK plugin with one advisory tool, `decision-routing_recommend`. Enable only after an administrator has reviewed and set `enabled=true`, `adminApproved=true`, exact classifier provider/model/origin allowlists, target-model/agent/conversation allowlists, USD cost bounds, and the classifier disclosure policy. Missing costs fail closed. Tool requires host-granted `admin` and `network` capabilities, and exact current agent and source conversation allowlist membership.

The caller must provide an explicitly approved short summary and candidate routes. The plugin does not inspect session history, messages, transcripts or attachments. It invokes the existing SDK classifier once (`maxRetries: 0`) and returns a recommendation only. It never mutates session/profile/config, changes admission, submits the target model, or retries uncertain classifier results.

Target SDK catalog metadata includes a chat model's `reasoning` boolean, not the model/provider's full effort enum. Returned requested/effective fields are explicitly advisory catalog-level values; `catalog_reasoning_supported_not_applied` does **not** claim execution or provider legality. Core per-input effort resolution remains authoritative. No core reverse dependency is added. Do not treat this plugin as completed automatic routing: the next required work is the separately reviewed kernel input-admission integration.

Tests are synthetic; no real classifier, credentials, paid model, production activation, message, push or target generation was performed.
