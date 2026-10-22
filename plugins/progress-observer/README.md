# Progress observer

The plugin exposes these loader-valid tools (plugin ID `progress-observer`):

- `progress-observer_task_register` registers a task using the current tool context's agent, session, and source event.
- `progress-observer_task_bind` binds the registered task to a spawned task session only after runtime `task.linked` evidence verifies the source invocation. Register first, then bind; registration alone does not claim execution or completion.

Both names use the required `<plugin-id>_` prefix. Keep these exact names in agent tool selections, integrations, and examples; the kernel validator is intentionally not relaxed and no unregistered aliases are provided.

Automatic progress reporting is disabled unless `enabled: true`. Even when enabled, the observer will not invoke its decision model or send a message unless **both** administrator-maintained allowlists match the task's recorded owner and exact source conversation:

```yaml
plugins:
  progress-observer:
    enabled: true
    allowedAgents:
      - agent:main
    allowedSourceConversations:
      - conv:<channel-instance>:<owner-private-conversation>
```

Keep both lists empty (the default) to disable automatic external reporting. Configure only after verifying the exact conversation reference is a private conversation with the owner; do not copy a group or account-wide reference. The SDK does not expose a reliable private-chat indicator, so the allowlist is an explicit administrator decision, not automatic private-chat detection. The plugin does not infer authorization from a task's historical source, source account, model output, or a model-proposed recipient. A task can still be registered and recorded while unauthorized, but no decision model call or send is made for it. Editing either allowlist requires administrator configuration; task labels/tool arguments cannot alter them.

`allowedAgents` and `allowedSourceConversations` are independently required and use exact agent IDs and complete `conv:`/`acct:` references. Although an administrator may deliberately authorize any exact conversation, minimum enablement for owner progress is one verified owner-private `conv:` reference and the one intended agent; never enable a group unless disclosure to that group is explicitly intended.

The allowlists are a scope boundary, not proof that a report is accepted, delivered, or read. No real conversation delivery is performed by tests.
