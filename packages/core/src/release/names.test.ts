import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import {
	HELPER_ID,
	installRoot,
	LEGACY_HOME_DIR,
	LEGACY_INSTALL_DIR,
	LEGACY_LABELS,
	SERVICE_LABEL,
	STATUS_LABEL,
} from "./names.js";

test("installation and service names preserve migration identifiers", () => {
	expect(installRoot({})).toBe(join(homedir(), ".local/share/yonder/install"));
	expect(installRoot({ YONDER_INSTALL: "custom-install" })).toBe(resolve("custom-install"));
	expect(SERVICE_LABEL).toBe("dev.yonder.service");
	expect(STATUS_LABEL).toBe("dev.yonder.status");
	expect(HELPER_ID).toBe("dev.yonder.harness.helper");
	expect(LEGACY_INSTALL_DIR).toBe(".yonder-harness");
	expect(LEGACY_HOME_DIR).toBe("yonder-harness");
	expect(LEGACY_LABELS).toEqual(["dev.yonder.harness", "dev.yonder.harness.service", "dev.yonder.harness.status"]);
});
