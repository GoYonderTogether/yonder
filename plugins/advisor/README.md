# Advisor

Select the optional `advisor` plugin to consult an existing task preset with `advisor_consult`. Its `adviceId` belongs to the originating session and expires on process restart. `advisor_record_advisor_outcome` voluntarily records adoption and validation only when plugin config `outcomeLogging` is `true` (default: false). The plugin stores a salted advice hash and outcome, not the advice text, in its private data directory. Failed writes may be retried. Long advice uses the shared tool-output cache when available.
