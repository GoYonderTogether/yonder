import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

// S-N03：scripts/ 里的安装根与服务标签必须与 core 常量（packages/core/src/release/names.ts，S-N01）一致。
// 这些值同时是 0.3 的公共路径约定：改值必须同时改 core、scripts 与本测试。
const REPO = path.join(import.meta.dirname, "..", "..");
const NAMES = path.join(REPO, "packages/core/src/release/names.ts");
const INSTALL_ROOT = ".local/share/yonder/install";
const SERVICE_LABEL = "dev.yonder.service";
const STATUS_LABEL = "dev.yonder.status";
// helper 的 bundle id 与 TCC 授权、代码签名绑定，永不更改。
const HELPER_ID = "dev.yonder.harness.helper";
const LEGACY_SERVICE_LABEL = "dev.yonder.harness.service";
const LEGACY_STATUS_LABEL = "dev.yonder.harness.status";
const LEGACY_INSTALL_DIR = ".yonder-harness";
const read = (file) => readFile(path.join(REPO, file), "utf8");

test("helper 安装脚本默认用新安装根，旧安装根不再出现", async () => {
	const installer = await read("scripts/yonder-helper-install.mjs");
	assert.ok(
		installer.includes(`join(homedir(), "${INSTALL_ROOT}")`),
		`yonder-helper-install.mjs 的默认安装根必须是 ~/${INSTALL_ROOT}`,
	);
	assert.ok(
		!installer.includes(LEGACY_INSTALL_DIR),
		`yonder-helper-install.mjs 不得再引用旧安装根 ${LEGACY_INSTALL_DIR}`,
	);
});

test("deploy-node.sh 的 systemd 单元名是新服务标签，旧标签只留在旧单元清理里", async () => {
	const deploy = await read("scripts/deploy-node.sh");
	const unitPath = `/home/yonder/.config/systemd/user/${SERVICE_LABEL}`;
	for (const needle of [
		`${unitPath} <<EOU`, // 写单元文件
		`chown yonder:yonder ${unitPath}`,
		`systemctl --user daemon-reload`, // 写在后端：单元名变了必须重载
		`systemctl --user enable ${SERVICE_LABEL}`,
		`systemctl --user restart ${SERVICE_LABEL}`,
		`systemctl --user show ${SERVICE_LABEL}`,
		`systemctl --user is-active --quiet ${SERVICE_LABEL}`,
		`systemctl --user disable --now ${SERVICE_LABEL}`,
		`rm -f ${unitPath}`,
	])
		assert.ok(deploy.includes(needle), `deploy-node.sh 缺少新服务标签用法：${needle}`);
	for (const [index, line] of deploy.split("\n").entries()) {
		if (!line.includes(LEGACY_SERVICE_LABEL)) continue;
		// 旧节点（0.2）装着旧单元，install 时要先停用再删掉；说明注释允许提及。
		assert.match(
			line,
			/^#|-f \S*dev\.yonder\.harness\.service|systemctl --user disable --now dev\.yonder\.harness\.service|rm -f \S*dev\.yonder\.harness\.service/u,
			`deploy-node.sh:${index + 1} 旧服务标签只允许出现在旧单元清理处`,
		);
	}
});

test("macOS 打包的状态项 bundle id 是新状态标签，helper id 保持不变", async () => {
	const status = await read("scripts/build-macos.mjs");
	const helper = await read("scripts/build-permissions.mjs");
	assert.ok(
		status.includes(`<string>${STATUS_LABEL}</string>`),
		`build-macos.mjs 的状态项 bundle id 必须是 ${STATUS_LABEL}`,
	);
	assert.ok(!status.includes(LEGACY_STATUS_LABEL), `build-macos.mjs 不得再用旧 bundle id ${LEGACY_STATUS_LABEL}`);
	assert.ok(
		helper.includes(`<string>${HELPER_ID}</string>`),
		`build-permissions.mjs 的 helper bundle id 必须保持 ${HELPER_ID}`,
	);
});

test("core 常量（release/names.ts）与 scripts 用同一套值", async (t) => {
	if (!existsSync(NAMES)) {
		t.skip(`未测：${path.relative(REPO, NAMES)} 尚未落地（S-N01），core 侧一致性无从比对`);
		return;
	}
	const names = await readFile(NAMES, "utf8");
	for (const legacy of [LEGACY_SERVICE_LABEL, LEGACY_STATUS_LABEL, LEGACY_INSTALL_DIR])
		assert.ok(names.includes(`"${legacy}"`), `names.ts 必须保留旧值 LEGACY ${legacy} 供迁移使用`);
	for (const current of [SERVICE_LABEL, STATUS_LABEL, HELPER_ID])
		assert.ok(names.includes(`"${current}"`), `names.ts 必须导出 ${current}`);
	assert.match(names, /export (?:const|function) installRoot/u, "names.ts 必须导出 installRoot(env)");
	assert.ok(
		names.includes(INSTALL_ROOT) ||
			/"\.local"[\s\S]{0,80}"share"[\s\S]{0,80}"yonder"[\s\S]{0,80}"install"/u.test(names),
		`names.ts 的安装根必须是 ~/${INSTALL_ROOT}`,
	);
});
