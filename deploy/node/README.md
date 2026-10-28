# Linux node deployment

`scripts/deploy-node.sh` manages a Linux node with a user-level systemd service. No command contacts a server except `push`, `install`, `status`, `rollback`, `nginx`, and `uninstall`; pass the destination as the command's host argument or set `YONDER_DEPLOY_HOST`. There is no built-in host default.

## Configuration

For local private overrides, copy `local.env.example` to the gitignored `local.env`. It may set:

- `YONDER_DEPLOY_HOST`: default destination host (optional; command argument takes priority).
- `YONDER_PUBLIC_ORIGIN`: public `http(s)` origin (required for `nginx`; matching server block is selected by hostname).
- `YONDER_GLM_KEY_FILE`: optional local auth JSON file to search for a `rightapi-glm.key`.
- `YONDER_HEALTH_PORT`: rollback gateway health-check port; defaults to `8787`.

Without `YONDER_GLM_KEY_FILE`, the installer checks the existing standard local auth-file paths in `scripts/deploy-node.sh`; the key is transferred only over stdin.

## Commands and safeguards

- `uninstall <host>` stops and disables the service but retains the user and data.
- `uninstall <host> --purge` additionally removes user `yonder` and its data only after typing `purge` at the prompt.
- `uninstall <host> --purge --yes` explicitly confirms the destructive purge without an interactive prompt.
- `nginx <host> maint|proxy [port]` requires `YONDER_PUBLIC_ORIGIN`; it edits only the matching server block and restores its backup if validation or reload fails.
- `rollback <host>` switches versions, restarts, and checks service activity and the local gateway health endpoint. On failure it switches back to the previous current version and exits non-zero.
