# Linux node deployment

`scripts/deploy-node.sh` manages a Linux node with a user-level systemd service. No command contacts a server except `push`, `install`, `status`, `rollback`, `nginx`, and `uninstall`; pass the destination as the command's host argument or set `YONDER_DEPLOY_HOST`. There is no built-in host default.

## Configuration

For local private overrides, copy `local.env.example` to the gitignored `local.env`. It may set:

- `YONDER_DEPLOY_HOST`: default destination host (optional; command argument takes priority).
- `YONDER_PUBLIC_ORIGIN`: public `http(s)` origin (required for `nginx`; matching server block is selected by hostname).
- `YONDER_AUTH_KEY_FILE`: optional local auth JSON file to search for the cloud model keys (`rightapi-glm.key`, then `workbuddy.key`). `YONDER_SILICONFLOW_KEY_FILE` is still read as the legacy name.
- `YONDER_HEALTH_PORT`: rollback gateway health-check port; defaults to `7690` (the gateway port in `yonder.yaml`; probed at `/login`).

Without `YONDER_AUTH_KEY_FILE`, the installer checks the existing standard local auth-file paths in `scripts/deploy-node.sh`; the keys are transferred only over stdin and merged into the remote `auth.json` (the cloud chain is `rightapi-glm/glm-5.3-flash`, falling back to `workbuddy/deepseek-v4.1-flash` over the reverse tunnel; no SiliconFlow DeepSeek).

## Commands and safeguards

- `uninstall <host>` stops and disables the service but retains the user and data.
- `uninstall <host> --purge` additionally removes user `yonder` and its data only after typing `purge` at the prompt.
- `uninstall <host> --purge --yes` explicitly confirms the destructive purge without an interactive prompt.
- `nginx <host> maint|proxy [port]` requires `YONDER_PUBLIC_ORIGIN`; it edits only the matching server block and restores its backup if validation or reload fails.
- `rollback <host>` switches versions, restarts, and checks service activity and the local gateway health endpoint. On failure it switches back to the previous current version and exits non-zero.
