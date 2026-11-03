/** GitHub redirects a renamed repository forever, so a receipt written before the rename still describes this repository. */
const RENAMED_REPOSITORIES: Record<string, string> = { "yonder-harness.git": "yonder.git" };

/** Repository identity: credentials, a trailing slash, the `.git` suffix and the previous GitHub name do not matter. */
export function canonicalRepository(repository: string): string {
	if (!/^https?:\/\//u.test(repository)) return repository;
	let url: URL;
	try {
		url = new URL(repository);
	} catch {
		return repository;
	}
	url.username = "";
	url.password = "";
	if (url.hostname === "github.com") {
		const segments = url.pathname.replace(/(?:\.git)?\/?$/u, ".git").split("/");
		const name = segments[segments.length - 1] ?? "";
		segments[segments.length - 1] = RENAMED_REPOSITORIES[name.toLowerCase()] ?? name;
		url.pathname = segments.join("/");
	}
	return url.href;
}
