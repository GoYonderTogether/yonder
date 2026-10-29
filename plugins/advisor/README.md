# Advisor

Select the optional `advisor` plugin to get a second opinion from the Advisor model.

- `ask_advisor` runs a consultation through the SDK delegation entry point. An empty object asks for a contextual review; `draft` reviews a concrete plan or completion, `question` narrows the decision, and `followUp` continues an earlier consultation of this session with a new question. `followUp` requires a non-empty `question` and cannot be combined with `draft`.
- `advisor_consult` is the previous name and keeps its `preset` + `task` contract; it shares the same implementation.
- Consultations run the preset named by plugin config `preset` (default `default`, which `init` always writes).

Each result starts with `adviceId`, which belongs to the originating session and expires on process restart. `advisor_record_advisor_outcome` voluntarily records adoption and validation only when plugin config `outcomeLogging` is `true` (default: false). The plugin stores a salted advice hash and outcome with record version `v: 1`, not the advice text, in its private data directory. Failed writes may be retried. Long advice uses the shared tool-output cache when available.
